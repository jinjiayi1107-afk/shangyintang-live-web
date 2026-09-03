import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BarChart3, Bot, CheckSquare, Eye, FileUp, ImageUp, LogOut, RefreshCw, ShieldCheck } from 'lucide-react'
import { supabase } from './lib/supabase'
import { compactPayload, getRole, importLegacyData, invokeAi, loadAppData, saveChannelProfile, saveProfile, saveReview, upsertLives } from './lib/api'
import { average, datasetSignature, formatMoney, formatNumber, formatPercent, formatSeconds, maxRow, parseCsv, withMetrics } from './lib/data'
import { seedLives } from './lib/seed'
import type { AiReview, AppData, AudienceProfile, ChannelProfile, LiveMetrics, LiveRow, UserRole } from './types'
import './App.css'

const accountEmail: Record<string, string> = {
  admin: 'admin@shangyintang.local',
  guest: 'guest@shangyintang.local',
}

type Tab = 'overview' | 'compare' | 'detail' | 'profile' | 'channel' | 'data'
type Notice = { text: string; kind: 'error' | 'success' }
type UploadImage = { name: string; dataUrl: string }
type BatchProgress = { running: boolean; done: number; total: number; current: string; failed: number; failures: { topic: string; message: string }[] }

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => data.subscription.unsubscribe()
  }, [])

  if (loading) return <div className="login-wrap">正在连接 Supabase...</div>
  if (!session) return <Login />
  return <Dashboard />
}

function Login() {
  const [account, setAccount] = useState('admin')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function signIn() {
    const email = accountEmail[account.trim()] || `${account.trim()}@shangyintang.local`
    setBusy(true)
    setMessage('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setMessage('账户名或密码不正确。')
  }

  return (
    <main className="login-wrap">
      <section className="login-card">
        <div className="brand-mark"><BarChart3 size={22} /></div>
        <h1>尚音堂直播数据分析</h1>
        <p>使用账户名和密码登录，访客只能浏览已生成内容。</p>
        <label>账户名<input value={account} onChange={(event) => setAccount(event.target.value)} /></label>
        <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void signIn() }} /></label>
        {message && <div className="login-error">{message}</div>}
        <button disabled={busy || !account || !password} onClick={() => void signIn()}>{busy ? '登录中' : '登录'}</button>
      </section>
    </main>
  )
}

async function prepareImageFile(file: File): Promise<UploadImage> {
  const dataUrl = await readFileAsDataUrl(file)
  if (!file.type.startsWith('image/') || dataUrl.length < 900_000) return { name: file.name, dataUrl }
  try {
    const image = await loadImage(dataUrl)
    const maxSide = 1800
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) return { name: file.name, dataUrl }
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const compressed = canvas.toDataURL('image/jpeg', 0.82)
    return { name: file.name, dataUrl: compressed.length < dataUrl.length ? compressed : dataUrl }
  } catch {
    return { name: file.name, dataUrl }
  }
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = dataUrl
  })
}

