// 真实网络冒烟：查「化妆美容」分类真实榜单（自动日期推断），打印样例并生成 HTML。
//   DSH_HOME=<目录> node scripts/live.mjs [category] [ak_xxx]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , catArg, keyArg] = process.argv
const category = catArg || '化妆美容'
const home = process.env.DSH_HOME || join(process.env.HOME || process.env.USERPROFILE, '.dsh')

if (keyArg) {
  mkdirSync(join(home, 'xhs-weeklytop'), { recursive: true })
  writeFileSync(join(home, 'xhs-weeklytop', 'settings.json'), JSON.stringify({ api_key: keyArg }, null, 2))
  console.log('API key 已写入 settings.json')
}
const { getSettings } = await import('../lib/store.js')
if (!getSettings().api_key && !process.env.REDFOX_API_KEY) {
  console.error('缺少 RedFox API Key：node scripts/live.mjs <分类> ak_xxx')
  process.exit(1)
}

const { xhsWeeklyTool } = await import('../src/host.js')
const call = (args) => xhsWeeklyTool.execute(args, {})

console.log(`真实查询：「${category}」七日爆款（自动日期推断）`)
const t0 = Date.now()
const r = await call({ action: 'fetch', category, topN: 50 })
console.log(`\n[${Math.round((Date.now() - t0) / 1000)}s] ${r.summary}`)
if (r.data) console.log('\n' + r.data.split('\n').slice(0, 16).join('\n') + '\n…')
if (r.ok) {
  const bid = r.summary.match(/boardId=([\p{L}\p{N}-]+)/u)?.[1]
  const rep = await call({ action: 'html', boardId: bid, top: 20 })
  console.log(`\n${rep.summary}`)
}
