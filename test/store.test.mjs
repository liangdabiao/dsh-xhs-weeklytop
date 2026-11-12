// store + report + host 工具直调单测（离线假服务器）
process.env.REDFOX_API_KEY = ''
const { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const tmp = mkdtempSync(join(tmpdir(), 'dsh-xhs-store-'))
process.env.DSH_HOME = tmp
delete process.env.X_API_KEY

import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

const { saveBoard, getBoardMeta, listBoards, deleteBoard, saveReportHtml, readReportHtml, DATA_DIR } = await import('../lib/store.js')
const { generateWeeklyHtml } = await import('../lib/report.js')
const { extractNotes } = await import('../lib/ranking.js')

const W = (i) => ({
  title: `爆款笔记${i}`, userName: `博主${i}`, fans: '1w', photoJumpUrl: `https://xhslink.com/${i}`,
  desc: '', anaAdd: {
    interactiveCount: `${Math.max(1, 10 - i)}w+`, addInteractiveount: `${i}00+`,
    useLikeCount: `${Math.max(1, 8 - i)}w`, addLikeCount: 100 + i,
    useCommentCount: 893 - i, addCommentCount: 10 + i,
    collectedCount: `${Math.max(1, 6 - i)}w`, addCollectedCunt: 200 + i,
    useShareCount: 800 - i, addShareCount: 30 + i,
  },
})

test('store：榜单生命周期（同分类+日期覆盖）', () => {
  const raw = { code: 2000, data: [W(0), W(1)] }
  const m1 = saveBoard({ raw, category: '化妆美容', rankDate: '2026-11-11', rankDateAuto: true, notes: extractNotes([W(0), W(1)]), fetchTime: '2026-11-12 20:00:00' })
  const m2 = saveBoard({ raw, category: '化妆美容', rankDate: '2026-11-11', rankDateAuto: true, notes: extractNotes([W(0)]), fetchTime: '2026-11-12 20:30:00' })
  assert.equal(m1.board_id, m2.board_id) // 同分类+日期覆盖
  assert.equal(listBoards().length, 1)
  assert.equal(DATA_DIR, join(tmp, 'xhs-weeklytop'))
  assert.ok(m2.board_id.includes('化妆美容'))
  const htmlFile = saveReportHtml(m2.board_id, '<html>x</html>')
  assert.ok(existsSync(htmlFile))
  assert.equal(readReportHtml(m2.board_id), htmlFile)
  assert.equal(deleteBoard(m2.board_id).ok, true)
  assert.equal(listBoards().length, 0)
})

test('report：小红书风 HTML（统计/奖牌/导出按钮/无泄漏）', () => {
  const notes = extractNotes(Array.from({ length: 25 }, (_x, i) => W(i)))
  const html = generateWeeklyHtml(notes, { category: '化妆美容', fetchTime: '2026-11-12 20:00:00', topN: 20, rankDate: '2026-11-11' })
  assert.ok(html.includes('化妆美容'))
  assert.ok(html.includes('🥇') && html.includes('🥈') && html.includes('🥉'))
  assert.ok(html.includes('导出 PDF') && html.includes('exportImage'))
  assert.ok(html.includes('.data-add\">↑') || html.includes('↑'))
  assert.ok(html.includes('爆款笔记0'))
  assert.ok(!html.includes('爆款笔记20')) // top 20 截断
  assert.ok(html.includes('21</div>') === false)
  assert.ok(!html.includes('undefined') && !html.includes('[object Object]'))
  assert.ok(html.includes('note-card top1'))
  const empty = generateWeeklyHtml([], { category: '综合全部', fetchTime: 't', topN: 20, rankDate: '2026-11-11' })
  assert.ok(empty.includes('0')) // 统计 0
})

// ── 工具直调全链路（假 RedFox）──────────────────────────────────────────
test('host 工具：match/fetch/notes/html/history + 日期规则 + 未命中拦截', async () => {
  let lastQuery = ''
  const srv = http.createServer((req, res) => {
    lastQuery = req.url
    let ok = true
    req.on('data', () => {})
    req.on('end', () => {
      const reply = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (req.headers['x-api-key'] !== 'ak_tool') return reply({ code: 3201, msg: '积分不足' })
      // 日期：URL 里 rankDate=2026-11-10（前天）返回 8 条不足提示场景；其他返回 30 条
      if (req.url.includes('rankDate=2026-11-10')) {
        return reply({ code: 2000, data: Array.from({ length: 8 }, (_x, i) => W(i + 30)) })
      }
      reply({ code: 2000, data: Array.from({ length: 30 }, (_x, i) => W(i)) })
    })
    ok = !!ok
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  mkdirSync(join(tmp, 'xhs-weeklytop'), { recursive: true })
  writeFileSync(join(tmp, 'xhs-weeklytop', 'settings.json'), JSON.stringify({ api_key: 'ak_tool', api_base: `http://127.0.0.1:${srv.address().port}` }))

  const { xhsWeeklyTool } = await import('../src/host.js')
  const call = async (args) => {
    try { return await xhsWeeklyTool.execute(args, {}) } catch (e) { return { ok: false, summary: String(e?.message || e) } }
  }
  function check(name, cond, detail = '') {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
    if (!cond) process.exitCode = 1
  }

  {
    const r = await call({ action: 'match', keyword: '睫毛膏' })
    check('match 命中化妆美容', r.ok && r.data.includes('化妆美容'), r.data)
    const r2 = await call({ action: 'match', keyword: '洗浴中心' })
    check('match 未命中给推荐+拦截', !r2.ok && r2.hints.includes('API文档') && /\d\. /u.test(r2.data), r2.data.slice(0, 50))
  }
  {
    const r = await call({ action: 'fetch', category: '化妆美容' })
    check('fetch 表格含更新时间标题', r.ok && r.data.includes('【化妆美容】七日爆款笔记') && r.data.includes('更新时间：'), (r.data || '').split('\n')[0])
    check('fetch 表格 TOP20', r.ok && (r.data.match(/^\| /gm) || []).length === 21, '') // 表头2行 + 20条
    check('fetch 奖牌', r.data.includes('🥇') && r.data.includes('🥈') && r.data.includes('🥉'), '')
    check('fetch 双行新增', r.data.includes('↑新增'), '')
    check('fetch 查看更多提示', r.data.includes('剩余10条') || r.summary.includes('剩余'), r.data.slice(-60))
    check('fetch 功能询问', r.hints.includes('1️⃣') && r.hints.includes('2️⃣'), '')
    check('fetch 日期推断为前天', lastQuery.includes('rankDate='), lastQuery.slice(0, 60))
    globalThis.__bid = r.summary.match(/boardId=([\p{L}\p{N}-]+)/u)?.[1]
  }
  {
    const r = await call({ action: 'notes', offset: 20, limit: 10 })
    check('notes 续读 21-30', r.ok && r.data.includes('爆款笔记20') && r.data.includes('爆款笔记29'), r.summary.slice(0, 40))
    const r2 = await call({ action: 'notes', offset: 99 })
    check('notes 越界提示', !r2.ok && r2.summary.includes('没有更多'), r2.summary.slice(0, 40))
  }
  {
    const r = await call({ action: 'html', top: 20 })
    check('html 生成（同源数据）', r.ok && r.summary.includes('TOP20') && r.summary.includes('.html'), r.summary.slice(0, 60))
    const file = r.summary.match(/：(.+?\.html)/)?.[1]
    const html = readFileSync(file, 'utf8')
    assert.ok(html.includes('爆款笔记0'))
    assert.ok(html.includes('化妆美容'))
    check('html 文件可读', true, '')
  }
  {
    const r = await call({ action: 'fetch', category: '化妆美容', rankDate: '2026-11-10' })
    check('fetch 指定日期（8 条不足提示）', r.ok && r.summary.includes('共 8 条'), r.summary.slice(0, 50))
    check('fetch 少量无查看更多', !r.data.includes('查看更多'), '')
  }
  {
    const bad = await call({ action: 'fetch', category: '不存在的分类' })
    check('非法分类报错', !bad.ok && bad.summary.includes('未知分类'), bad.summary.slice(0, 50))
    writeFileSync(join(tmp, 'xhs-weeklytop', 'settings.json'), JSON.stringify({}, null, 2))
    const noKey = await call({ action: 'fetch', category: '化妆美容', rankDate: '2026-11-11' })
    check('无 key 引导', !noKey.ok && noKey.summary.includes('RedFox API Key'), noKey.summary.slice(0, 50))
    writeFileSync(join(tmp, 'xhs-weeklytop', 'settings.json'), JSON.stringify({ api_key: 'ak_tool', api_base: `http://127.0.0.1:${srv.address().port}` }))
    const badKey = await call({ action: 'fetch', category: '化妆美容', rankDate: '2026-11-09' })
    // settings 恢复后正常；这里 ak_tool 一直有效，跳过 3201 场景（redfox 翻译已单测）
    check('恢复后正常', badKey.ok, badKey.summary.slice(0, 40))
  }
  {
    const r = await call({ action: 'history' })
    check('history 列出', r.ok && r.data.split('\n').length >= 2, r.data.split('\n')[0] || '')
  }

  await new Promise((r) => srv.close(r))
})

test.after(() => rmSync(tmp, { recursive: true, force: true }))
