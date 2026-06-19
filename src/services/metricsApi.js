const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function authHeaders() {
  const token = localStorage.getItem('auth_token')
  return { Authorization: `Bearer ${token}` }
}

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: authHeaders(), signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Request failed: ${res.status}`)
    }
    return res.json()
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') throw new Error('Request timed out')
    throw err
  }
}

function dateParams(startDate, endDate) {
  const params = new URLSearchParams()
  if (startDate) params.set('startDate', startDate)
  if (endDate) params.set('endDate', endDate)
  return params
}

export function fetchTotalTraffic(propertyId, startDate, endDate) {
  const params = dateParams(startDate, endDate)
  params.set('propertyId', propertyId)
  return fetchJson(`${API}/api/metrics/total-traffic?${params}`)
}

export function fetchTrafficBySource(propertyId, startDate, endDate) {
  const params = dateParams(startDate, endDate)
  params.set('propertyId', propertyId)
  return fetchJson(`${API}/api/metrics/traffic-by-source?${params}`)
}

export function fetchNewVsReturning(propertyId, startDate, endDate) {
  const params = dateParams(startDate, endDate)
  params.set('propertyId', propertyId)
  return fetchJson(`${API}/api/metrics/new-vs-returning?${params}`)
}

export function fetchTrafficBySourceOverTime(propertyId, startDate, endDate) {
  const params = dateParams(startDate, endDate)
  params.set('propertyId', propertyId)
  return fetchJson(`${API}/api/metrics/traffic-by-source-over-time?${params}`)
}

export function fetchTrafficFromUS(propertyId, startDate, endDate) {
  const params = dateParams(startDate, endDate)
  params.set('propertyId', propertyId)
  return fetchJson(`${API}/api/metrics/traffic-from-us?${params}`)
}

export function fetchTrafficDrivers(propertyId, startDate, endDate) {
  const params = dateParams(startDate, endDate)
  params.set('propertyId', propertyId)
  return fetchJson(`${API}/api/metrics/traffic-drivers?${params}`)
}

export function fetchImpressions(siteUrl, startDate, endDate) {
  const params = dateParams(startDate, endDate)
  params.set('siteUrl', siteUrl)
  return fetchJson(`${API}/api/metrics/impressions?${params}`)
}

export function fetchKeywordRankings(siteUrl, startDate, endDate, limit = 25000) {
  const params = dateParams(startDate, endDate)
  params.set('siteUrl', siteUrl)
  params.set('limit', limit)
  return fetchJson(`${API}/api/metrics/keyword-rankings?${params}`)
}

export function fetchDomainRating(target, date) {
  const params = new URLSearchParams({ target })
  if (date) params.set('date', date)
  return fetchJson(`${API}/api/metrics/domain-rating?${params}`)
}

export function fetchSiteHealth(target) {
  const params = new URLSearchParams({ target })
  return fetchJson(`${API}/api/metrics/site-health?${params}`)
}

export function fetchSiteAuditIssues(target) {
  const params = new URLSearchParams({ target })
  return fetchJson(`${API}/api/metrics/site-audit-issues?${params}`, 30000)
}

export function fetchTrafficUSBySourceOverTime(propertyId, startDate, endDate) {
  const params = dateParams(startDate, endDate)
  params.set('propertyId', propertyId)
  return fetchJson(`${API}/api/metrics/traffic-us-by-source-over-time?${params}`)
}

export function fetchTrafficUSBySource(propertyId, startDate, endDate) {
  const params = dateParams(startDate, endDate)
  params.set('propertyId', propertyId)
  return fetchJson(`${API}/api/metrics/traffic-us-by-source?${params}`, 30000)
}

export function fetchBacklinks(target) {
  const params = new URLSearchParams({ target })
  return fetchJson(`${API}/api/metrics/backlinks?${params}`)
}

export function fetchBacklinksHistory(target, weeks = 10) {
  const params = new URLSearchParams({ target, weeks })
  return fetchJson(`${API}/api/metrics/backlinks-history?${params}`, 30000)
}

export function fetchGscCoverage(siteUrl) {
  const params = new URLSearchParams({ siteUrl })
  return fetchJson(`${API}/api/metrics/gsc-coverage?${params}`)
}

export function fetchGscMobile(siteUrl, startDate, endDate) {
  const params = dateParams(startDate, endDate)
  params.set('siteUrl', siteUrl)
  return fetchJson(`${API}/api/metrics/gsc-mobile?${params}`)
}

export function fetchGscStructuredData(siteUrl, startDate, endDate) {
  const params = dateParams(startDate, endDate)
  params.set('siteUrl', siteUrl)
  return fetchJson(`${API}/api/metrics/gsc-structured-data?${params}`)
}

export function fetchClients() {
  return fetchJson(`${API}/api/clients`)
}

export function fetchUserProperties() {
  return fetchJson(`${API}/api/user/properties`)
}

export async function fetchGraderScore(body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(`${API}/api/grader/score`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      throw new Error(b.error || `Request failed: ${res.status}`)
    }
    return res.json()
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') throw new Error('Request timed out')
    throw err
  }
}
