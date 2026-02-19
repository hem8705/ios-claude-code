'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const net = require('net');

const PORT = process.env.PORT || 4242;
const TTYD_HOST = '127.0.0.1';
const TTYD_PORT = 4243;
const STATIC_DIR = __dirname;

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '__pycache__', '.next', '.nuxt', 'out', '.cache',
  '.parcel-cache', 'vendor', '.venv', 'venv', 'env',
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
};

// ---------- helpers ----------

function send(res, status, body, contentType = 'application/json') {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function sendError(res, status, msg) {
  send(res, status, { error: msg });
}

function parseQuery(url) {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const params = {};
  new URLSearchParams(url.slice(idx + 1)).forEach((v, k) => { params[k] = v; });
  return params;
}

// ---------- file tree ----------

function buildTree(dir, depth = 0) {
  if (depth > 4) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const result = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env') continue;
    if (IGNORE_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: fullPath,
        type: 'dir',
        children: buildTree(fullPath, depth + 1),
      });
    } else if (entry.isFile()) {
      result.push({ name: entry.name, path: fullPath, type: 'file' });
    }
  }

  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

// ---------- git helpers ----------

function gitDiff(filePath) {
  const cwd = path.dirname(filePath);
  const opts = { cwd, timeout: 5000, encoding: 'utf8' };
  let diff = '';
  let status = '';
  let hasDiff = false;

  try {
    diff = execSync(`git diff HEAD -- "${filePath}"`, opts);
    if (!diff.trim()) {
      diff = execSync(`git diff --cached -- "${filePath}"`, opts);
    }
    hasDiff = diff.trim().length > 0;
  } catch {
    diff = '';
  }

  try {
    status = execSync(`git status --porcelain -- "${filePath}"`, opts).trim();
  } catch {
    status = '';
  }

  return { diff, status, hasDiff };
}

// ---------- static file serving ----------

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch {
    sendError(res, 404, 'Not found');
  }
}

// ---------- ttyd proxy ----------

function proxyRequest(req, res, targetPath) {
  const options = {
    hostname: TTYD_HOST,
    port: TTYD_PORT,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: `${TTYD_HOST}:${TTYD_PORT}` },
  };

  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxy.on('error', () => {
    sendError(res, 502, 'ttyd not running — start.sh may need to be re-run');
  });

  req.pipe(proxy);
}

function proxyWebSocket(req, socket, head) {
  const targetSocket = net.connect(TTYD_PORT, TTYD_HOST, () => {
    // Forward the original upgrade request headers
    const reqLines = [
      `${req.method} ${req.url.replace(/^\/terminal/, '')} HTTP/${req.httpVersion}`,
      `Host: ${TTYD_HOST}:${TTYD_PORT}`,
    ];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      const val  = req.rawHeaders[i + 1];
      if (name.toLowerCase() === 'host') continue;
      reqLines.push(`${name}: ${val}`);
    }
    reqLines.push('', '');
    targetSocket.write(reqLines.join('\r\n'));
    if (head && head.length) targetSocket.write(head);
    socket.pipe(targetSocket);
    targetSocket.pipe(socket);
  });

  targetSocket.on('error', () => {
    socket.destroy();
  });
  socket.on('error', () => {
    targetSocket.destroy();
  });
}

// ---------- request router ----------

function router(req, res) {
  const url  = req.url;
  const pathname = url.split('?')[0];

  // CORS headers (for local dev convenience)
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Static shell files
  if (pathname === '/' || pathname === '/index.html') {
    return serveStatic(res, path.join(STATIC_DIR, 'index.html'));
  }
  if (pathname === '/manifest.json') {
    return serveStatic(res, path.join(STATIC_DIR, 'manifest.json'));
  }
  if (pathname === '/sw.js') {
    return serveStatic(res, path.join(STATIC_DIR, 'sw.js'));
  }

  // Terminal proxy (non-WebSocket)
  if (pathname.startsWith('/terminal')) {
    const targetPath = pathname.replace(/^\/terminal/, '') || '/';
    return proxyRequest(req, res, `${targetPath}${url.includes('?') ? url.slice(url.indexOf('?')) : ''}`);
  }

  // API routes
  if (pathname === '/api/tree') {
    const { dir } = parseQuery(url);
    const rootDir = dir ? path.resolve(dir) : process.cwd();
    try {
      fs.accessSync(rootDir);
    } catch {
      return sendError(res, 400, 'Directory not accessible');
    }
    const tree = buildTree(rootDir);
    return send(res, 200, { root: rootDir, tree });
  }

  if (pathname === '/api/diff') {
    const { file } = parseQuery(url);
    if (!file) return sendError(res, 400, 'file param required');
    const absFile = path.resolve(file);
    try {
      fs.accessSync(absFile, fs.constants.R_OK);
    } catch {
      return sendError(res, 404, 'File not found');
    }
    const result = gitDiff(absFile);
    return send(res, 200, result);
  }

  if (pathname === '/api/read') {
    const { file } = parseQuery(url);
    if (!file) return sendError(res, 400, 'file param required');
    const absFile = path.resolve(file);
    let stat;
    try {
      stat = fs.statSync(absFile);
    } catch {
      return sendError(res, 404, 'File not found');
    }
    if (stat.size > 500 * 1024) {
      return sendError(res, 413, 'File too large (>500KB)');
    }
    try {
      const content = fs.readFileSync(absFile, 'utf8');
      return send(res, 200, content, 'text/plain; charset=utf-8');
    } catch {
      return sendError(res, 500, 'Could not read file');
    }
  }

  sendError(res, 404, 'Not found');
}

// ---------- server ----------

const server = http.createServer(router);

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/terminal')) {
    proxyWebSocket(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Claude Mobile Dev server running`);
  console.log(`  Local:  http://localhost:${PORT}`);
  try {
    const tsIP = execSync('tailscale ip -4 2>/dev/null', { encoding: 'utf8', timeout: 3000 }).trim();
    if (tsIP) console.log(`  Phone:  http://${tsIP}:${PORT}`);
  } catch {
    console.log(`  Phone:  (run 'tailscale ip -4' to get your Tailscale IP)`);
  }
  console.log('');
});