function Dashboard() {
  const [role, setRole] = useState<UserRole>('guest')
  const [tab, setTab] = useState<Tab>('overview')
  const [data, setData] = useState<AppData>({ lives: seedLives, profiles: [], channelProfiles: [], reviews: [] })
  const [selectedId, setSelectedId] = useState(seedLives[0]?.id || '')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState('')
  const [profileFiles, setProfileFiles] = useState<UploadImage[]>([])
  const [profileMessage, setProfileMessage] = useState<Notice | null>(null)
  const [channelFiles, setChannelFiles] = useState<UploadImage[]>([])
  const [channelMessage, setChannelMessage] = useState<Notice | null>(null)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchSelected, setBatchSelected] = useState<string[]>([])
  const [batchProgress, setBatchProgress] = useState<BatchProgress>({ running: false, done: 0, total: 0, current: '', failed: 0, failures: [] })
  const [legacyText, setLegacyText] = useState('')
  const isAdmin = role === 'admin'

  const metrics = useMemo(() => data.lives.map(withMetrics), [data.lives])
  const selected = data.lives.find((live) => live.id === selectedId) || data.lives[0] || null
  const selectedMetrics = selected ? withMetrics(selected) : null
  const profileByLive = useMemo(() => new Map(data.profiles.map((profile) => [profile.liveId, profile])), [data.profiles])
  const channelByLive = useMemo(() => new Map(data.channelProfiles.map((profile) => [profile.liveId, profile])), [data.channelProfiles])
  const currentProfile = selected ? profileByLive.get(selected.id) || null : null
  const currentChannel = selected ? channelByLive.get(selected.id) || null : null
  const overviewReview = data.reviews.find((review) => review.scope === 'overview' && review.datasetSignature === datasetSignature(data.lives))
  const detailReview = selected ? data.reviews.find((review) => review.scope === 'single' && review.liveId === selected.id) : null
  const aiBusyName = aiFlowName(busy)
  const aiBusyTitle = aiBusyName ? `当前正在运行：${aiBusyName}` : undefined

  async function refresh() {
    const [nextRole, nextData] = await Promise.all([getRole(), loadAppData()])
    setRole(nextRole)
    setData(nextData.lives.length ? nextData : { ...nextData, lives: seedLives })
    setSelectedId((current) => nextData.lives.some((live) => live.id === current) ? current : nextData.lives[0]?.id || seedLives[0]?.id || '')
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refresh().catch((error) => showNotice(error.message, 'error'))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  function showNotice(text: string, kind: Notice['kind'] = 'success') {
    setNotice({ text, kind })
    window.setTimeout(() => setNotice(null), 4500)
  }

  async function handleCsv(file: File) {
    if (!isAdmin) return
    setBusy('csv')
    try {
      const text = await file.text()
      const rows = parseCsv(text)
      await upsertLives(rows)
      await refresh()
      showNotice(`已导入 ${rows.length} 场直播。`)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '导入失败', 'error')
    } finally {
      setBusy('')
    }
  }

  async function readImageFiles(files: FileList | null, setter: (files: UploadImage[]) => void) {
    const list = Array.from(files || [])
    const next = await Promise.all(list.map(prepareImageFile))
    setter(next)
  }

  async function readProfileFiles(files: FileList | null) {
    const count = files?.length || 0
    await readImageFiles(files, setProfileFiles)
    setProfileMessage(count ? { text: `已选择 ${count} 张用户画像截图，可以点击识别并关联。`, kind: 'success' } : null)
  }

  async function readChannelFiles(files: FileList | null) {
    const count = files?.length || 0
    await readImageFiles(files, setChannelFiles)
    setChannelMessage(count ? { text: `已选择 ${count} 张渠道截图，可以点击识别并关联。`, kind: 'success' } : null)
  }

  async function extractProfile() {
    if (!isAdmin || aiBusyName || !selected || !profileFiles.length) return
    setBusy('profile')
    setProfileMessage({ text: `正在识别 ${profileFiles.length} 张截图，并关联到「${selected.topic}」。`, kind: 'success' })
    try {
      const result = await invokeAi('profile', {
        live: selected,
        images: profileFiles,
      })
      if (!result.profile) throw new Error('画像识别返回为空。')
      await saveProfile(selected.id, profileFiles.length, result.profile)
      setProfileFiles([])
      await refresh()
      setProfileMessage({ text: `用户画像已保存到「${selected.topic}」，下方图表已更新。`, kind: 'success' })
      showNotice(`已关联画像：${selected.topic}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '画像识别失败'
      setProfileMessage({ text: message, kind: 'error' })
      showNotice(message, 'error')
    } finally {
      setBusy('')
    }
  }

  async function extractChannel() {
    if (!isAdmin || aiBusyName || !selected || !channelFiles.length) return
    setBusy('channel')
    setChannelMessage({ text: `正在识别 ${channelFiles.length} 张截图，并关联到「${selected.topic}」。`, kind: 'success' })
    try {
      const result = await invokeAi('channel', {
        live: selected,
        images: channelFiles,
      })
      if (!result.channelProfile) throw new Error('渠道识别返回为空。')
      await saveChannelProfile(selected.id, channelFiles.length, result.channelProfile)
      setChannelFiles([])
      await refresh()
      setChannelMessage({ text: `渠道数据已保存到「${selected.topic}」，下方图表已更新。`, kind: 'success' })
      showNotice(`已关联渠道数据：${selected.topic}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '渠道识别失败'
      setChannelMessage({ text: message, kind: 'error' })
      showNotice(message, 'error')
    } finally {
      setBusy('')
    }
  }

  async function generateSingleReviewFor(live: LiveRow) {
    const result = await invokeAi('review', {
      payload: compactPayload(data.lives, data.profiles, data.channelProfiles, 'single', live),
    })
    if (!result.review) throw new Error('AI 分析返回为空。')
    await saveReview('single', live.id, data.lives, result.review)
  }

  async function generateReview(scope: 'overview' | 'single') {
    if (!isAdmin || aiBusyName) return
    if (scope === 'single' && !selected) return
    setBusy(scope)
    try {
      if (scope === 'single') {
        await generateSingleReviewFor(selected)
      } else {
        const result = await invokeAi('review', {
          payload: compactPayload(data.lives, data.profiles, data.channelProfiles, scope, null),
        })
        if (!result.review) throw new Error('AI 分析返回为空。')
        await saveReview(scope, null, data.lives, result.review)
      }
      await refresh()
      showNotice(scope === 'overview' ? '总览 AI 分析已生成。' : `${selected?.topic} 的 AI 分析已生成。`)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'AI 分析失败', 'error')
    } finally {
      setBusy('')
    }
  }

  function toggleBatchPanel() {
    const opening = !batchOpen
    if (opening && !batchSelected.length && selected) setBatchSelected([selected.id])
    setBatchOpen(opening)
  }

  function toggleBatchLive(id: string) {
    setBatchSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function selectAllBatchLives() {
    setBatchSelected((current) => current.length === data.lives.length ? [] : data.lives.map((live) => live.id))
  }

  async function generateBatchReviews() {
    if (!isAdmin || aiBusyName) return
    const targets = data.lives.filter((live) => batchSelected.includes(live.id))
    if (!targets.length) {
      showNotice('请先选择需要重新生成 AI 分析的场次。', 'error')
      return
    }
    let failed = 0
    const failures: BatchProgress['failures'] = []
    setBusy('batch')
    setBatchProgress({ running: true, done: 0, total: targets.length, current: targets[0]?.topic || '', failed: 0, failures: [] })
    try {
      for (let index = 0; index < targets.length; index += 1) {
        const live = targets[index]
        setBatchProgress({ running: true, done: index, total: targets.length, current: live.topic, failed, failures })
        try {
          await generateSingleReviewFor(live)
        } catch (error) {
          failed += 1
          failures.push({ topic: live.topic, message: error instanceof Error ? error.message : '生成失败' })
        }
        setBatchProgress({ running: true, done: index + 1, total: targets.length, current: live.topic, failed, failures: [...failures] })
      }
      await refresh()
      showNotice(failed ? `批量生成完成，成功 ${targets.length - failed} 场，失败 ${failed} 场。` : `批量生成完成，共 ${targets.length} 场。`, failed ? 'error' : 'success')
    } finally {
      setBusy('')
      setBatchProgress((current) => ({ ...current, running: false, current: '' }))
    }
  }

  async function importLegacySource(source: 'storage' | 'text') {
    if (!isAdmin) return
    setBusy('legacy')
    try {
      const raw = source === 'storage'
        ? JSON.stringify({
          profiles: JSON.parse(localStorage.getItem('shangyintang_audience_profiles_v1') || '{}'),
          ai: JSON.parse(localStorage.getItem('shangyintang_ai_reviews_v1') || '{}'),
        })
        : legacyText
      const payload = JSON.parse(raw || '{}')
      const result = await importLegacyData(payload, data.lives)
      await refresh()
      setLegacyText('')
      showNotice(`迁移完成：画像 ${result.profileCount} 条，AI 分析 ${result.reviewCount} 条，跳过 ${result.skipped} 条。`)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '旧版数据迁移失败', 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <h1>尚音堂直播数据分析</h1>
          <p>{isAdmin ? '管理员可上传数据、识别画像和生成 AI 分析' : '访客模式，只能浏览已生成内容'}</p>
        </div>
        <div className="actions">
          <span className="role">{isAdmin ? <ShieldCheck size={16} /> : <Eye size={16} />}{isAdmin ? '管理员' : '访客'}</span>
          {isAdmin && (
            <label className="button">
              <FileUp size={16} />{busy === 'csv' ? '导入中' : '上传直播数据'}
              <input hidden type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleCsv(file); event.currentTarget.value = '' }} />
            </label>
          )}
          <button className="button subtle" onClick={() => void supabase.auth.signOut()}><LogOut size={16} />退出</button>
        </div>
      </header>
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}

      <main>
        <Summary metrics={metrics} />
        <nav className="tabs">
          {(['overview', 'compare', 'detail', 'profile', 'channel', 'data'] as Tab[]).map((item) => (
            <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{tabName(item)}</button>
          ))}
        </nav>
        {tab === 'overview' ? (
          <section className="content content-full">
            <Overview metrics={metrics} review={overviewReview} isAdmin={isAdmin} busy={busy === 'overview'} disabled={Boolean(aiBusyName) && busy !== 'overview'} disabledTitle={aiBusyTitle} onAi={() => void generateReview('overview')} />
          </section>
        ) : (
          <section className="workspace">
            <LiveSide metrics={metrics} selectedId={selected?.id || ''} onSelect={setSelectedId} />
            <div className="content">
              {tab === 'compare' && <Compare metrics={metrics} />}
              {tab === 'detail' && selectedMetrics && <Detail live={selectedMetrics} lives={metrics} selectedIds={batchSelected} batchOpen={batchOpen} channelProfile={currentChannel || null} review={detailReview || undefined} isAdmin={isAdmin} busy={busy === 'single' || busy === 'batch'} disabled={Boolean(aiBusyName) && busy !== 'single' && busy !== 'batch'} disabledTitle={aiBusyTitle} onAi={() => void generateReview('single')} onToggleBatch={toggleBatchPanel} onToggleLive={toggleBatchLive} onSelectAll={selectAllBatchLives} onBatchRun={() => void generateBatchReviews()} />}
              {tab === 'profile' && selected && <Profile live={selected} profile={currentProfile || null} files={profileFiles} message={profileMessage} isAdmin={isAdmin} busy={busy === 'profile'} disabled={Boolean(aiBusyName) && busy !== 'profile'} disabledTitle={aiBusyTitle} onFiles={readProfileFiles} onExtract={() => void extractProfile()} />}
              {tab === 'channel' && selected && <Channel live={selected} channelProfile={currentChannel || null} files={channelFiles} message={channelMessage} isAdmin={isAdmin} busy={busy === 'channel'} disabled={Boolean(aiBusyName) && busy !== 'channel'} disabledTitle={aiBusyTitle} onFiles={readChannelFiles} onExtract={() => void extractChannel()} />}
              {tab === 'data' && <DataTable metrics={metrics} isAdmin={isAdmin} busy={busy === 'legacy'} legacyText={legacyText} onLegacyText={setLegacyText} onImportLegacy={importLegacySource} />}
            </div>
          </section>
        )}
      </main>
      <GlobalBatchProgress progress={batchProgress} />
    </div>
  )
}

