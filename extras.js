/* extras.js — Cloud-synced Pokédex, public profile + leaderboard, trade matching,
   friend code board and "install as an app".
   Needs the tables from supabase/setup.sql. Everything degrades quietly if a table is missing (a message explains what to run).
   Talks to Supabase through the client chat.js already created (window.PDX_SB) so there is one login for everything,
   and to the tracker through the small bridge app.js exposes (window.PDX). */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  json(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } }
};
const sb = () => window.PDX_SB || null;
const P = () => window.PDX || null;
let user = null;   // { id, username, is_admin } once chat.js reports a login

const TEAMS = { mystic: ['💙', 'Mystic', '#4f9dff'], valor: ['❤️', 'Valor', '#ff6b6b'], instinct: ['💛', 'Instinct', '#f4c96b'] };
const teamChip = t => TEAMS[t] ? `<span class="xteam" style="--tc:${TEAMS[t][2]}" title="${TEAMS[t][1]}">${TEAMS[t][0]}</span>` : '';
const tableMissing = e => !!e && (/42P01|PGRST205|does not exist|relation .* does not exist/i.test((e.code || '') + ' ' + (e.message || '')) && !/column/i.test(e.message || ''));
const SETUP_HINT = 'This feature’s database tables are not set up yet. Run supabase/setup.sql in the Supabase SQL Editor.';
const SKEL = (n = 8, cls = '') => `<div class="skelgrid ${cls}" aria-busy="true">${'<i class="skel"></i>'.repeat(n)}</div>`;
const debounce = (fn, ms) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const fmtNum = n => Number(n || 0).toLocaleString();
const ago = t => { const s = Math.max(0, (Date.now() - new Date(t)) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };

/* ---------- toast + modal ---------- */
let toastBox;
function toast(msg, ms = 4200) {
  if (!toastBox) { toastBox = document.createElement('div'); toastBox.id = 'xToast'; toastBox.setAttribute('role', 'status'); toastBox.setAttribute('aria-live', 'polite'); document.body.append(toastBox); }
  const t = document.createElement('div'); t.className = 'xtoastmsg'; t.textContent = msg; toastBox.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}
function modal(html, cls = '') {
  closeModal();
  const back = document.createElement('div'); back.className = 'xmodalback'; back.id = 'xModal';
  back.innerHTML = `<div class="xmodal ${cls}" role="dialog" aria-modal="true"><button class="xclose" type="button" aria-label="Close">✕</button>${html}</div>`;
  back.addEventListener('mousedown', e => { if (e.target === back) closeModal(); });
  back.querySelector('.xclose').onclick = closeModal;
  document.body.append(back); document.addEventListener('keydown', escClose);
  return back.querySelector('.xmodal');
}
const escClose = e => { if (e.key === 'Escape') closeModal(); };
function closeModal() { const m = $('#xModal'); if (m) m.remove(); document.removeEventListener('keydown', escClose); }
async function copyText(text, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { try { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.append(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch {} }
  if (btn) { const old = btn.dataset.label || btn.textContent; btn.dataset.label = old; btn.textContent = ok ? 'Copied ✓' : 'Copy failed'; setTimeout(() => { btn.textContent = old; }, 1600); }
  return ok;
}
function openChatPanel() {
  const chat = $('#chat'); if (!chat) return;
  if (matchMedia('(max-width:900px)').matches) { const b = $('#chatBubble'); if (b) b.click(); }
  else if (chat.classList.contains('min')) { const m = $('#chatMin'); if (m) m.click(); }
  const u = $('#cUser'); if (u && !$('#chatAuth').hidden) u.focus();
}
const loginCta = what => `<div class="xlogin"><b>Log in to ${esc(what)}</b><p class="muted">Use the chat panel — the same account works for chat, cloud sync, friend codes and your public profile.</p><button type="button" class="xbtn primary" data-act="openchat">Open log in</button></div>`;
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-act="openchat"]')) openChatPanel(); });

/* ---------- loading polish for every tab ----------
   Same idea as the Pokédex cards: a shimmering placeholder, then the real content fades in instead of popping in.
   1) switching to a tab fades that tab in   2) whenever a placeholder is swapped for real content, the content fades in */
(() => {
  const VIEWS = ['tradeView', 'adminView', 'communityView', 'codesView', 'badgesView', 'insightsView'];
  const play = el => { el.classList.remove('xfadein'); void el.offsetWidth; el.classList.add('xfadein'); el.addEventListener('animationend', () => el.classList.remove('xfadein'), { once: true }); };
  window.pdxFade = play;   // other scripts (Insights / Admin sub-tabs) use the same fade when you switch sub-tab
  let last = document.body.dataset.view;
  new MutationObserver(() => {
    const v = document.body.dataset.view; if (v === last) return; last = v;
    if (v === 'dex') return;   // the Pokédex grid has its own fade
    const el = VIEWS.map(id => document.getElementById(id)).find(x => x && getComputedStyle(x).display !== 'none'); if (el) play(el);
  }).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
  const isSkel = n => n.nodeType === 1 && (n.matches('.skelgrid, .skel') || !!n.querySelector('.skelgrid, .skel'));
  const main = document.querySelector('main');
  if (main) new MutationObserver(recs => {
    for (const r of recs) if ([...r.removedNodes].some(isSkel)) { if (r.target && r.target.closest && r.target.closest('#grid')) continue;   /* the Pokédex grid has its own fade; running play() on ~1,600 cards forced ~1,600 synchronous reflows (5s freeze) */
      r.addedNodes.forEach(n => { if (n.nodeType === 1 && !n.matches('.skelgrid, .skel')) play(n); }); }
  }).observe(main, { childList: true, subtree: true });
})();

/* =====================================================================================================
   1. CLOUD-SYNCED POKÉDEX
   ===================================================================================================== */
const cloud = { state: 'off', msg: '', ver: 0, off: false, busy: false, pushTimer: 0 };
const mkey = k => 'pdx.sync.' + k;
const meta = {
  get last() { return store.get(mkey('last.' + (user && user.id))) || ''; },
  set last(v) { store.set(mkey('last.' + (user && user.id)), v || ''); },
  get dirty() { return store.get(mkey('dirty')) === '1'; },
  set dirty(v) { store.set(mkey('dirty'), v ? '1' : '0'); },
  get owner() { return store.get(mkey('owner')) || ''; },
  set owner(v) { store.set(mkey('owner'), v || ''); }
};
function paintCloud() {
  const el = $('#cloudStat'); if (!el) return;
  const map = {
    off: ['☁ Sign in to sync', 'Log in to back up your Pokédex and use it on every device'],
    saving: ['☁ Saving…', 'Saving to your account'],
    ok: ['☁ Synced', 'Your Pokédex is saved to your account'],
    err: ['☁ Sync problem', cloud.msg || 'Could not sync']
  };
  const [t, tip] = map[cloud.state] || map.off;
  el.textContent = t; el.title = tip; el.dataset.state = cloud.state;
}
function setCloud(state, msg) { cloud.state = state; cloud.msg = msg || ''; paintCloud(); }
const hasLocal = () => { const p = P(); return !!p && (Object.keys(p.data || {}).length > 0 || p.trade.want.length > 0 || p.trade.offer.length > 0); };

function mergeVal(x, y) {
  if (x === undefined) return y; if (y === undefined) return x;
  if (typeof x === 'boolean' && typeof y === 'boolean') return x || y;       // anything checked on either device stays checked
  if (Array.isArray(x) && Array.isArray(y)) { const seen = new Set(), out = []; [...x, ...y].forEach(i => { const k = JSON.stringify(i); if (!seen.has(k)) { seen.add(k); out.push(i); } }); return out; }
  if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x) && !Array.isArray(y)) { const o = {}; new Set([...Object.keys(x), ...Object.keys(y)]).forEach(k => { o[k] = mergeVal(x[k], y[k]); }); return o; }
  return x;
}
function mergeTradeLists(a, b) {
  const out = { want: [], offer: [] };
  for (const k of ['want', 'offer']) {
    const seen = new Set();
    [...((a && a[k]) || []), ...((b && b[k]) || [])].forEach(it => { const key = [it.id, it.v, it.k || ''].join('|'); if (!seen.has(key)) { seen.add(key); out[k].push(it); } });
  }
  return out;
}

async function pullRow(row) {
  const p = P(); if (!p) return;
  p.setData(row.dex || {}); p.setTrade(row.trade || {});
  meta.last = row.updated_at; meta.dirty = false; meta.owner = user.id; setCloud('ok');
}
async function push() {
  if (!user || !sb() || !P() || cloud.off) return false;
  clearTimeout(cloud.pushTimer); const myVer = cloud.ver;
  setCloud('saving');
  const { data, error } = await sb().from('cloud_dex').upsert({ user_id: user.id, dex: P().data, trade: P().trade }, { onConflict: 'user_id' }).select('updated_at').single();
  if (error) {
    if (tableMissing(error)) { cloud.off = true; return void setCloud('err', SETUP_HINT); }
    return void setCloud('err', error.message);
  }
  meta.last = data.updated_at; meta.owner = user.id;
  if (cloud.ver === myVer) meta.dirty = false; else schedPush();
  setCloud('ok'); schedCard(); return true;
}
const schedPush = () => { clearTimeout(cloud.pushTimer); cloud.pushTimer = setTimeout(push, 2500); };

async function syncNow(initial) {
  if (!user || !sb() || !P() || cloud.busy || cloud.off) return;
  cloud.busy = true; setCloud('saving');
  try {
    const { data: row, error } = await sb().from('cloud_dex').select('dex,trade,updated_at').eq('user_id', user.id).maybeSingle();
    if (error) { if (tableMissing(error)) { cloud.off = true; return void setCloud('err', SETUP_HINT); } return void setCloud('err', error.message); }
    if (!row) { meta.dirty = hasLocal(); if (hasLocal()) await push(); else setCloud('ok'); return; }
    // different account used on this browser before: ask before mixing the two
    let replace = false;
    if (initial && meta.owner && meta.owner !== user.id && hasLocal()) {
      replace = confirm('This browser still has Pokédex data from a different account.\n\nOK = replace it with this account’s saved Pokédex.\nCancel = merge both together.');
    }
    const last = meta.last, cloudNewer = !last || new Date(row.updated_at) > new Date(last);
    const dirty = meta.dirty || (!last && hasLocal());
    if (replace) return void await pullRow(row);
    if (cloudNewer && dirty && hasLocal()) {            // changed in both places: keep everything from both
      const p = P();
      p.setData(mergeVal(p.data, row.dex || {})); p.setTrade(mergeTradeLists(p.trade, row.trade || {}));
      meta.dirty = true; await push(); if (initial) toast('Merged this browser’s Pokédex with your cloud save.');
    } else if (cloudNewer) { await pullRow(row); if (initial) toast('Loaded your Pokédex from the cloud.'); }
    else if (dirty) await push();
    else { meta.owner = user.id; setCloud('ok'); }
  } finally { cloud.busy = false; }
}
document.addEventListener('pdx:dex', () => { cloud.ver++; meta.dirty = true; if (user) { setCloud('saving'); schedPush(); } });
document.addEventListener('pdx:trade', () => { cloud.ver++; meta.dirty = true; if (user) { setCloud('saving'); schedPush(); } schedMatches(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && user && !meta.dirty) syncNow(false); });
setInterval(() => { if (user && !document.hidden && !meta.dirty) syncNow(false); }, 5 * 60e3);
window.addEventListener('online', () => { if (user && meta.dirty) schedPush(); });
$('#cloudStat') && ($('#cloudStat').onclick = () => { if (!user) openChatPanel(); else if (cloud.state === 'err') { cloud.off = false; syncNow(false); } else toast(cloud.state === 'ok' ? 'Your Pokédex is saved to your account.' : 'Saving…'); });

/* =====================================================================================================
   2. TRAINER CARD, PUBLIC PROFILE, LEADERBOARD
   ===================================================================================================== */
