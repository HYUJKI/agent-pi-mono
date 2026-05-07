// Simple proxy server to avoid CORS issues
import { createServer } from "node:http";

const PORT = 3002;
const TARGET_BASE = "https://api.minimaxi.com/anthropic";

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    });
    res.end();
    return;
  }

  try {
    const url = TARGET_BASE + req.url;
    const headers = {};

    // Forward relevant headers, removing problematic ones
    for (const [key, value] of Object.entries(req.headers)) {
      if (!key.startsWith("x-stainless") && key !== "host") {
        headers[key] = value;
      }
    }

    // Add CORS headers
    headers["Access-Control-Allow-Origin"] = "*";

    const response = await fetch(url, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
    });

    res.writeHead(response.status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
    });

    response.body.pipe(res);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Proxy error: " + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`Proxy server running at http://localhost:${PORT}`);
});