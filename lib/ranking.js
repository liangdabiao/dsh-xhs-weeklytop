// 榜单处理：日期判断（19:00 规则）、互动数排序、w+ 数量解析、字段提取。
// 移植自 xhs_weekly_fetcher.py 的 get_query_date / process_ranking_data / parse_count / format_num。
// 注意：anaAdd 里的 addInteractiveount / addCollectedCunt 是上游 API 的真实字段名（拼错但真实存在），必须保留。
import { CATEGORY_KEYWORDS } from './categories.js'

// '2w+' / '3.5w' / '893' / 数字 → 整数
export function parseCount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0
  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    if (lower.includes('w')) {
      const num = parseFloat(lower.replace(/w\+?/, ''))
      return Number.isFinite(num) ? Math.round(num * 10000) : 0
    }
    const n = parseInt(value, 10)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

// 展示格式：≥1w → Nw+；<1w 原样（上游 format_num：原始值直接透出）
export function formatNum(value) {
  const num = parseCount(value)
  if (num >= 10000) return `${Math.floor(num / 10000)}w+`
  return String(value ?? 0)
}

// 日期判断（上游 get_query_date）：指定日期直用；否则 ≥19:00 查昨日、<19:00 查前天
export function getQueryDate(userDate, now = new Date()) {
  if (userDate) return { date: userDate, auto: false }
  const cutoff = new Date(now)
  cutoff.setHours(19, 0, 0, 0)
  const back = now >= cutoff ? 1 : 2
  const d = new Date(now.getTime() - back * 86400_000)
  const pad = (n) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    auto: true,
    reason: now >= cutoff ? '已过19:00，查询昨日数据（当日已更新）' : '未过19:00，查询前天数据（等待当日19:00更新）',
  }
}

// 从 API 原始响应提取笔记数组（兼容 list/records/data 多种包装）
export function extractArticles(data) {
  let articles = []
  if (Array.isArray(data)) articles = data
  else if (data && typeof data === 'object') {
    articles = data.data ?? data.list ?? data.articles ?? []
    if (articles && typeof articles === 'object' && !Array.isArray(articles)) {
      articles = articles.list ?? articles.records ?? []
    }
  }
  return Array.isArray(articles) ? articles : []
}

// 互动分：优先 interactiveCount；备用 = 点赞 + 收藏*2 + 评论*3 + 分享*5
export function interactionScore(article) {
  const anaAdd = article?.anaAdd || {}
  const ic = anaAdd.interactiveCount ?? article?.interactiveCount ?? 0
  const num = parseCount(ic)
  if (num > 0) return num
  const like = parseCount(anaAdd.useLikeCount ?? article?.useLikeCount ?? 0)
  const collected = parseCount(anaAdd.collectedCount ?? article?.collectedCount ?? 0)
  const comment = parseCount(anaAdd.useCommentCount ?? article?.useCommentCount ?? 0)
  const share = parseCount(anaAdd.useShareCount ?? article?.useShareCount ?? 0)
  return like + collected * 2 + comment * 3 + share * 5
}

export function sortArticles(articles, topN = 50) {
  return [...(articles || [])].sort((a, b) => interactionScore(b) - interactionScore(a)).slice(0, topN)
}

// 单条笔记的展示字段（含新增字段；上游字段名拼写保留：addInteractiveount / addCollectedCunt）
// 图片/正文：接口返回 coverUrl（封面）与 userHeadUrl（头像）且 100% 覆盖，desc 只有部分条目有。
export function extractNote(article, idx) {
  const anaAdd = article?.anaAdd || {}
  const photoJumpUrl = String(article?.photoJumpUrl || '#').replace(/ /g, '%20')
  const clean = (v, fallback = '') => {
    const s = String(v ?? '').trim()
    return s || fallback
  }
  const link = photoJumpUrl && photoJumpUrl !== '#' ? photoJumpUrl : ''
  return {
    rank: idx + 1,
    title: clean(article?.title, '无标题') || '无标题',
    desc: clean(article?.desc),
    userName: clean(article?.userName, '未知用户') || '未知用户',
    photoJumpUrl: link,
    userUrl: clean(article?.userJumpUrl),
    cover: clean(article?.coverUrl),
    avatar: clean(article?.userHeadUrl),
    publicTime: clean(article?.publicTime),
    noteId: (link.match(/\/explore\/([0-9a-z]+)/i) || [])[1] || '',
    fans: clean(String(article?.fans ?? '0'), '0') || '0',
    interactive: { total: anaAdd.interactiveCount ?? article?.interactiveCount ?? '0', add: anaAdd.addInteractiveount ?? article?.addInteractiveount ?? '0' },
    like: { total: anaAdd.useLikeCount ?? article?.useLikeCount ?? '0', add: anaAdd.addLikeCount ?? '0' },
    comment: { total: anaAdd.useCommentCount ?? article?.useCommentCount ?? '0', add: anaAdd.addCommentCount ?? '0' },
    collected: { total: anaAdd.collectedCount ?? article?.collectedCount ?? '0', add: anaAdd.addCollectedCunt ?? '0' },
    share: { total: anaAdd.useShareCount ?? article?.useShareCount ?? '0', add: anaAdd.addShareCount ?? '0' },
  }
}

export function extractNotes(articles) {
  return (articles || []).map((a, i) => extractNote(a, i))
}

// "查看更多"提示（上游口径：≤20 不展示；>20 且 <50 展示剩余数；=50 固定剩余 30）
export function moreHint(total) {
  if (total <= 20) return ''
  if (total >= 50) return `回复“查看更多”可看剩余30条！✨`
  return `回复“查看更多”可看剩余${total - 20}条！✨`
}
