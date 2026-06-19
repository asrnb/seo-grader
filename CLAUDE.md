# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Run both frontend and backend concurrently (recommended)
npm run dev:all

# Run frontend only (Vite, port 5173)
npm run dev

# Run backend only (Express, port 3001)
npm run dev:server

# Production build
npm run build

# Preview production build
npm run preview
```

There are no test or lint scripts configured.

## Environment Setup

Two separate `.env` files are required:

**`.env`** (frontend, copy from `.env.example`):
```
VITE_GOOGLE_CLIENT_ID=
VITE_GA4_PROPERTY_ID=
VITE_GSC_SITE_URL=
VITE_AHREFS_API_KEY=
```

**`server/.env`** (backend):
```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
REDIRECT_URI=http://localhost:5173/auth/callback
JWT_SECRET=
ALLOWED_DOMAIN=callboxinc.com
```

## Architecture

**Stack:** Vue 3 (Composition API) + Vite + Tailwind CSS v4 + PrimeVue 4 / Express 5 backend.

### Authentication Flow

1. User clicks "Sign in with Google" on `/login`
2. Frontend redirects to `GET /api/auth/google` on the Express server (port 3001)
3. Google OAuth redirects to `GET /api/auth/callback` — server validates email domain (`@callboxinc.com`), issues an 8-hour JWT
4. JWT stored in `localStorage`; Google OAuth tokens stored in an in-memory `Map` keyed by user ID
5. All metric API calls send JWT as `Authorization: Bearer <token>`

### Data Flow

Dashboard → Pinia `metricsStore` → `src/services/metricsApi.js` (adds Bearer token) → Express backend → Google Analytics 4 / Google Search Console APIs → JSON response back to Vue components.

### Key Files

| Path | Role |
|------|------|
| `server/index.js` | Single Express file with all 8 endpoints (auth + 5 metrics) |
| `src/stores/auth.js` | Pinia store: user, token, isAuthenticated, login/logout/checkAuth |
| `src/stores/metrics.js` | Pinia store: 5 metric refs + loading/error states + `loadAll()` |
| `src/services/metricsApi.js` | API client functions that attach the JWT |
| `src/router/index.js` | Route guards: redirects unauthenticated users to `/login`, authenticated users away from `/login` |
| `src/views/Dashboard.vue` | Main view — PrimeVue Cards + DataTable + DatePicker |
| `src/views/AuthCallback.vue` | Handles OAuth redirect, extracts token from URL, updates auth store |

### Backend Endpoints

**Auth:**
- `GET /api/auth/google` — redirect to Google consent screen
- `GET /api/auth/callback?code=` — exchange code, issue JWT
- `GET /api/auth/me` — verify JWT, return user info
- `POST /api/auth/logout` — clear token from in-memory store

**Metrics** (all require Bearer JWT, accept `startDate`/`endDate` query params, default to last 30 days):
- `GET /api/metrics/total-traffic?propertyId=` — GA4 sessions + users
- `GET /api/metrics/traffic-by-source?propertyId=` — GA4 breakdown by channel
- `GET /api/metrics/traffic-from-us?propertyId=` — GA4 US traffic percentage
- `GET /api/metrics/traffic-drivers?propertyId=` — GA4 top 10 pages
- `GET /api/metrics/impressions?siteUrl=` — GSC impressions, clicks, CTR, avg position (tries multiple URL format variants)

### Notable Constraints

- Google OAuth tokens are stored in-memory only — they are lost on server restart (development limitation)
- CORS is locked to `http://localhost:5173`
- Only `@callboxinc.com` Google accounts are permitted

## Session Notes

### Production Server
- IP: `REDACTED_HOST`
- User: `REDACTED_USER`
- Pass: `REDACTED_ROTATED_PASSWORD`
- App path: `~/apps/seo-ai-grader`
- Git NOT installed on server — deploy via `sshpass + scp` then `npm run build`
- Deploy command: `sshpass -p 'REDACTED_ROTATED_PASSWORD' scp -o StrictHostKeyChecking=no src/views/Dashboard.vue REDACTED_USER@REDACTED_HOST:~/apps/seo-ai-grader/src/views/Dashboard.vue && sshpass -p 'REDACTED_ROTATED_PASSWORD' ssh -o StrictHostKeyChecking=no REDACTED_USER@REDACTED_HOST "cd ~/apps/seo-ai-grader && npm run build"`

### 2026-03-23 (Session 1)
- User asked about memory from last session — confirmed no persistent memory between sessions
- User asked what server is accessible: Express backend (port 3001), Vite frontend (port 5173), Chrome browser automation via MCP tools
- User requested that session notes be updated in CLAUDE.md at the end of each session
- Production server identified: REDACTED_HOST (dev-user)

