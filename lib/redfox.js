// RedFox API · 小红书七日爆款数据获取（GET 接口 cozeSkill/getXhsCozeSkillDataSeven）。
// 移植自 xhs_weekly_fetcher.py 的 fetch_explosive_articles。传输层复用 cn30 的 http/https + 代理隧道模式。
import http from 'node:http'
import https from 'node:https'
import { TLSSocket } from 'node:tls'

export const DEFAULT_API_BASE = 'https://redfox.hk'
export const SEVEN_DATA_PATH = '/story/api/cozeSkill/getXhsCozeSkillDataSeven'
export const SOURCE = '小红书七日数据爆款文章-dsh'
export const API_DOC_URL = 'https://redfox.hk/apis/xiaohongshu/384C6W6B?source=github'

export function resolveApiKey({ settings = {}, config = {} } = {}) {
  return String(config.apiKey || settings.api_key || process.env.REDFOX_API_KEY || '').trim()
}

export function resolveApiBase({ settings = {} } = {}) {
  const base = String(settings.api_base || process.env.REDFOX_API_BASE || '').trim()
  return (base || DEFAULT_API_BASE).replace(/\/+$/, '')
}

function connectTunnel(proxyUrl, targetHost, targetPort, timeout) {
  return new Promise((resolve, reject) => {
    const proxy = new URL(proxyUrl)
    const req = http.request({
      host: proxy.hostname,
      port: Number(proxy.port) || 80,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers: { host: `${targetHost}:${targetPort}` },
      timeout,
    })
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); reject(new Error(`proxy CONNECT ${res.statusCode}`)); return }
      resolve(socket)
    })
    req.on('timeout', () => req.destroy(new Error('proxy connect timeout')))
    req.on('error', reject)
    req.end()
  })
}

// GET JSON（可选代理隧道；http 支持本地假服务器）
export function httpGetJson(url, { timeout = 30000, proxyUrl = '', headers = {} } = {}) {
  const u = new URL(url)
  const isHttp = u.protocol === 'http:'
  const port = Number(u.port) || (isHttp ? 80 : 443)
  const transport = isHttp ? http : https
  const opts = {
    host: u.hostname,
    port,
    method: 'GET',
    path: `${u.pathname}${u.search}`,
    headers: { ...headers },
  }
  return new Promise((resolve, reject) => {
    const finish = (socket) => {
      const req = transport.request(socket ? { ...opts, socket, agent: false } : { ...opts, agent: false }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          try {
            resolve({ status: res.statusCode, json: JSON.parse(text) })
          } catch {
            reject(new Error(`响应不是合法 JSON（HTTP ${res.statusCode}）：${text.slice(0, 200)}`))
          }
        })
      })
      req.on('error', reject)
      req.setTimeout(timeout, () => req.destroy(new Error(`请求超时（${timeout}ms）`)))
      req.end()
    }
    if (proxyUrl && !isHttp) {
      connectTunnel(proxyUrl, u.hostname, port, timeout)
        .then((socket) => finish(new TLSSocket(socket, { servername: u.hostname })))
        .catch(reject)
    } else {
      finish()
    }
  })
}

export function friendlyApiError(json) {
  const code = json?.code
  const msg = String(json?.msg || json?.message || '')
  if (code === 3201 || msg.includes('积分不足')) return new Error('RedFox 账户积分不足（3201）：请到 https://redfox.hk/dashboard/recharge 充值后重试。')
  if (code === 3203 || msg.includes('付费调用')) return new Error('RedFox 该接口已转为付费调用（3203）：请到 https://redfox.hk/dashboard/recharge 充值后重试。')
  if (code === 3108) return new Error('RedFox 限频（3108），稍等片刻再试。')
  if (code === 401 || code === 403) return new Error(`RedFox 鉴权失败（${code}）：请检查面板「设置」页的 API Key。`)
  return new Error(`API 错误（code=${code ?? '?'}）：${msg || JSON.stringify(json).slice(0, 200)}`)
}

// 获取七日爆款数据。返回原始 JSON（data.data 为笔记数组）
export async function fetchWeeklyData({ rankDate, category, apiKey, apiBase, proxyUrl = '', timeout = 30000 } = {}) {
  if (!apiKey) {
    throw new Error('未配置 RedFox API Key。请到面板「设置」页填入，或在插件配置/环境变量 REDFOX_API_KEY 里配置（获取：https://redfox.hk/settings/api-keys?source=github）。')
  }
  if (!rankDate) throw new Error('rankDate 必填（YYYY-MM-DD）')
  const source = encodeURIComponent(SOURCE)
  const categoryEncoded = encodeURIComponent(category || '综合全部')
  const url = `${apiBase}${SEVEN_DATA_PATH}?rankDate=${rankDate}&source=${source}&category=${categoryEncoded}`
  const { json } = await httpGetJson(url, {
    timeout, proxyUrl,
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
  })
  if (json?.code !== 2000) throw friendlyApiError(json)
  return json
}
