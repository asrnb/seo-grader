import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: join(__dirname, '.env') })
import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import { google } from 'googleapis'

const app = express()
const PORT = process.env.PORT || 3001

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'
app.use(cors({ origin: FRONTEND_URL, credentials: true }))
app.use(express.json())

// ─── Request Logging Middleware ────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - start
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
    console.log(`[${ts}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`)
  })
  next()
})

// ─── Rate Limiter (in-memory, per IP) ─────────────────────────────────
const rateLimitMap = new Map()
const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60_000

function rateLimit(req, res, next) {
  const ip = req.ip
  const now = Date.now()
  let entry = rateLimitMap.get(ip)
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { windowStart: now, count: 0 }
    rateLimitMap.set(ip, entry)
  }
  entry.count++
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: 'Too many requests — max 60 per minute',
      code: 'RATE_LIMIT',
      endpoint: req.originalUrl,
    })
  }
  next()
}

app.use(rateLimit)

// Periodically clean stale rate-limit entries (every 5 min)
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(ip)
  }
}, 300_000)

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI
)

// Token store — persisted to disk so tokens survive server restarts
const TOKEN_STORE_PATH = join(__dirname, '.token-store.json')

function loadTokenStore() {
  try {
    if (existsSync(TOKEN_STORE_PATH)) {
      const data = JSON.parse(readFileSync(TOKEN_STORE_PATH, 'utf8'))
      return new Map(Object.entries(data))
    }
  } catch {}
  return new Map()
}

function saveTokenStore(store) {
  try {
    const obj = Object.fromEntries(store)
    writeFileSync(TOKEN_STORE_PATH, JSON.stringify(obj), 'utf8')
  } catch (e) {
    console.error('Failed to save token store:', e.message)
  }
}

const tokenStore = loadTokenStore()
console.log(`Token store loaded — ${tokenStore.size} session(s) restored`)

// ─── Persistent Ahrefs Disk Cache ─────────────────────────────────────────
// Saves last known good Ahrefs data to disk — survives API unit exhaustion
const AHREFS_CACHE_PATH = join(__dirname, '.ahrefs-cache.json')

function loadAhrefsCache() {
  try {
    if (existsSync(AHREFS_CACHE_PATH)) {
      return JSON.parse(readFileSync(AHREFS_CACHE_PATH, 'utf8'))
    }
  } catch {}
  return {}
}

function saveAhrefsCache(cache) {
  try {
    writeFileSync(AHREFS_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8')
  } catch (e) {
    console.error('Failed to save Ahrefs cache:', e.message)
  }
}

function getAhrefsCached(key) {
  const cache = loadAhrefsCache()
  return cache[key] || null
}

function setAhrefsCache(key, data) {
  const cache = loadAhrefsCache()
  cache[key] = { data, savedAt: new Date().toISOString() }
  saveAhrefsCache(cache)
}



// ─── First Crawl Persistent Cache ─────────────────────────────────────────
// Stores the first-ever fetched crawl per target — never overwritten
const FIRST_CRAWL_CACHE_PATH = join(__dirname, '.first-crawl-cache.json')

function loadFirstCrawlCache() {
  try {
    if (existsSync(FIRST_CRAWL_CACHE_PATH)) {
      return JSON.parse(readFileSync(FIRST_CRAWL_CACHE_PATH, 'utf8'))
    }
  } catch {}
  return {}
}

function getFirstCrawl(target) {
  return loadFirstCrawlCache()[target] || null
}

function saveFirstCrawl(target, data) {
  const cache = loadFirstCrawlCache()
  if (cache[target]) return // never overwrite — first crawl is permanent
  cache[target] = { data, savedAt: new Date().toISOString() }
  try {
    writeFileSync(FIRST_CRAWL_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8')
  } catch (e) {
    console.error('Failed to save first crawl cache:', e.message)
  }
}

// ─── Response Cache ────────────────────────────────────────────────────────
// Caches API responses to reduce external API calls
// Key: cache key string, Value: { data, expiresAt }
const responseCache = new Map()

function getCached(key) {
  const entry = responseCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key)
    return null
  }
  return entry.data
}

function setCache(key, data, ttlMs) {
  responseCache.set(key, { data, expiresAt: Date.now() + ttlMs })
}

const TTL_1H = 60 * 60 * 1000        // GA4 + GSC: 1 hour
const TTL_24H = 24 * 60 * 60 * 1000  // Ahrefs: 24 hours
const TTL_7D  = 7 * 24 * 60 * 60 * 1000  // Ahrefs slow-changing data: 7 days

// ─── Helpers ──────────────────────────────────────────────────────────

function errorResponse(res, status, message, code, endpoint) {
  return res.status(status).json({ error: message, code, endpoint })
}

function validateDateFormat(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
}

function sanitizeParam(val) {
  if (typeof val !== 'string') return val
  return decodeURIComponent(val).trim()
}

function getSiteUrlVariants(siteUrl) {
  const variants = [siteUrl]
  if (siteUrl.startsWith('https://www.')) {
    variants.push(siteUrl.replace('https://www.', 'https://'))
  } else if (siteUrl.startsWith('https://') && !siteUrl.startsWith('https://www.')) {
    variants.push(siteUrl.replace('https://', 'https://www.'))
  }
  const domain = siteUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
  variants.push(`sc-domain:${domain}`)
  return variants
}

function computePreviousPeriod(startDate, endDate) {
  const resolve = (d) => {
    if (d === 'today') return new Date().toISOString().split('T')[0]
    if (/^\d+daysAgo$/.test(d)) {
      const n = parseInt(d)
      return new Date(Date.now() - n * 86400000).toISOString().split('T')[0]
    }
    return d
  }
  const s = new Date(resolve(startDate))
  const e = new Date(resolve(endDate))
  const durationMs = e - s
  const prevEnd = new Date(s.getTime() - 86400000)
  const prevStart = new Date(prevEnd.getTime() - durationMs)
  const minDate = new Date('2016-01-01')
  return {
    startDate: (prevStart < minDate ? minDate : prevStart).toISOString().split('T')[0],
    endDate: prevEnd.toISOString().split('T')[0],
  }
}

// ─── Auth Middleware ──────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse(res, 401, 'No token provided', 'AUTH_ERROR', req.originalUrl)
  }

  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET)
    req.user = decoded

    const googleTokens = tokenStore.get(decoded.sub)
    if (!googleTokens) {
      return errorResponse(res, 401, 'Google tokens expired — please sign in again', 'AUTH_ERROR', req.originalUrl)
    }
    req.googleTokens = googleTokens
    req.userId = decoded.sub
    next()
  } catch {
    return errorResponse(res, 401, 'Invalid or expired token', 'AUTH_ERROR', req.originalUrl)
  }
}

function requireJWT(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse(res, 401, 'No token provided', 'AUTH_ERROR', req.originalUrl)
  }
  try {
    req.user = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET)
    next()
  } catch {
    return errorResponse(res, 401, 'Invalid or expired token', 'AUTH_ERROR', req.originalUrl)
  }
}

// ─── Health Endpoint (no auth) ────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    services: {
      ga4: 'connected',
      gsc: 'connected',
      ahrefs: 'connected',
    },
  })
})

// ─── Metrics Summary Endpoint ─────────────────────────────────────────

