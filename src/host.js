// 小红书七日爆款雷达 · Host 半边（xhs_weekly 原生工具 + 技能提供方 + 三步输出规范注入 + 面板数据面）。
// 榜单查询/排序/HTML 是纯数据操作由工具完成；「七日热门笔记分析」3 模块由会话模型按技能撰写。
import Schema from '@deepseek-ai/schemastery'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSkillProvider } from '../lib/skills.js'
import { systemSection } from './systemPrompt.js'
import { registerApi } from '../lib/api.js'
import { fetchWeeklyData, resolveApiKey, resolveApiBase } from '../lib/redfox.js'
import { getQueryDate, extractArticles, sortArticles, extractNotes, moreHint } from '../lib/ranking.js'
import { matchCategory, suggestCategories, ALL_CATEGORIES } from '../lib/categories.js'
import { generateWeeklyHtml } from '../lib/report.js'
import { saveBoard, getBoardMeta, getBoardRaw, listBoards, deleteBoard, saveReportHtml, readReportHtml, getSettings } from '../lib/store.js'

export const name = 'xhs-weeklytop' // = cordis.patch.yml 的 id

export const inject = ['tools', 'skills', 'systemPrompt', 'webServer', 'connection']

export const Config = Schema.object({
  injectRules: Schema.boolean().default(true).description('注入七日爆款工作流到系统提示'),
  apiKey: Schema.string().default('').description('RedFox API Key（ak_ 开头；留空读面板设置或环境变量 REDFOX_API_KEY）'),
  proxyUrl: Schema.string().default('').description('HTTP(S) 代理（访问 redfox.hk 用），留空直连'),
})

function check(args, spec) {
  const problems = []
  for (const key of spec.required || []) {
    if (args?.[key] === undefined) problems.push(`缺少必填参数 ${key}`)
  }
  for (const [key, rule] of Object.entries(spec.properties || {})) {
    const value = args?.[key]
    if (value === undefined) continue
    if (rule.enum && !rule.enum.includes(value)) problems.push(`${key} 只能是 ${rule.enum.join(' / ')} 之一`)
  }
  for (const key of Object.keys(args || {})) {
    if (!spec.properties || !(key in spec.properties)) problems.push(`未知参数 ${key}`)
  }
  if (problems.length) throw new Error(`参数有误：${problems.join('；')}。`)
}

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const num = (description, extra = {}) => ({ type: 'number', description, ...extra })
const text = (value) => [{ type: 'text', text: value }]

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'summary'],
    properties: {
      ok: { type: 'boolean' },
      summary: { type: 'string', description: '给模型看的回执' },
      data: { type: 'string', description: '可选：榜单表格/说明' },
      hints: { type: 'string', description: '可选：分类推荐/功能询问等提示' },
    },
  },
  render: (_args, value) => text([value.summary, value.data, value.hints].filter(Boolean).join('\n\n')),
}

const result = (ok, summary, data = '', hints = '') => ({ ok, summary, data, hints })

const MAX_TEXT = 58000
const RANK_MEDALS = ['🥇', '🥈', '🥉']

// Markdown 表格（与 HTML 同数据同序——数据一致性硬要求）
function renderTable(notes, { offset = 0, limit = 20, updatedAt = '' } = {}) {
  const slice = notes.slice(offset, offset + limit)
  if (!slice.length) return ''
  const lines = []
  if (offset === 0) {
    lines.push(`**🔥 【${slice[0]?.category || ''}】七日爆款笔记 （更新时间：${updatedAt}）**`)
    lines.push('| 排名 | 笔记信息 | 互动数 | 点赞 | 评论 | 收藏 | 分享 |')
    lines.push('|:---:|:---|:---:|:---:|:---:|:---:|:---:|')
  }
  const clean = (v) => String(v ?? '').replace(/[\r\n ]+/g, '').replace(/[<>{}[\]\\|]/g, '').trim()
  for (const n of slice) {
    const rank = n.rank
    const medal = RANK_MEDALS[rank - 1] || String(rank)
    const title = clean(n.title) || '无标题'
    const author = clean(n.userName) || '未知用户'
    const noteInfo = n.photoJumpUrl
      ? `[${title}](${n.photoJumpUrl})<br>${author}（${clean(n.fans)}粉丝）`
      : `${title}<br>${author}（${clean(n.fans)}粉丝）`
    const cell = (f) => `${formatNum(f.total)}<br>↑新增${formatNum(f.add)}`
    lines.push(`| ${medal} | ${noteInfo} | ${cell(n.interactive)} | ${cell(n.like)} | ${cell(n.comment)} | ${cell(n.collected)} | ${cell(n.share)} |`)
  }
  return lines.join('\n')
}

