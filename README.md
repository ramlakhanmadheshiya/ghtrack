# ghtrack

Track every pull request, issue, review and discussion of any GitHub user, with exact lifetime numbers in about a second. No login, no token, no server, no dependencies.

Hosted at `https://theramlakhan.com/ghtrack/`.

---

## How it works

ghtrack does not download a person's whole history. It asks GitHub's search API the exact question the screen needs:

- **Each number is one request.** GitHub returns the count of a search without sending the items, so totals are exact for any account size (tested on an account with 48,000+ items).
- **Each page of the list is one request** of 100 items, sorted by latest activity. Pages past GitHub's 1,000-result cap are reached by continuing from the last timestamp, and far pages are read from whichever end of the list is closer.
- **The request scheduler follows GitHub's limits.** Searches without login are capped at 10 per minute per visitor. The first load uses about 7, keeps 2–3 free for clicks, and runs background work (row tags, charts) only with the leftover budget. If the limit is hit, the request waits for GitHub's reset time and continues on its own.
- **Results are cached** in memory and IndexedDB for 10 minutes, so going back and forth costs nothing.

## Filters

Every item is counted in **exactly one** relationship bucket, its strongest link to the person, so the buckets always add up to the total:

`Created › Assigned › Reviewed › Commented › Mentioned & other`

An issue you opened, commented on, got assigned to and were mentioned in counts once, under **Created**. Opening the row's preview shows every link.

- **My work** = Created + Assigned + Reviewed + Commented (the default; hides mention-only noise)
- **Everything** = all buckets (GitHub's `involves:`)
- **Type** (PRs / Issues), **State** (Open / Draft / Merged / Closed / Not planned), **Opened** (lifetime, last 30/90 days, last 12 months, each year), **Repository**, **Text search**

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
