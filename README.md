# Railflow PaaS — Autonomous Deployment Platform

A self-hosted PaaS platform inspired by Vercel and Railway.app designed specifically to run inside Heroku Dynos and deploy multiple backend APIs (Node.js, Python) and static frontend applications.

## Architecture

- **In-Dyno Process Virtualization**: Spawns and supervises backend child processes inside the dyno with internal port assignment and memory isolation.
- **Dynamic Reverse Proxy Router**: Directs traffic from `/live/<slug>` to the appropriate backend process or static frontend files.
- **Real-Time Telemetry & SSE Logs**: Live Server-Sent Events stream build output and runtime logs directly to the browser console.
- **Dual Engine**: Built-in runtime runner + optional Heroku Platform API orchestration bridge.
- **Hallmark App Screen**: Precision engineering UI built under strict Hallmark `Console` theme specifications (OKLCH palette, zero slop, keyboard accessible).

## Quick Run Locally

```bash
cd railflow-deploy
npm install
npm start
```
Open `http://localhost:3000` in your browser.

## Deploying to Heroku

### Method 1: Heroku CLI (Fastest)

Inside `railflow-deploy`:
```bash
git init
git add .
git commit -m "feat: initial railflow paas release"
heroku create my-railflow-app
git push heroku main
heroku open
```

### Method 2: Heroku Dashboard (GitHub Integration)

1. Push this folder to a GitHub repository.
2. Open [dashboard.heroku.com](https://dashboard.heroku.com) -> **New** -> **Create new app**.
3. Under **Deployment method**, select **GitHub**.
4. Connect your repository and click **Deploy Branch**.

## Features Included Out-of-the-Box

1. **Pre-Seeded Working Services**:
   - `core-api`: Node.js Express REST API (`/live/core-api`)
   - `matrix-app`: Responsive HTML5 SPA (`/live/matrix-app`)
   - `telemetry-py`: Python HTTP microservice (`/live/telemetry-py`)
2. **Deploy Capabilities**:
   - One-Click architecture templates (Express, Python, Static SPA)
   - Drag-and-drop `.ZIP` archive project ingestion
   - Git repository deployment configuration
3. **Operations**:
   - Start / Stop / Restart / Drop services
   - Live environment variable editor (`.env` format)
   - Real-time terminal auto-scroll and log export
   - Embedded sandbox frame to test deployed apps live
