<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useRouter } from 'vue-router'
import { useMetricsStore } from '../stores/metrics'
import { fetchClients, fetchUserProperties } from '../services/metricsApi'
import Card from 'primevue/card'
import DatePicker from 'primevue/datepicker'
import Skeleton from 'primevue/skeleton'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Checkbox from 'primevue/checkbox'
import AiGrader from '../components/AiGrader.vue'
import html2pdf from 'html2pdf.js'

const auth = useAuthStore()
const router = useRouter()
const metrics = useMetricsStore()

const defaultAhrefsTarget = import.meta.env.VITE_AHREFS_TARGET || 'olivebranchmedical.net'

const ga4PropertyId = ref('')
const gscSiteUrl = ref('')
const ahrefsTarget = ref(defaultAhrefsTarget)

const ga4Options = ref([])
const gscOptions = ref([])
const clientOptions = ref([])
const selectedClient = ref(null)
const propertiesLoading = ref(true)

const ga4PropertiesRaw = ref([])
const gscSitesRaw = ref([])

// --- Metric Filter Registry ---
const metricRegistry = {
  ga4: [
    // Traffic
    { code: 'TRAF01', label: 'Organic Sessions', key: 'totalTraffic' },
    { code: 'TRAF02', label: 'Top Landing Pages (Organic)', key: 'trafficDrivers' },
    { code: 'TRAF03', label: 'New vs Returning Visitors (Organic)', key: 'trafficBySource' },
    { code: 'TRAF04', label: 'Traffic by Region', key: 'trafficFromUS' },
    // Engagement
    { code: 'ENGA01', label: 'Avg. Session Duration', key: 'trafficDrivers' },
    { code: 'ENGA02', label: 'Bounce Rate', key: 'trafficDrivers' },
    { code: 'ENGA03', label: 'Pages per Session', key: 'trafficDrivers' },
  ],
  gsc: [
    // Visibility
    { code: 'VISI01', label: 'Indexed Pages', key: 'impressions' },
    { code: 'VISI02', label: 'Organic Impressions', key: 'impressions' },
    // Technical
    { code: 'TECH02', label: 'Crawl Errors', key: 'siteAuditIssues' },
    { code: 'TECH03', label: 'Mobile Usability', key: 'siteAuditIssues' },
    { code: 'TECH05', label: 'Structured Data Compliance', key: 'siteAuditIssues' },
    { code: 'TECH06', label: 'Index Management', key: 'impressions' },
  ],
  ahrefs: [
    // Authority
    { code: 'AUTH01', label: 'Domain Authority', key: 'domainRating' },
    { code: 'AUTH02', label: 'Referring Domains', key: 'backlinks' },
    { code: 'AUTH03', label: 'Backlink Quality', key: 'backlinks' },
    // Content
    { code: 'CONT02', label: 'Keyword Cannibalization', key: 'siteAuditIssues' },
    // Visibility
    { code: 'VISI03', label: 'Keyword Rankings', key: 'keywordRankings' },
    { code: 'VISI04', label: 'Search Visibility Score', key: 'domainRating' },
  ],
}

// --- Category Map: metric code → report category ---
const CATEGORY_MAP = {
  'Traffic Overview':          ['TRAF01', 'TRAF02', 'TRAF03', 'TRAF04', 'ENGA01', 'ENGA02', 'ENGA03'],
  'Visibility Metrics':       ['VISI01', 'VISI02', 'VISI03', 'VISI04'],
  'Technical Health Metrics': ['TECH02', 'TECH03', 'TECH05', 'TECH06'],
  'Authority & Off-Page':     ['AUTH01', 'AUTH02', 'AUTH03'],
  'Content':                  ['CONT02'],
}

const activeSources = reactive({ ga4: true, gsc: true, ahrefs: true })

const selectedMetrics = reactive({
  ga4: [],
  gsc: [],
  ahrefs: [],
})

const totalSelectedMetricCount = computed(() =>
  selectedMetrics.ga4.length + selectedMetrics.gsc.length + selectedMetrics.ahrefs.length
)

// Groups fetched metrics by category for PDF export and dashboard rendering
const fetchedMetricsByCategory = computed(() => {
  const result = {}
  for (const [cat, codes] of Object.entries(CATEGORY_MAP)) {
    const fetched = codes.filter(c => fetchedMetrics.value.has(c))
    if (fetched.length) result[cat] = fetched
  }
  return result
})

// Groups selected (not yet fetched) metrics by category for UI display
const selectedMetricsByCategory = computed(() => {
  const allSelected = [...selectedMetrics.ga4, ...selectedMetrics.gsc, ...selectedMetrics.ahrefs]
  const result = {}
  for (const [cat, codes] of Object.entries(CATEGORY_MAP)) {
    const sel = codes.filter(c => allSelected.includes(c))
    if (sel.length) result[cat] = sel
  }
  return result
})

const fetchedMetrics = ref(new Set())

function toggleSource(source) {
  activeSources[source] = !activeSources[source]
  if (!activeSources[source]) {
    selectedMetrics[source] = []
  }
}

// Map metric codes → store load functions (deduplicated at call time)
// GA4 metrics
// GSC metrics
// Ahrefs metrics
const metricActionMap = {
  // ── GA4 ──────────────────────────────────────────────────────────────
  TRAF01: ['loadTotalTraffic', 'loadTrafficBySource', 'loadTrafficBySourceOverTime', 'loadTrafficDrivers'], // Organic Sessions (traffic overtime + by source + drivers overview)
  TRAF02: ['loadTrafficDrivers'],                                        // Top Landing Pages
  TRAF03: ['loadNewVsReturning'],                                        // New vs Returning Visitors
  TRAF04: ['loadTrafficFromUS', 'loadTrafficUSBySource', 'loadTrafficUSBySourceOverTime'], // Traffic by Region
  ENGA01: ['loadTrafficDrivers'],                                        // Avg Session Duration
  ENGA02: ['loadTrafficDrivers'],                                        // Bounce Rate (from traffic drivers)
  ENGA03: ['loadTrafficDrivers'],                                        // Pages per Session
  // ── GSC ──────────────────────────────────────────────────────────────
  VISI01: ['loadImpressions'],                                           // Indexed Pages (via GSC coverage)
  VISI02: ['loadImpressions'],                                           // Organic Impressions
  TECH02: ['loadSiteAuditIssues', 'loadGscCoverage'],                     // Crawl Errors (GSC)
  TECH03: ['loadSiteAuditIssues', 'loadGscMobile'],                      // Mobile Usability (GSC)
  TECH05: ['loadSiteAuditIssues', 'loadGscStructuredData'],              // Structured Data Compliance
  TECH06: ['loadImpressions'],                                           // Index Management
  // ── Ahrefs ───────────────────────────────────────────────────────────
  AUTH01: ['loadDomainRating'],                                          // Domain Authority (DR)
  AUTH02: ['loadBacklinks'],                                             // Referring Domains
  AUTH03: ['loadBacklinks'],                                             // Backlink Quality
  CONT02: ['loadSiteAuditIssues'],                                       // Keyword Cannibalization
  VISI03: ['loadKeywordRankings'],                                       // Keyword Rankings
  VISI04: ['loadDomainRating'],                                          // Search Visibility Score
}

function toggleMetric(source, code) {
  const idx = selectedMetrics[source].indexOf(code)
  if (idx >= 0) selectedMetrics[source].splice(idx, 1)
  else selectedMetrics[source].push(code)
}

function selectAllMetrics(source) {
  selectedMetrics[source] = metricRegistry[source].map(m => m.code)
}

function clearMetrics(source) {
  selectedMetrics[source] = []
}

// Normalize a string to lowercase alphanumeric for fuzzy matching
function normalizeKey(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Extract the primary keyword from a GSC URL (strips protocol, www, sc-domain:, TLD)
function gscDomainKey(url) {
  const clean = url.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
  return normalizeKey(clean.split('.')[0])
}

function onGA4Change(propertyId) {
  if (!propertyId) {
    gscSiteUrl.value = ''
    selectedClient.value = ''
    ahrefsTarget.value = ''
    return
  }
  const prop = ga4PropertiesRaw.value.find(p => p.id === propertyId)
  if (!prop) return
  const propKey = normalizeKey(prop.name)

  // Auto-select GSC: find site whose domain keyword appears in the GA4 property name
  const gscMatch = gscSitesRaw.value.find(s => {
    const key = gscDomainKey(s.url)
    return key && (propKey.includes(key) || key.includes(propKey.slice(0, Math.min(propKey.length, 10))))
  })
  gscSiteUrl.value = gscMatch ? gscMatch.url : ''

  // Auto-select Ahrefs client
  const clients = clientOptions.value.filter(c => c.value)
  const clientMatch = clients.find(c => {
    const domKey = normalizeKey(domainFromUrl(c.value).split('.')[0])
    const labelKey = normalizeKey(c.label)
    return (domKey && (propKey.includes(domKey) || domKey.includes(propKey.slice(0, Math.min(propKey.length, 10))))) ||
           (labelKey && (propKey.includes(labelKey) || labelKey.includes(propKey.slice(0, Math.min(propKey.length, 10)))))
  })
  if (clientMatch) {
    selectedClient.value = clientMatch.value
    ahrefsTarget.value = domainFromUrl(clientMatch.value)
  } else {
    selectedClient.value = ''
    ahrefsTarget.value = ''
  }
}

async function loadUserProperties() {
  propertiesLoading.value = true
  try {
    const { ga4Properties, gscSites } = await fetchUserProperties()
    ga4PropertiesRaw.value = ga4Properties
    gscSitesRaw.value = gscSites
    ga4Options.value = [
      { label: '\u00A0', value: '' },
      ...ga4Properties.map((p) => ({ label: `${p.name} (${p.id})`, value: p.id })),
    ]
    gscOptions.value = [
      { label: '\u00A0', value: '' },
      ...gscSites.map((s) => ({
        label: s.url.startsWith('sc-domain:') ? s.url.replace('sc-domain:', '') + ' (domain)' : s.url,
        value: s.url,
      })),
    ]
    if (ga4Options.value.length > 1) ga4PropertyId.value = ga4Options.value[1].value
    if (gscOptions.value.length > 1) {
      await nextTick()
      gscSiteUrl.value = gscOptions.value[1].value
    }
  } catch (err) {
    console.error('Failed to load user properties:', err)
    // If token is invalid/expired, sign out and redirect to login
    if (err.message && (err.message.includes('Invalid or expired token') || err.message.includes('401') || err.message.includes('AUTH_ERROR'))) {
      auth.logout()
      router.push('/login')
    }
  } finally {
    propertiesLoading.value = false
  }
}

function domainFromUrl(url) {
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '').replace(/^www\./, '')
}

async function loadClients() {
  try {
    const data = await fetchClients()
    clientOptions.value = [{ label: '\u00A0', value: '' }, ...data]
    const match = data.find((c) => domainFromUrl(c.value).includes(defaultAhrefsTarget) || defaultAhrefsTarget.includes(domainFromUrl(c.value)))
    if (match) {
      selectedClient.value = match.value
      ahrefsTarget.value = domainFromUrl(match.value)
      if (!gscOptions.value.length) gscSiteUrl.value = `https://www.${domainFromUrl(match.value)}/`
    } else if (data.length) {
      selectedClient.value = data[0].value
      ahrefsTarget.value = domainFromUrl(data[0].value)
      if (!gscOptions.value.length) gscSiteUrl.value = `https://www.${domainFromUrl(data[0].value)}/`
    }
  } catch (err) {
    console.error('Failed to load clients:', err)
  }
}

function onClientChange(val) {
  if (!val) {
    ahrefsTarget.value = ''
    return
  }
  ahrefsTarget.value = domainFromUrl(val)
}

const now = new Date()
const allTimeStart = new Date('2021-01-01')
const dateRange = ref([allTimeStart, now])

const refreshing = ref(false)

function formatDate(d) {
  const dt = d ? new Date(d) : new Date()
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const fetchError = ref('')

async function loadMetrics() {
  const [start, end] = dateRange.value
  fetchError.value = ''
  refreshing.value = true
  try {
    // Collect unique store actions from selected metrics
    const actionSet = new Set()
    const propId = ga4PropertyId.value || null
    const site = gscSiteUrl.value || null
    const aTarget = ahrefsTarget.value || null

    if (propId) {
      for (const code of selectedMetrics.ga4) {
        (metricActionMap[code] || []).forEach(a => actionSet.add(a))
      }
    }
    if (site) {
      for (const code of selectedMetrics.gsc) {
        (metricActionMap[code] || []).forEach(a => actionSet.add(a))
      }
    }
    if (aTarget) {
      for (const code of selectedMetrics.ahrefs) {
        (metricActionMap[code] || []).forEach(a => actionSet.add(a))
      }
    }

    // Build promises from unique actions
    const promises = []
    const sd = formatDate(start)
    const ed = formatDate(end)
    for (const action of actionSet) {
      switch (action) {
        // GA4
        case 'loadTotalTraffic': promises.push(metrics.loadTotalTraffic(propId, sd, ed)); break
        case 'loadTrafficBySource': promises.push(metrics.loadTrafficBySource(propId, sd, ed)); break
        case 'loadNewVsReturning': promises.push(metrics.loadNewVsReturning(propId, sd, ed)); break
        case 'loadTrafficBySourceOverTime': promises.push(metrics.loadTrafficBySourceOverTime(propId, sd, ed)); break
        case 'loadTrafficFromUS': promises.push(metrics.loadTrafficFromUS(propId, sd, ed)); break
        case 'loadTrafficDrivers': promises.push(metrics.loadTrafficDrivers(propId, sd, ed)); break
        case 'loadTrafficUSBySource': promises.push(metrics.loadTrafficUSBySource(propId, sd, ed)); break
        case 'loadTrafficUSBySourceOverTime': promises.push(metrics.loadTrafficUSBySourceOverTime(propId, sd, ed)); break
        // GSC
        case 'loadImpressions': promises.push(metrics.loadImpressions(site, sd, ed)); break
        case 'loadKeywordRankings': promises.push(metrics.loadKeywordRankings(site, sd, ed)); break
        case 'loadGscCoverage': promises.push(metrics.loadGscCoverage(site)); break
        case 'loadGscMobile': promises.push(metrics.loadGscMobile(site, sd, ed)); break
        case 'loadGscStructuredData': promises.push(metrics.loadGscStructuredData(site, sd, ed)); break
        // Ahrefs
        case 'loadDomainRating': promises.push(metrics.loadDomainRating(aTarget, ed)); break
        case 'loadSiteHealth': promises.push(metrics.loadSiteHealth(aTarget)); break
        case 'loadSiteAuditIssues': promises.push(metrics.loadSiteAuditIssues(aTarget)); break
        case 'loadBacklinks': promises.push(metrics.loadBacklinks(aTarget)); break
      }
    }
    await Promise.allSettled(promises)
    // Track which metrics have been fetched
    const allSelected = [...selectedMetrics.ga4, ...selectedMetrics.gsc, ...selectedMetrics.ahrefs]
    allSelected.forEach(c => fetchedMetrics.value.add(c))
    fetchedMetrics.value = new Set(fetchedMetrics.value) // trigger reactivity
    // Auto-run grader after metrics load
    graderAutoRun.value = false
    await nextTick()
    graderAutoRun.value = true
  } finally {
    refreshing.value = false
  }
}


// Check if any of the given metric codes were explicitly selected AND fetched by user
function hasMetric(...codes) {
  const allSelected = [...selectedMetrics.ga4, ...selectedMetrics.gsc, ...selectedMetrics.ahrefs]
  return codes.some(c => allSelected.includes(c) && fetchedMetrics.value.has(c))
}

// Check if a card should be visible based on selected metrics
const cardVisible = computed(() => ({
  // ── Traffic Overview ──────────────────────────────────────────────────
  totalTraffic:         hasMetric('TRAF01'),
  trafficBySource:      hasMetric('TRAF01'),
  newVsReturning:       hasMetric('TRAF03'),
  trafficFromUS:        hasMetric('TRAF04'),
  trafficUSBySource:    hasMetric('TRAF04'),
  trafficDrivers:       hasMetric('TRAF01', 'TRAF02', 'ENGA01', 'ENGA02', 'ENGA03'),
  avgSessionDuration:   hasMetric('ENGA01'),
  bounceRate:           hasMetric('ENGA02'),
  pagesPerSession:      hasMetric('ENGA03'),
  // ── Visibility Metrics ───────────────────────────────────────────────
  indexedPages:         hasMetric('VISI01'),
  impressions:          hasMetric('VISI02'),
  keywordRankings:      hasMetric('VISI03'),
  searchVisibility:     hasMetric('VISI04'),
  // ── Technical Health Metrics ─────────────────────────────────────────
  gscCoverage:          hasMetric('TECH02'),
  gscMobile:            hasMetric('TECH03'),
  gscStructuredData:    hasMetric('TECH05'),
  indexManagement:      hasMetric('TECH06'),
  technicalHealth:      hasMetric('TECH02', 'TECH03', 'TECH05', 'CONT02'),
  // ── Authority & Off-Page ─────────────────────────────────────────────
  domainAuthority:      hasMetric('AUTH01'),
  referringDomains:     hasMetric('AUTH02'),
  backlinkQuality:      hasMetric('AUTH03'),
  // ── Content ──────────────────────────────────────────────────────────
  cannibalization:      hasMetric('CONT02'),
}))

onMounted(async () => {
  selectAllMetrics('ga4')
  selectAllMetrics('gsc')
  selectAllMetrics('ahrefs')
  await loadUserProperties()
  loadClients()
})

function formatNumber(n) {
  if (n == null) return '—'
  return n.toLocaleString()
}

// --- Traffic View Toggle ---
const reportPeriod = ref('weekly')
const reportPeriodOptions = [
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Quarterly', value: 'quarterly' },
]

function aggregateWeekly(daily) {
  const weeks = {}
  for (const d of daily) {
    const s = String(d.date)
    const dt = new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T12:00:00`)
    // ISO week: Monday-based
    const day = dt.getDay()
    const diff = (day === 0 ? -6 : 1) - day
    const monday = new Date(dt)
    monday.setDate(dt.getDate() + diff)
    const key = `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`
    if (!weeks[key]) weeks[key] = { date: `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`, sessions: 0 }
    weeks[key].sessions += d.sessions
  }
  return Object.values(weeks).sort((a, b) => a.date.localeCompare(b.date))
}

function aggregateMonthly(daily) {
  const months = {}
  for (const d of daily) {
    const s = String(d.date)
    const key = `${s.slice(0,4)}-${s.slice(4,6)}`
    if (!months[key]) months[key] = { date: key, sessions: 0 }
    months[key].sessions += d.sessions
  }
  return Object.values(months).sort((a, b) => a.date.localeCompare(b.date))
}

function aggregateQuarterly(daily) {
  const quarters = {}
  for (const d of daily) {
    const s = String(d.date)
    const q = Math.ceil(parseInt(s.slice(4,6)) / 3)
    const key = `${s.slice(0,4)}-Q${q}`
    if (!quarters[key]) quarters[key] = { date: key, sessions: 0 }
    quarters[key].sessions += d.sessions
  }
  return Object.values(quarters).sort((a, b) => a.date.localeCompare(b.date))
}

function aggregateByPeriod(daily, period) {
  if (period === 'monthly') return aggregateMonthly(daily)
  if (period === 'quarterly') return aggregateQuarterly(daily)
  if (period === 'weekly') return aggregateWeekly(daily)
  return daily
}

function makePeriodLabel(key, period) {
  if (period === 'daily') { const s = String(key); return `${s.slice(4,6)}/${s.slice(6,8)}/${s.slice(2,4)}` }
  if (period === 'weekly') { const p = key.split('-'); return `${p[1]}/${p[2]}/${p[0].slice(2)}` }
  if (period === 'monthly') {
    const [y, m] = key.split('-')
    return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' })
  }
  if (period === 'quarterly') { const [y, q] = key.split('-'); return `${q} '${y.slice(2)}` }
  return key
}

function aggregateSourcesOverTimeByPeriod(dates, series, period) {
  // Server now returns dates in YYYYMMDD format (daily granularity)
  const weekMondayKey = (dateStr) => {
    const dt = new Date(`${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}T12:00:00`)
    const day = dt.getDay()
    const diff = (day === 0 ? -6 : 1) - day
    const monday = new Date(dt)
    monday.setDate(dt.getDate() + diff)
    return `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`
  }
  const keyOf = (dateStr) => {
    if (period === 'daily') return dateStr
    if (period === 'weekly') return weekMondayKey(dateStr)
    if (period === 'monthly') return `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}`
    if (period === 'quarterly') return `${dateStr.slice(0,4)}-Q${Math.ceil(parseInt(dateStr.slice(4,6)) / 3)}`
    return dateStr
  }
  const firstDateForKey = {} // tracks first actual date per weekly bucket
  const orderedKeys = []
  const map = {}
  for (let i = 0; i < dates.length; i++) {
    const k = keyOf(dates[i])
    if (!map[k]) {
      map[k] = {}
      orderedKeys.push(k)
      if (period === 'weekly') firstDateForKey[k] = `${dates[i].slice(0,4)}-${dates[i].slice(4,6)}-${dates[i].slice(6,8)}`
    }
    for (const ch of Object.keys(series)) {
      map[k][ch] = (map[k][ch] || 0) + (series[ch][i] || 0)
    }
  }
  const sorted = orderedKeys.sort()
  // For weekly, use first actual date as display date instead of Monday key
  const displayDates = sorted.map(k => period === 'weekly' ? firstDateForKey[k] : k)
  const out = {}
  for (const ch of Object.keys(series)) out[ch] = sorted.map(k => map[k][ch] || 0)
  return { dates: displayDates, series: out }
}

function makeSourcePeriodLabel(key, period) {
  // key formats: YYYYMMDD (daily), YYYY-MM-DD (weekly), YYYY-MM (monthly), YYYY-Q# (quarterly)
  if (period === 'daily') return `${key.slice(4,6)}/${key.slice(6,8)}/${key.slice(2,4)}`
  if (period === 'weekly') { const p = key.split('-'); return `${p[1]}/${p[2]}/${p[0].slice(2)}` }
  if (period === 'monthly') {
    const [y, m] = key.split('-')
    return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' })
  }
  if (period === 'quarterly') { const [y, q] = key.split('-'); return `${q} '${y.slice(2)}` }
  return key
}

function aggregateImpressionsByPeriod(daily, period) {
  if (period === 'daily') return daily.map(d => ({ date: d.date, impressions: d.impressions || 0, clicks: d.clicks || 0 }))
  if (period === 'weekly') return aggregateImpressionsWeekly(daily)
  const groups = {}
  for (const d of daily) {
    const dt = new Date(d.date)
    const key = period === 'monthly'
      ? `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`
      : `${dt.getFullYear()}-Q${Math.ceil((dt.getMonth()+1)/3)}`
    if (!groups[key]) groups[key] = { date: key, impressions: 0, clicks: 0 }
    groups[key].impressions += d.impressions || 0
    groups[key].clicks += d.clicks || 0
  }
  return Object.values(groups).sort((a, b) => a.date.localeCompare(b.date))
}

function makeImpPeriodLabel(key, period) {
  if (period === 'daily' || period === 'weekly') { const p = key.split('-'); return `${p[1]}/${p[2]}/${p[0].slice(2)}` }
  if (period === 'monthly') {
    const [y, m] = key.split('-')
    return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' })
  }
  if (period === 'quarterly') { const [y, q] = key.split('-'); return `${q} '${y.slice(2)}` }
  return key
}

// --- ECharts Options ---

const BLUE = '#2563EB'
const BLUE_LIGHT = '#60A5FA'
const GRAY = '#9CA3AF'

// Linear regression trendline
function computeTrendline(data) {
  const n = data.length
  if (n < 2) return []
  const xs = data.map((_, i) => i)
  const ys = data.map((d) => d.sessions)
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  const num = xs.reduce((s, x, i) => s + (x - meanX) * (ys[i] - meanY), 0)
  const den = xs.reduce((s, x) => s + (x - meanX) ** 2, 0)
  const slope = den ? num / den : 0
  const intercept = meanY - slope * meanX
  return xs.map((x) => Math.round(intercept + slope * x))
}

const totalTrafficOption = computed(() => {
  const d = metrics.totalTraffic?.value
  if (!d) return null
  const rawDaily = d.daily || []
  if (!rawDaily.length) {
    return {
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: ['Total'] },
      yAxis: { type: 'value' },
      series: [{ name: 'Sessions', type: 'bar', data: [d.sessions], itemStyle: { color: BLUE } }],
    }
  }
  const period = reportPeriod.value
  const chartData = aggregateByPeriod(rawDaily, period)
  const n = chartData.length
  const labels = chartData.map((d) => makePeriodLabel(d.date, period))
  const sessions = chartData.map((d) => d.sessions)
  const trend = computeTrendline(chartData)
  const fmtK = (v) => v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(1) + 'K' : v
  const xInterval = n > 52 ? Math.ceil(n / 26) - 1 : n > 26 ? 1 : 0
  const useZoom = n > 20
  const showLabels = n <= 20
  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const label = params[0]?.axisValueLabel || ''
        const session = params.find(p => p.seriesName === 'Total Traffic')
        const trendVal = params.find(p => p.seriesName === 'Trendline')
        const prefix = period === 'weekly' ? 'Week of ' : period === 'monthly' ? '' : period === 'quarterly' ? '' : ''
        return `${prefix}${label}<br/>Total Traffic: <b>${(session?.value || 0).toLocaleString()}</b>${trendVal ? `<br/>Trend: ${(trendVal.value || 0).toLocaleString()}` : ''}`
      },
    },
    legend: {
      data: ['Total Traffic', 'Trendline'],
      textStyle: { color: '#6B7280' },
      bottom: useZoom ? 30 : 5,
    },
    grid: { left: '5%', right: '3%', bottom: useZoom ? '20%' : '14%', top: '8%', containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#6B7280', fontSize: 10, rotate: 45, interval: xInterval },
      axisTick: { show: false },
    },
    yAxis: { type: 'value', axisLabel: { color: '#6B7280', formatter: fmtK }, splitLine: { lineStyle: { color: '#F1F5F9' } } },
    ...(useZoom ? { dataZoom: [
      { type: 'slider', bottom: 5, height: 18, start: Math.max(0, 100 - Math.round(20 / n * 100)), end: 100, borderColor: '#E2E8F0' },
      { type: 'inside' },
    ] } : {}),
    series: [
      {
        name: 'Total Traffic',
        type: 'line',
        data: sessions,
        smooth: true,
        symbol: 'circle',
        symbolSize: n > 40 ? 3 : 4,
        lineStyle: { color: '#06B6D4', width: 2 },
        itemStyle: { color: '#06B6D4' },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(6,182,212,0.4)' }, { offset: 1, color: 'rgba(6,182,212,0.02)' }] } },
        label: { show: showLabels, position: 'top', fontSize: 9, color: '#374151', formatter: (p) => p.value > 0 ? p.value.toLocaleString() : '' },
      },
      {
        name: 'Trendline',
        type: 'line',
        data: trend,
        smooth: false,
        symbol: 'none',
        lineStyle: { color: '#F59E0B', width: 2, type: 'dashed' },
        itemStyle: { color: '#F59E0B' },
      },
    ],
  }
})

