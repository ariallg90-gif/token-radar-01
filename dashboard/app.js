// Launch Radar page logic: filter, sort and detail view over window.RADAR.
//
// The data file sets window.RADAR = { asOf, floorUsd, rows, watchlistCount }.
// Rows carry slug, name, rank, implied_value_usd, farm_steps, category,
// chains, tvl_usd, change_7d, age_days, has_token, on_watchlist, thesis.

'use strict';

const state = { q: '', cat: '', status: '', watch: false, sort: 'value', dir: -1 };
const rowsEl = document.getElementById('rows');
const countEl = document.getElementById('count');
const emptyEl = document.getElementById('empty');
const metaEl = document.getElementById('meta');
const drawerEl = document.getElementById('drawer');
const detailEl = document.getElementById('detail');
const data = window.RADAR;

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

function money(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n;
}

function changeCell(change) {
  if (change === null || change === undefined) return '<span class="muted">—</span>';
  const cls = change >= 0 ? 'up' : 'down';
  const sign = change >= 0 ? '+' : '';
  return '<span class="' + cls + '">' + sign + change.toFixed(1) + '%</span>';
}

function ageCell(days) {
  if (days === null || days === undefined) return '<span class="muted">—</span>';
  if (days < 365) return days + 'd';
  return (days / 365).toFixed(1) + 'y';
}

function naturalDir(key) {
  return key === 'rank' || key === 'name' || key === 'category' ? 1 : -1;
}

function sortRows(list) {
  const key = state.sort;
  const dir = state.dir;
  const by = {
    rank: (r) => r.rank,
    name: (r) => r.name.toLowerCase(),
    category: (r) => (r.category || 'zzzz').toLowerCase(),
    chains: (r) => r.chains.length,
    tvl: (r) => r.tvl_usd,
    chg: (r) => (r.change_7d === null ? -9999 : r.change_7d),
    age: (r) => (r.age_days === null ? -1 : r.age_days),
    value: (r) => r.implied_value_usd,
  }[key];
  return list.slice().sort((a, b) => {
    const va = by(a);
    const vb = by(b);
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return a.slug < b.slug ? -1 : 1;
  });
}

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  const kept = data.rows.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q) && !r.slug.includes(q)) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.status === 'pre' && r.has_token) return false;
    if (state.status === 'live' && !r.has_token) return false;
    if (state.watch && !r.on_watchlist) return false;
    return true;
  });
  return sortRows(kept);
}

function paint() {
  const list = visibleRows();
  countEl.textContent = list.length + ' of ' + data.rows.length + ' rows';
  emptyEl.hidden = list.length > 0;
  rowsEl.innerHTML = list
    .map((r) => {
      const status = r.has_token
        ? '<span class="chip live">token live</span>'
        : '<span class="chip pre">pre-token</span>';
      const watch = r.on_watchlist ? '<span class="chip watch">watchlist</span>' : '';
      const chains = r.chains.length > 2
        ? esc(r.chains[0]) + ' +' + (r.chains.length - 1)
        : r.chains.map(esc).join(', ');
      return (
        '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span><br><span class="pslug">' + esc(r.slug) + '</span></td>' +
        '<td>' + (r.category ? esc(r.category) : '<span class="muted">—</span>') + '</td>' +
        '<td>' + chains + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + changeCell(r.change_7d) + '</td>' +
        '<td class="num">' + ageCell(r.age_days) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
        '<td>' + status + watch + '</td>' +
        '</tr>'
      );
    })
    .join('');
  document.querySelectorAll('.board th[data-k]').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.k === state.sort);
  });
}

function openDetail(slug) {
  const r = data.rows.find((row) => row.slug === slug);
  if (!r) return;
  document.querySelectorAll('.board tbody tr').forEach((tr) => {
    tr.classList.toggle('picked', tr.dataset.slug === slug);
  });
  const status = r.has_token ? 'Token already live' : 'Pre-token — no token recorded';
  const steps = r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('');
  detailEl.innerHTML =
    '<div class="detail">' +
    '<h2>' + esc(r.name) + '</h2>' +
    '<p class="sub">' + esc(r.slug) + ' · rank #' + r.rank +
    (r.on_watchlist ? ' · on the watchlist' : '') + '</p>' +
    '<div class="stats">' +
    '<div class="stat"><div class="k">Implied value</div><div class="v">' + money(r.implied_value_usd) + '</div></div>' +
    '<div class="stat"><div class="k">TVL</div><div class="v">' + money(r.tvl_usd) + '</div></div>' +
    '<div class="stat"><div class="k">7-day change</div><div class="v">' + (r.change_7d === null ? '—' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</div></div>' +
    '<div class="stat"><div class="k">Age</div><div class="v">' + (r.age_days === null ? '—' : r.age_days < 365 ? r.age_days + ' days' : (r.age_days / 365).toFixed(1) + ' years') + '</div></div>' +
    '<div class="stat"><div class="k">Category</div><div class="v">' + (r.category ? esc(r.category) : '—') + '</div></div>' +
    '<div class="stat"><div class="k">Chains</div><div class="v">' + r.chains.length + ' · ' + esc(r.chains[0] || '') + '</div></div>' +
    '</div>' +
    '<p class="thesis">' + esc(r.thesis) + '</p>' +
    '<p class="sub">' + esc(status) + '</p>' +
    '<h3>How to farm it</h3>' +
    '<ol class="steps">' + steps + '</ol>' +
    '</div>';
  drawerEl.hidden = false;
  if (location.hash !== '#' + slug) history.replaceState(null, '', '#' + slug);
}

function closeDetail() {
  drawerEl.hidden = true;
  document.querySelectorAll('.board tbody tr.picked').forEach((tr) => tr.classList.remove('picked'));
  history.replaceState(null, '', location.pathname + location.search);
}

function boot() {
  const cats = [...new Set(data.rows.map((r) => r.category).filter(Boolean))].sort();
  const catEl = document.getElementById('cat');
  cats.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    catEl.appendChild(opt);
  });
  const pre = data.rows.filter((r) => !r.has_token).length;
  metaEl.innerHTML =
    'Snapshot ' + esc(data.asOf) + ' · ' + data.rows.length + ' ranked · ' +
    pre + ' pre-token · watchlist floor ' + money(data.floorUsd);

  document.getElementById('q').addEventListener('input', (e) => {
    state.q = e.target.value;
    paint();
  });
  catEl.addEventListener('change', (e) => { state.cat = e.target.value; paint(); });
  document.getElementById('status').addEventListener('change', (e) => {
    state.status = e.target.value;
    paint();
  });
  document.getElementById('watch').addEventListener('change', (e) => {
    state.watch = e.target.checked;
    paint();
  });
  document.getElementById('sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    state.dir = naturalDir(state.sort);
    paint();
  });
  document.querySelectorAll('.board th[data-k]').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.dataset.k;
      if (state.sort === k) {
        state.dir = -state.dir;
      } else {
        state.sort = k;
        state.dir = naturalDir(k);
      }
      paint();
    });
  });
  rowsEl.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.dataset.slug);
  });
  document.getElementById('close').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetail();
  });

  paint();
  if (location.hash.length > 1) openDetail(location.hash.slice(1));
}

boot();
