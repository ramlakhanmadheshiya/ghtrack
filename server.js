// ── ghtrack Local & Cloudflare Development Server ────────────────────────
// Zero npm dependencies — uses native Node.js http, https, fs, path, child_process.

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

// Retrieve GitHub Token: from process.env or local `gh auth token`
let GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
if (!GITHUB_TOKEN) {
  try {
    GITHUB_TOKEN = execSync("gh auth token", { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch {
    GITHUB_TOKEN = "";
  }
}

if (GITHUB_TOKEN) {
  console.log("✓ GitHub Token loaded (5,000 requests/hour enabled)");
} else {
  console.warn("⚠ No GitHub Token detected. Public rate limits apply.");
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // 1. GraphQL API Proxy (Uses token, 5,000 req/hr)
  if (pathname === "/api/graphql" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const headers = {
        "Content-Type": "application/json",
        "User-Agent": "ghtrack-server/1.0",
        Accept: "application/vnd.github.v3+json",
      };
      if (GITHUB_TOKEN) {
        headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
      }

      const proxyReq = https.request(
        "https://api.github.com/graphql",
        {
          method: "POST",
          headers,
        },
        (proxyRes) => {
          let resBody = "";
          proxyRes.on("data", (chunk) => (resBody += chunk));
          proxyRes.on("end", () => {
            const isJson = (proxyRes.headers["content-type"] || "").includes("json");
            res.writeHead(proxyRes.statusCode, {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            });
            if (isJson) {
              res.end(resBody);
            } else {
              res.end(
                JSON.stringify({
                  error: `GitHub API returned HTTP ${proxyRes.statusCode}`,
                  details: resBody.slice(0, 300),
                })
              );
            }
          });
        }
      );

      proxyReq.on("error", (err) => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      });

      proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  // 2. Real GitHub Page Embedder (/view?url=...)
  // Strips X-Frame-Options and Content-Security-Policy so GitHub can render in iframe
  if (pathname === "/view") {
    const targetUrl = parsedUrl.searchParams.get("url");
    if (!targetUrl || !targetUrl.startsWith("https://github.com/")) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Invalid GitHub URL");
      return;
    }

    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };

    https
      .get(targetUrl, { headers }, (ghRes) => {
        // Follow redirects (e.g. 301/302)
        if (ghRes.statusCode >= 300 && ghRes.statusCode < 400 && ghRes.headers.location) {
          const redirectUrl = new URL(ghRes.headers.location, targetUrl).toString();
          res.writeHead(302, { Location: `/view?url=${encodeURIComponent(redirectUrl)}` });
          res.end();
          return;
        }

        const outHeaders = {
          "Content-Type": "text/html; charset=utf-8",
          // Remove frame blockers
          "X-Frame-Options": "ALLOWALL",
        };

        let html = "";
        ghRes.setEncoding("utf8");
        ghRes.on("data", (chunk) => (html += chunk));
        ghRes.on("end", () => {
          // Inject base href and minimal CSS tweaks to make it fit inside the preview drawer
          const injectedHead = `
            <base href="https://github.com/">
            <style>
              /* Hide top global GitHub navigation inside the embedded preview */
              .AppHeader, header[role="banner"], .Header, .header-wrapper, #js-header-nav { display: none !important; }
              body { padding-top: 0 !important; }
            </style>
          `;
          html = html.replace("<head>", `<head>${injectedHead}`);

          res.writeHead(ghRes.statusCode || 200, outHeaders);
          res.end(html);
        });
      })
      .on("error", (err) => {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end(`Failed to load GitHub page: ${err.message}`);
      });
    return;
  }

  // 3. Static File Serving
  let relativePath = pathname === "/" ? "/index.html" : pathname;
  // Security check: avoid directory traversal
  const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, "");
  const filePath = path.join(ROOT, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`ghtrack running at http://localhost:${PORT}/`);
});
