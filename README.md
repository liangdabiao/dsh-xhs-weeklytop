# dsh-xhs-weeklytop · 小红书七日爆款雷达

DeepSeek Harness（dsh）插件：**近 7 天小红书热门笔记 TOP50**。24 个垂直分类关键词匹配、19:00 日期规则、互动数/新增双行榜单、小红书风 HTML 报告（导出 PDF/图片）、爆款共性分析，侧栏看板。

移植自 [redfox-data/redfox-community](https://github.com/redfox-data/redfox-community) 的 `skills/xiaohongshu-weeklytop`（Python 全量重写为 Node 原生，**零 Python 依赖**；core_workflow 输出规范完整保留）。
 <img width="2430" height="1194" alt="image" src="https://github.com/user-attachments/assets/875254de-c326-49f0-9ebc-8000ab02ef5d" />


## 解决什么问题

「不知道当下什么内容火、为什么火」的选题难题——按赛道查七日爆款，拆解共性，支撑复盘与创作决策。适用：小红书博主、品牌方、MCN、增长团队。

## 核心规则（上游口径完整保留）

- **24 分类关键词匹配**：最长关键词优先（"旅游攻略"→旅行度假而非出行代步的"旅游"）；**未命中禁止直接查询**——推荐 1~3 个相近分类等用户确认
- **19:00 日期规则**：数据每日 19:00 更新昨日榜单；≥19:00 查昨日，<19:00 查前天（工具自动判断，支持指定日期）
- **排序**：互动数优先（`anaAdd.interactiveCount`，支持 "2w+" 格式）；备用 = 点赞 + 收藏×2 + 评论×3 + 分享×5
- **数据一致性**：表格与 HTML 同数据同排序，排名完全一致（HTML 从已入库榜单读取，禁止再次调 API）
- **三步输出**（agent 按 xiaohongshu-weeklytop 技能执行）：🔥 表格 TOP20（累计+↑新增双行）→ 📊 七日分析 3 模块（热门内容/爆款标题/最高数据作品）→ 功能询问（HTML+订阅）
- **anaAdd 字段名**：`addInteractiveount`/`addCollectedCunt` 是上游 API 的真实拼写（拼错但真实存在），已正确映射

## 工作流

```
xhs_weekly(action="match", keyword="睫毛膏")      → 命中化妆美容（未命中返回推荐，等用户确认）
  → xhs_weekly(action="fetch", category="化妆美容", topN=50)   ← 同步 1 秒
  → 三步输出（表格 TOP20 → 分析 → 功能询问）；「查看更多」→ notes(offset=20)
  → xhs_weekly(action="html", top=20/50)           ← 小红书风 HTML，导出 PDF/图片
```

## 面板（侧栏「小红书七日爆款雷达」）

- **概览**：24 分类按钮直选 + 榜单历史卡片（卡片上直接有「📄 打开报告」入口）；「去对话做选题分析」开新对话
- **报告**：报告库页，按榜单列出所有已生成的 HTML 报告，「打开报告」在面板内覆盖层查看（支持导出 PDF/图片）
- **榜单页**：小红书风笔记卡片（封面图 + 头像 + 标题 + 正文摘要 + 发布时间 + 互动/点赞/评论/收藏/分享双行数据）、查看更多（TOP20→50）、打开/生成 HTML 报告、去对话写七日分析
- **可点开原文**：封面、标题、正文、箭头都能点，经宿主 `POST /api/open` 用系统默认浏览器打开（iframe 里 `window.open` 会被桌面端 deny）
- **图片**：封面/头像走宿主 `GET /api/img?u=` 代理（同源字节，绕开 CSP 与 CDN 防盗链）；宿主未重启时自动回落 CDN 直连
- **设置**：RedFox API Key、代理、接口地址

> ⚠️ 桌面端 dsh 的 WebContentsView 会 deny `window.open`/`target=_blank`（只有 https 链接交给系统浏览器），
> 所以报告**不能**用新窗口打开：面板改为同源 fetch 报告 HTML → `iframe.srcdoc` 在覆盖层里渲染；
> 报告里的链接点击则 `postMessage` 回面板，统一走 `/api/open`。
> 报告是否存在由 `meta.has_report`（宿主）给出，宿主未重启时面板用 `HEAD /api/boards/<id>/report` 探测兜底。
> `/api/open`、`/api/img` 是宿主路由：改完要**重启一次 dsh** 才生效（`lab/` 静态文件改完刷新面板即可）。

## 配置

**RedFox API Key**（必需，`ak_` 开头）：[红狐 hub](https://redfox.hk/settings/api-keys?source=github) 获取。优先级：插件配置 `apiKey` > 面板「设置」页 > 环境变量 `REDFOX_API_KEY`。

> ✅ 2026-11-12 实测：该接口**免费积分可用**，1 秒返回 50 条真实爆款笔记。

## 开发

```bash
npm i
npm run build      # client.js → dist/client.js
npm test           # 12 个单测（分类匹配/日期规则/互动排序/字段映射/报告生成/工具全链路）
npm run smoke      # 离线冒烟：本地假 RedFox 服务器全链路（工具 + 面板 API）
npm run live       # 真实 API 冒烟：node scripts/live.mjs <分类> ak_xxx
npm run dev        # 面板独立预览：DSH_HOME=<目录> node scripts/devserver.mjs 5182
```

数据落在 `$DSH_HOME/xhs-weeklytop/`：`settings.json` + `boards/<bid>/`（raw 原始响应/meta/report.html；同分类+同日期覆盖），原子写。

## 结构

```
src/host.js            xhs_weekly 工具（match/fetch/notes/html/history）+ 表格渲染
src/systemPrompt.js    三步输出规范注入
lib/categories.js      24 分类关键词映射 + 最长词匹配 + 相关度推荐
lib/redfox.js          GET 传输（代理隧道）+ 错误码翻译
lib/ranking.js         19:00 日期规则 + 互动排序 + anaAdd 字段提取 + moreHint 口径
lib/report.js          小红书风 HTML（奖牌/双行数据/导出 PDF 图片）
lib/store.js           boards/<bid> 持久化 + 设置
lib/api.js             /xhs-weeklytop 面板路由
client.js / lab/       浏览器半边（侧栏入口 + iframe 面板，明暗跟随 dsh 主题）
skills/xiaohongshu-weeklytop/  方法论技能（SKILL.md + 上游 core_workflow 参考）
```

## License

MIT（本插件代码）。方法论与 API 用例参考 redfox-data/redfox-community skills/xiaohongshu-weeklytop（上游未附许可证文件，仅作技术参考）；RedFox API 使用受其服务条款约束。
