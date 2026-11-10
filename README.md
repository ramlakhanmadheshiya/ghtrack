# ghtrack

Track every pull request, issue, review and discussion of any GitHub user, with exact lifetime numbers in about a second. No login, no token, no server, no dependencies.

Hosted at `https://theramlakhan.com/ghtrack/`.

---

## How it works

- **Exact numbers in seconds.** A person's involvement is split into 5 non-overlapping buckets (created › assigned › reviewed › commented › mentioned/other). The first GitHub search of each bucket returns its exact total, so the headline numbers are ready in 1–2 seconds for any account.
- **Whole list in the browser.** Each bucket is then loaded 100 items per request and kept in memory, so every filter, page and dropdown is instant. About 1,000 items a minute (GitHub's limit without login); a 1,100-item account is complete in ~20 seconds.
- **Saved copy.** The list is saved in IndexedDB; the next visit shows it instantly and only fetches what changed.

## Filters

Kind (PRs / Issues), Status, **Role** (Created / Assigned / Reviewed / Commented / Mentioned — each item counted once, under its strongest link), Repository, Timeframe and text search.

## Preview

- **Public site:** shows the conversation inside the row: description, comments, reviews, commits, labels and state changes (GitHub's rendered markdown, sanitised). It costs 2 requests from GitHub's 60-per-hour core limit.
- **Local (`node server.js`):** embeds the real GitHub page through the local proxy (`/view`).

---

## Local development

```bash
node server.js            # http://localhost:3000, uses your `gh auth token` (30 searches/min) + real-page preview
# or any static server: python3 -m http.server 3000   (behaves like the public site)
```

## Deployment

```bash
./deploy.sh
```

This copies the static files into `public/ghtrack/` of the `ramlakhanmadheshiya.github.io` repository and pushes. It stamps `index.html` with a content hash (`?v=…`) so browsers never run a stale `app.js` (the CDN caches JS/CSS for 4 hours).