let myCard = null, board = { sort: 'pct', season: 'all', rows: null, at: 0, err: '' };
const sortCols = { pct: ['Completion', r => r.pct.toFixed(1) + '%'], shiny: ['Shiny', r => fmtNum(r.shiny)], special: ['Special', r => fmtNum(r.special)] };
async function loadMyCard() {
  if (!user || !sb()) return;
  const { data, error } = await sb().from('trainer_cards').select('*').eq('user_id', user.id).maybeSingle();
  if (error) { myCard = tableMissing(error) ? { _missing: true } : null; return; }
  myCard = data || null;
  /* profiles are always public: the first time someone logs in they get a public trainer card (leaderboard + profile page),
     and a card that was private before is switched to public. Trade lists stay private until the person chooses to share them. */
  if (!myCard) {
    const res = await saveCard({ is_public: true, show_trade: false, team: '', bio: '' });
    if (!res.error) { board.rows = null; schedCard(); }
  } else if (!myCard.is_public) {
    const res = await saveCard({ is_public: true }); if (!res.error) board.rows = null;
  }
}
const statPayload = () => { const p = P(), s = p.summary(); return { caught: s.caught, total: s.total, pct: Math.max(0, Math.min(100, +s.pct.toFixed(2))), shiny: s.shiny, special: s.special }; };
async function saveCard(fields) {
  if (!user || !sb()) return { error: { message: 'Log in first.' } };
  const row = { user_id: user.id, ...statPayload(), ...fields };
  if (!P().pokemon.length) { delete row.caught; delete row.total; delete row.pct; delete row.shiny; delete row.special; }   // Pokédex not loaded yet: don't publish zeros
  if (row.show_trade || (myCard && myCard.show_trade && row.show_trade === undefined)) row.trade = P().trade; else if (row.show_trade === false) row.trade = {};
  const res = await sb().from('trainer_cards').upsert(row, { onConflict: 'user_id' }).select('*').single();
  if (!res.error) myCard = res.data;
  return res;
}
const syncCard = async () => {
  if (!user || !myCard || myCard._missing || !P() || !P().pokemon.length) return;
  const patch = { ...statPayload() }; if (myCard.show_trade) patch.trade = P().trade;
  const { data } = await sb().from('trainer_cards').update(patch).eq('user_id', user.id).select('*').maybeSingle();
  if (data) myCard = data;
};
const schedCard = debounce(syncCard, 8000);

async function loadBoard(force) {
  if (!force && board.rows && Date.now() - board.at < 60000) return;
  if (!sb()) { board.err = 'The online features could not load (the Supabase library was blocked).'; board.rows = []; return; }
  const col = board.sort;
  const { data, error } = await sb().from('trainer_cards').select('user_id,username,bio,team,caught,total,pct,shiny,special,show_trade,updated_at,hide_from_leaderboard').eq('is_public', true).order(col, { ascending: false }).order('caught', { ascending: false }).limit(100);
  board.at = Date.now(); board.err = error ? (tableMissing(error) ? SETUP_HINT : error.message) : ''; board.rows = data || [];
}
function boardHtml() {
  if (board.err) return `<div class="empty small">${esc(board.err)}</div>`;
  if (!board.rows) return SKEL(8, 'rows');
  if (!board.rows.length) return '<div class="empty small">Nobody is on the leaderboard yet. Log in and your public trainer card is created automatically.</div>';
  const [, fmt] = sortCols[board.sort];
  let rows = board.rows;
  rows = rows.filter(r => !r.hide_from_leaderboard);
  if (board.season === 'month' || board.season === 'season') {
    const ms = board.season === 'month' ? 30 * 86400e3 : 90 * 86400e3;
    const cut = Date.now() - ms;
    rows = rows.filter(r => r.updated_at && new Date(r.updated_at).getTime() >= cut);
  }
  if (!rows.length) return '<div class="empty small">No trainers active in this window. Try All time, or check back after more people sync.</div>';
  return `<div class="xlb">${rows.map((r, i) => `<button type="button" class="xlbrow ${user && r.user_id === user.id ? 'me' : ''}" data-u="${esc(r.username)}">
    <span class="xrank r${i < 3 ? i + 1 : 0}">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span>
    <span class="xname">${esc(r.username)} ${teamChip(r.team)}</span>
    <span class="xbar"><i style="width:${Math.min(100, board.sort === 'pct' ? r.pct : (r.pct))}%"></i></span>
    <span class="xval">${fmt(r)}</span><span class="xsub">${fmtNum(r.caught)} / ${fmtNum(r.total)}</span></button>`).join('')}</div>`;
}
function cardForm() {
  if (!user) return loginCta('create your trainer card');
  if (myCard && myCard._missing) return `<div class="empty small">${esc(SETUP_HINT)}</div>`;
  const c = myCard || {}, s = P() ? P().summary() : { caught: 0, total: 3484, pct: 0, shiny: 0, special: 0 };
  const link = location.origin + '/u/' + encodeURIComponent((c.profile_slug || user.username));
  return `<div class="xcardstats"><div><small>Registered</small><b>${fmtNum(s.caught)} / ${fmtNum(s.total)}</b></div><div><small>Completion</small><b>${s.pct.toFixed(1)}%</b></div><div><small>Shiny</small><b>${fmtNum(s.shiny)}</b></div><div><small>Special</small><b>${fmtNum(s.special)}</b></div></div>
  <form id="cardForm" class="xform">
   <label class="xcheck"><input type="checkbox" name="show_trade" ${c.show_trade ? 'checked' : ''}> <span><b>Share my trade lists</b> — lets other trainers find matches with you</span></label>
   <div class="xrow" style="flex-wrap:wrap;gap:8px 14px">
     <label class="xcheck"><input type="checkbox" name="hide_shiny" ${c.hide_shiny ? 'checked' : ''}> <span>Hide shiny count</span></label>
     <label class="xcheck"><input type="checkbox" name="hide_pct" ${c.hide_pct ? 'checked' : ''}> <span>Hide completion %</span></label>
     <label class="xcheck"><input type="checkbox" name="hide_badges" ${c.hide_badges ? 'checked' : ''}> <span>Hide badges on profile</span></label>
     <label class="xcheck"><input type="checkbox" name="hide_from_leaderboard" ${c.hide_from_leaderboard ? 'checked' : ''}> <span>Hide from leaderboard</span></label>
   </div>
   <div class="xrow"><label>Team<select name="team"><option value="">—</option>${Object.entries(TEAMS).map(([k, v]) => `<option value="${k}" ${c.team === k ? 'selected' : ''}>${v[0]} ${v[1]}</option>`).join('')}</select></label>
   <label>Profile theme<select name="profile_theme"><option value="">Default</option><option value="indigo" ${c.profile_theme === 'indigo' ? 'selected' : ''}>Indigo</option><option value="rose" ${c.profile_theme === 'rose' ? 'selected' : ''}>Rose</option><option value="forest" ${c.profile_theme === 'forest' ? 'selected' : ''}>Forest</option><option value="sunset" ${c.profile_theme === 'sunset' ? 'selected' : ''}>Sunset</option><option value="midnight" ${c.profile_theme === 'midnight' ? 'selected' : ''}>Midnight</option></select></label>
   <label class="xgrow">Custom URL slug<input name="profile_slug" maxlength="40" pattern="[a-zA-Z0-9_-]*" placeholder="optional · letters, numbers, - _" value="${esc(c.profile_slug || '')}" title="Public link becomes /u/your-slug"></label></div>
   <label class="xgrow">About me<input name="bio" maxlength="160" placeholder="Region, goals, what you collect…" value="${esc(c.bio || '')}"></label>
   <div class="xactions"><button class="xbtn primary" type="submit">Save trainer card</button>${link ? `<button class="xbtn" type="button" id="copyProfile" data-link="${esc(link)}">Copy profile link</button>` : ''}<span id="cardMsg" class="muted"></span></div>
  </form>`;
}
/* ---- Community challenges ----
   Each metric is a ladder. Only the current tier is shown; completing it removes that card
   and reveals the next (e.g. Register 250 → Register 500). */
const CHALLENGE_CHAINS = {
  shiny: [
    { id: 'shiny10', title: 'Shiny Spark', desc: 'Register 10 shinies', target: 10, metric: 'shiny' },
    { id: 'shiny25', title: 'Shiny Hunter', desc: 'Register 25 shinies', target: 25, metric: 'shiny' },
    { id: 'shiny50', title: 'Shiny Starter', desc: 'Register 50 shinies', target: 50, metric: 'shiny' },
    { id: 'shiny100', title: 'Shiny Specialist', desc: 'Register 100 shinies', target: 100, metric: 'shiny' },
    { id: 'shiny250', title: 'Shiny Master', desc: 'Register 250 shinies', target: 250, metric: 'shiny' },
    { id: 'shiny500', title: 'Shiny Legend', desc: 'Register 500 shinies', target: 500, metric: 'shiny' }
  ],
  caught: [
    { id: 'caught100', title: 'First Century', desc: 'Register 100 species', target: 100, metric: 'caught' },
    { id: 'caught250', title: 'Quarter Dex', desc: 'Register 250 species', target: 250, metric: 'caught' },
    { id: 'caught500', title: 'Dex Dedication', desc: 'Register 500 species', target: 500, metric: 'caught' },
    { id: 'caught750', title: 'Dex Devotee', desc: 'Register 750 species', target: 750, metric: 'caught' },
    { id: 'caught1000', title: 'Living Dex', desc: 'Register 1000 species', target: 1000, metric: 'caught' }
  ],
  special: [
    { id: 'special50', title: 'Form Finder', desc: '50 special registrations', target: 50, metric: 'special' },
    { id: 'special100', title: 'Form Collector', desc: '100 special registrations', target: 100, metric: 'special' },
    { id: 'special250', title: 'Form Curator', desc: '250 special registrations', target: 250, metric: 'special' },
    { id: 'special500', title: 'Form Encyclopedia', desc: '500 special registrations', target: 500, metric: 'special' }
  ],
  pct: [
    { id: 'pct50', title: 'Halfway There', desc: 'Reach 50% Pokédex completion', target: 50, metric: 'pct' },
    { id: 'pct75', title: 'Three Quarters', desc: 'Reach 75% Pokédex completion', target: 75, metric: 'pct' },
    { id: 'pct90', title: 'Almost There', desc: 'Reach 90% Pokédex completion', target: 90, metric: 'pct' },
    { id: 'pct100', title: 'Dex Complete', desc: 'Reach 100% Pokédex completion', target: 100, metric: 'pct' }
  ]
};
const DEFAULT_CHALLENGES = Object.values(CHALLENGE_CHAINS).flat();
let serverChallenges = null;
function challengeProgress(ch) {
  const p = P(); if (!p) return 0;
  const s = p.summary ? p.summary() : {};
  if (ch.metric === 'shiny') return s.shiny || 0;
  if (ch.metric === 'special') return s.special || 0;
  if (ch.metric === 'pct') return Math.floor(s.pct || 0);
  if (ch.metric === 'caught') return s.caught || 0;
  return 0;
}
/** Per metric ladder: hide completed tiers; show the next incomplete one.
 *  Always uses CHALLENGE_CHAINS so progression works even when Supabase only has a few seed rows. */
function activeChallenges() {
  const out = [];
  for (const metric of Object.keys(CHALLENGE_CHAINS)) {
    const ladder = CHALLENGE_CHAINS[metric];
    let pick = null;
    for (const ch of ladder) {
      if (challengeProgress(ch) < (ch.target || 0)) { pick = { ...ch }; break; }
    }
    /* All tiers in this track complete → omit it (nothing left to chase) */
    if (pick) out.push(pick);
  }
  const order = { shiny: 0, caught: 1, special: 2, pct: 3 };
  out.sort((a, b) => (order[a.metric] ?? 9) - (order[b.metric] ?? 9) || (a.target || 0) - (b.target || 0));
  return out;
}
function challengesHtml() {
  const list = activeChallenges();
  return `<div class="panel"><div class="xhead"><div><b>🏁 Community challenges</b><div class="muted">Shared goals with progress bars. Finish one and the next tier in that track appears automatically.</div></div></div>
    <div class="chalList">${list.map(ch => {
      const cur = challengeProgress(ch);
      const pct = Math.min(100, Math.round(cur / (ch.target || 1) * 100));
      const done = cur >= ch.target;
      return `<div class="goalCard ${done ? 'done' : ''}"><div class="goalTop"><b>${esc(ch.title)}</b><span>${cur} / ${ch.target}</span></div>
        <div class="muted" style="font-size:12px;margin-bottom:6px">${esc(ch.desc || '')}</div>
        <div class="progress"><i style="width:${pct}%;${done ? 'background:#22c55e' : ''}"></i></div>
        ${done ? '<div style="margin-top:6px;font-size:12px;color:#86efac">✓ Complete</div>' : ''}</div>`;
    }).join('')}</div></div>`;
}
async function loadServerChallenges() {
  if (!sb() || serverChallenges) return;
  try {
    const { data, error } = await sb().from('challenges').select('id,title,description,target,metric,badge_id,active').eq('active', true).order('id');
    if (!error && data) serverChallenges = data.map(c => ({ id: c.id, title: c.title, desc: c.description, target: c.target, metric: c.metric, badge_id: c.badge_id }));
  } catch {}
}
async function checkChallengeBadges() {
  if (!user || !sb() || !P()) return;
  await loadServerChallenges();
  for (const ch of (serverChallenges || [])) {
    if (challengeProgress(ch) < ch.target || !ch.badge_id) continue;
    try {
      await sb().from('user_badges').upsert({ user_id: user.id, badge_id: ch.badge_id }, { onConflict: 'user_id,badge_id', ignoreDuplicates: true });
    } catch {}
  }
}

