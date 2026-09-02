import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Scope = 'overview' | 'single'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

function getBearerToken(request: Request) {
  const value = request.headers.get('Authorization') || ''
  return value.startsWith('Bearer ') ? value.slice(7) : ''
}

function extractJson(text: string) {
  const raw = String(text || '').trim()
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1))
    throw new Error('AI returned non-JSON content')
  }
}

function buildReviewPrompt(payload: Record<string, unknown>) {
  const scope = payload.scope as Scope
  const mode = scope === 'single'
    ? [
      '本次是单场拆解 AI 分析。',
      '只重点分析 selectedLive 这一场直播，可用 lives、totals、selectedProfile 做对照。',
      '输出这一场的表现判断、潜在可能原因、下一场可执行改善思路。',
      '潜在原因必须用“可能”表达，不能把没有记录的数据当作事实。',
    ]
    : [
      '本次是复盘总览 AI 分析。',
      '分析所有直播的整体表现、场次趋势和结构性问题。',
      '输出未来直播的选题、排期、互动、关注沉淀和成交转化建议。',
      '如果样本量较少，需要提醒结论是阶段性判断。',
    ]

  return [
    '请基于视频号直播数据，生成运营执行复盘型分析。',
    ...mode,
    '只输出 JSON，不要输出 Markdown。',
    '不要编造数据，结论必须点名具体直播场次并带关键数字。',
    '如果 audienceProfiles 或 selectedProfile 有数据，需要结合用户画像解释受众结构、消费力、地域和内容匹配度。',
    '如果 channelProfiles 或 selectedChannelProfile 有数据，需要结合渠道来源、预约转观看、曝光进房漏斗和成交金额解释流量质量与转化问题。',
    'JSON 格式：',
    JSON.stringify({
      grade: 'A/B/C',
      verdictTitle: '一句整体判断',
      verdictText: '两句话以内的整体复盘',
      insights: [{ tone: 'good', tag: '起量样本', title: '标题', body: '分析正文' }],
      recommendations: [{ title: '动作标题', body: '具体执行建议' }],
    }),
    '直播数据：',
    JSON.stringify(payload),
  ].join('\n')
}

function buildProfilePrompt(live: unknown) {
  return [
    '请识别这些视频号用户画像截图，抽取可用于直播复盘的人群数据。',
    '只输出 JSON，不要输出 Markdown。',
    '尽量读取截图中的原始分类、人数、占比；不要编造看不清的数据。',
    '地图数据只抽取旁边表格或清晰文字，不要凭颜色猜省份或城市。',
    'JSON 格式：',
    JSON.stringify({
      highlights: ['女性为主，占比59.5%'],
      gender: { main: '女性为主', items: [{ label: '女性', count: 1510, percent: 59.5 }] },
      age: { main: '>59岁', items: [{ label: '>59', percent: 29.0 }] },
      purchasePreference: { main: '服饰内衣', items: [{ label: '服饰内衣', percent: 22.7 }] },
      crowdAttribute: { main: '小镇中老年', items: [{ label: '小镇中老年', percent: 29.9 }] },
      consumption: { main: '0-99元', items: [{ label: '0-99', percent: 60.3 }] },
      region: {
        main: '上海市',
        provinces: [{ rank: 1, name: '上海市', count: 341, percent: 13.4 }],
        cities: [{ rank: 1, name: '广州市', count: 53, percent: 16.9 }],
      },
      fanRatio: { items: [{ label: '粉丝', count: 94, percent: 3.7 }] },
      buyerRatio: { items: [{ label: '曾经买过', count: 4, percent: 0.2 }] },
      sections: ['性别：女性1510人，占比59.5%'],
      warnings: [],
    }),
    '关联直播：',
    JSON.stringify(live || {}),
  ].join('\n')
}