function LiveSide({ metrics, selectedId, onSelect }: { metrics: LiveMetrics[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <aside className="side">
      <h2>直播场次</h2>
      {metrics.map((live) => (
        <button key={live.id} className={selectedId === live.id ? 'live active' : 'live'} onClick={() => onSelect(live.id)}>
          <b>{live.topic}</b><span>{formatNumber(live.viewers)} 人观看 · {formatSeconds(live.avgWatchSec)} · {formatMoney(live.gmv)}</span>
        </button>
      ))}
    </aside>
  )
}

function tabName(tab: Tab) {
  return ({ overview: '复盘总览', compare: '场次对比', detail: '单场拆解', profile: '用户画像', channel: '渠道分析', data: '原始数据' } satisfies Record<Tab, string>)[tab]
}

function Summary({ metrics }: { metrics: LiveMetrics[] }) {
  const totalViewers = metrics.reduce((sum, live) => sum + live.viewers, 0)
  const totalFollows = metrics.reduce((sum, live) => sum + live.follows, 0)
  const totalGmv = metrics.reduce((sum, live) => sum + live.gmv, 0)
  const bestTraffic = maxRow(metrics, 'viewers')
  const bestRetention = maxRow(metrics, 'avgWatchSec')
  const bestCommerce = maxRow(metrics, 'gmv')
  const avgWatch = average(metrics, 'avgWatchSec')
  const followRate = totalViewers ? totalFollows / totalViewers : 0
  return (
    <section className="summary-grid">
      <div className="panel panel-pad">
        <div className="section-head">
          <div>
            <h2>整体复盘</h2>
            <p>{periodLabel(metrics)}，共 {metrics.length} 场直播</p>
          </div>
        </div>
        <div className="score">
          <Metric label="累计观看人数" value={formatNumber(totalViewers)} note={bestTraffic ? `最高：${bestTraffic.topic}` : undefined} />
          <Metric label="平均观看时长" value={formatSeconds(avgWatch)} note={bestRetention ? `最长：${bestRetention.topic}` : undefined} />
          <Metric label="新增关注" value={formatNumber(totalFollows)} note={`整体关注率 ${formatPercent(followRate)}`} />
          <Metric label="成交金额" value={formatMoney(totalGmv)} note={bestCommerce ? `最高：${bestCommerce.topic}` : undefined} />
        </div>
      </div>
      <div className="panel panel-pad verdict">
        <div className="grade">{ruleGrade(metrics)}</div>
        <div>
          <h2>{ruleVerdict(metrics).title}</h2>
          <p>{ruleVerdict(metrics).body}</p>
        </div>
      </div>
    </section>
  )
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="metric"><b>{value}</b><span>{label}</span>{note && <small>{note}</small>}</div>
}

function Overview({ metrics, review, isAdmin, busy, disabled, disabledTitle, onAi }: { metrics: LiveMetrics[]; review?: AiReview; isAdmin: boolean; busy: boolean; disabled: boolean; disabledTitle?: string; onAi: () => void }) {
  const bestTraffic = maxRow(metrics, 'viewers')
  const bestRetention = maxRow(metrics, 'avgWatchSec')
  const bestEngagement = maxRow(metrics, 'engagementScore')
  const bestFollow = maxRow(metrics, 'followRate')
  const bestCommerce = maxRow(metrics, 'gmv')
  const lowFollowHighTraffic = metrics
    .filter((row) => row.viewers >= average(metrics, 'viewers') && row.followRate < average(metrics, 'followRate'))
    .sort((a, b) => b.viewers - a.viewers)[0]
  return (
    <div className="stack">
      <div className="insights">
        <Insight tone="good" tag="起量样本" title={bestTraffic ? `${bestTraffic.topic} 触达最强` : '暂无数据'} body={bestTraffic ? `观看人数 ${formatNumber(bestTraffic.viewers)}，适合拆解标题、嘉宾、预约和开播时间。` : '上传数据后生成。'} />
        <Insight tone="info" tag="内容粘性" title={bestRetention ? `${bestRetention.topic} 留存最好` : '暂无数据'} body={bestRetention ? `平均观看 ${formatSeconds(bestRetention.avgWatchSec)}，说明这个主题更能让观众停下来听。` : '上传数据后生成。'} />
        <Insight tone="good" tag="互动质量" title={bestEngagement ? `${bestEngagement.topic} 互动最强` : '暂无数据'} body={bestEngagement ? `评论率 ${formatPercent(bestEngagement.commentRate, 2)}，分享率 ${formatPercent(bestEngagement.shareRate, 1)}，可作为互动脚本参考。` : '上传数据后生成。'} />
        <Insight tone="info" tag="关注沉淀" title={bestFollow ? `${bestFollow.topic} 关注转化最好` : '暂无数据'} body={bestFollow ? `新增关注 ${formatNumber(bestFollow.follows)}，关注率 ${formatPercent(bestFollow.followRate, 1)}。` : '上传数据后生成。'} />
        <Insight tone={bestCommerce && bestCommerce.gmv > 0 ? 'good' : 'risk'} tag="成交结果" title={bestCommerce && bestCommerce.gmv > 0 ? `${bestCommerce.topic} 成交最高` : '成交信号偏弱'} body={bestCommerce && bestCommerce.gmv > 0 ? `成交金额 ${formatMoney(bestCommerce.gmv)}，订单 ${formatNumber(bestCommerce.orders)}，客单价 ${formatMoney(bestCommerce.avgOrderValue)}。` : '当前数据没有明显成交，需要补强商品露出和行动提示。'} />
        <Insight tone={lowFollowHighTraffic ? 'risk' : 'info'} tag="待优化点" title={lowFollowHighTraffic ? `${lowFollowHighTraffic.topic} 流量高但沉淀弱` : '暂无明显高流量低沉淀场次'} body={lowFollowHighTraffic ? `观看 ${formatNumber(lowFollowHighTraffic.viewers)}，关注率仅 ${formatPercent(lowFollowHighTraffic.followRate, 1)}，需要在开场、中段和收尾加入关注理由。` : '继续观察后续场次，重点看流量是否能转为关注和成交。'} />
      </div>
      <Recommendations metrics={metrics} />
      <AiPanel title="AI 总览复盘" review={review} isAdmin={isAdmin} busy={busy} disabled={disabled} disabledTitle={disabledTitle} generateLabel={review ? '重新生成总览 AI 分析' : '生成总览 AI 分析'} onAi={onAi} />
    </div>
  )
}

function Recommendations({ metrics }: { metrics: LiveMetrics[] }) {
  const avgWatch = average(metrics, 'avgWatchSec')
  const avgFollow = average(metrics, 'followRate')
  const avgConversion = average(metrics, 'buyerRate')
  const bestRetention = maxRow(metrics, 'avgWatchSec')
  const bestTraffic = maxRow(metrics, 'viewers')
  const bestCommerce = maxRow(metrics, 'gmv')
  const recs = [
    {
      title: '把高流量选题和高留存结构合并',
      body: bestTraffic && bestRetention ? `用 ${bestTraffic.topic} 的触达方式做开场，用 ${bestRetention.topic} 的内容结构做中段，让流量不只进来，也能留下来。` : '先积累更多场次，再比较不同主题结构。',
    },
    avgWatch < 90 ? {
      title: '前 3 分钟增加明确钩子',
      body: '用本场会听到什么、适合谁、最后能得到什么来降低跳出，避免开场过长寒暄。',
    } : {
      title: '保留深度内容的节奏优势',
      body: `当前平均观看 ${formatSeconds(avgWatch)}，说明深度内容有机会成立，下一步是让关键观点更早出现。`,
    },
    avgFollow < 0.02 ? {
      title: '把关注理由写进直播流程',
      body: '在开场、中段高互动后、收尾各提醒一次，理由要具体：后续曲目、嘉宾、幕后内容或资料更新。',
    } : {
      title: '放大关注表现好的话术',
      body: `当前平均关注率 ${formatPercent(avgFollow, 1)}，建议复用表现最好场次里的关注承诺和提醒位置。`,
    },
    !bestCommerce || bestCommerce.gmv <= 0 || avgConversion < 0.002 ? {
      title: '成交动作需要提前设计',
      body: '商品或票务不要只在结尾出现，建议在内容高潮后插入一次自然转化，并用限时权益、曲目关联或嘉宾推荐承接。',
    } : {
      title: '复制成交最高场次的商品承接',
      body: `${bestCommerce.topic} 已经证明有成交能力，建议复盘商品出现时机、口播方式和下单路径。`,
    },
    {
      title: '后续每场补充运营备注',
      body: '建议新增手工记录：预热渠道、嘉宾、主推商品、投流情况、直播脚本版本。只靠平台导出数据，很难解释波动原因。',
    },
  ]
  return (
    <section className="panel panel-pad">
      <div className="section-head">
        <div>
          <h2>下一轮直播建议</h2>
          <p>根据当前数据的强弱项自动生成</p>
        </div>
      </div>
      <div className="recommendations">{recs.map((rec) => <div className="rec" key={rec.title}><div><b>{rec.title}</b><span>{rec.body}</span></div></div>)}</div>
    </section>
  )
}

function Compare({ metrics }: { metrics: LiveMetrics[] }) {
  return (
    <div className="grid2">
      <Bars title="观看人数排行" rows={metrics} metric="viewers" format={(v) => formatNumber(v)} color="var(--blue)" />
      <Bars title="平均观看时长排行" rows={metrics} metric="avgWatchSec" format={(v) => formatSeconds(v)} color="var(--green)" />
      <Bars title="互动强度排行" rows={metrics} metric="engagementScore" format={(v) => formatNumber(v, 2)} color="var(--orange)" />
      <Bars title="成交转化排行" rows={metrics} metric="buyerRate" format={(v) => formatPercent(v, 2)} color="var(--red)" />
    </div>
  )
}

function Bars({ title, rows, metric, format, color }: { title: string; rows: LiveMetrics[]; metric: keyof LiveMetrics; format: (value: number) => string; color: string }) {
  const sorted = [...rows].sort((a, b) => Number(b[metric]) - Number(a[metric]))
  const values = sorted.map((row) => Number(row[metric])).filter((value) => value > 0)
  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values) : 0
  const width = (value: number) => value <= 0 || max <= 0 ? 0 : max === min ? 100 : 18 + ((value - min) / (max - min)) * 82
  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className="bars">
        {sorted.map((row) => {
          const value = Number(row[metric])
          return <div className="bar" key={`${title}-${row.id}`}><span>{row.topic}</span><b>{format(value)}</b><i><em style={{ width: `${width(value)}%`, background: color }} /></i></div>
        })}
      </div>
    </section>
  )
}