function renderCommunity() {
  const v = $('#communityView'); if (!v) return;
  loadServerChallenges().then(() => checkChallengeBadges());
  v.innerHTML = `<div class="panel"><div class="xhead"><div><b>🪪 My trainer card</b><div class="muted">Your stats update by themselves as you check Pokémon off. Turn on “Share my trade lists” (or use Publish on Trading) to appear on the Social trade board.</div></div></div>${cardForm()}</div>
  ${challengesHtml()}
  <div class="panel"><div class="xhead"><div><b>🏆 Leaderboard</b><div class="muted">Every trainer who has logged in appears here — profiles are always public. Click a name for their full social profile.</div></div>
   <div class="xseg" id="lbSort">${Object.entries(sortCols).map(([k, [n]]) => `<button type="button" data-sort="${k}" class="${board.sort === k ? 'on' : ''}">${n}</button>`).join('')}</div>
   <div class="xseg" id="lbSeason">${[['all','All time'],['month','This month'],['season','90 days']].map(([k,n]) => `<button type="button" data-season="${k}" class="${board.season === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
   <div id="lbBody">${boardHtml()}</div></div>`;
  if (!board.rows || Date.now() - board.at > 60000) loadBoard(true).then(() => { const b = $('#lbBody'); if (b && document.body.dataset.view === 'community') b.innerHTML = boardHtml(); });
}
$('#communityView') && $('#communityView').addEventListener('click', async e => {
  const sortB = e.target.closest('[data-sort]'); if (sortB) { board.sort = sortB.dataset.sort; board.rows = null; renderCommunity(); return; }
  const seaB = e.target.closest('[data-season]'); if (seaB) { board.season = seaB.dataset.season; board.rows = null; renderCommunity(); return; }
  const row = e.target.closest('.xlbrow'); if (row) return void openProfile(row.dataset.u);
  if (e.target.id === 'copyProfile') copyText(e.target.dataset.link, e.target);
});
$('#communityView') && $('#communityView').addEventListener('submit', async e => {
  if (e.target.id !== 'cardForm') return; e.preventDefault();
  const f = e.target, msg = $('#cardMsg'), btn = $('button[type=submit]', f); btn.disabled = true; msg.textContent = 'Saving…';
  const slug = (f.profile_slug && f.profile_slug.value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  const res = await saveCard({
    is_public: true,
    show_trade: f.show_trade.checked,
    team: f.team.value,
    bio: f.bio.value.trim().slice(0, 160),
    profile_theme: (f.profile_theme && f.profile_theme.value) || '',
    profile_slug: slug,
    hide_shiny: !!(f.hide_shiny && f.hide_shiny.checked),
    hide_pct: !!(f.hide_pct && f.hide_pct.checked),
    hide_badges: !!(f.hide_badges && f.hide_badges.checked),
    hide_from_leaderboard: !!(f.hide_from_leaderboard && f.hide_from_leaderboard.checked)
  });
  btn.disabled = false;
  if (res.error) { msg.textContent = tableMissing(res.error) ? SETUP_HINT : res.error.message; return; }
  board.rows = null; toast('Trainer card saved.'); renderCommunity();
  const sum = P() && P().summary ? P().summary() : {};
  postActivity('card', 'Updated their trainer card', `${sum.caught || 0} registered · ${Number(sum.pct || 0).toFixed(1)}%`, '/u/' + encodeURIComponent(user.username));
});

async function openProfile(name, opts = {}) {
  if (!name) return;
  name = String(name).trim();
  if (!name) return;
  if (socialState._opening === name) return;
  socialState._opening = name;
  try {
  if (document.body.dataset.view !== 'social' && P() && P().setView) P().setView('social');
  const host = $('#socialView');
  if (!host) { socialState._opening = null; return; }
  socialState.viewing = name;
  host.innerHTML = `<div class="panel"><div class="empty small"><i class="spin"></i> Loading @${esc(name)}…</div></div>`;

  if (!sb()) {
    host.innerHTML = `<div class="panel"><div class="empty small">Online features unavailable.</div>
      <button class="xbtn" type="button" id="profBack">← Back to Social</button></div>`;
    const b = $('#profBack'); if (b) b.onclick = () => { socialState.viewing = null; socialState._opening = null; renderSocial(); };
    return;
  }

  let c = null, error = null;
  {
    // Prefer custom slug (#59), fall back to username
    let r = await sb().from('trainer_cards').select('*').ilike('profile_slug', name).eq('is_public', true).limit(1).maybeSingle();
    if (r.error && /profile_slug|column/i.test(r.error.message || '')) r = { data: null, error: null }; // column not migrated yet
    if (!r.data) r = await sb().from('trainer_cards').select('*').ilike('username', name).eq('is_public', true).limit(1).maybeSingle();
    c = r.data; error = r.error;
  }
  if (socialState.viewing !== name) return;
  if (error || !c) {
    host.innerHTML = `<div class="panel"><div class="empty small">${esc(error ? error.message : 'That profile is private or does not exist.')}</div>
      <button class="xbtn" type="button" id="profBack">← Back to Social</button></div>`;
    const b = $('#profBack'); if (b) b.onclick = () => { socialState.viewing = null; socialState._opening = null; renderSocial(); };
    return;
  }

  let code = null, prof = null, clanRow = null, badgeRows = [];
  const tasks = [
    user ? sb().from('friend_codes').select('code,trainer_name').eq('user_id', c.user_id).maybeSingle() : Promise.resolve({ data: null }),
    sb().from('profiles').select('id,username,is_admin,banned,ban_reason,clan,name_color').eq('id', c.user_id).maybeSingle(),
    sb().from('user_badges').select('awarded_at,badges(id,name,image_url,emoji,color,sort)').eq('user_id', c.user_id).order('awarded_at')
  ];
  const [codeRes, profRes, badgeRes] = await Promise.all(tasks);
  code = codeRes.data || null;
  prof = profRes.data || null;
  badgeRows = (!badgeRes.error && badgeRes.data) ? badgeRes.data.filter(r => r.badges).sort((a, b) => (a.badges.sort || 0) - (b.badges.sort || 0)) : [];
  if (prof && prof.clan) {
    try {
      const cr = await sb().from('clans').select('tag,color').eq('tag', prof.clan).maybeSingle();
      clanRow = cr.data || { tag: prof.clan, color: '#f4c96b' };
    } catch { clanRow = { tag: prof.clan, color: '#f4c96b' }; }
  }

  const p = P();
  const rawTrade = p && p.trade ? p.trade : { want: [], offer: [] };
  const mine = { want: Array.isArray(rawTrade.want) ? rawTrade.want : [], offer: Array.isArray(rawTrade.offer) ? rawTrade.offer : [] };
  const theirs = cleanTrade(c.trade);
  const gives = c.show_trade && p && p.tMatch ? theirs.offer.filter(x => p.tMatch(mine.want, x)) : [];
  const wants = c.show_trade && p && p.tMatch ? theirs.want.filter(x => p.tMatch(mine.offer, x)) : [];
  const list = (arr, empty) => arr.length
    ? `<div class="xchips">${arr.slice(0, 80).map(x => `<span class="xchip">${esc(itemLabel(x))}</span>`).join('')}</div>`
    : `<div class="muted">${empty}</div>`;
  const joined = c.updated_at ? new Date(c.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const teamName = TEAMS[c.team] ? TEAMS[c.team][1] : 'No team';
  const teamEmoji = TEAMS[c.team] ? TEAMS[c.team][0] : '🎮';
  const isMe = user && user.id === c.user_id;
  const isBanned = !!(prof && prof.banned);
  // #58 profile views: count unique opens (best-effort; self views don't count)
  if (!isMe && c.user_id && sb()) {
    try { await sb().rpc('bump_profile_views', { p_user_id: c.user_id }); c.profile_views = (c.profile_views || 0) + 1; } catch {}
  }
  const counts = await followCounts(c.user_id);
  const following = !isMe && user ? await amFollowing(c.user_id) : false;
  let goals = [];
  try { goals = JSON.parse(localStorage.getItem('pdx.goals.' + c.username) || '[]'); } catch {}

  const avatar = (c.avatar_url || '').trim();
  const banner = (c.banner_url || '').trim();
  const nameColor = (prof && prof.name_color) ? prof.name_color : '';

  // Badges BEFORE username (Krunker order)
  const nameBadges = badgeRows.slice(0, 6).map(r => {
    const b = r.badges;
    const url = b.image_url || '';
    if (url && /^https?:|^data:/i.test(url)) {
      return `<img draggable="false" src="${esc(url)}" class="customBadge" title="${esc(b.name || '')}" alt="">`;
    }
    return `<span class="customBadge emojiBadge" title="${esc(b.name || '')}">${esc(b.emoji || '🏅')}</span>`;
  }).join('');

  const clanHtml = clanRow
    ? `<a class="clanLink" href="#" data-clan="${esc(clanRow.tag)}" style="color:${esc(clanRow.color || 'rgba(255,255,255,0.6)')}">[${esc(clanRow.tag)}]</a>`
    : '';

  try { history.replaceState(null, '', '/u/' + encodeURIComponent(c.profile_slug || c.username) + location.search); } catch {}

  host.innerHTML = `
  <div id="profileHolder" class="profileHolder">
    <button class="xbtn profBackBtn" type="button" id="profBack">← Social</button>
    <div class="scrollItemNew profileShell${banner ? ' hasBanner' : ''}${(c.profile_theme ? ' ptheme-' + c.profile_theme : '')}"${banner ? ` style="--profile-banner:url('${esc(banner)}')"` : ''}>
      <div id="hackText"${isBanned ? ' style="display:block"' : ''}>BANNED</div>
      <div id="leftProfile">
        ${avatar
          ? `<img id="socialPic" class="profilePic" src="${esc(avatar)}" alt="">`
          : `<div id="socialPic" class="profilePic profilePicEmoji">${teamEmoji}</div>`}
      </div>
      <div id="rightProfile">
        <div class="leftTopHolder">
          ${nameBadges}<span class="profileName" id="nameSwitch" style="${nameColor ? `color:${esc(nameColor)}` : ''}">${esc(c.username)}</span>${clanHtml ? ' ' + clanHtml : ''}
        </div>
        <div class="leftMidHolder">Since <span>${joined}</span></div>
        <div class="leftBottomHolder">
          <div class="follL" id="followerC" data-showfollows="followers">${counts.followers}<span class="follCount">Followers</span></div>
          <div class="follL" id="followC" data-showfollows="following">${counts.following}<span class="follCount">following</span></div>
        </div>
        <div class="rightTopHolder">
          ${user && user.is_admin && !isMe ? `<button type="button" class="matIconBtn" id="flagBtn" title="${isBanned ? 'Unban' : 'Ban'}" aria-label="${isBanned ? 'Unban' : 'Ban'}"><svg class="flagIco" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 3.5v17h1.5V14h9.2l-1.3-3.5 1.3-3.5H7.5V3.5H6z"/></svg></button>` : ''}
          ${!isMe && user ? `<button type="button" class="matIconBtn" id="reprtBtn" title="Report" aria-label="Report"><img src="/report-icon.png" width="18" height="18" alt=""></button>` : ''}
        </div>
        <div class="rightBottomHolder">
          ${code ? `<div class="bottomBtn" data-copy="${esc(code.code)}">Friend code</div>` : ''}
          ${!isMe && user ? `<div class="bottomBtn" id="spDmBtn" data-dmid="${esc(c.user_id)}" data-dmname="${esc(c.username)}">Message</div>
          <div class="bottomBtn follow ${following ? 'isFollowing' : ''}" id="spFollowBtn" data-follow="${esc(c.user_id)}" data-fname="${esc(c.username)}">${following ? 'Following' : 'Follow'}</div>` : ''}
          ${isMe ? `<div class="bottomBtn" id="spEditLook">Edit look</div>` : ''}
        </div>
      </div>
    </div>

    <div class="profileNav">
      <div class="profileTabs">
        <button class="profileTab pTabA" type="button" data-sptab="about">About</button>
        <button class="profileTab" type="button" data-sptab="trades">Trade lists</button>
        ${c.hide_badges && !isMe ? '' : '<button class="profileTab" type="button" data-sptab="badges">Badges</button>'}
        <button class="profileTab" type="button" data-sptab="goals">Goals</button>
      </div>
    </div>

    <div class="pTabsContent" id="spBody">
      <div class="scrollItemNew spPane" data-pane="about">
        <div class="scrollItemHead">Overall stats</div>
        <div class="xcardstats" style="margin-top:10px">
          <div><small>Registered</small><b>${fmtNum(c.caught)} / ${fmtNum(c.total)}</b></div>
          ${c.hide_pct && !isMe ? '' : `<div><small>Completion</small><b>${Number(c.pct).toFixed(1)}%</b></div>`}
          ${c.hide_shiny && !isMe ? '' : `<div><small>Shinies</small><b>${fmtNum(c.shiny)}</b></div>`}
          <div><small>Specials</small><b>${fmtNum(c.special)}</b></div>
        </div>
        ${c.hide_pct && !isMe ? '' : `<div class="progress spBar" style="margin:12px 0"><i style="width:${Math.min(100, Number(c.pct) || 0)}%"></i></div>`}
        ${c.bio ? `<div class="spSection"><div class="scrollItemHead">About</div><p>${esc(c.bio)}</p></div>` : ''}
        <div class="spSection"><div class="scrollItemHead">Details</div>
          <div class="xcardstats">
            <div><small>Team</small><b>${esc(teamName)}</b></div>
            <div><small>Profile views</small><b>${fmtNum(c.profile_views || 0)}</b></div>
            <div><small>Clan</small><b>${clanRow ? esc(clanRow.tag) : '—'}</b></div>
            <div><small>Friend code</small><b>${code ? fmtCode(code.code) : 'Hidden'}</b></div>
            <div><small>Trade lists</small><b>${c.show_trade ? 'Public' : 'Private'}</b></div>
          </div>
        </div>
        ${c.show_trade && (gives.length || wants.length) ? `<div class="spSection"><div class="scrollItemHead">Overlap with you</div>
          <div class="xcols" style="margin-top:8px"><div><small>They can give you</small>${list(gives, '—')}</div>
          <div><small>They want from you</small>${list(wants, '—')}</div></div></div>` : ''}
      </div>

      <div class="scrollItemNew spPane" data-pane="trades" hidden>
        <div class="scrollItemHead">Trade lists</div>
        ${c.show_trade
          ? `<div class="xcols" style="margin-top:10px"><div><b>Looking for (${theirs.want.length})</b>${list(theirs.want, 'Empty')}</div>
             <div><b>Offering (${theirs.offer.length})</b>${list(theirs.offer, 'Empty')}</div></div>`
          : '<p class="muted">This trainer keeps their trade lists private.</p>'}
      </div>

      <div class="scrollItemNew spPane" data-pane="badges" hidden>
        <div class="scrollItemHead">Badges</div>
        <div id="spBadges">${badgeRows.length
          ? `<div class="badgeGrid">${badgeRows.map(r => {
              const b = r.badges;
              const url = b.image_url || '';
              return `<div class="badgeCard" title="${esc(b.name || '')}">${url && /^https?:|^data:/i.test(url) ? `<img class="badgeImg" src="${esc(url)}" alt="">` : `<span class="badgeEmoji">${esc(b.emoji || '🏅')}</span>`}<small>${esc(b.name || '')}</small></div>`;
            }).join('')}</div>`
          : '<div class="empty small">No badges yet.</div>'}</div>
      </div>

      <div class="scrollItemNew spPane" data-pane="goals" hidden>
        <div class="scrollItemHead">Goals</div>
        ${goals.length ? goals.map(g => {
          const pct = Math.min(100, Math.round((g.current || 0) / (g.target || 1) * 100));
          return `<div class="goalCard"><div class="goalTop"><b>${esc(g.title)}</b><span>${g.current || 0} / ${g.target}</span></div><div class="progress"><i style="width:${pct}%"></i></div></div>`;
        }).join('') : '<div class="empty small">No public goals yet.</div>'}
        ${isMe ? `<div style="margin-top:12px"><button class="xbtn" type="button" id="spAddGoal">＋ Add goal</button></div>` : ''}
      </div>
    </div>
  </div>`;

  const back = () => {
    socialState.viewing = null;
    socialState._opening = null;
    try { if (location.pathname.indexOf('/u/') === 0) history.replaceState(null, '', '/social' + location.search); } catch {}
    renderSocial();
  };
  const pb = $('#profBack'); if (pb) pb.onclick = back;
  host.querySelectorAll('[data-copy]').forEach(btn => { btn.onclick = () => copyText(btn.dataset.copy, btn); });
  host.querySelectorAll('[data-sptab]').forEach(tab => {
    tab.onclick = () => {
      host.querySelectorAll('.profileTab').forEach(t => t.classList.toggle('pTabA', t === tab));
      host.querySelectorAll('.spPane').forEach(pane => { pane.hidden = pane.dataset.pane !== tab.dataset.sptab; });
    };
  });
  host.querySelectorAll('[data-showfollows]').forEach(btn => {
    btn.onclick = () => showFollowList(c.user_id, c.username, btn.dataset.showfollows);
  });

  const dm = host.querySelector('#spDmBtn');
  if (dm) dm.onclick = () => {
    if (window.PDX_OPEN_DM) window.PDX_OPEN_DM(c.user_id, c.username);
    else toast('Open chat to message ' + c.username);
  };

  const fb = host.querySelector('#spFollowBtn');
  if (fb) fb.onclick = async () => {
    fb.style.pointerEvents = 'none';
    try {
      await toggleFollow(c.user_id, c.username);
      const on = await amFollowing(c.user_id);
      fb.textContent = on ? 'Following' : 'Follow';
      fb.classList.toggle('isFollowing', on);
      const cnt = await followCounts(c.user_id);
      const a = host.querySelector('#followerC');
      const b2 = host.querySelector('#followC');
      if (a) a.innerHTML = cnt.followers + '<span class="follCount">Followers</span>';
      if (b2) b2.innerHTML = cnt.following + '<span class="follCount">following</span>';
    } finally {
      fb.style.pointerEvents = '';
    }
  };

  const edit = host.querySelector('#spEditLook');
  if (edit) edit.onclick = () => openEditLook(c);

  // Admin ban (flag) — same icon button style as report
  const flagBtn = host.querySelector('#flagBtn');
  if (flagBtn) flagBtn.onclick = async () => {
    if (!user || !user.is_admin) return;
    const next = !isBanned;
    if (next) {
      const dlg = window.PDX_DIALOG;
      if (!dlg) return toast('Ban dialog unavailable.');
      const r = await dlg({
        title: 'Ban ' + c.username,
        body: 'This permanently bans the account. They will not be able to log in again. Their username stays claimed.',
        confirmLabel: 'Ban account',
        cancelLabel: 'Cancel',
        input: true,
        inputPlaceholder: 'Reason (required)',
        danger: true
      });
      if (!r) return;
      const reason = (r.value || '').trim().slice(0, 200);
      if (!reason) return toast('A ban reason is required.');
      const { error: be } = await sb().from('profiles').update({ banned: true, ban_reason: reason, banned_until: null }).eq('id', c.user_id);
      if (be) return toast(be.message);
      toast(c.username + ' banned.');
    } else {
      const dlg = window.PDX_DIALOG;
      const r = dlg ? await dlg({ title: 'Unban ' + c.username, body: 'They will be able to log in again.', confirmLabel: 'Unban', cancelLabel: 'Cancel' }) : { ok: true };
      if (!r) return;
      const { error: be } = await sb().from('profiles').update({ banned: false, ban_reason: '', banned_until: null }).eq('id', c.user_id);
      if (be) return toast(be.message);
      toast(c.username + ' unbanned.');
    }
    openProfile(c.username);
  };

  // Report — same matIconBtn style as flag
  const repBtn = host.querySelector('#reprtBtn');
  if (repBtn) repBtn.onclick = () => {
    if (typeof window.PDX_REPORT === 'function') window.PDX_REPORT(c.username, 'profile');
    else toast('Report is unavailable right now.');
  };

  const addG = host.querySelector('#spAddGoal');
  if (addG) addG.onclick = () => {
    const title = prompt('Goal title (e.g. 100% Gen 1 shinies)');
    if (!title) return;
    const target = parseInt(prompt('Target number', '100'), 10) || 100;
    goals.push({ title, target, current: 0 });
    try { localStorage.setItem('pdx.goals.' + c.username, JSON.stringify(goals)); } catch {}
    openProfile(name);
  };

  document.dispatchEvent(new CustomEvent('pdx:profile', { detail: { user_id: c.user_id, username: c.username, el: host, hide_badges: !!(c.hide_badges && !(user && user.id === c.user_id)) } }));
  } catch (err) {
    console.error('openProfile', err);
    const host = $('#socialView');
    if (host) host.innerHTML = `<div class="panel"><div class="empty small">Could not open profile: ${esc(err && err.message ? err.message : err)}</div>
      <button class="xbtn" type="button" id="profBack">← Back to Social</button></div>`;
    const b = $('#profBack'); if (b) b.onclick = () => { socialState.viewing = null; socialState._opening = null; renderSocial(); };
  } finally {
    if (socialState._opening === name) socialState._opening = null;
  }
}


async function showFollowList(userId, username, direction) {
  if (!sb()) return;
  const isFollowers = direction === 'followers';
  const col = isFollowers ? 'follower_id' : 'following_id';
  const other = isFollowers ? 'following_id' : 'follower_id';
  const title = isFollowers ? 'Followers of @' + username : '@' + username + ' is following';
  const body = document.createElement('div');
  body.innerHTML = `<div class="empty small"><i class="spin"></i> Loading…</div>`;
  const m = typeof modal === 'function' ? modal(`<h2>${esc(title)}</h2><div id="followListBody"></div>`) : null;
  const box = m ? (m.querySelector('#followListBody') || m) : body;
  if (!m) {
    // fallback toast-style panel
  }
  try {
    const { data: rows, error } = await sb().from('follows').select(col).eq(other, userId).limit(200);
    if (error) { box.innerHTML = `<div class="empty small">${esc(error.message)}</div>`; return; }
    const ids = (rows || []).map(r => r[col]).filter(Boolean);
    if (!ids.length) { box.innerHTML = '<div class="empty small">Nobody yet.</div>'; return; }
    const { data: cards } = await sb().from('trainer_cards').select('user_id,username,team,pct,caught,avatar_url').eq('is_public', true).in('user_id', ids);
    const map = new Map((cards || []).map(x => [x.user_id, x]));
    const list = ids.map(id => map.get(id)).filter(Boolean);
    box.innerHTML = list.length
      ? `<div class="followList">${list.map(r => {
          const av = (r.avatar_url || '').trim();
          return `<button type="button" class="followRow" data-prof="${esc(r.username)}">
            <span class="followAv">${av ? `<img src="${esc(av)}" alt="">` : (TEAMS[r.team] ? TEAMS[r.team][0] : '🎮')}</span>
            <span class="followMeta"><b>${esc(r.username)}</b><small>${Number(r.pct).toFixed(1)}% · ${fmtNum(r.caught)} registered</small></span>
          </button>`;
        }).join('')}</div>`
      : '<div class="empty small">No public profiles in this list.</div>';
    box.querySelectorAll('[data-prof]').forEach(btn => {
      btn.onclick = () => {
        try { if (typeof closeModal === 'function') closeModal(); } catch {}
        openProfile(btn.dataset.prof);
      };
    });
  } catch (e) {
    box.innerHTML = `<div class="empty small">${esc(e.message || e)}</div>`;
  }
}

function openEditLook(card) {
  if (!user || !sb() || user.id !== card.user_id) return;
  const html = `<h2>Edit profile look</h2>
    <p class="muted">Choose an image file for your avatar and/or banner. Any file size is fine. Leave a field empty to keep what you have now.</p>
    <label>Avatar image<input type="file" id="lookAvFile" accept="image/*"></label>
    <label>Banner image<input type="file" id="lookBnFile" accept="image/*"></label>
    <div class="xactions"><button class="xbtn primary" type="button" id="lookSave">Save</button>
      <button class="xbtn" type="button" id="lookClear">Clear images</button></div>`;
  const m = modal(html);
  const readFile = input => new Promise((resolve, reject) => {
    const f = input.files && input.files[0]; if (!f) return resolve('');
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(f);
  });
  m.querySelector('#lookSave').onclick = async () => {
    try {
      const af = m.querySelector('#lookAvFile'), bf = m.querySelector('#lookBnFile');
      const upd = {};
      if (af.files && af.files[0]) upd.avatar_url = await readFile(af);
      if (bf.files && bf.files[0]) upd.banner_url = await readFile(bf);
      if (!Object.keys(upd).length) return toast('Pick an image first');
      const { error } = await sb().from('trainer_cards').update(upd).eq('user_id', user.id);
      if (error) return toast(error.message);
      toast('Profile look saved');
      closeModal();
      openProfile(card.username);
    } catch (e) { toast(e.message || String(e)); }
  };
  m.querySelector('#lookClear').onclick = async () => {
    const { error } = await sb().from('trainer_cards').update({ avatar_url: '', banner_url: '' }).eq('user_id', user.id);
    if (error) return toast(error.message);
    toast('Images cleared');
    closeModal();
    openProfile(card.username);
  };
}


function handleProfileHash() {
  // Support both #u=name and clean /u/name paths
  let name = '';
  const hash = /^#u=(.+)$/.exec(location.hash);
  const path = location.pathname.match(/\/u\/([^\/\?#]+)/);
  if (hash) { try { name = decodeURIComponent(hash[1]); } catch { return; } }
  else if (path) { try { name = decodeURIComponent(path[1]); } catch { return; } }
  else return;
  // Jump straight to Social (no Pokédex flash) then open the profile
  document.body.dataset.view = 'social';
  document.querySelectorAll('#viewbar [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === 'social'));
  if (P() && P().setView) P().setView('social', 'replace');
  openProfile(name);
  try {
    // Keep clean URL in the bar when possible
    if (path) history.replaceState(null, '', '/u/' + encodeURIComponent(name) + location.search);
    else history.replaceState(null, '', location.pathname + location.search);
  } catch {}
}

/* ---- Followers ---- */
async function followCounts(userId) {
  if (!sb() || !userId) return { followers: 0, following: 0 };
  try {
    const [a, b] = await Promise.all([
      sb().from('follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', userId),
      sb().from('follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', userId)
    ]);
    return { followers: a.count || 0, following: b.count || 0 };
  } catch { return { followers: 0, following: 0 }; }
}
async function amFollowing(targetId) {
  if (!user || !sb() || !targetId) return false;
  try {
    const { data } = await sb().from('follows').select('follower_id').eq('follower_id', user.id).eq('following_id', targetId).maybeSingle();
    return !!data;
  } catch { return false; }
}
async function toggleFollow(targetId, targetName) {
  if (!user || !sb()) return toast('Log in to follow trainers.');
  if (user.id === targetId) return;
  const on = await amFollowing(targetId);
  if (on) {
    const { error } = await sb().from('follows').delete().eq('follower_id', user.id).eq('following_id', targetId);
    if (error) return toast(/does not exist|404|relation/i.test(error.message) ? 'Run supabase/fix-follows-dms.sql in Supabase (follows table missing).' : error.message);
    toast('Unfollowed ' + targetName);
  } else {
    const { error } = await sb().from('follows').upsert({ follower_id: user.id, following_id: targetId });
    if (error) return toast(/does not exist|404|relation/i.test(error.message || '') || error.code === '42P01' ? 'Run supabase/fix-follows-dms.sql in Supabase (follows table missing).' : error.message);
    toast('Following ' + targetName);
  }
}

/* =====================================================================================================
   3. TRADE MATCHING (inside the Trading tab)
   ===================================================================================================== */
const VLAB = { shiny: 'Shiny', shadow: 'Shadow', purified: 'Purified', lucky: 'Lucky', mega: 'Mega', dynamax: 'Dynamax', gigantamax: 'Gigantamax', xxl: 'XXL', xxs: 'XXS', costume: 'Costume', background: 'Background' };
const itemLabel = it => { const p = P(); return ((VLAB[it.v] || '') + ' ' + (p ? p.tName(it) : '#' + it.id)).trim() + (it.qty > 1 ? ' ×' + it.qty : ''); };
const cleanTrade = t => { const f = a => (Array.isArray(a) ? a : []).map(x => ({ id: +(x && x.id), v: String((x && x.v) || 'normal').slice(0, 20), k: x && x.k ? String(x.k).slice(0, 200) : undefined, qty: Math.max(1, Math.min(999, +(x && x.qty) || 1)) })).filter(x => x.id >= 1 && x.id <= 1025); return { want: f(t && t.want), offer: f(t && t.offer) }; };
const fmtCode = c => String(c || '').replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3');

/* ---- shared: avatars, banners, badges, clan + friend code for a set of trainers (loaded after the text, never blocks it) ---- */
const safeImg = u => /^(https?:|data:image\/)/i.test(u || '') ? u : '';
const extraCache = new Map();
async function loadTrainerExtras(ids) {
  const need = [...new Set(ids)].filter(id => id && !extraCache.has(id));
  if (!need.length || !sb()) return;
  const safe = q => Promise.resolve(q).then(r => r, () => ({ data: null }));
  const [c, b, p, f] = await Promise.all([
    safe(sb().from('trainer_cards').select('user_id,avatar_url,banner_url').in('user_id', need)),
    safe(sb().from('user_badges').select('user_id,awarded_at,badges(id,name,image_url,emoji,color,sort)').in('user_id', need)),
    safe(sb().from('profiles').select('id,clan,name_color').in('id', need)),
    user ? safe(sb().from('friend_codes').select('user_id,code').in('user_id', need)) : Promise.resolve({ data: [] })
  ]);
  const tags = [...new Set((p.data || []).map(r => r.clan).filter(Boolean))];
  const clans = tags.length ? ((await safe(sb().from('clans').select('tag,color').in('tag', tags))).data || []) : [];
  need.forEach(id => {
    const card = (c.data || []).find(r => r.user_id === id) || {}, prof = (p.data || []).find(r => r.id === id) || {};
    const clan = prof.clan ? (clans.find(x => x.tag === prof.clan) || { tag: prof.clan, color: '#f4c96b' }) : null;
    extraCache.set(id, {
      avatar: safeImg((card.avatar_url || '').trim()), banner: safeImg((card.banner_url || '').trim()),
      badges: (b.data || []).filter(r => r.user_id === id && r.badges).map(r => r.badges).sort((x, y) => (x.sort || 0) - (y.sort || 0)),
      clan, nameColor: prof.name_color || '', code: ((f.data || []).find(r => r.user_id === id) || {}).code || ''
    });
  });
}
const badgeIcon = b => safeImg(b.image_url)
  ? `<img class="sbadge" src="${esc(safeImg(b.image_url))}" title="${esc(b.name || '')}" alt="" draggable="false" loading="lazy">`
  : `<span class="sbadge sbemoji" title="${esc(b.name || '')}">${esc(b.emoji || '🏅')}</span>`;
const avatarHtml = (url, team, cls) => url
  ? `<img class="${cls}" src="${esc(url)}" alt="" loading="eager" decoding="async" draggable="false">`
  : `<span class="${cls} noimg">${TEAMS[team] ? TEAMS[team][0] : '🎮'}</span>`;
const clanTag = c => c ? `<span class="sclan" style="color:${esc(c.color || '#f4c96b')}">[${esc(c.tag)}]</span>` : '';

/* =====================================================================================================
   3. TRADE MATCHING (Trading → Matches tab)
   ===================================================================================================== */
let matchBox = null, matchState = { rows: null, err: '', loading: false, at: 0, tab: 'lists', mode: 'mutual', sort: 'best', team: '', fOpen: false, limit: 15, exp: new Set() };
const TILES_COLLAPSED = 28;
function ensureMatchBox() {
  if (matchBox && matchBox.isConnected) return matchBox;
  const bar = $('#tradeView .tradebar'); if (!bar) return null;
  matchBox = document.createElement('div'); matchBox.id = 'matchBox'; matchBox.className = 'pgm';
  bar.before(matchBox);
  if (P() && P().bindTileErrors) P().bindTileErrors(matchBox);
  return matchBox;
}
/* Matches is its own page now; this only keeps the count badge on its nav button up to date */
function ensureTradeTabs() { applyTradeTab(); }
function applyTradeTab() {
  const n = $('#matchTabN');
  if (n) { const c = matchState.rows ? matchState.rows.filter(m => m.g && m.k).length : 0; n.textContent = c; n.hidden = !c; }
}
async function findMatches(force) {
  const box = ensureMatchBox(); if (!box || !P()) return;
  if (!sb()) { matchState = { ...matchState, rows: [], err: 'The online features could not load.', loading: false, at: Date.now() }; return paintMatches(); }
  if (!force && matchState.rows && Date.now() - matchState.at < 30000) return paintMatches();
  matchState.loading = true; paintMatches();
  const { data, error } = await sb().from('trainer_cards').select('user_id,username,team,trade,pct,bio,updated_at').eq('is_public', true).eq('show_trade', true).order('updated_at', { ascending: false }).limit(500);
  matchState.loading = false; matchState.at = Date.now();
  if (error) { matchState.err = tableMissing(error) ? SETUP_HINT : error.message; matchState.rows = []; return paintMatches(); }
  matchState.err = '';
  const mine = P().trade, out = [];
  (data || []).forEach(r => {
    if (user && r.user_id === user.id) return;
    const t = cleanTrade(r.trade);
    const give = t.offer.filter(x => P().tMatch(mine.want, x)), take = t.want.filter(x => P().tMatch(mine.offer, x));
    const g = new Set(give.map(x => x.id + x.v)).size, k = new Set(take.map(x => x.id + x.v)).size;
    if (!g && !k) return;
    out.push({ r, t, give, take, g, k, score: (g && k ? 1000 : 0) + Math.min(g, k) * 20 + g + k });
  });
  out.sort((a, b) => b.score - a.score); matchState.rows = out.slice(0, 80); matchState.limit = 15; paintMatches();
  loadTrainerExtras(matchState.rows.map(m => m.r.user_id)).then(() => { if (document.body.dataset.view === 'matches') paintMatches(); });
}
const schedMatches = debounce(() => { if (!matchState.rows) return; if (document.body.dataset.view === 'matches') findMatches(true); else matchState.at = 0; }, 1500);

const MODES = {
  mutual: ['Mutual', 'Both sides match', m => m.g && m.k],
  have: ['I Have', 'They want Pokémon you have', m => m.k],
  want: ['I Want', 'They have Pokémon you want', m => m.g]
};
function tilePanel(m, kind, uid) {
  const list = kind === 'offer' ? m.t.offer : m.t.want, hi = new Set(kind === 'offer' ? m.give : m.take);
  const sorted = list.slice().sort((a, b) => (hi.has(b) - hi.has(a)));
  const open = matchState.exp.has(uid + ':' + kind), shown = open ? sorted : sorted.slice(0, TILES_COLLAPSED), rest = sorted.length - shown.length;
  const pp = P();
  const tiles = shown.map(x => pp.tile(x, { hi: hi.has(x), qty: kind === 'offer' ? x.qty : 1 })).join('');
  return `<div class="pgm-panel"><div class="pgm-plabel ${kind}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${kind === 'offer' ? '<path d="M7 17 17 7M8 7h9v9"/>' : '<path d="M17 7 7 17M16 17H7V8"/>'}</svg>${kind === 'offer' ? 'FOR TRADE' : 'LOOKING FOR'} <span>(${list.length})</span></div>
    <div class="pgm-tiles">${tiles || '<span class="muted">Nothing listed</span>'}</div>
    ${rest > 0 ? `<button type="button" class="pgm-more" data-mmore="${esc(uid + ':' + kind)}">Show ${rest} more</button>` : ''}</div>`;
}
function matchCard(m, i) {
  const r = m.r, ex = extraCache.get(r.user_id) || {};
  const pairs = m.g && m.k ? Math.min(m.g, m.k) : (m.g || m.k);
  const chips = [
    ex.code ? `<button type="button" class="pgm-chip code" data-copy="${esc(ex.code)}" title="Copy friend code"><i class="ball"></i>${fmtCode(ex.code)}</button>` : '',
    ...(ex.badges || []).slice(0, 3).map(b => `<span class="pgm-chip badge">${badgeIcon(b)}${esc(b.name || '')}</span>`),
    TEAMS[r.team] ? `<span class="pgm-chip" style="--tc:${TEAMS[r.team][2]}">${TEAMS[r.team][0]} ${TEAMS[r.team][1]}</span>` : '',
    `<span class="pgm-chip">${Number(r.pct || 0).toFixed(1)}%</span>`
  ].join('');
  return `<article class="pgm-card${m.g && m.k ? ' mutual' : ''}">
    <header class="pgm-head">
      <button type="button" class="pgm-av" data-prof="${esc(r.username)}" aria-label="Open ${esc(r.username)}'s profile">${avatarHtml(ex.avatar, r.team, 'pgm-avimg')}</button>
      <div class="pgm-id"><div class="pgm-name"><button type="button" data-prof="${esc(r.username)}" ${ex.nameColor ? `style="color:${esc(ex.nameColor)}"` : ''}>${esc(r.username)}</button>${clanTag(ex.clan)}</div><div class="pgm-chips">${chips}</div></div>
      <div class="pgm-actions"><button type="button" class="pgm-msg" data-dm="${i}">Message</button>
        <div class="pgm-menu"><button type="button" class="pgm-dots" data-menu aria-label="More options" aria-haspopup="true">⋮</button>
          <div class="pgm-pop" hidden><button type="button" data-prof="${esc(r.username)}">View profile</button><button type="button" data-msg="${i}">Copy trade message</button>${user ? `<button type="button" data-report="${esc(r.username)}">Report</button>` : ''}</div></div></div>
    </header>
    <div class="pgm-body">
      <div class="pgm-pairs">${pairs} MATCHING PAIR${pairs === 1 ? '' : 'S'}</div>
      <div class="pgm-lists">${tilePanel(m, 'offer', r.user_id)}<span class="pgm-swap" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg></span>${tilePanel(m, 'want', r.user_id)}</div>
      ${r.bio ? `<div class="pgm-note"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg><span>${esc(r.bio)}</span></div>` : ''}
    </div></article>`;
}
function paintMatches() {
  const box = ensureMatchBox(); if (!box) return;
  ensureTradeTabs();
  const p = P(), mine = p.trade, empty = !mine.want.length && !mine.offer.length;
  const all = matchState.rows || [], [, modeText, modeFn] = MODES[matchState.mode];
  let rows = all.filter(m => modeFn(m) && (!matchState.team || m.r.team === matchState.team));
  if (matchState.sort === 'most') rows = rows.slice().sort((a, b) => (b.g + b.k) - (a.g + a.k));
  else if (matchState.sort === 'recent') rows = rows.slice().sort((a, b) => new Date(b.r.updated_at || 0) - new Date(a.r.updated_at || 0));
  let body;
  if (matchState.loading) body = '<div class="empty small"><i class="spin"></i> Looking for trainers…</div>';
  else if (matchState.err) body = `<div class="empty small">${esc(matchState.err)}</div>`;
  else if (empty) body = '<div class="empty small">Create a trade pair on the <b>Dashboard</b> (For Trade and Looking For) and matching trainers will show up here.</div>';
  else if (!matchState.rows) body = '<div class="empty small">Loading matches…</div>';
  else if (!all.length) body = '<div class="empty small">No overlap with shared lists yet. Publish your own lists from Social so others can find you too.</div>';
  else if (!rows.length) body = `<div class="empty small">No ${esc(MODES[matchState.mode][0].toLowerCase())} matches${matchState.team ? ' for that team' : ''}. Try another tab above.</div>`;
  else body = `<div class="pgm-list">${rows.slice(0, matchState.limit).map(m => matchCard(m, matchState.rows.indexOf(m))).join('')}</div>${rows.length > matchState.limit ? `<button type="button" class="pgm-loadmore" data-mlimit>Show more trainers (${rows.length - matchState.limit})</button>` : ''}`;
  const seg = Object.entries(MODES).map(([k, v]) => `<button type="button" role="tab" aria-selected="${matchState.mode === k}" class="${matchState.mode === k ? 'on' : ''}" data-mmode="${k}">${v[0]}</button>`).join('');
  const opt = (v, t, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${t}</option>`;
  box.innerHTML = `<div class="pgm-top"><h2>Matches</h2><p>Trainers whose trade lists align with yours</p></div>
    <div class="pgm-seg" role="tablist">${seg}</div>
    <div class="pgm-bar"><span>${matchState.rows && !matchState.loading ? `${esc(modeText)} — ${rows.length} result${rows.length === 1 ? '' : 's'}` : ''}</span>
      <button type="button" class="pgm-filterbtn${matchState.fOpen ? ' on' : ''}" data-mfilters aria-expanded="${matchState.fOpen}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>Filters</button></div>
    ${matchState.fOpen ? `<div class="pgm-filters"><label>Sort<select id="mSort">${opt('best', 'Best match', matchState.sort)}${opt('most', 'Most Pokémon', matchState.sort)}${opt('recent', 'Recently updated', matchState.sort)}</select></label>
      <label>Team<select id="mTeam"><option value="">Any team</option>${Object.entries(TEAMS).map(([k, t]) => opt(k, t[1], matchState.team)).join('')}</select></label>
      <button type="button" class="xbtn" id="mRefresh">Refresh matches</button></div>` : ''}
    ${body}`;
  const ms = $('#mSort'); if (ms) ms.onchange = () => { matchState.sort = ms.value; matchState.limit = 15; paintMatches(); };
  const mt = $('#mTeam'); if (mt) mt.onchange = () => { matchState.team = mt.value; matchState.limit = 15; paintMatches(); };
  applyTradeTab();
}
function tradeMsg(m, extra) {
  const code = myCode ? `\nMy friend code: ${fmtCode(myCode.code)}` : '';
  return `Hi ${m.r.username}! I found you on GO Dex trade matches.\n${m.give.length ? 'I’m hoping for: ' + m.give.slice(0, 8).map(itemLabel).join(', ') + '\n' : ''}${m.take.length ? 'I can trade: ' + m.take.slice(0, 8).map(itemLabel).join(', ') + '\n' : ''}Want to trade?${code}`;
}
document.addEventListener('click', e => {
  const t = e.target, pr = t.closest && t.closest('[data-prof]');
  if (pr) { document.querySelectorAll('.pgm-pop').forEach(x => x.hidden = true); return void openProfile(pr.dataset.prof); }
  const inBox = t.closest && t.closest('#matchBox');
  if (!inBox) { document.querySelectorAll('.pgm-pop').forEach(x => x.hidden = true); return; }
  const md = t.closest('[data-mmode]'); if (md) { matchState.mode = md.dataset.mmode; matchState.limit = 15; return void paintMatches(); }
  if (t.closest('[data-mfilters]')) { matchState.fOpen = !matchState.fOpen; return void paintMatches(); }
  if (t.id === 'mRefresh') return void findMatches(true);
  if (t.closest('[data-mlimit]')) { matchState.limit += 15; return void paintMatches(); }
  const mo = t.closest('[data-mmore]'); if (mo) { matchState.exp.add(mo.dataset.mmore); return void paintMatches(); }
  const menu = t.closest('[data-menu]');
  if (menu) { const pop = menu.nextElementSibling, was = pop.hidden; document.querySelectorAll('.pgm-pop').forEach(x => x.hidden = true); pop.hidden = !was; return; }
  const cp = t.closest('[data-copy]'); if (cp) return void copyText(cp.dataset.copy, cp);
  const dm = t.closest('[data-dm]');
  if (dm) { const m = matchState.rows && matchState.rows[+dm.dataset.dm]; if (!m) return;
    if (!user) return void toast('Log in to message trainers.');
    return void (window.PDX_OPEN_DM ? window.PDX_OPEN_DM(m.r.user_id, m.r.username) : toast('Messaging is unavailable right now.')); }
  const mb = t.closest('[data-msg]');
  if (mb && matchState.rows) { const m = matchState.rows[+mb.dataset.msg]; if (m) copyText(tradeMsg(m), mb); document.querySelectorAll('.pgm-pop').forEach(x => x.hidden = true); return; }
  const rp = t.closest('[data-report]'); if (rp) { document.querySelectorAll('.pgm-pop').forEach(x => x.hidden = true); if (typeof window.PDX_REPORT === 'function') window.PDX_REPORT(rp.dataset.report, 'profile'); }
});