const impressionsInsight = computed(() => {
  const d = metrics.impressions?.value
  if (!d) return ''
  const { impressions, clicks, ctr, daily } = d
  if (!impressions) return ''

  // CTR context
  let ctrContext = ''
  if (ctr >= 3) ctrContext = 'The CTR is strong, indicating that search users find the page titles and descriptions compelling.'
  else if (ctr >= 1.5) ctrContext = 'The CTR is moderate. Improving meta titles and descriptions could help convert more impressions into clicks.'
  else ctrContext = 'The CTR is low relative to impressions. Optimizing meta titles, descriptions, and structured data may help attract more clicks.'

  // Trend from daily
  let trendSentence = ''
  if (daily?.length >= 4) {
    const half = Math.floor(daily.length / 2)
    const firstHalf = daily.slice(0, half).reduce((s, d) => s + d.impressions, 0) / half
    const secondHalf = daily.slice(half).reduce((s, d) => s + d.impressions, 0) / (daily.length - half)
    const change = firstHalf > 0 ? ((secondHalf - firstHalf) / firstHalf * 100).toFixed(0) : 0
    if (change > 10) trendSentence = `📈 Impressions trended upward by ${change}% in the second half of the period.`
    else if (change < -10) trendSentence = `📉 Impressions declined by ${Math.abs(change)}% in the second half — a signal to review keyword targeting.`
    else trendSentence = `➡️ Impressions remained stable throughout the period.`
  }

  return `${trendSentence} The site received ${impressions.toLocaleString()} total impressions with ${clicks.toLocaleString()} clicks (${ctr}% CTR) during this period. ${ctrContext} Consistently publishing SEO-optimized content and targeting high-intent keywords can help grow impressions over time.`
})

const trafficInsight = computed(() => {
  const d = metrics.totalTraffic?.value
  if (!d) return ''
  const rawDaily = d.daily || []
  if (!rawDaily.length) return ''
  const period = reportPeriod.value
  const chartData = aggregateByPeriod(rawDaily, period)
  const sessions = chartData.map((d) => d.sessions)
  const total = sessions.reduce((a, b) => a + b, 0)
  const half = Math.floor(sessions.length / 2)
  const firstHalfAvg = sessions.slice(0, half).reduce((a, b) => a + b, 0) / (half || 1)
  const secondHalfAvg = sessions.slice(half).reduce((a, b) => a + b, 0) / ((sessions.length - half) || 1)
  const change = firstHalfAvg > 0 ? (secondHalfAvg - firstHalfAvg) / firstHalfAvg : 0
  let trend = '\u27a1\ufe0f Traffic remained relatively stable this period.'
  if (change > 0.1) trend = '\ud83d\udcc8 Traffic is trending upward this period.'
  else if (change < -0.1) trend = '\ud83d\udcc9 Traffic is trending downward this period.'
  const peakIdx = sessions.indexOf(Math.max(...sessions))
  const peakLabel = makePeriodLabel(chartData[peakIdx].date, period)
  const avg = Math.round(total / sessions.length)
  const periodLabel = period
  const totalLabel = total.toLocaleString()

  // Low/high traffic context
  let volumeContext = ''
  if (avg < 50) volumeContext = 'Overall traffic volume is low, suggesting the site is still in an early growth phase or needs more visibility efforts.'
  else if (avg < 200) volumeContext = 'Traffic volume is moderate. There is room for growth through improved content strategy and SEO optimization.'
  else volumeContext = 'Traffic volume is healthy. Maintaining this momentum with consistent content and SEO efforts is key.'

  // Trend explanation
  let trendDetail = ''
  const changePct = Math.abs(Math.round(change * 100))
  if (change > 0.1) trendDetail = `The ${changePct}% increase in the second half of the period suggests recent SEO efforts or content updates are gaining traction.`
  else if (change < -0.1) trendDetail = `The ${changePct}% decline in the second half may indicate seasonal fluctuations or a need to revisit content and keyword strategies.`
  else trendDetail = `Consistent traffic patterns suggest stable organic reach, though targeted campaigns could help accelerate growth.`

  // Total summary
  const totalSummary = `A total of ${totalLabel} sessions were recorded during this period.`

  return `${trend} Peak was ${sessions[peakIdx].toLocaleString()} sessions on ${peakLabel}. Average ${periodLabel} traffic: ${avg.toLocaleString()} sessions. ${totalSummary} ${volumeContext} ${trendDetail}`
})

// --- Weekly Traffic by Source Over Time ---
const sourceOverTimeColorMap = {
  'Direct': '#2563EB',
  'Organic Search': '#059669',
  'Email': '#7C3AED',
  'Organic Social': '#D97706',
  'Referral': '#DC2626',
}
const sourceOverTimeDefaultColor = '#0891B2'

const allowedSourceChannels = ['Direct', 'Email', 'Organic Search', 'Organic Social', 'Referral']

const trafficBySourceOverTimeOption = computed(() => {
  const raw = metrics.trafficBySourceOverTime
  if (!raw?.channels?.length || !raw?.dates?.length) return null
  const period = reportPeriod.value
  const channels = raw.channels.filter((ch) => allowedSourceChannels.includes(ch))
  const { dates: aggDates, series: aggSeries } = aggregateSourcesOverTimeByPeriod(raw.dates, raw.series, period)
  const n = aggDates.length
  const labels = aggDates.map(d => makeSourcePeriodLabel(d, period))
  const fmtK = (v) => v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(1) + 'K' : v
  const xInterval = n > 52 ? Math.ceil(n / 26) - 1 : n > 26 ? 1 : 0
  const useZoom = n > 20
  const showLabels = n <= 16
  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const label = params[0]?.axisValueLabel || ''
        const lines = params.map((p) => `${p.marker} ${p.seriesName}: <b>${(p.value || 0).toLocaleString()}</b>`)
        return `${label}<br/>${lines.join('<br/>')}`
      },
    },
    legend: {
      data: channels,
      textStyle: { color: '#6B7280' },
      top: 0,
    },
    grid: { left: '4%', right: '4%', bottom: useZoom ? '20%' : '14%', top: '12%', containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#6B7280', fontSize: 10, rotate: 45, interval: xInterval },
      axisTick: { show: false },
    },
    yAxis: { type: 'value', name: 'Sessions', axisLabel: { color: '#6B7280', formatter: fmtK }, splitLine: { lineStyle: { color: '#F1F5F9' } } },
    ...(useZoom ? { dataZoom: [
      { type: 'slider', bottom: 5, height: 18, start: Math.max(0, 100 - Math.round(20 / n * 100)), end: 100, borderColor: '#E2E8F0' },
      { type: 'inside' },
    ] } : {}),
    series: channels.map((ch) => ({
      name: ch,
      type: 'line',
      data: aggSeries[ch] || [],
      smooth: true,
      symbol: 'circle',
      symbolSize: n > 40 ? 3 : 4,
      lineStyle: { color: sourceOverTimeColorMap[ch] || sourceOverTimeDefaultColor, width: 2 },
      itemStyle: { color: sourceOverTimeColorMap[ch] || sourceOverTimeDefaultColor },
      label: { show: showLabels, position: 'top', fontSize: 8, color: sourceOverTimeColorMap[ch] || sourceOverTimeDefaultColor, formatter: (p) => p.value > 0 ? p.value.toLocaleString() : '' },
    })),
  }
})

const newVsReturningOption = computed(() => {
  const raw = metrics.newVsReturning?.value
  if (!Array.isArray(raw) || !raw.length) return null
  const colors = { new: '#0D9488', returning: '#2563EB', 'New Visitor': '#0D9488', 'Returning Visitor': '#2563EB' }
  const total = raw.reduce((s, r) => s + r.sessions, 0)
  return {
    tooltip: {
      trigger: 'item',
      formatter: (p) => `${p.name}<br/>Sessions: <b>${Number(p.value).toLocaleString()}</b> (${p.percent}%)<br/>Engagement Rate: <b>${(raw.find(r => r.type === p.data.type)?.engagementRate * 100 || 0).toFixed(1)}%</b><br/>Bounce Rate: <b>${(raw.find(r => r.type === p.data.type)?.bounceRate * 100 || 0).toFixed(1)}%</b>`
    },
    legend: { bottom: 0, textStyle: { color: '#6B7280', fontSize: 11 } },
    series: [{
      type: 'pie',
      radius: ['40%', '68%'],
      center: ['50%', '44%'],
      label: {
        show: true,
        formatter: (p) => `${p.name}\n${p.percent}%`,
        fontSize: 11,
        color: '#374151',
      },
      data: raw.map(r => ({
        name: r.type === 'new' ? 'New Visitors' : r.type === 'returning' ? 'Returning Visitors' : r.type,
        value: r.sessions,
        type: r.type,
        itemStyle: { color: colors[r.type] || colors[r.type.split(' ')[0].toLowerCase()] || '#94A3B8' },
      })),
    }],
  }
})

const trafficBySourceInsight = computed(() => {
  const raw = metrics.trafficBySourceOverTime
  if (!raw?.channels?.length || !raw?.dates?.length) return ''
  const { dates, series } = raw
  const channels = raw.channels.filter((ch) => allowedSourceChannels.includes(ch))

  // Total sessions per channel
  const totals = {}
  for (const ch of channels) {
    totals[ch] = (series[ch] || []).reduce((a, b) => a + b, 0)
  }
  const dominant = channels.reduce((a, b) => (totals[a] >= totals[b] ? a : b))
  const dominantTotal = totals[dominant]
  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0)
  const dominantPct = grandTotal > 0 ? Math.round((dominantTotal / grandTotal) * 100) : 0

  // Growth: compare last 2 weeks
  const len = dates.length
  let fastestGrowing = null
  let fastestGrowth = -Infinity
  const declining = []
  for (const ch of channels) {
    const vals = series[ch] || []
    if (len >= 2) {
      const last = vals[len - 1] || 0
      const prev = vals[len - 2] || 0
      const growth = prev > 0 ? ((last - prev) / prev) * 100 : (last > 0 ? 100 : 0)
      if (growth > fastestGrowth) {
        fastestGrowth = growth
        fastestGrowing = ch
      }
      if (last < prev) declining.push(ch)
    }
  }

  let s1 = `${dominant} traffic continues to serve as the primary traffic driver, accounting for ${dominantPct}% of total sessions (${dominantTotal.toLocaleString()} sessions).`
  let s2 = ''
  if (fastestGrowing && fastestGrowth > 0) {
    s2 = ` ${fastestGrowing} showed the strongest recent growth with a ${Math.round(fastestGrowth)}% increase in the most recent week.`
  } else if (fastestGrowing) {
    s2 = ` ${fastestGrowing} had the least decline among channels in the most recent week.`
  }
  let s3 = ''
  if (declining.length > 0) {
    const names = declining.slice(0, 3).join(', ')
    s3 = ` ${names} ${declining.length === 1 ? 'shows' : 'show'} a slight decline in the most recent period, which may warrant investigation.`
  }
  const avgPerDay = grandTotal > 0 && len > 0 ? Math.round(grandTotal / len) : 0
  const s4 = ` Average daily traffic across all channels is ${avgPerDay.toLocaleString()} sessions over the ${len}-day period analyzed.`
  const s5 = declining.length === 0
    ? ' All channels are maintaining positive or stable trajectories — a healthy sign for sustained growth.'
    : ' Diversifying traffic sources and investing in underperforming channels could help stabilize overall performance.'

  return `${s1}${s2}${s3}${s4}${s5}`
})

// --- Weekly Website Traffic - US ---
const usSourceColorMap = {
  'Direct': '#2563EB',
  'Email': '#7C3AED',
  'Organic Search': '#059669',
  'Organic Social': '#D97706',
  'Referral': '#DC2626',
}

const trafficUSBySourceOverTimeOption = computed(() => {
  const raw = metrics.trafficUSBySourceOverTime
  if (!raw?.channels?.length || !raw?.dates?.length) return null
  const period = reportPeriod.value
  const channels = raw.channels.filter((ch) => Object.keys(usSourceColorMap).includes(ch))
  const { dates: aggDates, series: aggSeries } = aggregateSourcesOverTimeByPeriod(raw.dates, { ...raw.series, 'USA Total': raw.usaTotals || [] }, period)
  const n = aggDates.length
  const labels = aggDates.map(d => makeSourcePeriodLabel(d, period))
  const fmtK = (v) => v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(1) + 'K' : v
  const xInterval = n > 52 ? Math.ceil(n / 26) - 1 : n > 26 ? 1 : 0
  const useZoom = n > 20
  const showLabels = n <= 16
  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const label = params[0]?.axisValueLabel || ''
        const lines = params.map((p) => `${p.marker} ${p.seriesName}: <b>${(p.value || 0).toLocaleString()}</b>`)
        return `${label}<br/>${lines.join('<br/>')}`
      },
    },
    legend: {
      data: [...channels, 'USA Total'],
      textStyle: { color: '#6B7280' },
      top: 0,
    },
    grid: { left: '4%', right: '4%', bottom: useZoom ? '20%' : '14%', top: '12%', containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#6B7280', fontSize: 10, rotate: 45, interval: xInterval },
      axisTick: { show: false },
    },
    yAxis: { type: 'value', name: 'Sessions', axisLabel: { color: '#6B7280', formatter: fmtK }, splitLine: { lineStyle: { color: '#F1F5F9' } } },
    ...(useZoom ? { dataZoom: [
      { type: 'slider', bottom: 5, height: 18, start: Math.max(0, 100 - Math.round(20 / n * 100)), end: 100, borderColor: '#E2E8F0' },
      { type: 'inside' },
    ] } : {}),
    series: [
      ...channels.map((ch) => ({
        name: ch,
        type: 'line',
        data: aggSeries[ch] || [],
        smooth: true,
        symbol: 'circle',
        symbolSize: n > 40 ? 3 : 4,
        lineStyle: { color: usSourceColorMap[ch], width: 2 },
        itemStyle: { color: usSourceColorMap[ch] },
        label: { show: showLabels, position: 'top', fontSize: 8, color: '#6B7280', formatter: (p) => p.value > 0 ? p.value.toLocaleString() : '' },
      })),
      {
        name: 'USA Total',
        type: 'line',
        data: aggSeries['USA Total'] || [],
        smooth: true,
        symbol: 'circle',
        symbolSize: n > 40 ? 3 : 4,
        lineStyle: { color: '#06B6D4', width: 3, type: 'dashed' },
        itemStyle: { color: '#06B6D4' },
        label: { show: showLabels, position: 'top', fontSize: 8, color: '#06B6D4', formatter: (p) => p.value > 0 ? p.value.toLocaleString() : '' },
      },
    ],
  }
})

const usTrafficInsight = computed(() => {
  const raw = metrics.trafficUSBySourceOverTime
  if (!raw?.channels?.length || !raw?.dates?.length) return ''
  const { dates, series, usaTotals } = raw
  const channels = raw.channels.filter((ch) => Object.keys(usSourceColorMap).includes(ch))
  const len = dates.length

  // Recent vs previous week
  const recentTotal = len >= 1 ? (usaTotals[len - 1] || 0) : 0
  const prevTotal = len >= 2 ? (usaTotals[len - 2] || 0) : 0
  const changePct = prevTotal > 0 ? Math.round(((recentTotal - prevTotal) / prevTotal) * 100) : 0
  const changeDir = changePct > 0 ? 'increased' : changePct < 0 ? 'decreased' : 'remained flat'

  // Dominant channel
  const totals = {}
  for (const ch of channels) {
    totals[ch] = (series[ch] || []).reduce((a, b) => a + b, 0)
  }
  const dominant = channels.reduce((a, b) => (totals[a] >= totals[b] ? a : b))
  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0)
  const dominantPct = grandTotal > 0 ? Math.round((totals[dominant] / grandTotal) * 100) : 0

  const s1 = `US traffic ${changeDir} by ${Math.abs(changePct)}% in the most recent period (${recentTotal.toLocaleString()} sessions vs ${prevTotal.toLocaleString()} prior).`
  const s2 = ` ${dominant} is the dominant US channel, accounting for ${dominantPct}% of total US sessions.`
  const s3 = grandTotal > 0
    ? ` Average daily US traffic is ${Math.round(grandTotal / len).toLocaleString()} sessions over the ${len}-day period analyzed.`
    : ''

  let recommendation = ''
  if (dominantPct > 60) {
    recommendation = ` Consider diversifying traffic sources — heavy reliance on ${dominant} creates vulnerability if that channel underperforms.`
  } else if (changePct < -10) {
    recommendation = ` The recent decline warrants investigation — review content performance and keyword rankings for US-targeted pages.`
  } else {
    recommendation = ` Maintain momentum by continuing to optimize US-targeted content and monitoring channel-level trends weekly.`
  }

  return `${s1}${s2}${s3}${recommendation}`
})