app.get('/api/metrics', requireJWT, (_req, res) => {
  res.json({
    endpoints: [
      { path: '/api/metrics/total-traffic', method: 'GET', params: ['propertyId', 'startDate?', 'endDate?'], description: 'Total sessions and users over date range (GA4)' },
      { path: '/api/metrics/traffic-by-source', method: 'GET', params: ['propertyId', 'startDate?', 'endDate?'], description: 'Sessions by default channel group (GA4)' },
      { path: '/api/metrics/traffic-from-us', method: 'GET', params: ['propertyId', 'startDate?', 'endDate?'], description: 'Sessions by country with US breakdown (GA4)' },
      { path: '/api/metrics/traffic-drivers', method: 'GET', params: ['propertyId', 'startDate?', 'endDate?'], description: 'Top pages by sessions (GA4)' },
      { path: '/api/metrics/impressions', method: 'GET', params: ['siteUrl', 'startDate?', 'endDate?'], description: 'Impressions, clicks, CTR from Google Search Console' },
      { path: '/api/metrics/keyword-rankings', method: 'GET', params: ['siteUrl', 'startDate?', 'endDate?', 'limit?'], description: 'Keyword rankings from Google Search Console' },
      { path: '/api/metrics/gsc-coverage', method: 'GET', params: ['siteUrl'], description: 'Index coverage from GSC sitemaps + impressions proxy' },
      { path: '/api/metrics/gsc-mobile', method: 'GET', params: ['siteUrl', 'startDate?', 'endDate?'], description: 'Mobile vs Desktop vs Tablet traffic from GSC' },
      { path: '/api/metrics/gsc-structured-data', method: 'GET', params: ['siteUrl', 'startDate?', 'endDate?'], description: 'Web/Image/Video search type breakdown from GSC' },
      { path: '/api/metrics/traffic-us-by-source', method: 'GET', params: ['propertyId', 'startDate?', 'endDate?'], description: 'US sessions by channel group (GA4)' },
      { path: '/api/metrics/domain-rating', method: 'GET', params: ['target', 'date?'], description: 'Domain rating from Ahrefs' },
      { path: '/api/metrics/backlinks', method: 'GET', params: ['target', 'date?'], description: 'Backlink stats from Ahrefs' },
      { path: '/api/metrics/site-health', method: 'GET', params: ['target'], description: 'Site health score from Ahrefs Site Audit' },
      { path: '/api/metrics/site-audit-issues', method: 'GET', params: ['target'], description: 'Detailed audit issues from Ahrefs Site Audit' },
    ],
  })
})

// ─── Auth Routes ──────────────────────────────────────────────────────

app.get('/api/auth/google', (_req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/webmasters.readonly',
    ],
    prompt: 'consent',
  })
  res.redirect(url)
})

app.get('/auth/callback', async (req, res) => {
  return handleOAuthCallback(req, res)
})

app.get('/api/auth/callback', async (req, res) => {
  return handleOAuthCallback(req, res)
})

async function handleOAuthCallback(req, res) {
  const { code } = req.query

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' })
  }

  try {
    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const { data: userInfo } = await oauth2.userinfo.get()

    // Domain restriction is optional — only enforced if ALLOWED_DOMAIN is set in server/.env
    const allowedDomain = process.env.ALLOWED_DOMAIN
    if (allowedDomain) {
      const domain = userInfo.email.split('@')[1]
      if (domain !== allowedDomain) {
        return res.redirect(
          `${FRONTEND_URL}/login?error=${encodeURIComponent(
            'Access restricted to @' + allowedDomain + ' accounts only.'
          )}`
        )
      }
    }

    tokenStore.set(userInfo.id, tokens)
    saveTokenStore(tokenStore)

    const token = jwt.sign(
      {
        sub: userInfo.id,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    )

    res.redirect(`${FRONTEND_URL}/auth/callback?token=${token}`)
  } catch (err) {
    console.error('OAuth callback error:', err.message)
    res.redirect(
      `${FRONTEND_URL}/login?error=${encodeURIComponent('Authentication failed. Please try again.')}`
    )
  }
}

app.get('/api/auth/me', requireJWT, (req, res) => {
  res.json({
    id: req.user.sub,
    email: req.user.email,
    name: req.user.name,
    picture: req.user.picture,
  })
})

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET)
      tokenStore.delete(decoded.sub)
    } catch {
      // Token may be expired — that's fine
    }
  }
  res.json({ message: 'Logged out successfully' })
})

// ─── Google Auth Helper ───────────────────────────────────────────────

function createGoogleAuth(googleTokens) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.REDIRECT_URI
  )
  auth.setCredentials(googleTokens)

  // Auto-refresh: when token is refreshed, save new tokens to store
  auth.on('tokens', (newTokens) => {
    const userId = [...tokenStore.entries()].find(([, t]) => t.access_token === googleTokens.access_token)?.[0]
    if (userId) {
      const updated = { ...googleTokens, ...newTokens }
      tokenStore.set(userId, updated)
      saveTokenStore(tokenStore)
      console.log(`[token-refresh] Refreshed tokens for user ${userId}`)
    }
  })

  return auth
}

// Get a valid access token — auto-refreshes if expired
async function getValidAccessToken(googleTokens, userId) {
  try {
    const auth = createGoogleAuth(googleTokens)
    const { token } = await auth.getAccessToken()
    // If token was refreshed, update store
    const creds = auth.credentials
    if (creds.access_token !== googleTokens.access_token) {
      const updated = { ...googleTokens, ...creds }
      tokenStore.set(userId, updated)
      saveTokenStore(tokenStore)
    }
    return token
  } catch (err) {
    console.error('Token refresh failed:', err.message)
    throw new Error('Google tokens expired — please sign in again')
  }
}