/* =====================================================================================================
   4. FRIEND CODE BOARD
   ===================================================================================================== */
let codes = { rows: null, err: '', q: '', team: '' }, myCode = null;
async function loadCodes() {
  if (!user || !sb()) return;
  const { data, error } = await sb().from('friend_codes').select('user_id,username,code,trainer_name,team,region,note,updated_at').order('updated_at', { ascending: false }).limit(300);
  codes.err = error ? (tableMissing(error) ? SETUP_HINT : error.message) : ''; codes.rows = data || [];
  myCode = (data || []).find(r => r.user_id === user.id) || null;
}
function codesHtml() {
  const q = codes.q.trim().toLowerCase(), rows = (codes.rows || []).filter(r => (!codes.team || r.team === codes.team) && (!q || [r.username, r.trainer_name, r.region, r.note].join(' ').toLowerCase().includes(q)));
  if (!rows.length) return `<div class="empty small">${codes.rows && codes.rows.length ? 'No one matches that search.' : 'No codes posted yet. Add yours above!'}</div>`;
  return `<div class="xcodes">${rows.map(r => `<div class="xcodecard"><div class="xcodetop"><b>${esc(r.trainer_name || r.username)}</b> ${teamChip(r.team)}<span class="muted">${r.trainer_name && r.trainer_name !== r.username ? '@' + esc(r.username) : ''}</span></div>
    <div class="xcodenum">${fmtCode(r.code)}</div>${r.region ? `<div class="muted">📍 ${esc(r.region)}</div>` : ''}${r.note ? `<div class="xnote">${esc(r.note)}</div>` : ''}
    <div class="xactions"><button class="xbtn primary" type="button" data-copy="${esc(r.code)}">Copy code</button><button class="xbtn" type="button" data-prof="${esc(r.username)}">Profile</button>${user && (user.is_admin && r.user_id !== user.id) ? `<button class="xbtn danger" type="button" data-delcode="${esc(r.user_id)}">Remove</button>` : ''}</div></div>`).join('')}</div>`;
}
function renderCodes() {
  const v = $('#codesView'); if (!v) return;
  if (!user) { v.innerHTML = `<div class="panel"><div class="xhead"><div><b>🤝 Friend code board</b><div class="muted">Post your Pokémon GO friend code and find new trading partners.</div></div></div>${loginCta('see and post friend codes')}</div>`; return; }
  const c = myCode || {};
  v.innerHTML = `<div class="panel"><div class="xhead"><div><b>🤝 Friend code board</b><div class="muted">Only logged-in trainers can see this board.</div></div></div>
   <form id="codeForm" class="xform"><div class="xrow">
    <label>Friend code<input name="code" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="1234 5678 9012" required value="${esc(c.code ? fmtCode(c.code) : '')}"></label>
    <label>In-game name<input name="trainer_name" maxlength="24" placeholder="Optional" value="${esc(c.trainer_name || '')}"></label>
    <label>Team<select name="team"><option value="">—</option>${Object.entries(TEAMS).map(([k, t]) => `<option value="${k}" ${c.team === k ? 'selected' : ''}>${t[0]} ${t[1]}</option>`).join('')}</select></label></div>
    <div class="xrow"><label>Region / country<input name="region" maxlength="40" placeholder="e.g. Alabama, USA" value="${esc(c.region || '')}"></label><label class="xgrow">Note<input name="note" maxlength="100" placeholder="e.g. Trade Mondays, love shinies" value="${esc(c.note || '')}"></label></div>
    <div class="xactions"><button class="xbtn primary" type="submit">${myCode ? 'Update my code' : 'Post my code'}</button>${myCode ? '<button class="xbtn danger" type="button" id="delMyCode">Remove mine</button>' : ''}<span id="codeMsg" class="muted"></span></div></form></div>
   <div class="panel"><div class="xhead"><div class="xfilters"><input id="codeSearch" placeholder="Search name, region, note…" value="${esc(codes.q)}"><select id="codeTeam"><option value="">All teams</option>${Object.entries(TEAMS).map(([k, t]) => `<option value="${k}" ${codes.team === k ? 'selected' : ''}>${t[0]} ${t[1]}</option>`).join('')}</select></div></div>
   <div id="codeList">${codes.err ? `<div class="empty small">${esc(codes.err)}</div>` : codes.rows ? codesHtml() : SKEL(8)}</div></div>`;
  if (!codes.rows) loadCodes().then(() => { if (document.body.dataset.view === 'codes') renderCodes(); });
}
const cv = $('#codesView');
if (cv) {
  cv.addEventListener('input', e => {
    if (e.target.name === 'code') { const d = e.target.value.replace(/\D/g, '').slice(0, 12); e.target.value = d.replace(/(\d{4})(?=\d)/g, '$1 '); }
    if (e.target.id === 'codeSearch') { codes.q = e.target.value; $('#codeList').innerHTML = codesHtml(); }
  });
  cv.addEventListener('change', e => { if (e.target.id === 'codeTeam') { codes.team = e.target.value; $('#codeList').innerHTML = codesHtml(); } });
  cv.addEventListener('submit', async e => {
    if (e.target.id !== 'codeForm') return; e.preventDefault();
    const f = e.target, msg = $('#codeMsg'), code = f.code.value.replace(/\D/g, '');
    if (code.length !== 12) return void (msg.textContent = 'A friend code is exactly 12 digits.');
    msg.textContent = 'Saving…';
    const { error } = await sb().from('friend_codes').upsert({ user_id: user.id, code, trainer_name: f.trainer_name.value.trim(), team: f.team.value, region: f.region.value.trim(), note: f.note.value.trim() }, { onConflict: 'user_id' });
    if (error) return void (msg.textContent = tableMissing(error) ? SETUP_HINT : error.message);
    toast('Friend code posted.'); codes.rows = null; renderCodes();
  });
  cv.addEventListener('click', async e => {
    const cp = e.target.closest('[data-copy]'); if (cp) return void copyText(cp.dataset.copy, cp);
    const pr = e.target.closest('[data-prof]'); if (pr) return void openProfile(pr.dataset.prof);
    if (e.target.id === 'delMyCode' && confirm('Remove your friend code from the board?')) { await sb().from('friend_codes').delete().eq('user_id', user.id); myCode = null; codes.rows = null; renderCodes(); }
    const dc = e.target.closest('[data-delcode]'); if (dc && confirm('Remove this code from the board?')) { await sb().from('friend_codes').delete().eq('user_id', dc.dataset.delcode); codes.rows = null; renderCodes(); }
  });
}

