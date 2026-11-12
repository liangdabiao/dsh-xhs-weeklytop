// 技能快照提供方（xiaohongshu-weeklytop：小红书七日爆款笔记方法论）。
// 与 stock-research 同款：解析 SKILL.md frontmatter，get 时追加 DSH 环境说明。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RANK = 600
const INVOCATION = { modelInvocable: true, userInvocable: true }

function parse(file) {
  const text = readFileSync(file, 'utf8')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return null
  const block = m[1]
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim()
  const descM = block.match(/^description:\s*(.+)$/m)?.[1]
  let description = descM ? descM.trim().replace(/^(["'])(.*)\1$/, '$2') : null
  if (!description) {
    const lines = block.split(/\r?\n/)
    const start = lines.findIndex((l) => /^description:\s*>/.test(l))
    if (start !== -1) {
      const collected = []
      for (let i = start + 1; i < lines.length; i++) {
        if (/^\S/.test(lines[i])) break
        collected.push(lines[i].replace(/^\s+/, ''))
      }
      description = collected.join(' ').trim()
    }
  }
  if (!name || !description) return null
  return { name, description, body: text.slice(m[0].length) }
}

function readDir(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const sDir = join(dir, entry.name)
    const skillFile = join(sDir, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    const parsed = parse(skillFile)
    if (!parsed) continue
    const auxFiles = readdirSync(sDir).filter((f) => f.endsWith('.md') && f !== 'SKILL.md')
    out.push({ dir: sDir, file: skillFile, ...parsed, dirName: entry.name, auxFiles })
  }
  return out
}

function addendum(skill) {
  return [
    '',
    '---',
    '',
    '## 在 DSH 插件里使用',
    '',
    `- 本技能目录：\`${skill.dir}\`；附属 .md 文件用文件读取工具按需加载。`,
    '- xhs_weekly 工具负责分类匹配/榜单查询/HTML 报告；七日分析 3 模块与三步输出由你完成（按 xiaohongshu-weeklytop 技能规范）。',
    '- 表格与 HTML 必须同数据同排序；数值如实展示（累计 w+ / ↑新增双行）；除 HTML 外不输出任何文件。',
    '',
  ].join('\n')
}

export function createSkillProvider(dirs) {
  const list = [].concat(dirs)
  const candidate = (s, auxFiles) => ({
    name: s.name,
    description: s.description,
    path: s.file,
    invocation: INVOCATION,
    source: 'bundled',
    provider: "xhs-weeklytop",
    rank: RANK,
    locator: s.dir,
    resourceBase: { kind: 'directory', path: s.dir },
    auxFiles,
  })

  return {
    name: "xhs-weeklytop",
    async list() {
      return list.flatMap(readDir).map((s) => {
        const c = candidate(s, s.auxFiles)
        const { auxFiles, ...rest } = c
        return rest
      })
    },
    async get(c) {
      const s = list.flatMap(readDir).find((x) => x.dir === c.locator && x.name === c.name)
      if (!s) return undefined
      const content = s.body + addendum(s)
      const { rank, locator, auxFiles, ...summary } = candidate(s, s.auxFiles)
      return { ...summary, content, auxFiles }
    },
  }
}

export { readDir, addendum }
