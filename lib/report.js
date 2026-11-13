// 小红书风 HTML 报告生成器。移植自 gen_xhs_html.py（红色主题 #ff2442、卡片式、TOP3 奖牌左边框、
// 累计+↑新增双行数据、导出 PDF/图片）。差异：服务端 Node 渲染卡片（不再内嵌 RAW+JS 拼接），
// 统计在服务端算好，导出脚本保留 html2canvas/jsPDF。
import { parseCount, formatNum } from './ranking.js'

const esc = (t) => String(t ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function generateWeeklyHtml(notes, { category = '综合全部', fetchTime = '', topN = 20, rankDate = '' } = {}) {
  // 先截取，确保统计与展示一致（上游口径）
  const list = notes.slice(0, Math.min(topN, 50))
  const total = list.length
  const interactions = list.map((n) => parseCount(n.interactive.total))
  const maxInteractive = interactions.length ? Math.max(...interactions) : 0
  const avgInteractive = total ? Math.round(interactions.reduce((a, b) => a + b, 0) / total) : 0

  const cards = list.map((n, i) => {
    const rank = i + 1
    const cardCls = rank === 1 ? 'note-card top1' : rank === 2 ? 'note-card top2' : rank === 3 ? 'note-card top3' : 'note-card'
    const rankHtml = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank)
    const url = esc(n.photoJumpUrl || '#')
    const avatar = n.avatar ? `<img class="author-avatar" src="${esc(n.avatar)}" onerror="this.style.display='none'">` : ''
    const noteUrl = url && url !== '#' ? `<a href="${url}" data-open-url="${url}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">${esc(n.title)}</a>` : esc(n.title)
    // 封面图（接口 coverUrl 100% 覆盖）与正文摘要（desc 仅部分条目有）
    const cover = n.cover ? `<img class="note-cover" src="${esc(n.cover)}" alt="" loading="lazy" onerror="this.remove()">` : ''
    const desc = n.desc ? `<div class="note-desc">${esc(String(n.desc).slice(0, 220))}</div>` : ''
    const pubTime = n.publicTime ? `<span class="note-time">${esc(String(n.publicTime).slice(0, 10))}</span>` : ''
    const dataItem = (label, totalV, addV) =>
      `<div class="data-item"><span class="data-label">${label}</span><span class="data-value">${esc(formatNum(totalV))}</span><span class="data-add">↑${esc(formatNum(addV))}</span></div>`
    return `
        <div class="${cardCls}" data-open-url="${url}">
            <div class="note-row1">
                <div class="rank-num">${rankHtml}</div>
                ${cover}
                <div class="note-info">
                    <div class="note-title">${noteUrl}</div>
                    <div class="author-info">
                        ${avatar}
                        <span class="author-name">${esc(n.userName)}</span>
                        ${n.fans && n.fans !== '0' ? `<span class="fans-count">·${esc(n.fans)}粉丝</span>` : ''}
                        ${pubTime}
                    </div>
                    ${desc}
                </div>
            </div>
            <div class="note-row2">
                ${dataItem('互动', n.interactive.total, n.interactive.add)}
                ${dataItem('点赞', n.like.total, n.like.add)}
                ${dataItem('评论', n.comment.total, n.comment.add)}
                ${dataItem('收藏', n.collected.total, n.collected.add)}
                ${dataItem('分享', n.share.total, n.share.add)}
            </div>
        </div>`
  }).join('\n')

  const pageTitle = `小红书七日爆款笔记 - ${category}`
  const title = esc(pageTitle)
  const cat = esc(category)
  const time = esc(fetchTime)
  const date = esc(rankDate)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', sans-serif; background: #f5f5f5; color: #333; line-height: 1.5; }
        .page-wrap { max-width: 700px; margin: 0 auto; padding: 12px 12px 24px; }
        .export-bar { position: sticky; top: 0; z-index: 100; display: flex; justify-content: flex-end; gap: 10px; padding: 8px 0 10px; }
        .btn-export-pdf, .btn-export-img { background: #fff; color: #ff2442; border: 1.5px solid #ff2442; border-radius: 20px; padding: 6px 18px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; }
        .btn-export-pdf:hover, .btn-export-img:hover { background: #fff5f6; }
        .pdf-content { background: transparent; }
        .header-wrap { background: linear-gradient(135deg, #ff2442 0%, #ff6b81 100%); border-radius: 12px; padding: 20px 16px; margin-bottom: 12px; color: #fff; }
        .header-wrap h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
        .header-meta { font-size: 13px; opacity: 0.9; }
        .category-badge { display: inline-block; background: rgba(255,255,255,0.25); border-radius: 10px; padding: 1px 10px; font-size: 13px; margin-left: 8px; vertical-align: middle; }
        .stats-row { display: flex; gap: 12px; margin-top: 12px; }
        .stat-item { flex: 1; background: rgba(255,255,255,0.15); border-radius: 8px; padding: 8px 10px; text-align: center; }
        .stat-num { font-size: 18px; font-weight: 700; }
        .stat-label { font-size: 11px; opacity: 0.85; }
        .note-list { display: flex; flex-direction: column; gap: 8px; }
        .note-card { background: #fff; border-radius: 10px; padding: 12px 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); cursor: pointer; transition: transform 0.15s, box-shadow 0.15s; }
        .note-card:hover { transform: translateY(-1px); box-shadow: 0 3px 8px rgba(0,0,0,0.1); }
        .note-card.top1 { border-left: 3px solid #ff2442; }
        .note-card.top2 { border-left: 3px solid #ff6b81; }
        .note-card.top3 { border-left: 3px solid #ffb3c1; }
        .note-row1 { display: flex; gap: 10px; align-items: flex-start; }
        .rank-num { font-size: 16px; font-weight: 800; color: #ff2442; min-width: 30px; text-align: center; line-height: 1.3; }
        .note-card.top1 .rank-num { font-size: 36px; }
        .note-card.top2 .rank-num { font-size: 30px; }
        .note-card.top3 .rank-num { font-size: 26px; }
        .note-info { flex: 1; min-width: 0; }
        .note-cover { width: 58px; height: 76px; border-radius: 6px; object-fit: cover; flex: none; background: #f0f0f0; }
        .note-desc { margin-top: 6px; font-size: 12px; line-height: 1.6; color: #666; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        .note-time { font-size: 11px; color: #bbb; }
        .note-title { font-size: 15px; font-weight: 600; line-height: 1.45; }
        .note-title a { color: #333; text-decoration: none; cursor: pointer; }
        .note-title a:hover { color: #ff2442; }
        .author-info { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
        .author-avatar { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }
        .author-name { font-size: 12px; color: #888; }
        .fans-count { font-size: 11px; color: #bbb; }
        .note-row2 { display: flex; gap: 6px; margin-top: 10px; padding-left: 40px; flex-wrap: wrap; }
        .data-item { flex: 1; min-width: 58px; background: #f9f9f9; border-radius: 6px; padding: 5px 6px; text-align: center; }
        .data-label { display: block; font-size: 10px; color: #999; }
        .data-value { display: block; font-size: 13px; font-weight: 700; color: #333; font-variant-numeric: tabular-nums; }
        .data-add { display: block; font-size: 10px; color: #ff6b81; }
        .footer-note { text-align: center; font-size: 12px; color: #999; padding: 20px 0 8px; }
        @media (max-width: 640px) {
            .note-card { padding: 10px 12px; }
            .note-row2 { padding-left: 0; }
            .data-item { min-width: 52px; }
        }
    </style>
</head>
<body>
<div class="page-wrap">
    <div class="export-bar">
        <button class="btn-export-img" onclick="exportImage()">导出图片</button>
        <button class="btn-export-pdf" onclick="exportPdf()">导出 PDF</button>
    </div>
    <div class="pdf-content" id="pdfContent">
        <div class="header-wrap">
            <h1>📱 小红书七日爆款笔记<span class="category-badge">${cat}</span></h1>
            <div class="header-meta">数据日期：${date} · 生成时间：${time}</div>
            <div class="stats-row">
                <div class="stat-item"><div class="stat-num">${total}</div><div class="stat-label">笔记总数</div></div>
                <div class="stat-item"><div class="stat-num">${esc(formatNum(maxInteractive))}</div><div class="stat-label">最高互动</div></div>
                <div class="stat-item"><div class="stat-num">${esc(formatNum(avgInteractive))}</div><div class="stat-label">平均互动</div></div>
            </div>
        </div>
        <div class="note-list" id="noteList">${cards}</div>
        <div class="footer-note">数据来源：小红书平台 · ${cat} · 七日爆款笔记排行 · redfox.hk API</div>
    </div>
</div>
<script>
function exportImage() {
    var btn = document.querySelector('.btn-export-img');
    btn.textContent = '生成中...'; btn.style.pointerEvents = 'none';
    var target = document.getElementById('pdfContent');
    html2canvas(target, { scale: 2, useCORS: true, backgroundColor: '#f5f5f5', logging: false, windowWidth: target.scrollWidth, windowHeight: target.scrollHeight })
      .then(function(canvas) {
        var link = document.createElement('a');
        link.download = '小红书七日爆款笔记_${cat}_' + new Date().toISOString().slice(0,10) + '.png';
        link.href = canvas.toDataURL('image/png'); link.click();
        btn.textContent = '导出图片'; btn.style.pointerEvents = '';
      }).catch(function(err) { alert('图片生成失败：' + err.message); btn.textContent = '导出图片'; btn.style.pointerEvents = ''; });
}
function exportPdf() {
    var btn = document.querySelector('.btn-export-pdf');
    btn.textContent = '生成中...'; btn.style.pointerEvents = 'none';
    var target = document.getElementById('pdfContent');
    html2canvas(target, { scale: 2, useCORS: true, backgroundColor: '#f5f5f5', logging: false, windowWidth: target.scrollWidth, windowHeight: target.scrollHeight })
      .then(function(canvas) {
        var imgData = canvas.toDataURL('image/jpeg', 0.95);
        var pdf = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
        var pageWidth = pdf.internal.pageSize.getWidth();
        var pageHeight = pdf.internal.pageSize.getHeight();
        var imgWidth = pageWidth - 24;
        var imgHeight = canvas.height * imgWidth / canvas.width;
        var y = 12, remaining = imgHeight;
        pdf.addImage(imgData, 'JPEG', 12, y, imgWidth, imgHeight);
        remaining -= (pageHeight - 24);
        while (remaining > 0) {
            pdf.addPage();
            pdf.addImage(imgData, 'JPEG', 12, 12 - (imgHeight - remaining), imgWidth, imgHeight);
            remaining -= (pageHeight - 24);
        }
        pdf.save('小红书七日爆款笔记_${cat}_' + new Date().toISOString().slice(0,10) + '.pdf');
        btn.textContent = '导出 PDF'; btn.style.pointerEvents = '';
      }).catch(function(err) { alert('PDF 生成失败：' + err.message); btn.textContent = '导出 PDF'; btn.style.pointerEvents = ''; });
}
document.addEventListener('click', function (e) {
    var holder = e.target.closest('[data-open-url]');
    if (!holder) return;
    var url = holder.getAttribute('data-open-url');
    if (!url || url === '#') return;
    // 在 dsh 面板内嵌（srcdoc）时，父页面才有能力开系统浏览器：交给它处理
    if (window.parent && window.parent !== window) {
        e.preventDefault();
        window.parent.postMessage({ type: 'xhs-weeklytop:open-link', url: url }, '*');
    }
});
</script>
</body>
</html>`
}
