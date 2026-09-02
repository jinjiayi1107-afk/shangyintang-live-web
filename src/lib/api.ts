import { supabase } from './supabase'
import { datasetSignature, liveKey, withMetrics } from './data'
import type { AiReview, AppData, AudienceProfile, ChannelProfile, LiveRow, UserRole } from '../types'

type DbLive = {
  id: string
  topic: string
  location: string
  started_at_text: string
  live_duration_text: string
  avg_watch_text: string
  viewers: number
  views: number
  peak_online: number
  avg_watch_sec: number
  live_duration_sec: number
  likes: number
  comments: number
  shares: number
  follows: number
  heat: number
  gift_users: number
  gift_times: number
  gmv: number
  orders: number
  buyers: number
}

function fromDbLive(row: DbLive): LiveRow {
  return {
    id: row.id,
    topic: row.topic,
    location: row.location,
    startedAt: row.started_at_text,
    liveDurationText: row.live_duration_text,
    avgWatchText: row.avg_watch_text,
    viewers: row.viewers,
    views: row.views,
    peakOnline: row.peak_online,
    avgWatchSec: row.avg_watch_sec,
    liveDurationSec: row.live_duration_sec,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    follows: row.follows,
    heat: row.heat,
    giftUsers: row.gift_users,
    giftTimes: row.gift_times,
    gmv: Number(row.gmv || 0),
    orders: row.orders,
    buyers: row.buyers,
  }
}

function toDbLive(row: LiveRow) {
  return {
    id: row.id,
    topic: row.topic,
    location: row.location,
    started_at_text: row.startedAt,
    live_duration_text: row.liveDurationText,
    avg_watch_text: row.avgWatchText,
    viewers: row.viewers,
    views: row.views,
    peak_online: row.peakOnline,
    avg_watch_sec: row.avgWatchSec,
    live_duration_sec: row.liveDurationSec,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    follows: row.follows,
    heat: row.heat,
    gift_users: row.giftUsers,
    gift_times: row.giftTimes,
    gmv: row.gmv,
    orders: row.orders,
    buyers: row.buyers,
    updated_at: new Date().toISOString(),
  }
}

export async function getRole(): Promise<UserRole> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  const userId = userData.user?.id
  if (!userId) return 'guest'

  const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', userId).limit(1)
  if (error) throw error
  return data?.[0]?.role === 'admin' ? 'admin' : 'guest'
}