### 2026-03-23 (Session 2)
- Fixed weekly website impressions chart: removed Clicks/CTR, show Impressions only, added dot value labels synced to x-axis date ticks
- Improved all chart readability for large/all-time data: dataZoom slider, smart x-axis interval, K/M Y-axis formatting, hidden labels when crowded
- Set all chart canvas to 1222x400px
- Added blank option (non-breaking space) to GA4, GSC, and Ahrefs dropdowns
- Added fetch error message above Fetch All button when required fields are blank
- Added GA4 auto-select: choosing a GA4 property auto-matches and sets GSC + Ahrefs dropdowns via fuzzy domain matching; sets blank if no match

### 2026-03-24 (Session 3)
- Fixed first/last crawl donut chart layout overflow (width: 1222px inside flex → width: 100%)
- Added all charts to PDF export: impressions chart, tech health donuts, audit donut
- Cards/metrics now conditionally hidden and fetch skipped when data source is null (GA4/GSC/Ahrefs)
- Fixed Ahrefs domain selection overwriting GSC site dropdown (removed gscSiteUrl assignment in onClientChange)
- Removed hard validation requiring all sources before fetching
- Fixed broken pi-google icon on login page with real Google SVG logo + added loading state on sign-in button
- Confirmed nip.io is required for prod (Google OAuth rejects raw IPs); prod URL: http://REDACTED_HOST.nip.io:5173
- Implemented server-side first crawl cache (.first-crawl-cache.json) — stores first-ever health score per domain permanently; shown alongside latest crawl donut in Technical SEO Health
- server/index.js now deployed via scp alongside Dashboard.vue when backend changes are made
- PM2 manages 3 processes on prod: qa-review-ui-prod (0), seo-grader-backend (1), seo-grader-frontend (2)

### 2026-03-25 (Session 4)
- Today's tasks started from commit `bb5e1e8` (feat: include all charts in PDF export)
- Fixed auth: redirect raw IP to nip.io for consistent localStorage session (`dd93a1a`)
- Made dashboard fully responsive — fluid charts, mobile header/layout (`fe81139`)
- Fetch only on button click, renamed to "Fetch", blue Export PDF button (`0b67eef`)
- Moved datepicker to data sources row, fixed timezone date shift bug (`fc3a62d`)
- Added Daily/Weekly/Monthly/Quarterly report period selector (`2ebc063`)
- Fixed chart date labels: MM/DD/YY format and NaN labels on WE-prefixed weekly dates (`c049454`, `a4b4e73`)
- Attempted sticky data sources navbar — reverted (`3641fa9`, `4399465`, `56a9228`)
- Refactored PDF chart capture: `captureChartLarge()` uses `vchart.inst` (ECharts underlying instance) for reliable `getOption`/`setOption`
- Chart export height fixed at 700px
- Data point labels forced visible during export: fontSize 10, color matches series line color via palette fallback
- Date (x-axis) labels during export: fontSize 12, bold (matches legend default)
- Labels restored to original state after capture
- PDF page size: attempted 1920x1080px `@page` rule — reverted per user request
- Added 2-level metric filter (`70f89b3`): collapsible GA4/GSC/Ahrefs pill buttons with per-metric checklist, Select All/Clear; only selected metrics fetched; all selected by default
- All changes deployed to prod `REDACTED_HOST` throughout the session

### 2026-03-27 (Session 5)
- Started from commit `2f76408` (feat(dashboard): 1:1 metric code → card mapping)
- Synced PDF export with all fetched metrics (`eb933db`):
  - Added `ref` attributes + script refs for TRAF03 donut, TRAF02 bar, ENGA01 line, ENGA02 bar charts
  - Added TRAF03 (New vs Returning) export section: donut chart image + visitor type data table
  - Added TRAF02 (Top Landing Pages) export section: bar chart image + sessions/WoW% table
  - Added ENGA01 (Avg Session Duration) export section: line chart image + per-page table
  - Added ENGA02 (Bounce Rate) export section: bar chart image + per-page table
  - Added ENGA03 (Pages per Session) export section: table sorted by pages/session desc
  - Separated TRAF01 Traffic Drivers Overview into its own sub-section
  - Fixed TRAF04 countries table: numbered rows, names truncated at 28 chars, capped at top 30
  - Fixed TRAF01/TRAF03 condition bug: trafficBySourceOverTime only triggered by TRAF01
- Fixed PDF export to respect report period in all data tables (`e3b8e88`):
  - TRAF01 Traffic Over Time: uses `aggregateByPeriod()` instead of raw daily rows
  - Traffic by Source: uses `aggregateSourcesOverTimeByPeriod()` for export table
  - TRAF04 US by Source: same period-aware aggregation
  - Impressions (VISI01/02): uses `aggregateImpressionsByPeriod()` instead of hardcoded weekly
  - Column headers update to Date/Week/Month/Quarter based on selected period
