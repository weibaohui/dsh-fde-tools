'use strict'

/**
 * installer 单测：不碰真 pnpm / 真 profile。
 * - findProfile：临时 DSH_HOME 下扫描 + link realpath 精确匹配优先；
 * - install：fake run 模拟 pnpm add / install，覆盖跳过已装、bundles 追加、
 *   link 依赖被清后的快照还原（成功与失败两路）；
 * - status：安装态 / bundles / 待重启判定。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'
import installer from '../src/installer.js'

const REPO_ROOT = realpathSync(join(import.meta.dirname, '..'))

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fde-tools-test-'))
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }) } catch {} })
  return dir
}

function makeProfile(dir, { deps = {}, bundles = null, children = {}, name = 'web' } = {}) {
  const profileDir = join(dir, 'profiles', name)
  mkdirSync(profileDir, { recursive: true })
  const manifest = {
    name: `dsh-profile-${name}`,
    private: true,
    dependencies: { ...deps },
  }
  if (bundles !== null) manifest.dsh = { profile: { bundles } }
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2))
  for (const [pkg, version] of Object.entries(children)) {
    const childDir = join(profileDir, 'node_modules', ...pkg.split('/'))
    mkdirSync(childDir, { recursive: true })
    writeFileSync(join(childDir, 'package.json'), JSON.stringify({ name: pkg, version }))
  }
  return profileDir
}

function readManifest(profileDir) {
  return JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
}

const ALL_NAMES = installer.PACK.map((p) => p.name)

/** fake pnpm：--version 恒成功；add=写依赖+建包目录（可选 dropLinks 模拟清剿）；install=可配失败。 */
function fakeRun(profileDirOf, { dropLinks = [], installFails = false } = {}) {
  const calls = []
  return {
    calls,
    run: async (file, args, cwd) => {
      calls.push({ file, args, cwd })
      if (args.includes('--version')) return { code: 0, stdout: '9.0.0', stderr: '' }
      const rest = args.slice(file === process.execPath ? 1 : 0)
      const op = rest.find((a) => a === 'add' || a === 'install')
      if (op === 'add') {
        const manifest = readManifest(profileDirOf)
        for (const spec of rest.filter((a) => a !== 'add')) {
          const at = spec.lastIndexOf('@')
          const name = spec.slice(0, at)
          const range = spec.slice(at + 1)
          manifest.dependencies = { ...manifest.dependencies, [name]: range }
          for (const d of dropLinks) delete manifest.dependencies[d]
          const childDir = join(profileDirOf, 'node_modules', ...name.split('/'))
          mkdirSync(childDir, { recursive: true })
          writeFileSync(join(childDir, 'package.json'), JSON.stringify({ name, version: '9.9.9' }))
        }
        writeFileSync(join(profileDirOf, 'package.json'), JSON.stringify(manifest, null, 2))
        return { code: 0, stdout: 'Packages: +7', stderr: '' }
      }
      if (op === 'install') return { code: installFails ? 1 : 0, stdout: installFails ? 'ERR' : 'Done', stderr: installFails ? 'boom' : '' }
      return { code: 0, stdout: '', stderr: '' }
    },
  }
}

const FAKE_PNPM = { file: 'fake-pnpm', baseArgs: [], source: 'fake' }

// ---------------------------------------------------------------------------

test('PACK 清单：17 个成员、名字唯一、range 形如 ^x.y.z、user-management 必装', (t) => {
  assert.equal(installer.PACK.length, 17)
  assert.equal(installer.PACK[0].name, '@weibaohui/user-management')
  assert.equal(installer.PACK[0].required, true)
  assert.equal(installer.PACK.filter((p) => p.required).length, 1)
  assert.deepEqual(new Set(ALL_NAMES).size, 17)
  for (const p of installer.PACK) {
    assert.ok(/^(dsh-|dshmarket|@weibaohui\/|@xmanrui\/|@nanmicoder\/)/.test(p.name), p.name)
    assert.match(p.range, /^\^\d+\.\d+\.\d+$/, p.name)
    assert.ok(p.label && p.icon && p.desc, p.name)
  }
})