function Detail({ live, lives, selectedIds, batchOpen, channelProfile, review, isAdmin, busy, disabled, disabledTitle, onAi, onToggleBatch, onToggleLive, onSelectAll, onBatchRun }: { live: LiveMetrics; lives: LiveMetrics[]; selectedIds: string[]; batchOpen: boolean; channelProfile: ChannelProfile | null; review?: AiReview; isAdmin: boolean; busy: boolean; disabled: boolean; disabledTitle?: string; onAi: () => void; onToggleBatch: () => void; onToggleLive: (id: string) => void; onSelectAll: () => void; onBatchRun: () => void }) {
  const hasChannel = channelProfile ? hasPositiveChannelData(channelProfile.data) : false
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>{live.topic}</h2>
          {isAdmin && <button className="button" disabled={disabled} title={disabled ? disabledTitle : undefined} onClick={onToggleBatch}><CheckSquare size={16} />批量重新生成</button>}
        </div>
        <div className="facts">
          <Fact label="开始时间" value={live.startedAt} />
          <Fact label="观看人数" value={formatNumber(live.viewers)} />
          <Fact label="平均观看" value={formatSeconds(live.avgWatchSec)} />
          <Fact label="新增关注" value={`${formatNumber(live.follows)}，${formatPercent(live.followRate)}`} />
          <Fact label="成交" value={`${formatMoney(live.gmv)}，${formatNumber(live.orders)} 单`} />
        </div>
        <div className={`inline-status detail-status ${hasChannel ? 'success' : 'neutral'}`}>
          {hasChannel ? '当前场次已有渠道数据，重新生成单场 AI 分析时会纳入渠道来源、预约转化和流量漏斗。' : '当前场次还没有渠道数据，单场 AI 分析只会使用直播基础数据和用户画像。'}
        </div>
      </section>
      {isAdmin && batchOpen && (
        <BatchReviewPanel
          lives={lives}
          selectedIds={selectedIds}
          busy={busy}
          disabled={disabled}
          disabledTitle={disabledTitle}
          onToggleLive={onToggleLive}
          onSelectAll={onSelectAll}
          onRun={onBatchRun}
        />
      )}
      <AiPanel title="AI 单场分析" review={review} isAdmin={isAdmin} busy={busy} disabled={disabled} disabledTitle={disabledTitle} generateLabel={review ? '重新生成单场 AI 分析' : '生成单场 AI 分析'} onAi={onAi} />
    </div>
  )
}

