'use strict'

/**
 * @weibaohui/dsh-fde-tools — 安装器（宿主侧纯模块，不依赖宿主服务，可在宿主外单测）。
 *
 * 职责：找到本插件所属的 dsh profile → 检查全家桶成员安装状态 → 缺什么 pnpm add 什么
 * → 把成员追加进 dsh.profile.bundles → 快照/比对/自动还原被 pnpm 清掉的 link: 依赖。
 *
 * 为什么 bundles 要自己追加：`dsh plugin add` 的 reconcile 按「profile 直接依赖 +
 * 安装态」补 bundles；本模块绕开 CLI 直接驱动 pnpm，等价逻辑在这里复刻（成员全部
 * 声明 dsh.bundle，见 PACK；发布时已用 npm view 核实）。
 *
 * 为什么要有快照还原：本机历史上 pnpm 在 profile 里跑 add 会顺带清掉不在锁定文件里
 * 的 link: 依赖（三次复发实录），装完 diff 一轮，丢了就按快照原样补回再 pnpm install。
 */

const { existsSync, readdirSync, readFileSync, writeFileSync, realpathSync } = require('node:fs')
const { homedir, userInfo } = require('node:os')
const { dirname, join } = require('node:path')
const { execFile } = require('node:child_process')

const SELF_NAME = '@weibaohui/dsh-fde-tools'

/** 全家桶成员清单：加一行即扩包（range 用发版时的 npm latest 加 ^）。 */
const PACK = [
  {
    name: '@weibaohui/dsh-git-server',
    range: '^0.1.0',
    icon: '📦',
    label: '代码仓库',
    desc: 'Git 服务器：HTTP clone/push、网页端、issue/PR，可复用登录账号',
  },
  {
    name: '@weibaohui/dsh-webdav-server',
    range: '^0.1.1',
    icon: '📁',
    label: '挂载盘',
    desc: '把共享目录变成 Windows/macOS/Linux 都能挂载的本地磁盘（WebDAV）',
  },
  {
    name: '@weibaohui/dsh-kb',
    range: '^0.7.2',
    icon: '📚',
    label: '知识库',
    desc: '团队知识库：浏览 / 全文检索 / raw 入料自动蒸馏成文',
  },
  {
    name: '@weibaohui/dsh-tasks',
    range: '^0.4.5',
    icon: '⏰',
    label: '定时任务',
    desc: 'cron 定时执行提示词，到点自动开新 agent 会话干活',
  },
  {
    name: '@weibaohui/dsh-continue',
    range: '^0.3.0',
    icon: '🔁',
    label: '自动续跑',
    desc: '会话中断自动续上：退避重试 / 换模型 / 压缩上下文',
  },
  {
    name: '@weibaohui/dsh-settings-ui',
    range: '^0.2.2',
    icon: '🎨',
    label: '界面微调',
    desc: '设置窗口大小 / 透明度 / 背景（主题或纯色）自定义',
  },
  {
    name: '@weibaohui/hermes-loop',
    range: '^0.1.8',
    icon: '🪞',
    label: '自动复盘',
    desc: '对话收尾自动复盘，把经验蒸馏成可复用的技能存入技能库',
  },
  {
    name: '@weibaohui/dsh-file-share',
    range: '^0.3.0',
    icon: '🗂️',
    label: '文件管理',
    desc: '会话工作区文件管理：文件树 / 预览 / 上传下载 / 打包 zip / @ 给 agent',
  },
  {
    name: '@weibaohui/dsh-smart-title',
    range: '^0.1.1',
    icon: '🏷️',
    label: '会话智能标题',
    desc: '用 LLM 自动改写会话标题，告别「第一行」式标题',
  },
  {
    name: 'dsh-taskboard',
    range: '^0.7.1',
    icon: '📋',
    label: '任务看板',
    desc: 'Agent 优先的任务看板：任务账本 + taskboard_* 工具 + 每任务独立会话，可选 worktree 隔离',
  },
  {
    name: 'dshmarket',
    range: '^1.45.1',
    icon: '🛒',
    label: '插件市场',
    desc: '可视化插件市场：逛一逛，点一下，装好',
  },
  {
    name: 'dsh-context',
    range: '^0.50.0',
    icon: '🧠',
    label: '上下文仪表盘',
    desc: '上下文洞察与管理：仪表盘 + /context 命令，看清上下文由什么组成、怎么演化',
  },
  {
    name: '@xmanrui/dsh-im',
    range: '^4.20.1',
    icon: '💬',
    label: 'IM 接入',
    desc: '把十一种 IM 渠道和公网 AI Office 接入本机 Harness',
  },
  {
    name: 'dsh-better-sidebar',
    range: '^0.19.1',
    icon: '🧭',
    label: '侧栏增强',
    desc: 'VSCode 式右侧边栏（资源管理器/编辑器/终端/git/浏览器），按会话隔离，可注册扩展标签页',
  },
]

