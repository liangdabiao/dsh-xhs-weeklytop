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
  }
  const ic = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`

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
          <a class="card" href="#/b/${encodeURIComponent(r.board_id)}">
            <div class="c-top">
              <div class="c-title">${esc(r.category)}</div>
              <span class="chip done">${r.total} 条</span>
            </div>
            <div class="c-sub">数据日期 ${esc(r.rank_date)}${r.rank_date_auto ? '（自动推断）' : ''}</div>
            <div class="c-foot"><span>${esc(String(r.created_at).slice(0, 16).replace('T', ' '))}</span></div>
          </a>`).join('')}</div>`
        : `<div class="empty"><div class="e-title">还没有榜单</div><p>选个分类点「查询该分类热榜」；或「去对话做选题分析」让 agent 匹配分类并输出爆款分析。</p></div>`}
      </section>`
  }

  // ---------- 视图：榜单 ----------
  function noteCard(n) {
    const medal = n.rank === 1 ? '🥇' : n.rank === 2 ? '🥈' : n.rank === 3 ? '🥉' : n.rank
    const cls = n.rank <= 3 ? `note-card top${n.rank}` : 'note-card'
    const nd = (label, f) => `<div class="nd"><span class="l">${label}</span><span class="v">${esc(fmt(f.total))}</span><span class="a">↑${esc(fmt(f.add))}</span></div>`
    return `
      <div class="${cls}">
        <div class="rank">${medal}</div>
        <div class="n-main">
          <div class="n-title">${n.photoJumpUrl ? `<a href="${esc(n.photoJumpUrl)}" target="_blank" rel="noreferrer">${esc(n.title)}</a>` : esc(n.title)}</div>
          <div class="n-author">${esc(n.userName)}（${esc(n.fans)}粉丝）</div>
          <div class="n-data">
            ${nd('互动', n.interactive)}${nd('点赞', n.like)}${nd('评论', n.comment)}${nd('收藏', n.collected)}${nd('分享', n.share)}
          </div>
        </div>
        ${n.photoJumpUrl ? `<a class="n-go" href="${esc(n.photoJumpUrl)}" target="_blank" rel="noreferrer">${ic('ext')}</a>` : ''}
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
    const reportBtn = meta.has_report !== false && notes.length
      ? `<button class="btn accent" id="b-html">${ic('ext')}生成 HTML 报告</button>`
      : ''
    holder.innerHTML = `
      <a class="back" href="#/">${ic('back')} 概览</a>
      <div class="detail-head">
        <div>
          <h1>${esc(meta.category)}</h1>
          <div class="c-sub" style="margin-top:4px">数据日期 ${esc(meta.rank_date)} · 共 ${notes.length} 条 · 抓取于 ${esc(String(meta.fetch_time).slice(0, 16))}</div>
        </div>
        <div class="actions">
          ${reportBtn}
          <button class="btn ghost" data-analyze="${esc(id)}">${ic('spark')}去对话写七日分析</button>
          <button class="btn ghost" data-del-board="${esc(id)}" title="删除榜单">${ic('trash')}</button>
        </div>
      </div>
      <div class="date-note">📅 数据每日 19:00 更新昨日榜单${meta.rank_date_auto ? '（本榜为自动推断日期）' : '（指定日期）'} · 排序：互动数优先（备用：点赞+收藏×2+评论×3+分享×5）</div>
      <div class="notes" id="note-list">${notes.slice(0, state.shown).map(noteCard).join('')}</div>
      <div class="pagebar" id="more-bar">${notes.length > state.shown
        ? `<button class="btn ghost" id="b-more">查看更多（剩余 ${notes.length - state.shown} 条）</button>`
        : notes.length ? '<span class="more-hint">已展示全部</span>' : '<div class="empty-inline">该分类该日期没有查到爆款笔记，换个日期或分类试试。</div>'}</div>`
    bindBoard(id, meta, notes)
  }

  function bindBoard(id, meta, notes) {
    const more = document.getElementById('b-more')
    if (more) more.onclick = () => {
      state.shown = notes.length
      document.getElementById('note-list').innerHTML = notes.map(noteCard).join('')
      document.getElementById('more-bar').innerHTML = '<span class="more-hint">已展示全部</span>'
    }
    const htmlBtn = document.getElementById('b-html')
    if (htmlBtn) htmlBtn.onclick = async () => {
      htmlBtn.disabled = true
      try {
        const r = await apiPost(`/api/boards/${encodeURIComponent(id)}/report`, { top: state.shown })
        toast(`HTML 报告已生成（TOP${r.top}）`)
        window.open(`/xhs-weeklytop/api/boards/${encodeURIComponent(id)}/report`, '_blank')
      } catch (e) { toast(e.message, true) }
      htmlBtn.disabled = false
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
  }

  // ---------- 路由 ----------
  async function render() {
    try { await loadCatalog() } catch {}
    const hash = location.hash || '#/'
    const mb = hash.match(/^#\/b\/(.+)$/)
    const bid = mb ? decodeURIComponent(mb[1]) : null
    document.querySelectorAll('.nav a').forEach((a) => {
      const cur = bid ? '' : hash === '#/' ? 'home' : hash.startsWith('#/settings') ? 'settings' : 'home'
      a.classList.toggle('on', a.dataset.view === cur)
    })
    if (bid && /^[\p{L}\p{N}_-]+$/u.test(bid)) {
      $app.innerHTML = viewBoard(bid)
      bindCommon()
      renderBoard(bid)
      return
    }
    if (hash.startsWith('#/settings')) { $app.innerHTML = viewSettings(); bindCommon(); bindSettings(); return }
    $app.innerHTML = viewHome()
    bindCommon()
  }

  async function boot() {
    try { await loadCatalog() } catch {
      state.catalog = { version: '-', has_key: false, key_source: 'none', categories: [], boards: [], settings: {} }
    }
    render().catch(() => {})
  }
  addEventListener('hashchange', render)
  boot()
  setTimeout(() => { if (!state.catalog?.version || state.catalog.version === '-') boot() }, 2500)
})()