function BatchReviewPanel({ lives, selectedIds, busy, disabled, disabledTitle, onToggleLive, onSelectAll, onRun }: { lives: LiveMetrics[]; selectedIds: string[]; busy: boolean; disabled: boolean; disabledTitle?: string; onToggleLive: (id: string) => void; onSelectAll: () => void; onRun: () => void }) {
  const allSelected = selectedIds.length === lives.length && lives.length > 0
  return (
    <section className="panel batch-panel">
      <div className="panel-head">
        <div>
          <h2>批量重新生成单场 AI 分析</h2>
          <p className="muted">按顺序逐场生成，已关联的用户画像和渠道数据会一起纳入分析。</p>
        </div>
        <div className="batch-actions">
          <button className="button" disabled={busy} title={busy ? disabledTitle : undefined} onClick={onSelectAll}>{allSelected ? '取消全选' : '全选'}</button>
          <button className="button primary" disabled={busy || disabled || !selectedIds.length} title={busy || disabled ? disabledTitle : undefined} onClick={onRun}>确认生成 {selectedIds.length ? `${selectedIds.length} 场` : ''}</button>
        </div>
      </div>
      <div className="batch-list">
        {lives.map((item) => {
          const checked = selectedIds.includes(item.id)
          return (
            <label className={`batch-item ${checked ? 'checked' : ''}`} key={item.id}>
              <input type="checkbox" checked={checked} disabled={busy} onChange={() => onToggleLive(item.id)} />
              <span><b>{item.topic}</b><small>{formatNumber(item.viewers)} 人观看 · {formatSeconds(item.avgWatchSec)} · {formatMoney(item.gmv)}</small></span>
            </label>
          )
        })}
      </div>
    </section>
  )
}

