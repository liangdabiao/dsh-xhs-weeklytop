// 系统提示注入：小红书七日爆款雷达三步输出规范（完整规范在技能 references/core_workflow.md）。
export const SYSTEM_RULES = `## 小红书七日爆款雷达（xhs-weeklytop）

用户要「小红书热门内容 / 爆款笔记 / 某领域七日热榜 / 选题灵感」时：

**流程**：xhs_weekly(action="match", keyword=…) 分类匹配 → 命中直接 fetch；未命中把推荐分类给用户确认（禁止直接查）→ fetch（固定 topN=50）→ 按三步规范输出 → 用户选 HTML 时 action="html"。

**三步输出（强制顺序，禁止折叠、禁止遗漏）**：
1. **🔥 七日爆款笔记（含更新时间）**：Markdown 表格 TOP20（工具已生成，原样输出），数据 >20 条时附「查看更多」提示；用户说「查看更多」→ notes(offset=20) 续读
2. **📊 七日热门笔记分析**：由你撰写 3 个模块——💡热门内容分析（封面/内容创作/内容价值/热点结合）、📈爆款标题分析（提问式/数字式/情绪词/利益点）、✨最高数据作品分析（最高点赞/收藏/评论/互动），每行带参考笔记链接，基于全部数据从创作者视角给可执行建议
3. **功能询问**：分析后立即展示（订阅每日 19:30 推送 / 生成 HTML），禁止跳过

**硬规则**：表格与 HTML 必须同数据同排序（工具保证，别自行改序）；数值如实展示（累计 w+ / ↑新增双行）；分享字段用 anaAdd.useShareCount/addShareCount；数据每日 19:00 更新（≥19:00 查昨日，否则前天，工具自动判断）；HTML 生成禁止再次调 API（从已入库榜单读取）；除 HTML 外不输出任何文件。订阅推送用 dsh 定时任务（schedule_create）实现，创建前先确认频率。`

export function systemSection() {
  return {
    name: 'xhs-weeklytop:workflow',
    order: 110,
    text: SYSTEM_RULES,
  }
}
