// 面板数据面：/xhs-weeklytop 前缀路由（分类列表 + 榜单查询 + 报告 + 设置；三步输出走 agent 对话）。
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listBoards, deleteBoard, getSettings, saveSettings, getBoardMeta, getBoardRaw, saveReportHtml, readReportHtml, DATA_DIR } from './store.js'
import { fetchWeeklyData, resolveApiKey, resolveApiBase } from './redfox.js'
import { getQueryDate, extractArticles, sortArticles, extractNotes } from './ranking.js'
import { ALL_CATEGORIES } from './categories.js'
import { generateWeeklyHtml } from './report.js'

const BASE = '/xhs-weeklytop'
const LAB = fileURLToPath(new URL('../lab/', import.meta.url))

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
}

function json(res, statusCode, value) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return false
  return connection.requestRejection({ headers: req.headers })
}

function safeFile(dir, rel) {
  if (!dir || String(rel).split('/').some((p) => p.startsWith('.'))) return null
  let base
  try { base = realpathSync(dir) } catch { return null }
  const file = normalize(join(base, rel))
  if (!file.startsWith(base + sep) || !existsSync(file)) return null
  const real = realpathSync(file)
  return real.startsWith(base + sep) && statSync(real).isFile() ? real : null
}

function serveFile(req, res, file) {
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': 'no-cache',
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

function readJson(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const origin = req.headers.origin
    if (req.method !== 'POST') return reject(Object.assign(new Error('method'), { status: 405 }))
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('type'), { status: 415 }))
    if (origin && origin.replace(/^https?:\/\//, '') !== req.headers.host) return reject(Object.assign(new Error('origin'), { status: 403 }))
    let size = 0
    const chunks = []
    req.on('data', (c) => { size += c.length; if (size > max) req.destroy(); else chunks.push(c) })
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (e) { reject(Object.assign(e, { status: 400 })) } })
    req.on('error', reject)
  })
}

function readVersion() {
  try { return JSON.parse(readFileSync(join(LAB, '..', 'package.json'), 'utf8')).version } catch { return '' }
}

function catalog() {
  const settings = getSettings()
  return {
    version: readVersion(),
    dataDir: DATA_DIR,
    has_key: Boolean(settings.api_key || process.env.REDFOX_API_KEY),
    key_source: settings.api_key ? 'settings' : (process.env.REDFOX_API_KEY ? 'env' : 'none'),
    categories: ALL_CATEGORIES,
    boards: listBoards({ limit: 50 }),
    settings: { proxy_url: settings.proxy_url || '', api_base: settings.api_base || '' },
  }
}