/* =====================================================================================================
   6. INSTALL AS AN APP
   ===================================================================================================== */
let deferredInstall = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function paintInstall() { const b = $('#installBtn'); if (!b) return; b.hidden = standalone() || !(deferredInstall || isIOS || /^https?:$/.test(location.protocol)); }
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; paintInstall(); });
window.addEventListener('appinstalled', () => { deferredInstall = null; paintInstall(); toast('Installed! Open it from your home screen or app list.'); });
$('#installBtn') && ($('#installBtn').onclick = async () => {
  if (deferredInstall) { deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch {} deferredInstall = null; return paintInstall(); }
  modal(`<h2>📲 Install GO Dex</h2>${isIOS
    ? '<ol class="xsteps"><li>Tap the <b>Share</b> button in Safari (the square with the arrow).</li><li>Choose <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. It opens full-screen like a normal app.</li></ol>'
    : '<ol class="xsteps"><li>Open your browser’s menu (⋮ or the install icon in the address bar).</li><li>Choose <b>Install app</b> or <b>Add to Home screen</b>.</li><li>Open it from your app list — no browser bars, and it works offline.</li></ol><p class="muted">If you don’t see the option, your browser may not support installing (try Chrome, Edge or Safari).</p>'}`);
});
matchMedia('(display-mode: standalone)').addEventListener && matchMedia('(display-mode: standalone)').addEventListener('change', paintInstall);

