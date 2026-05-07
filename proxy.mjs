// Simple proxy server to avoid CORS issues with MiniMax API
// Run with: node proxy.mjs

import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";

const PORT = 3002;
const TARGET_HOST = "api.minimaxi.com";
const TARGET_PATH = "/anthropic";

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    });
    res.end();
    return;
  }

  const options = {
    hostname: TARGET_HOST,
    port: 443,
    path: TARGET_PATH + req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: TARGET_HOST,
    },
  };

  // Remove problematic headers
  delete options.headers["x-stainless-os"];
  delete options.headers["x-stainless-os-version"];
  delete options.headers["x-stainless-language"];
  delete options.headers["x-stainless-package-version"];
  delete options.headers["x-stainless-async"];

  const proxyReq = https.request(options, (proxyRes) => {
    const contentEncoding = proxyRes.headers["content-encoding"];

    // Set CORS headers
    const headers = {
      "Content-Type": "text/event-stream",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Cache-Control": "no-cache",
      "Transfer-Encoding": "chunked",
    };

    res.writeHead(proxyRes.statusCode, headers);

    if (contentEncoding === "gzip") {
      // Decompress gzip response and forward as plain text
      const gunzip = zlib.createGunzip();
      proxyRes.pipe(gunzip).pipe(res);
    } else if (contentEncoding === "deflate") {
      const inflate = zlib.createInflate();
      proxyRes.pipe(inflate).pipe(res);
    } else if (contentEncoding === "br") {
      const brotli = zlib.createBrotliDecompress();
      proxyRes.pipe(brotli).pipe(res);
    } else {
      proxyRes.pipe(res);
    }
  });

  proxyReq.on("error", (err) => {
    res.writeHead(500);
    res.end("Proxy error: " + err.message);
  });

  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(`MiniMax proxy running at http://localhost:${PORT}`);
});