# SEO AI Grader

Internal Callbox tool for the SEO team. Grades pages for SEO and AI readiness using data from Google Analytics 4, Google Search Console, and Ahrefs.

## Stack

- **Vite + Vue 3** — build tooling & UI framework
- **Tailwind CSS v4** — utility-first styling (via `@tailwindcss/vite`)
- **Pinia** — state management
- **PrimeVue + Aura theme** — UI component library
- **PrimeIcons** — icon set
- **Vue ECharts** — interactive charts (Traffic, Impressions, etc.)
- **Vue Router** — client-side routing
- **Express 5** — backend auth + metrics server
- **Google OAuth 2.0** — authentication (restricted to @callboxinc.com)
- **jsPDF + html2canvas** — PDF export

## Setup

```bash
npm install
```

### Environment Variables

**`.env`** (frontend — copy from `.env.example`):

```env
VITE_GOOGLE_CLIENT_ID=
VITE_GA4_PROPERTY_ID=
VITE_GSC_SITE_URL=
VITE_AHREFS_API_KEY=
```

**`server/.env`** (backend):

```env
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
REDIRECT_URI=http://localhost:5173/auth/callback
JWT_SECRET=your-random-32-char-secret
ALLOWED_DOMAIN=callboxinc.com
AHREFS_EXTRA_PROJECT_IDS=   # optional comma-separated Ahrefs project IDs not returned by default API listing
```

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Navigate to **APIs & Services > Credentials**
4. Create an **OAuth 2.0 Client ID** (Web application)
5. Add `http://localhost:5173` to **Authorized JavaScript origins**
6. Add `http://localhost:5173/auth/callback` to **Authorized redirect URIs**
7. Copy the Client ID and Client Secret into your `server/.env`

> **Production note:** Google OAuth rejects raw IP addresses. Use [nip.io](https://nip.io) — e.g. `http://REDACTED_HOST.nip.io:5173` — and register that URL in OAuth credentials.

### Running the App

```bash
# Start both frontend (port 5173) and backend (port 3001) concurrently
npm run dev:all

# Or run separately:
npm run dev         # Frontend only
npm run dev:server  # Backend only

# Production build
npm run build
```

## Environment Variables Reference

| Variable | Location | Description |
|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | `.env` | Google OAuth client ID (frontend) |
| `VITE_GA4_PROPERTY_ID` | `.env` | Default GA4 property ID |
| `VITE_GSC_SITE_URL` | `.env` | Default GSC site URL |
| `VITE_AHREFS_API_KEY` | `.env` | Ahrefs API key |
| `GOOGLE_CLIENT_ID` | `server/.env` | Google OAuth client ID (server) |
| `GOOGLE_CLIENT_SECRET` | `server/.env` | Google OAuth client secret |
| `REDIRECT_URI` | `server/.env` | OAuth redirect URI |
| `JWT_SECRET` | `server/.env` | Secret for signing JWT tokens |
| `ALLOWED_DOMAIN` | `server/.env` | Email domain restriction (e.g. `callboxinc.com`) |
| `AHREFS_EXTRA_PROJECT_IDS` | `server/.env` | Comma-separated Ahrefs project IDs to supplement default API listing |

## Authentication

- Login is restricted to **@callboxinc.com** Google accounts only
- Non-Callbox emails are rejected at the OAuth callback
- Sessions use JWT tokens (8-hour expiry) stored in `localStorage`
- Google OAuth tokens are stored **in-memory** — they are lost on server restart (development limitation)

## Features

### Dashboard

- **Data Sources:** Select GA4 property, GSC site, and Ahrefs project from dropdowns. Choosing a GA4 property auto-matches the GSC and Ahrefs dropdowns via fuzzy domain matching.
- **Date Range:** DatePicker for custom start/end dates (defaults to last 30 days).
- **Report Period:** Daily / Weekly / Monthly / Quarterly selector — all charts and export tables respect this.
- **Metric Filter:** Collapsible pill buttons per source (GA4 / GSC / Ahrefs) with per-metric checkboxes. Only selected metrics are fetched.
- **Fetch Button:** Triggers all selected metric fetches on demand.
- **Export PDF:** Exports the full dashboard — metric cards, charts, and data tables — as a PDF.

### Metrics

| Code | Source | Metric |
|------|--------|--------|
| VISI01 | GSC | Weekly Impressions chart |
| VISI02 | GSC | Impressions / Clicks / CTR / Avg Position |
| TRAF01 | GA4 | Traffic Over Time + Traffic by Source |
| TRAF02 | GA4 | Top Landing Pages (by sessions) |
| TRAF03 | GA4 | New vs Returning Visitors |
| TRAF04 | GA4 | US Traffic % + breakdown by source |
| ENGA01 | GA4 | Avg Session Duration per page |
| ENGA02 | GA4 | Bounce Rate per page |
| ENGA03 | GA4 | Pages per Session |
| TECH01 | Ahrefs | Technical SEO Health (latest + first crawl donuts) |
| TECH02 | Ahrefs | Site Audit details |

### Technical SEO Health

- First crawl score is cached permanently in `server/.first-crawl-cache.json` per domain
- Latest crawl is fetched live from Ahrefs on each request
- First crawl date shown is the actual Ahrefs crawl date (not the server cache timestamp)

## Backend API

All metric endpoints require `Authorization: Bearer <JWT>` and accept `startDate` / `endDate` query params (default: last 30 days).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/google` | Redirect to Google consent screen |
| GET | `/api/auth/callback` | Exchange OAuth code, issue JWT |
| GET | `/api/auth/me` | Verify JWT, return user info |
| POST | `/api/auth/logout` | Clear token from in-memory store |
| GET | `/api/metrics/total-traffic` | GA4 sessions + users |
| GET | `/api/metrics/traffic-by-source` | GA4 daily breakdown by channel |
| GET | `/api/metrics/traffic-from-us` | GA4 US traffic % |
| GET | `/api/metrics/traffic-drivers` | GA4 top 10 pages |
| GET | `/api/metrics/impressions` | GSC impressions, clicks, CTR, avg position |
| GET | `/api/metrics/new-vs-returning` | GA4 new vs returning visitor sessions |

## Production Deployment

- **Server:** `REDACTED_HOST` (user: `dev-user`)
- **URL:** `http://REDACTED_HOST.nip.io:5173`
- **App path:** `~/apps/seo-ai-grader`
- **Process manager:** PM2 (3 processes: `qa-review-ui-prod`, `seo-grader-backend`, `seo-grader-frontend`)
- Git is not installed on the server — deploy via `scp` then rebuild:

```bash
sshpass -p 'REDACTED_ROTATED_PASSWORD' scp -o StrictHostKeyChecking=no \
  src/views/Dashboard.vue server/index.js \
  REDACTED_USER@REDACTED_HOST:~/apps/seo-ai-grader/src/views/ && \
sshpass -p 'REDACTED_ROTATED_PASSWORD' ssh -o StrictHostKeyChecking=no \
  REDACTED_USER@REDACTED_HOST "cd ~/apps/seo-ai-grader && npm run build"
```