/* =====================================================================================================
   wiring: login/logout, view changes, hash + ?view=
   ===================================================================================================== */
async function onLogin(detail) {
  if (user && user.id === detail.id) { user = detail; return; }   // already handled
  user = detail; cloud.off = false; paintCloud(); setCloud('saving');
  await loadMyCard(); loadCodes(); syncNow(true);
  const v = document.body.dataset.view; if (v) onView(v);
}
window.addEventListener('pdx:login', e => onLogin(e.detail));
window.addEventListener('pdx:logout', () => {
  user = null; myCard = null; myCode = null; codes.rows = null; cloud.off = false; clearTimeout(cloud.pushTimer); setCloud('off');
  const v = document.body.dataset.view; if (v === 'community' || v === 'codes') onView(v);
});
function onView(v) {
  // Leaving a profile via any tab should drop /u/ viewing state
  if (v !== 'social' && socialState && socialState.viewing) {
    socialState.viewing = null;
    socialState._opening = null;
  }
  if (v === 'community') renderCommunity();
  else if (v === 'codes') renderCodes();
  else if (v === 'dashboard') ensureTradeTools();
  else if (v === 'matches') { paintMatches(); if (!matchState.loading && P() && (P().trade.want.length || P().trade.offer.length)) findMatches(false); }
  else if (v === 'suggestions') renderSuggestions();
  else if (v === 'social') {
    warmSocial();
    // If URL is not a profile path, show the board (not a stuck profile)
    if (socialState.viewing && !/^\/u\//.test(location.pathname || '')) {
      socialState.viewing = null;
      socialState._opening = null;
    }
    renderSocial();
  }
}
function renderSuggestions() {
  const v = $('#suggestionsView'); if (!v) return;
  let list = [];
  try { list = JSON.parse(localStorage.getItem('pdx.suggestions') || '[]'); } catch {}
  const items = list.slice().reverse().map((s, i) => `<div class="panel" style="padding:12px 14px;margin-bottom:8px"><div style="font-size:13px;color:var(--muted);margin-bottom:4px">${esc(s.when || '')}${s.user ? ' · ' + esc(s.user) : ''}</div><div>${esc(s.text)}</div></div>`).join('') || '<div class="empty small">No suggestions yet. Be the first!</div>';
  v.innerHTML = `<div class="panel"><div class="xhead"><div><b>💡 Feature suggestions</b><div class="muted">Tell the site owner what you’d like to see next. Ideas are stored locally for now (admin can collect them later).</div></div></div>
    <form id="sugForm" style="display:grid;gap:10px;margin-top:12px">
      <textarea id="sugText" rows="3" placeholder="What would make this site even better?" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:#0e1722;color:inherit;resize:vertical"></textarea>
      <button class="xbtn primary" type="submit">Send suggestion</button>
    </form></div>
    <div style="margin-top:16px"><b style="font-size:14px">Recent ideas</b>${items}</div>`;
  const form = $('#sugForm');
  if (form) form.onsubmit = e => {
    e.preventDefault();
    const text = ($('#sugText') || {}).value.trim();
    if (!text) return;
    list.push({ text, when: new Date().toLocaleString(), user: (user && user.username) || 'anon' });
    try { localStorage.setItem('pdx.suggestions', JSON.stringify(list.slice(-50))); } catch {}
    renderSuggestions();
    toast('Thanks! Suggestion saved.');
  };
}
new MutationObserver(() => onView(document.body.dataset.view)).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
// keep the trainer card's numbers fresh while it's on screen
document.addEventListener('pdx:dex', debounce(() => { if (document.body.dataset.view === 'community' && $('#cardForm') && !$('#cardForm').contains(document.activeElement)) renderCommunity(); }, 1200));

