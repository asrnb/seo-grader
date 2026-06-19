# SEO AI Grader

A dashboard for SEO teams to monitor and grade website performance using data from **Google Analytics 4**, **Google Search Console**, and **Ahrefs**.

## Stack

- **Vite + Vue 3** — build tooling & UI framework
- **Tailwind CSS v4** — utility-first styling (via `@tailwindcss/vite`)
- **Pinia** — state management
- **PrimeVue + Aura theme** — UI component library
- **PrimeIcons** — icon set
- **Vue ECharts** — interactive charts
- **Vue Router** — client-side routing
- **Express 5** — backend auth + metrics server
- **Google OAuth 2.0** — authentication
- **jsPDF + html2canvas** — PDF export

---

## Prerequisites

- **Node.js** v18+
- A **Google Cloud** project with OAuth 2.0 credentials
- **Google Analytics 4** property with data
- **Google Search Console** verified site
- **Ahrefs** account with API access (optional)

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

**`.env`** (frontend — copy from `.env.example`):

```env
VITE_GOOGLE_CLIENT_ID=your-google-client-id
VITE_GA4_PROPERTY_ID=        # optional default
VITE_GSC_SITE_URL=           # optional default
VITE_AHREFS_API_KEY=your-ahrefs-api-key
```

**`server/.env`** (create this file manually):

```env
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
REDIRECT_URI=http://localhost:5173/auth/callback
JWT_SECRET=your-random-32-char-secret
ALLOWED_DOMAIN=           # optional — restrict to one email domain (e.g. "example.com")
                          # leave blank to allow any Google account
AHREFS_EXTRA_PROJECT_IDS= # optional — comma-separated Ahrefs project IDs
FRONTEND_URL=http://localhost:5173
```

### 3. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable the following APIs:
   - **Google Analytics Data API**
   - **Google Search Console API**
   - **Google OAuth2 API**
4. Navigate to **APIs & Services > Credentials**
5. Create an **OAuth 2.0 Client ID** (Web application)
6. Add these to **Authorized JavaScript origins**:
   ```
   http://localhost:5173
   ```
7. Add these to **Authorized redirect URIs**:
   ```
   http://localhost:5173/auth/callback
   http://localhost:3001/api/auth/callback
   ```
8. Copy the **Client ID** and **Client Secret** into your `server/.env`

---

## Running the App

```bash
# Start both frontend (port 5173) and backend (port 3001)
npm run dev:all

# Or run separately:
npm run dev         # Frontend only (Vite, port 5173)
npm run dev:server  # Backend only (Express, port 3001)

# Production build
npm run build
npm run preview
```

Visit `http://localhost:5173` and sign in with your Google account.

---

## Environment Variables Reference

| Variable | File | Description |
|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | `.env` | Google OAuth client ID (frontend) |
| `VITE_GA4_PROPERTY_ID` | `.env` | Default GA4 property ID |
| `VITE_GSC_SITE_URL` | `.env` | Default GSC site URL |
| `VITE_AHREFS_API_KEY` | `.env` | Ahrefs API key |
| `GOOGLE_CLIENT_ID` | `server/.env` | Google OAuth client ID (server) |
| `GOOGLE_CLIENT_SECRET` | `server/.env` | Google OAuth client secret |
| `REDIRECT_URI` | `server/.env` | OAuth redirect URI |
| `JWT_SECRET` | `server/.env` | Secret for signing JWT tokens |
| `ALLOWED_DOMAIN` | `server/.env` | Optional email domain restriction |
| `AHREFS_EXTRA_PROJECT_IDS` | `server/.env` | Extra Ahrefs project IDs (comma-separated) |
| `FRONTEND_URL` | `server/.env` | Frontend origin for CORS (default: `http://localhost:5173`) |

---

## Features

### Dashboard

- **Data Sources** — Select GA4 property, GSC site, and Ahrefs project. GA4 auto-matches GSC/Ahrefs dropdowns via fuzzy domain matching.
- **Date Range** — DatePicker for custom start/end dates (defaults to last 30 days).
- **Report Period** — Daily / Weekly / Monthly / Quarterly — all charts and exports respect this.
- **Metric Filter** — Collapsible pill buttons per source with per-metric checkboxes.
- **Fetch Button** — Fetches only selected metrics on demand.
- **Export PDF** — Exports the full dashboard as a PDF (cards, charts, data tables).

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

---

## Backend API

All metric endpoints require `Authorization: Bearer <JWT>` and accept `startDate` / `endDate` query params (default: last 30 days).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/google` | Redirect to Google consent screen |
| GET | `/api/auth/callback` | Exchange OAuth code, issue JWT |
| GET | `/api/auth/me` | Verify JWT, return user info |
| POST | `/api/auth/logout` | Clear token from store |
| GET | `/api/metrics/total-traffic` | GA4 sessions + users |
| GET | `/api/metrics/traffic-by-source` | GA4 daily breakdown by channel |
| GET | `/api/metrics/traffic-from-us` | GA4 US traffic % |
| GET | `/api/metrics/traffic-drivers` | GA4 top 10 pages |
| GET | `/api/metrics/impressions` | GSC impressions, clicks, CTR, avg position |
| GET | `/api/metrics/new-vs-returning` | GA4 new vs returning visitor sessions |

---

## Authentication

- Sign in with any Google account (or restrict to a domain via `ALLOWED_DOMAIN`)
- Sessions use JWT tokens (8-hour expiry) stored in `localStorage`
- Google OAuth tokens are persisted to `server/.token-store.json` — survive server restarts

---

## Production Deployment

> [!NOTE]
> For production, register your production URL in your Google Cloud OAuth credentials (Authorized origins + redirect URIs).

Recommended: deploy with [PM2](https://pm2.keymetrics.io/)

```bash
npm run build
pm2 start server/index.js --name seo-grader-backend
pm2 serve dist 5173 --name seo-grader-frontend --spa
```
