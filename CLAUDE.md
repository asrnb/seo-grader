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
ALLOWED_DOMAIN=       # optional — leave blank to allow any Google account
FRONTEND_URL=http://localhost:5173
AHREFS_EXTRA_PROJECT_IDS=   # optional comma-separated Ahrefs project IDs not returned by default API listing
```

## Architecture

**Stack:** Vue 3 (Composition API) + Vite + Tailwind CSS v4 + PrimeVue 4 / Express 5 backend.

### Authentication Flow

1. User clicks "Sign in with Google" on `/login`
2. Frontend redirects to `GET /api/auth/google` on the Express server (port 3001)
3. Google OAuth redirects to `GET /api/auth/callback` — server validates email domain (if `ALLOWED_DOMAIN` is set), issues an 8-hour JWT
4. JWT stored in `localStorage`; Google OAuth tokens stored in `server/.token-store.json` (persisted across restarts)
5. All metric API calls send JWT as `Authorization: Bearer <token>`

### Data Flow

Dashboard → Pinia `metricsStore` → `src/services/metricsApi.js` (adds Bearer token) → Express backend → Google Analytics 4 / Google Search Console APIs → JSON response back to Vue components.

### Key Files

| Path | Role |
|------|------|
| `server/index.js` | Single Express file with all endpoints (auth + metrics) |
| `src/stores/auth.js` | Pinia store: user, token, isAuthenticated, login/logout/checkAuth |
| `src/stores/metrics.js` | Pinia store: metric refs + loading/error states + `loadAll()` |
| `src/services/metricsApi.js` | API client functions that attach the JWT |
| `src/router/index.js` | Route guards: redirects unauthenticated users to `/login` |
| `src/views/Dashboard.vue` | Main view — PrimeVue Cards + DataTable + DatePicker |
| `src/views/AuthCallback.vue` | Handles OAuth redirect, extracts token from URL, updates auth store |

### Backend Endpoints

**Auth:**
- `GET /api/auth/google` — redirect to Google consent screen
- `GET /api/auth/callback?code=` — exchange code, issue JWT
- `GET /api/auth/me` — verify JWT, return user info
- `POST /api/auth/logout` — clear token from store

**Metrics** (all require Bearer JWT, accept `startDate`/`endDate` query params, default to last 30 days):
- `GET /api/metrics/total-traffic?propertyId=` — GA4 sessions + users
- `GET /api/metrics/traffic-by-source?propertyId=` — GA4 breakdown by channel
- `GET /api/metrics/traffic-from-us?propertyId=` — GA4 US traffic percentage
- `GET /api/metrics/traffic-drivers?propertyId=` — GA4 top 10 pages
- `GET /api/metrics/impressions?siteUrl=` — GSC impressions, clicks, CTR, avg position

### Notable Constraints

- CORS is locked to `FRONTEND_URL` env var (default `http://localhost:5173`)
- `ALLOWED_DOMAIN` is optional — if set, only that email domain can log in; if unset, any Google account is accepted
- `AHREFS_EXTRA_PROJECT_IDS` env var (comma-separated) for Ahrefs projects not returned by the default API listing

## Key Architecture Notes

### Aggregation helpers
- `aggregateWeekly` / `aggregateImpressionsWeekly`: group by ISO Monday key internally, but `date` field = first actual YYYYMMDD/YYYY-MM-DD date in that week bucket
- `aggregateSourcesOverTimeByPeriod`: tracks `firstDateForKey` map for weekly period; `displayDates` uses first actual date (YYYY-MM-DD) instead of Monday key

### Ahrefs caching
- `AHREFS_EXTRA_PROJECT_IDS` env var in `server/.env` — comma-separated Ahrefs project IDs to supplement the default API listing
- Last known good Ahrefs data is persisted to `server/.ahrefs-cache.json` — survives API unit exhaustion

### First crawl cache
- `server/.first-crawl-cache.json` stores first-ever Ahrefs crawl per domain permanently — never overwritten
- `data.date` is the actual Ahrefs crawl date (not the server cache timestamp)

### Token store
- `server/.token-store.json` persists Google OAuth tokens across server restarts
- Tokens auto-refresh via `auth.on('tokens', ...)` event

### Date handling
- `new Date("YYYY-MM-DD")` parses as UTC midnight — always use `T12:00:00` suffix to avoid timezone boundary issues
- All weekly aggregation functions store the **first actual data date** (not ISO week Monday) as the chart label
- `makeSourcePeriodLabel()` handles: YYYYMMDD (daily), YYYY-MM-DD (weekly), YYYY-MM (monthly), YYYY-Q# (quarterly)

## Feature Requests (Backlog)

| Priority | Status | Feature |
|----------|--------|---------|
| Low | Optional | **Google Service Account for GA4/GSC** — replace per-user OAuth tokens with a server-side service account so all authorized users see all GA4 properties and GSC sites regardless of their personal Google account access. Requires: create service account, grant access to all properties, store JSON key on server, update backend API calls to use service account instead of `req.googleTokens`. |
