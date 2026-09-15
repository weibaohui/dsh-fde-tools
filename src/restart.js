'use strict'

/**
 * @weibaohui/dsh-fde-tools — 一键重启（机制移植自 dsh-market 的 src/restart.ts）。
 *
 * 自重启 = 自杀 + 接管：spawn 一个脱离父子关系的 node 助手进程，老宿主对自己
 * 发 SIGTERM；助手等宿主端口真正释放（connect 探测，不靠猜延时），再用启动
 * 时的原样参数拉起新宿主，并确认 20s 内 bind 成功，失败写诊断到 /tmp——重启
 * 失败必须留证据，因为会写日志的那个进程恰恰是刚死的那个。
 *
 * 安全模型（沿袭 dsh-market，缺一即拒）：
 *  - 只接受本机直连请求：TCP 对端是 loopback、无任何代理转发头、Origin===Host；
 *  - 调试器附着时拒杀宿主；
 *  - 守护进程（systemd/launchd）在管时停用——dsh-market 只识别 systemd，这里
 *    补上 launchd：扫 LaunchAgents/Daemons 里提到 dsh+web 的 plist（macOS 无
 *    systemd 式环境变量标记，只能靠这个；误判方向是「多停用」，安全）。
 */

const { spawn } = require('node:child_process')
const { existsSync, readFileSync, readdirSync } = require('node:fs')
const inspector = require('node:inspector')
const { randomUUID } = require('node:crypto')
const { homedir, tmpdir } = require('node:os')
const { dirname, isAbsolute, join, resolve } = require('node:path')

/** 本次进程启动的唯一标识；客户端靠它变没变判断新宿主是否已经起来。 */
const BOOT_ID = randomUUID()

const INSPECT_ARG_PREFIXES = ['--inspect', '--inspect-brk', '--inspect-port', '--inspect-wait']

function tokenHasInspectFlag(token) {
  for (const prefix of INSPECT_ARG_PREFIXES) {
    if (token === prefix || token.startsWith(`${prefix}=`)) return true
  }
  return token === '--debug-brk' || token.startsWith('--debug-brk=') || token === '--debug' || token.startsWith('--debug=')
}

function argvHasInspectFlag(tokens) {
  return tokens.some((token) => tokenHasInspectFlag(token))
}

/**
 * 宿主进程是否被调试器附着（'inspector' | null）。主信号 inspector.url()，
 * 次信号 execArgv/NODE_OPTIONS 里的 inspect 族旗标（按 token 前缀匹配，
 * 不做子串，防 …/inspect-tool.js 这类路径误伤）。
 */
function detectedDebugger({ inspectorUrl = inspector.url(), execArgv = process.execArgv, nodeOptions = process.env.NODE_OPTIONS ?? '' } = {}) {
  if (inspectorUrl !== undefined && inspectorUrl !== '') return 'inspector'
  if (argvHasInspectFlag(execArgv)) return 'inspector'
  const options = nodeOptions.trim()
  if (options !== '' && argvHasInspectFlag(options.split(/\s+/))) return 'inspector'
  return null
}

/** /proc 里 pid 的 comm，读不到（非 Linux）返回 null。 */
function readParentComm(pid) {
  try { return readFileSync(`/proc/${String(pid)}/comm`, 'utf8').trim() } catch { return null }
}

/**
 * systemd 在管吗（'systemd' | null）。双信号缺一不可：INVOCATION_ID/JOURNAL_STREAM
 * 会被 systemd 单元的所有后代继承（普通终端、CI runner 都带），单看会误伤；
 * 还要父进程是 PID 1 或 comm=systemd，才算单元自己的主进程。
 */
function detectedSupervisor({ env = process.env, ppid = process.ppid, parentComm = readParentComm } = {}) {
  const set = (name) => (env[name] ?? '') !== ''
  if (!set('INVOCATION_ID') && !set('JOURNAL_STREAM')) return null
  if (ppid === 1 || parentComm(ppid) === 'systemd') return 'systemd'
  return null
}

/** launchd 候选目录：用户级 LaunchAgents + 系统级 LaunchAgents/Daemons。 */
function launchDirs(platform = process.platform, home = homedir()) {
  if (platform !== 'darwin') return []
  return [join(home, 'Library', 'LaunchAgents'), '/Library/LaunchAgents', '/Library/LaunchDaemons']
}

