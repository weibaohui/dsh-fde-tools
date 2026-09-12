'use strict'

/**
 * @weibaohui/dsh-fde-tools — Client half
 *
 * 设置页区块（settings.section 槽位，dsh-kb 同款）：全家桶成员清单——
 *  - 已装显示版本 chip，缺失给「安装」按钮，右上「补装」一键带齐；
 *  - pnpm add 宿主侧执行，装完提示重启生效并给可复制的重启命令；
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
.fde-top{display:flex;align-items:center;gap:10px;margin:0 0 14px}
.fde-hchip{font-size:11px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-family:var(--ds-font-family-code,ui-monospace,monospace)}
.fde-spacer{flex:1}
.fde-btn{font-size:12px;padding:5px 12px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;flex:none;transition:background .16s,border-color .16s}
.fde-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 24%,var(--dsw-alias-border-l2))}
.fde-btn:disabled{opacity:.5;cursor:default}
.fde-btn.primary{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,var(--dsw-alias-border-l2))}
.fde-btn.primary:hover:not(:disabled){border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,var(--dsw-alias-border-l2))}
.fde-banner{display:flex;gap:10px;align-items:center;flex-wrap:wrap;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,var(--dsw-alias-border-l2));background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent);border-radius:10px;padding:10px 14px;margin:0 0 14px;font-size:12.5px}
.fde-banner.err{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d9534f) 45%,var(--dsw-alias-border-l2));background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d9534f) 8%,transparent)}
.fde-code{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11.5px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:2px 8px;word-break:break-all}
.fde-copy{border:0;background:transparent;color:var(--dsw-alias-brand-primary);font-size:12px;cursor:pointer;padding:0 2px;flex:none}
.fde-copy:hover{opacity:.8}
.fde-row{display:flex;gap:12px;align-items:flex-start;padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.fde-row:last-child{border-bottom:0}
.fde-row-icon{font-size:18px;line-height:1.4;flex:none;width:24px;text-align:center}
.fde-row-main{flex:1;min-width:0}
.fde-row-top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.fde-row-label{font-size:13.5px;font-weight:600}
.fde-row-name{font-size:11px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-family:var(--ds-font-family-code,ui-monospace,monospace)}
.fde-row-desc{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:4px;line-height:1.7}
.fde-row-side{flex:none;display:flex;align-items:center;gap:8px;padding-top:1px}
.fde-chip{font-size:11px;line-height:1.6;border-radius:999px;padding:1px 10px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.fde-chip.update{color:#b7791f;border-color:color-mix(in srgb,#b7791f 45%,var(--dsw-alias-border-l2))}
.fde-chip.restart{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,var(--dsw-alias-border-l2))}
.fde-foot{font-size:11px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-family:var(--ds-font-family-code,ui-monospace,monospace);margin-top:18px;word-break:break-all}
.fde-spin{padding:28px 0;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:12px}
.fde-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 16px;font-size:12px;z-index:2147483600;box-shadow:0 4px 16px rgba(0,0,0,.18)}
`)

// ---------------------------------------------------------------------------
// 设置页区块
// ---------------------------------------------------------------------------

function FdeSettingsSection() {
  const h = React.createElement
  const [st, setSt] = React.useState(null)
  const [upd, setUpd] = React.useState(null) // 检查更新结果（null=还没查过）
  const [busy, setBusy] = React.useState(false) // 有安装/更新在进行
  const [checking, setChecking] = React.useState(false)
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

  const checkUpdates = React.useCallback(async () => {
    const d = await fetch(`${API}/check-updates`).then(readJson).catch(() => null)
    if (d && !d.error) setUpd(d)
    else showToast((d && d.error) || '检查更新失败')
    return d
  }, [])

  React.useEffect(() => { refresh() }, [refresh])

  const afterMutate = async () => {
    await refresh()
    if (upd) checkUpdates() // 查过更新就静默刷新最新版信息
  }

  const mutate = async (path, names, focusName) => {
    if (busy || !names.length) return
    setBusy(true)
    setBusyName(focusName || '*')
    try {
      const r = await fetch(`${API}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ names }),
      }).then(readJson).catch(() => null)
      if (!r) showToast('请求失败')
      else if (r.error) showToast(r.error)
      await afterMutate()
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
  const outdated = upd ? upd.pack.filter((p) => p.outdated && (!st || st.pack.some((s) => s.name === p.name && s.installed))) : []
  const updByName = new Map(upd ? upd.pack.map((r) => [r.name, r]) : [])
  const pnpmReady = st ? !(st.pnpm && st.pnpm.ready === false) : true

  return h('div', null,
    h('div', { className: 'fde-top' },
      st && st.profile && h('span', { className: 'fde-hchip' }, st.profile.name || ''),
      st && h('span', { className: 'fde-hchip' }, `${st.installedCount}/${st.pack.length} 已装`),
      st && st.requiredMissing > 0 && h('span', { className: 'fde-chip update' }, '必装未装'),
      upd && upd.outdatedCount > 0 && h('span', { className: 'fde-chip update' }, `${upd.outdatedCount} 个可更新`),
      h('span', { className: 'fde-spacer' }),
      h('button', { className: 'fde-btn', disabled: checking || busy, onClick: checkUpdates }, checking ? '检查中…' : '检查更新'),
      outdated.length > 0 && pnpmReady && h('button', {
        className: 'fde-btn primary', disabled: busy,
        onClick: () => mutate('update', outdated.map((p) => p.name)),
      }, busy ? '安装中…' : `更新 ${outdated.length} 个`),
      st && missing.length > 0 && pnpmReady && h('button', {
        className: 'fde-btn primary', disabled: busy,
        onClick: () => mutate('install', missing.map((p) => p.name)),
      }, busy ? '安装中…' : `补装 ${missing.length} 个`),
    ),
    st && st.error && h('div', { className: 'fde-banner err' }, st.error),
    st && st.pnpm && st.pnpm.ready === false && h('div', { className: 'fde-banner err' }, st.pnpm.error),
    st && st.needsRestartCount > 0 && h('div', { className: 'fde-banner' },
      h('span', null, '重启 dsh 后生效'),
      st.restart && st.restart.command && h('code', { className: 'fde-code' }, st.restart.command),
      st.restart && st.restart.command && h('button', { className: 'fde-copy', onClick: () => doCopy(st.restart.command) }, '复制'),
    ),
    !st && h('div', { className: 'fde-spin' }, '读取中…'),
    st && st.pack.map((p) => {
      const u = updByName.get(p.name)
      return h('div', { className: 'fde-row', key: p.name },
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
          p.installed && !p.needsRestart && u && u.outdated && h('span', { className: 'fde-chip update' }, `已装 ${p.version || ''} → ${u.latest}`.trim()),
          p.installed && !p.needsRestart && !(u && u.outdated) && h('span', { className: 'fde-chip' }, `已装 ${p.version || ''}`.trim()),
          p.installed && u && u.outdated && pnpmReady && h('button', {
            className: 'fde-btn primary', disabled: busy,
            onClick: () => mutate('update', [p.name], p.name),
          }, busy && busyName === p.name ? '更新中…' : '更新'),
          !p.installed && pnpmReady && h('button', {
            className: 'fde-btn primary', disabled: busy,
            onClick: () => mutate('install', [p.name], p.name),
          }, busy && busyName === p.name ? '安装中…' : '安装'),
          !p.installed && !pnpmReady && h('span', { className: 'fde-chip' }, '未安装'),
        ),
      )
    }),
    st && st.profile && h('div', { className: 'fde-foot' }, st.profile.dir),
    toast && h('div', { className: 'fde-toast' }, toast),
  )
}

module.exports = {
  name: '@weibaohui/dsh-fde-tools',
  inject: ['slots'],

  apply(ctx) {
    // 不 return 任何值（cordis-plugin-loader 把 apply 返回值当 disposable/effect）。
    const slots = ctx.get('slots')
    if (slots === undefined) return

    // 设置页「FDE 工具箱」区块（dsh-kb 同款槽位注册）
    try {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: '@weibaohui/dsh-fde-tools',
        order: 66,
        label: () => 'FDE 工具箱',
        inject: () => ({}),
      }, function FdeToolsSettingsSlot() {
        return React.createElement(FdeSettingsSection)
      }))
    } catch (e) { console.error('[dsh-fde-tools] settings section inject:', e) }
  },
}