/* trainer pool is now fetched only when the Social tab is opened (see line ~1062), not on every page load */
paintCloud(); paintInstall();
if (window.PDX_USER) onLogin(window.PDX_USER);   // chat.js may have finished logging in before this file loaded
window.addEventListener('hashchange', handleProfileHash);
window.addEventListener('popstate', handleProfileHash);
setTimeout(() => {
  handleProfileHash();
  const q = new URLSearchParams(location.search).get('view');
  if (q && ['dex', 'dashboard', 'matches', 'list', 'trade', 'community', 'codes', 'suggestions', 'social'].includes(q) && P() && !/^#/.test(location.hash)) P().setView(q, 'replace');
  if (!sb()) { /* chat.js hides itself when the Supabase library is blocked; the extras then show their own notice */ }
}, 600);

/* =====================================================================================================
   SOCIAL TAB — find trainers (search runs only when Enter is pressed) + rich profiles
   ===================================================================================================== */
let socialState = { found: null, qInput: '', qTrainers: '', sort: 'pct', err: '', viewing: null, searching: false, _tok: 0 };
/* Trainers are never listed up-front: type 1+ characters and results appear as you type.
   Every finished search is cached; a longer query that contains a cached (complete) one is filtered locally, so it's instant. */
const SOC_LIMIT = 24, SOC_COLS = 'user_id,username,bio,team,caught,total,pct,shiny,special,show_trade,updated_at,avatar_url,banner_url', POOL_N = 200;
const socCache = new Map(), socSeen = new Set(); let socTimer = 0, socPool = null, socPoolP = null;
/* start downloading every avatar/banner as soon as the rows are known, so the cards paint with their pictures */
function preloadTrainerImgs(rows) {
  for (const r of rows || []) for (const u of [r.avatar_url, r.banner_url]) {
    const s = safeImg(String(u || '').trim()); if (!s || /^data:/i.test(s) || socSeen.has(s)) continue;
    socSeen.add(s); const im = new Image(); im.decoding = 'async'; im.src = s;
  }
}
/* the most-complete trainers are fetched once (with their pictures) so most searches are answered locally and instantly */
function warmSocial() {
  if (socPoolP || !sb()) return socPoolP;
  socPoolP = (async () => {
    const { data, error } = await sb().from('trainer_cards').select(SOC_COLS).eq('is_public', true).order('pct', { ascending: false }).limit(POOL_N);
    if (error || !data) { socPoolP = null; return; }
    socPool = data; preloadTrainerImgs(data);
    // Prefetch badges / clan / pfp / banner so search cards paint complete on first frame
    await loadTrainerExtras(data.map(r => r.user_id));
    if (document.body.dataset.view === 'social' && socialState.qTrainers.trim()) searchTrainers();
  })();
  return socPoolP;
}
const socSortRows = (rows, sort) => { const col = sort === 'shiny' ? 'shiny' : sort === 'caught' ? 'caught' : 'pct'; return rows.slice().sort((a, b) => (b[col] || 0) - (a[col] || 0)); };
const socKey = (q, sort) => sort + '|' + q.toLowerCase();
function socLocal(q, sort) {
  const lq = q.toLowerCase(), hit = socCache.get(socKey(q, sort));
  if (hit) return hit.rows;
  for (const [k, v] of socCache) {            // a complete result for a shorter/contained query is a superset
    if (!k.startsWith(sort + '|') || v.rows.length >= SOC_LIMIT) continue;
    const cq = k.slice(sort.length + 1);
    if (cq && lq.includes(cq)) return v.rows.filter(r => String(r.username).toLowerCase().includes(lq));
  }
  return null;
}
async function searchTrainers() {
  const q = socialState.qTrainers.trim().replace(/[%_\\]/g, '');
  const tok = ++socialState._tok;
  if (q.length < 1) { socialState.found = null; socialState.searching = false; socialState.err = ''; return paintSocialResults(); }
  if (!sb()) { socialState.found = []; socialState.err = 'Online features unavailable.'; return paintSocialResults(); }

  async function paintWithExtras(rows, searching) {
    if (tok !== socialState._tok) return;
    socialState.found = rows;
    socialState.err = '';
    socialState.searching = !!searching;
    // Load badges / clan / pfp / banner BEFORE first paint when missing
    const missing = (rows || []).map(r => r.user_id).filter(id => id && !extraCache.has(id));
    if (missing.length) {
      // Show a brief searching state only if we have nothing yet
      if (!rows.length) paintSocialResults();
      await loadTrainerExtras(missing);
      if (tok !== socialState._tok) return;
    }
    preloadTrainerImgs(rows);
    paintSocialResults();
  }

  const local = socLocal(q, socialState.sort);
  if (local) { await paintWithExtras(local, false); return; }
  if (socPool) {
    const pm = socSortRows(socPool.filter(r => String(r.username).toLowerCase().includes(q.toLowerCase())), socialState.sort);
    const complete = socPool.length < POOL_N;
    if (pm.length || complete) {
      if (complete) socCache.set(socKey(q, socialState.sort), { rows: pm });
      await paintWithExtras(pm, !complete);
      if (complete) return;
    }
  }
  socialState.searching = true; if (!socialState.found) paintSocialResults();
  const col = socialState.sort === 'shiny' ? 'shiny' : socialState.sort === 'caught' ? 'caught' : 'pct';
  const { data, error } = await sb().from('trainer_cards').select(SOC_COLS)
    .eq('is_public', true).ilike('username', '%' + q + '%').order(col, { ascending: false }).limit(SOC_LIMIT);
  if (tok !== socialState._tok) return;
  if (error) { socialState.err = error.message; socialState.searching = false; socialState.found = socialState.found || []; return paintSocialResults(); }
  socialState.found = data || [];
  socialState.searching = false;
  socialState.err = '';
  socCache.set(socKey(q, socialState.sort), { rows: socialState.found });
  await paintWithExtras(socialState.found, false);
}
async function publishMyLists() {
  if (!user || !sb() || !P()) return toast('Log in first.');
  const p = P();
  if (!p.trade.want.length && !p.trade.offer.length) return toast('Add some Pokémon to For Trade or Looking For first.');
  const res = await saveCard({ is_public: true, show_trade: true, trade: p.trade });
  if (res && res.error) return toast(res.error.message || 'Could not publish.');
  toast('Your trade lists are now public.');
  if (typeof findMatches === 'function') findMatches(true);
  if (document.body.dataset.view === 'social') renderSocial();
}
function socCardHtml(r) {
  const ex0 = extraCache.get(r.user_id) || {}, tc = TEAMS[r.team] ? TEAMS[r.team][2] : '#6366f1';
  const ex = { ...ex0, avatar: safeImg(String(r.avatar_url || '').trim()) || ex0.avatar, banner: safeImg(String(r.banner_url || '').trim()) || ex0.banner };
  const badges = (ex.badges || []).slice(0, 4), extra = (ex.badges || []).length - badges.length;
  const bio = r.bio ? esc(r.bio.slice(0, 90)) + (r.bio.length > 90 ? '…' : '') : '';
  return `<div class="socCard" data-u="${esc(r.username)}" tabindex="0" role="link" aria-label="Open ${esc(r.username)}'s profile" style="--tc:${tc}">
    <div class="socBanner">${ex.banner ? `<img src="${esc(ex.banner)}" alt="" loading="eager" decoding="async" draggable="false">` : ''}</div>
    <div class="socAvWrap">${avatarHtml(ex.avatar, r.team, 'socAv')}${TEAMS[r.team] ? `<span class="socTeam" title="${TEAMS[r.team][1]}">${TEAMS[r.team][0]}</span>` : ''}</div>
    <div class="socBody">
      <div class="socName">${badges.map(badgeIcon).join('')}${extra > 0 ? `<span class="sbmore">+${extra}</span>` : ''}<b ${ex.nameColor ? `style="color:${esc(ex.nameColor)}"` : ''}>${esc(r.username)}</b>${clanTag(ex.clan)}</div>
      <div class="socStatRow"><span class="socPct">${Number(r.pct || 0).toFixed(1)}%</span><span class="socMeta">${fmtNum(r.caught)} registered · ${fmtNum(r.shiny)} shiny</span></div>
      <div class="socBar"><i style="width:${Math.min(100, Number(r.pct) || 0)}%"></i></div>
      ${bio ? `<div class="socBio">${bio}</div>` : ''}
      <div class="socFoot"><span class="socTag ${r.show_trade ? 'on' : ''}">${r.show_trade ? 'Public trades' : 'Private lists'}</span>${TEAMS[r.team] ? `<span class="socTag">${TEAMS[r.team][1]}</span>` : ''}</div>
    </div></div>`;
}
function paintSocialResults() {
  const box = $('#socResults'); if (!box) return;
  const q = socialState.qTrainers.trim();
  if (socialState.searching && !socialState.found) { box.innerHTML = '<div class="empty small"><i class="spin"></i> Searching trainers…</div>'; return; }
  if (socialState.err) { box.innerHTML = `<div class="empty small">${esc(socialState.err)}</div>`; return; }
  if (q.length < 1) { box.innerHTML = `<div class="empty small socPrompt">🔎 Search for a trainer by username.<br><span class="muted">Press Enter to search.</span></div>`; return; }
  const rows = socialState.found || [];
  box.innerHTML = rows.length
    ? `<div class="socGrid">${rows.map(socCardHtml).join('')}</div>`
    : `<div class="empty small">No trainers found for “${esc(q)}”. Only trainers with a public profile can be found.</div>`;
  box.querySelectorAll('.socCard').forEach(el => {
    el.onclick = () => openProfile(el.dataset.u);
    el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfile(el.dataset.u); } };
  });
}