// GA4 REST API helper
async function ga4RunReport(accessToken, propertyId, body) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GA4 API error: ${err}`)
  }
  return res.json()
}

// ─── GA4 Endpoints ────────────────────────────────────────────────────

app.get('/api/metrics/total-traffic', requireAuth, async (req, res) => {
  const propertyId = sanitizeParam(req.query.propertyId)
  const startDate = req.query.startDate || '30daysAgo'
  const endDate = req.query.endDate || 'today'

  if (!propertyId) return errorResponse(res, 400, 'propertyId is required', 'MISSING_PARAM', req.originalUrl)
  if (req.query.startDate && !validateDateFormat(req.query.startDate) && req.query.startDate !== '30daysAgo') {
    return errorResponse(res, 400, 'startDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }
  if (req.query.endDate && !validateDateFormat(req.query.endDate) && req.query.endDate !== 'today') {
    return errorResponse(res, 400, 'endDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }

  const cacheKey = `total-traffic:${propertyId}:${startDate}:${endDate}`
  const cached = getCached(cacheKey)
  if (cached) return res.json({ ...cached, _cached: true })

  try {
    const accessToken = await getValidAccessToken(req.googleTokens, req.userId)
    const [totalRes, dailyRes] = await Promise.all([
      ga4RunReport(accessToken, propertyId, {
        dateRanges: [{ startDate, endDate }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
      }),
      ga4RunReport(accessToken, propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 1825,
      }),
    ])
    const row = totalRes.rows?.[0]
    const daily = (dailyRes.rows || []).map((r) => ({
      date: r.dimensionValues[0].value, // YYYYMMDD format
      sessions: Number(r.metricValues[0].value),
    }))
    const ttData = {
      metric: 'total_traffic',
      value: {
        sessions: Number(row?.metricValues?.[0]?.value || 0),
        users: Number(row?.metricValues?.[1]?.value || 0),
        daily,
      },
      date_range: { startDate, endDate },
    }
    setCache(cacheKey, ttData, TTL_1H)
    return res.json(ttData)
  } catch (err) {
    console.error('GA4 total-traffic error:', err.message)
    errorResponse(res, 500, err.message, 'API_ERROR', req.originalUrl)
  }
})

app.get('/api/metrics/traffic-by-source', requireAuth, async (req, res) => {
  const propertyId = sanitizeParam(req.query.propertyId)
  const startDate = req.query.startDate || '30daysAgo'
  const endDate = req.query.endDate || 'today'

  if (!propertyId) return errorResponse(res, 400, 'propertyId is required', 'MISSING_PARAM', req.originalUrl)
  if (req.query.startDate && !validateDateFormat(req.query.startDate) && req.query.startDate !== '30daysAgo') {
    return errorResponse(res, 400, 'startDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }
  if (req.query.endDate && !validateDateFormat(req.query.endDate) && req.query.endDate !== 'today') {
    return errorResponse(res, 400, 'endDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }

  try {
    const prev = computePreviousPeriod(startDate, endDate)
    const [response, prevResponse] = await Promise.all([
      ga4RunReport((await getValidAccessToken(req.googleTokens, req.userId)), propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      }),
      ga4RunReport((await getValidAccessToken(req.googleTokens, req.userId)), propertyId, {
        dateRanges: [{ startDate: prev.startDate, endDate: prev.endDate }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      }),
    ])
    const breakdown = (response.rows || []).map((row) => ({
      channel: row.dimensionValues[0].value,
      sessions: Number(row.metricValues[0].value),
    }))
    const previousPeriod = (prevResponse.rows || []).map((row) => ({
      channel: row.dimensionValues[0].value,
      sessions: Number(row.metricValues[0].value),
    }))
    res.json({
      metric: 'traffic_by_source',
      value: breakdown,
      previousPeriod,
      date_range: { startDate, endDate },
      previous_date_range: prev,
    })
  } catch (err) {
    console.error('GA4 traffic-by-source error:', err.message)
    errorResponse(res, 500, err.message, 'API_ERROR', req.originalUrl)
  }
})

app.get('/api/metrics/traffic-from-us', requireAuth, async (req, res) => {
  const propertyId = sanitizeParam(req.query.propertyId)
  const startDate = req.query.startDate || '30daysAgo'
  const endDate = req.query.endDate || 'today'

  if (!propertyId) return errorResponse(res, 400, 'propertyId is required', 'MISSING_PARAM', req.originalUrl)
  if (req.query.startDate && !validateDateFormat(req.query.startDate) && req.query.startDate !== '30daysAgo') {
    return errorResponse(res, 400, 'startDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }
  if (req.query.endDate && !validateDateFormat(req.query.endDate) && req.query.endDate !== 'today') {
    return errorResponse(res, 400, 'endDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }

  try {
    const countryResponse = await ga4RunReport((await getValidAccessToken(req.googleTokens, req.userId)), propertyId, {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'country' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 250,
    })
    const countries = (countryResponse.rows || []).map(row => ({
      country: row.dimensionValues[0].value,
      sessions: Number(row.metricValues[0].value || 0),
    }))
    const totalSessions = countries.reduce((sum, c) => sum + c.sessions, 0)
    const usSessions = countries.find(c => c.country === 'United States')?.sessions || 0
    const percentage = totalSessions > 0 ? Math.round((usSessions / totalSessions) * 100) : 0
    res.json({
      metric: 'traffic_from_us',
      value: { countries, usSessions, totalSessions, percentage },
      date_range: { startDate, endDate },
    })
  } catch (err) {
    console.error('GA4 traffic-from-us error:', err.message)
    errorResponse(res, 500, err.message, 'API_ERROR', req.originalUrl)
  }
})

app.get('/api/metrics/traffic-us-by-source', requireAuth, async (req, res) => {
  const propertyId = sanitizeParam(req.query.propertyId)
  const startDate = req.query.startDate || '30daysAgo'
  const endDate = req.query.endDate || 'today'

  if (!propertyId) return errorResponse(res, 400, 'propertyId is required', 'MISSING_PARAM', req.originalUrl)
  if (req.query.startDate && !validateDateFormat(req.query.startDate) && req.query.startDate !== '30daysAgo') {
    return errorResponse(res, 400, 'startDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }
  if (req.query.endDate && !validateDateFormat(req.query.endDate) && req.query.endDate !== 'today') {
    return errorResponse(res, 400, 'endDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }

  try {
    const response = await ga4RunReport((await getValidAccessToken(req.googleTokens, req.userId)), propertyId, {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      dimensionFilter: {
        filter: {
          fieldName: 'country',
          stringFilter: { matchType: 'EXACT', value: 'United States' },
        },
      },
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    })
    const channels = (response.rows || []).map((row) => ({
      channel: row.dimensionValues[0].value,
      sessions: Number(row.metricValues[0].value),
    }))
    const total_us_sessions = channels.reduce((sum, c) => sum + c.sessions, 0)
    res.json({
      metric: 'traffic_us_by_source',
      channels,
      total_us_sessions,
      date_range: { startDate, endDate },
    })
  } catch (err) {
    console.error('GA4 traffic-us-by-source error:', err.message)
    errorResponse(res, 500, err.message, 'API_ERROR', req.originalUrl)
  }
})

app.get('/api/metrics/traffic-drivers', requireAuth, async (req, res) => {
  const propertyId = sanitizeParam(req.query.propertyId)
  const startDate = req.query.startDate || '30daysAgo'
  const endDate = req.query.endDate || 'today'

  if (!propertyId) return errorResponse(res, 400, 'propertyId is required', 'MISSING_PARAM', req.originalUrl)
  if (req.query.startDate && !validateDateFormat(req.query.startDate) && req.query.startDate !== '30daysAgo') {
    return errorResponse(res, 400, 'startDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }
  if (req.query.endDate && !validateDateFormat(req.query.endDate) && req.query.endDate !== 'today') {
    return errorResponse(res, 400, 'endDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }

  try {
    const prev = computePreviousPeriod(startDate, endDate)
    const token = await getValidAccessToken(req.googleTokens, req.userId)
    const GA4_MIN_DATE = '2020-01-01'
    // Cap previous period so it doesn't go before GA4 data exists
    const prevStart = prev.startDate < GA4_MIN_DATE ? GA4_MIN_DATE : prev.startDate
    const prevEnd   = prev.endDate   < GA4_MIN_DATE ? GA4_MIN_DATE : prev.endDate

    const reportDimensions = [{ name: 'pagePath' }]
    const reportMetrics = [
      { name: 'sessions' },
      { name: 'averageSessionDuration' },
      { name: 'engagementRate' },
      { name: 'bounceRate' },
      { name: 'screenPageViewsPerSession' },
    ]
    const mapRows = (rows) =>
      (rows || []).map((row) => ({
        pagePath: row.dimensionValues[0].value,
        sessions: Number(row.metricValues[0].value),
        avgSessionDuration: Number(row.metricValues[1].value),
        engagementRate: Number(row.metricValues[2].value),
        bounceRate: Number(row.metricValues[3]?.value || 0),
        pagesPerSession: Number(row.metricValues[4]?.value || 0),
      }))

    const [response, prevResponse] = await Promise.all([
      ga4RunReport(token, propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: reportDimensions,
        metrics: reportMetrics,
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      }),
      prevStart <= prevEnd ? ga4RunReport(token, propertyId, {
        dateRanges: [{ startDate: prevStart, endDate: prevEnd }],
        dimensions: reportDimensions,
        metrics: reportMetrics,
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 100,
      }) : Promise.resolve({ rows: [] }),
    ])

    res.json({
      metric: 'traffic_drivers',
      value: mapRows(response.rows),
      previousPeriod: mapRows(prevResponse.rows),
      date_range: { startDate, endDate },
      previous_date_range: { startDate: prevStart, endDate: prevEnd },
    })
  } catch (err) {
    console.error('GA4 traffic-drivers error:', err.message)
    errorResponse(res, 500, err.message, 'API_ERROR', req.originalUrl)
  }
})

// ─── Traffic by Source Over Time ──────────────────────────────────────

app.get('/api/metrics/traffic-by-source-over-time', requireAuth, async (req, res) => {
  const propertyId = sanitizeParam(req.query.propertyId)
  const startDate = req.query.startDate || '90daysAgo'
  const endDate = req.query.endDate || 'today'

  if (!propertyId) return errorResponse(res, 400, 'propertyId is required', 'MISSING_PARAM', req.originalUrl)
  if (req.query.startDate && !validateDateFormat(req.query.startDate) && req.query.startDate !== '90daysAgo') {
    return errorResponse(res, 400, 'startDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }
  if (req.query.endDate && !validateDateFormat(req.query.endDate) && req.query.endDate !== 'today') {
    return errorResponse(res, 400, 'endDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }

  const cacheKey = `traffic-by-source-over-time:${propertyId}:${startDate}:${endDate}`
  const cached = getCached(cacheKey)
  if (cached) return res.json({ ...cached, _cached: true })

  try {
    const accessToken = await getValidAccessToken(req.googleTokens, req.userId)
    const response = await ga4RunReport(accessToken, propertyId, {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: 10000,
    })

    // Build a map: date -> channel -> sessions
    const dateChannelMap = {}
    const channelSet = new Set()
    for (const row of (response.rows || [])) {
      const dateStr = row.dimensionValues[0].value // YYYYMMDD
      const channel = row.dimensionValues[1].value
      const sessions = Number(row.metricValues[0].value)
      channelSet.add(channel)
      if (!dateChannelMap[dateStr]) dateChannelMap[dateStr] = {}
      dateChannelMap[dateStr][channel] = (dateChannelMap[dateStr][channel] || 0) + sessions
    }

    const dates = Object.keys(dateChannelMap).sort()
    const channels = [...channelSet].sort()
    const series = {}
    for (const ch of channels) {
      series[ch] = dates.map((d) => dateChannelMap[d][ch] || 0)
    }

    const result = { channels, dates, series, date_range: { startDate, endDate } }
    setCache(cacheKey, result, TTL_1H)
    res.json(result)
  } catch (err) {
    console.error('GA4 traffic-by-source-over-time error:', err.message)
    errorResponse(res, 500, err.message, 'API_ERROR', req.originalUrl)
  }
})

// ─── New vs Returning Visitors ────────────────────────────────────────

app.get('/api/metrics/new-vs-returning', requireAuth, async (req, res) => {
  const propertyId = sanitizeParam(req.query.propertyId)
  const startDate = req.query.startDate || '30daysAgo'
  const endDate = req.query.endDate || 'today'
  if (!propertyId) return errorResponse(res, 400, 'propertyId is required', 'MISSING_PARAM', req.originalUrl)
  try {
    const response = await ga4RunReport(
      (await getValidAccessToken(req.googleTokens, req.userId)),
      propertyId,
      {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'newVsReturning' }],
        metrics: [
          { name: 'sessions' },
          { name: 'engagementRate' },
          { name: 'bounceRate' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      }
    )
    const value = (response.rows || []).map(row => ({
      type: row.dimensionValues[0].value,
      sessions: Number(row.metricValues[0].value),
      engagementRate: parseFloat(Number(row.metricValues[1].value).toFixed(4)),
      bounceRate: parseFloat(Number(row.metricValues[2].value).toFixed(4)),
    }))
    res.json({ metric: 'new_vs_returning', value, date_range: { startDate, endDate } })
  } catch (err) {
    console.error('GA4 new-vs-returning error:', err.message)
    errorResponse(res, 500, err.message, 'API_ERROR', req.originalUrl)
  }
})

// ─── Traffic US by Source Over Time ───────────────────────────────────

app.get('/api/metrics/traffic-us-by-source-over-time', requireAuth, async (req, res) => {
  const propertyId = sanitizeParam(req.query.propertyId)
  const startDate = req.query.startDate || '90daysAgo'
  const endDate = req.query.endDate || 'today'

  if (!propertyId) return errorResponse(res, 400, 'propertyId is required', 'MISSING_PARAM', req.originalUrl)
  if (req.query.startDate && !validateDateFormat(req.query.startDate) && req.query.startDate !== '90daysAgo') {
    return errorResponse(res, 400, 'startDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }
  if (req.query.endDate && !validateDateFormat(req.query.endDate) && req.query.endDate !== 'today') {
    return errorResponse(res, 400, 'endDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }

  const cacheKey = `traffic-us-by-source-over-time:${propertyId}:${startDate}:${endDate}`
  const cached = getCached(cacheKey)
  if (cached) return res.json({ ...cached, _cached: true })

  try {
    const accessToken = await getValidAccessToken(req.googleTokens, req.userId)
    const response = await ga4RunReport(accessToken, propertyId, {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      dimensionFilter: {
        filter: {
          fieldName: 'country',
          stringFilter: { matchType: 'EXACT', value: 'United States' },
        },
      },
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: 10000,
    })

    const displayChannels = new Set(['Direct', 'Email', 'Organic Search', 'Organic Social', 'Referral'])

    // Build a map: date -> channel -> sessions (all channels, no filter)
    const dateChannelMap = {}
    for (const row of (response.rows || [])) {
      const dateStr = row.dimensionValues[0].value
      const channel = row.dimensionValues[1].value
      const sessions = Number(row.metricValues[0].value)
      if (!dateChannelMap[dateStr]) dateChannelMap[dateStr] = {}
      dateChannelMap[dateStr][channel] = (dateChannelMap[dateStr][channel] || 0) + sessions
    }

    const dates = Object.keys(dateChannelMap).sort()
    const channels = [...displayChannels]
    const series = {}
    // Series only includes display channels (for chart rendering)
    for (const ch of channels) {
      series[ch] = dates.map((d) => dateChannelMap[d][ch] || 0)
    }
    // USA Total: sum of ALL channels per day (true US total, not just display channels)
    const usaTotals = dates.map((d) => {
      return Object.values(dateChannelMap[d]).reduce((sum, v) => sum + v, 0)
    })

    const result = { channels, dates, series, usaTotals, date_range: { startDate, endDate } }
    setCache(cacheKey, result, TTL_1H)
    res.json(result)
  } catch (err) {
    console.error('GA4 traffic-us-by-source-over-time error:', err.message)
    errorResponse(res, 500, err.message, 'API_ERROR', req.originalUrl)
  }
})

// ─── GSC Endpoints ────────────────────────────────────────────────────

app.get('/api/metrics/impressions', requireAuth, async (req, res) => {
  const siteUrl = sanitizeParam(req.query.siteUrl)
  if (!siteUrl) return errorResponse(res, 400, 'siteUrl is required', 'MISSING_PARAM', req.originalUrl)
  if (req.query.startDate && !validateDateFormat(req.query.startDate)) {
    return errorResponse(res, 400, 'startDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }
  if (req.query.endDate && !validateDateFormat(req.query.endDate)) {
    return errorResponse(res, 400, 'endDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }

  const end = req.query.endDate || new Date().toISOString().split('T')[0]
  const start = req.query.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const auth = createGoogleAuth(req.googleTokens); await getValidAccessToken(req.googleTokens, req.userId).catch(() => {})
  const searchConsole = google.searchconsole({ version: 'v1', auth })
  const urlVariants = getSiteUrlVariants(siteUrl)

  let lastError = null
  for (const url of urlVariants) {
    try {
      const totalRes = await searchConsole.searchanalytics.query({
        siteUrl: url,
        requestBody: { startDate: start, endDate: end, dimensions: [] },
      })
      const dailyRes = await searchConsole.searchanalytics.query({
        siteUrl: url,
        requestBody: { startDate: start, endDate: end, dimensions: ['date'], rowLimit: 500 },
      })

      const row = totalRes.data.rows?.[0]
      const daily = (dailyRes.data.rows || []).map((r) => ({
        date: r.keys[0],
        impressions: Math.round(r.impressions || 0),
        clicks: Math.round(r.clicks || 0),
        ctr: r.ctr ? Math.round(r.ctr * 10000) / 100 : 0,
      }))

      return res.json({
        metric: 'impressions',
        value: {
          impressions: Math.round(row?.impressions || 0),
          clicks: Math.round(row?.clicks || 0),
          ctr: row?.ctr ? Math.round(row.ctr * 10000) / 100 : 0,
          position: row?.position ? Math.round(row.position * 10) / 10 : 0,
          daily,
        },
        siteUrl: url,
        date_range: { startDate: start, endDate: end },
      })
    } catch (err) {
      lastError = err
    }
  }

  console.error('GSC impressions error:', lastError?.message)
  errorResponse(res, 500, lastError?.message || 'Failed to fetch Search Console data', 'API_ERROR', req.originalUrl)
})

app.get('/api/metrics/keyword-rankings', requireAuth, async (req, res) => {
  const siteUrl = sanitizeParam(req.query.siteUrl)
  if (!siteUrl) return errorResponse(res, 400, 'siteUrl is required', 'MISSING_PARAM', req.originalUrl)
  if (req.query.startDate && !validateDateFormat(req.query.startDate)) {
    return errorResponse(res, 400, 'startDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }
  if (req.query.endDate && !validateDateFormat(req.query.endDate)) {
    return errorResponse(res, 400, 'endDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }

  const end = req.query.endDate || new Date().toISOString().split('T')[0]
  const start = req.query.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const rowLimit = parseInt(req.query.limit) || 25000

  const auth = createGoogleAuth(req.googleTokens); await getValidAccessToken(req.googleTokens, req.userId).catch(() => {})
  const searchConsole = google.searchconsole({ version: 'v1', auth })
  const urlVariants = getSiteUrlVariants(siteUrl)

  let lastError = null
  for (const url of urlVariants) {
    try {
      const result = await searchConsole.searchanalytics.query({
        siteUrl: url,
        requestBody: {
          startDate: start,
          endDate: end,
          dimensions: ['query'],
          rowLimit,
        },
      })

      const keywords = (result.data.rows || [])
        .sort((a, b) => b.impressions - a.impressions)
        .map((r) => ({
          query: r.keys[0],
          clicks: Math.round(r.clicks || 0),
          impressions: Math.round(r.impressions || 0),
          ctr: r.ctr ? Math.round(r.ctr * 10000) / 100 : 0,
          position: r.position ? Math.round(r.position * 10) / 10 : 0,
        }))

      return res.json({
        metric: 'keyword-rankings',
        value: keywords,
        siteUrl: url,
        date_range: { startDate: start, endDate: end },
      })
    } catch (err) {
      lastError = err
    }
  }

  console.error('GSC keyword-rankings error:', lastError?.message)
  errorResponse(res, 500, lastError?.message || 'Failed to fetch keyword rankings', 'API_ERROR', req.originalUrl)
})

// ─── GSC Coverage (TECH02) ───────────────────────────────────────────

app.get('/api/metrics/gsc-coverage', requireAuth, async (req, res) => {
  const siteUrl = sanitizeParam(req.query.siteUrl)
  if (!siteUrl) return errorResponse(res, 400, 'siteUrl is required', 'MISSING_PARAM', req.originalUrl)

  const cacheKey = `gsc-coverage:${siteUrl}`
  const cached = getCached(cacheKey)
  if (cached) return res.json(cached)

  const auth = createGoogleAuth(req.googleTokens); await getValidAccessToken(req.googleTokens, req.userId).catch(() => {})
  const searchConsole = google.searchconsole({ version: 'v1', auth })
  const urlVariants = getSiteUrlVariants(siteUrl)

  let lastError = null
  for (const url of urlVariants) {
    try {
      // Try sitemaps.list first to get indexed page counts
      let indexedPages = 0
      try {
        const sitemapsRes = await searchConsole.sitemaps.list({ siteUrl: url })
        const sitemaps = sitemapsRes.data.sitemap || []
        for (const sm of sitemaps) {
          indexedPages += parseInt(sm.contents?.[0]?.indexed || 0)
        }
      } catch { /* sitemaps API may not be available */ }

      // Fallback: use pages with impressions as proxy
      const end = new Date().toISOString().split('T')[0]
      const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const pageRes = await searchConsole.searchanalytics.query({
        siteUrl: url,
        requestBody: { startDate: start, endDate: end, dimensions: ['page'], rowLimit: 25000 },
      })
      const pagesWithImpressions = (pageRes.data.rows || []).length
      const totalImpressions = (pageRes.data.rows || []).reduce((sum, r) => sum + Math.round(r.impressions || 0), 0)

      const result = {
        metric: 'gsc_coverage',
        indexedPages: indexedPages || pagesWithImpressions,
        pagesWithImpressions,
        totalImpressions,
        siteUrl: url,
        fetched_at: new Date().toISOString(),
      }
      setCache(cacheKey, result, TTL_1H)
      return res.json(result)
    } catch (err) {
      lastError = err
    }
  }

  console.error('GSC coverage error:', lastError?.message)
  errorResponse(res, 500, lastError?.message || 'Failed to fetch GSC coverage', 'API_ERROR', req.originalUrl)
})

// ─── GSC Mobile Usability (TECH03) ──────────────────────────────────

app.get('/api/metrics/gsc-mobile', requireAuth, async (req, res) => {
  const siteUrl = sanitizeParam(req.query.siteUrl)
  if (!siteUrl) return errorResponse(res, 400, 'siteUrl is required', 'MISSING_PARAM', req.originalUrl)
  if (req.query.startDate && !validateDateFormat(req.query.startDate)) {
    return errorResponse(res, 400, 'startDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }
  if (req.query.endDate && !validateDateFormat(req.query.endDate)) {
    return errorResponse(res, 400, 'endDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }

  const end = req.query.endDate || new Date().toISOString().split('T')[0]
  const start = req.query.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const cacheKey = `gsc-mobile:${siteUrl}:${start}:${end}`
  const cached = getCached(cacheKey)
  if (cached) return res.json(cached)

  const auth = createGoogleAuth(req.googleTokens); await getValidAccessToken(req.googleTokens, req.userId).catch(() => {})
  const searchConsole = google.searchconsole({ version: 'v1', auth })
  const urlVariants = getSiteUrlVariants(siteUrl)

  let lastError = null
  for (const url of urlVariants) {
    try {
      const deviceRes = await searchConsole.searchanalytics.query({
        siteUrl: url,
        requestBody: { startDate: start, endDate: end, dimensions: ['device'] },
      })

      const devices = { MOBILE: { clicks: 0, impressions: 0, ctr: 0, position: 0 }, DESKTOP: { clicks: 0, impressions: 0, ctr: 0, position: 0 }, TABLET: { clicks: 0, impressions: 0, ctr: 0, position: 0 } }
      for (const row of (deviceRes.data.rows || [])) {
        const key = row.keys[0]
        if (devices[key]) {
          devices[key] = {
            clicks: Math.round(row.clicks || 0),
            impressions: Math.round(row.impressions || 0),
            ctr: row.ctr ? Math.round(row.ctr * 10000) / 100 : 0,
            position: row.position ? Math.round(row.position * 10) / 10 : 0,
          }
        }
      }

      const totalClicks = devices.MOBILE.clicks + devices.DESKTOP.clicks + devices.TABLET.clicks
      const mobilePercent = totalClicks > 0 ? Math.round(devices.MOBILE.clicks / totalClicks * 10000) / 100 : 0

      const result = {
        metric: 'gsc_mobile',
        mobile: devices.MOBILE,
        desktop: devices.DESKTOP,
        tablet: devices.TABLET,
        mobilePercent,
        siteUrl: url,
        date_range: { startDate: start, endDate: end },
      }
      setCache(cacheKey, result, TTL_1H)
      return res.json(result)
    } catch (err) {
      lastError = err
    }
  }

  console.error('GSC mobile error:', lastError?.message)
  errorResponse(res, 500, lastError?.message || 'Failed to fetch GSC mobile data', 'API_ERROR', req.originalUrl)
})

// ─── GSC Structured Data / Search Types (TECH05) ────────────────────

app.get('/api/metrics/gsc-structured-data', requireAuth, async (req, res) => {
  const siteUrl = sanitizeParam(req.query.siteUrl)
  if (!siteUrl) return errorResponse(res, 400, 'siteUrl is required', 'MISSING_PARAM', req.originalUrl)
  if (req.query.startDate && !validateDateFormat(req.query.startDate)) {
    return errorResponse(res, 400, 'startDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }
  if (req.query.endDate && !validateDateFormat(req.query.endDate)) {
    return errorResponse(res, 400, 'endDate must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }

  const end = req.query.endDate || new Date().toISOString().split('T')[0]
  const start = req.query.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const cacheKey = `gsc-structured:${siteUrl}:${start}:${end}`
  const cached = getCached(cacheKey)
  if (cached) return res.json(cached)

  const auth = createGoogleAuth(req.googleTokens); await getValidAccessToken(req.googleTokens, req.userId).catch(() => {})
  const searchConsole = google.searchconsole({ version: 'v1', auth })
  const urlVariants = getSiteUrlVariants(siteUrl)

  let lastError = null
  for (const url of urlVariants) {
    try {
      const searchTypes = ['web', 'image', 'video']
      const data = {}

      for (const type of searchTypes) {
        try {
          const typeRes = await searchConsole.searchanalytics.query({
            siteUrl: url,
            requestBody: { startDate: start, endDate: end, dimensions: [], type },
          })
          const row = typeRes.data.rows?.[0]
          data[type] = {
            clicks: Math.round(row?.clicks || 0),
            impressions: Math.round(row?.impressions || 0),
            ctr: row?.ctr ? Math.round(row.ctr * 10000) / 100 : 0,
            position: row?.position ? Math.round(row.position * 10) / 10 : 0,
          }
        } catch {
          data[type] = { clicks: 0, impressions: 0, ctr: 0, position: 0 }
        }
      }

      const result = {
        metric: 'gsc_structured_data',
        web: data.web,
        image: data.image,
        video: data.video,
        siteUrl: url,
        date_range: { startDate: start, endDate: end },
      }
      setCache(cacheKey, result, TTL_1H)
      return res.json(result)
    } catch (err) {
      lastError = err
    }
  }

  console.error('GSC structured-data error:', lastError?.message)
  errorResponse(res, 500, lastError?.message || 'Failed to fetch GSC structured data', 'API_ERROR', req.originalUrl)
})

// ─── Ahrefs Endpoints ────────────────────────────────────────────────

const AHREFS_BASE = 'https://api.ahrefs.com/v3'
const AHREFS_API_KEY = process.env.AHREFS_API_KEY

// Project IDs the Ahrefs API doesn't return in the default listing (older projects)
const AHREFS_EXTRA_PROJECT_IDS = (process.env.AHREFS_EXTRA_PROJECT_IDS || '').split(',').filter(Boolean)

app.get('/api/clients', requireJWT, async (req, res) => {
  try {
    const headers = { Authorization: `Bearer ${AHREFS_API_KEY}` }

    // Fetch default project list
    const response = await fetch(`${AHREFS_BASE}/site-audit/projects`, { headers })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Ahrefs API error (${response.status}): ${body}`)
    }
    const data = await response.json()
    const seen = new Set()
    const clients = (data.healthscores || []).map((p) => {
      seen.add(p.project_id)
      return { label: p.project_name, value: p.target_url.replace(/\/+$/, '') }
    })

    // Fetch any extra project IDs not returned by the default listing
    const extraIds = AHREFS_EXTRA_PROJECT_IDS.filter(id => !seen.has(id))
    if (extraIds.length) {
      const extras = await Promise.all(extraIds.map(id =>
        fetch(`${AHREFS_BASE}/site-audit/projects?project_id=${id}`, { headers })
          .then(r => r.json())
          .then(d => (d.healthscores || []).map(p => ({ label: p.project_name, value: p.target_url.replace(/\/+$/, '') })))
          .catch(() => [])
      ))
      extras.flat().forEach(p => clients.push(p))
    }

    clients.sort((a, b) => a.label.localeCompare(b.label))
    setAhrefsCache('clients', clients)
    res.json(clients)
  } catch (err) {
    console.error('Ahrefs clients error:', err.message)
    const dc = getAhrefsCached('clients')
    if (dc) return res.json(dc.data)
    res.json([])
  }
})

