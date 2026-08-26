export type UserRole = 'admin' | 'guest'

export type LiveRow = {
  id: string
  topic: string
  location: string
  startedAt: string
  liveDurationText: string
  avgWatchText: string
  viewers: number
  views: number
  peakOnline: number
  avgWatchSec: number
  liveDurationSec: number
  likes: number
  comments: number
  shares: number
  follows: number
  heat: number
  giftUsers: number
  giftTimes: number
  gmv: number
  orders: number
  buyers: number
}

export type LiveMetrics = LiveRow & {
  viewsPerViewer: number
  followRate: number
  shareRate: number
  commentRate: number
  buyerRate: number
  gmvPerViewer: number
  avgOrderValue: number
  engagementScore: number
}

export type AudienceProfile = {
  id: string
  liveId: string
  imageCount: number
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type AiReview = {
  id: string
  scope: 'overview' | 'single'
  liveId: string | null
  datasetSignature: string
  review: {
    grade?: string
    verdictTitle?: string
    verdictText?: string
    insights?: { tone?: 'good' | 'risk' | 'info'; tag?: string; title?: string; body?: string }[]
    recommendations?: { title?: string; body?: string }[]
  }
  updatedAt: string
}

export type AppData = {
  lives: LiveRow[]
  profiles: AudienceProfile[]
  reviews: AiReview[]
}
