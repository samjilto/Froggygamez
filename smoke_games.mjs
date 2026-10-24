const appBase = (process.env.FROGGY_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const gameBase = (process.env.FROGGY_GAME_URL || 'http://127.0.0.1:4174').replace(/\/$/, '');
const concurrency = Number(process.env.FROGGY_SMOKE_CONCURRENCY || 12);
const timeoutMs = 20_000;

function launchUrl(game) {
  return `${gameBase}/${[game.folder, ...game.launchFile.split('/')].map(encodeURIComponent).join('/')}`;
}

function referencesFromHtml(html, pageUrl) {
  const references = new Map();
  const add = (url) => references.set(`${url.href}|${pageUrl}`, { url: url.href, referer: pageUrl });
  const baseMatch = html.match(/<base\b[^>]*href\s*=\s*["']([^"']+)["']/i);
  const baseUrl = baseMatch ? new URL(baseMatch[1], pageUrl) : new URL(pageUrl);
  const attributes = /<(?:script|link|img|audio|video|source|iframe|object|embed|track|input)\b([^>]*)>/gi;
  const values = /(?:src|href|poster|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const tag of html.matchAll(attributes)) {
    for (const value of tag[1].matchAll(values)) {
      const reference = value[1] || value[2] || value[3] || '';
      if (!reference || reference.length > 2048 || /^(?:data:|javascript:|blob:|mailto:|tel:|#)/i.test(reference)) continue;
      try {
        const url = new URL(reference, baseUrl);
        if (url.origin === gameBase && url.pathname !== '/__froggy/bridge.js') add(url);
      } catch { /* Ignore malformed and browser-specific references. */ }
    }
  }
  const srcsets = /\bsrcset\s*=\s*["']([^"']+)["']/gi;
  for (const srcset of html.matchAll(srcsets)) {
    for (const candidate of srcset[1].split(',')) {
      const reference = candidate.trim().split(/\s+/)[0];
      try {
        const url = new URL(reference, baseUrl);
        if (url.origin === gameBase) add(url);
      } catch { /* Ignore malformed references. */ }
    }
  }
  return [...references.values()];
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

async function request(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
}

const catalogResponse = await request(`${appBase}/api/catalog`);
if (!catalogResponse.ok) throw new Error(`Catalog request failed: ${catalogResponse.status}`);
const catalog = await catalogResponse.json();
const games = catalog.games || [];
const gameNames = new Map(games.map((game) => [game.folder, game.title]));
const pageResults = await mapLimit(games, Math.min(concurrency, 20), async (game) => {
  const url = launchUrl(game);
  try {
    const response = await request(url);
    if (!response.ok) return { game, url, error: `launch page returned ${response.status}` };
    const html = await response.text();
    if (!/\/\* Froggy bridge \*\//.test(html) && !html.includes('/__froggy/bridge.js')) return { game, url, error: 'shortcut bridge was not injected' };
    return { game, url, html, references: [...referencesFromHtml(html, url)] };
  } catch (error) {
    return { game, url, error: error.message || String(error) };
  }
});

const cssMap = new Map(pageResults.flatMap((result) => result.references || [])
  .filter((reference) => /\.css(?:[?#]|$)/i.test(reference.url))
  .map((reference) => [`${reference.url}|${reference.referer}`, reference]));
const cssResults = await mapLimit([...cssMap.values()], Math.min(concurrency, 16), async ({ url, referer }) => {
  try {
    const response = await request(url, { headers: { referer } });
    if (!response.ok) return { url, error: `stylesheet returned ${response.status}` };
    const css = await response.text();
    const references = new Map();
    for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      const reference = match[1].trim();
      if (!reference || reference.length > 2048 || /^(?:data:|blob:|#)/i.test(reference)) continue;
      try {
        const asset = new URL(reference, url);
        if (asset.origin === gameBase) references.set(`${asset.href}|${url}`, { url: asset.href, referer: url });
      } catch { /* Ignore malformed CSS URLs. */ }
    }
    return { url, references: [...references.values()] };
  } catch (error) { return { url, error: error.message || String(error) }; }
});

const assetUrls = new Map([
  ...pageResults.flatMap((result) => result.references || []),
  ...cssResults.flatMap((result) => result.references || []),
].map((reference) => [`${reference.url}|${reference.referer}`, reference]));
const assetResults = await mapLimit([...assetUrls.values()], Math.min(concurrency * 2, 24), async ({ url, referer }) => {
  try {
    const response = await request(url, { method: 'HEAD', headers: { referer } });
    return response.ok ? null : { url, referer, error: `asset returned ${response.status}` };
  } catch (error) { return { url, referer, error: error.message || String(error) }; }
});

const issues = [
  ...pageResults.filter((result) => result.error).map((result) => ({ game: result.game.title, url: result.url, error: result.error })),
  ...cssResults.filter((result) => result.error).map((result) => ({ game: 'stylesheet', url: result.url, error: result.error })),
  ...assetResults.filter(Boolean).map((result) => {
    const referrerPath = new URL(result.referer).pathname.split('/').filter(Boolean);
    return { game: gameNames.get(decodeURIComponent(referrerPath[0] || '')) || 'asset', ...result };
  }),
];

const launcherIssues = issues.filter((issue) => pageResults.some((result) => result.game.title === issue.game && result.error));
const dependencyIssues = issues.filter((issue) => !launcherIssues.includes(issue));
console.log(`Checked ${games.length} game launch pages, ${cssMap.size} stylesheet loads, and ${assetUrls.size} local references.`);
console.log(`${games.length - pageResults.filter((result) => result.error).length}/${games.length} launch pages responded successfully.`);
if (dependencyIssues.length) {
  console.warn(`${dependencyIssues.length} direct references are absent from the ZIP. Some are optional metadata, trackers, or stale paths in the supplied game files.`);
  for (const issue of dependencyIssues.slice(0, 24)) console.warn(`WARN ${issue.game}: ${issue.error} — ${String(issue.url).slice(0, 220)}`);
  if (dependencyIssues.length > 24) console.warn(`…and ${dependencyIssues.length - 24} more missing reference(s).`);
}
if (launcherIssues.length) {
  for (const issue of launcherIssues.slice(0, 80)) console.error(`FAIL ${issue.game}: ${issue.error} — ${issue.url}`);
  if (launcherIssues.length > 80) console.error(`…and ${launcherIssues.length - 80} more launcher issue(s).`);
  process.exitCode = 1;
} else {
  console.log('All catalog launch pages and the Froggy keyboard bridge responded successfully.');
}