app.get('/api/metrics/domain-rating', requireJWT, async (req, res) => {
  const target = sanitizeParam(req.query.target)
  if (!target) return errorResponse(res, 400, 'target is required', 'MISSING_PARAM', req.originalUrl)
  if (req.query.date && !validateDateFormat(req.query.date)) {
    return errorResponse(res, 400, 'date must be YYYY-MM-DD format', 'INVALID_FORMAT', req.originalUrl)
  }

  const d = req.query.date || new Date().toISOString().split('T')[0]
  try {
    const url = `${AHREFS_BASE}/site-explorer/domain-rating?target=${encodeURIComponent(target)}&date=${d}`
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${AHREFS_API_KEY}` },
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Ahrefs API error (${response.status}): ${body}`)
    }
    const data = await response.json()
    const drData = { metric: 'domain_rating', value: data.domain_rating, date: d }
    setCache(`domain-rating:${target}:${d}`, drData, TTL_7D)
    setAhrefsCache(`domain-rating:${target}`, drData)
    res.json(drData)
  } catch (err) {
    console.error('Ahrefs domain-rating error:', err.message)
    const dc1 = getAhrefsCached(`domain-rating:${target}`)
    if (dc1) return res.json({ ...dc1.data, _cached: true, _cachedAt: dc1.savedAt })
    res.json({ metric: 'domain_rating', value: { domain_rating: 0, ahrefs_rank: null }, date: d, _error: err.message })
  }
})

