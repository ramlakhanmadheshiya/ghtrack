// ── ghtrack — Core Application Logic ────────────────────────────────────
(() => {
  "use strict";

  const GITHUB_GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
  const GITHUB_REST_ENDPOINT = "https://api.github.com";
  const PAGE_SIZE = 50;

  // ── IndexedDB Cache Setup (Unlimited Cost-Free Client Storage) ───────
  const DB_NAME = "ghtrack_cache_db";
  const DB_VERSION = 1;
  const STORE_NAME = "profiles";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "login" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getCachedProfile(login) {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(login.toLowerCase());
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async function saveCachedProfile(login, data) {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put({ login: login.toLowerCase(), ...data, savedAt: Date.now() });
    } catch (err) {
      console.warn("IndexedDB save failed:", err);
    }
  }

  // ── State ───────────────────────────────────────────────────────────
  const state = {
    login: "",
    token: localStorage.getItem("ghtrack_token") || "",
    itemsMap: new Map(), // Master de-duplicated store of all lifetime items
    isInitialLoading: false,
    isStreamingBackground: false,
    cancelStreaming: false,
    currentPage: 1,
    pageSize: PAGE_SIZE,
    totalEstimated: 0,
    filters: {
      kind: "all",      // 'all' | 'pr' | 'issue' | 'comment'
      prState: "all",   // 'all' | 'open' | 'draft' | 'merged' | 'closed'
      repo: "all",      // 'all' | repoName
      text: "",         // search query
    },
    expandedPreviews: new Set(),
  };

  // ── DOM References ──────────────────────────────────────────────────
  const dom = {
    searchForm: document.getElementById("search-form"),
    searchInput: document.getElementById("search-input"),
    inputClear: document.getElementById("input-clear"),
    btnSearch: document.getElementById("btn-search"),
    quickPills: document.querySelectorAll(".quick-pill"),

    telemetryBar: document.getElementById("telemetry-bar"),
    statTotal: document.getElementById("stat-total"),
    statPrs: document.getElementById("stat-prs"),
    statPrsSub: document.getElementById("stat-prs-sub"),
    statIssues: document.getElementById("stat-issues"),
    statIssuesSub: document.getElementById("stat-issues-sub"),
    statComments: document.getElementById("stat-comments"),
    statRepos: document.getElementById("stat-repos"),

    streamBanner: document.getElementById("stream-banner"),
    streamText: document.getElementById("stream-text"),
    streamProgressFill: document.getElementById("stream-progress-fill"),

    mainContent: document.getElementById("main-content"),
    filterKind: document.getElementById("filter-kind"),
    wrapPrState: document.getElementById("wrap-pr-state"),
    filterPrState: document.getElementById("filter-pr-state"),
    filterRepo: document.getElementById("filter-repo"),
    filterText: document.getElementById("filter-text"),

    pagerCount: document.getElementById("pager-count"),
    pagerPrev: document.getElementById("pager-prev"),
    pagerNext: document.getElementById("pager-next"),
    pageButtons: document.getElementById("page-buttons"),
    bottomSummary: document.getElementById("bottom-summary"),

    listContainer: document.getElementById("list-container"),
    listEmpty: document.getElementById("list-empty"),
    listLoading: document.getElementById("list-loading"),

    btnTheme: document.getElementById("btn-theme"),
    iconSun: document.getElementById("theme-icon-sun"),
    iconMoon: document.getElementById("theme-icon-moon"),

    btnToken: document.getElementById("btn-token"),
    tokenDot: document.getElementById("token-dot"),
    tokenLabel: document.getElementById("token-label"),
    modalToken: document.getElementById("modal-token"),
    modalTokenClose: document.getElementById("modal-token-close"),
    inputPat: document.getElementById("input-pat"),
    btnTestToken: document.getElementById("btn-test-token"),
    btnSaveToken: document.getElementById("btn-save-token"),
    btnClearToken: document.getElementById("btn-clear-token"),
    tokenTestResult: document.getElementById("token-test-result"),

    btnExport: document.getElementById("btn-export"),
    modalExport: document.getElementById("modal-export"),
    modalExportClose: document.getElementById("modal-export-close"),
    tabExportMd: document.getElementById("tab-export-md"),
    tabExportJson: document.getElementById("tab-export-json"),
    exportContent: document.getElementById("export-content"),
    btnCopyExport: document.getElementById("btn-copy-export"),
    btnDownloadExport: document.getElementById("btn-download-export"),
  };

  // ── GraphQL Queries ─────────────────────────────────────────────────
  const ROW_FRAGMENT = `
    fragment RowDetails on SearchResultItem {
      ... on Issue {
        __typename
        number
        title
        url
        state
        stateReason
        createdAt
        updatedAt
        body
        author { login avatarUrl }
        repository { nameWithOwner }
        assignees(first: 5) { nodes { login } }
        comments(last: 3) {
          totalCount
          nodes {
            author { login avatarUrl }
            createdAt
            body
          }
        }
        labels(first: 6) {
          nodes { name color }
        }
      }
      ... on PullRequest {
        __typename
        number
        title
        url
        state
        isDraft
        merged
        mergeable
        reviewDecision
        createdAt
        updatedAt
        body
        additions
        deletions
        changedFiles
        baseRefName
        headRefName
        author { login avatarUrl }
        repository { nameWithOwner }
        assignees(first: 5) { nodes { login } }
        comments(last: 3) {
          totalCount
          nodes {
            author { login avatarUrl }
            createdAt
            body
          }
        }
        reviews(last: 5) {
          totalCount
          nodes { state author { login } submittedAt }
        }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup { state }
            }
          }
        }
        labels(first: 6) {
          nodes { name color }
        }
      }
    }
  `;

  const SEARCH_QUERY = `
    query($main: String!, $extra: String!, $n: Int!, $cursorMain: String, $cursorExtra: String) {
      main: search(query: $main, type: ISSUE, first: $n, after: $cursorMain) {
        issueCount
        pageInfo { endCursor hasNextPage }
        nodes { ...RowDetails }
      }
      extra: search(query: $extra, type: ISSUE, first: $n, after: $cursorExtra) {
        issueCount
        pageInfo { endCursor hasNextPage }
        nodes { ...RowDetails }
      }
    }
    ${ROW_FRAGMENT}
  `;

  // ── GitHub API Fetcher (Dual Engine: GraphQL + REST Fallback) ───────
  async function fetchGraphQL(query, variables) {
    if (!state.token) {
      throw new Error("NO_TOKEN");
    }

    const headers = {
      "Content-Type": "application/json",
      "User-Agent": "ghtrack-web/1.0",
      "Authorization": `Bearer ${state.token}`,
    };

    const res = await fetch(GITHUB_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || data?.errors) {
      const msg = data?.errors?.[0]?.message || `GitHub API error: ${res.status}`;
      if (res.status === 401) {
        throw new Error("Invalid GitHub token. Please verify or update your token in settings.");
      }
      if (res.status === 403 || msg.includes("rate limit")) {
        throw new Error("GitHub API rate limit exceeded. Please enter a Personal Access Token (PAT) for 5,000 requests/hour.");
      }
      throw new Error(msg);
    }

    return data.data;
  }

  // REST search fallback for unauthenticated public browsing (zero token needed)
  async function fetchRestSearch(login, page = 1) {
    const headers = {
      "User-Agent": "ghtrack-web/1.0",
      "Accept": "application/vnd.github.v3+json",
    };
    if (state.token) {
      headers["Authorization"] = `Bearer ${state.token}`;
    }

    const url = `${GITHUB_REST_ENDPOINT}/search/issues?q=involves:${encodeURIComponent(login)}&sort=updated&order=desc&per_page=${PAGE_SIZE}&page=${page}`;
    const res = await fetch(url, { headers });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const msg = data?.message || `GitHub error: ${res.status}`;
      if (res.status === 403) {
        throw new Error("GitHub rate limit reached for unauthenticated browsing. Enter a free token via Settings for 5,000 req/hr!");
      }
      throw new Error(msg);
    }

    return data;
  }

  function normalizeRestNode(raw, currentLogin) {
    if (!raw || !raw.html_url) return null;
    const isPR = Boolean(raw.pull_request);
    const isMerged = Boolean(raw.pull_request?.merged_at);
    const authorLogin = raw.user?.login || "ghost";
    const isAuthor = authorLogin.toLowerCase() === currentLogin.toLowerCase();

    const repoMatch = raw.html_url.match(/github\.com\/([^/]+\/[^/]+)\/(?:pull|issues)/);
    const repo = repoMatch ? repoMatch[1] : "unknown/repo";

    let status = "open";
    let statusLabel = "Open";

    if (isPR) {
      if (isMerged) {
        status = "merged";
        statusLabel = "Merged";
      } else if (raw.state === "closed") {
        status = "closed";
        statusLabel = "Closed";
      } else if (raw.draft) {
        status = "draft";
        statusLabel = "Draft";
      } else {
        status = "open";
        statusLabel = "Open";
      }
    } else {
      if (raw.state === "closed") {
        status = raw.state_reason === "not_planned" ? "not-planned" : "closed";
        statusLabel = raw.state_reason === "not_planned" ? "Not planned" : "Closed";
      } else {
        status = "open";
        statusLabel = "Open";
      }
    }

    return {
      id: raw.html_url,
      kind: isPR ? "pr" : "issue",
      number: raw.number,
      title: (raw.title || "").trim(),
      url: raw.html_url,
      repo,
      author: authorLogin,
      authorAvatar: raw.user?.avatar_url || "",
      isAuthor,
      userCommented: !isAuthor,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      status,
      statusLabel,
      body: raw.body || "",
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      baseRef: "",
      headRef: "",
      isConflict: false,
      reviewDecision: null,
      ciState: null,
      commentsCount: raw.comments || 0,
      recentComments: [],
      labels: (raw.labels || []).map((l) => ({ name: l.name, color: l.color })),
    };
  }

  // ── Normalization & Chips ───────────────────────────────────────────
  function normalizeNode(node, currentLogin) {
    if (!node || !node.repository?.nameWithOwner) return null;

    const isPR = node.__typename === "PullRequest";
    const authorLogin = node.author?.login || "ghost";
    const isAuthor = authorLogin.toLowerCase() === currentLogin.toLowerCase();

    // Check if user commented
    let userCommented = false;
    let lastCommentText = "";
    let lastCommentAuthor = "";
    let lastCommentTime = "";

    const commentNodes = node.comments?.nodes || [];
    for (const c of commentNodes) {
      if (c?.author?.login?.toLowerCase() === currentLogin.toLowerCase()) {
        userCommented = true;
      }
      if (c) {
        lastCommentText = c.body || "";
        lastCommentAuthor = c.author?.login || "someone";
        lastCommentTime = c.createdAt || "";
      }
    }

    // Determine status badge
    let status = "open";
    let statusLabel = "Open";

    if (isPR) {
      if (node.merged) {
        status = "merged";
        statusLabel = "Merged";
      } else if (node.state === "CLOSED") {
        status = "closed";
        statusLabel = "Closed";
      } else if (node.isDraft) {
        status = "draft";
        statusLabel = "Draft";
      } else {
        status = "open";
        statusLabel = "Open";
      }
    } else {
      if (node.state === "CLOSED") {
        if (node.stateReason === "NOT_PLANNED") {
          status = "not-planned";
          statusLabel = "Not planned";
        } else {
          status = "closed";
          statusLabel = "Closed";
        }
      } else {
        status = "open";
        statusLabel = "Open";
      }
    }

    // CI state
    const ciState = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state || null;

    return {
      id: node.url,
      kind: isPR ? "pr" : "issue",
      number: node.number,
      title: node.title.trim(),
      url: node.url,
      repo: node.repository.nameWithOwner,
      author: authorLogin,
      authorAvatar: node.author?.avatarUrl || "",
      isAuthor,
      userCommented,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      status,
      statusLabel,
      body: node.body || "",
      additions: node.additions || 0,
      deletions: node.deletions || 0,
      changedFiles: node.changedFiles || 0,
      baseRef: node.baseRefName || "",
      headRef: node.headRefName || "",
      isConflict: node.mergeable === "CONFLICTING",
      reviewDecision: node.reviewDecision || null,
      ciState,
      commentsCount: node.comments?.totalCount || 0,
      recentComments: commentNodes,
      labels: node.labels?.nodes || [],
    };
  }

  // ── Helper formatters ───────────────────────────────────────────────
  function timeAgo(dateString) {
    const seconds = Math.floor((Date.now() - new Date(dateString)) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(days / 365);
    return `${years}y ago`;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Fetch & Background Stream Engine ────────────────────────────────
  async function startTracking(username) {
    const cleanUser = username.trim().replace(/^@/, "");
    if (!cleanUser) return;

    state.login = cleanUser;
    state.currentPage = 1;
    state.itemsMap.clear();
    state.cancelStreaming = true; // cancel any ongoing stream

    dom.searchInput.value = cleanUser;
    history.replaceState(null, "", `?name=${encodeURIComponent(cleanUser)}`);

    // UI Loading state
    dom.btnSearch.disabled = true;
    dom.btnSearch.innerHTML = `<span class="loading-dots">Tracking<i></i><i></i><i></i></span>`;
    dom.mainContent.style.display = "block";
    dom.listLoading.style.display = "flex";
    dom.listEmpty.style.display = "none";
    dom.listContainer.innerHTML = "";
    dom.telemetryBar.style.display = "grid";
    dom.streamBanner.style.display = "flex";
    dom.streamText.textContent = `Fetching first ${PAGE_SIZE} items for @${cleanUser}...`;
    dom.streamProgressFill.style.width = "5%";

    // Check IndexedDB cache first for instant display
    const cached = await getCachedProfile(cleanUser);
    if (cached && cached.items?.length) {
      cached.items.forEach((item) => state.itemsMap.set(item.id, item));
      updateTelemetry();
      populateRepoFilter();
      renderList();
    }

    try {
      // Step 1: Initial Fast Fetch (Page 1: 50 items)
      if (state.token) {
        // High-speed authenticated GraphQL mode
        const data = await fetchGraphQL(SEARCH_QUERY, {
          main: `involves:${cleanUser} sort:updated-desc`,
          extra: `commenter:${cleanUser} sort:updated-desc`,
          n: PAGE_SIZE,
          cursorMain: null,
          cursorExtra: null,
        });

        const totalEstimated = Math.max(data.main?.issueCount || 0, data.extra?.issueCount || 0);
        state.totalEstimated = totalEstimated;

        for (const node of [...(data.main?.nodes || []), ...(data.extra?.nodes || [])]) {
          const item = normalizeNode(node, cleanUser);
          if (item) state.itemsMap.set(item.id, item);
        }

        dom.listLoading.style.display = "none";
        updateTelemetry();
        populateRepoFilter();
        renderList();

        const hasMore = Boolean(data.main?.pageInfo?.hasNextPage || data.extra?.pageInfo?.hasNextPage);
        if (hasMore) {
          state.cancelStreaming = false;
          streamRemainingBatches(
            cleanUser,
            data.main?.pageInfo?.endCursor,
            data.extra?.pageInfo?.endCursor,
            Boolean(data.main?.pageInfo?.hasNextPage),
            Boolean(data.extra?.pageInfo?.hasNextPage),
            totalEstimated
          );
        } else {
          dom.streamText.textContent = `✓ All ${state.itemsMap.size} lifetime items loaded`;
          dom.streamProgressFill.style.width = "100%";
          saveCachedProfile(cleanUser, { items: Array.from(state.itemsMap.values()) });
        }
      } else {
        // Public zero-token REST search mode
        const data = await fetchRestSearch(cleanUser, 1);
        const totalEstimated = data.total_count || 0;
        state.totalEstimated = totalEstimated;

        for (const raw of data.items || []) {
          const item = normalizeRestNode(raw, cleanUser);
          if (item) state.itemsMap.set(item.id, item);
        }

        dom.listLoading.style.display = "none";
        updateTelemetry();
        populateRepoFilter();
        renderList();

        const totalPages = Math.ceil(totalEstimated / PAGE_SIZE);
        if (totalPages > 1) {
          state.cancelStreaming = false;
          streamRestPages(cleanUser, totalPages, totalEstimated);
        } else {
          dom.streamText.textContent = `✓ All ${state.itemsMap.size} lifetime items loaded`;
          dom.streamProgressFill.style.width = "100%";
          saveCachedProfile(cleanUser, { items: Array.from(state.itemsMap.values()) });
        }
      }
    } catch (err) {
      dom.listLoading.style.display = "none";
      dom.streamText.textContent = `Error: ${err.message}`;
      if (!state.itemsMap.size) {
        dom.listEmpty.style.display = "block";
        dom.listEmpty.querySelector("p").textContent = err.message;
      }
    } finally {
      dom.btnSearch.disabled = false;
      dom.btnSearch.textContent = "Track";
    }
  }

  // Background stream processor: fetches in 50-item batches until done
  async function streamRemainingBatches(login, cursorMain, cursorExtra, hasMain, hasExtra, totalEst) {
    state.isStreamingBackground = true;
    let cMain = cursorMain;
    let cExtra = cursorExtra;
    let moreMain = hasMain;
    let moreExtra = hasExtra;

    while ((moreMain || moreExtra) && !state.cancelStreaming) {
      const currentCount = state.itemsMap.size;
      const progressPercent = totalEst > 0 ? Math.min(95, Math.round((currentCount / totalEst) * 100)) : 50;

      dom.streamText.textContent = `⚡ Buffering background history: ${currentCount} loaded (${progressPercent}%)...`;
      dom.streamProgressFill.style.width = `${progressPercent}%`;

      try {
        const data = await fetchGraphQL(SEARCH_QUERY, {
          main: `involves:${login} sort:updated-desc`,
          extra: `commenter:${login} sort:updated-desc`,
          n: PAGE_SIZE,
          cursorMain: moreMain ? cMain : null,
          cursorExtra: moreExtra ? cExtra : null,
        });

        for (const node of [...(data.main?.nodes || []), ...(data.extra?.nodes || [])]) {
          const item = normalizeNode(node, login);
          if (item) state.itemsMap.set(item.id, item);
        }

        moreMain = Boolean(data.main?.pageInfo?.hasNextPage);
        moreExtra = Boolean(data.extra?.pageInfo?.hasNextPage);
        cMain = data.main?.pageInfo?.endCursor || null;
        cExtra = data.extra?.pageInfo?.endCursor || null;

        // Keep updating counts and filters live without disrupting the user's scroll position
        updateTelemetry();
        populateRepoFilter();
        updatePagerUI();

        // Brief delay between batches to respect rate limits
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        console.warn("Background stream pause/error:", err.message);
        break;
      }
    }

    state.isStreamingBackground = false;
    dom.streamText.textContent = `✓ 100% lifetime history loaded (${state.itemsMap.size} items buffered in memory & IndexedDB)`;
    dom.streamProgressFill.style.width = "100%";

    // Save full dataset into IndexedDB for instant retrieval on next visit
    saveCachedProfile(login, { items: Array.from(state.itemsMap.values()) });
    updatePagerUI();
  }

  // Background stream processor for public REST mode
  async function streamRestPages(login, totalPages, totalEst) {
    state.isStreamingBackground = true;

    for (let page = 2; page <= totalPages && !state.cancelStreaming; page++) {
      const currentCount = state.itemsMap.size;
      const progressPercent = totalEst > 0 ? Math.min(95, Math.round((currentCount / totalEst) * 100)) : 50;

      dom.streamText.textContent = `⚡ Buffering background history: ${currentCount} loaded (${progressPercent}%)...`;
      dom.streamProgressFill.style.width = `${progressPercent}%`;

      try {
        const data = await fetchRestSearch(login, page);
        for (const raw of data.items || []) {
          const item = normalizeRestNode(raw, login);
          if (item) state.itemsMap.set(item.id, item);
        }

        updateTelemetry();
        populateRepoFilter();
        updatePagerUI();

        // 350ms delay between REST pages to respect unauthenticated limits
        await new Promise((r) => setTimeout(r, 350));
      } catch (err) {
        console.warn("Background REST stream paused:", err.message);
        break;
      }
    }

    state.isStreamingBackground = false;
    dom.streamText.textContent = `✓ 100% lifetime history loaded (${state.itemsMap.size} items buffered in memory & IndexedDB)`;
    dom.streamProgressFill.style.width = "100%";
    saveCachedProfile(login, { items: Array.from(state.itemsMap.values()) });
    updatePagerUI();
  }

  // ── Telemetry & Metrics ─────────────────────────────────────────────
  function updateTelemetry() {
    const all = Array.from(state.itemsMap.values());
    const prs = all.filter((i) => i.kind === "pr");
    const mergedPrs = prs.filter((i) => i.status === "merged");
    const issues = all.filter((i) => i.kind === "issue");
    const openIssues = issues.filter((i) => i.status === "open");
    const comments = all.filter((i) => i.userCommented);
    const repos = new Set(all.map((i) => i.repo));

    const mergeRate = prs.length ? Math.round((mergedPrs.length / prs.length) * 100) : 0;

    dom.statTotal.textContent = all.length;
    dom.statPrs.textContent = prs.length;
    dom.statPrsSub.textContent = `${mergeRate}% merged (${mergedPrs.length} PRs)`;
    dom.statIssues.textContent = issues.length;
    dom.statIssuesSub.textContent = `${openIssues.length} open · ${issues.length - openIssues.length} closed`;
    dom.statComments.textContent = comments.length;
    dom.statRepos.textContent = repos.size;
  }

  // ── Filter & Pagination Engine ──────────────────────────────────────
  function getFilteredItems() {
    let items = Array.from(state.itemsMap.values());

    // Filter 1: Kind (All / PR / Issue / Comment)
    if (state.filters.kind === "pr") {
      items = items.filter((i) => i.kind === "pr");
      // Filter 2: PR Sub-status (Open / Draft / Merged / Closed)
      if (state.filters.prState !== "all") {
        items = items.filter((i) => i.status === state.filters.prState);
      }
    } else if (state.filters.kind === "issue") {
      items = items.filter((i) => i.kind === "issue");
    } else if (state.filters.kind === "comment") {
      items = items.filter((i) => i.userCommented);
    }

    // Filter 3: Repository
    if (state.filters.repo !== "all") {
      items = items.filter((i) => i.repo === state.filters.repo);
    }

    // Filter 4: Text Search
    if (state.filters.text.trim()) {
      const q = state.filters.text.toLowerCase().trim();
      items = items.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.repo.toLowerCase().includes(q) ||
          `#${i.number}`.includes(q)
      );
    }

    // Sort: Newest updated first
    items.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return items;
  }

  function populateRepoFilter() {
    const all = Array.from(state.itemsMap.values());
    const counts = {};
    for (const item of all) {
      counts[item.repo] = (counts[item.repo] || 0) + 1;
    }

    const currentVal = dom.filterRepo.value;
    dom.filterRepo.innerHTML = `<option value="all">All Repositories (${all.length})</option>`;

    const sortedRepos = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    for (const [repo, count] of sortedRepos) {
      const opt = document.createElement("option");
      opt.value = repo;
      opt.textContent = `${repo} (${count})`;
      dom.filterRepo.appendChild(opt);
    }

    if (counts[currentVal]) {
      dom.filterRepo.value = currentVal;
    }
  }

  // ── Render List & Gmail Pager ───────────────────────────────────────
  function renderList() {
    const filtered = getFilteredItems();
    const total = filtered.length;

    if (total === 0) {
      dom.listContainer.innerHTML = "";
      dom.listEmpty.style.display = "block";
      updatePagerUI(0);
      return;
    }

    dom.listEmpty.style.display = "none";

    const totalPages = Math.ceil(total / state.pageSize);
    if (state.currentPage > totalPages) state.currentPage = totalPages;
    if (state.currentPage < 1) state.currentPage = 1;

    const startIndex = (state.currentPage - 1) * state.pageSize;
    const endIndex = Math.min(startIndex + state.pageSize, total);
    const pageItems = filtered.slice(startIndex, endIndex);

    dom.listContainer.innerHTML = "";

    for (const item of pageItems) {
      const row = createItemRow(item);
      dom.listContainer.appendChild(row);
    }

    updatePagerUI(total);
  }

  function updatePagerUI(totalCount) {
    const total = totalCount !== undefined ? totalCount : getFilteredItems().length;
    if (total === 0) {
      dom.pagerCount.textContent = "0 of 0";
      dom.pagerPrev.disabled = true;
      dom.pagerNext.disabled = true;
      dom.pageButtons.innerHTML = "";
      dom.bottomSummary.textContent = "0 items";
      return;
    }

    const totalPages = Math.ceil(total / state.pageSize);
    const start = (state.currentPage - 1) * state.pageSize + 1;
    const end = Math.min(state.currentPage * state.pageSize, total);

    // Gmail-style pager text: "1–50 of 717"
    dom.pagerCount.textContent = `${start}–${end} of ${total}`;
    dom.pagerPrev.disabled = state.currentPage <= 1;
    dom.pagerNext.disabled = state.currentPage >= totalPages;

    // Bottom page jump buttons: [1] [2] [3] ...
    dom.pageButtons.innerHTML = "";
    const maxButtons = 7;
    let startPage = Math.max(1, state.currentPage - 3);
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage < maxButtons - 1) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    if (startPage > 1) {
      addPageButton(1);
      if (startPage > 2) addEllipsis();
    }

    for (let p = startPage; p <= endPage; p++) {
      addPageButton(p);
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) addEllipsis();
      addPageButton(totalPages);
    }

    dom.bottomSummary.textContent = `Page ${state.currentPage} of ${totalPages} · 50 items/page`;
  }

  function addPageButton(pageNumber) {
    const btn = document.createElement("button");
    btn.className = `page-btn ${pageNumber === state.currentPage ? "active" : ""}`;
    btn.textContent = pageNumber;
    btn.type = "button";
    btn.addEventListener("click", () => {
      state.currentPage = pageNumber;
      renderList();
      dom.mainContent.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    dom.pageButtons.appendChild(btn);
  }

  function addEllipsis() {
    const span = document.createElement("span");
    span.textContent = "…";
    span.style.padding = "4px";
    span.style.color = "var(--text-faint)";
    dom.pageButtons.appendChild(span);
  }

  // ── DOM Row Builder ─────────────────────────────────────────────────
  function createItemRow(item) {
    const row = document.createElement("div");
    row.className = "item-row";
    row.dataset.id = item.id;

    // Official status badges (Merged, Open, Closed, Draft)
    const badgeClass = item.status;
    const isExpanded = state.expandedPreviews.has(item.id);

    // CI icon
    let ciHtml = "";
    if (item.ciState === "SUCCESS") {
      ciHtml = `<span class="subline-tag ci-tag success" title="CI Passing">✓ CI</span>`;
    } else if (item.ciState === "FAILURE" || item.ciState === "ERROR") {
      ciHtml = `<span class="subline-tag ci-tag failure" title="CI Failing">✕ CI</span>`;
    } else if (item.ciState === "PENDING") {
      ciHtml = `<span class="subline-tag ci-tag pending" title="CI Running">◐ CI</span>`;
    }

    // Conflict
    const conflictHtml = item.isConflict ? `<span class="subline-tag conflict-tag">! Conflict</span>` : "";

    // Type icon (PR vs Issue vs Comment)
    let typeIconSvg = "";
    if (item.kind === "pr") {
      typeIconSvg = `<svg class="type-icon" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.128a2.251 2.251 0 101.5 0V5a2.5 2.5 0 00-2.5-2.5z"></path></svg>`;
    } else {
      typeIconSvg = `<svg class="type-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"></path><path fill-rule="evenodd" d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z"></path></svg>`;
    }

    row.innerHTML = `
      <div class="row-main">
        <div class="row-left">
          ${typeIconSvg}
          <div class="row-content">
            <div class="row-header-line">
              <span class="gh-badge ${badgeClass}">${item.statusLabel}</span>
              <span class="repo-label">${escapeHtml(item.repo)}#${item.number}</span>
              <a href="${item.url}" target="_blank" rel="noopener" class="item-title-link">${escapeHtml(item.title)}</a>
            </div>
            <div class="row-subline">
              <span>by <strong class="subline-user">${escapeHtml(item.author)}</strong></span>
              <span>·</span>
              <span>💬 ${item.commentsCount}</span>
              ${ciHtml}
              ${conflictHtml}
              ${item.userCommented ? `<span class="subline-tag" style="color:var(--gh-warn);">★ Commented</span>` : ""}
            </div>
          </div>
        </div>

        <div class="row-right">
          <span class="time-ago">${timeAgo(item.updatedAt)}</span>
          <button type="button" class="btn-preview-toggle ${isExpanded ? "expanded" : ""}" title="Toggle preview drawer">
            <span>Preview</span>
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
              <path fill-rule="evenodd" d="M12.78 6.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 7.28a.75.75 0 0 1 1.06-1.06L8 9.94l3.72-3.72a.75.75 0 0 1 1.06 0z"></path>
            </svg>
          </button>
        </div>
      </div>

      <!-- Native GitHub Preview Drawer -->
      <div class="preview-drawer ${isExpanded ? "open" : ""}">
        <div class="drawer-header">
          <div class="drawer-branches">
            ${
              item.kind === "pr" && item.baseRef
                ? `<span class="branch-pill">${escapeHtml(item.baseRef)}</span> ← <span class="branch-pill">${escapeHtml(item.headRef)}</span>`
                : `<span class="branch-pill">Issue #${item.number}</span>`
            }
            ${
              item.kind === "pr" && (item.additions || item.deletions)
                ? `<div class="diff-stats">
                     <span class="diff-add">+${item.additions}</span>
                     <span class="diff-del">-${item.deletions}</span>
                     <span>${item.changedFiles} files</span>
                   </div>`
                : ""
            }
          </div>

          <div class="drawer-actions">
            <a href="${item.url}" target="_blank" rel="noopener" class="btn-external">
              <span>Open on GitHub</span>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                <path fill-rule="evenodd" d="M10.604 1h4.146a.25.25 0 01.25.25v4.146a.25.25 0 01-.427.177L13.03 4.03 9.28 7.78a.75.75 0 01-1.06-1.06l3.75-3.75-1.543-1.543A.25.25 0 0110.604 1zM3.75 2A1.75 1.75 0 002 3.75v8.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0014 12.25v-3.5a.75.75 0 00-1.5 0v3.5a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25v-8.5a.25.25 0 01.25-.25h3.5a.75.75 0 000-1.5h-3.5z"></path>
              </svg>
            </a>
          </div>
        </div>

        <div class="drawer-body">
          ${item.body ? escapeHtml(item.body) : "<em style='color:var(--text-faint);'>No description provided.</em>"}
        </div>

        ${
          item.recentComments.length > 0
            ? `<div class="drawer-comments-section">
                 <div class="drawer-section-title">Latest Discussion Activity</div>
                 ${item.recentComments
                   .map(
                     (c) => `
                   <div class="drawer-comment-card">
                     <div class="drawer-comment-meta">
                       <b>@${escapeHtml(c.author?.login || "user")}</b>
                       <span>commented ${timeAgo(c.createdAt)}:</span>
                     </div>
                     <div class="drawer-comment-text">${escapeHtml(c.body)}</div>
                   </div>`
                   )
                   .join("")}
               </div>`
            : ""
        }
      </div>
    `;

    // Toggle Preview listener
    const previewBtn = row.querySelector(".btn-preview-toggle");
    const drawer = row.querySelector(".preview-drawer");

    previewBtn.addEventListener("click", () => {
      const nowOpen = drawer.classList.toggle("open");
      previewBtn.classList.toggle("expanded", nowOpen);
      if (nowOpen) {
        state.expandedPreviews.add(item.id);
      } else {
        state.expandedPreviews.delete(item.id);
      }
    });

    return row;
  }

  // ── Filter Event Listeners ──────────────────────────────────────────
  dom.filterKind.addEventListener("change", (e) => {
    state.filters.kind = e.target.value;
    state.currentPage = 1;

    // Show PR State dropdown only when PR is selected
    if (state.filters.kind === "pr") {
      dom.wrapPrState.style.display = "inline-flex";
    } else {
      dom.wrapPrState.style.display = "none";
      state.filters.prState = "all";
      dom.filterPrState.value = "all";
    }

    renderList();
  });

  dom.filterPrState.addEventListener("change", (e) => {
    state.filters.prState = e.target.value;
    state.currentPage = 1;
    renderList();
  });

  dom.filterRepo.addEventListener("change", (e) => {
    state.filters.repo = e.target.value;
    state.currentPage = 1;
    renderList();
  });

  dom.filterText.addEventListener("input", (e) => {
    state.filters.text = e.target.value;
    state.currentPage = 1;
    renderList();
  });

  // ── Pagination Nav Listeners ────────────────────────────────────────
  dom.pagerPrev.addEventListener("click", () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      renderList();
      dom.mainContent.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  dom.pagerNext.addEventListener("click", () => {
    const total = getFilteredItems().length;
    const totalPages = Math.ceil(total / state.pageSize);
    if (state.currentPage < totalPages) {
      state.currentPage++;
      renderList();
      dom.mainContent.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  // ── Search & Form Handlers ──────────────────────────────────────────
  dom.searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    startTracking(dom.searchInput.value);
  });

  dom.inputClear.addEventListener("click", () => {
    dom.searchInput.value = "";
    dom.inputClear.style.display = "none";
    dom.searchInput.focus();
  });

  dom.searchInput.addEventListener("input", () => {
    dom.inputClear.style.display = dom.searchInput.value ? "block" : "none";
  });

  dom.quickPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      const user = pill.dataset.user;
      dom.searchInput.value = user;
      startTracking(user);
    });
  });

  // ── Theme Switcher ──────────────────────────────────────────────────
  function initTheme() {
    const saved = localStorage.getItem("ghtrack_theme");
    const theme = saved || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    applyTheme(theme);
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ghtrack_theme", theme);
    if (theme === "light") {
      dom.iconSun.style.display = "none";
      dom.iconMoon.style.display = "block";
    } else {
      dom.iconSun.style.display = "block";
      dom.iconMoon.style.display = "none";
    }
  }

  dom.btnTheme.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme;
    applyTheme(current === "light" ? "dark" : "light");
  });

  // ── Token Management Modal ──────────────────────────────────────────
  function updateTokenBadge() {
    if (state.token) {
      dom.tokenDot.classList.add("active");
      dom.tokenLabel.textContent = "Token: Active (5k/hr)";
    } else {
      dom.tokenDot.classList.remove("active");
      dom.tokenLabel.textContent = "Token: Public";
    }
  }

  dom.btnToken.addEventListener("click", () => {
    dom.inputPat.value = state.token;
    dom.tokenTestResult.style.display = "none";
    dom.modalToken.classList.add("open");
    dom.inputPat.focus();
  });

  dom.modalTokenClose.addEventListener("click", () => {
    dom.modalToken.classList.remove("open");
  });

  dom.btnSaveToken.addEventListener("click", () => {
    const val = dom.inputPat.value.trim();
    state.token = val;
    if (val) {
      localStorage.setItem("ghtrack_token", val);
    } else {
      localStorage.removeItem("ghtrack_token");
    }
    updateTokenBadge();
    dom.modalToken.classList.remove("open");
  });

  dom.btnClearToken.addEventListener("click", () => {
    state.token = "";
    localStorage.removeItem("ghtrack_token");
    dom.inputPat.value = "";
    dom.tokenTestResult.style.display = "none";
    updateTokenBadge();
    dom.modalToken.classList.remove("open");
  });

  dom.btnTestToken.addEventListener("click", async () => {
    const token = dom.inputPat.value.trim();
    if (!token) {
      dom.tokenTestResult.className = "token-test-result error";
      dom.tokenTestResult.textContent = "Please enter a token first.";
      dom.tokenTestResult.style.display = "block";
      return;
    }

    dom.tokenTestResult.className = "token-test-result";
    dom.tokenTestResult.textContent = "Testing token with GitHub API...";
    dom.tokenTestResult.style.display = "block";

    try {
      const res = await fetch(`${GITHUB_REST_ENDPOINT}/rate_limit`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "ghtrack-web/1.0",
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);

      const remaining = data.rate?.remaining ?? "N/A";
      const limit = data.rate?.limit ?? 5000;
      dom.tokenTestResult.className = "token-test-result success";
      dom.tokenTestResult.textContent = `✓ Valid Token! ${remaining} of ${limit} requests remaining.`;
    } catch (err) {
      dom.tokenTestResult.className = "token-test-result error";
      dom.tokenTestResult.textContent = `✕ Test Failed: ${err.message}`;
    }
  });

  // ── Export Modal ────────────────────────────────────────────────────
  dom.btnExport.addEventListener("click", () => {
    generateExportContent("md");
    dom.modalExport.classList.add("open");
  });

  dom.modalExportClose.addEventListener("click", () => {
    dom.modalExport.classList.remove("open");
  });

  dom.tabExportMd.addEventListener("click", () => {
    dom.tabExportMd.classList.add("active");
    dom.tabExportJson.classList.remove("active");
    generateExportContent("md");
  });

  dom.tabExportJson.addEventListener("click", () => {
    dom.tabExportJson.classList.add("active");
    dom.tabExportMd.classList.remove("active");
    generateExportContent("json");
  });

  function generateExportContent(format) {
    const items = getFilteredItems();
    if (format === "json") {
      dom.exportContent.value = JSON.stringify(items, null, 2);
    } else {
      let md = `# GitHub Lifetime Work for @${state.login}\n\n`;
      md += `*Exported from ghtrack on ${new Date().toISOString().split("T")[0]}*\n\n`;
      md += `| Type | Status | Repository | Number | Title | Updated |\n`;
      md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
      for (const i of items) {
        md += `| ${i.kind.toUpperCase()} | ${i.statusLabel} | \`${i.repo}\` | #${i.number} | [${i.title.replace(/\|/g, "\\|")}](${i.url}) | ${i.updatedAt.split("T")[0]} |\n`;
      }
      dom.exportContent.value = md;
    }
  }

  dom.btnCopyExport.addEventListener("click", async () => {
    await navigator.clipboard.writeText(dom.exportContent.value);
    dom.btnCopyExport.textContent = "Copied!";
    setTimeout(() => (dom.btnCopyExport.textContent = "Copy to Clipboard"), 1500);
  });

  dom.btnDownloadExport.addEventListener("click", () => {
    const isMd = dom.tabExportMd.classList.contains("active");
    const ext = isMd ? "md" : "json";
    const type = isMd ? "text/markdown" : "application/json";
    const blob = new Blob([dom.exportContent.value], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ghtrack-${state.login}-${new Date().toISOString().split("T")[0]}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ── Keyboard Shortcuts ──────────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    // Focus search on '/'
    if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      dom.filterText.focus();
    }
    // Close modals on Escape
    if (e.key === "Escape") {
      dom.modalToken.classList.remove("open");
      dom.modalExport.classList.remove("open");
    }
  });

  // ── Initialization ──────────────────────────────────────────────────
  initTheme();
  updateTokenBadge();

  // URL Query handling: ?name=ramlakhanmadheshiya
  const params = new URLSearchParams(window.location.search);
  const initialName = params.get("name") || params.get("u") || "";
  if (initialName) {
    dom.searchInput.value = initialName;
    startTracking(initialName);
  }
})();
