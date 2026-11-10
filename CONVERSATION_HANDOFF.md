# ghtrack — Complete Project Context & Conversation Handoff

> **Document Purpose**: This file is a complete, self-contained handoff record of the entire `ghtrack` project from inception to its current production state. Any developer or AI agent can read this single document and immediately understand the architecture, design choices, historical debugging, codebase layout, and how to continue development or maintenance.

---

## 1. Executive Summary & Core Purpose

`ghtrack` is an ultra-fast, 100% cost-free, client-side developer telemetry and lifetime GitHub tracking web application.

### Why was it built?
- **Inspiration**: The user's friend built `ghdeck` (`ghdeck.jitendravjh.in`), which was a CLI/terminal-styled tool that had severe limitations:
  1. It capped search results at only the first ~20 items instead of pulling full lifetime GitHub activity.
  2. It relied on a terminal-like interface instead of a clean, responsive modern dashboard.
  3. It lacked rich visual analytics (contribution heatmaps, target tracking, progress bars, charts).
- **Core Goal**: Build an independent, clean, modern web application that loads a user's **entire lifetime GitHub history** (thousands of PRs, issues, and comments across all repositories), displays the first 50 items instantly, and streams the rest smoothly in the background without freezing, crashing, or hitting rate limits.
- **Cost**: 100% free with zero hosting costs and zero npm runtime dependencies.

---

## 2. Infrastructure & Deployment Architecture

### Repositories
1. **Source Code Repository**:
   - Remote: `ramlakhanmadheshiya/ghtrack` (Private GitHub Repository)
   - Branch: `main`
   - Local path: `/Users/ramlakhan/Desktop/Projests/ghtrack`
2. **Parent Site Repository**:
   - Remote: `ramlakhanmadheshiya/ramlakhanmadheshiya.github.io` (Public GitHub Pages / Astro Site)
   - Branch: `main`
   - Production URL: `https://theramlakhan.com/ghtrack/`
   - Destination in parent repo: `public/ghtrack/`

### Zero-Disruption Deployment Constraint
- **Rule**: Never touch, modify, or corrupt any existing code in the parent website (`ramlakhanmadheshiya.github.io`).
- **Deploy Script**: [`deploy.sh`](./deploy.sh) clones the parent repository into a temporary directory (`/tmp/ghtrack-deploy`), wipes and recreates only `public/ghtrack/`, copies the build assets (`index.html`, `app.js`, `app.css`, `favicon.svg`, `assets/`), commits, and pushes directly to GitHub Pages.

---

## 3. Chronological User Requirements & Design Decisions

### Request 1: The Core Foundation
- Web-only tool (no CLI).
- Pull entire lifetime GitHub data (not just first 20 items).
- Hosted at `https://theramlakhan.com/ghtrack`.
- Zero-cost architecture.

### Request 2: 50-Item Pagination & Background Harvester
- Load the first 50 items within milliseconds so the user sees immediate results.
- Show Gmail-style pagination controls (`<` and `>` arrows, page numbers 1, 2, 3...).
- Background engine fetches remaining items in 50-item batches while the user browses.
- Use official GitHub Primer color codes (Merged = purple `#a371f7`, Closed = red `#f85149`, Open = green `#3fb950`, Draft = gray `#8b949e`, Not Planned = gray with slash icon).
- Distinct filters:
  - Kind: All, PRs, Issues, Comments (by user).
  - PR State: Open, Merged, Closed, Draft (appears conditionally when PR filter is active).
  - Repository: Dynamic select dropdown of all repos involved.
- Small preview drawer: clicking "Preview" expands an inline viewer showing GitHub activity.

### Request 3: Testing & Debugging Initial Profiles
- Target profile 1: `@shravanngoswamii` (heavy user with >1,250 lifetime contributions).
- Target profile 2: `@ramlakhanmadheshiya` (author of the app).
- Identified rate limit considerations: unauthenticated GitHub REST search limits clients to 10 requests/minute.

### Request 4: Visual Analytics Suite
- **Target Tracking Cards**: Dynamic milestones for total PRs, merge rate percentage, issue resolution rate, and distinct repository count.
- **GitHub-style Contribution Heatmap Calendar**: Green 52-week grid showing daily activity density, complete with year-by-year selector pills.
- **Charts & Graphs**:
  - Donut chart showing Pull Request health (Merged vs Open vs Closed vs Draft).
  - Top 10 repositories breakdown.
  - Yearly and monthly contribution bar charts.
- **Date Filters**: All-time, 2026, 2025, 2024, 90 days, 30 days.

### Request 5: UI Polish & Layout Consistency
- Fix responsive layout when the PR state filter appears so that the pagination buttons do not get pushed onto a new line.
- Remove branding taglines from bottom (`Built for lifetime developer telemetry. 100% cost-free.`).
- Theme-responsive logo and favicon: SVG logo and favicon dynamically adapt colors when toggling dark and light mode.
- Clean up repository select dropdown scrolling behavior.