app.get('/api/metrics/backlinks', requireJWT, async (req, res) => {
  const target = sanitizeParam(req.query.target)
  if (!target) return errorResponse(res, 400, 'target is required', 'MISSING_PARAM', req.originalUrl)

  const cacheKey = `backlinks:${target}`
  const cached = getCached(cacheKey)
  if (cached) return res.json({ ...cached, _cached: true })

  const d = req.query.date || new Date().toISOString().split('T')[0]
  try {
    const url = `${AHREFS_BASE}/site-explorer/backlinks-stats?target=${encodeURIComponent(target)}&mode=domain&date=${d}`
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${AHREFS_API_KEY}` },
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Ahrefs API error (${response.status}): ${body}`)
    }
    const data = await response.json()
    const m = data.metrics || {}
    const blData = {
      metric: 'backlinks',
      value: {
        live_backlinks: m.live || 0,
        all_time_backlinks: m.all_time || 0,
        live_refdomains: m.live_refdomains || 0,
        all_time_refdomains: m.all_time_refdomains || 0,
      },
      date: d,
    }
    setCache(`backlinks:${target}`, blData, TTL_7D)
    setAhrefsCache(`backlinks:${target}`, blData)
    res.json(blData)
  } catch (err) {
    console.error('Ahrefs backlinks error:', err.message)
    const dc2 = getAhrefsCached(`backlinks:${target}`)
    if (dc2) return res.json({ ...dc2.data, _cached: true, _cachedAt: dc2.savedAt })
    res.json({ metric: 'backlinks', value: { live_backlinks: 0, all_time_backlinks: 0, live_refdomains: 0, all_time_refdomains: 0 }, date: d, _error: err.message })
  }
})

