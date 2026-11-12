// 小红书七日爆款雷达 · 数据层。
//   $DSH_HOME/xhs-weeklytop/
//   ├── settings.json        api_key / api_base(测试用)
//   ├── boards/index.json    榜单索引（新→旧）
//   └── boards/<bid>/
//       ├── raw.json         原始 API 响应（数据一致性：表格与 HTML 同源）
//       ├── meta.json        分类/日期/统计
//       └── report.html      小红书风 HTML 报告
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, normalize } from 'node:path'

export const DATA_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'xhs-weeklytop')
const BOARDS_DIR = join(DATA_DIR, 'boards')
const INDEX_FILE = join(BOARDS_DIR, 'index.json')
const SETTINGS_FILE = join(DATA_DIR, 'settings.json')

const nowIso = () => new Date().toISOString()

function readJson(file, fallback = null) {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  mkdirSync(BOARDS_DIR, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

export function getSettings() {
  return readJson(SETTINGS_FILE, {}) || {}
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch, updated_at: nowIso() }
  writeJson(SETTINGS_FILE, next)
  return next
}

function boardDir(bid) {
  const safe = String(bid).replace(/[^\p{L}\p{N}_-]+/gu, '')
  if (!safe || safe !== String(bid)) throw new Error('非法榜单 id')
  const dir = join(BOARDS_DIR, safe)
  if (normalize(dir) !== normalize(join(BOARDS_DIR, safe))) throw new Error('非法榜单 id')
  return dir
}

function makeBoardId(category, rankDate) {
  const ts = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const cat = String(category).replace(/[^\p{L}\p{N}]+/gu, '')
  return `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}${String(ts.getMilliseconds()).padStart(3, '0')}-${cat}-${rankDate}`
}

function getBoardIndex() {
  return readJson(INDEX_FILE, []) || []
}

export function saveBoard({ raw, category, rankDate, rankDateAuto, notes, fetchTime }) {
  // 同 分类+日期 覆盖旧榜单（重复查询同一天时保持简洁）
  const prev = getBoardIndex().find((i) => i.category === category && i.rank_date === rankDate)
  const bid = prev ? prev.board_id : makeBoardId(category, rankDate)
  const dir = boardDir(bid)
  mkdirSync(dir, { recursive: true })
  writeJson(join(dir, 'raw.json'), raw)
  const meta = {
    board_id: bid,
    category,
    rank_date: rankDate,
    rank_date_auto: rankDateAuto,
    total: notes.length,
    fetch_time: fetchTime,
    created_at: nowIso(),
  }
  writeJson(join(dir, 'meta.json'), meta)
  const index = getBoardIndex().filter((i) => i.board_id !== bid)
  index.unshift({ board_id: bid, category, rank_date: rankDate, total: notes.length, created_at: meta.created_at })
  writeJson(INDEX_FILE, index.slice(0, 100))
  return meta
}

export function getBoardMeta(bid) {
  return readJson(join(boardDir(bid), 'meta.json'))
}

export function getBoardRaw(bid) {
  return readJson(join(boardDir(bid), 'raw.json'))
}

export function listBoards({ limit = 50 } = {}) {
  return getBoardIndex().slice(0, limit)
}

export function saveReportHtml(bid, html) {
  const dir = boardDir(bid)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'report.html')
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, html, 'utf8')
  renameSync(tmp, file)
  return file
}

export function readReportHtml(bid) {
  const file = join(boardDir(bid), 'report.html')
  return existsSync(file) ? file : null
}

export function deleteBoard(bid) {
  const dir = boardDir(bid)
  if (!existsSync(dir)) return { ok: false, error: `榜单不存在: ${bid}` }
  rmSync(dir, { recursive: true, force: true })
  writeJson(INDEX_FILE, getBoardIndex().filter((i) => i.board_id !== bid))
  return { ok: true }
}
