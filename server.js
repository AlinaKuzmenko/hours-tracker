// Local dev server: node server.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const handler = require('./lib/handler');
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) return handler(req, res);
  const full = path.join(PUBLIC, path.normalize(url === '/' ? '/index.html' : url));
  if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(full).pipe(res);
}).listen(PORT, () => {
  console.log(`Open http://localhost:${PORT}`);
});
