import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInflateRaw } from 'node:zlib';
import { pipeline } from 'node:stream';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_PORT = Number(process.env.FROGGY_APP_PORT || 4173);
const GAME_PORT = Number(process.env.FROGGY_GAME_PORT || 4174);
const indexFile = path.join(here, 'data', 'archive-index.json');
const catalogFile = path.join(here, 'data', 'catalog.json');
const appIndex = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
const bundledArchivePath = path.join(here, 'games.zip');
const archivePath = process.env.GAMES_ZIP || (fs.existsSync(bundledArchivePath) ? bundledArchivePath : appIndex.archive.archivePath);
const entries = new Map(appIndex.entries.map((entry) => [entry.path, entry]));
const gameFolders = catalog.games.map((game) => game.folder).sort((a, b) => b.length - a.length);
const gameEntriesByFolder = new Map(gameFolders.map((folder) => [folder, new Map()]));
for (const entry of appIndex.entries) {
  const slash = entry.path.indexOf('/');
  if (slash < 0) continue;
  const folder = entry.path.slice(0, slash);
  const basename = path.posix.basename(entry.path);
  const byName = gameEntriesByFolder.get(folder);
  if (!byName) continue;
  if (!byName.has(basename)) byName.set(basename, []);
  byName.get(basename).push(entry);
}
const types = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.unityweb': 'application/octet-stream', '.data': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.xml': 'application/xml; charset=utf-8',
  '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8',
}));

function archiveState() {
  try {
    const stat = fs.statSync(archivePath);
    const matches = stat.size === appIndex.archive.archiveSize;
    return {
      ready: matches,
      path: archivePath,
      expectedSize: appIndex.archive.archiveSize,
      actualSize: stat.size,
      message: matches ? null : 'The archive changed since this catalog was built. Rebuild the index to refresh it.',
    };
  } catch {
    return {
      ready: false,
      path: archivePath,
      expectedSize: appIndex.archive.archiveSize,
      actualSize: null,
      message: 'The game ZIP is not available at the configured path.',
    };
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function decodePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const normalized = path.posix.normalize(decoded.replace(/^\/+/, ''));
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..' || normalized.includes('\0')) return null;
  return normalized;
}

function streamArchiveEntry(request, response, entry) {
  const state = archiveState();
  if (!state.ready) {
    sendJson(response, 503, { error: state.message });
    return;
  }
  const type = types.get(path.extname(entry.path).toLowerCase()) || 'application/octet-stream';
  const headers = {
    'content-type': type,
    'cache-control': 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': '*',
    'cross-origin-resource-policy': 'cross-origin',
  };
  if (request.method === 'HEAD') {
    response.writeHead(200, { ...headers, 'content-length': entry.size });
    response.end();
    return;
  }
  if (entry.size === 0) {
    response.writeHead(200, { ...headers, 'content-length': 0 });
    response.end();
    return;
  }
  const range = request.headers.range;
  if (range && entry.method === 0) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), entry.size - 1) : entry.size - 1;
      if (start <= end && start < entry.size) {
        headers['content-length'] = end - start + 1;
        headers['content-range'] = `bytes ${start}-${end}/${entry.size}`;
        response.writeHead(206, headers);
        fs.createReadStream(archivePath, { start: entry.dataOffset + start, end: entry.dataOffset + end }).pipe(response);
        return;
      }
      response.writeHead(416, { ...headers, 'content-range': `bytes */${entry.size}` });
      response.end();
      return;
    }
  }
  headers['content-length'] = entry.size;
  response.writeHead(200, headers);
  try {
    const source = fs.createReadStream(archivePath, {
      start: entry.dataOffset,
      end: entry.dataOffset + entry.compressedSize - 1,
    });
    const stream = entry.method === 8 ? source.pipe(createInflateRaw()) : source;
    pipeline(stream, response, (error) => {
      if (error && !response.destroyed) response.destroy(error);
    });
  } catch (error) {
    if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Could not read this game asset.');
  }
}