function packEntry(name) {
  return PACK.find((p) => p.name === name) || null
}

// ---------------------------------------------------------------------------
// profile 定位
// ---------------------------------------------------------------------------

function dshHome(env = process.env) {
  return env.DSH_HOME || join(homedir(), '.dsh')
}

/**
 * 找出装载了本插件的 profile：扫描 ~/.dsh/profiles 下各 profile 的
 * node_modules/@weibaohui/dsh-fde-tools。
 * link: 安装时 __dirname 已是仓 realpath，因此优先挑 realpath 与自身包目录一致的
 * profile，退化取第一个候选。env.DSH_FDE_TOOLS_PROFILE 可指名（profile 名或绝对路径）。
 */
function findProfile(env = process.env, fs = { existsSync, readdirSync, realpathSync }) {
  const probe = (dir) => {
    if (!dir || !fs.existsSync(join(dir, 'package.json'))) return null
    const pkgDir = join(dir, 'node_modules', ...SELF_NAME.split('/'))
    if (!fs.existsSync(pkgDir)) return null
    let real = null
    try { real = fs.realpathSync(pkgDir) } catch { /* 比对不了就当普通候选 */ }
    return { pkgDir, real }
  }

  let selfReal = null
  try { selfReal = fs.realpathSync(join(__dirname, '..')) } catch { /* 自身拿不到 realpath 就不做精确匹配 */ }

  // env 指名（profile 名或绝对路径）→ 只看它
  if (env.DSH_FDE_TOOLS_PROFILE) {
    const raw = env.DSH_FDE_TOOLS_PROFILE
    const dir = raw.includes('/') ? raw : join(dshHome(env), 'profiles', raw)
    const hit = probe(dir)
    return hit ? { name: env.DSH_FDE_TOOLS_PROFILE.includes('/') ? dir : raw, dir: dir } : null
  }

  const profilesDir = join(dshHome(env), 'profiles')
  let names = []
  try { names = fs.readdirSync(profilesDir).filter((n) => !n.startsWith('.')) } catch { /* 没有 profiles 目录 */ }

  const candidates = []
  for (const name of names) {
    const dir = join(profilesDir, name)
    const hit = probe(dir)
    if (hit) candidates.push({ name: name, dir: dir, real: hit.real })
  }
  if (candidates.length === 0) return null
  const exact = selfReal && candidates.find((c) => c.real === selfReal)
  return exact || candidates[0]
}

// ---------------------------------------------------------------------------
// profile package.json 读写
// ---------------------------------------------------------------------------

function readManifest(profileDir) {
  return JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
}

function writeManifest(profileDir, manifest) {
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
}

function manifestBundles(manifest) {
  return (manifest.dsh && manifest.dsh.profile && Array.isArray(manifest.dsh.profile.bundles))
    ? manifest.dsh.profile.bundles
    : []
}

/** 把成员追加进 dsh.profile.bundles（幂等，保留 manifest 其余字段）。 */
function ensureBundles(profileDir, names) {
  const manifest = readManifest(profileDir)
  const bundles = manifestBundles(manifest).slice()
  let changed = false
  for (const name of names) {
    if (!bundles.includes(name)) {
      bundles.push(name)
      changed = true
    }
  }
  if (!changed) return false
  manifest.dsh = {
    ...manifest.dsh,
    profile: { ...(manifest.dsh ? manifest.dsh.profile : {}), bundles: bundles },
  }
  writeManifest(profileDir, manifest)
  return true
}