test('findProfile：扫描临时 DSH_HOME，link 安装（realpath 与自身一致）优先', (t) => {
  const dir = tmp(t)
  const plain = makeProfile(dir, { name: 'plain' })
  mkdirSync(join(plain, 'node_modules', '@weibaohui', 'dsh-fde-tools'), { recursive: true })
  const linked = makeProfile(dir, { name: 'linked' })
  mkdirSync(join(linked, 'node_modules', '@weibaohui'), { recursive: true })
  symlinkSync(REPO_ROOT, join(linked, 'node_modules', '@weibaohui', 'dsh-fde-tools'), 'dir')

  const found = installer.findProfile({ DSH_HOME: dir })
  assert.ok(found, '应有候选')
  assert.equal(found.name, 'linked', 'realpath 精确匹配的 profile 应优先')
  assert.equal(found.dir, linked)
})

test('findProfile：env 指名 profile', (t) => {
  const dir = tmp(t)
  const profileDir = makeProfile(dir, { name: 'web' })
  mkdirSync(join(profileDir, 'node_modules', '@weibaohui', 'dsh-fde-tools'), { recursive: true })
  const found = installer.findProfile({ DSH_HOME: dir, DSH_FDE_TOOLS_PROFILE: 'web' })
  assert.ok(found && found.dir === profileDir)
})

test('install：全缺 → 一次 pnpm add、逐个写依赖、bundles 全追加、快照落盘', async (t) => {
  const dir = tmp(t)
  const profileDir = makeProfile(dir, { deps: { '@deepseek-ai/dsh-base': '0.1.0' }, bundles: ['@deepseek-ai/dsh-base'] })
  const fake = fakeRun(profileDir)

  const r = await installer.install(profileDir, null, { _run: fake.run, _pnpm: FAKE_PNPM })
  assert.equal(r.ok, true, r.error || '')
  const addCalls = fake.calls.filter((c) => c.args.includes('add'))
  assert.equal(addCalls.length, 1, '应只有一次 pnpm add')
  const specs = addCalls[0].args.slice(addCalls[0].args.indexOf('add') + 1)
  assert.equal(specs.length, 17, '十七个成员一次带齐')

  const manifest = readManifest(profileDir)
  for (const p of installer.PACK) {
    assert.equal(manifest.dependencies[p.name], p.range, p.name)
    assert.ok(manifest.dsh.profile.bundles.includes(p.name), p.name)
  }
  assert.ok(manifest.dependencies['@deepseek-ai/dsh-base'], '原有依赖保留')
  assert.ok(manifest.dsh.profile.bundles.includes('@deepseek-ai/dsh-base'), '原有 bundles 保留')
  assert.ok(existsSync(join(profileDir, '.fde-tools-install-snapshot.json')), '快照文件应存在')
  for (const res of r.results) assert.equal(res.ok, true)
})

test('install：已装成员跳过，不重复进 add', async (t) => {
  const dir = tmp(t)
  const kb = installer.PACK.find((p) => p.name === '@weibaohui/dsh-kb')
  const profileDir = makeProfile(dir, { deps: { [kb.name]: kb.range }, bundles: [] })
  const fake = fakeRun(profileDir)

  const r = await installer.install(profileDir, null, { _run: fake.run, _pnpm: FAKE_PNPM })
  assert.equal(r.ok, true, r.error || '')
  const skipped = r.results.find((x) => x.name === kb.name)
  assert.equal(skipped.skipped, true)
  const addCall = fake.calls.find((c) => c.args.includes('add'))
  assert.equal(addCall.args.slice(addCall.args.indexOf('add') + 1).length, 16, '只 add 缺的 16 个')
})

test('install：pnpm 清掉 link: 依赖 → 快照还原成功，bundles 照常追加', async (t) => {
  const dir = tmp(t)
  const kit = '@weibaohui/dsh-plugin-kit'
  const profileDir = makeProfile(dir, { deps: { [kit]: 'link:/Users/x/dsh-plugin-kit' }, bundles: [] })
  const fake = fakeRun(profileDir, { dropLinks: [kit] })

  const r = await installer.install(profileDir, null, { _run: fake.run, _pnpm: FAKE_PNPM })
  assert.equal(r.ok, true, r.error || '')
  assert.equal(r.healed, true, '应走还原分支')
  const manifest = readManifest(profileDir)
  assert.equal(manifest.dependencies[kit], 'link:/Users/x/dsh-plugin-kit', 'link: 依赖应被按快照补回')
  for (const p of installer.PACK) assert.ok(manifest.dependencies[p.name] && manifest.dsh.profile.bundles.includes(p.name), p.name)
})