export async function loadAppData(): Promise<AppData> {
  const [livesResult, profilesResult, channelProfilesResult, reviewsResult] = await Promise.all([
    supabase.from('live_sessions').select('*').order('started_at_text', { ascending: false }),
    supabase.from('audience_profiles').select('*').order('updated_at', { ascending: false }),
    supabase.from('channel_profiles').select('*').order('updated_at', { ascending: false }),
    supabase.from('ai_reviews').select('*').order('updated_at', { ascending: false }),
  ])
  if (livesResult.error) throw livesResult.error
  if (profilesResult.error) throw profilesResult.error
  const channelProfilesMissing = channelProfilesResult.error && String(channelProfilesResult.error.message || '').includes('channel_profiles')
  if (channelProfilesResult.error && !channelProfilesMissing) throw channelProfilesResult.error
  if (reviewsResult.error) throw reviewsResult.error
  const channelRows = channelProfilesMissing ? [] : channelProfilesResult.data || []
  return {
    lives: ((livesResult.data || []) as DbLive[]).map(fromDbLive),
    profiles: (profilesResult.data || []).map((row) => ({
      id: row.id,
      liveId: row.live_id,
      imageCount: row.image_count,
      data: row.profile,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    channelProfiles: channelRows.map((row) => ({
      id: row.id,
      liveId: row.live_id,
      imageCount: row.image_count,
      data: row.channel_profile,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    reviews: (reviewsResult.data || []).map((row) => ({
      id: row.id,
      scope: row.scope,
      liveId: row.live_id,
      datasetSignature: row.dataset_signature,
      review: row.review,
      updatedAt: row.updated_at,
    })),
  }
}

export async function upsertLives(rows: LiveRow[]) {
  const { error } = await supabase.from('live_sessions').upsert(rows.map(toDbLive), { onConflict: 'id' })
  if (error) throw error
}

export async function saveProfile(liveId: string, imageCount: number, profile: Record<string, unknown>) {
  const { error } = await supabase.from('audience_profiles').upsert({
    live_id: liveId,
    image_count: imageCount,
    profile,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'live_id' })
  if (error) throw error
}

export async function saveChannelProfile(liveId: string, imageCount: number, channelProfile: ChannelProfile['data']) {
  const { error } = await supabase.from('channel_profiles').upsert({
    live_id: liveId,
    image_count: imageCount,
    channel_profile: channelProfile,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'live_id' })
  if (error) throw error
}

export async function saveReview(scope: 'overview' | 'single', liveId: string | null, rows: LiveRow[], review: AiReview['review']) {
  const payload = {
    scope,
    live_id: liveId,
    dataset_signature: datasetSignature(rows),
    review,
    updated_at: new Date().toISOString(),
  }
  if (scope === 'overview') {
    const { data: existing, error: findError } = await supabase
      .from('ai_reviews')
      .select('id')
      .eq('scope', 'overview')
      .is('live_id', null)
      .maybeSingle()
    if (findError) throw findError
    if (existing?.id) {
      const { error } = await supabase.from('ai_reviews').update(payload).eq('id', existing.id)
      if (error) throw error
      return
    }
    const { error } = await supabase.from('ai_reviews').insert(payload)
    if (error) throw error
    return
  }
  const { error } = await supabase.from('ai_reviews').upsert(payload, { onConflict: 'scope,live_id' })
  if (error) throw error
}

type LegacyImportPayload = {
  profiles?: Record<string, { imageCount?: number; data?: Record<string, unknown> }>
  ai?: {
    overview?: { review?: AiReview['review'] } | null
    details?: Record<string, AiReview['review']>
  }
}

export async function importLegacyData(payload: LegacyImportPayload, rows: LiveRow[]) {
  const liveIdByKey = new Map(rows.map((row) => [liveKey(row), row.id]))
  const now = new Date().toISOString()
  let profileCount = 0
  let reviewCount = 0
  let skipped = 0

  const profileRows = Object.entries(payload.profiles || {}).flatMap(([key, profile]) => {
    const liveId = liveIdByKey.get(key)
    if (!liveId || !profile?.data) {
      skipped += 1
      return []
    }
    profileCount += 1
    return [{
      live_id: liveId,
      image_count: Number(profile.imageCount || 0),
      profile: profile.data,
      updated_at: now,
    }]
  })
  if (profileRows.length) {
    const { error } = await supabase.from('audience_profiles').upsert(profileRows, { onConflict: 'live_id' })
    if (error) throw error
  }

  const overviewReview = payload.ai?.overview?.review
  if (overviewReview) {
    await saveReview('overview', null, rows, overviewReview)
    reviewCount += 1
  }

  const detailRows = Object.entries(payload.ai?.details || {}).flatMap(([key, review]) => {
    const liveId = liveIdByKey.get(key)
    if (!liveId || !review) {
      skipped += 1
      return []
    }
    reviewCount += 1
    return [{
      scope: 'single',
      live_id: liveId,
      dataset_signature: datasetSignature(rows),
      review,
      updated_at: now,
    }]
  })
  if (detailRows.length) {
    const { error } = await supabase.from('ai_reviews').upsert(detailRows, { onConflict: 'scope,live_id' })
    if (error) throw error
  }

  return { profileCount, reviewCount, skipped }
}

export async function invokeAi(action: 'review' | 'profile' | 'channel', body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('live-ai-gateway', { body: { action, ...body } })
  if (error) throw new Error(error.message || 'AI gateway request failed')
  if (!data) throw new Error('AI gateway returned empty response')
  return data as { review?: AiReview['review']; profile?: Record<string, unknown>; channelProfile?: ChannelProfile['data']; error?: string }
}

export function compactPayload(rows: LiveRow[], profiles: AudienceProfile[], channelProfiles: ChannelProfile[], scope: 'overview' | 'single', selectedLive: LiveRow | null) {
  const metrics = rows.map(withMetrics)
  const profileByLive = new Map(profiles.map((profile) => [profile.liveId, profile]))
  const channelProfileByLive = new Map(channelProfiles.map((profile) => [profile.liveId, profile]))
  const totals = {
    liveCount: rows.length,
    totalViewers: metrics.reduce((sum, row) => sum + row.viewers, 0),
    totalViews: metrics.reduce((sum, row) => sum + row.views, 0),
    totalFollows: metrics.reduce((sum, row) => sum + row.follows, 0),
    totalGmv: metrics.reduce((sum, row) => sum + row.gmv, 0),
    totalOrders: metrics.reduce((sum, row) => sum + row.orders, 0),
    totalBuyers: metrics.reduce((sum, row) => sum + row.buyers, 0),
  }
  return {
    scope,
    totals,
    audienceProfiles: profiles.map((profile) => ({ liveId: profile.liveId, data: profile.data })),
    channelProfiles: channelProfiles.map((profile) => ({ liveId: profile.liveId, data: profile.data })),
    selectedProfile: selectedLive ? profileByLive.get(selectedLive.id) || null : null,
    selectedChannelProfile: selectedLive ? channelProfileByLive.get(selectedLive.id) || null : null,
    selectedLive: selectedLive ? withMetrics(selectedLive) : null,
    lives: metrics,
  }
}