function Profile({ live, profile, files, message, isAdmin, busy, disabled, disabledTitle, onFiles, onExtract }: { live: LiveRow; profile: AudienceProfile | null; files: UploadImage[]; message: Notice | null; isAdmin: boolean; busy: boolean; disabled: boolean; disabledTitle?: string; onFiles: (files: FileList | null) => Promise<void>; onExtract: () => void }) {
  const data = profile?.data || {}
  return (
    <div className="stack">
      <section className="panel">
        <h2>用户画像：{live.topic}</h2>
        {isAdmin && (
          <div className="upload-row">
            <label className="button"><ImageUp size={16} />上传画像截图<input hidden type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(event) => void onFiles(event.target.files)} /></label>
            <button className="button primary" disabled={!files.length || busy || disabled} title={disabled || busy ? disabledTitle : undefined} onClick={onExtract}>{busy ? '识别中' : '识别并关联'}</button>
          </div>
        )}
        {message && <div className={`inline-status ${message.kind}`}>{message.text}</div>}
        {files.length > 0 && <div className="preview">{files.map((file) => <figure key={file.name}><img src={file.dataUrl} /><figcaption>{file.name}</figcaption></figure>)}</div>}
      </section>
      {profile ? <ProfileCharts data={data} /> : <section className="empty">当前场次还没有用户画像数据。</section>}
    </div>
  )
}

function ProfileCharts({ data }: { data: Record<string, unknown> }) {
  const section = (key: string) => data[key] as { main?: string; items?: { label: string; percent: number }[] } | undefined
  return (
    <div className="grid2">
      {['gender', 'age', 'purchasePreference', 'crowdAttribute', 'consumption', 'fanRatio', 'buyerRatio'].map((key) => (
        <ProfileBar key={key} title={profileTitle(key)} items={section(key)?.items || []} />
      ))}
    </div>
  )
}

function profileTitle(key: string) {
  return ({ gender: '性别分布', age: '年龄分布', purchasePreference: '购买偏好', crowdAttribute: '人群属性', consumption: '消费力区间', fanRatio: '粉丝占比', buyerRatio: '买过观众' } as Record<string, string>)[key] || key
}

function ProfileBar({ title, items }: { title: string; items: { label: string; percent: number }[] }) {
  const sorted = [...items].filter((item) => Number.isFinite(Number(item.percent))).sort((a, b) => b.percent - a.percent).slice(0, 8)
  const max = Math.max(...sorted.map((item) => item.percent), 1)
  return <section className="panel"><h2>{title}</h2>{sorted.length ? sorted.map((item) => <div className="bar compact" key={`${title}-${item.label}`}><span>{item.label}</span><b>{Number(item.percent).toFixed(1)}%</b><i><em style={{ width: `${Math.max(4, item.percent / max * 100)}%` }} /></i></div>) : <p className="muted">暂无可视化数据</p>}</section>
}

function Channel({ live, channelProfile, files, message, isAdmin, busy, disabled, disabledTitle, onFiles, onExtract }: { live: LiveRow; channelProfile: ChannelProfile | null; files: UploadImage[]; message: Notice | null; isAdmin: boolean; busy: boolean; disabled: boolean; disabledTitle?: string; onFiles: (files: FileList | null) => Promise<void>; onExtract: () => void }) {
  const data = channelProfile?.data
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>渠道分析：{live.topic}</h2>
            <p className="muted">上传渠道流量分析、预约分析截图，识别后会关联到当前场次。</p>
          </div>
        </div>
        {isAdmin && (
          <div className="upload-row">
            <label className="button"><ImageUp size={16} />上传渠道截图<input hidden type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(event) => void onFiles(event.target.files)} /></label>
            <button className="button primary" disabled={!files.length || busy || disabled} title={disabled || busy ? disabledTitle : undefined} onClick={onExtract}>{busy ? '识别中' : '识别并关联'}</button>
          </div>
        )}
        {message && <div className={`inline-status ${message.kind}`}>{message.text}</div>}
        {files.length > 0 && <div className="preview">{files.map((file) => <figure key={file.name}><img src={file.dataUrl} /><figcaption>{file.name}</figcaption></figure>)}</div>}
      </section>
      {data ? <ChannelCharts data={data} /> : <section className="empty">当前场次还没有渠道分析数据。</section>}
    </div>
  )
}