test('install：还原的 pnpm install 失败 → 报错并给出快照路径，link 修复已落盘', async (t) => {
  const dir = tmp(t)
  const kit = '@weibaohui/dsh-plugin-kit'
  const profileDir = makeProfile(dir, { deps: { [kit]: 'link:/Users/x/dsh-plugin-kit' }, bundles: [] })
  const fake = fakeRun(profileDir, { dropLinks: [kit], installFails: true })

  const r = await installer.install(profileDir, null, { _run: fake.run, _pnpm: FAKE_PNPM })
  assert.equal(r.ok, false)
  assert.match(r.error, /pnpm install 失败/)
  assert.equal(r.snapshotPath, join(profileDir, '.fde-tools-install-snapshot.json'))
  const manifest = readManifest(profileDir)
  assert.equal(manifest.dependencies[kit], 'link:/Users/x/dsh-plugin-kit', '还原动作应已写盘，便于手工核对')
  assert.equal((manifest.dsh.profile.bundles || []).length, 0, '失败时不动 bundles')
})

test('install：不在清单的名字拒绝', async (t) => {
  const dir = tmp(t)
  const profileDir = makeProfile(dir, {})
  const r = await installer.install(profileDir, ['@weibaohui/not-in-pack'], { _run: async () => ({ code: 0, stdout: '', stderr: '' }), _pnpm: FAKE_PNPM })
  assert.equal(r.ok, false)
  assert.match(r.error, /不在全家桶清单/)
})

test('ensureBundles：幂等且保留 manifest 其余字段', (t) => {
  const dir = tmp(t)
  const profileDir = makeProfile(dir, { bundles: ['@deepseek-ai/dsh-base'] })
  const name = installer.PACK[0].name
  assert.equal(installer.ensureBundles(profileDir, [name]), true)
  assert.equal(installer.ensureBundles(profileDir, [name]), false, '第二次应无事可做')
  const manifest = readManifest(profileDir)
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', name])
})

test('status：安装态 / bundles / 待重启判定', (t) => {
  const dir = tmp(t)
  const kb = '@weibaohui/dsh-kb'
  const gs = '@weibaohui/dsh-git-server'
  const profileDir = makeProfile(dir, {
    deps: { [kb]: '^0.7.2', [gs]: 'link:/x' },
    bundles: [kb],
    children: { [kb]: '0.7.2', [gs]: '0.1.0' },
  })

  const st = installer.status(profileDir, new Set([kb]))
  assert.equal(st.installedCount, 2)
  assert.equal(st.missingCount, 15)
  assert.equal(st.requiredMissing, 1, 'user-management 缺失应计入必装缺失')
  const rowKb = st.pack.find((p) => p.name === kb)
  const rowGs = st.pack.find((p) => p.name === gs)
  const rowTasks = st.pack.find((p) => p.name === '@weibaohui/dsh-tasks')
  assert.deepEqual({ installed: rowKb.installed, version: rowKb.version, inBundles: rowKb.inBundles, needsRestart: rowKb.needsRestart }, { installed: true, version: '0.7.2', inBundles: true, needsRestart: false })
  assert.equal(rowGs.inBundles, false)
  assert.equal(rowTasks.installed, false)
  assert.ok(rowTasks.range.startsWith('^'))
})

test('status：bootBundles 缺省时已装成员宁可贵一点也不漏「待重启」', (t) => {
  const dir = tmp(t)
  const kb = '@weibaohui/dsh-kb'
  const profileDir = makeProfile(dir, { deps: { [kb]: '^0.7.2' }, bundles: [kb], children: { [kb]: '0.7.2' } })
  const st = installer.status(profileDir, null)
  assert.equal(st.pack.find((p) => p.name === kb).needsRestart, true)
})

test('captureBootState：读不出 manifest 时给空集', (t) => {
  const dir = tmp(t)
  const e = installer.captureBootState(join(dir, 'nope'))
  assert.equal(e.bundles.size, 0)
  assert.equal(e.versions.size, 0)
})