const sourceColors = ['#2563EB', '#7C3AED', '#059669', '#D97706', '#DC2626', '#0891B2', '#4F46E5', '#CA8A04']

const trafficBySourceOption = computed(() => {
  const raw = metrics.trafficBySource?.value
  if (!raw) return null
  const d = raw.currentPeriod || raw
  if (!d?.length) return null
  const prev = raw.previousPeriod || null
  const sorted = [...d].sort((a, b) => a.sessions - b.sessions)
  const channels = sorted.map((s) => s.channel)
  const series = [{
    name: 'This Period',
    type: 'bar',
    data: sorted.map((s, i) => ({
      value: s.sessions,
      itemStyle: { color: sourceColors[i % sourceColors.length] },
    })),
  }]
  if (prev?.length) {
    const prevMap = Object.fromEntries(prev.map((p) => [p.channel, p.sessions]))
    series.push({
      name: 'Previous Period',
      type: 'bar',
      data: channels.map(() => ({ value: 0, itemStyle: { color: '#94A3B8' } })),
    })
    series[1].data = sorted.map((s) => ({
      value: prevMap[s.channel] || 0,
      itemStyle: { color: '#94A3B8' },
    }))
  }
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: prev?.length ? { data: ['This Period', 'Previous Period'], textStyle: { color: '#6B7280' }, bottom: 0 } : undefined,
    grid: { left: '3%', right: '10%', bottom: prev?.length ? '10%' : '3%', top: '3%', containLabel: true },
    xAxis: { type: 'value', axisLabel: { color: '#6B7280' } },
    yAxis: {
      type: 'category',
      data: channels,
      axisLabel: { color: '#6B7280' },
    },
    series,
  }
})

const trafficSourceDonutOption = computed(() => {
  const raw = metrics.trafficBySource?.value
  if (!raw) return null
  const d = raw.currentPeriod || raw
  if (!d?.length) return null
  const groups = { Organic: 0, Direct: 0, Social: 0, Email: 0, Referral: 0, Other: 0 }
  for (const item of d) {
    const ch = (item.channel || '').toLowerCase()
    if (ch.includes('organic search')) groups.Organic += item.sessions
    else if (ch.includes('direct')) groups.Direct += item.sessions
    else if (ch.includes('social')) groups.Social += item.sessions
    else if (ch.includes('email')) groups.Email += item.sessions
    else if (ch.includes('referral')) groups.Referral += item.sessions
    else groups.Other += item.sessions
  }
  const total = Object.values(groups).reduce((a, b) => a + b, 0)
  if (!total) return null
  const colors = { Organic: '#22C55E', Direct: '#2563EB', Social: '#7C3AED', Email: '#D97706', Referral: '#0891B2', Other: '#94A3B8' }
  const data = Object.entries(groups).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value, itemStyle: { color: colors[name] } }))
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { orient: 'vertical', right: 10, top: 'center', textStyle: { color: '#6B7280' } },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['35%', '50%'],
      avoidLabelOverlap: true,
      label: { show: true, formatter: '{d}%', fontSize: 11 },
      data,
    }],
  }
})

const topLandingPagesBarOption = computed(() => {
  const rows = trafficDriversTable.value
  if (!rows?.length) return null
  const top10 = rows.slice(0, 10).reverse()
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['This Week', 'Last Week'], top: 0, textStyle: { color: '#6B7280', fontSize: 11 } },
    grid: { left: 10, right: 20, top: 30, bottom: 5, containLabel: true },
    xAxis: { type: 'value', axisLabel: { color: '#6B7280' } },
    yAxis: { type: 'category', data: top10.map(r => r.pagePath.length > 35 ? r.pagePath.slice(0, 35) + '...' : r.pagePath), axisLabel: { color: '#6B7280', fontSize: 10 } },
    series: [
      { name: 'This Week', type: 'bar', data: top10.map(r => r.sessions), itemStyle: { color: '#0D9488' }, barWidth: 12 },
      { name: 'Last Week', type: 'bar', data: top10.map(r => r.lastWeekSessions ?? 0), itemStyle: { color: '#94A3B8' }, barWidth: 12 },
    ],
  }
})

const avgSessionLineOption = computed(() => {
  const rows = trafficDriversTable.value
  if (!rows?.length) return null
  const top10 = [...rows].filter(r => r.avgSessionDuration != null).sort((a, b) => b.avgSessionDuration - a.avgSessionDuration).slice(0, 10)
  if (!top10.length) return null
  return {
    tooltip: { trigger: 'axis', formatter: (params) => { const p = params[0]; const s = p.value; const m = Math.floor(s / 60); const sec = Math.round(s % 60); return `${p.name}<br/>Avg Session: <b>${m}m ${sec < 10 ? '0' : ''}${sec}s</b>` } },
    grid: { left: 10, right: 20, top: 10, bottom: 60, containLabel: true },
    xAxis: { type: 'category', data: top10.map(r => r.pagePath.length > 20 ? r.pagePath.slice(0, 20) + '...' : r.pagePath), axisLabel: { color: '#6B7280', fontSize: 9, rotate: 30 } },
    yAxis: { type: 'value', axisLabel: { color: '#6B7280', formatter: (v) => { const m = Math.floor(v / 60); const s = Math.round(v % 60); return `${m}m${s > 0 ? s + 's' : ''}` } } },
    series: [{
      type: 'line', smooth: true,
      data: top10.map(r => r.avgSessionDuration),
      lineStyle: { color: '#0D9488', width: 2 },
      itemStyle: { color: '#0D9488' },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(13,148,136,0.25)' }, { offset: 1, color: 'rgba(13,148,136,0)' }] } },
      label: { show: true, formatter: (p) => { const m = Math.floor(p.value / 60); const s = Math.round(p.value % 60); return `${m}m${s < 10 ? '0' : ''}${s}s` }, fontSize: 9, color: '#0D9488' },
    }],
  }
})

const bounceRateBarOption = computed(() => {
  const rows = trafficDriversTable.value
  if (!rows?.length) return null
  const top = rows.filter(r => r.bounceRate != null).slice(0, 10).reverse()
  if (!top.length) return null
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => { const p = params[0]; return `${p.name}<br/>Bounce Rate: ${(p.value).toFixed(1)}%` } },
    grid: { left: 10, right: 60, top: 5, bottom: 5, containLabel: true },
    xAxis: { type: 'value', min: 0, max: 100, axisLabel: { color: '#6B7280', formatter: (v) => v + '%' } },
    yAxis: { type: 'category', data: top.map(r => r.pagePath.length > 30 ? r.pagePath.slice(0, 30) + '...' : r.pagePath), axisLabel: { color: '#6B7280', fontSize: 10 } },
    series: [{ type: 'bar', data: top.map(r => ({ value: +(r.bounceRate * 100).toFixed(1), itemStyle: { color: r.bounceRate > 0.7 ? '#EF4444' : r.bounceRate >= 0.4 ? '#F59E0B' : '#22C55E' } })), barWidth: 14 }],
  }
})

const pagesPerSessionFunnelOption = computed(() => {
  const rows = trafficDriversTable.value
  if (!rows?.length) return null
  const top = [...rows].filter(r => r.pagesPerSession != null).sort((a, b) => b.pagesPerSession - a.pagesPerSession).slice(0, 8)
  if (!top.length) return null
  const palette = ['#0D9488','#14B8A6','#2DD4BF','#5EEAD4','#0891B2','#06B6D4','#67E8F9','#99F6E4']
  const maxPps = top[0].pagesPerSession || 1
  return {
    tooltip: { trigger: 'item', formatter: (p) => `${p.name}<br/>Pages/Session: <b>${Number(p.value).toFixed(1)}</b>` },
    series: [{
      type: 'funnel',
      left: '10%', top: 8, bottom: 8, width: '80%',
      min: 0, max: maxPps,
      minSize: '20%', maxSize: '100%',
      sort: 'descending', gap: 3,
      label: { show: true, position: 'inside', color: '#fff', fontSize: 9, formatter: (p) => `${String(p.name).length > 22 ? String(p.name).slice(0, 22) + '…' : p.name}  ${Number(p.value).toFixed(1)}p/s` },
      itemStyle: { borderColor: '#fff', borderWidth: 1 },
      data: top.map((r, i) => ({ name: r.pagePath, value: r.pagesPerSession, itemStyle: { color: palette[i % palette.length] } })),
    }],
  }
})

const indexManagementPieOption = computed(() => {
  const daily = metrics.impressions?.value?.daily
  if (!daily?.length) return null
  let active = 0, impressionsOnly = 0, notVisible = 0
  for (const d of daily) {
    if (d.clicks > 0) active++
    else if (d.impressions > 0) impressionsOnly++
    else notVisible++
  }
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, textStyle: { color: '#6B7280', fontSize: 11 } },
    series: [{
      type: 'pie', radius: ['40%', '70%'], center: ['50%', '45%'],
      label: { show: true, formatter: '{b}\n{d}%', fontSize: 11 },
      data: [
        { value: active, name: 'Active Pages', itemStyle: { color: '#22C55E' } },
        { value: impressionsOnly, name: 'Impressions Only', itemStyle: { color: '#F59E0B' } },
        { value: notVisible, name: 'Not Visible', itemStyle: { color: '#94A3B8' } },
      ],
    }],
  }
})

const structuredDataTableRows = computed(() => {
  const d = metrics.gscStructuredData
  if (!d) return []
  const makeRow = (type, data) => {
    const clicks = data?.clicks ?? 0
    const impressions = data?.impressions ?? 0
    const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(1) + '%' : '0%'
    const status = clicks > 0 ? 'Active' : impressions > 0 ? 'Limited' : 'No Data'
    return { searchType: type, clicks, impressions, ctr, status }
  }
  return [makeRow('Web', d.web), makeRow('Image', d.image), makeRow('Video', d.video)]
})

// GA4 country name → ECharts world map name mapping
const countryNameMap = {
  'United States': 'United States',
  'United Kingdom': 'United Kingdom',
  'South Korea': 'South Korea',
  'North Korea': 'North Korea',
  'Czech Republic': 'Czech Rep.',
  'Dominican Republic': 'Dominican Rep.',
  'Bosnia and Herzegovina': 'Bosnia and Herz.',
  'North Macedonia': 'Macedonia',
  'Ivory Coast': "Côte d'Ivoire",
  'Republic of the Congo': 'Congo',
  'Democratic Republic of the Congo': 'Dem. Rep. Congo',
  'Tanzania': 'Tanzania',
  'Syria': 'Syria',
  'Laos': 'Lao PDR',
  'Vietnam': 'Vietnam',
  'Russia': 'Russia',
  'South Africa': 'South Africa',
  'New Zealand': 'New Zealand',
  'Trinidad and Tobago': 'Trinidad and Tobago',
}

const trafficFromUSOption = computed(() => {
  const d = metrics.trafficFromUS?.value
  if (!d) return null
  const mapData = (d.countries || []).map(c => ({
    name: countryNameMap[c.country] || c.country,
    value: c.sessions
  }))
  const maxVal = mapData.length ? Math.max(...mapData.map(c => c.value)) : 100
  return {
    tooltip: { trigger: 'item', formatter: (p) => p.name && p.value != null && !isNaN(p.value) ? `${p.name}: ${Number(p.value).toLocaleString()} sessions` : p.name ? `${p.name}: No data` : '' },
    visualMap: {
      min: 0,
      max: maxVal,
      inRange: { color: ['#DBEAFE', '#2563EB'] },
      text: ['High', 'Low'],
      calculable: true,
      left: 'left',
      bottom: 10,
      textStyle: { color: '#6B7280' },
    },
    series: [{
      type: 'map',
      map: 'world',
      roam: true,
      emphasis: { label: { show: true }, itemStyle: { areaColor: '#93C5FD' } },
      data: mapData,
    }],
  }
})

const trafficDriversTable = computed(() => {
  const raw = metrics.trafficDrivers
  if (!raw) return []
  // raw is the full API response: { metric, value: [...pages], previousPeriod: [...] }
  const rows = Array.isArray(raw) ? raw : (raw.value || [])
  if (!Array.isArray(rows) || !rows.length) return []
  const prevData = (Array.isArray(raw) ? [] : raw.previousPeriod) || []
  const prevMap = {}
  for (const p of prevData) {
    prevMap[p.pagePath] = p.sessions
  }
  return rows.slice(0, 10).map((r) => {
    const lastWeek = prevMap[r.pagePath] ?? null
    const wow = lastWeek != null && lastWeek > 0 ? ((r.sessions - lastWeek) / lastWeek * 100).toFixed(1) : null
    return {
      pagePath: r.pagePath,
      sessions: r.sessions,
      lastWeekSessions: lastWeek,
      wowGrowth: wow,
      avgSessionDuration: r.avgSessionDuration ?? r.averageSessionDuration ?? null,
      engagementRate: r.engagementRate ?? null,
      bounceRate: r.bounceRate ?? null,
      pagesPerSession: r.pagesPerSession ?? null,
    }
  })
})

function formatDuration(seconds) {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s < 10 ? '0' : ''}${s}s`
}

function formatPercent(val) {
  if (val == null) return '—'
  return `${(val * 100).toFixed(1)}%`
}

// Traffic Drivers insight
const trafficDriversInsight = computed(() => {
  const rows = trafficDriversTable.value.slice(0, 10)
  if (!rows.length) return ''

  // Find best engagement
  let bestEngagement = null
  let bestEngagementVal = -1
  for (const r of rows) {
    if (r.engagementRate != null && r.engagementRate > bestEngagementVal) {
      bestEngagementVal = r.engagementRate
      bestEngagement = r
    }
  }

  // Find best WoW growth
  let bestGrowth = null
  let bestGrowthVal = -Infinity
  for (const r of rows) {
    if (r.wowGrowth != null && Number(r.wowGrowth) > bestGrowthVal) {
      bestGrowthVal = Number(r.wowGrowth)
      bestGrowth = r
    }
  }

  // Find longest avg session
  let longestSession = null
  let longestSessionVal = -1
  for (const r of rows) {
    if (r.avgSessionDuration != null && r.avgSessionDuration > longestSessionVal) {
      longestSessionVal = r.avgSessionDuration
      longestSession = r
    }
  }

  const parts = []
  if (bestEngagement) {
    parts.push(`The page "${bestEngagement.pagePath}" leads in engagement at ${(bestEngagementVal * 100).toFixed(1)}%, indicating strong visitor interaction and content relevance.`)
  }
  if (bestGrowth) {
    parts.push(`"${bestGrowth.pagePath}" achieved the highest week-over-week growth at ${bestGrowthVal >= 0 ? '+' : ''}${bestGrowthVal}%, suggesting rising interest or effective promotion.`)
  }
  if (longestSession) {
    parts.push(`Visitors spend the most time on "${longestSession.pagePath}" with an average session of ${formatDuration(longestSessionVal)}, pointing to deep content consumption.`)
  }
  parts.push('Consider doubling down on high-engagement pages with targeted CTAs and replicating successful content strategies across lower-performing pages to lift overall site performance.')

  return parts.join(' ')
})

// US Traffic by Source chart
const trafficUSBySourceOption = computed(() => {
  const raw = metrics.trafficUSBySource?.value
  const d = raw?.channels || (Array.isArray(raw) ? raw : null)
  if (!d?.length) return null
  const sorted = [...d].sort((a, b) => a.sessions - b.sessions)
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '10%', bottom: '3%', top: '3%', containLabel: true },
    xAxis: { type: 'value', axisLabel: { color: '#6B7280' } },
    yAxis: {
      type: 'category',
      data: sorted.map((s) => s.channel || s.source),
      axisLabel: { color: '#6B7280' },
    },
    series: [{
      type: 'bar',
      data: sorted.map((s, i) => ({
        value: s.sessions,
        itemStyle: { color: sourceColors[i % sourceColors.length] },
      })),
    }],
  }
})

function gaugeOption(score, title) {
  const val = score ?? 0
  return {
    series: [{
      type: 'gauge',
      startAngle: 200,
      endAngle: -20,
      min: 0,
      max: 100,
      pointer: { show: false },
      progress: { show: true, width: 18, roundCap: true },
      axisLine: {
        lineStyle: {
          width: 18,
          color: [
            [0.5, '#EF4444'],
            [0.8, '#F59E0B'],
            [1, '#22C55E'],
          ],
        },
      },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      detail: {
        valueAnimation: true,
        fontSize: 28,
        fontWeight: 'bold',
        color: '#374151',
        offsetCenter: [0, '0%'],
        formatter: '{value}',
      },
      title: {
        offsetCenter: [0, '30%'],
        fontSize: 14,
        color: '#6B7280',
      },
      data: [{ value: val, name: title }],
    }],
  }
}

const domainRatingGauge = computed(() => {
  const d = metrics.domainRating?.value
  if (!d) return null
  return gaugeOption(Math.round(d.domain_rating), 'Domain Rating')
})

const drScoreValue = computed(() => {
  const d = metrics.domainRating?.value
  return d ? Math.round(d.domain_rating) : null
})
const drScoreColor = computed(() => {
  const v = drScoreValue.value
  if (v == null) return '#9CA3AF'
  if (v >= 40) return '#22C55E'
  if (v >= 20) return '#F59E0B'
  return '#EF4444'
})

const backlinksHistoryRows = computed(() => {
  return metrics.backlinksHistory?.weeks || []
})

// Dummy data for Backlinks & Domain Authority preview
const DUMMY_BACKLINKS = {
  live_backlinks: 1842,
  live_refdomains: 143,
  all_time_backlinks: 4210,
  all_time_refdomains: 287,
}
const DUMMY_BACKLINKS_HISTORY = [
  { label: 'Week of 03/10', backlinks: 1842, domain_rating: 28, change_pct: '1.20' },
  { label: 'Week of 03/03', backlinks: 1820, domain_rating: 28, change_pct: '0.55' },
  { label: 'Week of 02/24', backlinks: 1810, domain_rating: 27, change_pct: '-0.22' },
  { label: 'Week of 02/17', backlinks: 1814, domain_rating: 27, change_pct: '0.83' },
  { label: 'Week of 02/10', backlinks: 1799, domain_rating: 26, change_pct: '1.47' },
  { label: 'Week of 02/03', backlinks: 1773, domain_rating: 26, change_pct: '-0.61' },
  { label: 'Week of 01/27', backlinks: 1784, domain_rating: 26, change_pct: '0.34' },
  { label: 'Week of 01/20', backlinks: 1778, domain_rating: 25, change_pct: '2.01' },
  { label: 'Week of 01/13', backlinks: 1742, domain_rating: 25, change_pct: '-0.40' },
  { label: 'Week of 01/06', backlinks: 1749, domain_rating: 25, change_pct: null },
]
const displayBacklinks = computed(() => metrics.backlinks?.value || DUMMY_BACKLINKS)
const displayBacklinksHistory = computed(() => backlinksHistoryRows.value.length ? backlinksHistoryRows.value : DUMMY_BACKLINKS_HISTORY)
const isBacklinksDummy = computed(() => !metrics.backlinks?.value)

const siteHealthGauge = computed(() => {
  const d = metrics.siteHealth?.value
  if (!d) return null
  return gaugeOption(d.health_score ?? 0, 'Site Health')
})

// Site Audit helpers
const auditData = computed(() => metrics.siteAuditIssues)

const healthScoreColor = computed(() => {
  const score = auditData.value?.health_score
  if (score == null) return 'text-gray-500'
  if (score >= 80) return 'text-green-600'
  if (score >= 50) return 'text-yellow-600'
  return 'text-red-600'
})

function aggregateImpressionsWeekly(daily) {
  const weeks = {}
  for (const d of daily) {
    const dt = new Date(d.date + 'T12:00:00')
    const day = dt.getDay()
    const diff = (day === 0 ? -6 : 1) - day
    const monday = new Date(dt)
    monday.setDate(dt.getDate() + diff)
    const key = `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`
    if (!weeks[key]) weeks[key] = { date: d.date, impressions: 0, clicks: 0 }
    weeks[key].impressions += d.impressions || 0
    weeks[key].clicks += d.clicks || 0
  }
  return Object.values(weeks).sort((a, b) => a.date.localeCompare(b.date))
}

const impressionsChartOption = computed(() => {
  const daily = metrics.impressions?.value?.daily || []
  const period = reportPeriod.value
  const aggregated = aggregateImpressionsByPeriod(daily, period)
  const n = aggregated.length
  const labels = aggregated.map((d) => makeImpPeriodLabel(d.date, period))
  const impressions = aggregated.map((d) => d.impressions)
  const fmtK = (v) => v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(1) + 'K' : v
  const xInterval = n > 52 ? Math.ceil(n / 26) - 1 : n > 26 ? 1 : 0
  const useZoom = n > 20
  const showLabels = n <= 20
  const dotSize = n > 40 ? 3 : 5
  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const label = params[0]?.axisValueLabel || ''
        const imp = params.find(p => p.seriesName === 'Impressions')
        return `${label}<br/>${imp?.marker || ''} Impressions: <b>${(imp?.value || 0).toLocaleString()}</b>`
      },
    },
    grid: { left: '4%', right: '3%', bottom: useZoom ? '20%' : '14%', top: '8%', containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { rotate: 45, fontSize: 10, color: '#6B7280', interval: xInterval },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#6B7280', formatter: fmtK },
      splitLine: { lineStyle: { color: '#F1F5F9' } },
    },
    ...(useZoom ? { dataZoom: [
      { type: 'slider', bottom: 5, height: 18, start: Math.max(0, 100 - Math.round(20 / n * 100)), end: 100, borderColor: '#E2E8F0' },
      { type: 'inside' },
    ] } : {}),
    series: [
      {
        name: 'Impressions',
        type: 'line',
        data: impressions,
        smooth: true,
        symbol: 'circle',
        symbolSize: dotSize,
        lineStyle: { color: '#2563EB', width: 2 },
        itemStyle: { color: '#2563EB' },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(37,99,235,0.25)' }, { offset: 1, color: 'rgba(37,99,235,0.02)' }] } },
        label: { show: true, position: 'top', fontSize: 9, color: '#374151', formatter: (p) => (p.dataIndex % (xInterval + 1) === 0 && p.value > 0) ? p.value.toLocaleString() : '' },
      },
    ],
  }
})

const healthScoreBg = computed(() => {
  const score = auditData.value?.health_score
  if (score == null) return 'bg-gray-50'
  if (score >= 80) return 'bg-green-50'
  if (score >= 50) return 'bg-yellow-50'
  return 'bg-red-50'
})

const auditDonutOption = computed(() => {
  const d = auditData.value
  if (!d) return null
  const errors = d.urls_with_errors || 0
  const warnings = d.urls_with_warnings || 0
  const notices = d.urls_with_notices || 0
  const total = d.total || 0
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    series: [{
      type: 'pie',
      radius: ['50%', '75%'],
      center: ['50%', '50%'],
      avoidLabelOverlap: false,
      label: {
        show: true,
        position: 'center',
        formatter: `${formatNumber(total)}\nTotal URLs`,
        fontSize: 18,
        fontWeight: 'bold',
        color: '#374151',
      },
      emphasis: { label: { show: true, fontSize: 20, fontWeight: 'bold' } },
      data: [
        { value: errors, name: 'Errors', itemStyle: { color: '#EF4444' } },
        { value: warnings, name: 'Warnings', itemStyle: { color: '#F97316' } },
        { value: notices, name: 'Notices', itemStyle: { color: '#3B82F6' } },
      ],
    }],
  }
})

const auditIssuesTable = computed(() => {
  const d = auditData.value
  if (!d?.issues?.length) return []
  return d.issues.slice(0, 15)
})

// Keyword Rankings helpers
const keywordRankingsData = computed(() => metrics.keywordRankings?.value || [])

const keywordInsight = computed(() => {
  const kw = keywordRankingsData.value
  if (!kw?.length) return ''

  const top3 = kw.filter(k => k.position <= 3)
  const top10 = kw.filter(k => k.position <= 10)
  const top20 = kw.filter(k => k.position <= 20)
  const total = kw.length
  const avgPos = (kw.reduce((s, k) => s + k.position, 0) / total).toFixed(1)
  const topKeyword = kw[0]

  let posSentence = ''
  if (top10.length >= 5) posSentence = `📈 Strong keyword presence — ${top10.length} keywords ranking in the top 10.`
  else if (top10.length >= 2) posSentence = `⚠️ ${top10.length} keywords in top 10. Optimizing existing content could push more into top positions.`
  else posSentence = `📉 Only ${top10.length} keyword(s) in the top 10. Focus on improving rankings for high-impression keywords.`

  const topSentence = topKeyword ? `Top keyword: "${topKeyword.query}" at position #${topKeyword.position} with ${topKeyword.impressions.toLocaleString()} impressions.` : ''
  const avgSentence = `Average position across ${total} tracked keywords is ${avgPos}. ${top3.length > 0 ? `${top3.length} keyword(s) rank in top 3 (featured snippet zone).` : 'No keywords in top 3 yet.'}`
  const opportunitySentence = top20.length > top10.length ? `${top20.length - top10.length} keywords are on page 2 (positions 11–20) — these are closest to page 1 and worth targeting.` : ''

  return [posSentence, topSentence, avgSentence, opportunitySentence].filter(Boolean).join(' ')
})