function formatNum(value) {
  const num = typeof value === 'number' ? value : parseInt(String(value), 10)
  if (Number.isFinite(num) && Math.abs(num) >= 10000) return `${Math.floor(Math.abs(num) / 10000)}w+`
  return String(value ?? 0)
}

function resolveBoard(bid) {
  if (bid) {
    const meta = getBoardMeta(bid)
    if (!meta) throw new Error(`榜单不存在：${bid}。用 history 查看已有榜单。`)
    return meta
  }
  const [latest] = listBoards({ limit: 1 })
  if (!latest) throw new Error('还没有榜单数据。先 fetch（keyword 或 category 必填）。')
  return getBoardMeta(latest.board_id)
}

// ---------------------------------------------------------------------------
// 工具：xhs_weekly —— match / fetch / notes / html / history
// ---------------------------------------------------------------------------
export const xhsWeeklyTool = {
  name: 'xhs_weekly',
  description:
    '小红书七日爆款雷达：近 7 天热门笔记 TOP50（按 24 个垂直分类查询）。' +
    '流程：match 分类匹配（命中直接查；未命中把推荐给用户确认，禁止直接查）→ fetch 拉榜单（按互动数排序，含累计+↑新增数据）→ ' +
    '按 xiaohongshu-weeklytop 技能三步输出（表格 TOP20 → 七日分析 3 模块 → 功能询问）→ html 生成小红书风报告（导出 PDF/图片）。' +
    '数据每日 19:00 更新昨日榜单；表格与 HTML 同数据源同排序，完全一致。需要 RedFox API Key。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: str('match 分类匹配；fetch 拉榜单；notes 补读榜单条目；html 生成报告；history 历史', {
        enum: ['match', 'fetch', 'notes', 'html', 'history'],
      }),
      keyword: str('match/fetch：用户关键词（match 用它匹配 24 分类；fetch 未命中时返回推荐而非数据）'),
      category: str('fetch/html/notes：分类名（24 个之一；缺省用最新榜单的分类）'),
      rankDate: str('fetch：查询日期 YYYY-MM-DD；缺省按 19:00 规则自动推断（≥19:00 查昨日，否则前天）'),
      topN: num('fetch：返回条数，固定 50（上游规范）'),
      boardId: str('notes/html/history 定位榜单；缺省=最新'),
      offset: num('notes：从第几条开始（0 起）'),
      limit: num('notes：最多返回条数，默认 30'),
      top: num('html：展示条数，首次 20，「查看更多」后 50'),
    },
  },
  output: OUTPUT,
  async execute(args, ctxConfig) {
    check(args, this.parameters)
    const cfg = ctxConfig || {}

    // ── match ────────────────────────────────────────────────────────────
    if (args.action === 'match') {
      if (!args.keyword) throw new Error('match 需要 keyword。')
      const hit = matchCategory(args.keyword)
      if (hit) {
        return result(true, `关键词「${args.keyword}」命中分类【${hit}】。直接 fetch(category="${hit}") 查询。`, `命中分类：${hit}`)
      }
      const suggested = suggestCategories(args.keyword)
      return result(false,
        `关键词「${args.keyword}」未命中任何分类。按规范：禁止直接查询，向用户展示推荐分类并等待确认（用户确认后以该分类 fetch；用户选「若无」则停止全流程）。`,
        suggested.map((c, i) => `${i + 1}. ${c}`).join('\n'),
        `⚠️ 若无想要查询的分类，可前往 https://redfox.hk/apis/xiaohongshu/384C6W6B?source=github API文档查询更精确的作品~`)
    }

    // ── fetch ────────────────────────────────────────────────────────────
    if (args.action === 'fetch') {
      let category = args.category
      if (!category && args.keyword) {
        const hit = matchCategory(args.keyword)
        if (!hit) {
          const suggested = suggestCategories(args.keyword)
          return result(false,
            `关键词「${args.keyword}」未命中分类，禁止直接查询。向用户展示推荐并等待确认（确认后带 category 重新 fetch）。`,
            suggested.map((c, i) => `${i + 1}. ${c}`).join('\n'),
            `⚠️ 若无想要查询的分类，可前往 https://redfox.hk/apis/xiaohongshu/384C6W6B?source=github API文档查询更精确的作品~`)
        }
        category = hit
      }
      category = category || '综合全部'
      if (!ALL_CATEGORIES.includes(category)) {
        throw new Error(`未知分类「${category}」。可选：${ALL_CATEGORIES.join('、')}。`)
      }
      const settings = getSettings()
      const apiKey = resolveApiKey({ settings, config: cfg })
      if (!apiKey) {
        return result(false, '未配置 RedFox API Key。请用户到面板「小红书七日爆款雷达 → 设置」填入，或在插件配置/环境变量 REDFOX_API_KEY 里配置。')
      }
      const { date, auto, reason } = getQueryDate(args.rankDate)
      const topN = Math.min(Math.max(Number(args.topN) || 50, 1), 50)
      const raw = await fetchWeeklyData({
        rankDate: date, category, apiKey, apiBase: resolveApiBase({ settings }),
        proxyUrl: cfg.proxyUrl || settings.proxy_url || '',
      })
      const articles = sortArticles(extractArticles(raw?.data), topN)
      const notes = extractNotes(articles).map((n) => ({ ...n, category }))
      const fetchTime = new Date().toISOString().slice(0, 19).replace('T', ' ')
      const meta = saveBoard({ raw, category, rankDate: date, rankDateAuto: auto, notes, fetchTime })
      if (!notes.length) {
        return result(false,
          `未获取到【${category}】分类 ${date} 的爆款内容数据（${auto ? reason : '指定日期'}）。如实告知用户，建议换日期或分类，不要编造数据。`,
          '', '')
      }
      const table = renderTable(notes, { offset: 0, limit: 20, updatedAt: fetchTime, category })
      const hint = moreHint(notes.length)
      return result(true,
        `已入库（boardId=${meta.board_id}，${auto ? reason : '指定日期'}，共 ${notes.length} 条）。按 xiaohongshu-weeklytop 技能三步输出：① 表格（数据速览）② 七日热门笔记分析 3 模块（热门内容/爆款标题/最高数据作品——由你撰写，基于全部 ${notes.length} 条）③ 功能询问（HTML+订阅）。`,
        table + (hint ? `\n\n${hint}` : ''),
        `功能询问（分析输出后必须立即展示）：\n技能还支持以下功能：\n1️⃣ 订阅每日 19:30 推送七日爆款 TOP50（用 dsh 定时任务实现，先跟用户确认）。\n2️⃣ 生成小红书风 HTML 文件包（xhs_weekly action="html"，支持导出 PDF/图片）。`)
    }

    // ── notes ────────────────────────────────────────────────────────────
    if (args.action === 'notes') {
      const meta = resolveBoard(args.boardId)
      const raw = getBoardRaw(meta.board_id)
      const articles = sortArticles(extractArticles(raw?.data), 50)
      const notes = extractNotes(articles).map((n) => ({ ...n, category: meta.category }))
      const offset = Math.max(Number(args.offset) || 0, 0)
      const limit = Math.min(Number(args.limit) || 30, 50)
      const table = renderTable(notes, { offset, limit, updatedAt: meta.fetch_time })
      if (!table) return result(false, `没有更多条目（共 ${notes.length} 条，offset=${offset}）。`)
      return result(true,
        `${meta.category}（${meta.rank_date}）第 ${offset + 1}-${Math.min(offset + limit, notes.length)} 条 / 共 ${notes.length}。「查看更多」场景续用 offset=${offset + limit}；生成完整 HTML 用 action="html", top=${notes.length}。`,
        table)
    }

    // ── html ─────────────────────────────────────────────────────────────
    if (args.action === 'html') {
      const meta = resolveBoard(args.boardId)
      const raw = getBoardRaw(meta.board_id)
      const articles = sortArticles(extractArticles(raw?.data), 50)
      const notes = extractNotes(articles)
      const top = Math.min(Math.max(Number(args.top) || 20, 1), 50)
      const html = generateWeeklyHtml(notes, { category: meta.category, fetchTime: meta.fetch_time, topN: top, rankDate: meta.rank_date })
      const file = saveReportHtml(meta.board_id, html)
      return result(true,
        `HTML 报告已生成（TOP${top}，与表格同数据同排序）：${file}。面板可直接查看；向用户输出文件路径并说明支持导出 PDF/图片。`,
        `报告文件: ${file}`)
    }

    // ── history ──────────────────────────────────────────────────────────
    if (args.action === 'history') {
      const list = listBoards({ limit: 20 })
      if (!list.length) return result(false, '还没有榜单。先 fetch。')
      const lines = list.map((r) => `${r.board_id}｜${r.category}｜${r.rank_date}｜${r.total} 条`)
      return result(true, `共 ${list.length} 份榜单（新→旧）。对旧榜单补 HTML/读条目传 boardId。`, lines.join('\n'))
    }

    throw new Error(`未知 action：${args.action}`)
  },
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------
export function apply(ctx, config) {
  const skillDirs = [join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')]

  const toolWithConfig = { ...xhsWeeklyTool, execute(args) { return xhsWeeklyTool.execute(args, config) } }

  ctx.effect(() => ctx.tools.register(toolWithConfig), `${name}: tool`)
  ctx.effect(() => ctx.skills.registerProvider(() => createSkillProvider(skillDirs)), `${name}: skills`)
  if (config.injectRules !== false) {
    ctx.effect(() => ctx.systemPrompt.section(systemSection()), `${name}: workflow`)
  }
  ctx.effect(() => registerApi(ctx, { config }), `${name}: routes`)
}
