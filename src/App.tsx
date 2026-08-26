import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BarChart3, Bot, Eye, FileUp, ImageUp, LogOut, RefreshCw, ShieldCheck } from 'lucide-react'
import { supabase } from './lib/supabase'
import { compactPayload, getRole, importLegacyData, invokeAi, loadAppData, saveProfile, saveReview, upsertLives } from './lib/api'
import { average, datasetSignature, formatMoney, formatNumber, formatPercent, formatSeconds, maxRow, parseCsv, withMetrics } from './lib/data'
import { seedLives } from './lib/seed'
import type { AiReview, AppData, AudienceProfile, LiveMetrics, LiveRow, UserRole } from './types'
import './App.css'

const accountEmail: Record<string, string> = {
  admin: 'admin@shangyintang.local',
  guest: 'guest@shangyintang.local',
}

type Tab = 'overview' | 'compare' | 'detail' | 'profile' | 'data'
type Notice = { text: string; kind: 'error' | 'success' }

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
  return <Dashboard session={session} />
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

function Dashboard({ session }: { session: Session }) {
  const [role, setRole] = useState<UserRole>('guest')
  const [tab, setTab] = useState<Tab>('overview')
  const [data, setData] = useState<AppData>({ lives: seedLives, profiles: [], reviews: [] })
  const [selectedId, setSelectedId] = useState(seedLives[0]?.id || '')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState('')
  const [profileFiles, setProfileFiles] = useState<{ name: string; dataUrl: string }[]>([])
  const [legacyText, setLegacyText] = useState('')
  const isAdmin = role === 'admin'

  const metrics = useMemo(() => data.lives.map(withMetrics), [data.lives])
  const selected = data.lives.find((live) => live.id === selectedId) || data.lives[0] || null
  const selectedMetrics = selected ? withMetrics(selected) : null
  const profileByLive = useMemo(() => new Map(data.profiles.map((profile) => [profile.liveId, profile])), [data.profiles])
  const currentProfile = selected ? profileByLive.get(selected.id) || null : null
  const overviewReview = data.reviews.find((review) => review.scope === 'overview' && review.datasetSignature === datasetSignature(data.lives))
  const detailReview = selected ? data.reviews.find((review) => review.scope === 'single' && review.liveId === selected.id) : null

  async function refresh() {
    const [nextRole, nextData] = await Promise.all([getRole(), loadAppData()])
    setRole(nextRole)
    setData(nextData.lives.length ? nextData : { ...nextData, lives: seedLives })
    setSelectedId((current) => nextData.lives.some((live) => live.id === current) ? current : nextData.lives[0]?.id || seedLives[0]?.id || '')
  }

  useEffect(() => {
    refresh().catch((error) => showNotice(error.message, 'error'))
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

  async function readProfileFiles(files: FileList | null) {
    const list = Array.from(files || [])
    const next = await Promise.all(list.map((file) => new Promise<{ name: string; dataUrl: string }>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve({ name: file.name, dataUrl: String(reader.result || '') })
      reader.onerror = reject
      reader.readAsDataURL(file)
    })))
    setProfileFiles(next)
  }

  async function extractProfile() {
    if (!isAdmin || !selected || !profileFiles.length) return
    setBusy('profile')
    try {
      const result = await invokeAi('profile', {
        live: selected,
        images: profileFiles,
      })
      if (!result.profile) throw new Error('画像识别返回为空。')
      await saveProfile(selected.id, profileFiles.length, result.profile)
      setProfileFiles([])
      await refresh()
      showNotice(`已关联画像：${selected.topic}`)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '画像识别失败', 'error')
    } finally {
      setBusy('')
    }
  }

  async function generateReview(scope: 'overview' | 'single') {
    if (!isAdmin) return
    const live = scope === 'single' ? selected : null
    if (scope === 'single' && !live) return
    setBusy(scope)
    try {
      const result = await invokeAi('review', {
        payload: compactPayload(data.lives, data.profiles, scope, live),
      })
      if (!result.review) throw new Error('AI 分析返回为空。')
      await saveReview(scope, live?.id || null, data.lives, result.review)
      await refresh()
      showNotice(scope === 'overview' ? '总览 AI 分析已生成。' : `${live?.topic} 的 AI 分析已生成。`)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'AI 分析失败', 'error')
    } finally {
      setBusy('')
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
          {(['overview', 'compare', 'detail', 'profile', 'data'] as Tab[]).map((item) => (
            <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{tabName(item)}</button>
          ))}
        </nav>
        <section className="workspace">
          <aside className="side">
            <h2>直播场次</h2>
            {metrics.map((live) => (
              <button key={live.id} className={selected?.id === live.id ? 'live active' : 'live'} onClick={() => setSelectedId(live.id)}>
                <b>{live.topic}</b><span>{formatNumber(live.viewers)} 人观看 · {formatSeconds(live.avgWatchSec)} · {formatMoney(live.gmv)}</span>
              </button>
            ))}
          </aside>
          <div className="content">
            {tab === 'overview' && <Overview metrics={metrics} review={overviewReview} isAdmin={isAdmin} busy={busy === 'overview'} onAi={() => void generateReview('overview')} />}
            {tab === 'compare' && <Compare metrics={metrics} />}
            {tab === 'detail' && selectedMetrics && <Detail live={selectedMetrics} review={detailReview || undefined} isAdmin={isAdmin} busy={busy === 'single'} onAi={() => void generateReview('single')} />}
            {tab === 'profile' && selected && <Profile live={selected} profile={currentProfile || null} files={profileFiles} isAdmin={isAdmin} busy={busy === 'profile'} onFiles={readProfileFiles} onExtract={() => void extractProfile()} />}
            {tab === 'data' && <DataTable metrics={metrics} isAdmin={isAdmin} busy={busy === 'legacy'} legacyText={legacyText} onLegacyText={setLegacyText} onImportLegacy={importLegacySource} />}
          </div>
        </section>
      </main>
    </div>
  )
}

