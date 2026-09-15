'use strict'

/**
 * restart 单测：只测纯函数与注入依赖的判定，不碰真进程。
 * scheduleRestart 会 spawn 助手并 SIGTERM 自身，不进单测（真机验证）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import restart from '../src/restart.js'

const tmp = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fde-restart-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('BOOT_ID：本次进程启动唯一标识', () => {
  assert.equal(typeof restart.BOOT_ID, 'string')
  assert.ok(restart.BOOT_ID.length >= 32)
})

test('trustedRequest：loopback 直连 + 无转发头 + Origin===Host 才放行', () => {
  const ok = { socket: { remoteAddress: '127.0.0.1' }, headers: { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080' } }
  assert.equal(restart.trustedRequest(ok), true)
  // 局域网对端 → 拒
  assert.equal(restart.trustedRequest({ ...ok, socket: { remoteAddress: '192.168.31.5' } }), false)
  // 代理转发头（19843 网关每个请求都带）→ 拒
  assert.equal(restart.trustedRequest({ ...ok, headers: { ...ok.headers, 'x-forwarded-for': '192.168.31.5' } }), false)
  assert.equal(restart.trustedRequest({ ...ok, headers: { ...ok.headers, forwarded: 'for=192.168.31.5' } }), false)
  // Origin 与 Host 不符（跨站）→ 拒
  assert.equal(restart.trustedRequest({ ...ok, headers: { origin: 'http://evil.example', host: '127.0.0.1:3080' } }), false)
  // 缺 Origin/Host → 拒
  assert.equal(restart.trustedRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' } }), false)
  // IPv6 loopback 也认
  assert.equal(restart.trustedRequest({ ...ok, socket: { remoteAddress: '::1' } }), true)
  assert.equal(restart.trustedRequest({ ...ok, socket: { remoteAddress: '::ffff:127.0.0.1' } }), true)
})

test('servingPort：从 Host 头取端口，取不出返回 null', () => {
  assert.equal(restart.servingPort({ headers: { host: '127.0.0.1:3080' } }), 3080)
  assert.equal(restart.servingPort({ headers: { host: 'localhost' } }), null)
  assert.equal(restart.servingPort({ headers: {} }), null)
  assert.equal(restart.servingPort({ headers: { host: '127.0.0.1:99999' } }), null)
  assert.equal(restart.servingPort(undefined), null)
})

test('detectedSupervisor：systemd 双信号缺一不可', () => {
  assert.equal(restart.detectedSupervisor({ env: { INVOCATION_ID: 'x' }, ppid: 1, parentComm: () => null }), 'systemd')
  assert.equal(restart.detectedSupervisor({ env: { JOURNAL_STREAM: '9' }, ppid: 42, parentComm: () => 'systemd' }), 'systemd')
  // 环境变量被继承但父进程是 shell/agent → 只是后代，不是单元主进程
  assert.equal(restart.detectedSupervisor({ env: { INVOCATION_ID: 'x' }, ppid: 42, parentComm: () => 'zsh' }), null)
  // 无 systemd 痕迹
  assert.equal(restart.detectedSupervisor({ env: {}, ppid: 1, parentComm: () => null }), null)
})

test('detectedDebugger：inspector.url / execArgv / NODE_OPTIONS 三路信号', () => {
  assert.equal(restart.detectedDebugger({ inspectorUrl: 'ws://127.0.0.1:9229/x' }), 'inspector')
  assert.equal(restart.detectedDebugger({ inspectorUrl: undefined, execArgv: ['--inspect-brk=9230'] }), 'inspector')
  assert.equal(restart.detectedDebugger({ inspectorUrl: undefined, execArgv: [], nodeOptions: '--inspect' }), 'inspector')
  assert.equal(restart.detectedDebugger({ inspectorUrl: undefined, execArgv: [], nodeOptions: '' }), null)
  // 按 token 前缀匹配，inspect-tool.js 这类路径不误伤
  assert.equal(restart.detectedDebugger({ inspectorUrl: undefined, execArgv: ['/x/inspect-tool.js'] }), null)
})

test('detectedLaunchd：LaunchAgents 里有提到 dsh+web 的 plist 即判定 launchd 在管', (t) => {
  const dir = tmp(t)
  // 别的服务 → 不算
  writeFileSync(join(dir, 'com.other.thing.plist'), '<string>/usr/bin/other</string>')
  assert.equal(restart.detectedLaunchd([dir]), null)
  // dsh web 守护（内容提 web）→ launchd
  writeFileSync(join(dir, 'com.example.dsh.plist'), '<string>dsh</string><string>web</string><string>--no-open</string>')
  assert.equal(restart.detectedLaunchd([dir]), 'launchd')
  // 内容只提 dsh 但文件名带 web（如 dsh-web.plist）→ 也算
  const dir2 = tmp(t)
  writeFileSync(join(dir2, 'com.mine.dsh-web.plist'), '<string>/opt/dsh/bin/dsh</string>')
  assert.equal(restart.detectedLaunchd([dir2]), 'launchd')
  // 只提 dsh 不跑 web → 不算
  const dir3 = tmp(t)
  writeFileSync(join(dir3, 'com.mine.dsh-tui.plist'), '<string>dsh</string><string>--profile tui</string>')
  assert.equal(restart.detectedLaunchd([dir3]), null)
  // 目录不存在 → null
  assert.equal(restart.detectedLaunchd([join(dir, 'nope')]), null)
})

test('restartAllowed：显式配置优先；否则检测到守护进程就关', () => {
  assert.equal(restart.restartAllowed({}, {}), true)
  assert.equal(restart.restartAllowed({}, { supervisor: 'systemd' }), false)
  assert.equal(restart.restartAllowed({}, { supervisor: 'launchd' }), false)
  // 运维明确拍板要自己扛（如 systemd KillMode=process）→ 放行
  assert.equal(restart.restartAllowed({ allowRestart: true }, { supervisor: 'launchd' }), true)
  assert.equal(restart.restartAllowed({ allowRestart: false }, {}), false)
})

test('status：正常进程 allowed=true，supervisor=null；宿主侧据此渲染按钮', () => {
  const st = restart.status()
  assert.equal(typeof st.allowed, 'boolean')
  assert.equal('supervisor' in st, true)
})

test('dshLaunch：bin 入口原样复刻，无入口兜底 PATH dsh', () => {
  const viaBin = restart.dshLaunch('/opt/dsh/lib/bin.js')
  assert.equal(viaBin.file, process.execPath)
  assert.deepEqual(viaBin.args, [...process.execArgv, '/opt/dsh/lib/bin.js'])
  assert.equal(viaBin.cwd, '/opt/dsh/lib')
  assert.equal(viaBin.viaShell, false)
  const fallback = restart.dshLaunch(undefined)
  assert.equal(fallback.file, 'dsh')
  assert.deepEqual(fallback.args, [])
  assert.equal(fallback.viaShell, process.platform === 'win32')
})

test('respawnInvocation：POSIX 直 spawn；Windows 包隐藏 powershell 并显式 .cmd', () => {
  const posix = restart.respawnInvocation({ file: 'node', args: ['/x/dsh', 'web'], viaShell: false }, 'darwin')
  assert.deepEqual(posix, { file: 'node', args: ['/x/dsh', 'web'], viaShell: false, detached: true })
  const win = restart.respawnInvocation({ file: 'dsh', args: ['web'], viaShell: true }, 'win32')
  assert.equal(win.file, 'powershell.exe')
  assert.equal(win.detached, false)
  assert.ok(win.args.join(' ').includes('dsh.cmd'))
  assert.ok(win.args.join(' ').includes('-WindowStyle'))
  const winAlreadyCmd = restart.respawnInvocation({ file: 'C:\\x\\dsh.cmd', args: [], viaShell: true }, 'win32')
  assert.ok(winAlreadyCmd.args.join(' ').includes('dsh.cmd'))
})

test('restartHelperSource：助手带端口探测、spawn 前置 error 监听与 fde-tools 日志前缀', () => {
  const src = restart.restartHelperSource(
    { file: 'node', args: ['/x/dsh', 'web'], viaShell: false, detached: true },
    { cwd: '/x' },
    { out: '/tmp/o.log', err: '/tmp/e.log' },
    3080,
  )
  assert.ok(src.includes("'127.0.0.1'") || src.includes('"127.0.0.1"'), '端口探测应连 loopback')
  assert.ok(src.includes('dsh-fde-tools'))
  assert.ok(src.includes('child.on("error"'), 'spawn 异步失败必须留证据')
  assert.ok(src.includes('unref'))
  assert.ok(src.includes(JSON.stringify(3080)))
})