/**
 * launchd 在管吗（'launchd' | null）：任一 plist 内容提到 dsh 且（内容或文件名）
 * 提到 web，即视为此宿主由 launchd 守护。KeepAlive 与否不再细分——有守护就交给
 * 守护进程，宁可不给按钮，也不冒 KeepAlive 打架 crash loop 的险。
 */
function detectedLaunchd(dirs = launchDirs()) {
  for (const dir of dirs) {
    let names = []
    try { names = readdirSync(dir) } catch { continue }
    for (const name of names) {
      if (!name.endsWith('.plist')) continue
      let text
      try { text = readFileSync(join(dir, name), 'utf8') } catch { continue }
      if (!/\bdsh\b/.test(text)) continue
      if (/web/i.test(text) || /web/i.test(name)) return 'launchd'
    }
  }
  return null
}

/**
 * 一键重启开不开。显式 allowRestart 优先（留给将来接配置）；否则检测到任何
 * 守护进程（systemd/launchd）就关——重启是守护进程的职权。
 */
function restartAllowed(config = {}, detected = {}) {
  if (config.allowRestart !== undefined) return !!config.allowRestart
  return !detected.supervisor
}

/** 宿主进程实际伺服的端口：从请求的 Host 头取（浏览器实际到达的端口，替身要接的就是它）。 */
function servingPort(request) {
  const host = request && request.headers && request.headers.host
  if (host === undefined) return null
  const match = /:(\d{1,5})$/.exec(host)
  if (match === null) return null
  const port = Number(match[1])
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null
}

/** 进程控制类请求可信吗：loopback 对端 + 无转发头（有就是代理不是用户）+ Origin===Host。 */
function trustedRequest(request) {
  const address = request && request.socket && request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const headers = (request && request.headers) || {}
  if (headers.forwarded !== undefined || headers['x-forwarded-for'] !== undefined || headers['x-real-ip'] !== undefined) return false
  const origin = headers.origin
  const host = headers.host
  if (origin === undefined || host === undefined) return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
  } catch { return false }
}

/** 拉起子进程用的真 node：argv0 是存在的绝对路径就优先（Android linker64 场景），否则 execPath。 */
function nodeExecutable(argv0 = process.argv0, execPath = process.execPath) {
  if (argv0 !== undefined && argv0 !== '' && isAbsolute(argv0) && existsSync(argv0)) return argv0
  return execPath
}

/**
 * 复刻本次宿主的启动方式：全局 bin/本地安装/仓库源码直跑都能原样重来
 * （process.argv[1] 入口 + execArgv + 入口目录当 cwd），兜底 PATH 里的 dsh。
 */
function dshLaunch(entry = process.argv[1]) {
  if (entry !== undefined && /[\\/](?:bin\.(?:js|ts)|dsh)$/.test(entry)) {
    const abs = resolve(entry)
    return { file: nodeExecutable(), args: [...process.execArgv, abs], cwd: dirname(abs), viaShell: false }
  }
  return { file: 'dsh', args: [], cwd: undefined, viaShell: process.platform === 'win32' }
}

/**
 * 替身进程的拉起方式：POSIX 直接 detached spawn；Windows 的 detached 无控制台，
 * 其子孙进程（沙箱工具等）会弹可见 node 窗口，包一层 powershell -WindowStyle
 * Hidden 给一个可继承的隐藏控制台；裸 dsh 会命中 dsh.ps1 被 Restricted 策略拒，
 * 显式用不受脚本策略管的 dsh.cmd。
 */
function respawnInvocation(launch, platform = process.platform) {
  if (platform !== 'win32') {
    return { file: launch.file, args: launch.args, viaShell: launch.viaShell, detached: true }
  }
  const quote = (part) => `'${part.replace(/'/g, "''")}'`
  const file = launch.viaShell && !/\.(?:cmd|bat)$/i.test(launch.file) ? `${launch.file}.cmd` : launch.file
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
      [`& ${quote(file)}`, ...launch.args.map(quote)].join(' ')],
    viaShell: false,
    detached: false,
  }
}