function buildChannelPrompt(live: unknown) {
  return [
    '请识别这些视频号直播渠道流量分析、预约分析截图，抽取可用于直播复盘的渠道数据。',
    '只输出 JSON，不要输出 Markdown。',
    '百分比只输出数字，例如 49.15；金额只输出数字，例如 154；人数和次数只输出数字。',
    '看不清或截图没有出现的数据填 null 或空数组，并在 warnings 里说明。',
    '不要把同一项重复计算；父级渠道和子级渠道要分别保留。',
    'JSON 格式：',
    JSON.stringify({
      highlights: ['公域流量进房3704，占比49.15%'],
      trafficFunnel: {
        exposures: 50834,
        entrances: 7536,
        productClicks: 238,
        createdOrders: 5,
        paidOrders: 5,
        exposureToEntranceRate: 14.82,
        entranceToClickRate: 3.16,
        clickToOrderRate: 2.1,
        orderPayRate: 100,
      },
      trafficSources: [
        {
          type: '公域流量',
          entrances: 3704,
          entranceShare: 49.15,
          gmv: 34,
          gmvShare: 22.08,
          gmvPerThousandViews: 9.18,
          children: [
            { name: '直播推荐', entrances: 3612, entranceShare: 47.93, gmv: 34, gmvShare: 22.08, gmvPerThousandViews: 9.41 },
          ],
        },
      ],
      reservationChannels: [
        { channel: '预约抽奖', reservedUsers: 136, reservedShare: 42.37, watchedUsers: 61, watchedShare: 29.47, watchRate: 44.85, gmv: 34 },
      ],
      warnings: [],
    }),
    '关联直播：',
    JSON.stringify(live || {}),
  ].join('\n')
}

async function callDeepSeekJson(model: string, messages: unknown[], useJsonMode = true) {
  const apiKey = Deno.env.get('DEEPSEEK_API_KEY')
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured')
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
      temperature: 0.25,
      max_tokens: 4096,
    }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result?.error?.message || `DeepSeek HTTP ${response.status}`)
  return extractJson(result?.choices?.[0]?.message?.content || '')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Only POST is supported' }, 405)

  try {
    const token = getBearerToken(request)
    if (!token) return json({ error: 'Missing Supabase access token' }, 401)

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: userData, error: userError } = await supabase.auth.getUser(token)
    if (userError || !userData.user) return json({ error: 'Invalid Supabase session' }, 401)

    const { data: roleRow } = await supabase.from('user_roles').select('role').eq('user_id', userData.user.id).maybeSingle()
    const role = roleRow?.role || 'guest'
    const body = await request.json()
    const action = body.action as string

    if (action === 'profile') {
      if (role !== 'admin') return json({ error: 'Only admin can recognize profile images' }, 403)
      const content = [
        { type: 'text', text: buildProfilePrompt(body.live) },
        ...((body.images || []) as { dataUrl: string }[]).slice(0, 6).map((image) => ({
          type: 'image_url',
          image_url: { url: image.dataUrl },
        })),
      ]
      const profile = await callDeepSeekJson(Deno.env.get('DEEPSEEK_VISION_MODEL') || 'deepseek-v4-flash-vision-exp', [
        { role: 'system', content: '你是严谨的数据录入助手，优先准确抽取截图里的可见数字。' },
        { role: 'user', content },
      ], false)
      return json({ profile })
    }

    if (action === 'channel') {
      if (role !== 'admin') return json({ error: 'Only admin can recognize channel images' }, 403)
      const content = [
        { type: 'text', text: buildChannelPrompt(body.live) },
        ...((body.images || []) as { dataUrl: string }[]).slice(0, 6).map((image) => ({
          type: 'image_url',
          image_url: { url: image.dataUrl },
        })),
      ]
      const channelProfile = await callDeepSeekJson(Deno.env.get('DEEPSEEK_VISION_MODEL') || 'deepseek-v4-flash-vision-exp', [
        { role: 'system', content: '你是严谨的数据录入助手，优先准确抽取截图里的可见数字。' },
        { role: 'user', content },
      ], false)
      return json({ channelProfile })
    }

    if (action === 'review') {
      if (role !== 'admin') return json({ error: 'Only admin can generate AI reviews' }, 403)
      const review = await callDeepSeekJson(Deno.env.get('DEEPSEEK_MODEL') || 'deepseek-v4-flash', [
        { role: 'system', content: '你是资深直播运营分析师，擅长把场次数据转成可执行复盘。' },
        { role: 'user', content: buildReviewPrompt(body.payload || {}) },
      ])
      return json({ review })
    }

    return json({ error: 'Unsupported action' }, 400)
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'AI gateway failed' }, 500)
  }
})