### Request 6: Issue Comment Filter Bug (`SciML/ModelingToolkit.jl#5344`)
- Issue: User created AND commented on `SciML/ModelingToolkit.jl#5344`, but it did not appear under the "Comments (by user)" filter.
- Fix: Rewrote comment detection to inspect GraphQL comment nodes for user's login regardless of whether they authored the issue.

### Request 7: Batch Sizing & Inconsistent Counts Forensic Investigation
- Restore batch size strictly to **50 items at a time** (not 100).
- Real-time progress banner showing live page numbering: `⚡ Loading page X of Y (Z items · stream)...`.
- Fix the issue where different browsers returned inconsistent counts (**599 vs 1,119 vs 1,233**).
- Ensure incomplete runs are never falsely reported as "100% loaded" or written to cache.

### Request 8: Production Preview Card Fix
- Resolved `ReferenceError: badgeText is not defined` inside `createItemRow`.
- Added automatic cache-busting version query strings (`?v=20261110_02`) in `index.html`.
- Implemented auto-resuming countdown for unauthenticated rate limits (10 req/min).

---

## 4. Deep Forensic Analysis of Critical Bugs & Fixes

### Bug 1: Why 3 Different Numbers Occurred (1,233 vs. 599 vs. 1,119)
The user observed 3 different lifetime totals for `@shravanngoswamii`:
1. **599 Items (Incognito / Clean Browser on GitHub Pages)**:
   - *Root Cause*: On static GitHub Pages, `/api/graphql` is unavailable. The code fell back to unauthenticated REST Search (`/search/issues`). GitHub imposes a strict unauthenticated limit of **10 requests per minute**. Around page 6 ($6 \times 100 \approx 599$ items), GitHub returned `HTTP 403 Forbidden Rate Limit Exceeded`.
   - *Bug in Code*: The catch block caught the 403, stopped the loop, and erroneously reported `✓ 100% lifetime history loaded (599 items)` and cached that incomplete 599 into IndexedDB.
2. **1,119 Items (Partial Stream Run)**:
   - *Root Cause*: Stream 1 (`involves:username`, which totals ~1,110–1,119 items) completed, but the browser was closed or interrupted before Stream 2 (`commenter:username`) and Stream 3 (`user:username`) completed deduplication. The partial dataset was written to cache.
3. **1,233 Items (GitHub 1,000 Single-Query Ceiling)**:
   - *Root Cause*: GitHub GraphQL Search hard-stops single queries after 1,000 items. When windowing logic was missed or interrupted, it stopped at 1,000 from Stream 1 + 42 new comments + 191 new items from user repos ($1,000 + 42 + 191 = 1,233$).
4. **The Ground Truth Total**:
   - True total: **1,255 items** (1,010 Pull Requests, 245 Issues, 483 Comments).
   - *The Solution*:
     - Strict rate limit detection: if rate-limited, it displays `⚠ Paused at X items: rate limit reached` and **never** calls `saveCachedProfile()`.
     - Bumped IndexedDB to `DB_VERSION = 4` to purge all stale partial caches automatically.
     - Added automatic windowing (`updated:<oldestDate`) when a stream reaches 1,000 items.

### Bug 2: Comment Detection on Authored Issues (`#5344`)
- *Bug*: In `normalizeNode()`, `let userCommented = !isAuthor;` assumed that if you created an issue, you couldn't be counted as a commenter.
- *Fix*: Added GraphQL query fragment `comments(first: 25) { nodes { author { login } } }`. If the user's login appears anywhere in the comments list, `userCommented` is set to `true` regardless of authorship.

### Bug 3: `badgeText is not defined`
- *Bug*: When creating the production preview summary card in `createItemRow()`, the variable `badgeText` was used instead of `item.statusLabel`.
- *Fix*: Replaced with `item.statusLabel`, replaced `item.author.login` with `item.author`, and verified in Node.js unit tests.

---

## 5. Dual-Engine Architectural Design

```
                     ┌────────────────────────────────────────────────────────┐
                     │                 User Visits ghtrack                    │
                     └──────────────────────────┬─────────────────────────────┘
                                                │
                     ┌──────────────────────────┴─────────────────────────────┐
                     │            Detect Hosting Environment                  │
                     └──────────┬─────────────────────────────────┬───────────┘
                                │                                 │
                 Local Dev (localhost:3000)        Production (theramlakhan.com)
                                │                                 │
           ┌────────────────────┴──────────┐       ┌──────────────┴────────────────┐
           │ Uses server.js Proxy          │       │ Has GitHub Token in Settings? │
           │ - 5,000 req/hr via gh auth    │       └──────┬─────────────────┬──────┘
           │ - Strips X-Frame-Options      │              │                 │
           │ - Live GitHub iframe viewer   │           YES│                 │NO
           └───────────────────────────────┘              │                 │
                                            ┌─────────────┴─────┐     ┌─────┴───────────────┐
                                            │ Direct GraphQL    │     │ Public REST Search  │
                                            │ - 5,000 req/hr    │     │ - 10 req/min        │
                                            │ - Tri-stream      │     │ - Auto-resuming     │
                                            │ - 1,255 items     │     │   60s countdown     │
                                            └───────────────────┘     └─────────────────────┘
```