function ChannelCharts({ data }: { data: ChannelProfile['data'] }) {
  if (!hasPositiveChannelData(data)) {
    return <section className="empty">上次渠道识别没有提取到有效数字，请重新上传清晰截图并点击识别并关联。</section>
  }
  const funnel = data.trafficFunnel || {}
  const funnelRows = [
    { label: '直播间曝光次数', value: finiteNumber(funnel.exposures) },
    { label: '进入直播间次数', value: finiteNumber(funnel.entrances) },
    { label: '商品点击次数', value: finiteNumber(funnel.productClicks) },
    { label: '创建订单数', value: finiteNumber(funnel.createdOrders) },
    { label: '成交订单数', value: finiteNumber(funnel.paidOrders) },
  ].filter((item): item is { label: string; value: number } => item.value !== null)
  const maxFunnel = Math.max(...funnelRows.map((item) => item.value), 1)
  const rateRows = [
    { label: '曝光进房率', value: finiteNumber(funnel.exposureToEntranceRate) },
    { label: '进房点击率', value: finiteNumber(funnel.entranceToClickRate) },
    { label: '点击下单率', value: finiteNumber(funnel.clickToOrderRate) },
    { label: '订单支付率', value: finiteNumber(funnel.orderPayRate) },
  ].filter((item): item is { label: string; value: number } => item.value !== null)
  const trafficSources = data.trafficSources || []
  const reservationChannels = data.reservationChannels || []

  return (
    <div className="stack">
      <div className="grid2">
        <section className="panel">
          <h2>流量漏斗</h2>
          <div className="funnel">
            {funnelRows.length ? funnelRows.map((item) => (
              <div className="funnel-row" key={item.label}>
                <span>{item.label}</span>
                <i><em style={{ width: `${Math.max(3, item.value / maxFunnel * 100)}%` }} /></i>
                <b>{formatNumber(item.value)}</b>
              </div>
            )) : <p className="muted">暂无漏斗数据</p>}
          </div>
        </section>
        <section className="panel">
          <h2>关键转化率</h2>
          <div className="channel-kpis">
            {rateRows.length ? rateRows.map((item) => <Metric key={item.label} label={item.label} value={`${item.value.toFixed(2)}%`} />) : <p className="muted">暂无转化率数据</p>}
          </div>
        </section>
      </div>

      {(data.highlights?.length || data.warnings?.length) && (
        <section className="panel channel-notes">
          {data.highlights?.length ? <div><h2>识别重点</h2><ul>{data.highlights.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          {data.warnings?.length ? <div><h2>需要复核</h2><ul>{data.warnings.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
        </section>
      )}

      <section className="panel table channel-table">
        <h2>流量来源</h2>
        <table>
          <thead><tr>{['类型', '进房人次', '占比', '成交金额', '成交占比', '千次观看成交金额'].map((head) => <th key={head}>{head}</th>)}</tr></thead>
          <tbody>
            {trafficSources.length ? trafficSources.flatMap((source) => [
              <tr key={source.type} className="group-row"><td>{source.type}</td><td>{formatMaybeNumber(source.entrances)}</td><td>{formatMaybeRate(source.entranceShare)}</td><td>{formatMaybeMoney(source.gmv)}</td><td>{formatMaybeRate(source.gmvShare)}</td><td>{formatMaybeMoney(source.gmvPerThousandViews)}</td></tr>,
              ...((source.children || []).map((child) => <tr key={`${source.type}-${child.name}`}><td className="child-cell">{child.name}</td><td>{formatMaybeNumber(child.entrances)}</td><td>{formatMaybeRate(child.entranceShare)}</td><td>{formatMaybeMoney(child.gmv)}</td><td>{formatMaybeRate(child.gmvShare)}</td><td>{formatMaybeMoney(child.gmvPerThousandViews)}</td></tr>)),
            ]) : <tr><td colSpan={6}>暂无流量来源数据</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="panel table channel-table">
        <h2>预约渠道</h2>
        <table>
          <thead><tr>{['渠道', '预约人数', '预约占比', '预约观看人数', '观看占比', '预约转观看率', '成交金额'].map((head) => <th key={head}>{head}</th>)}</tr></thead>
          <tbody>
            {reservationChannels.length ? reservationChannels.map((row) => <tr key={row.channel}><td>{row.channel}</td><td>{formatMaybeNumber(row.reservedUsers)}</td><td>{formatMaybeRate(row.reservedShare)}</td><td>{formatMaybeNumber(row.watchedUsers)}</td><td>{formatMaybeRate(row.watchedShare)}</td><td>{formatMaybeRate(row.watchRate)}</td><td>{formatMaybeMoney(row.gmv)}</td></tr>) : <tr><td colSpan={7}>暂无预约渠道数据</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function formatMaybeNumber(value: unknown) {
  const number = finiteNumber(value)
  return number === null ? '-' : formatNumber(number)
}

function formatMaybeRate(value: unknown) {
  const number = finiteNumber(value)
  return number === null ? '-' : `${number.toFixed(2)}%`
}

function formatMaybeMoney(value: unknown) {
  const number = finiteNumber(value)
  return number === null ? '-' : formatMoney(number)
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function hasPositiveChannelData(data: ChannelProfile['data']) {
  const values: unknown[] = [
    ...(data.trafficFunnel ? Object.values(data.trafficFunnel) : []),
    ...(data.trafficSources || []).flatMap((source) => [
      source.entrances,
      source.entranceShare,
      source.gmv,
      source.gmvShare,
      source.gmvPerThousandViews,
      ...(source.children || []).flatMap((child) => [child.entrances, child.entranceShare, child.gmv, child.gmvShare, child.gmvPerThousandViews]),
    ]),
    ...(data.reservationChannels || []).flatMap((row) => [row.reservedUsers, row.reservedShare, row.watchedUsers, row.watchedShare, row.watchRate, row.gmv]),
  ]
  return values.some((value) => {
    const number = finiteNumber(value)
    return number !== null && number > 0
  })
}

function DataTable({ metrics, isAdmin, busy, legacyText, onLegacyText, onImportLegacy }: { metrics: LiveMetrics[]; isAdmin: boolean; busy: boolean; legacyText: string; onLegacyText: (value: string) => void; onImportLegacy: (source: 'storage' | 'text') => void }) {
  return (
    <div className="stack">
      {isAdmin && (
        <section className="panel migrate">
          <div className="panel-head">
            <div>
              <h2>旧版数据迁移</h2>
              <p className="muted">迁移旧本地版保存过的 AI 分析和用户画像，不会改动直播基础数据。</p>
            </div>
            <button className="button" disabled={busy} onClick={() => onImportLegacy('storage')}>{busy ? '迁移中' : '读取当前浏览器缓存'}</button>
          </div>
          <textarea value={legacyText} onChange={(event) => onLegacyText(event.target.value)} placeholder="也可以粘贴旧版导出工具生成的 JSON，再点击右侧导入。" />
          <div className="migrate-actions">
            <span>旧版缓存不在当前域名时，用导出工具复制 JSON 后粘贴到这里。</span>
            <button className="button primary" disabled={busy || !legacyText.trim()} onClick={() => onImportLegacy('text')}>导入粘贴内容</button>
          </div>
        </section>
      )}
      <section className="panel table">
        <table><thead><tr>{['直播主题', '观看人数', '平均观看', '关注率', '成交金额', '成交率'].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{metrics.map((row) => <tr key={row.id}><td>{row.topic}</td><td>{formatNumber(row.viewers)}</td><td>{formatSeconds(row.avgWatchSec)}</td><td>{formatPercent(row.followRate)}</td><td>{formatMoney(row.gmv)}</td><td>{formatPercent(row.buyerRate, 2)}</td></tr>)}</tbody></table>
      </section>
    </div>
  )
}

function AiPanel({ title, review, isAdmin, busy, disabled, disabledTitle, generateLabel, onAi }: { title: string; review?: AiReview; isAdmin: boolean; busy: boolean; disabled: boolean; disabledTitle?: string; generateLabel: string; onAi: () => void }) {
  const buttonTitle = disabled || busy ? disabledTitle || `当前正在运行：${title}` : undefined
  return <section className="panel"><div className="panel-head"><h2>{title}</h2>{isAdmin && <button className="button primary" disabled={busy || disabled} title={buttonTitle} onClick={onAi}>{busy ? <RefreshCw size={16} /> : <Bot size={16} />}{busy ? '分析中' : generateLabel}</button>}</div>{review ? <div className="ai"><h3>{review.review.verdictTitle}</h3><p>{review.review.verdictText}</p>{review.review.insights?.map((item, index) => <Insight key={index} tag={item.tag || '复盘点'} title={item.title || ''} body={item.body || ''} />)}{review.review.recommendations?.map((item, index) => <div className="rec" key={index}><div><b>{item.title}</b><span>{item.body}</span></div></div>)}</div> : <div className="empty">还没有生成 AI 分析。</div>}</section>
}

function GlobalBatchProgress({ progress }: { progress: BatchProgress }) {
  if (!progress.running && progress.total === 0) return null
  const percent = progress.total ? Math.round(progress.done / progress.total * 100) : 0
  return (
    <aside className="global-progress" aria-live="polite">
      <div className="progress-meta">
        <div>
          <b>批量 AI 分析</b>
          <span>{progress.running ? `当前：${progress.current}` : progress.failed ? `已完成，失败 ${progress.failed} 场` : '已完成'}</span>
        </div>
        <strong>{progress.done}/{progress.total}</strong>
      </div>
      <i><em style={{ width: `${percent}%` }} /></i>
      {progress.failures.length > 0 && (
        <div className="progress-errors">
          {progress.failures.slice(0, 3).map((item) => <span key={`${item.topic}-${item.message}`} title={item.message}>{item.topic}：{item.message}</span>)}
          {progress.failures.length > 3 && <span>还有 {progress.failures.length - 3} 场失败</span>}
        </div>
      )}
    </aside>
  )
}

function aiFlowName(value: string) {
  return ({
    overview: '总览 AI 分析',
    single: '单场 AI 分析',
    batch: '批量单场 AI 分析',
    profile: '用户画像识别',
    channel: '渠道截图识别',
  } as Record<string, string>)[value] || ''
}

function Insight({ tag, title, body, tone = 'info' }: { tag: string; title: string; body: string; tone?: 'good' | 'risk' | 'info' }) {
  return <article className="insight" data-tone={tone}><small>{tag}</small><h3>{title}</h3><p>{body}</p></article>
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="fact"><span>{label}</span><b>{value}</b></div>
}

export default App

function periodLabel(rows: LiveMetrics[]) {
  const dates = rows.map((row) => {
    const matched = row.startedAt.match(/(\d{4})年(\d{2})月(\d{2})日/)
    return matched ? `${matched[2]}/${matched[3]}` : ''
  }).filter(Boolean)
  return dates.length ? `${dates[dates.length - 1]} 至 ${dates[0]}` : '当前数据'
}

function ruleGrade(rows: LiveMetrics[]) {
  if (!rows.length) return 'C'
  const avgWatch = average(rows, 'avgWatchSec')
  const totalGmv = rows.reduce((sum, row) => sum + row.gmv, 0)
  const avgFollow = average(rows, 'followRate')
  if (avgWatch >= 120 && (totalGmv > 0 || avgFollow >= 0.025)) return 'A'
  if (avgWatch >= 60 || totalGmv > 0 || avgFollow >= 0.015) return 'B'
  return 'C'
}

function ruleVerdict(rows: LiveMetrics[]) {
  const bestTraffic = maxRow(rows, 'viewers')
  const bestRetention = maxRow(rows, 'avgWatchSec')
  const bestCommerce = maxRow(rows, 'gmv')
  if (!rows.length) return { title: '等待数据导入', body: '上传直播数据后，会先用规则模型生成整体判断。' }
  if (bestCommerce && bestCommerce.gmv > 0) {
    return {
      title: '流量和转化存在明显分层',
      body: `当前直播表现不是单纯流量问题，关键在于把 ${bestTraffic?.topic || '高流量场次'} 的选题吸引力、${bestRetention?.topic || '高留存场次'} 的停留结构和 ${bestCommerce.topic} 的成交动作串起来。`,
    }
  }
  return {
    title: '内容有触达，但成交链路偏弱',
    body: `当前最高观看来自 ${bestTraffic?.topic || '部分场次'}，最高停留来自 ${bestRetention?.topic || '部分场次'}，下一步要补强关注沉淀和商品承接。`,
  }
}
