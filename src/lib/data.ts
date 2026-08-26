import type { LiveMetrics, LiveRow } from '../types'

export function numberValue(value: unknown) {
  const clean = String(value || '').replace(/[¥,\s]/g, '')
  const parsed = Number(clean)
  return Number.isFinite(parsed) ? parsed : 0
}

export function durationSeconds(value: unknown) {
  const text = String(value || '')
  let total = 0
  const hour = text.match(/(\d+)小时/)
  const minute = text.match(/(\d+)分钟/)
  const second = text.match(/(\d+)秒/)
  if (hour) total += Number(hour[1]) * 3600
  if (minute) total += Number(minute[1]) * 60
  if (second) total += Number(second[1])
  return total
}

export function liveKey(row: Pick<LiveRow, 'startedAt' | 'topic'>) {
  return `${row.startedAt || 'no-time'}::${row.topic}`
}

export function liveId(row: Pick<LiveRow, 'startedAt' | 'topic'>) {
  return liveKey(row)
    .normalize('NFKD')
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

export function withMetrics(row: LiveRow): LiveMetrics {
  const viewers = row.viewers || 0
  return {
    ...row,
    viewsPerViewer: viewers ? row.views / viewers : 0,
    followRate: viewers ? row.follows / viewers : 0,
    shareRate: viewers ? row.shares / viewers : 0,
    commentRate: viewers ? row.comments / viewers : 0,
    buyerRate: viewers ? row.buyers / viewers : 0,
    gmvPerViewer: viewers ? row.gmv / viewers : 0,
    avgOrderValue: row.orders ? row.gmv / row.orders : 0,
    engagementScore: viewers ? (row.likes * 0.08 + row.comments * 8 + row.shares * 3) / viewers : 0,
  }
}

export function datasetSignature(rows: LiveRow[]) {
  return rows.map((row) => liveKey(row)).sort().join('||')
}

export function sum(rows: LiveMetrics[], key: keyof LiveMetrics) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0)
}

export function average(rows: LiveMetrics[], key: keyof LiveMetrics) {
  return rows.length ? sum(rows, key) / rows.length : 0
}

export function maxRow(rows: LiveMetrics[], key: keyof LiveMetrics) {
  return rows.reduce<LiveMetrics | null>((best, row) => (!best || Number(row[key]) > Number(best[key]) ? row : best), null)
}

export function formatNumber(value: number, digits = 0) {
  return Number(value || 0).toLocaleString('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })
}

export function formatMoney(value: number) {
  return `¥${formatNumber(value, value % 1 ? 2 : 0)}`
}

export function formatPercent(value: number, digits = 1) {
  return `${(Number(value || 0) * 100).toFixed(digits)}%`
}

export function formatSeconds(seconds: number) {
  const sec = Math.round(seconds || 0)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m ? `${m}分${s}秒` : `${s}秒`
}

export function parseCsv(text: string): LiveRow[] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i]
    const next = normalized[i + 1]
    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      row.push(field)
      field = ''
    } else if (char === '\n' && !inQuotes) {
      row.push(field)
      if (row.some((cell) => cell.trim())) rows.push(row)
      field = ''
      row = []
    } else field += char
  }
  row.push(field)
  if (row.some((cell) => cell.trim())) rows.push(row)

  const headerIndex = rows.findIndex((r) => r.includes('直播主题') && r.includes('直播开始时间'))
  if (headerIndex === -1) throw new Error('没有找到视频号直播历史数据字段行。')
  const headers = rows[headerIndex].map((cell) => cell.replace(/^\uFEFF/, '').trim())
  return rows.slice(headerIndex + 1).filter((r) => r.some((cell) => cell.trim())).map((r) => {
    const get = (name: string) => (r[headers.indexOf(name)] || '').trim()
    const topic = get('直播主题') || '未命名直播'
    const startedAt = get('直播开始时间')
    return {
      id: liveId({ topic, startedAt }),
      topic,
      location: get('直播位置'),
      startedAt,
      liveDurationText: get('直播时长'),
      avgWatchText: get('平均观看时长'),
      viewers: numberValue(get('观看人数')),
      views: numberValue(get('观看次数')),
      peakOnline: numberValue(get('最高在线')),
      avgWatchSec: durationSeconds(get('平均观看时长')),
      liveDurationSec: durationSeconds(get('直播时长')),
      likes: numberValue(get('点赞次数')),
      comments: numberValue(get('评论次数')),
      shares: numberValue(get('分享次数')),
      follows: numberValue(get('新增关注')),
      heat: numberValue(get('总热度')),
      giftUsers: numberValue(get('送礼人数')),
      giftTimes: numberValue(get('送礼次数')),
      gmv: numberValue(get('成交金额')),
      orders: numberValue(get('成交订单数')),
      buyers: numberValue(get('成交人数')),
    }
  })
}