function positionColor(pos) {
  if (pos <= 10) return '#22C55E'
  if (pos <= 20) return '#F59E0B'
  return '#EF4444'
}

function positionSeverity(pos) {
  if (pos <= 10) return 'success'
  if (pos <= 20) return 'warn'
  return 'danger'
}

// --- Technical SEO Health section ---
const techHealthWeeks = computed(() => {
  const weeks = metrics.backlinksHistory?.weeks || []
  const audit = metrics.siteAuditIssues
  const hs = audit?.health_score ?? metrics.siteHealth?.value?.health_score ?? 0
  const errs = audit?.urls_with_errors ?? 0
  const warns = audit?.urls_with_warnings ?? 0
  return weeks.slice(0, 10).map((w, i) => {
    // Format label as WEddMMyy from w.label (e.g. "2026-03-12" → "WE120326")
    const parts = w.label?.split('-')
    let fmtLabel = w.label
    if (parts?.length === 3) {
      fmtLabel = `WE${parts[2]}${parts[1]}${parts[0].slice(2)}`
    }
    return { week: fmtLabel, health_score: hs, errors: errs, warnings: warns, _isLatest: i === 0 }
  })
})

const techHealthDonutFirst = computed(() => {
  const score = metrics.siteAuditIssues?.first_crawl?.data?.health_score ?? null
  if (score === null) return null
  return {
    series: [{
      type: 'pie',
      radius: ['60%', '80%'],
      center: ['50%', '55%'],
      silent: true,
      label: { show: true, position: 'center', formatter: `${score}%`, fontSize: 22, fontWeight: 'bold', color: '#1E293B' },
      data: [
        { value: score, itemStyle: { color: '#10B981' } },
        { value: 100 - score, itemStyle: { color: '#D1FAE5' } },
      ],
    }],
  }
})

const techHealthDonutRecent = computed(() => {
  const audit = metrics.siteAuditIssues
  const score = audit?.health_score ?? metrics.siteHealth?.value?.health_score ?? 0
  return {
    series: [{
      type: 'pie',
      radius: ['60%', '80%'],
      center: ['50%', '55%'],
      silent: true,
      label: { show: true, position: 'center', formatter: `${score}%`, fontSize: 22, fontWeight: 'bold', color: '#1E293B' },
      data: [
        { value: score, itemStyle: { color: '#059669' } },
        { value: 100 - score, itemStyle: { color: '#D1FAE5' } },
      ],
    }],
  }
})

const techHealthFirstDate = computed(() => {
  const d = metrics.siteAuditIssues?.first_crawl?.data?.date
  if (!d) return null
  const dt = new Date(d)
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  const yy = String(dt.getFullYear()).slice(2)
  return `${mm}/${dd}/${yy}`
})

const techHealthDate = computed(() => {
  const d = metrics.siteAuditIssues?.date || new Date().toISOString().split('T')[0]
  const dt = new Date(d)
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  const yy = String(dt.getFullYear()).slice(2)
  return `${mm}/${dd}/${yy}`
})

const backlinksInsight = computed(() => {
  const bl = metrics.backlinks?.value
  const dr = metrics.domainRating?.value
  if (!bl && !dr) return ''

  const drVal = dr?.domain_rating ?? 0
  const live = bl?.live_backlinks ?? 0
  const refDomains = bl?.live_refdomains ?? 0
  const allTime = bl?.all_time_backlinks ?? 0

  let drSentence = ''
  if (drVal >= 40) drSentence = `📈 Domain Rating of ${drVal} is strong, indicating good authority in search engines.`
  else if (drVal >= 20) drSentence = `⚠️ Domain Rating of ${drVal} is moderate. Building more quality backlinks can help improve authority.`
  else drSentence = `📉 Domain Rating of ${drVal} is low. This site is still building its authority — focus on earning high-quality backlinks from reputable sources.`

  let backlinkSentence = ''
  if (live > 50) backlinkSentence = `The site has ${live} live backlinks from ${refDomains} referring domains — a solid backlink profile.`
  else if (live > 10) backlinkSentence = `With ${live} live backlinks from ${refDomains} referring domains, there is room to grow the backlink profile through content and outreach.`
  else backlinkSentence = `Only ${live} live backlinks from ${refDomains} referring domains detected. Prioritize link building to strengthen domain authority.`

  const lostLinks = allTime - live
  const lostSentence = lostLinks > 0 ? `${lostLinks} backlinks have been lost over time — consider reclaiming or replacing them.` : ''

  return [drSentence, backlinkSentence, lostSentence].filter(Boolean).join(' ')
})

// Mobile Usability pie chart
const mobileUsabilityPieOption = computed(() => {
  const d = metrics.gscMobile
  if (!d) return null
  const mobile = d.mobile?.clicks || 0
  const desktop = d.desktop?.clicks || 0
  const tablet = d.tablet?.clicks || 0
  const total = mobile + desktop + tablet
  if (!total) return null
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} clicks ({d}%)' },
    legend: { bottom: 0, textStyle: { color: '#6B7280' } },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['50%', '45%'],
      avoidLabelOverlap: false,
      label: { show: true, formatter: '{b}\n{d}%', fontSize: 11 },
      data: [
        { value: mobile, name: 'Mobile', itemStyle: { color: '#2563EB' } },
        { value: desktop, name: 'Desktop', itemStyle: { color: '#10B981' } },
        { value: tablet, name: 'Tablet', itemStyle: { color: '#8B5CF6' } },
      ]
    }]
  }
})

// Index Coverage pie chart
const indexCoveragePieOption = computed(() => {
  const d = metrics.gscCoverage
  if (!d) return null
  const indexed = d.pagesWithImpressions || 0
  const notVisible = Math.max(0, (d.indexedPages || 0) - indexed)
  if (!indexed && !notVisible) return null
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} pages ({d}%)' },
    legend: { bottom: 0, textStyle: { color: '#6B7280' } },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['50%', '45%'],
      label: { show: true, formatter: '{b}\n{d}%', fontSize: 11 },
      data: [
        { value: indexed, name: 'With Impressions', itemStyle: { color: '#0D9488' } },
        { value: notVisible, name: 'No Impressions', itemStyle: { color: '#D1D5DB' } },
      ]
    }]
  }
})

const techHealthInsight = computed(() => {
  const audit = metrics.siteAuditIssues
  const score = audit?.health_score ?? metrics.siteHealth?.value?.health_score ?? 0
  const errs = audit?.urls_with_errors ?? 0
  const warns = audit?.urls_with_warnings ?? 0
  let level = 'needs attention'
  if (score >= 90) level = 'excellent'
  else if (score >= 80) level = 'good'
  else if (score >= 70) level = 'fair'
  let text = `Your site health score is ${score}/100, which is ${level}.`
  text += ` There are currently ${errs} error${errs !== 1 ? 's' : ''} and ${warns} warning${warns !== 1 ? 's' : ''} detected.`
  if (score >= 90) text += ' Keep up the great work — continue monitoring for any new issues.'
  else if (score >= 80) text += ' Focus on resolving the remaining errors to push your score above 90.'
  else if (score >= 70) text += ' Prioritize fixing critical errors first, then address warnings to improve overall crawlability.'
  else text += ' Immediate action is recommended — start by resolving all critical errors to prevent indexing issues.'
  return text
})

function importanceSeverity(importance) {
  if (importance === 'error') return 'danger'
  if (importance === 'warning') return 'warn'
  return 'info'
}

// --- PDF Export ---
const exporting = ref(false)

function getDomain() {
  return ahrefsTarget.value || gscSiteUrl.value.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

function fmtDateRange() {
  const [s, e] = dateRange.value
  if (!s || !e) return ''
  return `${formatDate(s)} to ${formatDate(e)}`
}

function buildTableHtml(headers, rows) {
  let html = '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px">'
  html += '<thead><tr>'
  for (const h of headers) {
    html += `<th style="border:1px solid #E2E8F0;padding:6px 10px;background:#F1F5F9;text-align:left;font-weight:600">${h}</th>`
  }
  html += '</tr></thead><tbody>'
  for (let i = 0; i < rows.length; i++) {
    const bg = i % 2 === 0 ? '#fff' : '#F8FAFC'
    html += `<tr style="background:${bg}">`
    for (const cell of rows[i]) {
      html += `<td style="border:1px solid #E2E8F0;padding:5px 10px">${cell}</td>`
    }
    html += '</tr>'
  }
  html += '</tbody></table>'
  return html
}

// Chart refs for export
const chartTotalTraffic = ref(null)
const chartTrafficBySource = ref(null)
const chartTrafficUS = ref(null)
const chartWorldMap = ref(null)
const chartImpressions = ref(null)
const chartTechHealthFirst = ref(null)
const chartTechHealthRecent = ref(null)
const chartAuditDonut = ref(null)
const chartNewVsReturning = ref(null)
const chartTopLandingPagesBar = ref(null)
const chartAvgSessionLine = ref(null)
const chartBounceRateBar = ref(null)

// Capture chart as base64 image at fixed 700px height with all labels forced visible and large font
async function captureChartLarge(chartRef) {
  try {
    const vchart = chartRef.value
    if (!vchart) return null
    const el = vchart.$el
    if (!el) return null
    const origHeight = el.offsetHeight
    const exportHeight = 700

    // Resolve the underlying ECharts instance (vue-echarts v8 exposes it as .inst)
    const eInst = vchart.inst || vchart.chart || null

    const applyExportStyles = (inst) => {
      const opt = inst.getOption()
      const origSeries = opt.series?.length ? opt.series.map(s => ({ label: s.label })) : null
      const origXAxis = opt.xAxis?.length ? opt.xAxis.map(a => ({ axisLabel: a.axisLabel })) : null
      if (origSeries) {
        const palette = opt.color?.length ? opt.color : ['#5470c6','#91cc75','#fac858','#ee6666','#73c0de','#3ba272','#fc8452','#9a60b4','#ea7ccc']
        inst.setOption({ series: opt.series.map((s, i) => {
          const color = s.itemStyle?.color || s.lineStyle?.color || palette[i % palette.length]
          return { label: { show: true, fontSize: 10, fontWeight: 'normal', color } }
        }) })
      }
      if (origXAxis) {
        inst.setOption({ xAxis: opt.xAxis.map(() => ({ axisLabel: { fontSize: 12, fontWeight: 'bold' } })) })
      }
      return { origSeries, origXAxis }
    }
    const restoreStyles = (inst, { origSeries, origXAxis }) => {
      if (origSeries) inst.setOption({ series: origSeries })
      if (origXAxis) inst.setOption({ xAxis: origXAxis })
    }

    if (eInst && typeof eInst.getDataURL === 'function') {
      el.style.height = exportHeight + 'px'
      eInst.resize()
      await new Promise(r => setTimeout(r, 300))
      const saved = applyExportStyles(eInst)
      await new Promise(r => setTimeout(r, 150))
      const dataURL = eInst.getDataURL({ type: 'png', pixelRatio: 2 })
      restoreStyles(eInst, saved)
      el.style.height = origHeight + 'px'
      eInst.resize()
      return dataURL
    }

    // Fallback: component-level methods
    if (typeof vchart.getDataURL === 'function') {
      el.style.height = exportHeight + 'px'
      vchart.resize()
      await new Promise(r => setTimeout(r, 300))
      let saved = { origSeries: null, origXAxis: null }
      if (typeof vchart.getOption === 'function') {
        saved = applyExportStyles(vchart)
        await new Promise(r => setTimeout(r, 150))
      }
      const dataURL = vchart.getDataURL({ type: 'png', pixelRatio: 2 })
      restoreStyles(vchart, saved)
      el.style.height = origHeight + 'px'
      vchart.resize()
      return dataURL
    }

    // Last resort: html2canvas
    const { default: html2canvas } = await import('html2canvas')
    el.style.height = exportHeight + 'px'
    await new Promise(r => setTimeout(r, 300))
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false })
    el.style.height = origHeight + 'px'
    return canvas.toDataURL('image/png')
  } catch (e) { console.error('captureChartLarge error:', e); return null }
}

