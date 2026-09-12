'use strict'

/**
 * @weibaohui/dsh-fde-tools — 宿主半。
 *
 * 全家桶引导：client 半的面板经 /dsh-fde-tools/api 查成员安装状态、
 * 触发补装（pnpm add + 追加 dsh.profile.bundles，见 installer.js）。
 * 宿主 apply 时拍一次 boot bundles 快照，用于「装好了、待重启」的判定。
 */

const installer = require('./installer')

module.exports = {
  name: 'dsh-fde-tools',
  inject: ['webServer'],

  apply(ctx) {
    let bootState = { bundles: new Set(), versions: new Map() }
    try { bootState = installer.captureBootState() } catch (error) {
      console.error('[dsh-fde-tools] boot state snapshot:', error && error.message)
    }

    let mutating = false // 安装/更新串行闸
    const sendJson = (res, code, payload) => {
      try {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(payload))
      } catch { /* 客户端早断：响应写不回去就算了 */ }
    }
    const readJsonBody = (req) => new Promise((fulfil, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > 64 * 1024) { reject(new Error('request body too large')); req.destroy(); return }
        chunks.push(chunk)
      })
      req.on('end', () => {
        const bufs = chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))
        try { fulfil(bufs.length === 0 ? {} : JSON.parse(Buffer.concat(bufs).toString('utf8'))) }
        catch (error) { reject(new Error(`invalid JSON body: ${error && error.message}`)) }
      })
      req.on('error', reject)
    })

    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/dsh-fde-tools/api',
      handler: async (req, res) => {
        const url = new URL(req.url || '/', 'http://dsh.local')
        const apiPath = url.pathname.replace(/\/+$/, '')
        try {
          if (req.method === 'GET' && apiPath.endsWith('/dsh-fde-tools/api/status')) {
            installer.ensurePnpm().catch(() => {}) // 后台先把 pnpm 探好，status 不等它
            sendJson(res, 200, installer.status(null, bootState))
            return
          }
          if (req.method === 'GET' && apiPath.endsWith('/dsh-fde-tools/api/check-updates')) {
            sendJson(res, 200, await installer.checkUpdates(null))
            return
          }
          if (req.method === 'POST' && (apiPath.endsWith('/dsh-fde-tools/api/install') || apiPath.endsWith('/dsh-fde-tools/api/update'))) {
            const isUpdate = apiPath.endsWith('/api/update')
            if (mutating) { sendJson(res, 409, { error: '已有一次安装/更新在进行中' }); return }
            const body = await readJsonBody(req).catch(() => ({}))
            const names = Array.isArray(body && body.names) ? body.names.filter((n) => typeof n === 'string') : null
            mutating = true
            try {
              const result = isUpdate
                ? await installer.update(null, names)
                : await installer.install(null, names)
              sendJson(res, result.ok ? 200 : 500, result)
            } finally { mutating = false }
            return
          }
          sendJson(res, 404, { error: 'not found' })
        } catch (error) { sendJson(res, 400, { error: String(error && error.message || error) }) }
      },
    }), 'dsh-fde-tools: api route')
  },
}
