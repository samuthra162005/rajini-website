const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

// In-memory cache for ultra-low latency (<0.5ms) response times
const fileCache = new Map();

function getCachedFile(filePath, isHtml) {
  const stats = fs.statSync(filePath);
  const key = `${filePath}:${stats.mtimeMs}`;
  
  // For HTML, don't cache in memory during development to allow live edits
  if (isHtml) {
    const raw = fs.readFileSync(filePath);
    const gzipped = zlib.gzipSync(raw, { level: 6 });
    const etag = `W/"${stats.size}-${stats.mtimeMs}"`;
    return { raw, gzipped, stats, etag };
  }

  if (fileCache.has(key)) {
    return fileCache.get(key);
  }

  const raw = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const isCompressible = /\.(html|js|mjs|css|svg|xml|txt)$/i.test(ext);
  const gzipped = isCompressible ? zlib.gzipSync(raw, { level: 6 }) : null;
  const etag = `W/"${stats.size}-${stats.mtimeMs}"`;
  const cached = { raw, gzipped, stats, etag };
  
  fileCache.set(key, cached);
  return cached;
}

const server = http.createServer((req, res) => {
  let reqPath = decodeURI(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(__dirname, reqPath);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
    return;
  }

  try {
    const ext = path.extname(filePath).toLowerCase();
    const isHtml = ext === '.html';
    const contentType = MIME[ext] || 'application/octet-stream';
    const isCompressible = /\.(html|js|mjs|css|svg|xml|txt)$/i.test(ext);
    const acceptEncoding = req.headers['accept-encoding'] || '';
    const ifNoneMatch = req.headers['if-none-match'];

    const { raw, gzipped, stats, etag } = getCachedFile(filePath, isHtml);

    // ETag 304 Not Modified
    if (ifNoneMatch && ifNoneMatch === etag) {
      res.writeHead(304, {
        'ETag': etag,
        'Cache-Control': isHtml ? 'no-cache, no-store, must-revalidate, max-age=0' : 'public, max-age=31536000, immutable'
      });
      res.end();
      return;
    }

    const headers = {
      'Content-Type': contentType,
      'ETag': etag,
      'Connection': 'keep-alive'
    };

    if (isHtml) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    } else {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }

    if (isCompressible && gzipped && /\bgzip\b/.test(acceptEncoding)) {
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = gzipped.length;
      res.writeHead(200, headers);
      res.end(gzipped);
    } else {
      headers['Content-Length'] = raw.length;
      res.writeHead(200, headers);
      res.end(raw);
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('500 Server Error');
  }
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n===========================================`);
  console.log(`  High-Speed Server running at: ${url}`);
  console.log(`  In-memory Cache + WebP + Gzip + HTTP Keep-Alive`);
  console.log(`===========================================\n`);
});