function serveHtmlEntry(request, response, entry) {
  const state = archiveState();
  if (!state.ready) {
    sendJson(response, 503, { error: state.message });
    return;
  }
  const source = fs.createReadStream(archivePath, {
    start: entry.dataOffset,
    end: entry.dataOffset + entry.compressedSize - 1,
  });
  const stream = entry.method === 8 ? source.pipe(createInflateRaw()) : source;
  const chunks = [];
  let total = 0;
  stream.on('data', (chunk) => { chunks.push(chunk); total += chunk.length; });
  stream.on('error', () => {
    if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Could not read this game page.');
  });
  stream.on('end', () => {
    const html = Buffer.concat(chunks, total);
    const bridge = '<script src="/__froggy/bridge.js" defer></script>';
    const text = html.toString('utf8');
    const updated = /<\/body\s*>/i.test(text) ? text.replace(/<\/body\s*>/i, `${bridge}</body>`) : `${text}${bridge}`;
    const body = Buffer.from(updated);
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': body.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
    });
    response.end(body);
  });
}

function appRequest(request, response) {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/api/status') {
    const source = archiveState();
    sendJson(response, 200, { ready: source.ready, message: source.message, gameCount: catalog.games.length, sourceArchiveIncomplete: !appIndex.archive.stoppedBy.startsWith('central-directory') });
    return;
  }
  if (pathname === '/api/catalog') {
    sendJson(response, 200, catalog);
    return;
  }
  const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/ads.txt', ['ads.txt', 'text/plain; charset=utf-8']],
    ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/assets/froggy-mascot.png', ['assets/froggy-mascot.png', 'image/png']],
  ]);
  const file = files.get(pathname);
  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  const [relative, contentType] = file;
  const body = fs.readFileSync(path.join(here, relative));
  response.writeHead(200, { 'content-type': contentType, 'cache-control': relative === 'assets/froggy-mascot.png' ? 'public, max-age=3600' : 'no-store' });
  response.end(body);
}

