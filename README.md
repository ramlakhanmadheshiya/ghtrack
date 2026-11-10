# ghtrack

An ultra-fast, minimalist, zero-cost web tool to track lifetime GitHub activity (Pull Requests, Issues, Comments, CI status, Conflicts, and Reviews).

Hosted at `https://theramlakhan.com/ghtrack/`.

---

## Key Features

1. **Fast 50-Item Initial Load + Background Auto-Streaming**:
   - Fetches the first 50 items instantly (< 300ms).
   - Silently streams all remaining lifetime pages (50 items/batch) in the background.
   - 0ms latency when clicking next page—subsequent pages are already buffered in memory.
2. **Gmail-Style Pagination**:
   - `1–50 of 717` count display with `⟨` and `⟩` navigation buttons.
   - Quick page jump controls (`[1] [2] [3] ...`).
3. **Data Storage & Zero Cost**:
   - Stored in browser memory (RAM) and **IndexedDB** on the user's local device.
   - Accommodates 10,000+ items with zero cloud database cost and zero storage limits.
4. **Official GitHub Colors**:
   - Exact Primer design system colors for `Open` (Green), `Merged` (Purple), `Closed` (Red), `Draft` (Gray), and `Not planned` (Gray).
5. **Dynamic Filters**:
   - **Kind**: All Items, Pull Requests, Issues, Comments (by user).
   - **PR Status**: Dynamically reveals `Open`, `Draft`, `Merged`, `Closed` when Pull Requests is selected.
   - **Repository**: Dynamic dropdown of all unique repositories touched by the user.
   - **Quick Search**: Instant text filtering across titles and repo names.
6. **Native In-App GitHub Preview Drawer**:
   - Accordion drop-down under each item showing branch diff (`base ← head`), additions/deletions, description body, and recent comment activity without leaving the page.
   - 1-click `Open on GitHub ↗` button.
7. **Optional Personal Access Token (PAT)**:
   - Enables dedicated 5,000 requests/hour limit.
   - Token is stored strictly inside `localStorage` (never leaves the user's browser).

---

## Local Development

Open `index.html` in your browser or run a simple local web server:

```bash
# Using Python
python3 -m http.server 3000

# Open in browser
open http://localhost:3000
```

---

## Deployment to `theramlakhan.com/ghtrack`

To publish the built files to your personal website:

```bash
./deploy.sh
```

This clones your GitHub Pages site repository into a temporary folder, copies the static bundle to `public/ghtrack/`, commits, and pushes to GitHub Pages with zero interference with existing site projects.