test('install：pnpm 拦构建脚本 → 自动写 allowBuilds 并重试成功', async (t) => {
  const dir = tmp(t)
  const profileDir = makeProfile(dir, {})
  let addCalls = 0
  const fake = {
    calls: [],
    run: async (file, args, cwd) => {
      fake.calls.push({ file, args, cwd })
      if (args.includes('--version')) return { code: 0, stdout: '9.0.0', stderr: '' }
      if (args.includes('add')) {
        addCalls++
        if (addCalls === 1) return { code: 1, stdout: '[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: better-sqlite3@11.10.0\n', stderr: '' }
        // 第二次成功：像真 pnpm 一样落依赖
        const manifest = readManifest(profileDir)
        for (const spec of args.filter((a) => a !== 'add' && a.startsWith('@weibaohui/'))) {
          const at = spec.lastIndexOf('@')
          manifest.dependencies = { ...manifest.dependencies, [spec.slice(0, at)]: spec.slice(at + 1) }
        }
        writeFileSync(join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2))
        return { code: 0, stdout: 'done', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    },
  }
  const r = await installer.install(profileDir, ['@weibaohui/dsh-kb'], { _run: fake.run, _pnpm: FAKE_PNPM })
  assert.equal(r.ok, true, r.error || '')
  assert.equal(addCalls, 2, '应重试一次 add')
  const ws = readFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'utf8')
  assert.match(ws, /allowBuilds:\n  better-sqlite3@11\.10\.0: true\n/)
  assert.equal(readManifest(profileDir).dependencies['@weibaohui/dsh-kb'], '^0.7.2')
})

test('parseIgnoredBuilds / ensureAllowBuilds：多包解析与既有段去重', (t) => {
  assert.deepEqual(
    installer.parseIgnoredBuilds('Ignored build scripts: better-sqlite3@11.10.0, node-pty@1.0.0 and sharp@0.33.0'),
    ['better-sqlite3@11.10.0', 'node-pty@1.0.0', 'sharp@0.33.0'],
  )
  const dir = tmp(t)
  const profileDir = makeProfile(dir, {})
  assert.equal(installer.ensureAllowBuilds(profileDir, ['a@1.0.0']), true)
  assert.equal(installer.ensureAllowBuilds(profileDir, ['a@1.0.0', 'b@2.0.0']), true)
  assert.equal(installer.ensureAllowBuilds(profileDir, ['b@2.0.0']), false)
  const ws = readFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'utf8')
  assert.match(ws, /allowBuilds:\n  a@1\.0\.0: true\n  b@2\.0\.0: true\n$/)
})

test('cmpVer：semver 全序比较表', (t) => {
  const c = installer.cmpVer
  assert.equal(c('1.2.3', '1.2.3'), 0)
  assert.equal(c('0.7.2', '0.7.10'), -1)
  assert.equal(c('1.0.0', '0.99.9'), 1)
  assert.equal(c('1.0.0-rc.1', '1.0.0'), -1)
  assert.equal(c('1.0.0', '1.0.0-rc.1'), 1)
  assert.equal(c('1.0.0-rc.1', '1.0.0-rc.2'), -1)
  assert.equal(c('1.0.0-beta', '1.0.0-rc.1'), -1)
  assert.equal(c('1.0.0-rc', '1.0.0-rc.1'), -1)
  assert.equal(c('1.0.0-alpha.7', '1.0.0-alpha.10'), -1)
  assert.equal(c('v1.2.3', '1.2.3'), 0)
  assert.equal(c('垃圾', '1.0.0'), 0)
})

test('checkUpdates：fake fetch 下 outdated/跳过判定', async (t) => {
  const dir = tmp(t)
  const kb = '@weibaohui/dsh-kb'
  const gs = '@weibaohui/dsh-git-server'
  const profileDir = makeProfile(dir, {
    deps: { [kb]: '^0.7.2', [gs]: 'link:/x/dsh-git-server', dshmarket: '^1.3.0' },
    bundles: [],
    children: { [kb]: '0.7.2', [gs]: '0.1.0', dshmarket: '1.3.0' },
  })
  const r = await installer.checkUpdates(profileDir, {
    _fetch: async (url) => {
      const seg = url.split('/').filter(Boolean)
      const name = decodeURIComponent(seg[seg.length - 2])
      const table = { [kb]: '0.9.0', [gs]: '9.9.9', dshmarket: '1.45.1', '@weibaohui/dsh-fde-tools': '0.2.0' }
      return { ok: true, json: async () => ({ version: table[name] }) }
    },
  })
  assert.equal(r.error, null)
  const rowKb = r.pack.find((x) => x.name === kb)
  const rowGs = r.pack.find((x) => x.name === gs)
  const rowMarket = r.pack.find((x) => x.name === 'dshmarket')
  const rowSelf = r.pack.find((x) => x.name === '@weibaohui/dsh-fde-tools')
  assert.deepEqual({ outdated: rowKb.outdated, latest: rowKb.latest }, { outdated: true, latest: '0.9.0' })
  assert.equal(rowGs.outdated, false, 'link: 安装不参与更新')
  assert.equal(rowGs.source, 'local')
  assert.deepEqual({ outdated: rowMarket.outdated, latest: rowMarket.latest }, { outdated: true, latest: '1.45.1' })
  assert.equal(rowSelf.outdated, false, '本插件未装（自身在跑）不算更新')
  assert.ok(r.outdatedCount >= 2)
})

