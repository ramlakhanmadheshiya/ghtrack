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

### Request 9: Stale Cache Bug + No-Token Rewrite (v2)
- User saw `⚠ Paused at 350 items: GitHub unauthenticated rate limit reached` even after the countdown fix shipped. **Cause:** the deploy changed `app.js` but kept `?v=20261110_02`, and the CDN caches JS for 4 hours, so browsers kept running old code. **Fix:** `deploy.sh` now stamps `?v=<content hash>` automatically.
- User requirements (final): **no token, no login, no server**; must be fast for huge accounts (e.g. `@ChrisRackauckas`, 48,284 items); a filter that doesn't confuse (items must not be counted 4 times); preview must show the real conversation.
- The user explicitly does **not** want to create or store any GitHub token (security concern). Do not reintroduce token UI.
- The old "real GitHub page" preview only ever worked on `localhost` via `server.js /view` (GitHub sends `X-Frame-Options: deny`). Public site now renders the conversation natively; local keeps the real page.

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

## 5. Current Architecture (v2, Nov 2026): "Ask GitHub, don't download everything"

The old tri-stream GraphQL harvester and token settings were **removed**. Everything is REST search, unauthenticated.

### Numbers: one count request each
`/search/issues?q=…&per_page=1` → `total_count`. Lifetime overview = 5 essential counts (`involves`, `author is:pr`, `author is:issue`, reviewed bucket, commented bucket) + 2 background ones (merged, open issues). "My work" total comes free from the first list page; Assigned = My work − Created − Reviewed − Commented.

### Relationship buckets (non-overlapping, add up to the total)
Order of strength: `created (author) › assigned (assignee) › reviewed (reviewed-by) › commented (commenter) › other ("Mentioned & other")`.
A bucket query is its qualifier minus all stronger ones, e.g. commented = `commenter:U -author:U -assignee:U -reviewed-by:U`. Unions use GitHub **advanced search** (`advanced_search=true`, `OR` + parentheses). Verified: buckets sum exactly to `involves:` count.

### List: one request per 100 rows
`ResultStream` pages a query (sort=updated desc). After 1,000 results it continues with `updated:<=<last timestamp>` (dedup by URL). Far pages use a reverse stream (`order=asc`) when cheaper.

### Request scheduler (`apiGet` / `pump`)
Buckets: `search` (10/min unauth) and `core` (60/hr). Priorities: 0 = what the user looks at, 1 = numbers, 2 = row tags/charts, 3 = extra counts. Background (≥2) keeps 2 requests in reserve for clicks and waits while budget is unknown. Rate-limited search requests auto-retry at GitHub's reset time; 5xx/timeouts retry twice. Remaining budget is tracked as the minimum seen within a reset window (responses arrive out of order).
**Gotchas found:** `application/vnd.github.html+json` on search makes huge queries time out (502) → never request HTML for lists. `-is:merged` silently drops issues → "Closed" state is built per type.

### Row tags & preview
Row shows the bucket it's counted under (created/assigned from data; reviewed/commented via ≤2 window-limited searches at low priority). Preview (core API: `/issues/N` html + `/issues/N/timeline`) renders the conversation and detects every link (commented, reviewed, assigned, mentioned).

### Analytics
Targets & PR donut = exact counts (respect the "Opened" timeframe). Year chart = one count per year (+ "Earlier" bar for threads opened before the account existed). Heatmap, monthly and top repos = items of the timeframe (default last 12 months) loaded in the background, capped at 5,000.

### Local dev
`node server.js` adds `/api/gh/*` (REST proxy using `gh auth token`, 30 searches/min) and `/view` (real page iframe). `app.js` detects the proxy automatically; any other static server behaves like production.

## 6. Codebase File Structure

```
index.html   # UI (no token modal), relationship chips, type/state/repo/text filters
app.js       # scheduler, query builder, ResultStream, rendering, preview, analytics (vanilla JS)
app.css      # theme variables; v2 styles appended at the bottom
server.js    # local dev: static files + /api/gh proxy + /view embedder
deploy.sh    # publish to theramlakhan.com/ghtrack with content-hash cache busting
```

## 7. Verified Behaviour (headless Chrome, fresh profiles, no token)

| Account | Result |
| :--- | :--- |
| @ChrisRackauckas (48,284 involved) | list + exact numbers in ~2.5s; next clicks instant |
| @shravanngoswamii (1,099) | ~2.3s; charts complete after ~70s in background |
| @ramlakhanmadheshiya (33) | ~2s |
| unknown user / organization | clear message, 1 request |

## 8. Quick Guide for Future Agents
1. **No tokens, no login, no backend.** User requirement.
2. **No runtime npm dependencies.** Vanilla JS/CSS.
3. **Deploy with `./deploy.sh`** (auto cache-bust). Never edit other parts of the parent site.
4. **Bump `DB_VERSION`** in `app.js` if the cached response shape changes.
5. **Respect the scheduler**: every GitHub call goes through `apiGet` with a priority; never fire search requests directly.
6. Known limits (GitHub's, not ours): 10 searches/min per visitor; previews 60/hr ≈ 25–30 per hour; heatmap/top-repos for huge accounts fill in over a few minutes.