- Reduced Technical Health donut charts (First Crawl / Latest Crawl) from 300px → 200px height
- All changes deployed to prod `REDACTED_HOST`

## Feature Requests (Backlog)

| Priority | Status | Feature |
|----------|--------|---------|
| Low | Optional | **Google Service Account for GA4/GSC** — replace per-user OAuth tokens with a server-side service account so all `@callboxinc.com` users see all GA4 properties and GSC sites regardless of their personal Google account access. Requires: create service account, grant access to all properties, store JSON key on server, update backend API calls to use service account instead of `req.googleTokens`. |

---

### 2026-03-30 (Session 6)
- Fixed traffic-by-source: backend now returns daily YYYYMMDD granularity; frontend aggregates per report period (`1c95370`)
- Fixed US traffic usaTotals: removed allowedChannels filter from row collection — totals now sum ALL channels, not just 5 display channels (`24e6056`)
- Fixed Ahrefs infographics not showing: `onMounted` now calls `selectAllMetrics()` for all sources so cards are visible by default (`b1f3d5d`)
- Fixed Ahrefs dropdown missing 3 older projects: Ahrefs API hard-caps default listing at 10 (ignores limit/offset); added `AHREFS_EXTRA_PROJECT_IDS` env var (comma-separated) for older project IDs fetched individually via `project_id` filter (`8bbcc24`)
  - Extra IDs on prod server: `8644614` (Info-graphics), `8192527` (Layer8 Training), `8699109` (Pinnaclereliability)
- Updated Ahrefs API key on prod server (new key generated from correct workspace)
- All changes deployed to prod `REDACTED_HOST`

### 2026-03-30 (Session 7)
- Fixed First Crawl date display: `techHealthFirstDate` now uses `first_crawl.data.date` (actual Ahrefs crawl date) instead of `savedAt` (server cache timestamp)
- Investigated Ahrefs "very first crawl date" — Ahrefs v3 API does NOT expose crawl history; `site-audit/projects` only returns latest crawl. Options for future: manual override via env var, or update `.first-crawl-cache.json` directly on server with correct historical dates
- Fixed weekly chart labels showing wrong dates (e.g. "03/16/26" instead of "03/20/26" when range starts on Friday):
  - Root cause: `new Date("YYYY-MM-DD")` parses as UTC midnight → `getDay()` returns wrong weekday in non-UTC timezones; also, Monday of ISO week was stored as the display date
  - Fix applied to all 3 weekly aggregation functions: `aggregateWeekly`, `aggregateSourcesOverTimeByPeriod`, `aggregateImpressionsWeekly`
  - All now use `T12:00:00` to avoid UTC/local boundary issues, and store the **first actual data date** (not ISO week Monday) as the chart label
  - Affects: Traffic Over Time, Traffic by Source, Impressions charts
- All changes deployed to prod `REDACTED_HOST`

### Key Architecture Notes (updated Session 7)
- `aggregateWeekly` / `aggregateImpressionsWeekly`: group by ISO Monday key internally, but `date` field = first actual YYYYMMDD/YYYY-MM-DD date in that week bucket
- `aggregateSourcesOverTimeByPeriod`: tracks `firstDateForKey` map for weekly period; `displayDates` uses first actual date (YYYY-MM-DD) instead of Monday key
- Ahrefs first crawl: stored in `server/.first-crawl-cache.json` as `{ data: { date, health_score, ... }, savedAt }` — `data.date` is the Ahrefs crawl date at time of first fetch

### Key Architecture Notes (updated Session 6)
- `AHREFS_EXTRA_PROJECT_IDS` env var in `server/.env` — comma-separated Ahrefs project IDs to supplement the default API listing (add new ones here when older projects are added to Ahrefs)
- `aggregateSourcesOverTimeByPeriod()` now expects YYYYMMDD daily dates from server; buckets into daily/weekly/monthly/quarterly on frontend
- `makeSourcePeriodLabel()` handles: YYYYMMDD (daily), YYYY-MM-DD (weekly), YYYY-MM (monthly), YYYY-Q# (quarterly)

### Key Architecture Notes (updated Session 5)
- `newVsReturning` store ref + `loadNewVsReturning()` added to metrics store
- `/api/metrics/new-vs-returning` backend endpoint returns `[{type, sessions, engagementRate, bounceRate}]`
- `metricActionMap`: TRAF03 → `loadNewVsReturning`; TRAF01 → traffic+source+overtime+drivers; TRAF02 → drivers; TRAF04 → trafficFromUS+USBySource+USBySourceOverTime
- `aggregateSourcesOverTimeByPeriod()` / `makeSourcePeriodLabel()` used for WE-prefixed server dates
- `aggregateImpressionsByPeriod()` / `makeImpPeriodLabel()` used for impressions
- GA4_MIN_DATE cap = 2020-01-01 prevents previous period predating GA4 data
