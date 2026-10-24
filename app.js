const GAME_PORT = 4174;
const DEFAULT_SETTINGS = { quickExit: 'https://www.khanacademy.org/', panicKey: 'F2' };
const PAGE_SIZE = 36;
const app = document.getElementById('app');
const searchInput = document.getElementById('game-search');
const toastRegion = document.getElementById('toast-region');
const refreshButton = document.getElementById('refresh-games');
const gameOrigin = `${location.protocol}//${location.hostname || '127.0.0.1'}:${GAME_PORT}`;

const state = {
  catalog: [],
  status: null,
  query: '',
  category: 'All games',
  sort: 'Featured',
  visibleCount: PAGE_SIZE,
  playStarted: new Set(),
  favorites: [],
  recent: [],
  playHistory: {},
  settings: { ...DEFAULT_SETTINGS },
};

function activeStorage() {
  try {
    return localStorage;
  } catch { /* Storage can be disabled by the browser. */ }
  return null;
}

function storedJson(key, fallback) {
  try { return JSON.parse(activeStorage()?.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

function persist(key, value) {
  try { activeStorage()?.setItem(key, JSON.stringify(value)); }
  catch { showToast('Your browser could not save this Froggy data.', 'info'); }
}

function hydrateUserData() {
  try {
    for (const key of ['froggy.favorites', 'froggy.recent', 'froggy.playHistory']) {
      if (!localStorage.getItem(key) && sessionStorage.getItem(key)) localStorage.setItem(key, sessionStorage.getItem(key));
    }
    localStorage.setItem('froggy.storageChoice', 'save');
  } catch { /* Continue in memory when storage is unavailable. */ }
  state.favorites = storedJson('froggy.favorites', []);
  state.recent = storedJson('froggy.recent', []);
  state.playHistory = storedJson('froggy.playHistory', {});
  state.settings = { ...DEFAULT_SETTINGS, ...storedJson('froggy.settings', {}) };
}

hydrateUserData();

function applySettings() {
  document.body.dataset.accent = 'mint';
  document.title = 'Froggy';
  const favicon = document.getElementById('app-icon');
  favicon.href = '/assets/froggy-mascot.png?v=2';
  favicon.type = 'image/png';
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function assetUrl(game, relativePath) {
  if (!relativePath) return '';
  const parts = [game.folder, ...relativePath.split('/')];
  return `${gameOrigin}/${parts.map((part) => encodeURIComponent(part)).join('/')}`;
}

function fallbackLetter(game) {
  const match = game.title.match(/[a-z0-9]/i);
  return match ? match[0].toUpperCase() : 'F';
}

function lineIcon(name) {
  const icons = {
    search: '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect>',
    zap: '<path d="m13 2-3 8h7l-6 12 1-9H5l8-11Z"></path>',
    compass: '<circle cx="12" cy="12" r="10"></circle><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3 6.3-2.1Z"></path>',
    gamepad: '<path d="M6.5 8h11a4.5 4.5 0 0 1 4.4 3.6l.7 3.7a2.4 2.4 0 0 1-4 2.2L16 15H8l-2.6 2.5a2.4 2.4 0 0 1-4-2.2l.7-3.7A4.5 4.5 0 0 1 6.5 8Z"></path><path d="M8 10.5v4m-2-2h4m6.5-.5h.01m2 2h.01"></path>',
    sparkle: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z"></path><path d="m19 14 1 2.5 2.5 1-2.5 1L19 21l-1-2.5-2.5-1 2.5-1L19 14Z"></path>',
    puzzle: '<path d="M19 13h-2a2 2 0 1 0-4 0v2h-2a2 2 0 1 0 0 4h2v2h6v-6h2v-2Z"></path><path d="M13 7V5a2 2 0 1 0-4 0v2H7a2 2 0 1 0 0 4h2v2"></path><path d="M7 7H3v14h8"></path>',
    trophy: '<path d="M8 21h8m-4-4v4"></path><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"></path><path d="M7 6H4v2a4 4 0 0 0 4 4m9-6h3v2a4 4 0 0 1-4 4"></path>',
    arrow: '<path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path>',
  };
  return `<svg class="lucide-icon lucide-${name}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.gamepad}</svg>`;
}

function categoryIcon(category) {
  return ({ 'All games': 'grid', Action: 'zap', Adventure: 'compass', Arcade: 'gamepad', Casual: 'sparkle', Puzzle: 'puzzle', Sports: 'trophy' })[category] || 'gamepad';
}

function gameCard(game) {
  const poster = game.poster ? `<img class="game-poster" src="${escapeHtml(assetUrl(game, game.poster))}" alt="" loading="lazy" onerror="this.remove()">` : '';
  const icon = game.icon ? `<img src="${escapeHtml(assetUrl(game, game.icon))}" alt="" loading="lazy" onerror="this.remove()">` : `<span>${escapeHtml(fallbackLetter(game))}</span>`;
  const saved = state.favorites.includes(game.id);
  const history = state.playHistory[game.id];
  const played = Boolean(history);
  return `
    <article class="game-card ${played ? 'has-history' : ''}">
      <button class="card-open" type="button" data-game-id="${escapeHtml(game.id)}" aria-label="Play ${escapeHtml(game.title)}">
        <span class="game-art">
          ${poster}
          <span class="game-art-vignette"></span>
          <span class="card-icon">${icon}</span>
          <span class="game-hover"><span class="hover-kicker">${played ? 'PICK UP AGAIN' : 'A LITTLE ADVENTURE'}</span><strong>${escapeHtml(game.title)}</strong><span class="hover-cta">Play now <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"></path></svg></span></span>
          ${played ? '<span class="played-indicator" aria-label="Played before"><i></i></span>' : ''}
        </span>
        <span class="card-caption"><span class="card-title">${escapeHtml(game.title)}</span>${played ? '<span class="card-status">Continue</span>' : ''}</span>
      </button>
      <button class="card-save ${saved ? 'is-saved' : ''}" type="button" data-favorite-id="${escapeHtml(game.id)}" aria-label="${saved ? 'Remove from' : 'Add to'} favorites" title="${saved ? 'Saved' : 'Save game'}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"></path></svg>
      </button>
    </article>`;
}

function gameById(id) {
  return state.catalog.find((game) => game.id === id);
}

function nextGameCard(game) {
  const poster = game.poster ? `<img src="${escapeHtml(assetUrl(game, game.poster))}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<button class="next-game-card" type="button" data-game-id="${escapeHtml(game.id)}" aria-label="Play ${escapeHtml(game.title)}"><span class="next-game-art">${poster}<span class="next-game-shade"></span><span class="next-game-name">${escapeHtml(game.title)}</span><span class="next-game-play">Play <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 10 7-10 7V5Z" fill="currentColor" stroke="none"></path></svg></span></span></button>`;
}

function route() {
  const pieces = location.hash.replace(/^#\/?/, '').split('/');
  if (pieces[0] === 'play' && pieces[1]) return { view: 'play', id: pieces[1] };
  return { view: 'home' };
}

function routeToGame(id) {
  state.playStarted.delete(id);
  location.hash = `#/play/${encodeURIComponent(id)}`;
}

function currentResults() {
  let games = [...state.catalog];
  if (state.category !== 'All games') games = games.filter((game) => game.category === state.category);
  const query = state.query.trim().toLowerCase();
  if (query) games = games.filter((game) => `${game.title} ${game.folder} ${game.category}`.toLowerCase().includes(query));
  if (state.sort === 'A–Z') games.sort((a, b) => a.title.localeCompare(b.title));
  else if (state.sort === 'Favorites') games = games.filter((game) => state.favorites.includes(game.id));
  else if (state.sort === 'Recently played') {
    const recentRank = new Map(state.recent.map((id, index) => [id, index]));
    games = games.filter((game) => recentRank.has(game.id)).sort((a, b) => recentRank.get(a.id) - recentRank.get(b.id));
  }
  else games.sort((a, b) => a.featuredRank - b.featuredRank || a.title.localeCompare(b.title));
  return games;
}

function categories() {
  const counts = new Map();
  state.catalog.forEach((game) => counts.set(game.category, (counts.get(game.category) || 0) + 1));
  const order = ['Action', 'Adventure', 'Arcade', 'Casual', 'Puzzle', 'Sports'];
  return ['All games', ...order.filter((category) => counts.has(category)).map((category) => category)];
}

function archiveStatusNotice() {
  if (!state.status || state.status.ready) return '';
  return `<div class="archive-note"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4"></path><path d="M12 17h.01"></path><path d="M10.3 3.9 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3l-7.6-13.1a2 2 0 0 0-3.4 0Z"></path></svg><span><strong>Game files are unavailable.</strong> ${escapeHtml(state.status.message || 'Check the configured ZIP path, then refresh the games.')}</span></div>`;
}

function renderHome() {
  const all = currentResults();
  const visible = all.slice(0, state.visibleCount);
  const ranked = [...state.catalog].sort((a, b) => a.featuredRank - b.featuredRank || a.title.localeCompare(b.title));
  const topPicks = ranked.slice(0, 7);
  const featured = ranked.slice(0, 10);
  const curated = !state.query && state.category === 'All games';
  const genreCategories = categories().slice(1);
  const categoryMarkup = categories().map((category) => {
    const count = category === 'All games' ? state.catalog.length : state.catalog.filter((game) => game.category === category).length;
    return `<button class="filter-chip ${state.category === category ? 'is-active' : ''}" type="button" data-category="${escapeHtml(category)}">${lineIcon(categoryIcon(category))}<span>${escapeHtml(category)}</span><small>${count}</small></button>`;
  }).join('');
  const categoryRail = genreCategories.length ? `<nav class="category-rail" aria-label="Browse game categories">${genreCategories.map((category, index) => {
    const count = state.catalog.filter((game) => game.category === category).length;
    return `<button class="category-tile category-tile-${index % 6}" type="button" data-category="${escapeHtml(category)}"><span class="category-tile-icon">${lineIcon(categoryIcon(category))}</span><span class="category-tile-copy"><strong>${escapeHtml(category)}</strong><small>${count} games</small></span>${lineIcon('arrow')}</button>`;
  }).join('')}</nav>` : '';
  const topGamesSection = curated && topPicks.length ? `<section class="section-block top-games-section"><div class="section-titlebar"><div class="section-titlegroup"><h2>Top games today</h2><span class="section-count">Jump into something good</span></div><span class="section-label">${lineIcon('sparkle')} STAFF PICKS</span></div><div class="games-grid top-games-grid">${topPicks.map(gameCard).join('')}</div></section>` : '';
  const favoriteSection = !state.query && state.category === 'All games' && state.favorites.length
    ? `<section class="section-block"><div class="section-titlebar"><div class="section-titlegroup"><h2>Saved for later</h2><span class="section-count">Your little shortlist</span></div></div><div class="games-grid shelf-grid">${state.catalog.filter((game) => state.favorites.includes(game.id)).slice(0, 12).map(gameCard).join('')}</div></section>` : '';
  const continueGames = state.recent.map(gameById).filter(Boolean).slice(0, 4);
  const continueSection = !state.query && state.category === 'All games' && continueGames.length
    ? `<section class="section-block continue-block"><div class="section-titlebar"><div class="section-titlegroup"><h2>Continue playing</h2><span class="section-count">Pick up where you left off</span></div><span class="continue-mark"><i></i> Saved on this device</span></div><div class="games-grid shelf-grid">${continueGames.map(gameCard).join('')}</div></section>` : '';
  const featuredSection = curated && featured.length
    ? `<section class="section-block"><div class="section-titlebar"><div class="section-titlegroup"><h2>Featured games</h2><span class="section-count">Big worlds, good stories, quick rounds</span></div><button class="text-link" type="button" data-clear-filters>See all ${lineIcon('arrow')}</button></div><div class="games-grid shelf-grid">${featured.map(gameCard).join('')}</div></section>` : '';
  const genreShelves = curated ? genreCategories.map((category) => {
    const games = ranked.filter((game) => game.category === category).slice(0, 12);
    if (!games.length) return '';
    return `<section class="section-block genre-section"><div class="section-titlebar"><div class="section-titlegroup"><h2>${escapeHtml(category)} games</h2><span class="section-count">${state.catalog.filter((game) => game.category === category).length} to explore</span></div><button class="text-link" type="button" data-category="${escapeHtml(category)}">Explore ${escapeHtml(category.toLowerCase())} ${lineIcon('arrow')}</button></div><div class="games-grid shelf-grid">${games.map(gameCard).join('')}</div></section>`;
  }).join('') : '';
  const noResults = `<div class="empty-state"><div><strong>No games found</strong><p>Try a different title or clear the category filter.</p></div></div>`;
  app.innerHTML = `
    ${categoryRail}
    ${topGamesSection}
    ${continueSection}
    ${favoriteSection}
    ${featuredSection}
    ${genreShelves}
    <section class="section-block" id="library">
      <div class="welcome-row">
        <div><h2 class="section-heading">Find your next game</h2><p class="section-subheading">Good games, one cozy corner. ${state.catalog.length} ready to explore.</p></div>
        <button class="text-link" type="button" data-clear-filters>View everything <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path></svg></button>
      </div>
      <div class="filter-row" aria-label="Game categories">${categoryMarkup}</div>
      <div class="section-titlebar">
        <div class="section-titlegroup"><h2>${state.query ? `Results for “${escapeHtml(state.query)}”` : state.category === 'All games' ? 'All games' : `${escapeHtml(state.category)} games`}</h2><span class="section-count">${all.length} ${all.length === 1 ? 'game' : 'games'}</span></div>
        <select class="sort-select" id="sort-games" aria-label="Sort games"><option ${state.sort === 'Featured' ? 'selected' : ''}>Featured</option><option ${state.sort === 'A–Z' ? 'selected' : ''}>A–Z</option><option ${state.sort === 'Favorites' ? 'selected' : ''}>Favorites</option><option ${state.sort === 'Recently played' ? 'selected' : ''}>Recently played</option></select>
      </div>
      ${visible.length ? `<div class="games-grid">${visible.map(gameCard).join('')}</div>` : noResults}
      ${all.length > visible.length ? `<div class="load-more-wrap"><button class="load-more" type="button" data-load-more>Load more games <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="m6 13 6 6 6-6"></path></svg></button></div>` : ''}
    </section>
    ${archiveStatusNotice()}
    <footer class="site-footer"><span><strong>Froggy</strong> · A tiny home for big adventures.</span><span>Made for curious fingers and one-more-round nights.</span></footer>`;
}

function lastPlayedLabel(timestamp) {
  if (!timestamp) return 'First visit';
  const days = Math.floor((Date.now() - timestamp) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderPlayer(game) {
  const art = game.poster ? `<img src="${escapeHtml(assetUrl(game, game.poster))}" alt="" onerror="this.remove()">` : '';
  const icon = game.icon ? `<img src="${escapeHtml(assetUrl(game, game.icon))}" alt="" onerror="this.remove()">` : `<span>${escapeHtml(fallbackLetter(game))}</span>`;
  const iconSmall = game.icon ? `<img src="${escapeHtml(assetUrl(game, game.icon))}" alt="" onerror="this.remove()">` : `<span>${escapeHtml(fallbackLetter(game))}</span>`;
  const started = state.playStarted.has(game.id);
  const history = state.playHistory[game.id];
  const favorite = state.favorites.includes(game.id);
  const ranked = state.catalog.filter((candidate) => candidate.id !== game.id).sort((a, b) => a.featuredRank - b.featuredRank || a.title.localeCompare(b.title));
  const similar = ranked.filter((candidate) => candidate.category === game.category);
  const recommendations = [...similar, ...ranked.filter((candidate) => candidate.category !== game.category)].slice(0, 10);
  const article = /^[aeiou]/i.test(game.category) ? 'An' : 'A';
  const gameUrl = `${gameOrigin}/${[game.folder, ...game.launchFile.split('/')].map((part) => encodeURIComponent(part)).join('/')}`;
  const frameContents = started
    ? `<div class="fullscreen-backdrop" aria-hidden="true">${art}</div><iframe src="${escapeHtml(gameUrl)}" title="${escapeHtml(game.title)}" allow="autoplay; fullscreen; gamepad; clipboard-read; clipboard-write" allowfullscreen sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms allow-downloads allow-presentation allow-modals"></iframe>`
    : `<div class="frame-blur">${art}</div><div class="frame-shade"></div><div class="launch-card"><span class="launch-eyebrow"><i></i> ${escapeHtml(game.category)} · FROGGY LIBRARY</span><span class="launch-icon">${icon}</span><h1>${escapeHtml(game.title)}</h1><p>Your next round is right here.</p><button class="primary-button launch-button" type="button" data-start-game="${escapeHtml(game.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 10 7-10 7V5Z" fill="currentColor" stroke="none"></path></svg> Play now</button><span class="launch-caption"><span class="launch-caption-dot"></span> Quick launch · No extra setup</span></div>`;
  app.innerHTML = `
    <section class="player-wrap">
      <div class="player-topline"><a class="back-link" href="#/"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path></svg> Back to games</a><span class="player-hint"><i></i> A little room to play</span></div>
      <div class="player-layout">
        <div class="player-main-column">
          <div class="game-frame" id="game-frame">${frameContents}</div>
          <div class="player-controls">
            <div class="player-game-info"><span class="player-mini-icon">${iconSmall}</span><div class="player-game-copy"><strong>${escapeHtml(game.title)}</strong><span>${escapeHtml(game.category)} <b>·</b> ${started ? 'In your pond' : 'Ready when you are'}</span></div></div>
            <div class="player-control-actions">
              <button class="small-action player-save-action ${favorite ? 'is-saved' : ''}" type="button" data-favorite-id="${escapeHtml(game.id)}" title="${favorite ? 'Remove from saved games' : 'Save game'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"></path></svg> ${favorite ? 'Saved' : 'Save'}</button>
              <button class="small-action" type="button" data-restart-game="${escapeHtml(game.id)}" title="Restart game"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"></path><path d="M4.7 9A7.5 7.5 0 0 1 18 6l2 2M4 17v-5h5"></path><path d="M19.3 15A7.5 7.5 0 0 1 6 18l-2-2"></path></svg> Restart</button>
              <button class="small-action quick-exit-action" type="button" data-quick-exit title="Quick exit · ${escapeHtml(state.settings.panicKey)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"></path><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"></path></svg> Exit</button>
              <button class="small-action fullscreen-action" type="button" data-fullscreen title="Full screen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"></path></svg> Full screen</button>
            </div>
          </div>
          <section class="player-detail-card player-info-panel">
            <nav class="player-breadcrumb" aria-label="Breadcrumb"><a href="#/">Games</a><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg><span>${escapeHtml(game.category)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg><strong>${escapeHtml(game.title)}</strong></nav>
            <div class="player-info-heading"><div><span class="detail-kicker">GAME DETAILS</span><h2>${escapeHtml(game.title)}</h2></div><button class="share-game" type="button" data-share-game="${escapeHtml(game.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"></path></svg> Share</button></div>
            <div class="detail-pills"><span>${escapeHtml(game.category)}</span><span>Browser game</span></div>
            <p>${article} ${escapeHtml(game.category.toLowerCase())} game from your Froggy library. Launch it above, then use the controls to save your spot, restart, or expand the play area.</p>
            <div class="player-stat-row"><div><span>Category</span><strong>${escapeHtml(game.category)}</strong></div><div><span>Your sessions</span><strong>${history ? history.plays : 'New'}</strong></div><div><span>Last played</span><strong>${history ? lastPlayedLabel(history.lastPlayed) : 'First visit'}</strong></div><div><span>Game files</span><strong>${Number.isFinite(Number(game.fileCount)) ? escapeHtml(game.fileCount) : '—'}</strong></div></div>
          </section>
        </div>
        <aside class="play-next-panel" aria-label="Recommended games">
          <div class="play-next-heading"><div><span class="detail-kicker">KEEP THE FUN GOING</span><h2>Play next</h2></div><span class="play-next-count">${recommendations.length}</span></div>
          <div class="play-next-grid">${recommendations.map(nextGameCard).join('')}</div>
          <a href="#/" class="play-next-link">Browse all games <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path></svg></a>
        </aside>
      </div>
    </section>`;
}

async function shareGame(id) {
  const game = gameById(id);
  if (!game) return;
  const shareData = { title: `${game.title} · Froggy`, text: `Play ${game.title} on Froggy`, url: window.location.href };
  try {
    if (navigator.share) await navigator.share(shareData);
    else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareData.url);
      showToast('Game link copied to clipboard');
    } else showToast('Sharing is not available in this browser.', 'info');
  } catch (error) {
    if (error?.name !== 'AbortError') showToast('Could not share this game right now.', 'info');
  }
}

function render() {
  applySettings();
  const current = route();
  if (current.view === 'play') {
    const game = gameById(decodeURIComponent(current.id));
    if (game) { renderPlayer(game); return; }
  }
  renderHome();
}

function showToast(message, kind = 'success') {
  const icon = kind === 'info'
    ? '<path d="M12 16v-4m0-4h.01"></path><circle cx="12" cy="12" r="9"></circle>'
    : '<path d="m5 12 4 4L19 6"></path>';
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${escapeHtml(message)}</span>`;
  toastRegion.append(toast);
  setTimeout(() => toast.remove(), 2800);
}

function saveRecent(id) {
  state.recent = [id, ...state.recent.filter((item) => item !== id)].slice(0, 12);
  const previous = state.playHistory[id] || { plays: 0 };
  state.playHistory[id] = { plays: previous.plays + 1, lastPlayed: Date.now() };
  persist('froggy.recent', state.recent);
  persist('froggy.playHistory', state.playHistory);
}

async function refreshCatalog() {
  refreshButton.classList.add('is-refreshing');
  refreshButton.disabled = true;
  try {
    const [catalogResponse, statusResponse] = await Promise.all([
      fetch('/api/catalog', { cache: 'no-store' }),
      fetch('/api/status', { cache: 'no-store' }),
    ]);
    if (!catalogResponse.ok || !statusResponse.ok) throw new Error('Could not reload the game list.');
    const catalogData = await catalogResponse.json();
    state.status = await statusResponse.json();
    state.catalog = catalogData.games || [];
    state.visibleCount = PAGE_SIZE;
    render();
    showToast(`Game list refreshed · ${state.catalog.length} ready`);
  } catch (error) {
    showToast(error.message || 'Could not refresh the game list.', 'info');
  } finally {
    refreshButton.classList.remove('is-refreshing');
    refreshButton.disabled = false;
  }
}

async function boot() {
  applySettings();
  try {
    const [catalogResponse, statusResponse] = await Promise.all([fetch('/api/catalog'), fetch('/api/status')]);
    if (!catalogResponse.ok) throw new Error('The game catalog could not be opened.');
    const catalogData = await catalogResponse.json();
    state.catalog = catalogData.games || [];
    state.status = statusResponse.ok ? await statusResponse.json() : null;
    render();
  } catch (error) {
    app.innerHTML = `<div class="empty-state"><div><strong>Your game library could not load</strong><p>${escapeHtml(error.message)} Restart Froggy and try again.</p></div></div>`;
  }
}

searchInput.addEventListener('input', () => {
  state.query = searchInput.value;
  state.visibleCount = PAGE_SIZE;
  if (route().view === 'play') location.hash = '#/';
  render();
});

searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    document.getElementById('library')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    searchInput.focus();
  }
  if (event.key === state.settings.panicKey) quickExit();
});

function quickExit() {
  const allowed = new Set(['https://www.khanacademy.org/', 'https://clever.com/', 'https://classroom.google.com/', 'https://www.wikipedia.org/']);
  const destination = allowed.has(state.settings.quickExit) ? state.settings.quickExit : DEFAULT_SETTINGS.quickExit;
  window.location.assign(destination);
}

function notifyFullscreenLayout(active) {
  const frame = document.querySelector('#game-frame iframe');
  try { frame?.contentWindow?.postMessage({ type: 'froggy-fullscreen-layout', active }, gameOrigin); }
  catch { /* A game may be navigating while fullscreen changes. */ }
}

window.addEventListener('message', (event) => {
  const frame = document.querySelector('#game-frame iframe');
  if (!frame || event.origin !== gameOrigin || event.source !== frame.contentWindow) return;
  if (event.data?.type === 'froggy-game-ready') {
    if (document.fullscreenElement?.id === 'game-frame') notifyFullscreenLayout(true);
    return;
  }
  if (event.data?.type === 'froggy-shortcut' && event.data.key === state.settings.panicKey) quickExit();
});

document.addEventListener('fullscreenchange', () => {
  const active = document.fullscreenElement?.id === 'game-frame';
  notifyFullscreenLayout(active);
});

refreshButton.addEventListener('click', refreshCatalog);
window.addEventListener('hashchange', render);

document.addEventListener('click', (event) => {
  const category = event.target.closest('[data-category]');
  if (category) {
    state.category = category.dataset.category;
    state.visibleCount = PAGE_SIZE;
    render();
    return;
  }
  const gameOpen = event.target.closest('[data-game-id]');
  if (gameOpen) {
    const game = gameById(gameOpen.dataset.gameId);
    if (game) routeToGame(game.id);
    return;
  }
  const shareGameButton = event.target.closest('[data-share-game]');
  if (shareGameButton) {
    shareGame(shareGameButton.dataset.shareGame);
    return;
  }
  const favorite = event.target.closest('[data-favorite-id]');
  if (favorite) {
    const id = favorite.dataset.favoriteId;
    state.favorites = state.favorites.includes(id) ? state.favorites.filter((item) => item !== id) : [...state.favorites, id];
    persist('froggy.favorites', state.favorites);
    if (route().view === 'play') {
      const saved = state.favorites.includes(id);
      favorite.classList.toggle('is-saved', saved);
      favorite.title = saved ? 'Remove from saved games' : 'Save game';
      favorite.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"></path></svg> ${saved ? 'Saved' : 'Save'}`;
      return;
    }
    render();
    return;
  }
  if (event.target.closest('[data-load-more]')) {
    state.visibleCount += PAGE_SIZE;
    render();
    document.getElementById('library')?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    return;
  }
  if (event.target.closest('[data-clear-filters]')) {
    state.query = '';
    state.category = 'All games';
    state.sort = 'Featured';
    state.visibleCount = PAGE_SIZE;
    searchInput.value = '';
    render();
    return;
  }
  if (event.target.closest('[data-show-library]')) {
    document.getElementById('library')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const start = event.target.closest('[data-start-game]');
  if (start) {
    const id = start.dataset.startGame;
    state.playStarted.add(id);
    saveRecent(id);
    render();
    return;
  }
  const restart = event.target.closest('[data-restart-game]');
  if (restart) {
    state.playStarted.delete(restart.dataset.restartGame);
    render();
    return;
  }
  if (event.target.closest('[data-fullscreen]')) {
    const frame = document.getElementById('game-frame');
    if (frame?.requestFullscreen) frame.requestFullscreen().catch(() => showToast('Full screen is not available here.', 'info'));
    return;
  }
  if (event.target.closest('[data-quick-exit]')) {
    quickExit();
    return;
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'sort-games') {
    state.sort = event.target.value;
    state.visibleCount = PAGE_SIZE;
    render();
  }
});

boot();