/** 助手进程源码：等端口安静 → 拉起替身 → 确认起来了；每一步失败都写诊断日志。 */
function restartHelperSource(spawned, launch, logs, port) {
  return [
    "const { spawn } = require('node:child_process')",
    "const fs = require('node:fs')",
    "const net = require('node:net')",
    `const file = ${JSON.stringify(spawned.file)}`,
    `const args = ${JSON.stringify(spawned.args)}`,
    `const cwd = ${JSON.stringify(launch.cwd)}`,
    `const viaShell = ${JSON.stringify(spawned.viaShell)}`,
    `const detached = ${JSON.stringify(spawned.detached)}`,
    `const logOut = ${JSON.stringify(logs.out)}`,
    `const logErr = ${JSON.stringify(logs.err)}`,
    `const port = ${JSON.stringify(port)}`,
    'const sleep = (ms) => new Promise(r => setTimeout(r, ms))',
    'const note = (line) => { try { fs.appendFileSync(logErr, `[dsh-fde-tools] ${line}\\n`) } catch {} }',
    // 「安静」= 没人接受连接。用 connect 探测而不是 bind 试探：bind 测试本身
    // 会占住端口，恰好在替身要用的那一瞬。
    'const listening = () => new Promise((resolve) => {',
    '  const probe = net.connect({ host: "127.0.0.1", port })',
    '  const done = (value) => { probe.destroy(); resolve(value) }',
    '  probe.on("connect", () => done(true))',
    '  probe.on("error", () => done(false))',
    '  setTimeout(() => done(false), 500)',
    '})',
    'const main = async () => {',
    '  if (port) {',
    '    const until = Date.now() + 30000',
    '    while (Date.now() < until && await listening()) await sleep(250)',
    '    if (await listening()) note(`port ${port} was still in use after 30s; starting anyway`)',
    // 刚释放的 socket 在 Windows 上可能还在 TIME_WAIT。
    '    await sleep(300)',
    '  } else {',
    '    await sleep(1500)',
    '  }',
    '  let child',
    '  try {',
    '    const out = fs.openSync(logOut, "a")',
    '    const err = fs.openSync(logErr, "a")',
    '    child = spawn(file, args, { cwd, detached, stdio: ["ignore", out, err], env: process.env, shell: viaShell })',
    // spawn 报「文件不存在/不可执行」是异步事件；下面 try/catch 只兜同步 throw。
    '    child.on("error", (error) => note(`could not start the replacement: ${error && error.message ? error.message : error}`))',
    '    child.unref()',
    '  } catch (error) {',
    '    note(`could not start the replacement: ${error && error.message ? error.message : error}`)',
    '    return',
    '  }',
    // 活到 spawn 之后在 Windows 上要紧：替身还在同进程组没 detach 完，助手秒退
    // 可能把它一起带走。有端口时下面的轮询本身就是逗留，这里是无线程可轮询路径的同一保障。
    "  if (!port) { await sleep(3000); return }",
    '  const upBy = Date.now() + 20000',
    '  while (Date.now() < upBy && !(await listening())) await sleep(500)',
    '  if (!(await listening())) note(`the replacement did not bind port ${port} within 20s — see the output log beside this one`)',
    '}',
    'main()',
  ].join('\n')
}

/**
 * 安排重启：detached 助手 + 老进程 500ms 后自杀。助手必须在替身 spawn 之外独立
 * 存活，且等端口真正释放再动手，而不是猜一个延时。
 */
function scheduleRestart(port = null) {
  const launch = dshLaunch()
  const spawned = respawnInvocation({ ...launch, args: [...launch.args, ...process.argv.slice(2)], cwd: launch.cwd ?? process.cwd() })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const logOut = join(tmpdir(), `dsh-fde-tools-restart-${stamp}.out.log`)
  const logErr = join(tmpdir(), `dsh-fde-tools-restart-${stamp}.err.log`)
  const helper = spawn(nodeExecutable(), ['-e', restartHelperSource(spawned, { cwd: launch.cwd ?? process.cwd() }, { out: logOut, err: logErr }, port)], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  })
  helper.unref()
  setTimeout(() => process.kill(process.pid, 'SIGTERM'), 500)
  return { pid: process.pid, helperPid: helper.pid, logOut, logErr }
}

/** status 接口的重启块：allowed 决定客户端给不给按钮，supervisor 用于解释为什么没有。 */
function status() {
  const supervisor = detectedSupervisor() || (process.platform === 'darwin' ? detectedLaunchd() : null)
  return { allowed: restartAllowed(undefined, { supervisor }), supervisor }
}

module.exports = {
  BOOT_ID,
  detectedDebugger,
  detectedSupervisor,
  detectedLaunchd,
  launchDirs,
  restartAllowed,
  servingPort,
  trustedRequest,
  nodeExecutable,
  dshLaunch,
  respawnInvocation,
  restartHelperSource,
  scheduleRestart,
  status,
}