app.get('/api/metrics/site-health', requireJWT, async (req, res) => {
  const target = sanitizeParam(req.query.target)
  if (!target) return errorResponse(res, 400, 'target is required', 'MISSING_PARAM', req.originalUrl)

  try {
    const url = `${AHREFS_BASE}/site-audit/projects`
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${AHREFS_API_KEY}` },
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Ahrefs API error (${response.status}): ${body}`)
    }
    const data = await response.json()
    const cleanTarget = target.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '')
    const project = (data.healthscores || []).find((p) => {
      const pUrl = p.target_url.replace(/^www\./, '').replace(/\/$/, '')
      return pUrl.includes(cleanTarget) || cleanTarget.includes(pUrl)
    })

    if (!project) {
      return res.json({
        metric: 'site_health',
        value: null,
        error: 'Domain not found in Ahrefs Site Audit projects',
      })
    }

    const shData = {
      metric: 'site_health',
      value: {
        health_score: project.health_score,
        urls_with_errors: project.urls_with_errors,
        urls_with_warnings: project.urls_with_warnings,
        urls_with_notices: project.urls_with_notices,
        total: project.total,
        project_name: project.project_name,
        date: project.date,
        status: project.status,
      },
    }
    setCache(`site-health:${target}`, shData, TTL_7D)
    setAhrefsCache(`site-health:${target}`, shData)
    res.json(shData)
  } catch (err) {
    console.error('Ahrefs site-health error:', err.message)
    const dc3 = getAhrefsCached(`site-health:${target}`)
    if (dc3) return res.json({ ...dc3.data, _cached: true, _cachedAt: dc3.savedAt })
    res.json({ metric: 'site_health', value: null, _error: err.message })
  }
})