function exportReport() {
  exporting.value = true
  ;(async () => { try {
    const domain = getDomain()
    const range = fmtDateRange()

    // Capture charts as images (expanded height for label visibility)
    const imgTotalTraffic = await captureChartLarge(chartTotalTraffic)
    const imgTrafficBySource = await captureChartLarge(chartTrafficBySource)
    const imgTrafficUS = await captureChartLarge(chartTrafficUS)
    const imgWorldMap = await captureChartLarge(chartWorldMap)
    const imgImpressions = await captureChartLarge(chartImpressions)
    const imgTechHealthFirst = await captureChartLarge(chartTechHealthFirst)
    const imgTechHealthRecent = await captureChartLarge(chartTechHealthRecent)
    const imgAuditDonut = await captureChartLarge(chartAuditDonut)
    const imgNewVsReturning = await captureChartLarge(chartNewVsReturning)
    const imgTopLandingPagesBar = await captureChartLarge(chartTopLandingPagesBar)
    const imgAvgSessionLine = await captureChartLarge(chartAvgSessionLine)
    const imgBounceRateBar = await captureChartLarge(chartBounceRateBar)

    const insightBox = (text) => text
      ? `<div style="margin:8px 0 16px;padding:10px 12px;border-left:3px solid #0D9488;background:#f8fafc;font-size:11px;color:#000;font-style:italic;line-height:1.6">${text}</div>`
      : ''

    const chartImg = (src, caption) => src
      ? `<div style="margin:8px 0 16px"><img src="${src}" style="width:100%;border:1px solid #e2e8f0;border-radius:4px"/><p style="font-size:10px;color:#94a3b8;margin:2px 0 0;text-align:right">${caption}</p></div>`
      : ''

    const periodLabel = reportPeriod.value.charAt(0).toUpperCase() + reportPeriod.value.slice(1)
    const period = reportPeriod.value

    const tbl = (headers, rows) => {
      let h = headers.map(h => `<th style="background:#0D9488;color:#fff;padding:6px 10px;text-align:left;font-size:11px">${h}</th>`).join('')
      let r = rows.map((row, i) => {
        let cells = row.map(c => `<td style="padding:5px 10px;font-size:11px;border-bottom:1px solid #e2e8f0">${c ?? '—'}</td>`).join('')
        return `<tr style="background:${i%2===0?'#fff':'#f0fdfa'}">${cells}</tr>`
      }).join('')
      return `<table style="width:100%;border-collapse:collapse;margin-bottom:16px"><thead><tr>${h}</tr></thead><tbody>${r}</tbody></table>`
    }

    const sec = (num, title) => `<h2 style="color:#1E3A5F;font-size:17px;border-bottom:2px solid #0D9488;padding-bottom:5px;margin:24px 0 12px;page-break-before:always">${num}. ${title}</h2>`
    const sub = (title, source) => `<h3 style="color:#0D9488;font-size:13px;margin:12px 0 6px">${title} <span style="font-size:10px;color:#94a3b8">(${source})</span></h3>`

    // ── COVER PAGE ────────────────────────────────────────────────────────
    let body = `
      <div style="text-align:center;padding:40px 20px 30px;border-bottom:3px solid #0D9488;margin-bottom:30px">
        <h1 style="color:#0D9488;font-size:28px;margin:0 0 14px">SEO ${periodLabel} Report</h1>
        <p style="font-size:15px;color:#64748B;margin:0 0 8px">${range}</p>
        <p style="font-size:16px;color:#1E293B;margin:0;font-weight:600">Prepared for ${domain}</p>
      </div>
    `

    // ── AGENDA PAGE ───────────────────────────────────────────────────────
    const catsByFetched = fetchedMetricsByCategory.value
    const activeCategories = Object.keys(catsByFetched)

    if (activeCategories.length) {
      body += `<div style="page-break-before:always;padding:40px 0 30px">
        <h2 style="color:#0D9488;font-size:22px;border-bottom:2px solid #0D9488;padding-bottom:8px;margin-bottom:24px">Report Agenda</h2>
        <ol style="font-size:14px;color:#1E293B;line-height:2.4;margin:0;padding-left:20px">
          ${activeCategories.map((cat) => `<li style="margin-bottom:4px"><b>${cat}</b></li>`).join('')}
        </ol>
      </div>`
    }

    // ── DYNAMIC CATEGORY SECTIONS ─────────────────────────────────────────
    let sectionNum = 0

    for (const cat of activeCategories) {
      const codes = catsByFetched[cat]
      sectionNum++
      body += sec(sectionNum, cat)

      // ── TRAFFIC ──────────────────────────────────────────────────────────
      if (cat === 'Traffic Overview') {
        // TRAF01 Section 1: Traffic Over Time
        const ttv = metrics.totalTraffic?.value
        if (ttv?.daily?.length && codes.includes('TRAF01')) {
          body += sub('Traffic Over Time', 'Google Analytics')
          body += chartImg(imgTotalTraffic, 'Traffic Over Time')
          body += insightBox(trafficInsight.value)
          // Period-aggregated data (respects report period: daily/weekly/monthly/quarterly)
          const aggTraffic = aggregateByPeriod(ttv.daily, period)
          body += `<p style="font-size:11px;color:#64748b;margin-bottom:4px">${periodLabel} sessions for selected date range (${range}):</p>`
          body += tbl(
            [periodLabel === 'Daily' ? 'Date' : periodLabel === 'Weekly' ? 'Week' : periodLabel === 'Monthly' ? 'Month' : 'Quarter', 'Sessions'],
            aggTraffic.map(d => [makePeriodLabel(d.date, period), formatNumber(d.sessions)])
          )
        }

        // TRAF01 Section 2: Traffic by Source over time
        const tbsOT = metrics.trafficBySourceOverTime
        if (tbsOT?.dates?.length && codes.includes('TRAF01')) {
          body += sub('Traffic by Source', 'Google Analytics')
          body += chartImg(imgTrafficBySource, 'Traffic by Source')
          body += insightBox(trafficBySourceInsight.value)
          const otChannels = (tbsOT.channels || []).filter(ch => allowedSourceChannels.includes(ch))
          const aggSrc = aggregateSourcesOverTimeByPeriod(tbsOT.dates, tbsOT.series, period)
          body += `<p style="font-size:11px;color:#64748b;margin-bottom:4px">${periodLabel} sessions by channel for selected date range (${range}):</p>`
          body += tbl(
            [periodLabel === 'Daily' ? 'Date' : periodLabel === 'Weekly' ? 'Week' : periodLabel === 'Monthly' ? 'Month' : 'Quarter', ...otChannels, 'Total'],
            aggSrc.dates.map((d, i) => {
              const label = makeSourcePeriodLabel(d, period)
              const vals = otChannels.map(ch => (aggSrc.series[ch] || [])[i] || 0)
              const total = vals.reduce((a, b) => a + b, 0)
              return [label, ...vals.map(v => formatNumber(v)), formatNumber(total)]
            })
          )
        }

        // TRAF03: New vs Returning Visitors
        const nvr = metrics.newVsReturning?.value
        if (nvr?.length && codes.includes('TRAF03')) {
          body += sub('New vs Returning Visitors', 'Google Analytics')
          body += chartImg(imgNewVsReturning, 'New vs Returning Visitors')
          body += tbl(
            ['Visitor Type', 'Sessions', 'Engagement Rate', 'Bounce Rate'],
            nvr.map(r => [
              r.type === 'new' ? 'New Visitors' : r.type === 'returning' ? 'Returning Visitors' : r.type,
              formatNumber(r.sessions),
              r.engagementRate != null ? (r.engagementRate * 100).toFixed(1) + '%' : '—',
              r.bounceRate != null ? (r.bounceRate * 100).toFixed(1) + '%' : '—',
            ])
          )
        }

        // TRAF04: Traffic by Region
        const usv = metrics.trafficFromUS?.value
        if (usv && codes.includes('TRAF04')) {
          body += sub('Traffic by Region', 'Google Analytics')
          body += chartImg(imgWorldMap, 'Sessions by Country')
          body += `<p style="font-size:12px;margin-bottom:8px">Total Sessions: <b>${formatNumber(usv.totalSessions)}</b> &nbsp;|&nbsp; US Sessions: <b>${formatNumber(usv.usSessions)}</b> &nbsp;|&nbsp; US %: <b>${usv.percentage}%</b></p>`
          // Top countries table — truncate names to avoid crowding
          const countries = (usv.countries || []).slice(0, 30)
          if (countries.length) {
            body += `<p style="font-size:11px;color:#64748b;margin-bottom:4px">Top countries by sessions for selected date range (${range}):</p>`
            body += tbl(
              ['#', 'Country', 'Sessions', '% of Total'],
              countries.map((c, idx) => [
                idx + 1,
                c.country.length > 28 ? c.country.slice(0, 28) + '…' : c.country,
                formatNumber(c.sessions),
                usv.totalSessions > 0 ? ((c.sessions / usv.totalSessions) * 100).toFixed(1) + '%' : '—'
              ])
            )
          }
          // US by source over time
          const usOT = metrics.trafficUSBySourceOverTime
          if (usOT?.dates?.length) {
            body += chartImg(imgTrafficUS, 'US Traffic by Source')
            body += insightBox(usTrafficInsight.value)
            const usChannels = (usOT.channels || []).filter(ch => allowedSourceChannels.includes(ch))
            const aggUsSrc = aggregateSourcesOverTimeByPeriod(usOT.dates, usOT.series, period)
            body += `<p style="font-size:11px;color:#64748b;margin-bottom:4px">${periodLabel} US sessions by channel for selected date range (${range}):</p>`
            body += tbl(
              [periodLabel === 'Daily' ? 'Date' : periodLabel === 'Weekly' ? 'Week' : periodLabel === 'Monthly' ? 'Month' : 'Quarter', ...usChannels, 'Total'],
              aggUsSrc.dates.map((d, i) => {
                const label = makeSourcePeriodLabel(d, period)
                const vals = usChannels.map(ch => (aggUsSrc.series[ch] || [])[i] || 0)
                const total = vals.reduce((a, b) => a + b, 0)
                return [label, ...vals.map(v => formatNumber(v)), formatNumber(total)]
              })
            )
          }
        }

        // TRAF02: Top Landing Pages — bar chart + full table
        const drv = trafficDriversTable.value
        if (drv?.length && codes.includes('TRAF02')) {
          body += sub('Top Landing Pages (Organic)', 'Google Analytics')
          body += chartImg(imgTopLandingPagesBar, 'Top Landing Pages — This Week vs Last Week')
          body += `<p style="font-size:11px;color:#64748b;margin-bottom:4px">All pages — sessions for selected date range (${range}):</p>`
          body += tbl(
            ['Page', 'Last Period', 'This Period', 'WoW%'],
            drv.map(r => [
              r.pagePath.length > 50 ? r.pagePath.slice(0, 50) + '…' : r.pagePath,
              r.lastWeekSessions != null ? formatNumber(r.lastWeekSessions) : '—',
              formatNumber(r.sessions),
              r.wowGrowth != null ? r.wowGrowth + '%' : '—',
            ])
          )
        }

        // ENGA01: Average Session Duration — line chart + table
        if (drv?.length && codes.includes('ENGA01')) {
          body += sub('Average Session Duration', 'Google Analytics')
          body += chartImg(imgAvgSessionLine, 'Avg Session Duration by Page')
          body += tbl(
            ['Page', 'Avg Session Duration', 'Sessions'],
            drv.map(r => [
              r.pagePath.length > 50 ? r.pagePath.slice(0, 50) + '…' : r.pagePath,
              formatDuration(r.avgSessionDuration),
              formatNumber(r.sessions),
            ])
          )
        }

        // ENGA02: Bounce Rate — bar chart + table
        if (drv?.length && codes.includes('ENGA02')) {
          body += sub('Bounce Rate by Page', 'Google Analytics')
          body += chartImg(imgBounceRateBar, 'Bounce Rate by Page')
          body += tbl(
            ['Page', 'Bounce Rate', 'Sessions'],
            drv.map(r => [
              r.pagePath.length > 50 ? r.pagePath.slice(0, 50) + '…' : r.pagePath,
              r.bounceRate != null ? (r.bounceRate * 100).toFixed(1) + '%' : '—',
              formatNumber(r.sessions),
            ])
          )
        }

        // ENGA03: Pages per Session — table
        if (drv?.length && codes.includes('ENGA03')) {
          body += sub('Pages per Session', 'Google Analytics')
          const sortedByPps = [...drv].sort((a, b) => (b.pagesPerSession ?? 0) - (a.pagesPerSession ?? 0))
          body += tbl(
            ['Page', 'Pages/Session', 'Sessions', 'Engagement Rate'],
            sortedByPps.map(r => [
              r.pagePath.length > 50 ? r.pagePath.slice(0, 50) + '…' : r.pagePath,
              r.pagesPerSession != null ? r.pagesPerSession.toFixed(1) : '—',
              formatNumber(r.sessions),
              formatPercent(r.engagementRate),
            ])
          )
        }

        // TRAF01: Traffic Drivers Overview — combined engagement table
        const engaCodes = ['TRAF01']
        if (drv?.length && codes.some(c => engaCodes.includes(c))) {
          body += sub('Traffic Drivers Overview', 'Google Analytics')
          body += `<p style="font-size:11px;color:#64748b;margin-bottom:4px">All pages — full engagement data for selected date range (${range}):</p>`
          body += tbl(
            ['Page', 'Sessions', 'Avg Session', 'Engagement', 'Bounce Rate', 'Pages/Session'],
            drv.map(r => [
              r.pagePath.length > 45 ? r.pagePath.slice(0, 45) + '…' : r.pagePath,
              formatNumber(r.sessions),
              formatDuration(r.avgSessionDuration),
              formatPercent(r.engagementRate),
              r.bounceRate != null ? (r.bounceRate * 100).toFixed(1) + '%' : '—',
              r.pagesPerSession != null ? r.pagesPerSession.toFixed(1) : '—',
            ])
          )
          body += insightBox(trafficDriversInsight.value)
        }
      }

      // ── VISIBILITY ───────────────────────────────────────────────────────
      else if (cat === 'Visibility Metrics') {
        // VISI01/VISI02: Organic Impressions
        const imp = metrics.impressions?.value
        if (imp && codes.some(c => ['VISI01','VISI02'].includes(c))) {
          body += sub('Weekly Website Impressions', 'Google Search Console')
          body += `<p style="font-size:12px;margin-bottom:8px">Impressions: <b>${formatNumber(imp.impressions)}</b> &nbsp;|&nbsp; Clicks: <b>${formatNumber(imp.clicks)}</b> &nbsp;|&nbsp; CTR: <b>${imp.ctr}%</b></p>`
          body += chartImg(imgImpressions, `${periodLabel} Website Impressions`)
          body += insightBox(impressionsInsight.value)
          if (imp.daily?.length) {
            const aggImp = aggregateImpressionsByPeriod(imp.daily, period)
            const colLabel = periodLabel === 'Daily' ? 'Date' : periodLabel === 'Weekly' ? 'Week' : periodLabel === 'Monthly' ? 'Month' : 'Quarter'
            body += tbl([colLabel, 'Impressions', 'Clicks'], aggImp.map(w => [makeImpPeriodLabel(w.date, period), formatNumber(w.impressions), formatNumber(w.clicks)]))
          }
        }

        // VISI03: Keyword Rankings
        const kw = keywordRankingsData.value
        if (kw?.length && codes.includes('VISI03')) {
          body += sub('Keyword Rankings (Top 20)', 'Google Search Console')
          body += tbl(['Keyword','Position','Clicks','Impressions','CTR'], kw.slice(0,20).map(k => [k.query, '#'+k.position, formatNumber(k.clicks), formatNumber(k.impressions), k.ctr+'%']))
          if (keywordInsight.value) body += insightBox(keywordInsight.value)
        }

        // VISI04: Search Visibility Score (Domain Rating as visibility proxy)
        const drVisi = metrics.domainRating?.value
        if (drVisi && codes.includes('VISI04')) {
          body += sub('Search Visibility Score', 'Ahrefs')
          body += `<p style="font-size:12px;margin-bottom:8px">Domain Rating: <b>${drVisi.domain_rating ?? 0}/100</b> &nbsp;|&nbsp; Ahrefs Rank: <b>${formatNumber(drVisi.ahrefs_rank)}</b></p>`
          body += insightBox('The Domain Rating reflects overall site authority in search, which directly influences organic visibility and ranking potential.')
        }
      }

      // ── TECHNICAL HEALTH ─────────────────────────────────────────────────
      else if (cat === 'Technical Health Metrics') {
        // TECH02: Crawl Errors — GSC Index Coverage + Ahrefs Site Audit
        if (codes.includes('TECH02')) {
          const gscCov = metrics.gscCoverage
          if (gscCov) {
            body += sub('Index Coverage', 'Google Search Console')
            body += tbl(
              ['Metric','Value'],
              [
                ['Estimated Indexed Pages', formatNumber(gscCov.indexedPages)],
                ['Pages with Impressions', formatNumber(gscCov.pagesWithImpressions)],
                ['Total Impressions', formatNumber(gscCov.totalImpressions)],
              ]
            )
          }
          const audit = metrics.siteAuditIssues
          if (audit && !audit.error) {
            body += sub('Technical SEO Health', 'Ahrefs')
            body += tbl(
              ['Metric','Value'],
              [
                ['Health Score', (audit.health_score ?? '—') + (audit.health_score ? '/100' : '')],
                ['Errors', formatNumber(audit.urls_with_errors)],
                ['Warnings', formatNumber(audit.urls_with_warnings)],
                ['Notices', formatNumber(audit.urls_with_notices)],
                ['Total URLs Crawled', formatNumber(audit.total)],
              ]
            )
            if (imgTechHealthFirst || imgTechHealthRecent) {
              body += `<div style="display:flex;gap:16px;margin:8px 0 16px">`
              if (imgTechHealthFirst) body += `<div style="flex:1;text-align:center"><img src="${imgTechHealthFirst}" style="width:100%;border:1px solid #e2e8f0;border-radius:4px"/><p style="font-size:10px;color:#94a3b8;margin:2px 0 0">First Crawl</p></div>`
              if (imgTechHealthRecent) body += `<div style="flex:1;text-align:center"><img src="${imgTechHealthRecent}" style="width:100%;border:1px solid #e2e8f0;border-radius:4px"/><p style="font-size:10px;color:#94a3b8;margin:2px 0 0">Latest Crawl</p></div>`
              body += `</div>`
            }
            if (audit.issues?.length) {
              body += sub('Issues Breakdown', 'Ahrefs')
              body += chartImg(imgAuditDonut, 'Site Audit Issues Distribution')
              body += tbl(['Issue','Importance','Category','Crawled'], audit.issues.slice(0,15).map(i => [i.name, i.importance, i.category, formatNumber(i.crawled||0)]))
            }
            if (techHealthInsight.value) body += insightBox(techHealthInsight.value)
          }
        }

        // TECH03: Mobile Usability
        if (codes.includes('TECH03')) {
          const gscMob = metrics.gscMobile
          if (gscMob) {
            body += sub('Mobile Usability', 'Google Search Console')
            body += tbl(
              ['Device','Clicks','Impressions','CTR','% Share'],
              [
                ['Mobile', formatNumber(gscMob.mobile?.clicks||0), formatNumber(gscMob.mobile?.impressions||0), (gscMob.mobile?.ctr||0)+'%', gscMob.mobilePercent+'%'],
                ['Desktop', formatNumber(gscMob.desktop?.clicks||0), formatNumber(gscMob.desktop?.impressions||0), (gscMob.desktop?.ctr||0)+'%', (100 - gscMob.mobilePercent - (gscMob.tablet?.clicks ? 5 : 0)).toFixed(0)+'%'],
                ['Tablet', formatNumber(gscMob.tablet?.clicks||0), formatNumber(gscMob.tablet?.impressions||0), (gscMob.tablet?.ctr||0)+'%', '—'],
              ]
            )
          }
        }

        // TECH05: Structured Data Compliance
        if (codes.includes('TECH05')) {
          const gscSd = metrics.gscStructuredData
          if (gscSd) {
            body += sub('Structured Data & Search Types', 'Google Search Console')
            const sdStatus = (c, i) => c > 0 ? 'Active' : i > 0 ? 'Limited' : 'No Data'
            body += tbl(
              ['Search Type','Clicks','Impressions','CTR','Status'],
              [
                ['Web', formatNumber(gscSd.web?.clicks||0), formatNumber(gscSd.web?.impressions||0), (gscSd.web?.ctr||0)+'%', sdStatus(gscSd.web?.clicks||0, gscSd.web?.impressions||0)],
                ['Image', formatNumber(gscSd.image?.clicks||0), formatNumber(gscSd.image?.impressions||0), (gscSd.image?.ctr||0)+'%', sdStatus(gscSd.image?.clicks||0, gscSd.image?.impressions||0)],
                ['Video', formatNumber(gscSd.video?.clicks||0), formatNumber(gscSd.video?.impressions||0), (gscSd.video?.ctr||0)+'%', sdStatus(gscSd.video?.clicks||0, gscSd.video?.impressions||0)],
              ]
            )
          }
        }

        // TECH06: Index Management (impressions as index health indicator)
        if (codes.includes('TECH06')) {
          const impTech = metrics.impressions?.value
          if (impTech) {
            body += sub('Index Management', 'Google Search Console')
            body += `<p style="font-size:12px;margin-bottom:8px">Total Impressions: <b>${formatNumber(impTech.impressions)}</b> &nbsp;|&nbsp; Clicks: <b>${formatNumber(impTech.clicks)}</b> &nbsp;|&nbsp; Avg Position: <b>${impTech.avgPosition ?? '—'}</b></p>`
          }
        }
      }

      // ── AUTHORITY & OFF-PAGE ─────────────────────────────────────────────
      else if (cat === 'Authority & Off-Page') {
        // AUTH01: Domain Authority
        const dr = metrics.domainRating?.value
        if (dr && codes.includes('AUTH01')) {
          body += sub('Domain Authority', 'Ahrefs')
          body += `<p style="font-size:12px;margin-bottom:8px">Domain Rating: <b>${dr.domain_rating ?? 0}</b> &nbsp;|&nbsp; Ahrefs Rank: <b>${formatNumber(dr.ahrefs_rank)}</b></p>`
        }

        // AUTH02/AUTH03: Backlinks & Referring Domains
        const bl = metrics.backlinks?.value
        if (bl && codes.some(c => ['AUTH02','AUTH03'].includes(c))) {
          body += sub('Backlinks & Referring Domains', 'Ahrefs')
          body += tbl(
            ['Metric','Value'],
            [
              ['Live Backlinks', formatNumber(bl.live_backlinks)],
              ['Referring Domains', formatNumber(bl.live_refdomains)],
              ['All-time Backlinks', formatNumber(bl.all_time_backlinks)],
              ['All-time Ref Domains', formatNumber(bl.all_time_refdomains)],
            ]
          )
        }

        const blh = metrics.backlinksHistory?.value
        if (blh?.length && codes.some(c => ['AUTH02','AUTH03'].includes(c))) {
          body += sub('Backlinks History (Weekly)', 'Ahrefs')
          body += tbl(
            ['Week','Backlinks','Domain Rating','Change%'],
            blh.map(w => [w.label, formatNumber(w.backlinks), w.domain_rating ?? 0, w.change_pct != null ? w.change_pct+'%' : 'N/A'])
          )
        }
        if (backlinksInsight.value) body += insightBox(backlinksInsight.value)
      }

      // ── CONTENT ──────────────────────────────────────────────────────────
      else if (cat === 'Content') {
        // CONT02: Keyword Cannibalization (from site audit issues)
        if (codes.includes('CONT02')) {
          const audit = metrics.siteAuditIssues
          body += sub('Keyword Cannibalization', 'Ahrefs')
          if (audit && !audit.error && audit.issues?.length) {
            const cannibIssues = audit.issues.filter(i =>
              i.name?.toLowerCase().includes('duplicate') ||
              i.name?.toLowerCase().includes('canonical') ||
              i.name?.toLowerCase().includes('redirect')
            )
            if (cannibIssues.length) {
              body += tbl(['Issue','Severity','Category'], cannibIssues.map(i => [i.name, i.importance, i.category]))
            } else {
              body += `<p style="font-size:12px;color:#16a34a;margin-bottom:8px">✅ No duplicate content or cannibalization issues detected.</p>`
            }
          } else {
            body += `<p style="font-size:12px;color:#16a34a;margin-bottom:8px">✅ No duplicate content or cannibalization issues detected.</p>`
          }
        }
      }
    }

    // ── OVERLAY ───────────────────────────────────────────────────────────
    const existing = document.getElementById('seo-report-overlay')
    if (existing) existing.remove()

    const overlay = document.createElement('div')
    overlay.id = 'seo-report-overlay'
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#fff;z-index:99999;overflow-y:auto'

    const btnBar = `<div style="position:sticky;top:0;background:#fff;padding:10px 16px;border-bottom:1px solid #e2e8f0;display:flex;gap:8px;z-index:10">
      <button id="seo-print-btn" style="padding:8px 16px;background:#0D9488;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">🖨️ Print / Save PDF</button>
      <button id="seo-close-btn" style="padding:8px 16px;background:#64748B;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">✕ Close</button>
    </div>`

    overlay.innerHTML = btnBar + `<div id="seo-report-content" style="padding:20px;font-family:system-ui,sans-serif;font-size:12px;color:#000;max-width:900px;margin:0 auto">${body}</div>`
    document.body.appendChild(overlay)

    document.getElementById('seo-close-btn').addEventListener('click', () => {
      document.getElementById('seo-report-overlay')?.remove()
    })
    document.getElementById('seo-print-btn').addEventListener('click', () => {
      const content = document.getElementById('seo-report-content').innerHTML
      const win = window.open('', '_blank')
      if (win) {
        win.document.write(`<!DOCTYPE html><html><head><title>SEO ${periodLabel} Report</title>
          <style>body{font-family:system-ui,sans-serif;margin:20px;color:#000;font-size:12px}table{width:100%;border-collapse:collapse;margin-bottom:16px}@media print{body{margin:10px}}</style>
        </head><body>${content}</body></html>`)
        win.document.close()
        win.focus()
        setTimeout(() => win.print(), 500)
      }
    })
  } catch(e) { console.error('Export error:', e) } finally {
    exporting.value = false
  }})()
}
// AI Grader props
const aiGraderRef = ref(null)
const graderAutoRun = ref(false)

const graderSiteHealth = computed(() => {
  const d = metrics.siteAuditIssues
  return d?.health_score ?? metrics.siteHealth?.value?.health_score ?? 0
})

const graderDomainRating = computed(() => {
  const d = metrics.domainRating?.value
  return d?.domain_rating ? Math.round(d.domain_rating) : 0
})

const graderUsTrafficPercent = computed(() => {
  return metrics.trafficFromUS?.value?.percentage ?? 0
})

const graderImpressionsCtr = computed(() => {
  return metrics.impressions?.value?.ctr ?? 0
})

const graderTotalSessions = computed(() => {
  return metrics.totalTraffic?.value?.sessions ?? 0
})

const graderKeywordsInTop10 = computed(() => {
  const kw = metrics.keywordRankings?.value
  if (!Array.isArray(kw)) return 0
  return kw.filter((k) => k.position <= 10).length
})
</script>

