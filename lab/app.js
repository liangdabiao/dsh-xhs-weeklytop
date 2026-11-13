// 小红书七日爆款雷达 · 面板逻辑：概览（分类查询+历史）/ 榜单页（卡片+查看更多+HTML）/ 设置。
// 三步输出与分析走 agent 对话；面板直连 API 查询/看榜单/生成报告。
(() => {
  const $app = document.getElementById('app')
  const $toast = document.getElementById('toast')
  const EMBEDDED = (() => { try { return window.parent !== window } catch { return false } })()

  const state = { catalog: null, shown: 20 }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const fmt = (v) => {
    const num = typeof v === 'number' ? v : parseInt(String(v), 10)
    if (Number.isFinite(num) && Math.abs(num) >= 10000) return `${Math.floor(Math.abs(num) / 10000)}w+`
    return String(v ?? 0)
  }

  async function api(path) {
    const res = await fetch(`/xhs-weeklytop${path}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(body.error || `HTTP ${res.status}`)
      err.status = res.status
      throw err
    }
    return body
  }
  async function apiPost(path, payload) {
    const res = await fetch(`/xhs-weeklytop${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    return body
  }
  async function apiDelete(path) {
    const res = await fetch(`/xhs-weeklytop${path}`, { method: 'DELETE' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    return body
  }

  // 报告是否存在：宿主新版在 meta/listBoards 里直接给 has_report；宿主没重启时用 HEAD 探测兜底。
  // 桌面端 WebContentsView 把 window.open/target=_blank 全部 deny，报告只能在面板内看，
  // 所以「有没有报告」必须自己判断，不能靠点按钮弹新窗口。
  async function hasReportFile(id) {
    try {
      const res = await fetch(`/xhs-weeklytop/api/boards/${encodeURIComponent(id)}/report`, { method: 'HEAD', cache: 'no-store' })
      return res.ok
    } catch { return false }
  }

  const boardById = (id) => (state.catalog?.boards || []).find((b) => b.board_id === id)
  const boardLabel = (id) => {
    const b = boardById(id)
    return b ? `${b.category} · ${b.rank_date}` : '七日爆款笔记'
  }
  // 封面/头像走宿主代理（同源字节），面板 CSP 与 CDN 防盗链都影响不到
  const imgSrc = (u) => (u ? `/xhs-weeklytop/api/img?u=${encodeURIComponent(u)}` : '')

  // 打开外部链接：桌面端 iframe 里 window.open 会被 WebContentsView deny，
  // 先请宿主用系统默认浏览器打开；宿主不支持（网页版/无桌面）时退回新窗口。
  async function openLink(u) {
    if (!u || u === '#') return
    try {
      const r = await apiPost('/api/open', { url: u })
      if (r?.ok) { toast('已在系统浏览器打开'); return }
      throw new Error(r?.error || '打开失败')
    } catch (e) {
      const win = window.open(u, '_blank', 'noopener')
      if (!win) {
        const hint = /404|not found/i.test(String(e.message))
          ? '宿主还没重启（/api/open 未上线），重启 dsh 后就能用系统浏览器打开'
          : e.message
        toast(`链接打不开：${hint}`, true)
      }
    }
  }

  let toastTimer = null
  function toast(msg, isErr) {
    $toast.textContent = msg
    $toast.className = `toast show${isErr ? ' err' : ''}`
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { $toast.className = 'toast' }, 2600)
  }
  function copyFallback(prompt, reason) {
    navigator.clipboard?.writeText(prompt).then(
      () => toast(`${reason}，草稿已复制到剪贴板——请粘贴到 dsh 对话`, true),
      () => toast(`${reason}，复制也失败了`, true))
  }

  const ICONS = {
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    trash: '<path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M7 7l1 13h8l1-13"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    ext: '<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18 14v5H5V6h5"/>',
    back: '<path d="M14 6l-6 6 6 6"/>',
    play: '<path d="M8 5l11 7-11 7V5z"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  }
  const ic = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`

  // ---------- 报告查看器（面板内覆盖层） ----------
  // 桌面端 dsh-app 协议的 WebContentsView 把 window.open / target=_blank 全部 deny（只有 https:
  // 交给系统浏览器），所以报告不能用新窗口打开：fetch 同源 HTML → iframe.srcdoc 在面板里显示。
  async function openReportView(id, label) {
    document.getElementById('report-view')?.remove()
    const el = document.createElement('div')
    el.id = 'report-view'
    el.className = 'report-view'
    el.innerHTML = `
      <div class="rv-panel" role="dialog" aria-modal="true" aria-label="HTML 报告">
        <div class="rv-bar">
          <div class="rv-title">${ic('file')}<span>${esc(label || boardLabel(id))}</span></div>
          <div class="rv-actions">
            <button class="btn ghost" id="rv-reload">重新载入</button>
            <button class="btn ghost" id="rv-close">关闭</button>
          </div>
        </div>
        <div class="rv-body"><div class="loading">LOADING…</div></div>
      </div>`
    document.body.appendChild(el)
    const body = el.querySelector('.rv-body')
    const onKey = (e) => { if (e.key === 'Escape') close() }
    function close() {
      removeEventListener('keydown', onKey)
      el.remove()
    }
    addEventListener('keydown', onKey)
    el.querySelector('#rv-close').onclick = close
    el.addEventListener('click', (e) => { if (e.target === el) close() })

    const paint = async () => {
      body.innerHTML = '<div class="loading">LOADING…</div>'
      try {
        const res = await fetch(`/xhs-weeklytop/api/boards/${encodeURIComponent(id)}/report`, { cache: 'no-store' })
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}))
          throw new Error(detail.error || `HTTP ${res.status}`)
        }
        const html = await res.text()
        const frame = document.createElement('iframe')
        frame.className = 'rv-frame'
        frame.title = 'HTML 报告'
        frame.srcdoc = html // 报告自带的红色主题样式与导出脚本原样执行
        body.innerHTML = ''
        body.appendChild(frame)
      } catch (e) {
        body.innerHTML = `<div class="empty"><div class="e-title">报告打不开</div><p>${esc(e.message)}</p><p>先点「生成 HTML 报告」，或在对话里让 agent 跑 xhs_weekly(action="html")。</p></div>`
      }
    }
    el.querySelector('#rv-reload').onclick = paint
    await paint()
  }

  // 生成（或按最新榜单数据重生成）报告后立刻在面板里打开
  async function generateReport(id, btn) {
    if (btn) btn.disabled = true
    try {
      const r = await apiPost(`/api/boards/${encodeURIComponent(id)}/report`, { top: boardById(id)?.total || 50 })
      toast(`HTML 报告已生成（TOP${r.top}）`)
      await openReportView(id, `七日爆款笔记 · ${boardById(id)?.category || ''}`)
      bindReportSlots()
    } catch (e) {
      toast(e.message, true)
    } finally {
      if (btn) btn.disabled = false
    }
  }

  // 报告入口槽位：概览卡片 / 报告库共用。有报告 → 「打开报告」，报告库页无报告 → 「生成报告」
  function fillReportSlot(slot, id, exists) {
    slot.innerHTML = ''
    const mk = (cls, text, onClick) => {
      const b = document.createElement('button')
      b.className = cls
      b.type = 'button'
      b.textContent = text
      b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onClick(b) }
      slot.appendChild(b)
      return b
    }
    if (exists) return mk('chip act', '📄 打开报告', () => openReportView(id))
    if (slot.dataset.reportGen) return mk('chip act gen', '＋ 生成报告', (b) => generateReport(id, b))
    return null
  }

  async function bindReportSlots() {
    const slots = [...document.querySelectorAll('[data-report-slot]')]
    await Promise.all(slots.map(async (slot) => {
      const id = slot.dataset.reportSlot
      const known = typeof boardById(id)?.has_report === 'boolean' ? boardById(id).has_report : await hasReportFile(id)
      fillReportSlot(slot, id, known)
    }))
  }

  // rail 导航图标：index.html 里只放了 <i data-icon> 占位，这里填成 svg（否则导航图标是空的）
  function paintNavIcons() {
    document.querySelectorAll('[data-icon]').forEach((el) => { el.outerHTML = ic(el.dataset.icon) })
  }

  async function loadCatalog() {
    state.catalog = await api('/api/catalog')
    renderRailFoot()
    return state.catalog
  }
  function renderRailFoot() {
    const c = state.catalog
    if (!c) return
    const latest = (c.boards || [])[0]
    document.getElementById('rail-foot').innerHTML =
      `<div class="v-head">XHS WEEKLY v${esc(c.version)}</div>` +
      `<div class="v-row"><span>API Key</span><span>${c.has_key ? '已配置' : '未配置'}</span></div>` +
      `<div class="v-row"><span>分类</span><span>${(c.categories || []).length}</span></div>` +
      `<div class="v-row"><span>最近榜单</span><span>${esc(latest ? `${latest.category}` : '—')}</span></div>`
  }

  function sendAgentPrompt(prompt, okMsg = '已在宿主开新对话——agent 处理中') {
    if (!EMBEDDED) {
      navigator.clipboard?.writeText(prompt).then(
        () => toast('草稿已复制——粘贴到 dsh 对话即可开始'),
        () => copyFallback(prompt, '复制失败'))
      return
    }
    let done = false
    const cleanup = () => { done = true; clearTimeout(timer); removeEventListener('message', onMsg) }
    const onMsg = (e) => {
      if (e.origin !== location.origin) return
      if (e.data?.type === 'xhs-weeklytop:start-ok') { if (!done) { cleanup(); toast(okMsg) } }
      else if (e.data?.type === 'xhs-weeklytop:start-failed') { if (!done) { cleanup(); toast(`没能开新对话：${e.data.message || ''}`, true) } }
    }
    const timer = setTimeout(() => { if (!done) { cleanup(); copyFallback(prompt, '未收到宿主确认') } }, 1500)
    addEventListener('message', onMsg)
    parent.postMessage({ type: 'xhs-weeklytop:refresh', prompt }, location.origin)
  }

  // ---------- 视图：概览 ----------
  function viewHome() {
    const c = state.catalog
    const boards = c.boards || []
    const cats = c.categories || []
    return `
      <header class="head">
        <span class="eyebrow">XHS WEEKLY HOT</span>
        <div class="head-row">
          <h1>小红书七日<strong>爆款雷达</strong></h1>
        </div>
        <p>近 7 天热门笔记 TOP50，24 个垂直分类。数据每日 19:00 更新昨日榜单（19 点前查前天）。RedFox API Key ${c.has_key ? '已配置' : '未配置——去「设置」页填写'}。</p>
      </header>
      ${!c.has_key ? `<div class="empty" style="margin-bottom:var(--sp-6);padding:var(--sp-4) var(--sp-5);text-align:left"><div class="e-title">🔑 还没有配置 RedFox API Key</div><p>到<a href="#/settings">「设置」</a>页填写（ak_ 开头，<a href="https://redfox.hk/settings/api-keys?source=github" target="_blank" rel="noreferrer">红狐 hub 获取 ↗</a>）。</p></div>` : ''}
      <section class="sec" style="margin-top:0">
        <div class="sec-head"><span class="num">01</span><h2>分类热榜查询</h2></div>
        <div class="form" style="max-width:860px">
          <div class="field"><label>CATEGORY · 选择分类（24 个垂直领域）</label>
            <div class="cats">${cats.map((cat) => `<button class="cat-btn${cat === '综合全部' ? ' on' : ''}" data-cat="${esc(cat)}">${esc(cat)}</button>`).join('')}</div>
          </div>
          <div style="display:flex;gap:var(--sp-3);flex-wrap:wrap">
            <button class="btn accent" id="f-fetch">${ic('play')}查询该分类热榜</button>
            <button class="btn ghost" data-newflow>${ic('spark')}去对话做选题分析</button>
          </div>
          <div class="hint">同步秒回。按互动数排序（备用公式：点赞+收藏×2+评论×3+分享×5）；表格与 HTML 报告同数据同排序。</div>
        </div>
      </section>
      <section class="sec">
        <div class="sec-head"><span class="num">02</span><h2>榜单历史</h2></div>
        ${boards.length ? `<div class="cards">${boards.map((r) => `
          <div class="card" data-board-card="${esc(r.board_id)}" role="button" tabindex="0">
            <div class="c-top">
              <div class="c-title">${esc(r.category)}</div>
              <span class="chip done">${r.total} 条</span>
            </div>
            <div class="c-sub">数据日期 ${esc(r.rank_date)}${r.rank_date_auto ? '（自动推断）' : ''}</div>
            <div class="c-foot">
              <span>${esc(String(r.created_at).slice(0, 16).replace('T', ' '))}</span>
              <span data-report-slot="${esc(r.board_id)}"></span>
            </div>
          </div>`).join('')}</div>`
        : `<div class="empty"><div class="e-title">还没有榜单</div><p>选个分类点「查询该分类热榜」；或「去对话做选题分析」让 agent 匹配分类并输出爆款分析。</p></div>`}
      </section>`
  }

  // ---------- 视图：榜单 ----------
  function noteCard(n) {
    const medal = n.rank === 1 ? '🥇' : n.rank === 2 ? '🥈' : n.rank === 3 ? '🥉' : n.rank
    const cls = n.rank <= 3 ? `note-card top${n.rank}` : 'note-card'
    const nd = (label, f) => `<div class="nd"><span class="l">${label}</span><span class="v">${esc(fmt(f.total))}</span><span class="a">↑${esc(fmt(f.add))}</span></div>`
    const link = n.photoJumpUrl ? ` data-open-link="${esc(n.photoJumpUrl)}"` : ''
    // 封面：优先宿主代理（同源，绕开 CSP/防盗链），代理还没上线时由 bindImages 回落到 CDN 直连
    const coverImg = n.cover
      ? `<img src="${esc(imgSrc(n.cover))}" data-fallback="${esc(n.cover)}" alt="" loading="lazy">`
      : ''
    const cover = n.cover
      ? `<button class="n-thumb" type="button"${link} title="打开小红书原文">${coverImg}</button>`
      : '<span class="n-thumb broken"></span>'
    const avatar = n.avatar
      ? `<img class="n-avatar" src="${esc(imgSrc(n.avatar))}" data-fallback="${esc(n.avatar)}" alt="" loading="lazy">`
      : ''
    const meta = [n.userName, n.fans && n.fans !== '0' ? `${n.fans}粉丝` : '', n.publicTime ? n.publicTime.slice(0, 10) : '']
      .filter(Boolean).join(' · ')
    const desc = n.desc ? `<div class="n-desc"${link} role="button" tabindex="0" title="打开小红书原文">${esc(n.desc)}</div>` : ''
    return `
      <div class="${cls}">
        <div class="rank">${medal}</div>
        ${cover}
        <div class="n-main">
          <div class="n-title"><span${link} role="button" tabindex="0">${esc(n.title)}</span></div>
          <div class="n-author">${avatar}${esc(meta)}</div>
          ${desc}
          <div class="n-data">
            ${nd('互动', n.interactive)}${nd('点赞', n.like)}${nd('评论', n.comment)}${nd('收藏', n.collected)}${nd('分享', n.share)}
          </div>
        </div>
        ${n.photoJumpUrl ? `<button class="n-go" type="button"${link} title="打开小红书原文">${ic('ext')}</button>` : ''}
      </div>`
  }

  function viewBoard(id) {
    return `<div id="b-view" data-bid="${esc(id)}"><div class="loading">LOADING…</div></div>`
  }

  async function renderBoard(id) {
    const holder = document.getElementById('b-view')
    let data
    try {
      data = await api(`/api/boards/${encodeURIComponent(id)}`)
    } catch (e) {
      const netDown = !e.status
      holder.innerHTML = `<a class="back" href="#/">${ic('back')} 概览</a><div class="empty"><div class="e-title">${netDown ? '面板服务连接失败' : '榜单不存在'}</div><p>${netDown ? '开发预览：DSH_HOME=<数据目录> node scripts/devserver.mjs 5182' : esc(e.message)}</p></div>`
      return
    }
    const meta = data.board
    const notes = data.notes || []
    state.shown = Math.min(20, notes.length)
    // 宿主没重启时 meta.has_report 还不存在 → HEAD 探测兜底，保证「打开报告」入口一定能出现
    const hasReport = typeof meta.has_report === 'boolean' ? meta.has_report : await hasReportFile(id)
    holder.innerHTML = `
      <a class="back" href="#/">${ic('back')} 概览</a>
      <div class="detail-head">
        <div>
          <h1>${esc(meta.category)}</h1>
          <div class="c-sub" style="margin-top:4px">数据日期 ${esc(meta.rank_date)} · 共 ${notes.length} 条 · 抓取于 ${esc(String(meta.fetch_time).slice(0, 16))}</div>
        </div>
        <div class="actions" id="b-actions">${actionsHtml(id, hasReport)}</div>
      </div>
      <div class="date-note">📅 数据每日 19:00 更新昨日榜单${meta.rank_date_auto ? '（本榜为自动推断日期）' : '（指定日期）'} · 排序：互动数优先（备用：点赞+收藏×2+评论×3+分享×5）</div>
      <div class="notes" id="note-list">${notes.slice(0, state.shown).map(noteCard).join('')}</div>
      <div class="pagebar" id="more-bar">${notes.length > state.shown
        ? `<button class="btn ghost" id="b-more">查看更多（剩余 ${notes.length - state.shown} 条）</button>`
        : notes.length ? '<span class="more-hint">已展示全部</span>' : '<div class="empty-inline">该分类该日期没有查到爆款笔记，换个日期或分类试试。</div>'}</div>`
    state.hasReport = hasReport
    bindBoard(id, meta, notes)
  }

  function actionsHtml(id, hasReport) {
    const report = hasReport
      ? `<button class="btn accent" data-open-report="${esc(id)}">${ic('file')}打开 HTML 报告</button>
         <button class="btn ghost" data-gen-report="${esc(id)}">重新生成</button>`
      : `<button class="btn accent" data-gen-report="${esc(id)}">${ic('play')}生成 HTML 报告</button>`
    return `${report}
      <button class="btn ghost" data-analyze="${esc(id)}">${ic('spark')}去对话写七日分析</button>
      <button class="btn ghost" data-del-board="${esc(id)}" title="删除榜单">${ic('trash')}</button>`
  }

  function bindBoard(id, meta, notes) {
    bindNoteInteractions()
    const more = document.getElementById('b-more')
    if (more) more.onclick = () => {
      state.shown = notes.length
      document.getElementById('note-list').innerHTML = notes.map(noteCard).join('')
      document.getElementById('more-bar').innerHTML = '<span class="more-hint">已展示全部</span>'
      bindNoteInteractions()
    }
    const openBtn = document.querySelector('[data-open-report]')
    if (openBtn) openBtn.onclick = () => openReportView(id)
    const genBtn = document.querySelector('[data-gen-report]')
    if (genBtn) genBtn.onclick = async () => {
      await generateReport(id, genBtn)
      state.hasReport = true
      const box = document.getElementById('b-actions')
      if (box) {
        box.innerHTML = actionsHtml(id, true)
        bindBoard(id, meta, notes)
      }
    }
    const del = document.querySelector('[data-del-board]')
    if (del) del.onclick = async () => {
      if (!confirm('删除这份榜单？')) return
      try { await apiDelete(`/api/boards/${encodeURIComponent(id)}`); toast('已删除'); location.hash = '#/' } catch (e) { toast(e.message, true) }
    }
    const analyze = document.querySelector('[data-analyze]')
    if (analyze) analyze.onclick = () => {
      sendAgentPrompt([
        `请分析小红书【${meta.category}】分类 ${meta.rank_date} 的七日爆款笔记（boardId=${id}）：`,
        `1. xhs_weekly(action="notes", boardId="${id}", limit=50) 补读完整榜单（面板只展示 TOP20）`,
        '2. 按 xiaohongshu-weeklytop 技能输出三步：🔥 表格 TOP20（带更新时间）→ 📊 七日分析 3 模块（热门内容/爆款标题/最高数据作品，每行带参考笔记链接，给可执行建议）→ 功能询问（HTML+订阅）',
        '3. 生成 HTML 用 xhs_weekly(action="html", boardId="' + id + '", top=50)。',
      ].join('\n'), '已在宿主开新对话——agent 分析完回来看')
    }
  }

  // ---------- 视图：报告库 ----------
  // 给「生成到磁盘的 report.html」一个固定入口：rail 的「报告」页 + 每份榜单卡片上的槽位
  function viewReports() {
    const boards = state.catalog?.boards || []
    return `
      <header class="head">
        <span class="eyebrow">REPORTS</span>
        <div class="head-row"><h1>报告<strong>库</strong></h1></div>
        <p>对话里生成的七日爆款 HTML 报告都落在这里，点「打开报告」在面板内直接查看（桌面端不支持弹出新窗口）。</p>
      </header>
      <section class="sec" style="margin-top:0">
        <div class="sec-head"><span class="num">01</span><h2>榜单报告</h2></div>
        ${boards.length ? `<div class="cards">${boards.map((r) => `
          <div class="card" data-board-card="${esc(r.board_id)}" role="button" tabindex="0">
            <div class="c-top">
              <div class="c-title">${esc(r.category)}</div>
              <span class="chip done">${r.total} 条</span>
            </div>
            <div class="c-sub">数据日期 ${esc(r.rank_date)}</div>
            <div class="c-foot">
              <span>${esc(String(r.created_at).slice(0, 16).replace('T', ' '))}</span>
              <span data-report-slot="${esc(r.board_id)}" data-report-gen="1" class="slot"></span>
            </div>
          </div>`).join('')}</div>`
        : `<div class="empty"><div class="e-title">还没有榜单</div><p>去「概览」查一个分类热榜，或在对话里 fetch 一次榜单，报告就有了。</p></div>`}
      </section>`
  }

  // ---------- 视图：设置 ----------
  function viewSettings() {
    return `
      <a class="back" href="#/">${ic('back')} 概览</a>
      <header class="head">
        <span class="eyebrow">SETTINGS</span>
        <h1>设<strong>置</strong></h1>
        <p>RedFox API Key 是榜单查询的唯一凭证。这里保存的 Key 优先于环境变量，低于插件配置。</p>
      </header>
      <div class="form">
        <div class="field"><label>API KEY · RedFox API Key（ak_ 开头）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="s-key" placeholder="ak_…" style="flex:1;min-width:220px;font-family:var(--font-mono);font-size:12px">
            <button class="btn" id="s-key-save">保存 Key</button>
          </div>
          <div class="hint" id="s-key-hint">…</div>
          <div class="hint">获取：<a href="https://redfox.hk/settings/api-keys?source=github" target="_blank" rel="noreferrer">redfox.hk/settings/api-keys ↗</a>。保存在本机 dsh 数据目录，不上传。</div>
        </div>
        <div class="field"><label>PROXY · HTTP(S) 代理（访问 redfox.hk 走代理时填；清空 = 直连）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="s-proxy" placeholder="http://127.0.0.1:7890" style="flex:1;min-width:220px;font-family:var(--font-mono);font-size:12px">
            <button class="btn" id="s-proxy-save">保存代理</button>
          </div>
        </div>
        <div class="field"><label>API BASE · 接口地址（测试/自建网关用，默认 https://redfox.hk）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="s-base" placeholder="https://redfox.hk" style="flex:1;min-width:220px;font-family:var(--font-mono);font-size:12px">
            <button class="btn" id="s-base-save">保存地址</button>
          </div>
        </div>
      </div>`
  }

  async function bindSettings() {
    try {
      const { settings } = await api('/api/settings')
      const keyHint = document.getElementById('s-key-hint')
      if (keyHint) keyHint.textContent = settings.has_key
        ? `已配置（…${settings.key_tail || '******'}${settings.from_env ? '，其中环境变量可用' : ''}）。重新输入会覆盖。`
        : '未配置。'
      const inp = document.getElementById('s-key')
      if (inp && document.activeElement !== inp) inp.placeholder = settings.has_key ? `已配置（…${settings.key_tail}），输入新值覆盖` : 'ak_…'
      const proxy = document.getElementById('s-proxy')
      if (proxy && document.activeElement !== proxy) proxy.value = settings.proxy_url || ''
      const base = document.getElementById('s-base')
      if (base && document.activeElement !== base) base.value = settings.api_base || ''
    } catch { /* 宿主未就绪 */ }
    const bind = (id, payload) => {
      const btn = document.getElementById(id)
      if (!btn) return
      btn.onclick = async () => {
        try {
          const input = btn.parentElement.querySelector('input')
          await apiPost('/api/settings', payload(input.value.trim()))
          toast('设置已保存')
          loadCatalog().catch(() => {})
        } catch (e) { toast(e.message, true) }
      }
    }
    bind('s-key-save', (v) => ({ api_key: v }))
    bind('s-proxy-save', (v) => ({ proxy_url: v }))
    bind('s-base-save', (v) => ({ api_base: v }))
  }

  // ---------- 渲染辅助 ----------
  function bindCommon() {
    document.querySelectorAll('.cat-btn').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('.cat-btn').forEach((x) => x.classList.toggle('on', x === b))
      }
    })
    document.querySelectorAll('[data-newflow]').forEach((b) => {
      b.onclick = () => sendAgentPrompt([
        '请帮我做小红书选题分析（小红书七日爆款雷达）：',
        '1. 我会告诉你赛道关键词；xhs_weekly(action="match", keyword=…) 匹配分类（命中直接查；未命中把推荐给我确认，禁止直接查）',
        '2. xhs_weekly(action="fetch", category=…, topN=50) 拉榜单',
        '3. 按三步规范输出：🔥 表格 TOP20 → 📊 七日分析 3 模块 → 功能询问',
        '4. 我要 HTML 时 xhs_weekly(action="html", top=50)。',
        '现在请先问我想看哪个赛道的爆款。',
      ].join('\n'), '已在宿主开新对话——agent 会先问你想看什么赛道')
    })
    const fetchBtn = document.getElementById('f-fetch')
    if (fetchBtn) fetchBtn.onclick = async () => {
      const cat = document.querySelector('.cat-btn.on')?.dataset.cat
      if (!cat) { toast('先选一个分类', true); return }
      fetchBtn.disabled = true; fetchBtn.textContent = '查询中…'
      try {
        const r = await apiPost('/api/boards', { category: cat })
        toast(r.notes?.length ? `查询成功：${r.notes.length} 条爆款笔记` : '查询成功：该分类暂无数据')
        location.hash = `#/b/${encodeURIComponent(r.board.board_id)}`
      } catch (e) { toast(e.message, true) }
      fetchBtn.disabled = false; fetchBtn.innerHTML = `${ic('play')}查询该分类热榜`
    }
    // 榜单卡片：点卡片进榜单页；卡片内的「打开报告 / 生成报告」按钮不触发跳转
    document.querySelectorAll('[data-board-card]').forEach((card) => {
      const go = () => { location.hash = `#/b/${encodeURIComponent(card.dataset.boardCard)}` }
      card.onclick = (e) => { if (e.target.closest('button, a')) return; go() }
      card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } }
    })
    // 面板里的外链一律交给系统浏览器（桌面端 <a target="_blank"> 同样会被 deny）
    document.querySelectorAll('a[target="_blank"]').forEach((a) => {
      a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openLink(a.getAttribute('href')) }
    })
    // 笔记卡片里的封面/标题/正文/箭头：点开小红书原文（走宿主系统浏览器）
    bindNoteInteractions()
    bindReportSlots()
  }

  // 笔记卡片的交互：可点区域 + 图片两段加载。换页/查看更多后要重新绑一次
  function bindNoteInteractions() {
    document.querySelectorAll('[data-open-link]').forEach((el) => {
      if (el.dataset.bound) return
      el.dataset.bound = '1'
      el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openLink(el.dataset.openLink) }
      el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLink(el.dataset.openLink) } }
    })
    bindImages()
  }

  // 图片两段加载：代理失败 → CDN 直连 → 都不行就藏掉（不留破图）
  function bindImages() {
    document.querySelectorAll('img[data-fallback]').forEach((img) => {
      if (img.dataset.bound) return
      img.dataset.bound = '1'
      img.onerror = () => {
        const direct = img.dataset.fallback
        if (direct && img.src !== direct) {
          img.dataset.fallback = ''
          img.src = direct
          return
        }
        const box = img.closest('.n-thumb')
        if (box) box.classList.add('broken')
        img.remove()
      }
    })
  }

  // ---------- 路由 ----------
  async function render() {
    try { await loadCatalog() } catch {}
    const hash = location.hash || '#/'
    const mb = hash.match(/^#\/b\/(.+)$/)
    const bid = mb ? decodeURIComponent(mb[1]) : null
    const cur = bid ? '' : hash === '#/' ? 'home' : hash.startsWith('#/settings') ? 'settings' : hash.startsWith('#/reports') ? 'reports' : 'home'
    document.querySelectorAll('.nav a').forEach((a) => {
      a.classList.toggle('on', a.dataset.view === cur)
    })
    if (bid && /^[\p{L}\p{N}_-]+$/u.test(bid)) {
      $app.innerHTML = viewBoard(bid)
      bindCommon()
      renderBoard(bid)
      return
    }
    if (hash.startsWith('#/settings')) { $app.innerHTML = viewSettings(); bindCommon(); bindSettings(); return }
    if (hash.startsWith('#/reports')) { $app.innerHTML = viewReports(); bindCommon(); bindReportSlots(); return }
    $app.innerHTML = viewHome()
    bindCommon()
  }

  async function boot() {
    try { await loadCatalog() } catch {
      state.catalog = { version: '-', has_key: false, key_source: 'none', categories: [], boards: [], settings: {} }
    }
    paintNavIcons()
    render().catch(() => {})
  }
  // 报告 iframe（srcdoc）里的链接点击会 postMessage 过来，统一交给 openLink 走系统浏览器
  addEventListener('message', (e) => {
    if (e.origin !== location.origin) return
    const m = e.data
    if (m && m.type === 'xhs-weeklytop:open-link' && typeof m.url === 'string') openLink(m.url)
  })
  addEventListener('hashchange', render)
  boot()
  setTimeout(() => { if (!state.catalog?.version || state.catalog.version === '-') boot() }, 2500)
})()