app.get('/api/metrics/site-audit-issues', requireJWT, async (req, res) => {
  const target = sanitizeParam(req.query.target)
  if (!target) return errorResponse(res, 400, 'target is required', 'MISSING_PARAM', req.originalUrl)

  try {
    const projRes = await fetch(`${AHREFS_BASE}/site-audit/projects`, {
      headers: { Authorization: `Bearer ${AHREFS_API_KEY}` },
    })
    if (!projRes.ok) {
      const body = await projRes.text()
      throw new Error(`Ahrefs API error (${projRes.status}): ${body}`)
    }
    const projData = await projRes.json()
    const cleanTarget = target.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '')
    const project = (projData.healthscores || []).find((p) => {
      const pUrl = p.target_url.replace(/^www\./, '').replace(/\/$/, '')
      return pUrl.includes(cleanTarget) || cleanTarget.includes(pUrl)
    })

    if (!project) {
      return res.json({ error: 'Domain not found in Ahrefs Site Audit projects' })
    }

    const issuesRes = await fetch(
      `${AHREFS_BASE}/site-audit/issues?project_id=${project.project_id}`,
      { headers: { Authorization: `Bearer ${AHREFS_API_KEY}` } }
    )
    if (!issuesRes.ok) {
      const body = await issuesRes.text()
      throw new Error(`Ahrefs API error (${issuesRes.status}): ${body}`)
    }
    const issuesData = await issuesRes.json()

    const importanceOrder = { Error: 0, Warning: 1, Notice: 2 }
    const activeIssues = (issuesData.issues || [])
      .sort((a, b) => (importanceOrder[a.importance] ?? 3) - (importanceOrder[b.importance] ?? 3))

    const crawlSnapshot = {
      health_score: project.health_score,
      urls_with_errors: project.urls_with_errors,
      urls_with_warnings: project.urls_with_warnings,
      urls_with_notices: project.urls_with_notices,
      total: project.total,
      date: project.date,
    }
    saveFirstCrawl(target, crawlSnapshot)

    const auditData = {
      project_name: project.project_name,
      health_score: project.health_score,
      urls_with_errors: project.urls_with_errors,
      urls_with_warnings: project.urls_with_warnings,
      urls_with_notices: project.urls_with_notices,
      total: project.total,
      issues: activeIssues,
      date: project.date,
      first_crawl: getFirstCrawl(target),
    }
    setCache(`site-audit:${target}`, auditData, TTL_7D)
    setAhrefsCache(`site-audit:${target}`, auditData)
    res.json(auditData)
  } catch (err) {
    console.error('Ahrefs site-audit-issues error:', err.message)
    const dc4 = getAhrefsCached(`site-audit:${target}`)
    if (dc4) return res.json({ ...dc4.data, first_crawl: getFirstCrawl(target), _cached: true, _cachedAt: dc4.savedAt })
    res.json({ project_name: null, health_score: null, urls_with_errors: 0, urls_with_warnings: 0, urls_with_notices: 0, total: 0, issues: [], first_crawl: getFirstCrawl(target), _error: err.message })
  }
})