function tabName(tab: Tab) {
  return ({ overview: '复盘总览', compare: '场次对比', detail: '单场拆解', profile: '用户画像', data: '原始数据' } satisfies Record<Tab, string>)[tab]
}

function Summary({ metrics }: { metrics: LiveMetrics[] }) {
  const totalViewers = metrics.reduce((sum, live) => sum + live.viewers, 0)
  const totalFollows = metrics.reduce((sum, live) => sum + live.follows, 0)
  const totalGmv = metrics.reduce((sum, live) => sum + live.gmv, 0)
  return (
    <section className="summary">
      <Metric label="累计观看人数" value={formatNumber(totalViewers)} />
      <Metric label="平均观看时长" value={formatSeconds(average(metrics, 'avgWatchSec'))} />
      <Metric label="新增关注" value={formatNumber(totalFollows)} note={`关注率 ${formatPercent(totalViewers ? totalFollows / totalViewers : 0)}`} />
      <Metric label="成交金额" value={formatMoney(totalGmv)} />
    </section>
  )
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="metric"><b>{value}</b><span>{label}</span>{note && <small>{note}</small>}</div>
}

function Overview({ metrics, review, isAdmin, busy, onAi }: { metrics: LiveMetrics[]; review?: AiReview; isAdmin: boolean; busy: boolean; onAi: () => void }) {
  const bestTraffic = maxRow(metrics, 'viewers')
  const bestRetention = maxRow(metrics, 'avgWatchSec')
  const bestCommerce = maxRow(metrics, 'gmv')
  return (
    <div className="stack">
      <div className="insights">
        <Insight tag="起量样本" title={bestTraffic?.topic || '暂无'} body={bestTraffic ? `观看人数 ${formatNumber(bestTraffic.viewers)}，适合拆解标题、嘉宾、预约和开播时间。` : ''} />
        <Insight tag="内容粘性" title={bestRetention?.topic || '暂无'} body={bestRetention ? `平均观看 ${formatSeconds(bestRetention.avgWatchSec)}，说明这个主题更能让观众停下来听。` : ''} />
        <Insight tag="成交结果" title={bestCommerce?.topic || '暂无'} body={bestCommerce ? `成交金额 ${formatMoney(bestCommerce.gmv)}，订单 ${formatNumber(bestCommerce.orders)}。` : ''} />
      </div>
      <AiPanel title="AI 总览复盘" review={review} isAdmin={isAdmin} busy={busy} generateLabel={review ? '重新生成总览 AI 分析' : '生成总览 AI 分析'} onAi={onAi} />
    </div>
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

function Detail({ live, review, isAdmin, busy, onAi }: { live: LiveMetrics; review?: AiReview; isAdmin: boolean; busy: boolean; onAi: () => void }) {
  return (
    <div className="stack">
      <section className="panel">
        <h2>{live.topic}</h2>
        <div className="facts">
          <Fact label="开始时间" value={live.startedAt} />
          <Fact label="观看人数" value={formatNumber(live.viewers)} />
          <Fact label="平均观看" value={formatSeconds(live.avgWatchSec)} />
          <Fact label="新增关注" value={`${formatNumber(live.follows)}，${formatPercent(live.followRate)}`} />
          <Fact label="成交" value={`${formatMoney(live.gmv)}，${formatNumber(live.orders)} 单`} />
        </div>
      </section>
      <AiPanel title="AI 单场分析" review={review} isAdmin={isAdmin} busy={busy} generateLabel={review ? '重新生成单场 AI 分析' : '生成单场 AI 分析'} onAi={onAi} />
    </div>
  )
}

function Profile({ live, profile, files, isAdmin, busy, onFiles, onExtract }: { live: LiveRow; profile: AudienceProfile | null; files: { name: string; dataUrl: string }[]; isAdmin: boolean; busy: boolean; onFiles: (files: FileList | null) => Promise<void>; onExtract: () => void }) {
  const data = profile?.data || {}
  return (
    <div className="stack">
      <section className="panel">
        <h2>用户画像：{live.topic}</h2>
        {isAdmin && (
          <div className="upload-row">
            <label className="button"><ImageUp size={16} />上传画像截图<input hidden type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(event) => void onFiles(event.target.files)} /></label>
            <button className="button primary" disabled={!files.length || busy} onClick={onExtract}>{busy ? '识别中' : '识别并关联'}</button>
          </div>
        )}
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

function AiPanel({ title, review, isAdmin, busy, generateLabel, onAi }: { title: string; review?: AiReview; isAdmin: boolean; busy: boolean; generateLabel: string; onAi: () => void }) {
  return <section className="panel"><div className="panel-head"><h2>{title}</h2>{isAdmin && <button className="button primary" disabled={busy} onClick={onAi}>{busy ? <RefreshCw size={16} /> : <Bot size={16} />}{busy ? '分析中' : generateLabel}</button>}</div>{review ? <div className="ai"><h3>{review.review.verdictTitle}</h3><p>{review.review.verdictText}</p>{review.review.insights?.map((item, index) => <Insight key={index} tag={item.tag || '复盘点'} title={item.title || ''} body={item.body || ''} />)}{review.review.recommendations?.map((item, index) => <div className="rec" key={index}><b>{item.title}</b><span>{item.body}</span></div>)}</div> : <div className="empty">还没有生成 AI 分析。</div>}</section>
}

function Insight({ tag, title, body }: { tag: string; title: string; body: string }) {
  return <article className="insight"><small>{tag}</small><b>{title}</b><p>{body}</p></article>
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="fact"><span>{label}</span><b>{value}</b></div>
}

export default App
