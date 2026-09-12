/* Generated from client/index.js by scripts/build-client.mjs — do not edit by hand.
 * Regenerate with: npm run build:client
 */
window.__ModuleLoader__.load({
  id: "@weibaohui/dsh-fde-tools",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
    var React = require("react")
    'use strict'

    /**
     * @weibaohui/dsh-fde-tools — Client half
     *
     * 侧栏入口（家族块下方 DOM 注入）→ 全页全家桶面板：
     *  - 成员清单（图标/名称/一句话说明），已装显示版本 chip，缺失给「安装」按钮；
     *  - 一键补装全部缺失；pnpm add 宿主侧执行，装完提示重启生效并给可复制的重启命令；
     *  - boot 时不在 bundles 的已装成员标「待重启」。
     *
     * 数据通道：宿主同源路由 /dsh-fde-tools/api。
     * 自包含：只依赖注入的 react（createElement/hooks），不用 react-dom 等平台模块。
     */

    const API = '/dsh-fde-tools/api'

    async function readJson(res) {
      const text = await res.text()
      try { return JSON.parse(text) } catch { return null }
    }

    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(() => true, () => false)
      }
      return Promise.resolve(false)
    }
    function copyFallback(text) {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;left:-9999px;top:0'
      document.body.appendChild(ta)
      ta.select()
      let ok = false
      try { ok = document.execCommand('copy') } catch { ok = false }
      ta.remove()
      return ok
    }

    const styles = {
      _head: null,
      insert(css) {
        if (typeof document === 'undefined') return
        if (!this._head) {
          const style = document.createElement('style')
          style.setAttribute('data-plugin', 'dsh-fde-tools')
          document.head.appendChild(style)
          this._head = style
        }
        this._head.textContent = css
      },
    }

    styles.insert(`
    .fde-trigger{display:flex;align-items:center;gap:8px;width:100%;height:34px;padding:0 10px;margin:2px 0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,var(--dsw-text-primary,inherit));font:inherit;font-size:13px;cursor:pointer;text-align:left}
    .fde-trigger:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
    .fde-trigger .fde-trigger-icon{flex:none}
    [data-sidebar-collapsed] .fde-trigger,[class*="_collapsed"] .fde-trigger{width:36px;height:36px;min-width:36px;margin:0 0 12px;padding:0;justify-content:center;gap:0;text-align:center}
    [data-sidebar-collapsed] .fde-trigger .fde-trigger-label,[class*="_collapsed"] .fde-trigger .fde-trigger-label{display:none}
    .fde-page{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
    .fde-head{display:flex;align-items:center;gap:12px;padding:14px 28px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;background:var(--dsw-alias-bg-layer-2)}
    .fde-title{font-size:15px;font-weight:600;margin:0;display:flex;align-items:center;gap:8px}
    .fde-hchip{font-size:11px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-family:var(--ds-font-family-code,ui-monospace,monospace)}
    .fde-spacer{flex:1}
    .fde-btn{font-size:12px;padding:5px 12px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;flex:none;transition:background .16s,border-color .16s}
    .fde-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 24%,var(--dsw-alias-border-l2))}
    .fde-btn:disabled{opacity:.5;cursor:default}
    .fde-btn.primary{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,var(--dsw-alias-border-l2))}
    .fde-btn.primary:hover:not(:disabled){border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,var(--dsw-alias-border-l2))}
    .fde-wrap{flex:1;overflow:auto}
    .fde-inner{max-width:760px;margin:0 auto;padding:20px 28px 48px}
    .fde-banner{display:flex;gap:10px;align-items:center;flex-wrap:wrap;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,var(--dsw-alias-border-l2));background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent);border-radius:10px;padding:10px 14px;margin:0 0 14px;font-size:12.5px}
    .fde-banner.err{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d9534f) 45%,var(--dsw-alias-border-l2));background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d9534f) 8%,transparent)}
    .fde-code{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11.5px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:2px 8px;word-break:break-all}
    .fde-copy{border:0;background:transparent;color:var(--dsw-alias-brand-primary);font-size:12px;cursor:pointer;padding:0 2px;flex:none}
    .fde-copy:hover{opacity:.8}
    .fde-row{display:flex;gap:12px;align-items:flex-start;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
    .fde-row:last-child{border-bottom:0}
    .fde-row-icon{font-size:18px;line-height:1.4;flex:none;width:24px;text-align:center}
    .fde-row-main{flex:1;min-width:0}
    .fde-row-top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
    .fde-row-label{font-size:13.5px;font-weight:600}
    .fde-row-name{font-size:11px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-family:var(--ds-font-family-code,ui-monospace,monospace)}
    .fde-row-desc{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:4px;line-height:1.7}
    .fde-row-side{flex:none;display:flex;align-items:center;gap:8px;padding-top:1px}
    .fde-chip{font-size:11px;line-height:1.6;border-radius:999px;padding:1px 10px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap}
    .fde-chip.miss{color:#b7791f;border-color:color-mix(in srgb,#b7791f 45%,var(--dsw-alias-border-l2))}
    .fde-chip.restart{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,var(--dsw-alias-border-l2))}
    .fde-foot{font-size:11px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-family:var(--ds-font-family-code,ui-monospace,monospace);margin-top:22px;word-break:break-all}
    .fde-spin{padding:48px 0;text-align:center;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:13px}
    .fde-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 16px;font-size:12px;z-index:2147483600;box-shadow:0 4px 16px rgba(0,0,0,.18)}
    `)

    // ---------------------------------------------------------------------------
    // 页面
    // ---------------------------------------------------------------------------

    /** 面板开合的极小外部 store（隐藏挂载点拦不住 fixed 定位，必须条件渲染）。 */
    const pageStore = {
      visible: false,
      subs: new Set(),
      set(v) {
        if (this.visible === v) return
        this.visible = v
        for (const fn of this.subs) { try { fn(v) } catch { /* 订阅者已卸载 */ } }
      },
    }
    function usePageVisible() {
      const [v, setV] = React.useState(pageStore.visible)
      React.useEffect(() => {
        const fn = (x) => setV(x)
        pageStore.subs.add(fn)
        return () => pageStore.subs.delete(fn)
      }, [])
      return v
    }

    let fdeOpen = null
    let fdeClose = null

    function FdePage() {
      const h = React.createElement
      const visible = usePageVisible()
      const [st, setSt] = React.useState(null)
      const [busy, setBusy] = React.useState(false) // 有安装在进行
      const [busyName, setBusyName] = React.useState(null)
      const [toast, setToast] = React.useState(null)
      const toastTimer = React.useRef(null)

      const showToast = (text) => {
        setToast(text)
        if (toastTimer.current) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), 2600)
      }

      const refresh = React.useCallback(async () => {
        const d = await fetch(`${API}/status`).then(readJson).catch(() => null)
        if (d) setSt(d)
        return d
      }, [])

      React.useEffect(() => { if (visible) refresh() }, [visible, refresh])

      const doInstall = async (names, focusName) => {
        if (busy || !names.length) return
        setBusy(true)
        setBusyName(focusName || '*')
        try {
          const r = await fetch(`${API}/install`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ names }),
          }).then(readJson).catch(() => null)
          if (!r) showToast('安装请求失败')
          else if (r.error) showToast(r.error)
          await refresh()
        } finally {
          setBusy(false)
          setBusyName(null)
        }
      }

      const doCopy = async (text) => {
        const ok = (await copyText(text)) || copyFallback(text)
        showToast(ok ? '已复制' : '复制失败，请手动选择文本')
      }

      const missing = st ? st.pack.filter((p) => !p.installed) : []
      const pnpmReady = st ? !(st.pnpm && st.pnpm.ready === false) : true

      if (!visible) return null
      return h('div', { className: 'fde-page', role: 'dialog', 'aria-label': 'FDE 工具箱' },
        h('header', { className: 'fde-head' },
          h('h1', { className: 'fde-title' }, '🧰 FDE 工具箱'),
          st && st.profile && h('span', { className: 'fde-hchip' }, st.profile.name || ''),
          st && h('span', { className: 'fde-hchip' }, `${st.installedCount}/${st.pack.length} 已装`),
          h('span', { className: 'fde-spacer' }),
          st && missing.length > 0 && pnpmReady && h('button', {
            className: 'fde-btn primary', disabled: busy,
            onClick: () => doInstall(missing.map((p) => p.name)),
          }, busy ? '安装中…' : `补装 ${missing.length} 个`),
          h('button', { className: 'fde-btn', onClick: () => fdeClose && fdeClose(), 'aria-label': '关闭' }, '✕'),
        ),
        h('div', { className: 'fde-wrap' },
          h('div', { className: 'fde-inner' },
            st && st.error && h('div', { className: 'fde-banner err' }, st.error),
            st && st.pnpm && st.pnpm.ready === false && h('div', { className: 'fde-banner err' }, st.pnpm.error),
            st && st.needsRestartCount > 0 && h('div', { className: 'fde-banner' },
              h('span', null, '重启 dsh 后生效'),
              st.restart && st.restart.command && h('code', { className: 'fde-code' }, st.restart.command),
              st.restart && st.restart.command && h('button', { className: 'fde-copy', onClick: () => doCopy(st.restart.command) }, '复制'),
            ),
            !st && h('div', { className: 'fde-spin' }, '读取中…'),
            st && st.pack.map((p) => h('div', { className: 'fde-row', key: p.name },
              h('div', { className: 'fde-row-icon' }, p.icon),
              h('div', { className: 'fde-row-main' },
                h('div', { className: 'fde-row-top' },
                  h('span', { className: 'fde-row-label' }, p.label),
                  h('span', { className: 'fde-row-name' }, p.name),
                ),
                h('div', { className: 'fde-row-desc' }, p.desc),
              ),
              h('div', { className: 'fde-row-side' },
                p.installed && p.needsRestart && h('span', { className: 'fde-chip restart' }, '待重启'),
                p.installed && !p.needsRestart && h('span', { className: 'fde-chip' }, `已装 ${p.version || ''}`.trim()),
                !p.installed && pnpmReady && h('button', {
                  className: 'fde-btn primary', disabled: busy,
                  onClick: () => doInstall([p.name], p.name),
                }, busy && busyName === p.name ? '安装中…' : '安装'),
                !p.installed && !pnpmReady && h('span', { className: 'fde-chip miss' }, '未安装'),
              ),
            )),
            st && st.profile && h('div', { className: 'fde-foot' }, st.profile.dir),
          ),
        ),
        toast && h('div', { className: 'fde-toast' }, toast),
      )
    }

    // ---------------------------------------------------------------------------
    // 侧栏入口（家族块下方 DOM 注入，dsh-kb 同款）
    // ---------------------------------------------------------------------------

    const FDE_ENTRY_ATTR = 'data-dsh-fde-entry'
    const FDE_FAMILY_SELECTOR = '[data-dsh-prc-entry],[data-dsh-atb-entry],[data-dsh-taskboard-entry],[data-dsh-ssh-entry],[data-dsh-kb-entry],[data-dsh-git-entry],' + '[' + FDE_ENTRY_ATTR + ']'

    function fdeSidebarRoot() {
      const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"], .dshDesktopUpstreamSidebar, .dshDesktopSidebarSurface')
      if (column === null) return undefined
      const logoOwner = column.querySelector('[class*="logoRow"]') && column.querySelector('[class*="logoRow"]').parentElement
      return logoOwner || (column.firstElementChild || undefined)
    }

    function fdeNewSessionButton(root) {
      const nested = root.querySelector('button[class*="newSession"]')
      if (nested) return nested
      for (const child of root.children) {
        if (child instanceof HTMLButtonElement && !child.matches('[' + FDE_ENTRY_ATTR + ']')) return child
      }
      const buttons = Array.from(root.querySelectorAll('button'))
      return buttons.find((b) => !b.matches('[' + FDE_ENTRY_ATTR + ']') && /新会话|新建会话|new session/i.test(b.textContent || ''))
    }

    function placeFdeEntry(root, entry) {
      const button = fdeNewSessionButton(root)
      if (!button) return false
      if (entry.parentElement !== root) {
        const family = Array.from(root.children).filter((el) => el instanceof HTMLElement && el.matches(FDE_FAMILY_SELECTOR))
        if (family.length > 0) {
          const last = family[family.length - 1]
          last.parentElement.insertBefore(entry, last.nextSibling)
        } else {
          const row = button.closest('[class*="logoRow"]')
          const base = (row && row.parentElement === root) ? row : button
          root.insertBefore(entry, base.nextSibling)
        }
      }
      return true
    }

    function mountFdeSidebarEntry() {
      const entry = document.createElement('button')
      entry.type = 'button'
      entry.setAttribute(FDE_ENTRY_ATTR, '')
      entry.className = 'fde-trigger'
      entry.title = 'FDE 工具箱 — 全家桶安装状态与补装'
      entry.innerHTML = '<span class="fde-trigger-icon">🧰</span><span class="fde-trigger-label">FDE 工具箱</span>'
      entry.addEventListener('click', () => { if (fdeOpen) fdeOpen() })

      let root
      let placed = false
      const rootObserver = new MutationObserver(() => {
        if (!root || !root.isConnected) { placed = false; tryPlace(); return }
        if (!root.contains(entry)) placed = placeFdeEntry(root, entry)
      })
      const tryPlace = () => {
        if (root && !root.isConnected) { rootObserver.disconnect(); root = undefined; placed = false }
        if (placed) { if (document.body.contains(entry)) return; rootObserver.disconnect(); root = undefined; placed = false }
        root = root || fdeSidebarRoot()
        if (!root) return
        placed = placeFdeEntry(root, entry)
        if (placed) rootObserver.observe(root, { childList: true })
      }
      const waitObserver = new MutationObserver(() => tryPlace())
      waitObserver.observe(document.body, { childList: true, subtree: true })
      const retry = setInterval(tryPlace, 2000)
      tryPlace()
      return () => {
        clearInterval(retry)
        waitObserver.disconnect()
        rootObserver.disconnect()
        try { entry.remove() } catch {}
      }
    }

    module.exports = {
      name: '@weibaohui/dsh-fde-tools',
      inject: [],

      apply(ctx) {
        // 不 return 任何值（cordis-plugin-loader 把 apply 返回值当 disposable/effect）。

        // 全页面板：隐藏挂载 + 条件渲染（fixed 定位穿不透 hidden 容器，开合走 store）
        try {
          const RDClient = require('react-dom/client')
          if (RDClient && typeof RDClient.createRoot === 'function') {
            const mount = document.createElement('div')
            mount.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;'
            document.body.appendChild(mount)
            const root = RDClient.createRoot(mount)
            root.render(React.createElement(FdePage))
            fdeOpen = () => pageStore.set(true)
            fdeClose = () => pageStore.set(false)
            ctx.effect(() => () => {
              fdeOpen = null
              fdeClose = null
              try { root.unmount() } catch {}
              try { mount.remove() } catch {}
            }, 'dsh-fde-tools: page mount')
          }
        } catch (e) { console.error('[dsh-fde-tools] page mount:', e) }

        // 侧栏入口
        try {
          const disposeSidebar = mountFdeSidebarEntry()
          ctx.effect(() => () => disposeSidebar(), 'dsh-fde-tools: sidebar entry')
        } catch (e) { console.error('[dsh-fde-tools] sidebar entry:', e) }
      },
    }

    return module.exports
  }
})