### 1. Local Development Engine (`server.js`)
- Runs via `node server.js` on port 3000.
- Zero npm dependencies — uses native `http`, `https`, `fs`, `path`, and `child_process`.
- Automatically calls `gh auth token` from the user's terminal to enable **5,000 req/hr** out of the box.
- Endpoints:
  - `POST /api/graphql`: Proxies GraphQL requests to `https://api.github.com/graphql`.
  - `GET /view?url=...`: Fetches raw GitHub HTML, strips header/navigation and framing restrictions (`X-Frame-Options: ALLOWALL`), enabling the inline iframe preview.

### 2. Production Static Engine (`https://theramlakhan.com/ghtrack/`)
- Hosted on GitHub Pages (pure client-side).
- If the user enters a personal access token (PAT) in Settings:
  - Token is stored strictly in the browser's `localStorage` (`ghtrack_token`).
  - Calls `https://api.github.com/graphql` directly with 5,000 req/hr.
- If unauthenticated:
  - Falls back to GitHub REST Search (`/search/issues`).
  - When hitting GitHub's 10 req/min limit, it displays an auto-resuming countdown:
    `⏳ Paused at 500 items (public rate limit: 10 req/min). Resuming in 58s, or add a free token for 5,000 req/hr...`
  - Offers a 1-click token generation link with 0 permissions needed:
    `https://github.com/settings/tokens/new?description=ghtrack&scopes=`

---

## 6. Tri-Stream Harvester Engine

To capture 100% of a developer's lifetime activity, `app.js` runs three parallel GraphQL streams:

| Stream | Query Filter | Description |
| :--- | :--- | :--- |
| **Stream 1** | `involves:${login} sort:updated-desc` | Authored, assigned, mentioned, and involved threads. |
| **Stream 2** | `commenter:${login} sort:updated-desc` | GitHub's native index for threads where the user posted comments. |
| **Stream 3** | `user:${login} sort:updated-desc` | Issues and pull requests in user-owned repositories. |

### Deduplication
All streams feed into a single master Map: `state.itemsMap.set(item.id, item)`. Keyed by GitHub issue/PR URL, ensuring zero duplicate entries.

### Windowing Past 1,000 Items
GitHub search hard-stops queries at 1,000 items. When a stream hits 1,000 items:
```javascript
const oldestDate = nodes[nodes.length - 1]?.updatedAt;
currentQuery = `${stream.base} updated:<${oldestDate} sort:updated-desc`;
cursor = null;
```
This shifts the query window backward in time and continues streaming until all historical activity is retrieved.

---

## 7. Codebase File Structure

```
/Users/ramlakhan/Desktop/Projests/ghtrack/
├── index.html               # Single-page application UI structure & modals
├── app.js                   # Core application logic (~1,900 lines, zero dependencies)
├── app.css                  # Custom stylesheet with CSS variables & dark/light themes
├── server.js                # Native Node.js dev server & iframe unblocker
├── deploy.sh                # Automated deploy script to theramlakhan.com/ghtrack/
├── favicon.svg              # Dynamic multi-color theme-adaptive SVG favicon
└── assets/                  # Static assets and icons
```

### Key Functions in `app.js`
- `startTracking(username)`: Resets state and UI, pulls initial 50 items instantly, renders feed and analytics, and triggers background streaming.
- `streamRemainingBatches()`: Multi-source GraphQL tri-stream harvester with live page numbering and rate limit protection.
- `streamRestPages()`: REST API harvester with auto-resuming countdown for unauthenticated browsing.
- `renderList()`: Renders 50-item pages with pagination buttons and preview drawers.
- `createItemRow(item)`: Constructs row elements with Primer status badges, CI pills, labels, and preview drawers.
- `renderAnalytics()`: Master coordinator for targets, heatmaps, donut charts, top repos, and monthly/yearly trends.
- `openDB()`, `saveCachedProfile()`, `clearAllCache()`: IndexedDB persistence layer.

---

## 8. Current Operational State & Verification

1. **Local Dev Server**: Stopped (port 3000 free).
2. **Production Site**: Live and operational at **[https://theramlakhan.com/ghtrack/](https://theramlakhan.com/ghtrack/)**.
3. **Git Branch**: Clean on `main`, synchronized with `origin/main`.
4. **Parent Site**: Synced to `ramlakhanmadheshiya.github.io/public/ghtrack` with deployment successful.

---

## 9. Quick Guide for Future Agents

If continuing work or adding new features:
1. **Never install npm dependencies for client runtime**: Keep `ghtrack` vanilla JS/CSS for zero bundle bloat and instant loading.
2. **Deployment**: Always use `./deploy.sh` to update `theramlakhan.com/ghtrack/`.
3. **Batch Size**: Preserve `API_PAGE_SIZE = 50;` and `FEED_PAGE_SIZE = 50;` as requested by user.
4. **Cache Invalidation**: If altering the data structure of items, increment `DB_VERSION` in `app.js` and update `?v=` in `index.html`.
5. **Rate Limits**: Never remove the rate-limit auto-resuming countdown or honest error banners.