function gameRequest(request, response) {
  const pathname = new URL(request.url, `http://127.0.0.1:${GAME_PORT}`).pathname;
  if (pathname === '/__froggy/bridge.js') {
    const bridge = `(() => {
  const shortcutKeys = new Set(['F2', 'F4', 'F7', 'F8', 'F9', 'F10', 'F12', 'Escape']);
  const fitRootProperties = ['position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'max-width', 'max-height', 'margin', 'transform', 'transform-origin', 'z-index'];
  const pageProperties = ['background', 'overflow', 'width', 'height', 'margin'];
  const fitState = { active: false, root: null, width: 0, height: 0, original: [] };

  function saveProperties(element, names) {
    return { element, values: names.map((name) => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]) };
  }

  function restoreProperties(saved) {
    for (const [name, value, priority] of saved.values) {
      if (value) saved.element.style.setProperty(name, value, priority);
      else saved.element.style.removeProperty(name);
    }
  }

  function setImportant(element, name, value) {
    element.style.setProperty(name, value, 'important');
  }

  function findGameSurface() {
    if (!document.body) return null;
    const viewportWidth = Math.max(window.innerWidth, document.documentElement.clientWidth);
    const viewportHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
    const minimumArea = Math.min(80000, viewportWidth * viewportHeight * 0.08);
    const ignored = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE']);
    const candidates = [...document.body.querySelectorAll('*')].filter((element) => {
      if (ignored.has(element.tagName)) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width < 140 || rect.height < 120 || rect.width * rect.height < minimumArea) return false;
      if (rect.width >= viewportWidth * 0.97 && rect.height >= viewportHeight * 0.97) return false;
      if (rect.width > viewportWidth * 1.2 || rect.height > viewportHeight * 1.2) return false;
      return true;
    });
    const depth = (element) => { let value = 0; for (let node = element; node && node !== document.body; node = node.parentElement) value++; return value; };
    candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const areaDifference = br.width * br.height - ar.width * ar.height;
      return Math.abs(areaDifference) > 2 ? areaDifference : depth(a) - depth(b);
    });
    return candidates[0] || [...document.body.children].find((element) => !ignored.has(element.tagName)) || null;
  }

  function fitGameSurface() {
    if (!document.body || !document.documentElement) return;
    if (!fitState.active) {
      const root = findGameSurface();
      if (!root || root === document.body) return;
      const rect = root.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      fitState.active = true;
      fitState.root = root;
      fitState.width = rect.width;
      fitState.height = rect.height;
      fitState.original = [
        saveProperties(document.documentElement, pageProperties),
        saveProperties(document.body, pageProperties),
        saveProperties(root, fitRootProperties),
      ];
    }

    const root = fitState.root;
    if (!root.isConnected) return;
    const viewportWidth = Math.max(1, window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight);
    const scale = Math.min(viewportWidth / fitState.width, viewportHeight / fitState.height);
    setImportant(document.documentElement, 'background', 'transparent');
    setImportant(document.documentElement, 'width', '100vw');
    setImportant(document.documentElement, 'height', '100vh');
    setImportant(document.documentElement, 'overflow', 'hidden');
    setImportant(document.body, 'background', 'transparent');
    setImportant(document.body, 'width', '100vw');
    setImportant(document.body, 'height', '100vh');
    setImportant(document.body, 'margin', '0');
    setImportant(document.body, 'overflow', 'hidden');
    setImportant(root, 'position', 'fixed');
    setImportant(root, 'top', '50%');
    setImportant(root, 'left', '50%');
    setImportant(root, 'right', 'auto');
    setImportant(root, 'bottom', 'auto');
    setImportant(root, 'width', fitState.width + 'px');
    setImportant(root, 'height', fitState.height + 'px');
    setImportant(root, 'max-width', 'none');
    setImportant(root, 'max-height', 'none');
    setImportant(root, 'margin', '0');
    setImportant(root, 'transform-origin', 'center center');
    setImportant(root, 'transform', 'translate(-50%, -50%) scale(' + scale + ')');
    setImportant(root, 'z-index', '1');
  }

  function resetGameSurface() {
    if (!fitState.active) return;
    for (const saved of fitState.original) restoreProperties(saved);
    fitState.active = false;
    fitState.root = null;
    fitState.original = [];
  }

  window.addEventListener('message', (event) => {
    if (event.source !== parent) return;
    if (event.data && event.data.type === 'froggy-fullscreen-layout') {
      if (event.data.active) fitGameSurface();
      else resetGameSurface();
    }
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    if (!fitState.active) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitGameSurface, 50);
  });

  window.addEventListener('keydown', (event) => {
    if (!shortcutKeys.has(event.key)) return;
    try { parent.postMessage({ type: 'froggy-shortcut', key: event.key }, '*'); } catch { /* Parent may be unavailable. */ }
  }, true);

  try { parent.postMessage({ type: 'froggy-game-ready' }, '*'); } catch { /* The standalone game can still run. */ }
})();`;
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(bridge);
    return;
  }
  const relativePath = decodePath(pathname);
  if (relativePath === 'health') {
    sendJson(response, 200, { ready: archiveState().ready });
    return;
  }
  if (!relativePath) {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Invalid path');
    return;
  }
  let entry = entries.get(relativePath);
  if (!entry && request.headers.referer) {
    try {
      const referer = new URL(request.headers.referer);
      const requestHost = request.headers.host;
      if (referer.host === requestHost) {
        const referrerPath = decodePath(referer.pathname);
        const folder = gameFolders.find((candidate) => referrerPath === candidate || referrerPath.startsWith(`${candidate}/`));
        if (folder) {
          entry = entries.get(`${folder}/${relativePath}`);
          if (!entry) {
            const sameName = gameEntriesByFolder.get(folder)?.get(path.posix.basename(relativePath)) || [];
            if (sameName.length === 1) entry = sameName[0];
          }
        }
      }
    } catch { /* A malformed referrer does not affect ordinary archive paths. */ }
  }
  if (!entry) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' });
    response.end('Asset not found in game archive');
    return;
  }
  if (request.method === 'GET' && ['.html', '.htm'].includes(path.extname(entry.path).toLowerCase())) {
    serveHtmlEntry(request, response, entry);
    return;
  }
  streamArchiveEntry(request, response, entry);
}

const appServer = http.createServer(appRequest);
const gameServer = http.createServer(gameRequest);
appServer.listen(APP_PORT, '127.0.0.1', () => {
  console.log(`Froggy is ready at http://127.0.0.1:${APP_PORT}`);
  const state = archiveState();
  console.log(state.ready ? `Serving ${catalog.games.length} games from ${archivePath}` : `${state.message} ${state.path}`);
});
gameServer.listen(GAME_PORT, '127.0.0.1', () => {
  console.log(`Isolated game assets are served from http://127.0.0.1:${GAME_PORT}`);
});

for (const server of [appServer, gameServer]) {
  server.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