/* ---- Events ---- */
function fmtEventWhen(start, end) {
  try {
    if (!start && !end) return 'Dates TBA';
    const opts = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    if (!start) return 'Until ' + new Date(end).toLocaleString(undefined, opts);
    const s = new Date(start);
    if (isNaN(s.getTime())) return String(start);
    const a = s.toLocaleString(undefined, opts);
    if (!end) return a;
    const e = new Date(end);
    if (isNaN(e.getTime())) return a;
    const sameDay = s.toDateString() === e.toDateString();
    if (sameDay) return a + ' – ' + e.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return a + ' → ' + e.toLocaleString(undefined, opts);
  } catch { return String(start || end || 'Dates TBA'); }
}

/* #49 Follower feed of public updates */
async function loadFollowerFeed(force) {
  const box = $('#socFeed'); if (!box) return;
  if (!user || !sb()) {
    box.innerHTML = '<div class="empty small">Log in to see updates from people you follow.</div>';
    return;
  }
  if (!force && box.dataset.loaded === '1') return;
  box.innerHTML = '<div class="empty small"><i class="spin"></i></div>';
  try {
    const { data: fol, error: fe } = await sb().from('follows').select('following_id').eq('follower_id', user.id).limit(100);
    if (fe) { box.innerHTML = `<div class="empty small">${esc(fe.message)}</div>`; return; }
    const ids = (fol || []).map(r => r.following_id).filter(Boolean);
    if (!ids.length) {
      box.innerHTML = '<div class="empty small">Follow trainers to fill this feed. Open a profile and tap Follow.</div>';
      box.dataset.loaded = '1';
      return;
    }
    // Prefer activity_events when available
    let rows = [];
    const { data: acts, error: ae } = await sb().from('activity_events').select('id,user_id,username,kind,title,body,url,created_at').in('user_id', ids).order('created_at', { ascending: false }).limit(40);
    if (!ae && acts && acts.length) {
      rows = acts.map(a => ({
        username: a.username,
        title: a.title || a.kind,
        body: a.body || '',
        when: a.created_at,
        url: a.url || ('/u/' + encodeURIComponent(a.username))
      }));
    } else {
      const { data: cards, error: ce } = await sb().from('trainer_cards').select('user_id,username,pct,shiny,caught,updated_at,bio').in('user_id', ids).eq('is_public', true).order('updated_at', { ascending: false }).limit(40);
      if (ce) { box.innerHTML = `<div class="empty small">${esc(ce.message)}</div>`; return; }
      rows = (cards || []).map(c => ({
        username: c.username,
        title: 'Updated their trainer card',
        body: `${c.caught || 0} registered · ${Number(c.pct || 0).toFixed(1)}% · ${c.shiny || 0} shiny` + (c.bio ? ' · ' + c.bio.slice(0, 80) : ''),
        when: c.updated_at,
        url: '/u/' + encodeURIComponent(c.username)
      }));
    }
    if (!rows.length) {
      box.innerHTML = '<div class="empty small">No recent updates from people you follow.</div>';
    } else {
      box.innerHTML = rows.map(r => `<button type="button" class="fnrow" data-feed-u="${esc(r.username)}">
        <span class="fnicon">📰</span>
        <span class="fntxt"><b>${esc(r.username)}</b><small>${esc(r.title)}${r.body ? ' — ' + esc(r.body) : ''}</small></span>
        <span class="fntime">${r.when ? ago(r.when) : ''}</span>
      </button>`).join('');
      box.querySelectorAll('[data-feed-u]').forEach(btn => {
        btn.onclick = () => openProfile(btn.dataset.feedU);
      });
    }
    box.dataset.loaded = '1';
  } catch (e) {
    box.innerHTML = `<div class="empty small">${esc(e.message || 'Feed unavailable')}</div>`;
  }
}
async function postActivity(kind, title, body, url) {
  if (!user || !sb()) return;
  try {
    await sb().from('activity_events').insert({
      user_id: user.id,
      username: user.username || '',
      kind: String(kind || 'update').slice(0, 40),
      title: String(title || '').slice(0, 120),
      body: String(body || '').slice(0, 300),
      url: String(url || '').slice(0, 300)
    });
  } catch {}
}

function renderSocial() {
  const v = $('#socialView'); if (!v) return;
  if (socialState.viewing) {
    if (socialState._opening) return;
    if (!v.querySelector('.profileHolder')) return void openProfile(socialState.viewing);
    return;
  }
  const myPublished = myCard && myCard.show_trade;
  v.innerHTML = `<div class="panel"><div class="xhead"><div><b>🌐 Social</b><div class="muted">Find trainers, follow people, and see updates from accounts you follow.</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button class="xbtn ${myPublished ? '' : 'primary'}" type="button" id="socPublish">${myPublished ? '✓ Lists published' : '📢 Publish my lists'}</button>
      <button class="xbtn" type="button" id="socRefresh">Refresh</button>
    </div></div>
    <div class="panel" id="socFeedPanel"><div class="xhead"><div><b>📰 Following feed</b><div class="muted">Recent public activity from trainers you follow.</div></div>
      <button class="xbtn" type="button" id="socFeedRefresh">Refresh feed</button></div>
      <div id="socFeed"><div class="empty small"><i class="spin"></i></div></div></div>
    <div class="socSearchRow">
      <input id="socSearch" type="search" enterkeyhint="search" placeholder="Search trainers by username…" value="${esc(socialState.qInput)}" autocomplete="off" aria-label="Search trainers by username">
      <select id="socSort" title="Sort results"><option value="pct" ${socialState.sort === 'pct' ? 'selected' : ''}>Completion</option><option value="caught" ${socialState.sort === 'caught' ? 'selected' : ''}>Registered</option><option value="shiny" ${socialState.sort === 'shiny' ? 'selected' : ''}>Shinies</option></select>
    </div>
    <div id="socResults"></div></div>`;
  const search = $('#socSearch');
  const run = () => { socialState.qTrainers = search.value; searchTrainers(); };
  // Keep the typed text in state, but only search when Enter is pressed
  search.oninput = () => { socialState.qInput = search.value; };
  search.onkeydown = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(socTimer);
    run();
  };
  if (!('ontouchstart' in window)) search.focus();
  $('#socSort').onchange = e => { socialState.sort = e.target.value; if (socialState.qTrainers.trim()) searchTrainers(); };
  $('#socRefresh').onclick = () => { if (socialState.qTrainers.trim()) { extraCache.clear(); socCache.clear(); searchTrainers(); } else toast('Type a username to search.'); };
  $('#socPublish').onclick = publishMyLists;
  const fr = $('#socFeedRefresh'); if (fr) fr.onclick = () => loadFollowerFeed(true);
  paintSocialResults();
  loadFollowerFeed(false);
}

/* =====================================================================================================
   TRADE LIST IMPORT / EXPORT + STALE LIST SUGGESTION
   ===================================================================================================== */
function ensureTradeTools() {
  const bar = $('#tradeView .tradebar .tradebtns'); if (!bar || $('#tExportJson')) return;
  const pub = document.createElement('button'); pub.id = 'tPublish'; pub.type = 'button'; pub.className = 'primary'; pub.textContent = '📢 Publish to Social';
  const exp = document.createElement('button'); exp.id = 'tExportJson'; exp.type = 'button'; exp.textContent = 'Export JSON';
  const imp = document.createElement('button'); imp.id = 'tImportJson'; imp.type = 'button'; imp.textContent = 'Import JSON';
  bar.prepend(pub);
  bar.append(exp, imp);
  pub.onclick = publishMyLists;
  exp.onclick = () => {
    const p = P(); if (!p) return;
    const blob = new Blob([JSON.stringify({ want: p.trade.want, offer: p.trade.offer, exported: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'go-dex-trade-lists.json'; a.click();
    toast('Trade lists exported.');
  };
  imp.onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        const p = P(); if (!p) return;
        if (Array.isArray(data.want)) p.trade.want = data.want;
        if (Array.isArray(data.offer)) p.trade.offer = data.offer;
        if (p.saveTrade) p.saveTrade();
        else if (p.renderTrade) p.renderTrade();
        toast('Trade lists imported.');
        paintMatches();
      } catch { toast('Invalid JSON file.'); }
    };
    inp.click();
  };
  // Stale list suggestion
  try {
    const last = store.get('pdx.tradeUpdated');
    const days = last ? (Date.now() - +last) / 864e5 : 999;
    if (days > 21 && P() && (P().trade.want.length || P().trade.offer.length)) {
      let hint = $('#staleHint');
      if (!hint) {
        hint = document.createElement('div'); hint.id = 'staleHint'; hint.className = 'panel'; hint.style.cssText = 'margin:10px 0;padding:12px 14px;border-color:#f59e0b55;background:#1a1508';
        hint.innerHTML = `<b>🧹 Stale lists?</b> <span class="muted">Your trade lists haven’t been updated in a while. Clear them or refresh the Pokémon you’re still hunting.</span>
          <div style="margin-top:8px;display:flex;gap:8px"><button class="xbtn" type="button" id="staleDismiss">Dismiss</button><button class="xbtn" type="button" id="tClear">Clear lists</button></div>`;
        const cols = $('#tradeView .tdashhead'); if (cols) cols.before(hint);
        $('#staleDismiss') && ($('#staleDismiss').onclick = () => { store.set('pdx.tradeUpdated', Date.now()); hint.remove(); });
      }
    }
  } catch {}
}
// Touch the timestamp whenever trade lists change
document.addEventListener('pdx:dex', () => { try { if (P() && P().trade) store.set('pdx.tradeUpdated', Date.now()); } catch {} });
})();

/* Seasonal site themes + living background intensity */
(function seasonalAndLiving() {
  const m = new Date().getMonth() + 1;
  let season = '';
  if (m === 10) season = 'halloween';
  else if (m === 12 || m === 1 || m === 2) season = 'winter';
  else if (m >= 3 && m <= 5) season = 'spring';
  else if (m >= 6 && m <= 8) season = 'summer';
  if (season) document.body.classList.add('season-' + season);

  function updateLiving() {
    try {
      const p = P(); if (!p) return;
      const st = p.stats ? p.stats() : null;
      // fallback: read the percent element
      const pctEl = document.querySelector('#percent');
      const pct = st && st.pct != null ? st.pct : (pctEl ? parseFloat(pctEl.textContent) : 0);
      document.documentElement.style.setProperty('--dex-glow', Math.min(1, (pct || 0) / 100).toFixed(3));
    } catch {}
  }
  document.addEventListener('pdx:dex', updateLiving);
  setTimeout(updateLiving, 1500);
})();