<template>
  <div class="p-3 sm:p-6 space-y-6 bg-[#F8FAFC] dark:bg-[#0F172A] min-h-full">
    <!-- Header -->
    <div class="flex items-center">
      <h1 class="text-xl sm:text-2xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Dashboard</h1>
    </div>

    <!-- Data Sources -->
    <div
      v-motion
      :initial="{ opacity: 0, y: -20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400 } }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] !border-l-4 !border-l-[#EAB308] dark:!bg-[#1E293B]">
      <template #title>
        <div class="flex items-center gap-2 text-base font-semibold text-[#1E293B] dark:text-[#F1F5F9]">
          <i class="pi pi-cog text-[#64748B]" />
          Data Sources
        </div>
      </template>
      <template #content>
        <div class="flex flex-col gap-4 pb-8">
          <!-- Row 1: Source toggle pills -->
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-semibold text-[#64748B] dark:text-[#94A3B8] uppercase tracking-wider mr-1">Sources</span>
            <button
              type="button"
              class="source-toggle-pill"
              :class="activeSources.ga4 ? 'source-pill-active' : 'source-pill-inactive'"
              @click="toggleSource('ga4')"
            >
              <i class="pi pi-chart-bar text-xs" /> GA4
              <span v-if="selectedMetrics.ga4.length" class="source-pill-badge">{{ selectedMetrics.ga4.length }}</span>
            </button>
            <button
              type="button"
              class="source-toggle-pill"
              :class="activeSources.gsc ? 'source-pill-active' : 'source-pill-inactive'"
              @click="toggleSource('gsc')"
            >
              <i class="pi pi-search text-xs" /> GSC
              <span v-if="selectedMetrics.gsc.length" class="source-pill-badge">{{ selectedMetrics.gsc.length }}</span>
            </button>
            <button
              type="button"
              class="source-toggle-pill"
              :class="activeSources.ahrefs ? 'source-pill-active' : 'source-pill-inactive'"
              @click="toggleSource('ahrefs')"
            >
              <i class="pi pi-link text-xs" /> Ahrefs
              <span v-if="selectedMetrics.ahrefs.length" class="source-pill-badge">{{ selectedMetrics.ahrefs.length }}</span>
            </button>
          </div>

          <!-- Row 2: Metric checkboxes per active source -->
          <div v-if="activeSources.ga4 || activeSources.gsc || activeSources.ahrefs" class="flex flex-col gap-3">
            <!-- GA4 Metrics -->
            <div v-if="activeSources.ga4" class="metric-source-section">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-semibold text-[#0D9488] uppercase tracking-wider">GA4 Metrics</span>
                <span class="flex gap-3">
                  <button type="button" class="text-xs text-[#0D9488] hover:underline cursor-pointer font-medium" @click="selectAllMetrics('ga4')">Select All</button>
                  <button type="button" class="text-xs text-gray-400 hover:underline cursor-pointer" @click="clearMetrics('ga4')">Clear</button>
                </span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                <div
                  v-for="m in metricRegistry.ga4"
                  :key="m.code"
                  class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                  @click="toggleMetric('ga4', m.code)"
                >
                  <Checkbox :modelValue="selectedMetrics.ga4.includes(m.code)" :binary="true" @click.stop="toggleMetric('ga4', m.code)" class="!w-4 !h-4" />
                  <span class="text-[11px] font-mono text-gray-400 w-[52px]">{{ m.code }}</span>
                  <span class="text-sm text-gray-700 dark:text-gray-300">{{ m.label }}</span>
                </div>
              </div>
            </div>

            <!-- GSC Metrics -->
            <div v-if="activeSources.gsc" class="metric-source-section">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-semibold text-[#0D9488] uppercase tracking-wider">GSC Metrics</span>
                <span class="flex gap-3">
                  <button type="button" class="text-xs text-[#0D9488] hover:underline cursor-pointer font-medium" @click="selectAllMetrics('gsc')">Select All</button>
                  <button type="button" class="text-xs text-gray-400 hover:underline cursor-pointer" @click="clearMetrics('gsc')">Clear</button>
                </span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                <div
                  v-for="m in metricRegistry.gsc"
                  :key="m.code"
                  class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                  @click="toggleMetric('gsc', m.code)"
                >
                  <Checkbox :modelValue="selectedMetrics.gsc.includes(m.code)" :binary="true" @click.stop="toggleMetric('gsc', m.code)" class="!w-4 !h-4" />
                  <span class="text-[11px] font-mono text-gray-400 w-[52px]">{{ m.code }}</span>
                  <span class="text-sm text-gray-700 dark:text-gray-300">{{ m.label }}</span>
                </div>
              </div>
            </div>

            <!-- Ahrefs Metrics -->
            <div v-if="activeSources.ahrefs" class="metric-source-section">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-semibold text-[#0D9488] uppercase tracking-wider">Ahrefs Metrics</span>
                <span class="flex gap-3">
                  <button type="button" class="text-xs text-[#0D9488] hover:underline cursor-pointer font-medium" @click="selectAllMetrics('ahrefs')">Select All</button>
                  <button type="button" class="text-xs text-gray-400 hover:underline cursor-pointer" @click="clearMetrics('ahrefs')">Clear</button>
                </span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                <div
                  v-for="m in metricRegistry.ahrefs"
                  :key="m.code"
                  class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                  @click="toggleMetric('ahrefs', m.code)"
                >
                  <Checkbox :modelValue="selectedMetrics.ahrefs.includes(m.code)" :binary="true" @click.stop="toggleMetric('ahrefs', m.code)" class="!w-4 !h-4" />
                  <span class="text-[11px] font-mono text-gray-400 w-[52px]">{{ m.code }}</span>
                  <span class="text-sm text-gray-700 dark:text-gray-300">{{ m.label }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Row 3: Data source selectors + Report Period + Date Range + Buttons -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 items-end border-t border-[#E2E8F0] dark:border-[#334155] pt-4">
            <div v-if="activeSources.ga4" class="flex flex-col gap-1">
              <label class="text-sm font-medium text-[#64748B] dark:text-[#94A3B8]">GA4 Property</label>
              <Select
                v-model="ga4PropertyId"
                :options="ga4Options"
                optionLabel="label"
                optionValue="value"
                :loading="propertiesLoading"
                placeholder="Select GA4 property..."
                class="w-full"
                @change="(e) => onGA4Change(e.value)"
              />
            </div>
            <div v-if="activeSources.gsc" class="flex flex-col gap-1">
              <label class="text-sm font-medium text-[#64748B] dark:text-[#94A3B8]">GSC Site</label>
              <Select
                v-model="gscSiteUrl"
                :options="gscOptions"
                optionLabel="label"
                optionValue="value"
                :loading="propertiesLoading"
                placeholder="Select GSC site..."
                class="w-full"
              />
            </div>
            <div v-if="activeSources.ahrefs" class="flex flex-col gap-1">
              <label class="text-sm font-medium text-[#64748B] dark:text-[#94A3B8]">Ahrefs Target Domain</label>
              <Select
                v-model="selectedClient"
                :options="clientOptions"
                optionLabel="label"
                optionValue="value"
                placeholder="Select a client..."
                class="w-full"
                @change="(e) => onClientChange(e.value)"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-[#64748B] dark:text-[#94A3B8]">Report Period</label>
              <Select
                v-model="reportPeriod"
                :options="reportPeriodOptions"
                optionLabel="label"
                optionValue="value"
                class="w-full"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-[#64748B] dark:text-[#94A3B8]">Date Range</label>
              <DatePicker
                v-model="dateRange"
                selectionMode="range"
                dateFormat="yy-mm-dd"
                placeholder="Select date range"
                showIcon
                :manualInput="false"
                class="w-full"
              />
            </div>
            <div class="flex flex-col gap-2">
              <p v-if="fetchError" class="text-xs text-red-500 flex items-center gap-1">
                <i class="pi pi-exclamation-circle" /> {{ fetchError }}
              </p>
              <div class="flex items-end gap-2">
                <div v-motion :initial="{ scale: 1 }" :enter="{ scale: 1 }" :tapped="{ scale: 0.95 }" class="fetch-btn-wrap">
                  <Button
                    :label="totalSelectedMetricCount > 0 ? `Fetch (${totalSelectedMetricCount} metrics)` : 'Fetch'"
                    icon="pi pi-refresh"
                    :loading="refreshing"
                    :disabled="totalSelectedMetricCount === 0"
                    @click="loadMetrics"
                    severity="primary"
                    size="small"
                    :style="totalSelectedMetricCount === 0 ? 'opacity:0.5;cursor:not-allowed' : ''"
                  />
                </div>
                <Button
                  label="Export PDF"
                  icon="pi pi-file-pdf"
                  :loading="exporting"
                  @click="exportReport"
                  size="small"
                  style="background:#2563EB;border-color:#2563EB;color:#fff"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
    </Card>
    </div>

    <!-- AI SEO Grader -->
    <div
      v-motion
      :initial="{ opacity: 0, scale: 0.95 }"
      :enter="{ opacity: 1, scale: 1, transition: { duration: 500 } }"
    >
    <AiGrader
      ref="aiGraderRef"
      :siteHealth="graderSiteHealth"
      :domainRating="graderDomainRating"
      :usTrafficPercent="graderUsTrafficPercent"
      :impressionsCtr="graderImpressionsCtr"
      :totalSessions="graderTotalSessions"
      :keywordsInTop10="graderKeywordsInTop10"
      :autoRun="graderAutoRun"
    />
    </div>

    <!-- Empty state when nothing fetched yet -->
    <div v-if="fetchedMetrics.size === 0" class="text-center py-12 text-gray-400">
      <i class="pi pi-chart-bar text-4xl mb-3 block" />
      <p class="text-lg font-medium">No data loaded yet</p>
      <p class="text-sm">Select a data source and metrics above, then click Fetch</p>
    </div>

    <!-- ── Traffic Overview ── -->
    <div v-if="fetchedMetricsByCategory['Traffic Overview']" class="flex items-center gap-3 pt-2 pb-1">
      <h2 class="text-lg font-bold text-[#1E3A5F] dark:text-white tracking-tight">Traffic Overview</h2>
      <div class="flex-1 h-px bg-[#0D9488]/30"></div>
    </div>

    <!-- TRAF01: Organic Sessions (Traffic Over Time + By Source + Drivers Overview) -->
    <div
      v-if="ga4PropertyId && cardVisible.totalTraffic"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 300 } }"
      :hovered="{ y: -2, boxShadow: '0 8px 25px rgba(0,0,0,0.1)' }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
      <template #title>
        <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
          <i class="pi pi-chart-line text-[#0D9488]" />
          Organic Sessions
          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">TRAF01</span>
          <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Google Analytics</span>
        </div>
      </template>
      <template #content>

        <!-- Section 1: Traffic Over Time -->
        <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Traffic Over Time</h4>
        <div v-if="metrics.loading.totalTraffic">
          <Skeleton width="100%" height="280px" />
        </div>
        <div v-else-if="metrics.errors.totalTraffic" class="text-red-500 text-sm">{{ metrics.errors.totalTraffic }}</div>
        <div v-else-if="totalTrafficOption">
          <v-chart ref="chartTotalTraffic" :option="totalTrafficOption" autoresize style="height: 420px; width: 100%" />
          <p v-if="trafficInsight" class="text-xs text-gray-400 italic mt-2">{{ trafficInsight }}</p>
        </div>
        <div v-else class="text-gray-400 text-sm mb-4">No data</div>

        <!-- Divider -->
        <div class="border-t border-[#E2E8F0] dark:border-[#334155] my-6"></div>

        <!-- Section 2: Traffic by Source -->
        <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Traffic by Source</h4>
        <div v-if="metrics.loading.trafficBySourceOverTime">
          <Skeleton width="100%" height="300px" />
        </div>
        <div v-else-if="metrics.errors.trafficBySourceOverTime" class="text-red-500 text-sm">{{ metrics.errors.trafficBySourceOverTime }}</div>
        <div v-else-if="trafficBySourceOverTimeOption">
          <v-chart ref="chartTrafficBySource" :option="trafficBySourceOverTimeOption" autoresize style="height: 420px; width: 100%" />
          <p v-if="trafficBySourceInsight" class="text-xs text-gray-400 italic mt-2">{{ trafficBySourceInsight }}</p>
        </div>
        <div v-else class="text-gray-400 text-sm mb-4">No data</div>

        <!-- Divider -->
        <div class="border-t border-[#E2E8F0] dark:border-[#334155] my-6"></div>

        <!-- Section 3: Traffic Drivers Overview -->
        <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Traffic Drivers Overview</h4>
        <div v-if="metrics.loading.trafficDrivers">
          <Skeleton width="100%" height="200px" />
        </div>
        <div v-else-if="metrics.errors.trafficDrivers" class="text-red-500 text-sm">{{ metrics.errors.trafficDrivers }}</div>
        <div v-else-if="trafficDriversTable.length">
          <DataTable :value="trafficDriversTable.slice(0, 5)" stripedRows class="text-sm" tableStyle="min-width: 100%">
            <Column header="#" style="width: 40px">
              <template #body="{ index }"><span class="text-gray-500 text-xs">{{ index + 1 }}</span></template>
            </Column>
            <Column field="pagePath" header="Page" style="min-width: 180px">
              <template #body="{ data }">
                <span :title="data.pagePath" class="text-sm">{{ data.pagePath.length > 50 ? data.pagePath.slice(0, 50) + '...' : data.pagePath }}</span>
              </template>
            </Column>
            <Column field="sessions" header="Sessions" sortable style="width: 100px; text-align: right">
              <template #body="{ data }"><span class="font-medium">{{ formatNumber(data.sessions) }}</span></template>
            </Column>
            <Column field="wowGrowth" header="WoW%" sortable style="width: 90px; text-align: center">
              <template #body="{ data }">
                <span v-if="data.wowGrowth != null" :class="['text-xs font-bold px-2 py-0.5 rounded', Number(data.wowGrowth) >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700']">
                  {{ Number(data.wowGrowth) >= 0 ? '+' : '' }}{{ data.wowGrowth }}%
                </span>
                <span v-else class="text-gray-400">—</span>
              </template>
            </Column>
            <Column field="engagementRate" header="Engagement" sortable style="width: 110px; text-align: right">
              <template #body="{ data }"><span class="text-sm">{{ formatPercent(data.engagementRate) }}</span></template>
            </Column>
          </DataTable>
          <p v-if="trafficDriversInsight" class="text-xs text-gray-400 italic mt-3">{{ trafficDriversInsight }}</p>
        </div>
        <div v-else class="text-gray-400 text-sm">No data</div>

        <!-- Section 4: New vs Returning Visitors (TRAF03) -->
        <template v-if="cardVisible.newVsReturning">
          <div class="border-t border-[#E2E8F0] dark:border-[#334155] my-6"></div>
          <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">New vs Returning Visitors
            <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 border border-gray-200 dark:border-gray-600 ml-1">TRAF03</span>
          </h4>
          <div v-if="metrics.loading.newVsReturning">
            <Skeleton width="100%" height="260px" />
          </div>
          <div v-else-if="metrics.errors.newVsReturning" class="text-red-500 text-sm">{{ metrics.errors.newVsReturning }}</div>
          <div v-else-if="newVsReturningOption">
            <v-chart ref="chartNewVsReturning" :option="newVsReturningOption" autoresize style="height: 280px; width: 100%" />
            <!-- Summary stats -->
            <div class="grid grid-cols-2 gap-4 mt-4">
              <div v-for="r in (metrics.newVsReturning?.value || [])" :key="r.type"
                class="rounded-lg p-3 text-center"
                :style="{ backgroundColor: r.type === 'new' || r.type === 'New Visitor' ? '#F0FDFA' : '#EFF6FF' }">
                <div class="text-lg font-bold" :style="{ color: r.type === 'new' || r.type === 'New Visitor' ? '#0D9488' : '#2563EB' }">
                  {{ r.sessions.toLocaleString() }}
                </div>
                <div class="text-xs font-semibold text-gray-600 mt-0.5">
                  {{ r.type === 'new' || r.type === 'New Visitor' ? 'New Visitors' : 'Returning Visitors' }}
                </div>
                <div class="text-xs text-gray-400 mt-1">
                  Engagement: {{ (r.engagementRate * 100).toFixed(1) }}% &nbsp;|&nbsp; Bounce: {{ (r.bounceRate * 100).toFixed(1) }}%
                </div>
              </div>
            </div>
          </div>
          <div v-else class="text-gray-400 text-sm">No data</div>
        </template>

      </template>
    </Card>
    </div>

    <!-- TRAF04: Traffic by Region -->
    <div
      v-if="ga4PropertyId && cardVisible.trafficFromUS"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 400 } }"
      :hovered="{ y: -2, boxShadow: '0 8px 25px rgba(0,0,0,0.1)' }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
      <template #title>
        <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
          <i class="pi pi-globe text-[#0D9488]" />
          Traffic by Region
          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">TRAF04</span>
          <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Google Analytics</span>
        </div>
      </template>
      <template #content>
        <div v-if="metrics.loading.trafficFromUS">
          <Skeleton width="100%" height="400px" />
        </div>
        <div v-else-if="metrics.errors.trafficFromUS" class="text-red-500 text-sm">
          {{ metrics.errors.trafficFromUS }}
        </div>
        <div v-else-if="trafficFromUSOption">

          <!-- World Map -->
          <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Sessions by Country</h4>
          <v-chart ref="chartWorldMap" :option="trafficFromUSOption" autoresize style="height: 380px; width: 100%" />

          <!-- Divider -->
          <div class="border-t border-[#E2E8F0] dark:border-[#334155] my-6"></div>

          <!-- Top Countries Table -->
          <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Top Countries</h4>
          <DataTable
            :value="(metrics.trafficFromUS?.value?.countries || []).slice(0, 10)"
            stripedRows class="text-sm" tableStyle="min-width: 100%"
          >
            <Column header="#" style="width: 40px">
              <template #body="{ index }"><span class="text-gray-500 text-xs">{{ index + 1 }}</span></template>
            </Column>
            <Column field="country" header="Country" style="min-width: 160px">
              <template #body="{ data }"><span class="font-medium">{{ data.country }}</span></template>
            </Column>
            <Column field="sessions" header="Sessions" sortable style="width: 120px; text-align: right">
              <template #body="{ data }"><span class="font-semibold text-[#0D9488]">{{ formatNumber(data.sessions) }}</span></template>
            </Column>
            <Column header="% of Total" style="width: 120px; text-align: right">
              <template #body="{ data }">
                <span class="text-sm text-gray-600">
                  {{ metrics.trafficFromUS?.value?.totalSessions > 0 ? ((data.sessions / metrics.trafficFromUS.value.totalSessions) * 100).toFixed(1) + '%' : '—' }}
                </span>
              </template>
            </Column>
          </DataTable>

          <!-- Divider -->
          <div class="border-t border-[#E2E8F0] dark:border-[#334155] my-6"></div>

          <!-- US Traffic Breakdown -->
          <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">US Traffic Breakdown by Source</h4>
          <div v-if="metrics.loading.trafficUSBySourceOverTime">
            <Skeleton width="100%" height="300px" />
          </div>
          <div v-else-if="trafficUSBySourceOverTimeOption">
            <v-chart ref="chartTrafficUS" :option="trafficUSBySourceOverTimeOption" autoresize style="height: 400px; width: 100%" />
            <div v-if="usTrafficInsight" class="mt-3 rounded-lg p-3 flex items-start gap-3" style="background-color: #F0FDFA;">
              <span class="text-xl leading-none mt-0.5">💡</span>
              <p class="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{{ usTrafficInsight }}</p>
            </div>
          </div>
          <div v-else class="text-gray-400 text-sm">No US breakdown data</div>

        </div>
        <div v-else class="text-gray-400 text-sm">No data</div>
      </template>
    </Card>
    </div>

    <!-- TRAF02: Top Landing Pages -->
    <div
      v-if="ga4PropertyId && cardVisible.trafficDrivers"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 470 } }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
      <template #title>
        <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
          <i class="pi pi-list text-[#0D9488]" />
          Top Landing Pages (Organic)
          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">TRAF02</span>
          <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Google Analytics</span>
        </div>
      </template>
      <template #content>
        <div v-if="metrics.loading.trafficDrivers">
          <Skeleton width="100%" height="320px" />
        </div>
        <div v-else-if="metrics.errors.trafficDrivers" class="text-red-500 text-sm">
          {{ metrics.errors.trafficDrivers }}
        </div>
        <div v-else-if="trafficDriversTable.length">
          <div v-if="topLandingPagesBarOption" class="mb-5">
            <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Sessions by Page</h4>
            <v-chart ref="chartTopLandingPagesBar" :option="topLandingPagesBarOption" autoresize style="height: 280px; width: 100%" />
          </div>
          <DataTable
            :value="trafficDriversTable.slice(0, 10)"
            :paginator="true"
            :rows="10"
            stripedRows
            sortMode="single"
            removableSort
            class="mt-2 text-sm"
            tableStyle="min-width: 100%"
          >
            <Column header="#" style="width: 50px; text-align: center">
              <template #body="{ index }">
                <span class="text-gray-500 text-xs">{{ index + 1 }}</span>
              </template>
            </Column>
            <Column field="pagePath" header="Website Page" sortable style="min-width: 200px;">
              <template #body="{ data }">
                <span :title="data.pagePath" class="text-sm">{{ data.pagePath.length > 55 ? data.pagePath.slice(0, 55) + '...' : data.pagePath }}</span>
              </template>
            </Column>
            <Column field="lastWeekSessions" header="Last Week" sortable style="width: 110px; text-align: right">
              <template #body="{ data }">
                <span class="font-medium">{{ data.lastWeekSessions != null ? formatNumber(data.lastWeekSessions) : '—' }}</span>
              </template>
            </Column>
            <Column field="sessions" header="This Week" sortable style="width: 110px; text-align: right">
              <template #body="{ data }">
                <span class="font-medium">{{ formatNumber(data.sessions) }}</span>
              </template>
            </Column>
            <Column field="wowGrowth" header="WoW Growth" sortable style="width: 110px; text-align: center">
              <template #body="{ data }">
                <span v-if="data.wowGrowth != null" :class="['text-xs font-bold px-2 py-1 rounded', Number(data.wowGrowth) >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700']">
                  {{ Number(data.wowGrowth) >= 0 ? '+' : '' }}{{ data.wowGrowth }}%
                </span>
                <span v-else class="text-gray-400">—</span>
              </template>
            </Column>
            <Column field="avgSessionDuration" header="Avg Session" sortable style="width: 110px; text-align: right">
              <template #body="{ data }">
                <span class="text-sm">{{ formatDuration(data.avgSessionDuration) }}</span>
              </template>
            </Column>
            <Column field="engagementRate" header="Engagement" sortable style="width: 110px; text-align: right">
              <template #body="{ data }">
                <span class="text-sm">{{ formatPercent(data.engagementRate) }}</span>
              </template>
            </Column>
          </DataTable>
          <p v-if="trafficDriversInsight" class="text-xs text-gray-400 italic mt-3">{{ trafficDriversInsight }}</p>
        </div>
        <div v-else class="text-gray-400 text-sm">No data</div>
      </template>
    </Card>
    </div>

    <!-- ENGA01: Avg Session Duration -->
    <div
      v-if="ga4PropertyId && cardVisible.avgSessionDuration"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 490 } }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
      <template #title>
        <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
          <i class="pi pi-clock text-[#0D9488]" />
          Avg. Session Duration
          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">ENGA01</span>
          <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Google Analytics</span>
        </div>
      </template>
      <template #content>
        <div v-if="metrics.loading.trafficDrivers">
          <Skeleton width="100%" height="180px" />
        </div>
        <div v-else-if="avgSessionLineOption">
          <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Top Pages by Avg Session Duration</h4>
          <v-chart ref="chartAvgSessionLine" :option="avgSessionLineOption" autoresize style="height: 240px; width: 100%" />
        </div>
        <div v-else class="text-gray-400 text-sm">No data</div>
      </template>
    </Card>
    </div>

    <!-- ENGA02: Bounce Rate -->
    <div
      v-if="ga4PropertyId && cardVisible.bounceRate"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 510 } }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
      <template #title>
        <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
          <i class="pi pi-sign-out text-[#0D9488]" />
          Bounce Rate
          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">ENGA02</span>
          <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Google Analytics</span>
        </div>
      </template>
      <template #content>
        <div v-if="metrics.loading.trafficDrivers">
          <Skeleton width="100%" height="200px" />
        </div>
        <div v-else-if="bounceRateBarOption">
          <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Bounce Rate by Page</h4>
          <v-chart ref="chartBounceRateBar" :option="bounceRateBarOption" autoresize style="height: 220px; width: 100%" />
          <div class="flex gap-4 mt-2 text-xs">
            <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-green-500"></span> &lt;40% Good</span>
            <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-yellow-400"></span> 40–70% Average</span>
            <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-red-500"></span> &gt;70% High</span>
          </div>
        </div>
        <div v-else class="text-gray-400 text-sm">No data</div>
      </template>
    </Card>
    </div>

    <!-- ENGA03: Pages per Session -->
    <div
      v-if="ga4PropertyId && cardVisible.pagesPerSession"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 530 } }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
      <template #title>
        <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
          <i class="pi pi-file text-[#0D9488]" />
          Pages per Session
          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">ENGA03</span>
          <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Google Analytics</span>
        </div>
      </template>
      <template #content>
        <div v-if="metrics.loading.trafficDrivers">
          <Skeleton width="100%" height="200px" />
        </div>
        <div v-else-if="trafficDriversTable.length">
          <DataTable :value="[...trafficDriversTable].filter(r => r.pagesPerSession != null).sort((a,b) => b.pagesPerSession - a.pagesPerSession).slice(0,10)" stripedRows class="text-sm" tableStyle="min-width: 100%">
            <Column header="#" style="width: 40px">
              <template #body="{ index }"><span class="text-gray-500 text-xs">{{ index + 1 }}</span></template>
            </Column>
            <Column field="pagePath" header="Page" style="min-width: 200px">
              <template #body="{ data }">
                <span :title="data.pagePath" class="text-sm">{{ data.pagePath.length > 55 ? data.pagePath.slice(0, 55) + '...' : data.pagePath }}</span>
              </template>
            </Column>
            <Column field="pagesPerSession" header="Pages / Session" sortable style="width: 140px; text-align: right">
              <template #body="{ data }">
                <span class="font-semibold text-[#0D9488]">{{ data.pagesPerSession.toFixed(2) }}</span>
              </template>
            </Column>
            <Column field="sessions" header="Sessions" sortable style="width: 100px; text-align: right">
              <template #body="{ data }"><span class="font-medium">{{ formatNumber(data.sessions) }}</span></template>
            </Column>
            <Column field="engagementRate" header="Engagement" sortable style="width: 110px; text-align: right">
              <template #body="{ data }"><span class="text-sm">{{ formatPercent(data.engagementRate) }}</span></template>
            </Column>
          </DataTable>
        </div>
        <div v-else class="text-gray-400 text-sm">No data</div>
      </template>
    </Card>
    </div>

    <!-- ── Visibility Metrics ── -->
    <div v-if="fetchedMetricsByCategory['Visibility Metrics']" class="flex items-center gap-3 pt-2 pb-1">
      <h2 class="text-lg font-bold text-[#1E3A5F] dark:text-white tracking-tight">Visibility Metrics</h2>
      <div class="flex-1 h-px bg-[#0D9488]/30"></div>
    </div>

    <!-- VISI01: Indexed Pages -->
    <div
      v-if="gscSiteUrl && cardVisible.indexedPages"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 100 } }"
      :hovered="{ y: -2, boxShadow: '0 8px 25px rgba(0,0,0,0.1)' }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
        <template #title>
          <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
            <i class="pi pi-server text-[#0D9488]" />
            Indexed Pages
            <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">VISI01</span>
            <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Google Search Console</span>
          </div>
        </template>
        <template #content>
          <div v-if="metrics.loading.impressions">
            <Skeleton width="100%" height="120px" />
          </div>
          <div v-else-if="metrics.errors.impressions" class="text-red-500 text-sm">
            {{ metrics.errors.impressions }}
          </div>
          <div v-else-if="metrics.impressions">
            <div class="bg-teal-50 dark:bg-teal-900/20 rounded-lg p-6 text-center">
              <div class="text-5xl font-bold text-[#0D9488] mb-2">{{ formatNumber(metrics.impressions.value.impressions) }}</div>
              <div class="text-sm font-semibold text-gray-600 dark:text-gray-300">Est. Indexed Pages</div>
              <div class="text-xs text-gray-400 mt-1">Pages currently receiving search impressions</div>
            </div>
            <div class="flex justify-center gap-6 mt-4 text-sm">
              <div class="text-center"><div class="font-bold text-blue-700">{{ formatNumber(metrics.impressions.value.clicks) }}</div><div class="text-xs text-gray-400">Total Clicks</div></div>
              <div class="text-center"><div class="font-bold text-purple-700">{{ metrics.impressions.value.ctr }}%</div><div class="text-xs text-gray-400">CTR</div></div>
              <div class="text-center"><div class="font-bold text-gray-700">{{ metrics.impressions.value.avgPosition ?? '—' }}</div><div class="text-xs text-gray-400">Avg Position</div></div>
            </div>
          </div>
          <div v-else class="text-gray-400 text-sm">No data</div>
        </template>
    </Card>
    </div>

    <!-- VISI02: Organic Impressions -->
    <div
      v-if="gscSiteUrl && cardVisible.impressions"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 120 } }"
      :hovered="{ y: -2, boxShadow: '0 8px 25px rgba(0,0,0,0.1)' }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
        <template #title>
          <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
            <i class="pi pi-eye text-[#0D9488]" />
            Organic Impressions
            <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">VISI02</span>
            <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Google Search Console</span>
          </div>
        </template>
        <template #content>
          <div v-if="metrics.loading.impressions">
            <Skeleton width="100%" height="220px" />
          </div>
          <div v-else-if="metrics.errors.impressions" class="text-red-500 text-sm">
            {{ metrics.errors.impressions }}
          </div>
          <div v-else-if="metrics.impressions">
            <div class="flex gap-3 mb-2 text-xs">
              <span class="font-semibold text-blue-700">{{ formatNumber(metrics.impressions.value.impressions) }} Imp</span>
              <span class="font-semibold text-green-700">{{ formatNumber(metrics.impressions.value.clicks) }} Clicks</span>
              <span class="font-semibold text-purple-700">{{ metrics.impressions.value.ctr }}% CTR</span>
            </div>
            <v-chart
              ref="chartImpressions"
              v-if="metrics.impressions.value.daily?.length"
              :option="impressionsChartOption"
              style="height: 500px; width: 100%"
              autoresize
            />
            <div v-else class="text-gray-400 text-sm text-center py-8">No daily data</div>
            <p v-if="impressionsInsight" class="text-xs text-gray-400 italic mt-3">{{ impressionsInsight }}</p>
          </div>
          <div v-else class="text-gray-400 text-sm">No data</div>
        </template>
    </Card>
    </div>

    <!-- TECH06: Index Management -->
    <div
      v-if="gscSiteUrl && cardVisible.indexManagement"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 140 } }"
      :hovered="{ y: -2, boxShadow: '0 8px 25px rgba(0,0,0,0.1)' }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
        <template #title>
          <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
            <i class="pi pi-sitemap text-[#0D9488]" />
            Index Management
            <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">TECH06</span>
            <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Google Search Console</span>
          </div>
        </template>
        <template #content>
          <div v-if="metrics.loading.impressions">
            <Skeleton width="100%" height="260px" />
          </div>
          <div v-else-if="metrics.impressions">
            <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Page Visibility Breakdown</h4>
            <div v-if="indexManagementPieOption">
              <v-chart :option="indexManagementPieOption" autoresize style="height: 260px; width: 100%" />
            </div>
            <div v-else class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-center">
              <div class="text-2xl font-bold text-[#0D9488]">Est. Indexed: {{ formatNumber(metrics.impressions.value.impressions) }} pages</div>
              <div class="text-xs text-gray-400 mt-1">Based on GSC impressions</div>
            </div>
          </div>
          <div v-else class="text-gray-400 text-sm">No data</div>
        </template>
    </Card>
    </div>

    <!-- Keyword Rankings (Full Width) -->
    <div
      v-if="gscSiteUrl && cardVisible.keywordRankings"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 200 } }"
      :hovered="{ y: -2, boxShadow: '0 8px 25px rgba(0,0,0,0.1)' }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
      <template #title>
        <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
          <i class="pi pi-search text-[#0D9488]" />
          Keyword Rankings
          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">VISI03</span>
          <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Google Search Console</span>
        </div>
      </template>
      <template #content>
        <div v-if="metrics.loading.keywordRankings">
          <Skeleton width="100%" height="400px" />
        </div>
        <div v-else-if="metrics.errors.keywordRankings" class="text-red-500 text-sm">
          {{ metrics.errors.keywordRankings }}
        </div>
        <div v-else-if="keywordRankingsData.length">
          <DataTable
            :value="keywordRankingsData"
            :paginator="true"
            :rows="10"
            stripedRows
            sortMode="single"
            removableSort
            class="mt-4 text-sm"
            tableStyle="min-width: 100%"
          >
            <Column field="query" header="Keyword" sortable style="min-width: 250px; max-width: 400px; word-break: break-word;" />
            <Column field="clicks" header="Clicks" sortable style="width: 100px; text-align: right">
              <template #body="{ data }">
                <span class="font-medium">{{ formatNumber(data.clicks) }}</span>
              </template>
            </Column>
            <Column field="impressions" header="Impressions" sortable style="width: 120px; text-align: right">
              <template #body="{ data }">
                <span class="font-medium">{{ formatNumber(data.impressions) }}</span>
              </template>
            </Column>
            <Column field="ctr" header="CTR" sortable style="width: 90px; text-align: right">
              <template #body="{ data }">
                <span class="font-medium">{{ data.ctr }}%</span>
              </template>
            </Column>
            <Column field="position" header="Avg Position" sortable style="width: 130px; text-align: center">
              <template #body="{ data }">
                <span :class="['inline-block px-2 py-1 rounded text-white text-xs font-bold', data.position <= 10 ? 'bg-green-500' : data.position <= 20 ? 'bg-yellow-500' : 'bg-red-500']">
                  #{{ data.position }}
                </span>
              </template>
            </Column>
            <Column header="Trend" style="width: 100px; text-align: center">
              <template #header>
                <span class="flex items-center gap-1">
                  Trend
                  <i class="pi pi-info-circle text-xs text-gray-400 cursor-help" title="Historical comparison coming soon" />
                </span>
              </template>
              <template #body>
                <span class="text-gray-400 text-xs">N/A</span>
              </template>
            </Column>
          </DataTable>
          <p v-if="keywordInsight" class="text-xs text-gray-400 italic mt-3">{{ keywordInsight }}</p>
        </div>
        <div v-else class="text-gray-400 text-sm">No keyword data</div>
      </template>
    </Card>
    </div>

    <!-- VISI04: Search Visibility Score -->
    <div
      v-if="ahrefsTarget && cardVisible.searchVisibility"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 220 } }"
      :hovered="{ y: -2, boxShadow: '0 8px 25px rgba(0,0,0,0.1)' }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
      <template #title>
        <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
          <i class="pi pi-chart-pie text-[#0D9488]" />
          Search Visibility Score
          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">VISI04</span>
          <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Ahrefs</span>
        </div>
      </template>
      <template #content>
        <div v-if="metrics.loading.domainRating">
          <Skeleton width="100%" height="120px" />
        </div>
        <div v-else-if="metrics.domainRating?.value">
          <div class="flex items-center gap-8 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <div class="text-center">
              <div class="text-5xl font-extrabold text-blue-700">{{ drScoreValue ?? '—' }}</div>
              <div class="text-xs text-gray-500 mt-1 font-semibold uppercase tracking-wide">/ 100</div>
            </div>
            <div>
              <div class="font-semibold text-sm text-gray-700 dark:text-gray-300">Domain Rating (Visibility Proxy)</div>
              <div class="text-xs text-gray-400 mt-1">A higher Domain Rating indicates greater organic search visibility and authority.</div>
              <div class="text-xs text-gray-500 dark:text-gray-400 mt-2">Ahrefs Rank: #{{ formatNumber(metrics.domainRating?.value?.ahrefs_rank) }}</div>
            </div>
          </div>
        </div>
        <div v-else class="text-gray-400 text-sm">No data</div>
      </template>
    </Card>
    </div>

    <!-- ── Technical Health Metrics ── -->
    <div v-if="fetchedMetricsByCategory['Technical Health Metrics']" class="flex items-center gap-3 pt-2 pb-1">
      <h2 class="text-lg font-bold text-[#1E3A5F] dark:text-white tracking-tight">Technical Health Metrics</h2>
      <div class="flex-1 h-px bg-[#0D9488]/30"></div>
    </div>

    <!-- Mobile Usability (TECH03) -->
    <div
      v-if="gscSiteUrl && cardVisible.gscMobile"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 150 } }"
      :hovered="{ y: -2, boxShadow: '0 8px 25px rgba(0,0,0,0.1)' }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
        <template #title>
          <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
            <i class="pi pi-mobile text-[#0D9488]" />
            Mobile Usability
            <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">TECH03</span>
            <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Google Search Console</span>
          </div>
        </template>
        <template #content>
          <div v-if="metrics.loading.gscMobile">
            <Skeleton width="100%" height="220px" />
          </div>
          <div v-else-if="metrics.errors.gscMobile" class="text-red-500 text-sm">
            {{ metrics.errors.gscMobile }}
          </div>
          <div v-else-if="metrics.gscMobile" class="space-y-2">
            <v-chart v-if="mobileUsabilityPieOption" :option="mobileUsabilityPieOption" autoresize style="height: 260px; width: 100%" />
            <div v-else class="grid grid-cols-3 gap-3 text-center text-sm">
              <div><div class="text-xl font-bold text-blue-600">{{ metrics.gscMobile.mobilePercent }}%</div><div class="text-xs text-gray-400">Mobile</div></div>
              <div><div class="text-xl font-bold text-green-600">{{ formatNumber(metrics.gscMobile.desktop.clicks) }}</div><div class="text-xs text-gray-400">Desktop clicks</div></div>
              <div><div class="text-xl font-bold text-purple-600">{{ formatNumber(metrics.gscMobile.tablet.clicks) }}</div><div class="text-xs text-gray-400">Tablet clicks</div></div>
            </div>
          </div>
          <div v-else class="text-gray-400 text-sm">No data</div>
        </template>
    </Card>
    </div>

    <!-- Index Coverage (TECH02) -->
    <div
      v-if="gscSiteUrl && cardVisible.gscCoverage"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 200 } }"
      :hovered="{ y: -2, boxShadow: '0 8px 25px rgba(0,0,0,0.1)' }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
        <template #title>
          <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
            <i class="pi pi-database text-[#0D9488]" />
            Index Coverage
            <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">TECH02</span>
            <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Google Search Console</span>
          </div>
        </template>
        <template #content>
          <div v-if="metrics.loading.gscCoverage">
            <Skeleton width="100%" height="120px" />
          </div>
          <div v-else-if="metrics.errors.gscCoverage" class="text-red-500 text-sm">
            {{ metrics.errors.gscCoverage }}
          </div>
          <div v-else-if="metrics.gscCoverage" class="space-y-2">
            <v-chart v-if="indexCoveragePieOption" :option="indexCoveragePieOption" autoresize style="height: 260px; width: 100%" />
            <div class="flex justify-center gap-6 text-sm mt-1">
              <div class="text-center"><div class="text-xl font-bold text-teal-600">{{ formatNumber(metrics.gscCoverage.indexedPages) }}</div><div class="text-xs text-gray-400">Total Indexed</div></div>
              <div class="text-center"><div class="text-xl font-bold text-blue-600">{{ formatNumber(metrics.gscCoverage.pagesWithImpressions) }}</div><div class="text-xs text-gray-400">With Impressions</div></div>
              <div class="text-center"><div class="text-xl font-bold text-indigo-600">{{ formatNumber(metrics.gscCoverage.totalImpressions) }}</div><div class="text-xs text-gray-400">Total Impressions</div></div>
            </div>
          </div>
          <div v-else class="text-gray-400 text-sm">No data</div>
        </template>
    </Card>
    </div>

    <!-- Structured Data & Search Types (TECH05) -->
    <div
      v-if="gscSiteUrl && cardVisible.gscStructuredData"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 250 } }"
      :hovered="{ y: -2, boxShadow: '0 8px 25px rgba(0,0,0,0.1)' }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
        <template #title>
          <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
            <i class="pi pi-code text-[#0D9488]" />
            Structured Data &amp; Search Types
            <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">TECH05</span>
            <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Google Search Console</span>
          </div>
        </template>
        <template #content>
          <div v-if="metrics.loading.gscStructuredData">
            <Skeleton width="100%" height="120px" />
          </div>
          <div v-else-if="metrics.errors.gscStructuredData" class="text-red-500 text-sm">
            {{ metrics.errors.gscStructuredData }}
          </div>
          <div v-else-if="metrics.gscStructuredData" class="space-y-4">
            <div class="grid grid-cols-3 gap-4">
              <div class="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 text-center">
                <div class="text-xs text-gray-500 dark:text-gray-400 mb-1">Web Search</div>
                <div class="text-2xl font-bold text-blue-600">{{ formatNumber(metrics.gscStructuredData.web.clicks) }}</div>
                <div class="text-xs text-gray-400">clicks</div>
                <div class="text-sm text-gray-500 mt-1">{{ formatNumber(metrics.gscStructuredData.web.impressions) }} imp</div>
              </div>
              <div class="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4 text-center">
                <div class="text-xs text-gray-500 dark:text-gray-400 mb-1">Image Search</div>
                <div class="text-2xl font-bold text-orange-600">{{ formatNumber(metrics.gscStructuredData.image.clicks) }}</div>
                <div class="text-xs text-gray-400">clicks</div>
                <div class="text-sm text-gray-500 mt-1">{{ formatNumber(metrics.gscStructuredData.image.impressions) }} imp</div>
              </div>
              <div class="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 text-center">
                <div class="text-xs text-gray-500 dark:text-gray-400 mb-1">Video Search</div>
                <div class="text-2xl font-bold text-red-600">{{ formatNumber(metrics.gscStructuredData.video.clicks) }}</div>
                <div class="text-xs text-gray-400">clicks</div>
                <div class="text-sm text-gray-500 mt-1">{{ formatNumber(metrics.gscStructuredData.video.impressions) }} imp</div>
              </div>
            </div>
            <!-- TECH05 - Structured Data Table -->
            <div v-if="fetchedMetrics.has('TECH05') && structuredDataTableRows.length">
              <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4">Search Type Performance</h4>
              <DataTable :value="structuredDataTableRows" stripedRows size="small" class="text-sm">
                <Column field="searchType" header="Search Type" style="width: 140px" />
                <Column field="clicks" header="Clicks" sortable style="width: 100px; text-align: right">
                  <template #body="{ data }"><span class="font-medium">{{ formatNumber(data.clicks) }}</span></template>
                </Column>
                <Column field="impressions" header="Impressions" sortable style="width: 120px; text-align: right">
                  <template #body="{ data }"><span class="font-medium">{{ formatNumber(data.impressions) }}</span></template>
                </Column>
                <Column field="ctr" header="CTR" style="width: 80px; text-align: right" />
                <Column field="status" header="Status" style="width: 100px; text-align: center">
                  <template #body="{ data }">
                    <span :class="['text-xs font-bold px-2 py-1 rounded-full', data.status === 'Active' ? 'bg-green-100 text-green-700' : data.status === 'Limited' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500']">{{ data.status }}</span>
                  </template>
                </Column>
              </DataTable>
            </div>
          </div>
          <div v-else class="text-gray-400 text-sm">No data</div>
        </template>
    </Card>
    </div>

    <!-- ── Authority & Off-Page ── -->
    <div v-if="fetchedMetricsByCategory['Authority & Off-Page']" class="flex items-center gap-3 pt-2 pb-1">
      <h2 class="text-lg font-bold text-[#1E3A5F] dark:text-white tracking-tight">Authority & Off-Page</h2>
      <div class="flex-1 h-px bg-[#0D9488]/30"></div>
    </div>

    <!-- AUTH01: Domain Authority -->
    <div
      v-if="ahrefsTarget && cardVisible.domainAuthority"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 250 } }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
      <template #title>
        <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
          <i class="pi pi-star text-[#0D9488]" />
          Domain Authority
          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">AUTH01</span>
          <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Ahrefs</span>
        </div>
      </template>
      <template #content>
        <div v-if="metrics.loading.domainRating">
          <Skeleton width="100%" height="140px" />
        </div>
        <div v-else-if="drScoreValue != null" class="flex items-center gap-6 p-4 rounded-lg border" :class="drScoreValue >= 40 ? 'bg-green-50 border-green-200 dark:bg-green-950/30' : drScoreValue >= 20 ? 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30' : 'bg-red-50 border-red-200 dark:bg-red-950/30'">
          <div class="text-center min-w-[80px]">
            <div class="text-6xl font-extrabold leading-none" :style="{ color: drScoreColor }">{{ drScoreValue }}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-1 font-semibold uppercase tracking-wide">/ 100</div>
          </div>
          <div class="flex-1">
            <div class="font-semibold text-sm text-gray-700 dark:text-gray-300">Domain Rating (DR)</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Ahrefs Rank: #{{ formatNumber(metrics.domainRating?.value?.ahrefs_rank) }}</div>
            <div class="mt-2 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden w-full max-w-[200px]">
              <div class="h-full rounded-full transition-all duration-500" :class="drScoreValue >= 40 ? 'bg-green-500' : drScoreValue >= 20 ? 'bg-yellow-500' : 'bg-red-500'" :style="{ width: drScoreValue + '%' }" />
            </div>
            <div class="flex gap-2 mt-2">
              <span class="text-xs px-2 py-0.5 rounded-full font-medium" :class="drScoreValue >= 40 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'">≥40 Strong</span>
              <span class="text-xs px-2 py-0.5 rounded-full font-medium" :class="drScoreValue >= 20 && drScoreValue < 40 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-400'">20–39 Moderate</span>
              <span class="text-xs px-2 py-0.5 rounded-full font-medium" :class="drScoreValue < 20 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-400'">&lt;20 Low</span>
            </div>
          </div>
        </div>
        <div v-else class="text-gray-400 text-sm">No data</div>
      </template>
    </Card>
    </div>

    <!-- AUTH02: Referring Domains -->
    <div
      v-if="ahrefsTarget && cardVisible.referringDomains"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 270 } }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
      <template #title>
        <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
          <i class="pi pi-globe text-[#0D9488]" />
          Referring Domains
          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">AUTH02</span>
          <span v-if="isBacklinksDummy" class="text-xs text-amber-500 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded-full border border-amber-300">Sample Data</span>
          <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Ahrefs</span>
        </div>
      </template>
      <template #content>
        <div v-if="metrics.loading.backlinks">
          <Skeleton width="100%" height="120px" />
        </div>
        <div v-else>
          <div class="grid grid-cols-2 gap-4">
            <div class="bg-teal-50 dark:bg-teal-950 rounded-lg p-4 text-center border-t-2 border-teal-400">
              <div class="text-3xl font-bold text-teal-600">{{ formatNumber(displayBacklinks.live_refdomains) }}</div>
              <div class="text-sm text-teal-400 mt-1">Live Referring Domains</div>
            </div>
            <div class="bg-teal-50 dark:bg-teal-950 rounded-lg p-4 text-center border-t-2 border-teal-400">
              <div class="text-3xl font-bold text-teal-600">{{ formatNumber(displayBacklinks.all_time_refdomains) }}</div>
              <div class="text-sm text-teal-400 mt-1">All-time Ref Domains</div>
            </div>
          </div>
        </div>
      </template>
    </Card>
    </div>

    <!-- AUTH03: Backlink Quality -->
    <div
      v-if="ahrefsTarget && cardVisible.backlinkQuality"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 290 } }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
      <template #title>
        <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
          <i class="pi pi-link text-[#0D9488]" />
          Backlink Quality
          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">AUTH03</span>
          <span v-if="isBacklinksDummy" class="text-xs text-amber-500 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded-full border border-amber-300">Sample Data</span>
          <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Ahrefs</span>
        </div>
      </template>
      <template #content>
        <div v-if="metrics.loading.backlinks || metrics.loading.backlinksHistory">
          <div class="grid grid-cols-2 gap-4 mb-6">
            <Skeleton v-for="i in 2" :key="i" width="100%" height="80px" />
          </div>
          <Skeleton width="100%" height="200px" />
        </div>
        <div v-else>
          <div class="grid grid-cols-2 gap-4 mb-6">
            <div class="bg-teal-50 dark:bg-teal-950 rounded-lg p-4 text-center border-t-2 border-teal-400">
              <div class="text-3xl font-bold text-teal-600">{{ formatNumber(displayBacklinks.live_backlinks) }}</div>
              <div class="text-sm text-teal-400 mt-1">Live Backlinks</div>
            </div>
            <div class="bg-teal-50 dark:bg-teal-950 rounded-lg p-4 text-center border-t-2 border-teal-400">
              <div class="text-3xl font-bold text-teal-600">{{ formatNumber(displayBacklinks.all_time_backlinks) }}</div>
              <div class="text-sm text-teal-400 mt-1">All-time Backlinks</div>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th class="px-4 py-2 text-white text-left rounded-l-full" style="background: #1E3A5F">Week</th>
                  <th class="px-4 py-2 text-white text-right" style="background: #2563EB">Backlinks</th>
                  <th class="px-4 py-2 text-white text-right" style="background: #0D9488">Domain Rating</th>
                  <th class="px-4 py-2 text-white text-right rounded-r-full" style="background: #059669">Change(%)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in displayBacklinksHistory" :key="row.label" :class="idx % 2 === 0 ? 'bg-white dark:bg-[#1E293B]' : 'bg-[#F0F9FF] dark:bg-[#0F172A]'">
                  <td class="px-4 py-2.5 font-medium text-[#1E3A5F] dark:text-blue-200">{{ row.label }}</td>
                  <td class="px-4 py-2.5 text-right font-medium">{{ formatNumber(row.backlinks) }}</td>
                  <td class="px-4 py-2.5 text-right font-medium">{{ row.domain_rating }}</td>
                  <td class="px-4 py-2.5 text-right font-medium">
                    <span v-if="row.change_pct === null" class="text-gray-400">N/A</span>
                    <span v-else-if="Number(row.change_pct) > 0" class="text-green-600">+{{ row.change_pct }}%</span>
                    <span v-else-if="Number(row.change_pct) < 0" class="text-red-500">{{ row.change_pct }}%</span>
                    <span v-else class="text-gray-400">0.00%</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="backlinksInsight" class="text-xs text-gray-400 italic mt-3">{{ backlinksInsight }}</p>
        </div>
      </template>
    </Card>
    </div>

    <!-- Technical SEO Health -->
    <div
      v-if="ahrefsTarget && cardVisible.technicalHealth"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 250 } }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
      <template #title>
        <div class="flex items-center gap-2 text-base font-bold">
          <span class="text-[#0D9488]">Technical SEO </span><span class="text-[#1E293B] dark:text-white">Health</span>
          <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Ahrefs</span>
        </div>
      </template>
      <template #content>
        <div v-if="metrics.loading.siteAuditIssues || metrics.loading.backlinksHistory">
          <Skeleton width="100%" height="320px" />
        </div>
        <div v-else-if="metrics.errors.siteAuditIssues" class="text-red-500 text-sm">
          {{ metrics.errors.siteAuditIssues }}
        </div>
        <div v-else>
          <!-- 2-column grid: 60/40 -->
          <div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <!-- LEFT: Weekly History Table (3/5 = 60%) -->
            <div class="lg:col-span-3">
              <p class="text-xs text-gray-400 mb-2">Ahrefs</p>
              <div class="overflow-x-auto">
                <table class="w-full text-sm border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th class="px-3 py-2 rounded-full text-white text-xs font-semibold bg-[#1E3A5F]">Week Crawled</th>
                      <th class="px-3 py-2 rounded-full text-white text-xs font-semibold bg-[#059669]">Health Score</th>
                      <th class="px-3 py-2 rounded-full text-white text-xs font-semibold bg-[#DC2626]">Errors</th>
                      <th class="px-3 py-2 rounded-full text-white text-xs font-semibold bg-[#D97706]">Warnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(row, idx) in techHealthWeeks"
                      :key="row.week"
                      :class="row._isLatest ? 'bg-[#0D9488] text-white' : idx % 2 === 0 ? 'bg-white dark:bg-[#1E293B]' : 'bg-gray-50 dark:bg-[#0F172A]'"
                    >
                      <td class="px-3 py-1.5 text-center font-medium">{{ row.week }}</td>
                      <td class="px-3 py-1.5 text-center">{{ row.health_score }}%</td>
                      <td class="px-3 py-1.5 text-center">{{ row.errors }}</td>
                      <td class="px-3 py-1.5 text-center">{{ row.warnings }}</td>
                    </tr>
                    <tr v-if="!techHealthWeeks.length">
                      <td colspan="4" class="text-center text-gray-400 py-4">No weekly data available</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- RIGHT: Donut Chart (2/5 = 40%) -->
            <div class="lg:col-span-2">
              <p class="text-sm font-bold text-[#1E293B] dark:text-white mb-2">Site Health Score</p>
              <div class="flex gap-4">
                <div v-if="techHealthDonutFirst" class="flex-1 text-center min-w-0">
                  <v-chart ref="chartTechHealthFirst" :option="techHealthDonutFirst" autoresize style="height: 200px; width: 100%" />
                  <p class="text-xs text-gray-500 mt-1">First Crawl<br />{{ techHealthFirstDate }}</p>
                </div>
                <div class="flex-1 text-center min-w-0">
                  <v-chart ref="chartTechHealthRecent" :option="techHealthDonutRecent" autoresize style="height: 200px; width: 100%" />
                  <p class="text-xs text-gray-500 mt-1">Latest Crawl<br />{{ techHealthDate }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Insight Panel -->
          <div class="mt-4 bg-[#F0FDFA] dark:bg-[#134E4A] rounded-lg p-4 flex items-start gap-3">
            <span class="text-xl">💡</span>
            <p class="text-sm text-[#1E293B] dark:text-[#CCFBF1] leading-relaxed">{{ techHealthInsight }}</p>
          </div>
        </div>
      </template>
    </Card>
    </div>

    <!-- ── Content ── -->
    <div v-if="fetchedMetricsByCategory['Content']" class="flex items-center gap-3 pt-2 pb-1">
      <h2 class="text-lg font-bold text-[#1E3A5F] dark:text-white tracking-tight">Content</h2>
      <div class="flex-1 h-px bg-[#0D9488]/30"></div>
    </div>

    <!-- CONT02: Keyword Cannibalization -->
    <div
      v-if="ahrefsTarget && cardVisible.cannibalization"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 300 } }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
      <template #title>
        <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
          <i class="pi pi-copy text-[#0D9488]" />
          Keyword Cannibalization
          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">CONT02</span>
          <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Ahrefs</span>
        </div>
      </template>
      <template #content>
        <div v-if="metrics.loading.siteAuditIssues">
          <Skeleton width="100%" height="160px" />
        </div>
        <div v-else-if="auditData && !auditData.error">
          <div v-if="auditData.issues?.filter(i => i.name?.toLowerCase().includes('duplicate') || i.name?.toLowerCase().includes('canonical') || i.name?.toLowerCase().includes('redirect')).length">
            <DataTable
              :value="auditData.issues.filter(i => i.name?.toLowerCase().includes('duplicate') || i.name?.toLowerCase().includes('canonical') || i.name?.toLowerCase().includes('redirect'))"
              size="small" stripedRows class="text-sm"
            >
              <Column field="name" header="Issue" style="min-width: 200px" />
              <Column field="importance" header="Severity" style="width: 100px">
                <template #body="{ data }">
                  <Tag :value="data.importance" :severity="data.importance === 'Error' ? 'danger' : data.importance === 'Warning' ? 'warn' : 'info'" />
                </template>
              </Column>
              <Column field="category" header="Category" style="width: 120px" />
              <Column field="crawled" header="Pages" style="width: 80px; text-align: right">
                <template #body="{ data }">{{ formatNumber(data.crawled) }}</template>
              </Column>
            </DataTable>
          </div>
          <div v-else class="text-xs text-green-600 bg-green-50 dark:bg-green-950/30 p-4 rounded-lg flex items-center gap-2">
            <i class="pi pi-check-circle text-green-600" />
            No duplicate content or cannibalization issues detected in the latest crawl.
          </div>
          <p class="text-xs text-gray-400 italic mt-3">Keyword cannibalization occurs when multiple pages compete for the same keyword. Duplicate content without canonical tags is a common signal.</p>
        </div>
        <div v-else class="text-gray-400 text-sm">No audit data available</div>
      </template>
    </Card>
    </div>

    <!-- Site Audit Section (Full Width) [HIDDEN] -->
    <div v-if="false"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 200 } }"
      :hovered="{ y: -2, boxShadow: '0 8px 25px rgba(0,0,0,0.1)' }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
      <template #title>
        <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
          <i class="pi pi-heart text-[#0D9488]" />
          Site Audit
          <span v-if="auditData?.project_name" class="text-sm font-normal text-gray-400 ml-2">{{ auditData.project_name }}</span>
          <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Ahrefs</span>
        </div>
      </template>
      <template #content>
        <div v-if="metrics.loading.siteAuditIssues || metrics.loading.siteHealth">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Skeleton v-for="i in 4" :key="i" width="100%" height="80px" />
          </div>
          <Skeleton width="100%" height="300px" />
        </div>
        <div v-else-if="metrics.errors.siteAuditIssues" class="text-red-500 text-sm">
          {{ metrics.errors.siteAuditIssues }}
        </div>
        <div v-else-if="auditData && !auditData.error">
          <!-- KPI Row -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div :class="[healthScoreBg, 'rounded-lg p-4 text-center']">
              <div :class="['text-3xl font-bold', healthScoreColor]">{{ auditData.health_score ?? '—' }}%</div>
              <div class="text-sm text-gray-500 mt-1">Health Score</div>
            </div>
            <div class="bg-red-50 rounded-lg p-4 text-center">
              <div class="text-3xl font-bold text-red-600">{{ formatNumber(auditData.urls_with_errors) }}</div>
              <div class="text-sm text-red-400 mt-1">Errors</div>
            </div>
            <div class="bg-orange-50 rounded-lg p-4 text-center">
              <div class="text-3xl font-bold text-orange-600">{{ formatNumber(auditData.urls_with_warnings) }}</div>
              <div class="text-sm text-orange-400 mt-1">Warnings</div>
            </div>
            <div class="bg-blue-50 rounded-lg p-4 text-center">
              <div class="text-3xl font-bold text-blue-600">{{ formatNumber(auditData.urls_with_notices) }}</div>
              <div class="text-sm text-blue-400 mt-1">Notices</div>
            </div>
          </div>

          <!-- Bottom Row: Donut + Table -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Donut Chart -->
            <div v-if="auditDonutOption">
              <v-chart ref="chartAuditDonut" :option="auditDonutOption" autoresize style="height: 400px; width: 100%" />
            </div>
            <div v-else class="flex items-center justify-center text-gray-400 text-sm">No chart data</div>

            <!-- Issues Table -->
            <div v-if="auditIssuesTable.length">
              <DataTable :value="auditIssuesTable" size="small" stripedRows scrollable scrollHeight="320px">
                <Column field="title" header="Issue" style="min-width: 180px">
                  <template #body="{ data }">
                    <span class="text-sm">{{ data.title || data.name || data.issue }}</span>
                  </template>
                </Column>
                <Column field="importance" header="Importance" style="width: 100px">
                  <template #body="{ data }">
                    <Tag :value="data.importance" :severity="importanceSeverity(data.importance)" />
                  </template>
                </Column>
                <Column field="category" header="Category" style="width: 120px">
                  <template #body="{ data }">
                    <span class="text-sm text-gray-600">{{ data.category || '—' }}</span>
                  </template>
                </Column>
                <Column field="crawled" header="Crawled" style="width: 80px">
                  <template #body="{ data }">
                    <span class="text-sm font-medium">{{ formatNumber(data.crawled) }}</span>
                  </template>
                </Column>
                <Column field="change" header="Change" style="width: 80px">
                  <template #body="{ data }">
                    <span v-if="data.change > 0" class="text-sm text-red-500 font-medium">+{{ data.change }}</span>
                    <span v-else-if="data.change < 0" class="text-sm text-green-500 font-medium">{{ data.change }}</span>
                    <span v-else class="text-sm text-gray-400">0</span>
                  </template>
                </Column>
              </DataTable>
            </div>
            <div v-else class="flex items-center justify-center text-gray-400 text-sm">No issues data</div>
          </div>

          <!-- CONT02 — Keyword Cannibalization (always show when auditData is loaded) -->
          <div v-if="auditData" class="mt-4 border-t border-gray-100 dark:border-gray-700 pt-4">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-sm font-semibold text-[#0D9488]">Keyword Cannibalization</span>
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 border border-gray-200 dark:border-gray-600">CONT02</span>
            </div>
            <!-- Filter issues related to duplication/cannibalization -->
            <div v-if="auditData.issues.filter(i => i.name?.toLowerCase().includes('duplicate') || i.name?.toLowerCase().includes('canonical') || i.name?.toLowerCase().includes('redirect') || i.name?.toLowerCase().includes('hreflang') || i.name?.toLowerCase().includes('title') && i.importance === 'Error').length">
              <DataTable
                :value="auditData.issues.filter(i => i.name?.toLowerCase().includes('duplicate') || i.name?.toLowerCase().includes('canonical') || i.name?.toLowerCase().includes('redirect'))"
                size="small" stripedRows class="text-sm"
              >
                <Column field="name" header="Issue" style="min-width: 200px" />
                <Column field="importance" header="Severity" style="width: 100px">
                  <template #body="{ data }">
                    <Tag :value="data.importance" :severity="data.importance === 'Error' ? 'danger' : data.importance === 'Warning' ? 'warn' : 'info'" />
                  </template>
                </Column>
                <Column field="category" header="Category" style="width: 120px" />
                <Column field="crawled" header="Pages" style="width: 80px; text-align: right">
                  <template #body="{ data }">{{ formatNumber(data.crawled) }}</template>
                </Column>
              </DataTable>
            </div>
            <div v-else class="text-xs text-green-600 bg-green-50 dark:bg-green-950/30 p-3 rounded-lg">
              ✅ No duplicate content or cannibalization issues detected in the latest crawl.
            </div>
            <p class="text-xs text-gray-400 italic mt-2">Keyword cannibalization occurs when multiple pages compete for the same keyword. Duplicate content without canonical tags is a common signal.</p>
          </div>
        </div>
        <div v-else-if="auditData?.error" class="text-sm text-yellow-600">
          {{ auditData.error }}
        </div>
        <div v-else class="text-gray-400 text-sm">No data</div>
      </template>
    </Card>
    </div>

    <!-- Charts Row: Traffic from US + Impressions [HIDDEN] -->
    <div v-if="false"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 350 } }"
    >
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- Traffic by Country World Map -->
      <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
        <template #title>
          <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
            <i class="pi pi-globe text-[#0D9488]" />
            Traffic by Country
            <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Google Analytics</span>
          </div>
        </template>
        <template #content>
          <div v-if="metrics.loading.trafficFromUS">
            <Skeleton width="100%" height="300px" />
          </div>
          <div v-else-if="metrics.errors.trafficFromUS" class="text-red-500 text-sm">
            {{ metrics.errors.trafficFromUS }}
          </div>
          <div v-else-if="trafficFromUSOption">
            <v-chart ref="chartWorldMap" :option="trafficFromUSOption" autoresize style="height: 400px; width: 100%" />
            <div class="text-center text-sm text-gray-500 mt-1">
              US Traffic: {{ metrics.trafficFromUS.value.percentage }}% ({{ formatNumber(metrics.trafficFromUS.value.usSessions) }} sessions)
            </div>
          </div>
          <div v-else class="text-gray-400 text-sm">No data</div>
        </template>
      </Card>

    </div>
    </div>

    <!-- US Traffic by Source [HIDDEN] -->
    <div v-if="false"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 400 } }"
      :hovered="{ y: -2, boxShadow: '0 8px 25px rgba(0,0,0,0.1)' }"
    >
    <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
      <template #title>
        <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
          <i class="pi pi-flag text-[#0D9488]" />
          US Traffic by Source
          <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Google Analytics</span>
        </div>
      </template>
      <template #content>
        <div v-if="metrics.loading.trafficUSBySource">
          <Skeleton width="100%" height="220px" />
        </div>
        <div v-else-if="metrics.errors.trafficUSBySource" class="text-red-500 text-sm">
          {{ metrics.errors.trafficUSBySource }}
        </div>
        <div v-else-if="trafficUSBySourceOption">
          <v-chart :option="trafficUSBySourceOption" autoresize style="height: 400px; width: 100%" />
        </div>
        <div v-else class="text-gray-400 text-sm">No data</div>
      </template>
    </Card>
    </div>

    <!-- Row 2: Traffic by Source [HIDDEN] -->
    <div v-if="false"
      v-motion
      :initial="{ opacity: 0, y: 20 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 450 } }"
    >
    <div class="grid grid-cols-1 gap-4">
      <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] dark:!bg-[#1E293B]">
        <template #title>
          <div class="flex items-center gap-2 text-base font-bold text-[#0D9488]">
            <i class="pi pi-sitemap text-[#0D9488]" />
            Traffic by Source
            <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">Google Analytics</span>
          </div>
        </template>
        <template #content>
          <div v-if="metrics.loading.trafficBySource">
            <Skeleton width="100%" height="220px" />
          </div>
          <div v-else-if="metrics.errors.trafficBySource" class="text-red-500 text-sm">
            {{ metrics.errors.trafficBySource }}
          </div>
          <div v-else-if="trafficBySourceOption">
            <v-chart :option="trafficBySourceOption" autoresize style="height: 400px; width: 100%" />
          </div>
          <div v-else class="text-gray-400 text-sm">No data</div>
        </template>
      </Card>

    </div>
    </div>

  </div>
</template>

<style scoped>
.source-toggle-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 600;
  border: 1.5px solid;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  user-select: none;
}
.source-toggle-pill:hover {
  filter: brightness(0.95);
}
.source-pill-active {
  background: #F0FDFA;
  border-color: #5EEAD4;
  color: #0D9488;
}
:root.p-dark .source-pill-active,
.dark .source-pill-active {
  background: rgba(13, 148, 136, 0.15);
  border-color: rgba(94, 234, 212, 0.4);
  color: #5EEAD4;
}
.source-pill-inactive {
  background: #F9FAFB;
  border-color: #D1D5DB;
  color: #9CA3AF;
}
:root.p-dark .source-pill-inactive,
.dark .source-pill-inactive {
  background: rgba(107, 114, 128, 0.1);
  border-color: rgba(107, 114, 128, 0.3);
  color: #6B7280;
}
.source-pill-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 700;
  background: #0D9488;
  color: #fff;
  line-height: 1;
}
.metric-source-section {
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  padding: 12px 16px;
}
:root.p-dark .metric-source-section,
.dark .metric-source-section {
  background: rgba(30, 41, 59, 0.5);
  border-color: #334155;
}
</style>
