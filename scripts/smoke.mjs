// 冒烟测试（离线）：假 RedFox 服务器 + 工具直调全链路 + 面板 API 全路由。
// 运行：npm run smoke
const { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const http = await import('node:http')

const tmp = mkdtempSync(join(tmpdir(), 'dsh-xhs-smoke-'))
process.env.DSH_HOME = tmp
delete process.env.REDFOX_API_KEY
delete process.env.X_API_KEY

let failed = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  if (!cond) failed++
}

const W = (i) => ({
  title: `爆款笔记${i}`, userName: `博主${i}`, fans: '1w', photoJumpUrl: `https://xhslink.com/${i}`,
  desc: '内容描述', anaAdd: {
    interactiveCount: `${Math.max(1, 10 - i)}w+`, addInteractiveount: `${i}00+`,
    useLikeCount: `${Math.max(1, 8 - i)}w`, addLikeCount: 100 + i,
    useCommentCount: 893 - i, addCommentCount: 10 + i,
    collectedCount: `${Math.max(1, 6 - i)}w`, addCollectedCunt: 200 + i,
    useShareCount: 800 - i, addShareCount: 30 + i,
  },
})

const srv = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const reply = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.headers['x-api-key'] !== 'ak_smoke') return reply({ code: 3201, msg: '积分不足' })
    reply({ code: 2000, data: Array.from({ length: 50 }, (_x, i) => W(i)) })
  })
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
mkdirSync(join(tmp, 'xhs-weeklytop'), { recursive: true })
writeFileSync(join(tmp, 'xhs-weeklytop', 'settings.json'), JSON.stringify({ api_key: 'ak_smoke', api_base: `http://127.0.0.1:${srv.address().port}` }))

// ── 工具直调 ──
const { xhsWeeklyTool } = await import('../src/host.js')
const call = async (args) => {
  try { return await xhsWeeklyTool.execute(args, {}) } catch (e) { return { ok: false, summary: String(e?.message || e) } }
}
let bid
{
  const r = await call({ action: 'match', keyword: '美妆教程' })
  check('match 命中', r.ok && r.data.includes('化妆美容'), r.data)
  const r2 = await call({ action: 'fetch', keyword: '完全无关词xyzq' })
  check('fetch 未命中拦截（不调 API）', !r2.ok && r2.hints.includes('API文档'), r2.data.slice(0, 50))
}
{
  const r = await call({ action: 'fetch', category: '化妆美容', topN: 50 })
  check('fetch 50 条入库', r.ok && r.summary.includes('共 50 条'), r.summary.slice(0, 50))
  check('fetch 表格 TOP20 + 提示剩余30', (r.data.match(/^\| /gm) || []).length === 21 && r.data.includes('剩余30条'), '')
  check('fetch 双行格式', r.data.includes('↑新增'), '')
  bid = r.summary.match(/boardId=([\p{L}\p{N}-]+)/u)?.[1]
}
{
  const r = await call({ action: 'html', boardId: bid, top: 20 })
  check('html 生成', r.ok && r.summary.includes('.html'), r.summary.slice(0, 50))
  const file = r.summary.match(/：(.+?\.html)/)?.[1]
  const html = file ? readFileSync(file, 'utf8') : ''
  check('HTML 小红书风元素', html.includes('note-card top1') && html.includes('🥇') && html.includes('导出 PDF'), '')
  check('HTML 与表格同源 TOP20', html.includes('爆款笔记0') && !html.includes('爆款笔记20'), '')
  check('HTML 无泄漏', !html.includes('undefined') && !html.includes('[object Object]'), '')
  const r2 = await call({ action: 'html', boardId: bid, top: 50 })
  check('html 查看更多后全量', r2.ok && r2.summary.includes('TOP50'), r2.summary.slice(0, 40))
  const html2 = readFileSync(r2.summary.match(/：(.+?\.html)/)?.[1], 'utf8')
  check('HTML 50 条覆盖', html2.includes('爆款笔记49'), '')
}
{
  const r = await call({ action: 'history' })
  check('history 单条（覆盖）', r.ok && r.data.split('\n').length === 1, r.data)
}

// ── 面板 API ──
const { registerApi } = await import('../lib/api.js')
const { Writable } = await import('node:stream')
const { EventEmitter } = await import('node:events')
const routes = {}
registerApi({ get: () => undefined, webServer: { register: (r) => { routes[r.path] = r.handler } } }, { config: {} })
const req = async (method, path, body) => {
  const reqObj = new EventEmitter()
  reqObj.method = method
  reqObj.url = `/xhs-weeklytop${path}`
  reqObj.headers = body ? { 'content-type': 'application/json', host: 'x', origin: 'http://x' } : { host: 'x' }
  const chunks = []
  const resObj = new Writable({ write(c, _e, cb) { chunks.push(c); cb() } })
  resObj.statusCode = 0
  resObj.writeHead = (code) => { resObj.statusCode = code }
  const done = new Promise((resolve) => {
    const origEnd = resObj.end.bind(resObj)
    resObj.end = (...args) => { origEnd(...args); resolve({ status: resObj.statusCode, json: (() => { try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return null } })() }) }
  })
  const p = routes['/xhs-weeklytop'](reqObj, resObj)
  if (body) reqObj.emit('data', Buffer.from(JSON.stringify(body)))
  reqObj.emit('end')
  await p
  return done
}
{
  const cat = await req('GET', '/api/catalog')
  check('catalog：24 分类/key/榜单', cat.status === 200 && cat.json.categories.length === 24 && cat.json.has_key && cat.json.boards.length >= 1, '')
  const one = await req('GET', `/api/boards/${bid}`)
  check('board 详情 50 notes', one.status === 200 && one.json.notes.length === 50, `n=${one.json?.notes?.length}`)
  const created = await req('POST', '/api/boards', { category: '美味佳肴' })
  check('面板直查新分类', created.status === 200 && created.json.ok && created.json.notes.length === 50, '')
  const badCat = await req('POST', '/api/boards', { category: '不存在的' })
  check('非法分类 400', badCat.status === 400, '')
  const rawReport = await req('POST', `/api/boards/${bid}/report`, { top: 30 })
  check('面板直出报告 TOP30', rawReport.status === 200 && rawReport.json.ok && rawReport.json.top === 30, '')
  const del = await req('DELETE', `/api/boards/${bid}`)
  check('面板删榜单', del.status === 200 && del.json.ok, '')
}
{
  const st = await req('GET', '/api/settings')
  check('settings 尾号', st.status === 200 && st.json.settings.key_tail === '_smoke', String(st.json.settings.key_tail))
  const bad = await req('POST', '/api/settings', { api_key: 'no-prefix' })
  check('settings 非 ak_ 拒绝', bad.status === 400, '')
}
{
  const idx = readFileSync(new URL('../lab/index.html', import.meta.url), 'utf8')
  check('lab 引用 scheme/app', idx.includes('app.js') && idx.includes('scheme.js'), '')
  const appjs = readFileSync(new URL('../lab/app.js', import.meta.url), 'utf8')
  check('lab 消息类型与 client 对齐', appjs.includes('xhs-weeklytop:refresh') && appjs.includes('xhs-weeklytop:start-ok'), '')
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  check('client 消息类型一致', client.includes('xhs-weeklytop:refresh') && client.includes('xhs-weeklytop:start-ok'), '')
}

srv.close()
rmSync(tmp, { recursive: true, force: true })
console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
