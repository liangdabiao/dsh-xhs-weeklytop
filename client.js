// ============================================================================
// 小红书七日爆款雷达 · 浏览器半边
//   - 侧栏加「小红书七日爆款雷达」入口，主区域是插件页面（/xhs-weeklytop/，iframe）
//   - 页面发 xhs-weeklytop:refresh：postMessage 一段草稿，这里开新对话并填进输入框（不自动发送）
//   - 明暗跟随 dsh 主题
//
// 注意：这里**不要**自己写 window.__ModuleLoader__.load(...)——scripts/build.mjs 的
// banner 已包了一层注册，再包一次会 duplicate factory registration 让 web boot 失败。
// ============================================================================
const React = require('react')
const h = React.createElement

const PANEL = 'xhs-weeklytop'
const SRC = '/xhs-weeklytop/'

// 侧栏图标：雷达圈 + 三平台信号点（小红书 / 抖音 / 公众号）
function PanelIcon(props) {
  const s = (props && props.size) || 18
  return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h('path', { d: 'M12 3c2 4-1.5 6-1.5 9 0 2 1.5 3.5 3.5 3.5 2.8 0 4-2 4-4 2.7 2 4 5.3 4 8 0 6-4.7 10-10 10S2 25 2 19c0-7 5.5-10.5 8.5-14C11.3 4 11.8 3.4 12 3z' }),
    h('path', { d: 'M10.5 15c-1.4 2-2.5 3.4-2.5 5.6 0 3 2 5 4 5s4-2 4-5c0-1.4-.4-2.6-1.4-3.7-.8.9-1.5 1.6-2.6 1.6-1.3 0-2-1-2-2 0-.6.2-1 .5-1.5z', fill: 'currentColor', stroke: 'none' }))
}

function apply(ctx) {
  const frames = new Set()
  let scheme = null
  const post = (frame) => {
    try { if (scheme && frame.contentWindow) frame.contentWindow.postMessage({ type: 'xhs-weeklytop:scheme', scheme }, location.origin) } catch {}
  }
  ctx.inject(['theme'], (c) => {
    const push = (snap) => { scheme = snap.active.colorScheme; frames.forEach(post) }
    try { push(c.theme.getTheme()) } catch {}
    c.on('theme/change', push)
  })

  function Cn30Panel() {
    const ref = React.useRef(null)
    React.useEffect(() => {
      const self = ref.current
      if (self) frames.add(self)
      function onMessage(e) {
        const frame = ref.current
        if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin) return
        const m = e.data
        if (!m || m.type !== 'xhs-weeklytop:refresh' || typeof m.prompt !== 'string') return
        try {
          ctx.uiWorkspace.startSession(undefined, { prompt: m.prompt, whenDraftExists: 'replace' })
          try { frame.contentWindow.postMessage({ type: 'xhs-weeklytop:start-ok' }, location.origin) } catch {}
        } catch (err) {
          console.error('[xhs-weeklytop] 开新对话失败', err)
          try { frame.contentWindow.postMessage({ type: 'xhs-weeklytop:start-failed', message: String((err && err.message) || err) }, location.origin) } catch {}
        }
      }
      addEventListener('message', onMessage)
      return () => { removeEventListener('message', onMessage); frames.delete(self) }
    }, [])
    return h('iframe', {
      ref,
      src: SRC,
      title: '小红书七日爆款雷达',
      allow: 'fullscreen',
      onLoad: (e) => post(e.currentTarget),
      style: { width: '100%', height: '100%', border: 0, display: 'block' },
    })
  }

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 15, label: () => '小红书七日爆款雷达' }, PanelIcon))
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, Cn30Panel))
}

exports.isPlugin = true
exports.inject = ['slots', 'uiWorkspace']
exports.apply = apply