test('checkUpdates：latest 是预发布且已装正式版 → 不算更新', async (t) => {
  const dir = tmp(t)
  const kb = '@weibaohui/dsh-kb'
  const profileDir = makeProfile(dir, { deps: { [kb]: '^0.7.2' }, bundles: [], children: { [kb]: '0.7.2' } })
  const r = await installer.checkUpdates(profileDir, { _fetch: async () => ({ ok: true, json: async () => ({ version: '0.8.0-rc.1' }) }) })
  const row = r.pack.find((x) => x.name === kb)
  assert.equal(row.outdated, false)
  assert.match(row.reason, /预发布/)
})

test('update：把过期的成员更到 latest，link: 与已最新成员跳过', async (t) => {
  const dir = tmp(t)
  const kb = '@weibaohui/dsh-kb'
  const gs = '@weibaohui/dsh-git-server'
  const kit = '@weibaohui/dsh-plugin-kit'
  const profileDir = makeProfile(dir, {
    deps: { [kb]: '^0.7.2', [gs]: 'link:/x/dsh-git-server', [kit]: 'link:/x/kit' },
    bundles: [],
    children: { [kb]: '0.7.2', [gs]: '0.1.0' },
  })
  const base = fakeRun(profileDir) // add=写依赖+建包目录
  const fake = { calls: base.calls, run: async (file, args, cwd) =>
    base.run(file, args.map((a) => (a === `${kb}@latest` ? `${kb}@^8.8.8` : a)), cwd) } // 真 pnpm 会把 @latest 解析成 ^具体版本
  const r = await installer.update(profileDir, null, { _run: fake.run, _pnpm: FAKE_PNPM, _fetch: async () => ({ ok: true, json: async () => ({ version: '8.8.8' }) }) })
  assert.equal(r.ok, true, r.error || '')
  const skippedGs = r.results.find((x) => x.name === gs)
  assert.equal(skippedGs.skipped, true)
  assert.match(skippedGs.message, /源码安装/)
  const updKb = r.results.find((x) => x.name === kb)
  assert.equal(updKb.ok, true)
  assert.equal(updKb.from, '0.7.2')
  const manifest = readManifest(profileDir)
  assert.ok(manifest.dependencies[kb].startsWith('^8'), `应写到 ^8.8.8，实际 ${manifest.dependencies[kb]}`)
  assert.equal(manifest.dependencies[kit], 'link:/x/kit', 'link: 依赖保留')
  assert.ok(manifest.dsh.profile.bundles.includes(kb), '更新后 bundles 仍在')
  const addCall = fake.calls.find((c) => c.args.includes('add'))
  assert.ok(addCall.args.some((a) => a.startsWith(kb + '@')), '应对 kb 发起 add（@latest 解析后落具体版本）')
})

test('status：版本变了（更新后）→ 待重启', (t) => {
  const dir = tmp(t)
  const kb = '@weibaohui/dsh-kb'
  const profileDir = makeProfile(dir, { deps: { [kb]: '^0.7.2' }, bundles: [kb], children: { [kb]: '0.9.0' } })
  const boot = { bundles: new Set([kb]), versions: new Map([[kb, '0.7.2']]) }
  assert.equal(installer.status(profileDir, boot).pack.find((p) => p.name === kb).needsRestart, true)
  assert.equal(installer.status(profileDir, { bundles: new Set([kb]), versions: new Map([[kb, '0.9.0']]) }).pack.find((p) => p.name === kb).needsRestart, false)
  // 兼容旧式 Set
  assert.equal(installer.status(profileDir, new Set([kb])).pack.find((p) => p.name === kb).needsRestart, false)
})

test('status：restart 字段不再下发命令，重启一律只提示通用文案', (t) => {
  const dir = tmp(t)
  const kb = '@weibaohui/dsh-kb'
  const profileDir = makeProfile(dir, { deps: { [kb]: '^0.7.2' }, bundles: [kb], children: { [kb]: '0.7.2' } })
  const st = installer.status(profileDir, new Set([kb]))
  assert.ok(!('restart' in st), '不应再有 restart 字段（命令已随探测逻辑移除）')
})