export function registerApi(ctx, hooks = {}) {
  return ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    async handler(req, res) {
      try {
        const rejection = requestRejection(ctx, req)
        if (typeof rejection === 'number') return json(res, rejection, { error: '未授权' })

        const url = new URL(req.url, 'http://x')
        if (!url.pathname.startsWith(BASE + '/') && url.pathname !== BASE) return json(res, 404, { error: 'not found' })
        const path = decodeURIComponent(url.pathname.slice(BASE.length)) || '/'

        if (path === '/api/catalog' && req.method === 'GET') return json(res, 200, catalog())

        if (path === '/api/boards' && req.method === 'GET') return json(res, 200, { boards: listBoards({ limit: 100 }) })

        if (path === '/api/boards' && req.method === 'POST') {
          try {
            const body = await readJson(req)
            const category = body.category && ALL_CATEGORIES.includes(body.category) ? body.category : null
            if (!category) return json(res, 400, { ok: false, error: `category 必须是 24 个分类之一（${ALL_CATEGORIES.length} 个）` })
            const settings = getSettings()
            const apiKey = resolveApiKey({ settings, config: hooks.config })
            if (!apiKey) return json(res, 400, { ok: false, error: '未配置 RedFox API Key（设置页或插件配置/环境变量 REDFOX_API_KEY）' })
            const { saveBoard } = await import('./store.js')
            const { date, auto, reason } = getQueryDate(body.rankDate)
            const raw = await fetchWeeklyData({
              rankDate: date, category, apiKey, apiBase: resolveApiBase({ settings }),
              proxyUrl: hooks.config?.proxyUrl || settings.proxy_url || '',
            })
            const articles = sortArticles(extractArticles(raw?.data), 50)
            const notes = extractNotes(articles).map((n) => ({ ...n, category }))
            const fetchTime = new Date().toISOString().slice(0, 19).replace('T', ' ')
            const meta = saveBoard({ raw, category, rankDate: date, rankDateAuto: auto, notes, fetchTime })
            return json(res, 200, { ok: true, board: meta, date_reason: reason, notes })
          } catch (e) { return json(res, e.status || 400, { ok: false, error: e.message }) }
        }

        const bMatch = path.match(/^\/api\/boards\/([^/]+)(\/.*)?$/)
        if (bMatch) {
          const bid = bMatch[1]
          const sub = bMatch[2] || ''
          const meta = getBoardMeta(bid)
          if (!meta) return json(res, 404, { error: `榜单不存在: ${bid}` })
          if (!sub && req.method === 'GET') {
            const raw = getBoardRaw(bid)
            const notes = extractNotes(sortArticles(extractArticles(raw?.data), 50))
            return json(res, 200, { board: meta, notes })
          }
          if (!sub && req.method === 'DELETE') return json(res, 200, deleteBoard(bid))
          if (sub === '/report' && (req.method === 'GET' || req.method === 'HEAD')) {
            const file = readReportHtml(bid)
            if (!file) return json(res, 404, { error: '报告还没生成——在对话里让 agent 跑 xhs_weekly(action="html")，或点面板「生成 HTML」' })
            return serveFile(req, res, file)
          }
          if (sub === '/report' && req.method === 'POST') {
            try {
              const body = await readJson(req).catch(() => ({}))
              const raw = getBoardRaw(bid)
              const notes = extractNotes(sortArticles(extractArticles(raw?.data), 50))
              const top = Math.min(Math.max(Number(body.top) || 20, 1), 50)
              const html = generateWeeklyHtml(notes, { category: meta.category, fetchTime: meta.fetch_time, topN: top, rankDate: meta.rank_date })
              const file = saveReportHtml(bid, html)
              return json(res, 200, { ok: true, file, top })
            } catch (e) { return json(res, e.status || 400, { ok: false, error: e.message }) }
          }
          return json(res, 404, { error: 'not found' })
        }

        if (path === '/api/settings' && req.method === 'GET') {
          const settings = getSettings()
          const key = String(settings.api_key || '')
          return json(res, 200, {
            settings: {
              has_key: Boolean(key || process.env.REDFOX_API_KEY),
              key_tail: key ? key.slice(-6) : '',
              from_env: Boolean(process.env.REDFOX_API_KEY),
              proxy_url: settings.proxy_url || '',
              api_base: settings.api_base || '',
            },
          })
        }
        if (path === '/api/settings' && req.method === 'POST') {
          try {
            const body = await readJson(req)
            const patch = {}
            if (body.api_key !== undefined) {
              const key = String(body.api_key).trim()
              if (key && !key.startsWith('ak_')) return json(res, 400, { ok: false, error: 'RedFox API Key 以 ak_ 开头，请检查' })
              patch.api_key = key
            }
            if (body.proxy_url !== undefined) patch.proxy_url = String(body.proxy_url).trim()
            if (body.api_base !== undefined) patch.api_base = String(body.api_base).trim()
            const next = saveSettings(patch)
            return json(res, 200, { ok: true, has_key: Boolean(next.api_key || process.env.REDFOX_API_KEY) })
          } catch (e) { return json(res, e.status || 400, { ok: false, error: e.message }) }
        }
        if (path.startsWith('/api/')) return json(res, 404, { error: 'not found' })

        if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method' })
        const file = safeFile(LAB, path === '/' ? 'index.html' : path.replace(/^\/+/, ''))
        return file ? serveFile(req, res, file) : json(res, 404, { error: 'not found' })
      } catch (err) {
        json(res, 500, { error: err?.message || '内部错误' })
      }
    },
  })
}