/** 宿主 apply 时拍一次：boot 时各成员的 bundles 在位情况与版本（之后装的/更的不算，用于待重启判定）。 */
function captureBootState(profileDir) {
  const dir = profileDir || (findProfile() ? findProfile().dir : null)
  const empty = { bundles: new Set(), versions: new Map() }
  if (!dir) return empty
  try {
    const manifest = readManifest(dir)
    const bundles = new Set(manifestBundles(manifest))
    const deps = manifest.dependencies || {}
    const versions = new Map()
    for (const name of [SELF_NAME, ...PACK.map((p) => p.name)]) {
      if (deps[name] !== undefined) {
        const v = installedVersion(dir, name)
        if (v) versions.set(name, v)
      }
    }
    return { bundles: bundles, versions: versions }
  } catch {
    return empty
  }
}

function childPkgDir(profileDir, name) {
  return join(profileDir, 'node_modules', ...name.split('/'))
}

function installedVersion(profileDir, name) {
  try {
    return JSON.parse(readFileSync(join(childPkgDir(profileDir, name), 'package.json'), 'utf8')).version || null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// pnpm 定位
// ---------------------------------------------------------------------------

let pnpmResult = null // { ready: true, file, baseArgs, source } | { ready: false, error }；探测中为 null
let pnpmPromise = null

/** 默认执行实现：execFile 收 stdout/stderr，返回 { code, stdout, stderr }。 */
function defaultRun(file, args, cwd, timeout) {
  return new Promise((resolve) => {
    execFile(file, args, { cwd: cwd, timeout: timeout, maxBuffer: 16 * 1024 * 1024, shell: false }, (error, stdout, stderr) => {
      if (error && error.killed) {
        resolve({ code: -1, stdout: String(stdout || ''), stderr: String(stderr || '') + `\n${file} 超时（${timeout}ms）` })
        return
      }
      resolve({ code: error && typeof error.code === 'number' ? error.code : (error ? 1 : 0), stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}

async function probePnpm(run) {
  const candidates = []
  if (process.env.DSH_FDE_TOOLS_PNPM) candidates.push({ file: process.env.DSH_FDE_TOOLS_PNPM, baseArgs: [], source: 'env DSH_FDE_TOOLS_PNPM' })
  candidates.push({ file: 'pnpm', baseArgs: [], source: 'PATH' })
  const localBin = join(homedir(), '.local', 'bin', 'pnpm')
  if (existsSync(localBin)) candidates.push({ file: localBin, baseArgs: [], source: localBin })
  const prefix = dirname(dirname(process.execPath))
  const script = join(prefix, 'lib', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
  if (existsSync(script)) candidates.push({ file: process.execPath, baseArgs: [script], source: script })
  for (const c of candidates) {
    const r = await run(c.file, [...c.baseArgs, '--version'], process.cwd(), 15000)
    if (r.code === 0) return { file: c.file, baseArgs: c.baseArgs, source: c.source }
  }
  return null
}

/** pnpm 解析结果缓存；未完成时返回 null（status 轮询不阻塞、不序列化 Promise）。 */
function pnpmState() {
  return pnpmResult
}

function ensurePnpm(run) {
  if (!pnpmPromise) {
    pnpmPromise = probePnpm(run || defaultRun).then((p) => {
      pnpmResult = p ? { ready: true, ...p } : { ready: false, error: 'pnpm 不可用（PATH 与常见位置均未找到，可设 DSH_FDE_TOOLS_PNPM 指路）' }
      return pnpmResult
    })
  }
  return pnpmPromise
}

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

/**
 * 通用重启命令探测：不写死任何人的配置。扫 ~/Library/LaunchAgents 全部 plist，
 * 找出内容里同时提到 dsh 与 web 的守护项，按其文件名（即 launchd label）生成
 * kickstart 命令；没有 launchd 守护（直接终端跑 dsh web 的）返回 null，UI 只给
 * 通用文案。
 */
function restartCommand(launchAgentsDir = join(homedir(), 'Library', 'LaunchAgents')) {
  if (process.platform !== 'darwin') return null
  let uid
  try { uid = userInfo().uid } catch { return null }
  let entries = []
  try { entries = readdirSync(launchAgentsDir).filter((n) => n.endsWith('.plist')) } catch { return null }
  for (const name of entries) {
    let text
    try { text = readFileSync(join(launchAgentsDir, name), 'utf8') } catch { continue }
    if (!/\bdsh\b/.test(text)) continue
    const mentionsWeb = /<string>[^<]*\bweb\b[^<]*<\/string>/.test(text) || /\bdsh\.web\b/.test(name)
    if (!mentionsWeb) continue
    return `launchctl kickstart -k gui/${uid}/${name.replace(/\.plist$/, '')}`
  }
  return null
}

/**
 * 全家桶状态。bootState 传 captureBootState 的结果（也兼容旧式 Set=bundles）；
 * 缺省视为空集（所有已装成员都会标 needsRestart，宁可贵一点也不漏提示）。
 */
function status(profileDir, bootState) {
  if (!profileDir) {
    const found = findProfile()
    profileDir = found ? found.dir : null
  }
  const base = {
    self: SELF_NAME,
    profile: null,
    pnpm: pnpmState(),
    restart: { command: restartCommand(), generic: '重启 dsh 后生效' },
    pack: [],
    installedCount: 0,
    missingCount: 0,
    needsRestartCount: 0,
  }
  if (!profileDir) return base
  let manifest
  try {
    manifest = readManifest(profileDir)
  } catch (error) {
    base.error = `读不到 profile manifest：${error && error.message}`
    return base
  }
  const deps = manifest.dependencies || {}
  const bundles = new Set(manifestBundles(manifest))
  const boot = bootState instanceof Set
    ? { bundles: bootState, versions: new Map() }
    : (bootState || { bundles: new Set(), versions: new Map() })
  base.profile = { name: findProfile() ? findProfile().name : null, dir: profileDir }
  base.pack = PACK.map((p) => {
    const spec = deps[p.name]
    const installed = spec !== undefined
    const version = installed ? installedVersion(profileDir, p.name) : null
    const inBundles = bundles.has(p.name)
    const bootVersion = boot.versions.get(p.name)
    return {
      name: p.name,
      icon: p.icon,
      label: p.label,
      desc: p.desc,
      range: p.range,
      spec: spec || null,
      installed: installed,
      version: version,
      inBundles: inBundles,
      needsRestart: installed && inBundles && (!boot.bundles.has(p.name) || (bootVersion !== undefined && bootVersion !== version)),
    }
  })
  base.installedCount = base.pack.filter((p) => p.installed).length
  base.missingCount = base.pack.length - base.installedCount
  base.needsRestartCount = base.pack.filter((p) => p.needsRestart).length
  return base
}

// ---------------------------------------------------------------------------
// 更新检查：semver 比较 + registry latest
// ---------------------------------------------------------------------------

/** 极简 semver 解析：v?主.次.补[-预发布][+构建]；解析不了返回 null。 */
function parseVer(v) {
  if (typeof v !== 'string') return null
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim())
  if (!m) return null
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : null }
}

/** semver 全序比较（预发布 < 正式；预发布段数字<字符串、缺段更小）；任一解析不了返回 0。 */
function cmpVer(a, b) {
  const pa = parseVer(a)
  const pb = parseVer(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1
  }
  if (pa.pre === null && pb.pre === null) return 0
  if (pa.pre === null) return 1
  if (pb.pre === null) return -1
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      const d = Number(x) - Number(y)
      if (d !== 0) return d < 0 ? -1 : 1
    } else if (xn !== yn) {
      return xn ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

function registryBase() {
  return (process.env.NPM_CONFIG_REGISTRY || process.env.npm_config_registry || 'https://registry.npmjs.org').replace(/\/+$/, '')
}

/** 查 dist-tag latest；网络/解析失败返回 null（不当作有更新）。 */
async function fetchLatest(name, fetchImpl) {
  const f = fetchImpl || globalThis.fetch
  if (typeof f !== 'function') return null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    const res = await f(`${registryBase()}/${encodeURIComponent(name)}/latest`, { signal: ctrl.signal, headers: { accept: 'application/json' } })
    clearTimeout(timer)
    if (!res.ok) return null
    const d = await res.json()
    return d && typeof d.version === 'string' ? d.version : null
  } catch {
    return null
  }
}

const LOCAL_SPEC_RE = /^(link:|file:|github:|git\+|git@)/

/** 是否提供更新：装着 registry 依赖、latest 查得到、确实更新，且不把正式版拽去预发布。 */
function outdatedReason(row) {
  if (!row.installed) return '未安装'
  if (row.source === 'local') return '源码安装，跳过更新'
  if (!row.latest) return '查不到最新版'
  if (cmpVer(row.version, row.latest) >= 0) return '已是最新'
  const pl = parseVer(row.latest)
  const pv = parseVer(row.version)
  if (pl && pl.pre !== null && pv && pv.pre === null) return '最新版是预发布，跳过'
  return null
}

/** SELF + PACK 逐个对 registry 查 latest；并行。opts._fetch 是测试缝。 */
async function checkUpdates(profileDir, opts = {}) {
  if (!profileDir) {
    const found = findProfile()
    profileDir = found ? found.dir : null
  }
  const base = { self: SELF_NAME, profile: null, registry: registryBase(), pack: [], outdatedCount: 0, error: null }
  if (!profileDir) {
    base.error = '找不到所属 profile（~/.dsh/profiles 下没有装着本插件的）'
    return base
  }
  let manifest
  try {
    manifest = readManifest(profileDir)
  } catch (error) {
    base.error = `读不到 profile manifest：${error && error.message}`
    return base
  }
  const deps = manifest.dependencies || {}
  base.profile = { name: findProfile() ? findProfile().name : null, dir: profileDir }
  const entries = [
    { name: SELF_NAME, icon: '🧰', label: 'FDE 工具箱', desc: '本插件（全家桶引导器）' },
    ...PACK,
  ]
  const rows = entries.map((p) => {
    const spec = deps[p.name]
    return {
      name: p.name,
      icon: p.icon,
      label: p.label,
      spec: spec || null,
      installed: spec !== undefined,
      source: spec === undefined ? null : (LOCAL_SPEC_RE.test(String(spec)) ? 'local' : 'registry'),
      version: spec === undefined ? null : installedVersion(profileDir, p.name),
      latest: null,
      outdated: false,
      reason: null,
    }
  })
  await Promise.all(rows.filter((r) => r.source === 'registry').map(async (r) => {
    r.latest = await fetchLatest(r.name, opts._fetch)
  }))
  for (const r of rows) {
    r.reason = outdatedReason(r)
    r.outdated = r.reason === null
  }
  base.pack = rows
  base.outdatedCount = rows.filter((r) => r.outdated).length
  return base
}

// ---------------------------------------------------------------------------
// 安装 / 更新
// ---------------------------------------------------------------------------

const SNAPSHOT_NAME = '.fde-tools-install-snapshot.json'

/** 从 pnpm 输出里抠被拦构建脚本的包名（如 better-sqlite3@11.10.0，逗号/空格分隔多个）。 */
function parseIgnoredBuilds(text) {
  const out = new Set()
  const re = /Ignored build scripts?:\s*([^\n]+)/g
  for (let m; (m = re.exec(text));) {
    for (const part of m[1].split(/[,\s]+/)) {
      if (part && part !== 'and' && part.includes('@')) out.add(part.replace(/[.,]$/, ''))
    }
  }
  return [...out]
}

/**
 * 把包写进 pnpm-workspace.yaml 的 allowBuilds。pnpm 11 的键必须带版本
 * （better-sqlite3@11.10.0: true 才生效；裸包名会被 pnpm 换成 "set this to true
 * or false" 占位串且不装），scoped 名是 @ 开头的裸标量非法，要加引号。
 * 无文件则按 dsh 的 profile 模板新建；段已存在时收集既有键补缺。
 * 返回是否有改动。
 */
function ensureAllowBuilds(profileDir, pkgs) {
  const key = (n) => (n.startsWith('@') ? `'${n}'` : n) // YAML 裸标量不能以 @ 开头
  const norm = (n) => n.replace(/^['"]|['"]$/g, '')
  const path = join(profileDir, 'pnpm-workspace.yaml')
  let text
  try { text = readFileSync(path, 'utf8') } catch {
    text = 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n'
  }
  const lines = text.replace(/\n+$/, '').split('\n')
  const header = 'allowBuilds:'
  const hi = lines.indexOf(header)
  if (hi >= 0) {
    let i = hi + 1
    const existing = new Set()
    const keep = []
    while (i < lines.length && /^\s+\S/.test(lines[i])) {
      const line = lines[i]
      const listItem = /^\s+-\s+(.+)$/.exec(line)
      const placeholder = /^\s+('[^']+'|[^:#\s]+):\s*set this to true or false\s*$/.exec(line)
      if (listItem) {
        keep.push(`  ${key(listItem[1].trim())}: true`) // 老式列表行换 map 行
      } else if (placeholder) {
        const name = norm(placeholder[1])
        existing.add(name)
        keep.push(`  ${key(name)}: true`) // pnpm 失败时自己插的占位提示行换成真布尔
      } else {
        const m = /^\s+([^:#]+)\s*:/.exec(line)
        if (m) existing.add(norm(m[1].trim()))
        keep.push(line)
      }
      i++
    }
    const add = pkgs.filter((n) => !existing.has(norm(key(n)))).map((n) => `  ${key(n)}: true`)
    if (add.length === 0) return false
    lines.splice(hi + 1, i - hi - 1, ...keep, ...add)
  } else {
    lines.push('', header, ...pkgs.map((n) => `  ${key(n)}: true`))
  }
  writeFileSync(path, lines.join('\n') + '\n')
  return true
}

/** 快照到 <profile>/.fde-tools-install-snapshot.json，返回快照路径。 */
function snapshotProfile(profileDir, manifest, pnpmSource) {
  const snapshotPath = join(profileDir, SNAPSHOT_NAME)
  writeFileSync(snapshotPath, JSON.stringify({
    at: new Date().toISOString(),
    profile: profileDir,
    pnpm: pnpmSource,
    before: { dependencies: { ...(manifest.dependencies || {}) }, bundles: manifestBundles(manifest) },
  }, null, 2) + '\n')
  return snapshotPath
}

/** pnpm add（带 ERR_PNPM_IGNORED_BUILDS 自动写 allowBuilds 重试一次）。 */
async function pnpmAdd(profileDir, pnpm, specs, log, run) {
  const addArgs = [...pnpm.baseArgs, 'add', ...specs]
  log(`$ pnpm add ${specs.join(' ')}`)
  let r = await run(pnpm.file, addArgs, profileDir, 300000)
  if (r.stdout) log(r.stdout.trim())
  if (r.stderr) log(r.stderr.trim())
  if (r.code !== 0) {
    const ignored = parseIgnoredBuilds(`${r.stdout}\n${r.stderr}`)
    if (ignored.length > 0) {
      ensureAllowBuilds(profileDir, ignored)
      log(`pnpm 拦截了构建脚本（${ignored.join(', ')}），已写入 pnpm-workspace.yaml 的 allowBuilds，重试…`)
      r = await run(pnpm.file, addArgs, profileDir, 300000)
      if (r.stdout) log(r.stdout.trim())
      if (r.stderr) log(r.stderr.trim())
    }
  }
  return r
}

/** link 还原：pnpm 清掉的历史病，丢了就按快照补回再 install（≤2 轮）。返回 {healed} 或 {error}。 */
async function healLostLinks(profileDir, beforeDeps, pnpm, log, run, snapshotPath) {
  let healed = false
  for (let round = 0; round < 2; round++) {
    const now = readManifest(profileDir)
    const nowDeps = now.dependencies || {}
    const lost = Object.entries(beforeDeps).filter(([n, s]) => /^(link|file):/.test(String(s)) && nowDeps[n] === undefined)
    if (lost.length === 0) return { healed: healed }
    log(`pnpm 清掉了 ${lost.length} 个 link: 依赖（${lost.map(([n]) => n).join(', ')}），按快照还原…`)
    now.dependencies = { ...nowDeps, ...Object.fromEntries(lost) }
    writeManifest(profileDir, now)
    const r2 = await run(pnpm.file, [...pnpm.baseArgs, 'install'], profileDir, 300000)
    if (r2.stdout) log(r2.stdout.trim())
    if (r2.stderr) log(r2.stderr.trim())
    if (r2.code !== 0) return { error: `还原 link: 依赖的 pnpm install 失败（exit ${r2.code}），请按快照核对：${snapshotPath}` }
    healed = true
  }
  return { healed: healed }
}

/**
 * 安装指定成员（缺省=全部缺失的）。流程：
 *   快照 → pnpm add（一次带齐）→ diff 丢了的 link: 依赖 → 按快照补回 + pnpm install（≤2 轮）
 *   → 追加 bundles → 逐成员回报。
 * opts._run / opts._pnpm / opts._fetch 是测试缝；opts.onLog 收过程日志行。
 */
async function install(profileDir, names, opts = {}) {
  const run = opts._run || defaultRun
  const logChunks = []
  const log = (text) => {
    logChunks.push(text.endsWith('\n') ? text : text + '\n')
    if (opts.onLog) opts.onLog(text)
  }
  const fail = (error, results, snap = null) => ({
    ok: false,
    error: error,
    results: results || [],
    healed: false,
    snapshotPath: snap,
    log: logChunks.join('').slice(-8000),
  })

  if (!profileDir) {
    const found = findProfile()
    if (!found) return fail('找不到所属 profile（~/.dsh/profiles 下没有装着本插件的）')
    profileDir = found.dir
  }
  let manifest
  try {
    manifest = readManifest(profileDir)
  } catch (error) {
    return fail(`读不到 profile manifest：${error && error.message}`)
  }
  const beforeDeps = { ...(manifest.dependencies || {}) }

  const wanted = (names && names.length ? names : PACK.map((p) => p.name)).filter((n) => packEntry(n))
  const unknown = (names || []).filter((n) => !packEntry(n))
  if (unknown.length) return fail(`不在全家桶清单里：${unknown.join(', ')}`)

  const pending = []
  const results = []
  for (const p of PACK) {
    if (!wanted.includes(p.name)) continue
    if (beforeDeps[p.name] !== undefined) results.push({ name: p.name, ok: true, skipped: true, message: '已在 profile 依赖中' })
    else pending.push(p)
  }

  const pnpm = opts._pnpm || await ensurePnpm(run)
  if (!pnpm || pnpm.ready === false) return fail(pnpm && pnpm.error ? pnpm.error : 'pnpm 不可用', results)

  if (pending.length === 0) {
    const appended = ensureBundles(profileDir, wanted)
    if (appended) log('依赖已齐，补齐了 bundles 清单。')
    return { ok: true, error: null, results: results, healed: false, snapshotPath: null, log: logChunks.join('').slice(-8000) }
  }

  const snapshotPath = snapshotProfile(profileDir, manifest, pnpm.source)
  log(`快照已存 ${SNAPSHOT_NAME}`)

  const r = await pnpmAdd(profileDir, pnpm, pending.map((p) => `${p.name}@${p.range}`), log, run)
  if (r.code !== 0) {
    return fail(`pnpm add 失败（exit ${r.code}），profile 未改坏的依赖以快照为准：${snapshotPath}`, results.map((x) => x), snapshotPath)
  }

  const healedResult = await healLostLinks(profileDir, beforeDeps, pnpm, log, run, snapshotPath)
  if (healedResult.error) return fail(healedResult.error, results, snapshotPath)

  ensureBundles(profileDir, pending.map((p) => p.name))

  const after = readManifest(profileDir)
  for (const p of pending) {
    const landed = (after.dependencies || {})[p.name] !== undefined
    results.push({
      name: p.name,
      ok: landed,
      skipped: false,
      message: landed ? `已装 ${installedVersion(profileDir, p.name) || p.range}，重启 dsh 后生效` : 'pnpm add 后依赖未落盘，请看日志',
    })
  }
  return { ok: results.every((x) => x.ok), error: null, results: results, healed: healedResult.healed, snapshotPath: snapshotPath, log: logChunks.join('').slice(-8000) }
}

/**
 * 更新指定成员到 npm latest（缺省=检查出有更新的全部）。只动装着 registry 依赖的成员；
 * link:/file:/github: 源码安装与未安装的一律跳过。流程与 install 相同（快照→add→还原→bundles）。
 */
async function update(profileDir, names, opts = {}) {
  const run = opts._run || defaultRun
  const logChunks = []
  const log = (text) => {
    logChunks.push(text.endsWith('\n') ? text : text + '\n')
    if (opts.onLog) opts.onLog(text)
  }
  const fail = (error, results, snap = null) => ({
    ok: false,
    error: error,
    results: results || [],
    healed: false,
    snapshotPath: snap,
    log: logChunks.join('').slice(-8000),
  })

  if (!profileDir) {
    const found = findProfile()
    if (!found) return fail('找不到所属 profile（~/.dsh/profiles 下没有装着本插件的）')
    profileDir = found.dir
  }
  let manifest
  try {
    manifest = readManifest(profileDir)
  } catch (error) {
    return fail(`读不到 profile manifest：${error && error.message}`)
  }
  const beforeDeps = { ...(manifest.dependencies || {}) }

  const wanted = names && names.length ? names : null
  const known = new Set([SELF_NAME, ...PACK.map((p) => p.name)])
  const unknown = (names || []).filter((n) => !known.has(n))
  if (unknown.length) return fail(`不在全家桶清单里：${unknown.join(', ')}`)

  // 挑出确实有更新的：装着 registry 依赖 && latest 查得到 && 版本确实落后
  const check = await checkUpdates(profileDir, { _fetch: opts._fetch })
  if (check.error) return fail(check.error)
  const byName = new Map(check.pack.map((r) => [r.name, r]))
  const pending = []
  const results = []
  for (const row of check.pack) {
    if (wanted && !wanted.includes(row.name)) continue
    if (row.outdated) pending.push(row)
    else results.push({ name: row.name, ok: true, skipped: true, from: row.version, to: row.version, message: row.reason || '已是最新' })
  }

  if (pending.length === 0) {
    return { ok: true, error: null, results: results, healed: false, snapshotPath: null, log: logChunks.join('').slice(-8000) }
  }

  const pnpm = opts._pnpm || await ensurePnpm(run)
  if (!pnpm || pnpm.ready === false) return fail(pnpm && pnpm.error ? pnpm.error : 'pnpm 不可用', results)

  const snapshotPath = snapshotProfile(profileDir, manifest, pnpm.source)
  log(`快照已存 ${SNAPSHOT_NAME}`)

  const r = await pnpmAdd(profileDir, pnpm, pending.map((row) => `${row.name}@latest`), log, run)
  if (r.code !== 0) {
    return fail(`pnpm add 失败（exit ${r.code}），profile 未改坏的依赖以快照为准：${snapshotPath}`, results.map((x) => x), snapshotPath)
  }

  const healedResult = await healLostLinks(profileDir, beforeDeps, pnpm, log, run, snapshotPath)
  if (healedResult.error) return fail(healedResult.error, results, snapshotPath)

  ensureBundles(profileDir, pending.map((row) => row.name))

  const after = readManifest(profileDir)
  for (const row of pending) {
    const landed = (after.dependencies || {})[row.name] !== undefined
    const to = installedVersion(profileDir, row.name)
    results.push({
      name: row.name,
      ok: landed,
      skipped: false,
      from: row.version,
      to: to,
      message: landed ? `已更新 ${row.version} → ${to || row.latest}，重启 dsh 后生效` : 'pnpm add 后依赖未落盘，请看日志',
    })
  }
  return { ok: results.every((x) => x.ok), error: null, results: results, healed: healedResult.healed, snapshotPath: snapshotPath, log: logChunks.join('').slice(-8000) }
}

module.exports = {
  SELF_NAME,
  PACK,
  packEntry,
  dshHome,
  findProfile,
  readManifest,
  writeManifest,
  manifestBundles,
  ensureBundles,
  captureBootState,
  childPkgDir,
  installedVersion,
  ensurePnpm,
  pnpmState,
  restartCommand,
  status,
  install,
  update,
  checkUpdates,
  fetchLatest,
  parseVer,
  cmpVer,
  defaultRun,
  parseIgnoredBuilds,
  ensureAllowBuilds,
}