// ─── Backlinks History (weekly) ──────────────────────────────────────
app.get('/api/metrics/backlinks-history', requireJWT, async (req, res) => {
  const target = sanitizeParam(req.query.target)
  if (!target) return errorResponse(res, 400, 'target is required', 'MISSING_PARAM', req.originalUrl)

  const weeks = Math.min(Math.max(parseInt(req.query.weeks, 10) || 10, 1), 52)

  const cacheKey = `backlinks-history:${target}:${weeks}`
  const cached = getCached(cacheKey)
  if (cached) return res.json({ ...cached, _cached: true })

  try {
    // Build Monday dates for the last N weeks
    const mondayDates = []
    const now = new Date()
    for (let i = 0; i < weeks; i++) {
      const d = new Date(now)
      d.setDate(d.getDate() - d.getDay() - 7 * i + 1) // Monday of week
      mondayDates.push(d.toISOString().split('T')[0])
    }

    // Fetch backlinks-stats and domain-rating for each week in parallel
    const results = await Promise.all(
      mondayDates.map(async (date) => {
        const [blRes, drRes] = await Promise.all([
          fetch(
            `${AHREFS_BASE}/site-explorer/backlinks-stats?target=${encodeURIComponent(target)}&mode=domain&date=${date}`,
            { headers: { Authorization: `Bearer ${AHREFS_API_KEY}` } }
          ),
          fetch(
            `${AHREFS_BASE}/site-explorer/domain-rating?target=${encodeURIComponent(target)}&date=${date}`,
            { headers: { Authorization: `Bearer ${AHREFS_API_KEY}` } }
          ),
        ])
        if (!blRes.ok) {
          const body = await blRes.text()
          throw new Error(`Ahrefs backlinks-stats error (${blRes.status}): ${body}`)
        }
        if (!drRes.ok) {
          const body = await drRes.text()
          throw new Error(`Ahrefs domain-rating error (${drRes.status}): ${body}`)
        }
        const blData = await blRes.json()
        const drData = await drRes.json()
        return {
          date,
          backlinks: (blData.metrics || {}).live || 0,
          domain_rating: drData.domain_rating || 0,
        }
      })
    )

    // Sort oldest → newest
    results.sort((a, b) => a.date.localeCompare(b.date))

    // Build week labels and compute WoW change %
    const weeksData = results.map((r, i) => {
      const d = new Date(r.date)
      const dd = String(d.getDate()).padStart(2, '0')
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const yy = String(d.getFullYear()).slice(-2)
      const label = `WE${dd}${mm}${yy}`

      let change_pct = null
      if (i > 0 && results[i - 1].backlinks > 0) {
        change_pct = (((r.backlinks - results[i - 1].backlinks) / results[i - 1].backlinks) * 100).toFixed(2)
      }

      return {
        label,
        date: r.date,
        backlinks: r.backlinks,
        domain_rating: r.domain_rating,
        change_pct,
      }
    })

    const payload = { weeks: weeksData }
    setCache(cacheKey, payload, TTL_7D)
    setAhrefsCache(`backlinks-history:${target}`, payload)
    res.json(payload)
  } catch (err) {
    console.error('Ahrefs backlinks-history error:', err.message)
    const dc = getAhrefsCached(`backlinks-history:${target}`)
    if (dc) {
      console.log(`[ahrefs] Serving disk-cached backlinks-history for ${target}`)
      return res.json({ ...dc.data, _cached: true, _cachedAt: dc.savedAt })
    }
    res.json({ weeks: [], _error: err.message })
  }
})

// ─── AI Grader Endpoint ──────────────────────────────────────────────

app.post('/api/grader/score', requireJWT, (req, res) => {
  const { siteHealth, domainRating, usTrafficPercent, impressionsCtr, totalSessions, keywordsInTop10 } = req.body

  const rules = [
    { name: 'Site Health', value: siteHealth, pass: 80, warn: 50, unit: '%', description: 'Ahrefs Site Audit health score' },
    { name: 'Domain Rating', value: domainRating, pass: 40, warn: 20, unit: '', description: 'Ahrefs Domain Rating (0–100)' },
    { name: 'US Traffic %', value: usTrafficPercent, pass: 30, warn: 15, unit: '%', description: 'Percentage of traffic from the United States' },
    { name: 'Impressions CTR', value: impressionsCtr, pass: 2, warn: 1, unit: '%', description: 'Google Search Console click-through rate' },
    { name: 'Total Sessions', value: totalSessions, pass: 500, warn: 200, unit: '', description: 'Total GA4 sessions in date range' },
    { name: 'Keywords in Top 10', value: keywordsInTop10, pass: 5, warn: 2, unit: '', description: 'Keywords ranking in positions 1–10' },
  ]

  const metrics = rules.map((r) => {
    const v = Number(r.value) || 0
    let status, points
    if (v >= r.pass) { status = 'pass'; points = 2 }
    else if (v >= r.warn) { status = 'warning'; points = 1 }
    else { status = 'fail'; points = 0 }
    return {
      name: r.name,
      value: v,
      status,
      points,
      threshold: `≥${r.pass} pass, ≥${r.warn} warning`,
      description: r.description,
    }
  })

  const score = metrics.reduce((sum, m) => sum + m.points, 0)
  const maxScore = 12
  const percentage = Math.round((score / maxScore) * 100)

  let grade
  if (score >= 11) grade = 'A'
  else if (score >= 9) grade = 'B'
  else if (score >= 7) grade = 'C'
  else if (score >= 5) grade = 'D'
  else grade = 'F'

  const summaries = {
    A: 'Excellent SEO health! All key metrics are performing well.',
    B: 'Good SEO performance with minor areas to improve.',
    C: 'Average SEO health. Several metrics need attention.',
    D: 'Poor SEO health. Significant improvements needed.',
    F: 'Critical SEO issues detected. Immediate action required.',
  }

  res.json({ grade, score, maxScore, percentage, metrics, summary: summaries[grade] })
})

// ─── User Properties (GA4 + GSC) ─────────────────────────────────────
// Returns GA4 properties and GSC sites the logged-in user has access to

app.get('/api/user/properties', requireAuth, async (req, res) => {
  try {
    const accessToken = await getValidAccessToken(req.googleTokens, req.userId)

    // Fetch GA4 account summaries (all properties user has access to)
    const ga4Res = await fetch(
      'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const ga4Data = await ga4Res.json()
    const ga4Properties = []
    for (const account of ga4Data.accountSummaries || []) {
      for (const prop of account.propertySummaries || []) {
        ga4Properties.push({
          id: prop.property.replace('properties/', ''),
          name: prop.displayName,
          account: account.displayName,
        })
      }
    }

    // Fetch GSC sites
    const auth = createGoogleAuth(req.googleTokens)
    const searchConsole = google.searchconsole({ version: 'v1', auth })
    const gscRes = await searchConsole.sites.list()
    const gscSites = (gscRes.data.siteEntry || []).map((s) => ({
      url: s.siteUrl,
      permissionLevel: s.permissionLevel,
    }))

    res.json({ ga4Properties, gscSites })
  } catch (err) {
    console.error('user/properties error:', err.message)
    errorResponse(res, 500, err.message, 'API_ERROR', req.originalUrl)
  }
})

app.listen(PORT, () => {
  console.log(`Auth server running on http://localhost:${PORT}`)
})
