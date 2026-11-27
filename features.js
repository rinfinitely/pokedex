/* features.js — badges (milestone + custom), trade cost calculator, match alerts, 🔔 inbox + push notifications,
   event auto-fill extras, admin Insights (analytics, moderation, badge manager, settings) and the donation goal bar.
   Needs supabase/features.sql (run after setup.sql). Everything shows a "run features.sql" notice instead of breaking if it isn't set up.
   Uses the same Supabase session as chat.js (window.PDX_SB) and the tracker bridge app.js exposes (window.PDX). */
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
const fmtNum = n => Number(n || 0).toLocaleString();
const debounce = (fn, ms) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const tableMissing = e => !!e && /42P01|PGRST205|PGRST204|PGRST202|does not exist|schema cache|Could not find the function/i.test((e.code || '') + ' ' + (e.message || ''));
const HINT = 'This feature isn’t switched on yet. Run supabase/features.sql in the Supabase SQL Editor.';
const errText = e => tableMissing(e) ? HINT : (e && e.message) || 'Something went wrong.';
const SKEL = (n = 8, cls = '') => `<div class="skelgrid ${cls}" aria-busy="true">${'<i class="skel"></i>'.repeat(n)}</div>`;
const okUrl = u => /^https:\/\//i.test(u || '');
const okImg = u => /^https:\/\//i.test(u || '') || /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(u || '');
const ago = t => { const s = Math.max(0, (Date.now() - new Date(t)) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };
let user = null;   // { id, username, is_admin }

/* ---------- toast + modal (own copies so this file stands alone) ---------- */
let toastBox;
function toast(msg, ms = 4600) {
  if (!toastBox) { toastBox = $('#xToast'); }
  if (!toastBox) { toastBox = document.createElement('div'); toastBox.id = 'xToast'; toastBox.setAttribute('role', 'status'); toastBox.setAttribute('aria-live', 'polite'); document.body.append(toastBox); }
  const t = document.createElement('div'); t.className = 'xtoastmsg'; t.textContent = msg; toastBox.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}
function modal(html, cls = '') {
  closeModal();
  const back = document.createElement('div'); back.className = 'xmodalback'; back.id = 'fModal';
  back.innerHTML = `<div class="xmodal ${cls}" role="dialog" aria-modal="true"><button class="xclose" type="button" aria-label="Close">✕</button>${html}</div>`;
  back.addEventListener('mousedown', e => { if (e.target === back) closeModal(); });
  back.querySelector('.xclose').onclick = closeModal;
  document.body.append(back); document.addEventListener('keydown', escClose);
  return back.querySelector('.xmodal');
}
const escClose = e => { if (e.key === 'Escape') closeModal(); };
function closeModal() { const m = $('#fModal'); if (m) m.remove(); document.removeEventListener('keydown', escClose); }
const loginNote = what => `<div class="empty small">Log in (chat panel) to ${esc(what)}.</div>`;
const needSetup = () => `<div class="empty small">${esc(HINT)}</div>`;

/* ---------- nav buttons + view containers ---------- */
function ensureShell() {
  const bar = $('#viewbar'), main = $('main.wrap'); if (!bar || !main) return;
  const tools = $('.viewtools', bar);
  const add = (id, view, label, hidden) => {
    if ($('#' + id)) return;
    const b = document.createElement('button'); b.className = 'viewbtn'; b.id = id; b.type = 'button'; b.dataset.view = view; b.textContent = label; if (hidden) b.hidden = true;
    // Keep Admin as the last tab (before viewtools)
    const adminBtn = $('#adminTabBtn');
    const before = adminBtn || tools || null;
    bar.insertBefore(b, before);
  };
  add('badgesTabBtn', 'badges', '🏅 Badges');
  // badgesView is a normal main tab; insightsView is only used as a render host inside Admin
  if (!$('#badgesView')) { const d = document.createElement('div'); d.id = 'badgesView'; d.className = 'fonly'; main.append(d); }
  if (!$('#insightsView')) { const d = document.createElement('div'); d.id = 'insightsView'; d.className = 'fonly'; d.hidden = true; main.append(d); }
  if (!$('#fBell')) {
    const hdr = $('header'), b = document.createElement('button'); b.id = 'fBell'; b.type = 'button'; b.className = 'fbell'; b.title = 'Notifications'; b.setAttribute('aria-label', 'Notifications');
    b.innerHTML = '🔔<span class="fdot" hidden>0</span>'; b.hidden = true;
    const anchor = $('#donateBtn') || $('#installBtn'); if (hdr) hdr.insertBefore(b, anchor || null);
  }
}
const isAdmin = () => !!(user && user.is_admin);
const isMod = () => !!(user && (user.is_admin || user.is_mod));
const isStaff = isMod;
const paintAdminTab = () => {
  // Hide any leftover Insights main-tab button
  const ib = $('#insightsTabBtn'); if (ib) ib.hidden = true;
  document.body.classList.toggle('isadmin', isAdmin());
  document.body.classList.toggle('ismod', isMod() && !isAdmin());
  const bell = $('#fBell'); if (bell) bell.hidden = !user;
  if (!isMod() && document.body.dataset.view === 'insights' && P() && P().setView) P().setView('dex');
};

/* =====================================================================================================
   1. BADGES
   ===================================================================================================== */
const B = { defs: null, mine: new Map(), err: '', filter: 'all', hasCode: false, busy: false };
const METRIC = {
  caught: ['Registered species', n => `Register ${fmtNum(n)} species`],
  pct: ['Completion %', n => `Reach ${n}% Pokédex completion`],
  shiny: ['Shiny registered', n => `Register ${fmtNum(n)} shiny Pokémon`],
  special: ['Special registrations', n => `Register ${fmtNum(n)} special forms / costumes`],
  trade_items: ['Trade-list Pokémon', n => `List ${fmtNum(n)} Pokémon in your trade lists`],
  friend_code: ['Friend code posted', () => 'Post your friend code on the Friend codes board']
};
const reqText = b => b.kind === 'milestone' && METRIC[b.metric] ? METRIC[b.metric][1](Number(b.threshold)) : (b.source === 'patreon' ? 'Patreon supporter' + (b.tier ? ' · ' + b.tier : '') : 'Awarded by the admins');
function metrics() {
  const p = P(); if (!p) return {};
  const s = p.summary(), t = p.trade || { want: [], offer: [] };
  return { caught: s.caught, pct: s.pct, shiny: s.shiny, special: s.special, trade_items: t.want.length + t.offer.length, friend_code: B.hasCode ? 1 : 0 };
}
const valueOf = b => (metrics()[b.metric]) || 0;
function badgeIcon(b, px = 64, locked = false) {
  const url = okImg(b.image_url) ? b.image_url : '';
  return `<span class="fbicon ${locked ? 'locked' : ''}" style="--bc:${esc(b.color || '#f4c96b')};width:${px}px;height:${px}px;font-size:${Math.round(px * .5)}px">${url ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : `<b>${esc(b.emoji || '🏅')}</b>`}</span>`;
}
async function loadBadges(force) {
  if (!sb()) { B.err = 'The online features could not load.'; B.defs = []; return; }
  if (!force && B.defs && !B.err) return;
  const [d, m] = await Promise.all([
    sb().from('badges').select('*').order('sort').order('id'),
    user ? sb().from('user_badges').select('badge_id,awarded_at').eq('user_id', user.id) : Promise.resolve({ data: [] })
  ]);
  B.err = d.error ? errText(d.error) : ''; B.defs = d.data || [];
  B.mine = new Map((m.data || []).map(r => [r.badge_id, r.awarded_at]));
  if (user) { const r = await sb().from('friend_codes').select('user_id', { count: 'exact', head: true }).eq('user_id', user.id); B.hasCode = !r.error && (r.count || 0) > 0; }
}
async function checkMilestones() {
  if (!user || !sb() || B.busy || !B.defs || B.err || !P() || !P().pokemon.length) return;
  const m = metrics();
  const fresh = B.defs.filter(b => b.kind === 'milestone' && !B.mine.has(b.id) && (m[b.metric] || 0) >= Number(b.threshold));
  if (!fresh.length) return;
  B.busy = true;
  try {
    const { error } = await sb().from('user_badges').upsert(fresh.map(b => ({ user_id: user.id, badge_id: b.id })), { onConflict: 'user_id,badge_id', ignoreDuplicates: true });
    if (error) { if (!tableMissing(error)) console.warn('[badges]', error.message); return; }
    const now = new Date().toISOString(); fresh.forEach(b => B.mine.set(b.id, now));
    fresh.slice(0, 3).forEach(b => toast(`🏅 Badge earned: ${b.name}!`, 6500));
    if (fresh.length > 3) toast(`…and ${fresh.length - 3} more badges. See the Badges tab.`, 6500);
    sb().from('notifications').upsert(fresh.map(b => ({ user_id: user.id, kind: 'badge', title: 'Badge earned: ' + b.name, body: b.description || '', url: '?view=badges', dedupe_key: 'badge:' + b.id })), { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }).then(() => loadNotifs());
    if (document.body.dataset.view === 'badges') renderBadges();
  } finally { B.busy = false; }
}
const schedMilestones = debounce(checkMilestones, 2500);
document.addEventListener('pdx:dex', schedMilestones);

function renderBadges() {
  const v = $('#badgesView'); if (!v) return;
  if (!B.defs) { v.innerHTML = `<div class="panel">${SKEL(12, 'badges')}</div>`; loadBadges(true).then(() => { renderBadges(); checkMilestones(); }); return; }
  if (B.err) { v.innerHTML = `<div class="panel"><div class="empty small">${esc(B.err)}</div></div>`; return; }
  const earned = B.defs.filter(b => B.mine.has(b.id)).length;
  const visible = B.defs.filter(b => !b.secret || B.mine.has(b.id));
  const list = visible.filter(b => B.filter === 'all' || (B.filter === 'earned') === B.mine.has(b.id));
  const card = b => {
    const got = B.mine.has(b.id), ms = b.kind === 'milestone', val = ms ? valueOf(b) : 0, need = Number(b.threshold) || 1, pct = got ? 100 : Math.min(100, val / need * 100);
    return `<button type="button" class="fbadge ${got ? 'got' : ''}" data-badge="${b.id}">${badgeIcon(b, 72, !got)}<b class="fbname">${esc(b.name)}</b>
      <small>${esc(b.description || reqText(b))}</small>
      ${ms ? `<span class="fbprog"><i style="width:${pct.toFixed(1)}%"></i></span><small class="fbnum">${got ? '✓ Earned' : (b.metric === 'friend_code' ? 'Not yet' : `${fmtNum(Math.floor(val * 10) / 10)} / ${fmtNum(need)}`)}</small>` : `<small class="fbnum">${got ? '✓ Earned' : 'Custom badge'}</small>`}</button>`;
  };
  v.innerHTML = `<div class="panel"><div class="xhead"><div><b>🏅 Badges</b><div class="muted">${user ? `You’ve earned <b>${earned}</b> of ${visible.length} badges.` : 'Your progress is shown from this device. Log in (chat panel) to keep the badges you earn.'}</div></div>
    ${isAdmin() ? '<button class="xbtn primary" type="button" id="fbNewTab">＋ New custom badge</button>' : ''}<div class="xseg" id="fbFilter">${[['all', 'All'], ['earned', 'Earned'], ['locked', 'Locked']].map(([k, n]) => `<button type="button" data-f="${k}" class="${B.filter === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
    ${list.length ? `<div class="fbgrid">${list.map(card).join('')}</div>` : '<div class="empty small">Nothing to show here yet.</div>'}</div>`;
}
document.addEventListener('click', async e => {
  const f = e.target.closest && e.target.closest('#fbFilter [data-f]'); if (f) { B.filter = f.dataset.f; return renderBadges(); }
  const c = e.target.closest && e.target.closest('[data-badge]'); if (!c) return;
  const b = (B.defs || []).find(x => String(x.id) === c.dataset.badge); if (!b) return;
  const got = B.mine.get(b.id), ms = b.kind === 'milestone', val = ms ? valueOf(b) : 0, need = Number(b.threshold) || 1;
  const m = modal(`<div class="fbmodal">${badgeIcon(b, 120, !got)}<h2>${esc(b.name)}</h2><p>${esc(b.description)}</p>
    <div class="xcardstats"><div><small>How to earn</small><b class="fsmall">${esc(reqText(b))}</b></div>${ms && b.metric !== 'friend_code' ? `<div><small>Your progress</small><b>${fmtNum(Math.floor(val * 10) / 10)} / ${fmtNum(need)}</b></div>` : ''}
    <div><small>Status</small><b class="fsmall">${got ? '✓ Earned ' + new Date(got).toLocaleDateString() : '🔒 Locked'}</b></div>
    <div><small>Trainers with it</small><b id="fbHolders">…</b></div>
    <div><small>Rarity</small><b id="fbRarity">…</b></div></div></div>`);
  const [r, tot] = await Promise.all([
    sb().from('user_badges').select('user_id', { count: 'exact', head: true }).eq('badge_id', b.id),
    sb().from('trainer_cards').select('user_id', { count: 'exact', head: true }).eq('is_public', true)
  ]);
  const h = $('#fbHolders', m); if (h) h.textContent = r.error ? '—' : fmtNum(r.count);
  const rar = $('#fbRarity', m);
  if (rar) {
    if (r.error || tot.error || !tot.count) { rar.textContent = '—'; }
    else {
      const pct = Math.max(0, Math.min(100, (r.count / tot.count) * 100));
      let label = 'Common';
      if (pct < 1) label = 'Legendary';
      else if (pct < 5) label = 'Ultra rare';
      else if (pct < 15) label = 'Rare';
      else if (pct < 40) label = 'Uncommon';
      rar.textContent = `${pct < 0.1 && r.count > 0 ? '<0.1' : pct.toFixed(pct < 10 ? 1 : 0)}% · ${label}`;
    }
  }
});

/* badges on other trainers' profiles + report button (extras.js fires pdx:profile) */
document.addEventListener('pdx:profile', async e => {
  const { user_id, username, el, hide_badges } = e.detail || {}; if (!el || !sb()) return;
  if (hide_badges) {
    const pane = $('#spBadges', el);
    if (pane) pane.innerHTML = '<div class="empty small">Badges are hidden on this profile.</div>';
    return;
  }
  const { data, error } = await sb().from('user_badges').select('awarded_at,badges(id,name,image_url,emoji,color,sort,secret)').eq('user_id', user_id).order('awarded_at');
  if (!el.isConnected) return;
  const rows = (!error && data) ? data.filter(r => r.badges).sort((a, b) => (a.badges.sort || 0) - (b.badges.sort || 0)) : [];
  const pane = $('#spBadges', el);
  if (pane) {
    pane.innerHTML = rows.length
      ? `<div class="fbstrip"><div>${rows.map(r => `<span title="${esc(r.badges.name)}">${badgeIcon(r.badges, 48)}</span>`).join('')}</div></div>`
      : '<div class="empty small">No badges yet.</div>';
  }
  if (rows.length && !$('.fbstrip', el)) {
    const strip = `<div class="fbstrip"><small>🏅 ${rows.length} badge${rows.length === 1 ? '' : 's'}</small><div>${rows.map(r => `<span title="${esc(r.badges.name)}">${badgeIcon(r.badges, 38)}</span>`).join('')}</div></div>`;
    const anchor = $('.xcardstats', el); if (anchor) anchor.insertAdjacentHTML('beforebegin', strip);
  }
});

/* =====================================================================================================
   2. DONATION GOAL BAR
   ===================================================================================================== */
let goal = null;
let goalChan = null;
async function loadGoal() {
  if (!sb()) return;
  const { data } = await sb().from('site_settings').select('value').eq('key', 'donation_goal').maybeSingle();
  goal = data && data.value ? data.value : null; paintGoal(); listenGoal();
}
/* the bar follows the database live: when the patreon-sync function writes a new total, every open page updates by itself */
function listenGoal() {
  if (goalChan || !sb()) return;
  try {
    goalChan = sb().channel('goal-live').on('postgres_changes', { event: '*', schema: 'public', table: 'site_settings', filter: 'key=eq.donation_goal' }, p => {
      if (p.new && p.new.value) { goal = p.new.value; paintGoal(); }
    }).subscribe();
  } catch {}
}
setInterval(() => { if (!document.hidden) loadGoal(); }, 5 * 60e3);   // safety net in case the live connection drops
function paintGoal() {
  let el = $('#goalBar');
  if (!goal || !goal.enabled || !(Number(goal.goal) > 0)) { if (el) el.remove(); return; }
  const cur = Math.max(0, Number(goal.current) || 0), tot = Number(goal.goal), pct = Math.min(100, cur / tot * 100), cc = esc(goal.currency || '$');
  const href = okUrl(goal.url) ? goal.url : ($('#donateBtn') ? $('#donateBtn').href : '#');
  if (!el) { el = document.createElement('div'); el.id = 'goalBar'; el.className = 'fgoalwrap'; const vb = $('#viewbar'); if (vb) vb.before(el); }
  else { const vb = $('#viewbar'); if (vb && el.nextElementSibling !== vb) vb.before(el); }
  el.innerHTML = `<a class="fgoal" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(goal.note || 'Help cover hosting costs')}"><span class="fgtitle">🎯 ${esc(goal.title || 'Donation goal')}</span>
    <span class="fgbar" role="progressbar" aria-valuemin="0" aria-valuemax="${tot}" aria-valuenow="${cur}"><i style="width:${pct.toFixed(1)}%"></i></span>
    <span class="fgnum">${cc}${fmtNum(cur)} / ${cc}${fmtNum(tot)} · ${Math.floor(pct)}%</span><span class="fgcta">${pct >= 100 ? '🎉 Goal reached — thank you!' : 'Chip in ☕'}</span></a>`;
}

/* =====================================================================================================
   3. TRADE COST CALCULATOR (Trading tab)
   Costs follow the community-published Stardust chart: a regular Pokémon both trainers already have = 100;
   a "special" trade (shiny / legendary / purified / special background) or one new to a Pokédex = 20,000 at Good Friends;
   special AND new = 1,000,000 at Good Friends. Great / Ultra / Best Friends pay 80% / 8% / 4% of those.
   The in-game trade screen shows the exact price, so this is labelled an estimate. Edit the numbers here if Niantic changes them.
   ===================================================================================================== */
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
let nameMap = null;
function species(q) {
  const p = P(); if (!p || !p.pokemon.length) return null; q = String(q || '').trim(); if (!q) return null;
  if (!nameMap) nameMap = new Map(p.pokemon.map(x => [norm(x.name), x]));
  const num = /^#?(\d{1,4})$/.exec(q); if (num) return p.pokemon[+num[1] - 1] || null;
  return nameMap.get(norm(q)) || null;
}
const registered = id => { const p = P(); const d = p && (p.data[id] || p.data[String(id)]); return !!(d && d.caught); };
function ensureCalc() {
  const bar = $('#tradeView .tradebar'); if (!bar || $('#fCalc')) return;
  const box = document.createElement('div'); box.id = 'fCalc'; box.className = 'panel fcalc';
  box.innerHTML = `<div class="xhead"><div><b>💫 Trading costs</b><div class="muted">Stardust cost by friendship level (each trainer pays this). Tap chart to enlarge.</div></div></div>
    <div class="fcchart"><button type="button" class="fczoom" data-zoom="trade" title="Click to enlarge" aria-label="Enlarge the trading cost chart"><img src="/trade-cost-chart.png?v=2" width="1136" height="1064" loading="lazy" decoding="async" alt="Pokémon GO trading costs chart"><span class="fczoomhint">🔍 Tap to enlarge</span></button></div>`;
  bar.before(box);
}

document.addEventListener('click', e => {
  if (!e.target.closest('[data-zoom="trade"]')) return;
  const m = modal('<img class="fczoomimg" src="/trade-cost-chart.png?v=2" alt="Pokémon GO trading costs chart">', 'fzoom');
  if (m) m.addEventListener('click', () => closeModal());
});

/* =====================================================================================================
   4. MATCH ALERTS (Trading tab) — finds new two-way (or any) matches in the background and tells you
   ===================================================================================================== */
const cleanTrade = t => { const f = a => (Array.isArray(a) ? a : []).map(x => ({ id: +(x && x.id), v: String((x && x.v) || 'normal').slice(0, 20), k: x && x.k ? String(x.k).slice(0, 200) : undefined, qty: Math.max(1, Math.min(999, +(x && x.qty) || 1)) })).filter(x => x.id >= 1 && x.id <= 1025); return { want: f(t && t.want), offer: f(t && t.offer) }; };
const VLAB = { shiny: 'Shiny', shadow: 'Shadow', purified: 'Purified', lucky: 'Lucky', mega: 'Mega', dynamax: 'Dynamax', gigantamax: 'Gigantamax', xxl: 'XXL', xxs: 'XXS', costume: 'Costume', background: 'Background' };
const itemName = it => ((VLAB[it.v] || '') + ' ' + (P() ? P().tName(it) : '#' + it.id)).trim();
const MS = { on: store.json('pdx.fmatch', { on: true, mode: 'two' }).on !== false, mode: store.json('pdx.fmatch', { on: true, mode: 'two' }).mode === 'any' ? 'any' : 'two', last: 0, count: null, busy: false };
const saveMS = () => store.set('pdx.fmatch', JSON.stringify({ on: MS.on, mode: MS.mode }));
async function scanMatches(manual) {
  if (!user || !sb() || !P() || !P().pokemon.length || MS.busy) return;
  if (!manual && !MS.on) return;
  const mine = P().trade; if (!mine.want.length && !mine.offer.length) { MS.count = 0; MS.last = Date.now(); return paintMatchPanel(); }
  MS.busy = true; paintMatchPanel();
  try {
    const { data, error } = await sb().from('trainer_cards').select('user_id,username,trade').eq('is_public', true).eq('show_trade', true).order('updated_at', { ascending: false }).limit(500);
    if (error) { if (manual) toast(errText(error)); return; }
    const seen = new Set(store.json('pdx.fseen.' + user.id, [])), found = [];
    for (const r of data || []) {
      if (r.user_id === user.id) continue;
      const t = cleanTrade(r.trade), give = t.offer.filter(x => P().tMatch(mine.want, x)), take = mine.offer.filter(x => P().tMatch(t.want, x));
      const ok = MS.mode === 'two' ? give.length && take.length : give.length || take.length;
      if (ok) found.push({ r, give, take, sig: r.user_id + '|' + give.map(x => x.id + x.v).sort().join(',') + '|' + take.map(x => x.id + x.v).sort().join(',') });
    }
    MS.count = found.length; MS.last = Date.now();
    const fresh = found.filter(m => !seen.has(m.sig));
    if (fresh.length) {
      store.set('pdx.fseen.' + user.id, JSON.stringify([...seen, ...fresh.map(m => m.sig)].slice(-300)));
      fresh.slice(0, 3).forEach(m => {
        const body = (m.give.length ? 'They have: ' + m.give.slice(0, 3).map(itemName).join(', ') : '') + (m.give.length && m.take.length ? ' · ' : '') + (m.take.length ? 'They want: ' + m.take.slice(0, 3).map(itemName).join(', ') : '');
        toast(`🤝 New trade match: ${m.r.username}`, 7000);
        showSystemNotification('🤝 Trade match with ' + m.r.username, body, '?view=trade');
      });
      if (fresh.length > 3) toast(`…and ${fresh.length - 3} more trade matches.`, 6000);
      const week = Math.floor(Date.now() / 6048e5);
      await sb().from('notifications').upsert(fresh.slice(0, 10).map(m => ({ user_id: user.id, kind: 'match', title: 'Trade match with ' + m.r.username, body: (m.give.length ? m.give.length + ' you want' : '') + (m.give.length && m.take.length ? ' · ' : '') + (m.take.length ? m.take.length + ' they want' : ''), url: '?view=trade', dedupe_key: `match:${m.r.user_id}:${week}` })), { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
      loadNotifs();
    } else if (manual) toast(found.length ? 'No new matches since the last check.' : 'No matches right now.');
  } finally { MS.busy = false; paintMatchPanel(); }
}
function ensureMatchPanel() {
  const bar = $('#tradeView .tradebar'); if (!bar) return null;
  let box = $('#fMatchAlerts'); if (box) return box;
  box = document.createElement('div'); box.id = 'fMatchAlerts'; box.className = 'panel fmatchalerts'; bar.before(box);
  box.addEventListener('click', e => { if (e.target.id === 'fmScan') scanMatches(true); if (e.target.id === 'fmPush') openInbox(true); });
  box.addEventListener('change', e => {
    if (e.target.id === 'fmOn') { MS.on = e.target.checked; saveMS(); if (MS.on) scanMatches(true); paintMatchPanel(); }
    if (e.target.id === 'fmMode') { MS.mode = e.target.value; saveMS(); scanMatches(true); }
  });
  return box;
}
function paintMatchPanel() {
  const box = ensureMatchPanel(); if (!box) return;
  if (!user) { box.innerHTML = `<div class="xhead"><div><b>🔔 Match alerts</b><div class="muted">Log in (chat panel) and switch on “Share my trade lists” to get told when someone matches you.</div></div></div>`; return; }
  box.innerHTML = `<div class="xhead"><div><b>🔔 Match alerts</b><div class="muted">${MS.on ? 'Checks every few minutes while the site is open' : 'Alerts are off'} — and by push when the app is closed (set up under 🔔).${MS.last ? ` Last check ${ago(MS.last)}${MS.count != null ? ` · ${MS.count} match${MS.count === 1 ? '' : 'es'}` : ''}.` : ''}</div></div>
    <div class="xactions"><label class="xcheck fmtoggle"><input id="fmOn" type="checkbox" ${MS.on ? 'checked' : ''}> <span>Alerts on</span></label>
    <select id="fmMode" class="fmsel" aria-label="Which matches to alert for"><option value="two" ${MS.mode === 'two' ? 'selected' : ''}>Two-way matches only</option><option value="any" ${MS.mode === 'any' ? 'selected' : ''}>Any overlap</option></select>
    <button class="xbtn" type="button" id="fmScan" ${MS.busy ? 'disabled' : ''}>${MS.busy ? 'Checking…' : 'Check now'}</button><button class="xbtn" type="button" id="fmPush">Push settings</button></div></div>`;
}
setInterval(() => { if (!document.hidden && user && MS.on) scanMatches(false); }, 5 * 60e3);

/* =====================================================================================================
   5. 🔔 INBOX + WEB PUSH
   ===================================================================================================== */
const N = { rows: [], unread: 0, ch: null, loaded: false, err: '' };
const ICON = { match: '🤝', badge: '🏅', event: '📅', live: '🔴', announce: '📣', info: 'ℹ️' };
function paintBell() {
  const dot = $('#fBell .fdot'); if (!dot) return;
  dot.hidden = !N.unread; dot.textContent = N.unread > 99 ? '99+' : N.unread;
}
async function loadNotifs() {
  if (!user || !sb()) return;
  const { data, error } = await sb().from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(40);
  N.err = error ? errText(error) : ''; N.rows = data || []; N.unread = N.rows.filter(r => !r.read).length; N.loaded = true; paintBell();
  if ($('#fInbox')) paintInbox();
}
function listenNotifs() {
  if (!user || !sb() || N.ch) return;
  try {
    N.ch = sb().channel('fnotif-' + user.id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + user.id }, p => {
      const r = p.new; if (!r || N.rows.some(x => x.id === r.id)) return;
      N.rows.unshift(r); N.unread++; paintBell(); if ($('#fInbox')) paintInbox();
      toast(`${ICON[r.kind] || '🔔'} ${r.title}`, 6000);
      if (document.hidden) showSystemNotification(r.title, r.body, r.url);
    }).subscribe();
  } catch (e) { console.warn('[notifications] realtime unavailable', e); }
}
function showSystemNotification(title, body, url) {
  try { if (document.hidden && 'Notification' in window && Notification.permission === 'granted') { const n = new Notification(title, { body: body || '', icon: '/icon-192.png', tag: 'pdx-' + title }); n.onclick = () => { window.focus(); n.close(); goUrl(url); }; } } catch {}
}
function goUrl(u) {
  if (!u) return; closeModal();
  const m = /[?&]view=([a-z]+)/.exec(u); if (m && P()) return void P().setView(m[1]);
  if (okUrl(u)) window.open(u, '_blank', 'noopener');
}
function paintInbox() {
  const box = $('#fInbox'); if (!box) return;
  box.innerHTML = N.err ? `<div class="empty small">${esc(N.err)}</div>` : !N.loaded ? '<div class="empty small"><i class="spin"></i></div>' : !N.rows.length ? '<div class="empty small">Nothing yet. Badges, trade matches and event reminders land here.</div>'
    : N.rows.map(r => `<button type="button" class="fnrow ${r.read ? '' : 'unread'}" data-n="${r.id}"><span class="fnicon">${ICON[r.kind] || '🔔'}</span><span class="fntxt"><b>${esc(r.title)}</b>${r.body ? `<small>${esc(r.body)}</small>` : ''}</span><span class="fntime">${ago(r.created_at)}</span></button>`).join('');
}
const prefsNow = () => store.json('pdx.fpushprefs', { matches: true, announce: true });
const pushOK = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
async function currentSub() { if (!pushOK()) return null; try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch { return null; } }
const b64u = s => { const raw = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map(c => c.charCodeAt(0))); };
async function saveSub(sub) {
  const j = sub.toJSON(), r = await sb().rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', p_prefs: prefsNow() });
  return r.error;
}
async function enablePush() {
  if (!pushOK()) return toast('This browser doesn’t support push notifications.');
  if (isIOS && !standalone()) return toast('On iPhone/iPad, add the site to your Home Screen first, then enable push from the installed app.', 8000);
  const perm = await Notification.requestPermission(); if (perm !== 'granted') return toast('Notifications are blocked. Allow them in your browser’s site settings, then try again.', 7000);
  const { data } = await sb().from('site_settings').select('value').eq('key', 'push').maybeSingle();
  const key = data && data.value && data.value.public_key; if (!key) return toast('Push isn’t configured yet — an admin needs to add the VAPID public key (Insights → Settings).', 8000);
  const reg = await navigator.serviceWorker.ready; let sub = await reg.pushManager.getSubscription();
  try { if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(key) }); }
  catch (e) { try { const old = await reg.pushManager.getSubscription(); if (old) await old.unsubscribe(); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(key) }); } catch (e2) { return toast('Could not turn on push: ' + (e2.message || e2)); } }
  const err = await saveSub(sub); if (err) return toast(errText(err));
  toast('Push notifications are on for this device. 🔔');
}
async function disablePush() {
  const sub = await currentSub(); if (!sub) return;
  const ep = sub.endpoint; try { await sub.unsubscribe(); } catch {} await sb().from('push_subscriptions').delete().eq('endpoint', ep); toast('Push turned off for this device.');
}
async function openInbox(focusPush) {
  if (!user) return toast('Log in first (chat panel).');
  const m = modal(`<h2>🔔 Notifications</h2><div class="xactions"><button class="xbtn" type="button" id="fnRead">Mark all read</button><button class="xbtn" type="button" id="fnClear">Clear all</button></div><div id="fInbox" class="finbox"></div>
    <h3 id="fPushH">Push notifications</h3><div id="fPush" class="fpush"><div class="empty small"><i class="spin"></i></div></div>`, 'finboxmodal');
  paintInbox(); loadNotifs(); paintPush();
  m.addEventListener('click', async e => {
    const row = e.target.closest('[data-n]');
    if (row) { const r = N.rows.find(x => String(x.id) === row.dataset.n); if (r) { if (!r.read) { r.read = true; N.unread = Math.max(0, N.unread - 1); paintBell(); sb().from('notifications').update({ read: true }).eq('id', r.id).then(() => {}); } goUrl(r.url); paintInbox(); } return; }
    if (e.target.id === 'fnRead') { await sb().from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false); N.rows.forEach(r => r.read = true); N.unread = 0; paintBell(); paintInbox(); }
    if (e.target.id === 'fnClear') { await sb().from('notifications').delete().eq('user_id', user.id); N.rows = []; N.unread = 0; paintBell(); paintInbox(); }
    if (e.target.id === 'fpOn') { await enablePush(); paintPush(); }
    if (e.target.id === 'fpOff') { await disablePush(); paintPush(); }
    if (e.target.id === 'fpTest') {
      e.target.disabled = true; const r = await sb().functions.invoke('push-notify', { body: { test: true } }); e.target.disabled = false;
      const d = r.data; toast(r.error ? 'Test failed: ' + (r.error.message || 'is the push-notify function deployed?') : d && d.ok ? (d.sent ? `Sent to ${d.sent} device${d.sent === 1 ? '' : 's'}.` : 'No devices are subscribed yet — turn push on first.') : (d && d.error) || 'Test failed.', 7000);
    }
  });
  m.addEventListener('change', async e => {
    const k = e.target.dataset && e.target.dataset.pref; if (!k) return;
    const p = prefsNow(); p[k] = e.target.checked; store.set('pdx.fpushprefs', JSON.stringify(p));
    const sub = await currentSub(); if (sub) { const err = await saveSub(sub); if (err) toast(errText(err)); else toast('Saved.', 1800); }
  });
  if (focusPush) { const h = $('#fPushH', m); if (h) h.scrollIntoView({ block: 'start' }); }
}
async function paintPush() {
  const box = $('#fPush'); if (!box) return;
  if (!pushOK()) { box.innerHTML = '<div class="empty small">This browser doesn’t support push notifications. The in-app inbox and alerts while the site is open still work.</div>'; return; }
  const sub = await currentSub(), on = !!sub && Notification.permission === 'granted', p = prefsNow();
  if (!$('#fPush')) return;
  box.innerHTML = `<p class="muted">${on ? 'Push is <b>on</b> for this device.' : 'Get trade matches and announcements even when the site is closed.'}${isIOS && !standalone() ? ' <b>iPhone/iPad:</b> add the site to your Home Screen first, then enable push from the installed app.' : ''}</p>
    <div class="xactions">${on ? '<button class="xbtn" type="button" id="fpTest">Send test notification</button><button class="xbtn danger" type="button" id="fpOff">Turn off on this device</button>' : '<button class="xbtn primary" type="button" id="fpOn">Turn on push</button>'}</div>
    <div class="fprefs">${[['matches', '🤝 New trade matches'], ['announce', '📣 Announcements']].map(([k, n]) => `<label class="xcheck"><input type="checkbox" data-pref="${k}" ${p[k] !== false ? 'checked' : ''}> <span>${n}</span></label>`).join('')}</div>`;
}
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#fBell')) openInbox(false); });

/* =====================================================================================================
   6. REPORT BUTTONS for friend codes + profiles
   ===================================================================================================== */
function decorateCodes() {
  if (!user) return;
  $$('#codesView .xcodecard').forEach(c => {
    const prof = $('[data-prof]', c); if (!prof || $('.freport', c)) return;
    const name = prof.dataset.prof; if (name === user.username) return;
    const act = $('.xactions', c); if (act) act.insertAdjacentHTML('beforeend', `<button class="xbtn freport" type="button" data-freport="${esc(name)}" data-ftype="friend_code">🚩 Report</button>`);
  });
}
if ($('#codesView')) new MutationObserver(debounce(decorateCodes, 120)).observe($('#codesView'), { childList: true, subtree: true });
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-freport]'); if (b) openReport(b.dataset.ftype, b.dataset.freport); });
window.PDX_REPORT = (name, type) => openReport(type || "profile", name);
function openReport(type, name) {
  if (!user) return toast('Log in first (chat panel).');
  const m = modal(`<h2>🚩 Report ${esc(name)}</h2><p class="muted">Tell the admins what’s wrong with this ${type === 'profile' ? 'profile' : 'friend code'}. Reports are only seen by admins.</p>
    <form class="xform" id="fRepForm"><textarea name="reason" maxlength="200" rows="3" required placeholder="What’s the problem?"></textarea><div class="xactions"><button class="xbtn primary" type="submit">Send report</button></div><div class="muted" id="fRepMsg"></div></form>`);
  $('#fRepForm', m).onsubmit = async e => {
    e.preventDefault(); const f = e.target, btn = $('button', f); btn.disabled = true;
    const { error } = await sb().from('content_reports').insert({ target_type: type, target_username: name, reason: f.reason.value.trim().slice(0, 200) });
    if (error) { btn.disabled = false; $('#fRepMsg', m).textContent = errText(error); return; }
    closeModal(); toast('Thanks — the admins will take a look.');
  };
}

/* =====================================================================================================
   7. ADMIN INSIGHTS (admins only): analytics · moderation · badge manager · settings
   ===================================================================================================== */
const I = { tab: store.get('pdx.finstab') || 'analytics' };
/* Same idea as the Admin tab: everything in Insights is fetched into memory when an admin logs in, so each sub-tab paints instantly from
   memory; a background refresh then redraws only if something actually changed (no loading flashes). */
const IC = {};
const sigOf = x => { try { return JSON.stringify(x); } catch { return ''; } };
const slimErr = e => (e ? { message: e.message, code: e.code } : null);
const fade = el => { if (el && window.pdxFade) window.pdxFade(el); };
async function prefetchInsights() {
  if (!user || !user.is_admin || !sb()) return;
  await Promise.allSettled([fetchAnalytics(), fetchReports(), fetchMutes(), fetchWords(), fetchLog(), fetchSettings()]);
}
const fnMsg = async r => { if (!r.error) return ''; try { const j = await r.error.context.json(); if (j && j.error) return j.error; } catch {} return r.error.message || 'The function could not be reached — is it deployed?'; };
async function logMod(action, target, detail = '') { if (!user) return; await sb().from('mod_log').insert({ admin_name: user.username, action, target: String(target).slice(0, 80), detail: String(detail).slice(0, 300) }); }
function renderInsights() {
  const v = $('#insightsView'); if (!v) return;
  if (!user || !isMod()) { v.innerHTML = '<div class="panel"><div class="empty small">Staff only.</div></div>'; return; }
  const tabs = isAdmin() ? [['analytics', '📈 Analytics'], ['moderation', '🛡 Moderation'], ['badges', '🏅 Badge manager'], ['settings', '⚙ Settings']] : [['moderation', '🛡 Moderation']];
  if (!isAdmin() && I.tab !== 'moderation') I.tab = 'moderation';
  v.innerHTML = `<div class="panel"><div class="xseg fitabs" id="fiTabs">${tabs.map(([k, n]) => `<button type="button" data-t="${k}" class="${I.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div></div><div id="insBody"></div>`;
  const body = $('#insBody'); ({ analytics: tabAnalytics, moderation: tabModeration, badges: tabBadgeMgr, settings: tabSettings }[I.tab] || tabAnalytics)(body);
}
document.addEventListener('click', e => { const t = e.target.closest && e.target.closest('#insightsView #fiTabs [data-t]'); if (t) { I.tab = t.dataset.t; store.set('pdx.finstab', I.tab); renderInsights(); fade($('#insBody')); } });
/* Embed Insights sub-tabs inside the Admin panel (chat.js calls this). */
window.PdxInsights = {
  tabs: [
    ['analytics', '📈 Analytics'],
    ['moderation', '🛡 Moderation'],
    ['badges', '🏅 Badge manager'],
    ['settings', '⚙ Settings']
  ],
  async render(tab, body) {
    if (!body) return;
    if (!user || !isMod()) { body.innerHTML = '<div class="panel"><div class="empty small">Staff only.</div></div>'; return; }
    I.tab = tab || 'analytics';
    store.set('pdx.finstab', I.tab);
    // Ensure data is warm
    if (!IC.settings && tab === 'settings') await fetchSettings();
    const fn = ({ analytics: tabAnalytics, moderation: tabModeration, badges: tabBadgeMgr, settings: tabSettings })[I.tab] || tabAnalytics;
    body.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.id = 'insBody';
    body.appendChild(wrap);
    fn(wrap);
  },
  prefetch: prefetchInsights
};


/* ----- analytics ----- */
function dayBars(rows, days) {
  const map = new Map((rows || []).map(r => [String(r.d).slice(0, 10), r.n])), out = [];
  for (let i = days - 1; i >= 0; i--) { const k = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); out.push([k, map.get(k) || 0]); }
  const max = Math.max(1, ...out.map(x => x[1])), w = 10, gap = 3, h = 70;
  return `<svg viewBox="0 0 ${out.length * (w + gap)} ${h}" class="fchart" preserveAspectRatio="none" role="img" aria-label="Daily counts">${out.map(([k, n], i) => { const bh = Math.max(n ? 2 : 1, Math.round(n / max * h)); return `<rect x="${i * (w + gap)}" y="${h - bh}" width="${w}" height="${bh}" rx="2"><title>${k}: ${n}</title></rect>`; }).join('')}</svg>
   <div class="fchartcap"><span>${out[0][0].slice(5)}</span><span>peak ${max}</span><span>${out[out.length - 1][0].slice(5)}</span></div>`;
}
const topList = (rows, empty) => rows && rows.length ? (() => { const max = Math.max(...rows.map(r => r.n)); return `<div class="ftop">${rows.map(r => `<div><span>${esc((P() && P().pokemon[r.id - 1] || {}).name || '#' + r.id)}</span><i style="width:${Math.max(4, r.n / max * 100)}%"></i><b>${r.n}</b></div>`).join('')}</div>`; })() : `<div class="muted">${empty}</div>`;
async function fetchAnalytics() {
  const { data, error } = await sb().rpc('admin_analytics');
  const v = error ? { err: errText(error) } : { d: data };
  const ch = sigOf(v) !== sigOf(IC.analytics); IC.analytics = v; return ch;
}
function paintAnalytics(body) {
  const c = IC.analytics; if (!c || !body) return;
  if (c.err) { body.innerHTML = `<div class="panel"><div class="empty small">${esc(c.err)}</div></div>`; return; }
  const d = c.d || {};
  const stat = (n, l, sub) => `<div class="fstat"><small>${l}</small><b>${typeof n === 'number' ? fmtNum(n) : n}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
  const teams = d.teams || {}, tt = Object.values(teams).reduce((a, b) => a + b, 0) || 1, TC = { mystic: ['💙 Mystic', '#4f9dff'], valor: ['❤️ Valor', '#ff6b6b'], instinct: ['💛 Instinct', '#f4c96b'], none: ['No team', '#5b6b80'] };
  body.innerHTML = `<div class="panel"><div class="xhead"><div><b>📈 Site analytics</b><div class="muted">Activity is measured from cloud-synced dexes and chat. Accounts only — visitors who never log in aren’t counted.</div></div><button class="xbtn" type="button" id="fiRefresh">Refresh</button></div>
    <div class="fstats">${stat(d.users, 'Accounts', `+${d.new7} this week · +${d.new30} this month`)}${stat(d.active24, 'DAU (24h)', `${fmtNum(d.active7)} active in 7d · retention signal`)}${stat(d.chatters7, 'Chat volume', `${fmtNum(d.chatters7)} chatters · 7d`)}${stat(d.public, 'Public profiles', `${fmtNum(d.sharing)} share trades`)}${stat(d.avg_pct + '%', 'Avg completion', `${fmtNum(d.shiny_total)} shinies registered`)}${stat(d.push_subs, 'Push devices')}${stat(d.open_reports, 'Open reports')}${stat(d.muted, 'Muted now', `${fmtNum(d.events_upcoming)} upcoming events`)}</div></div>
    <div class="fgrid2"><div class="panel"><b>New accounts · last 30 days</b>${dayBars(d.signups, 30)}</div><div class="panel"><b>Chat messages · last 14 days</b>${dayBars(d.messages, 14)}</div></div>
    <div class="fgrid2"><div class="panel"><b>🔍 Most wanted Pokémon</b><div class="muted">From public trade lists</div>${topList(d.top_want, 'No shared lists yet.')}</div><div class="panel"><b>🎁 Most offered Pokémon</b><div class="muted">From public trade lists</div>${topList(d.top_offer, 'No shared lists yet.')}</div></div>
    <div class="fgrid2"><div class="panel"><b>Teams</b><div class="fteams">${Object.entries(teams).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div><span>${(TC[k] || TC.none)[0]}</span><i style="width:${Math.max(3, n / tt * 100)}%;background:${(TC[k] || TC.none)[1]}"></i><b>${n}</b></div>`).join('') || '<div class="muted">No trainer cards yet.</div>'}</div></div>
    <div class="panel"><b>🏅 Most-earned badges</b>${(d.badges || []).length ? `<div class="ftop">${d.badges.map(r => `<div><span>${esc(r.name)}</span><i style="width:${Math.max(4, r.n / d.badges[0].n * 100)}%"></i><b>${r.n}</b></div>`).join('')}</div>` : '<div class="muted">No badges earned yet.</div>'}</div></div>`;
  const rb = $('#fiRefresh', body);
  if (rb) rb.onclick = async () => { rb.disabled = true; rb.textContent = 'Refreshing…'; await fetchAnalytics(); if (I.tab === 'analytics' && $('#insBody')) paintAnalytics($('#insBody')); };
}
async function tabAnalytics(body) {
  const had = !!IC.analytics;
  if (had) paintAnalytics(body); else body.innerHTML = `<div class="panel">${SKEL(8, 'tall')}</div>`;
  const ch = await fetchAnalytics();
  if (I.tab !== 'analytics' || !$('#insBody')) return;
  if (ch || !had) paintAnalytics($('#insBody'));
}

/* ----- moderation ----- */
const DURS = [['10 minutes', .1667], ['1 hour', 1], ['24 hours', 24], ['7 days', 168], ['30 days', 720]];
async function tabModeration(body) {
  body.innerHTML = `<div class="panel"><div class="xhead"><div><b>📝 Ban appeals</b><div class="muted">Open appeals from banned accounts.</div></div><button class="xbtn" type="button" id="fmAppealsReload">Refresh</button></div><div id="fmAppeals"><div class="empty small"><i class="spin"></i></div></div></div>
    <div class="panel"><div class="xhead"><div><b>🚩 Reports</b><div class="muted">Chat messages, friend codes and profiles that people reported.</div></div><button class="xbtn" type="button" id="fmReload">Refresh</button></div><div id="fmReports"><div class="empty small"><i class="spin"></i></div></div></div>
    <div class="panel"><div class="xhead"><div><b>🔎 Look up a user</b><div class="muted">Mute, ban, or clean up everything from one person.</div></div></div><form id="fmLookup" class="xform"><div class="xrow"><label class="xgrow">Username<input name="u" required maxlength="40" placeholder="exact username"></label><button class="xbtn primary" type="submit">Look up</button></div></form><div id="fmUser"></div></div>
    <div class="fgrid2"><div class="panel"><b>🔇 Muted right now</b><div id="fmMutes">${SKEL(2, 'rows')}</div></div>
    <div class="panel"><b>🧱 Chat filters</b><form id="fmWordForm" class="xform"><div class="xrow"><label class="xgrow">Block a word or phrase<input name="w" maxlength="40" placeholder="e.g. scamlink"></label><button class="xbtn" type="submit">Add</button></div></form><div id="fmWords" class="xchips"></div>
      <form id="fmSlowForm" class="xform"><div class="xrow"><label class="xgrow">Slow mode (seconds between messages, 0 = off)<input name="s" type="number" min="0" max="3600" value="0"></label><button class="xbtn" type="submit">Save</button></div></form><div class="muted">Admins are never filtered. Blocked words reject the message with a clear error.</div></div></div>
    <div class="panel"><b>📜 Moderation log</b><div id="fmLog" class="fmlog">${SKEL(3, 'rows')}</div></div>`;
  loadReports(); loadAppeals(); loadMutes(); loadWords(); loadLog();
}

async function loadAppeals() {
  const box = $('#fmAppeals'); if (!box || !sb()) return;
  const { data, error } = await sb().from('ban_appeals').select('id,user_id,username,reason,status,created_at,admin_note').eq('status', 'open').order('created_at', { ascending: true }).limit(50);
  if (!$('#fmAppeals')) return;
  if (error) { box.innerHTML = `<div class="empty small">${esc(errText(error))}</div>`; return; }
  if (!data || !data.length) { box.innerHTML = '<div class="muted">No open appeals.</div>'; return; }
  box.innerHTML = data.map(a => `<div class="fuser" data-appeal="${a.id}">
    <div class="fuserhead"><b>${esc(a.username)}</b> <span class="muted">${ago(a.created_at)}</span></div>
    <p>${esc(a.reason)}</p>
    <div class="xactions">
      <button type="button" class="xbtn" data-appeal-act="accept" data-id="${a.id}" data-uid="${a.user_id}" data-name="${esc(a.username)}">Accept (unban)</button>
      <button type="button" class="xbtn danger" data-appeal-act="reject" data-id="${a.id}" data-name="${esc(a.username)}">Reject</button>
    </div></div>`).join('');
}
document.addEventListener('click', async e => {
  if (e.target.id === 'fmAppealsReload') return void loadAppeals();
  const b = e.target.closest && e.target.closest('[data-appeal-act]');
  if (!b || !sb()) return;
  const act = b.dataset.appealAct, id = b.dataset.id, uid = b.dataset.uid, name = b.dataset.name;
  b.disabled = true;
  if (act === 'accept') {
    await sb().from('profiles').update({ banned: false, ban_reason: '', banned_until: null }).eq('id', uid);
    await sb().from('ban_appeals').update({ status: 'accepted', resolved_at: new Date().toISOString(), resolved_by: user && user.id, admin_note: 'Unbanned' }).eq('id', id);
    toast(name + ' unbanned (appeal accepted).'); logMod('accept appeal', name);
  } else {
    const note = prompt('Optional note for the log:') || 'Rejected';
    await sb().from('ban_appeals').update({ status: 'rejected', resolved_at: new Date().toISOString(), resolved_by: user && user.id, admin_note: note }).eq('id', id);
    toast('Appeal rejected.'); logMod('reject appeal', name, note);
  }
  loadAppeals(); loadLog();
});

async function fetchReports() {
  const [a, b] = await Promise.all([
    sb().from('reports').select('id,reason,created_at,messages(id,user_id,username,body)').order('created_at', { ascending: false }).limit(50),
    sb().from('content_reports').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(50)
  ]);
  const v = { a: { data: a.data, error: slimErr(a.error) }, b: { data: b.data, error: slimErr(b.error) } };
  const ch = sigOf(v) !== sigOf(IC.reports); IC.reports = v; return ch;
}
function paintReports() {
  const box = $('#fmReports'), c = IC.reports; if (!box || !c) return;
  const { a, b } = c;
  const rows = [];
  (a.data || []).forEach(r => rows.push({ t: 'msg', at: r.created_at, r }));
  (b.data || []).forEach(r => rows.push({ t: 'c', at: r.created_at, r }));
  rows.sort((x, y) => new Date(y.at) - new Date(x.at));
  if (a.error && !tableMissing(a.error)) { box.innerHTML = `<div class="empty small">${esc(a.error.message)}</div>`; return; }
  box.innerHTML = (b.error && tableMissing(b.error) ? needSetup() : '') + (rows.length ? rows.map(x => x.t === 'msg' ? (() => { const r = x.r, m = r.messages;
    return `<div class="frep"><div class="frephead"><b>💬 Chat message</b><span class="muted">${ago(r.created_at)}</span></div>${m ? `<div class="frepbody"><b>${esc(m.username)}:</b> ${esc(String(m.body || '').slice(0, 300))}</div>` : '<div class="muted">Message already deleted.</div>'}<div class="muted">Reason: ${esc(r.reason)}</div>
      <div class="xactions">${m ? `<button class="xbtn danger" data-mod="delmsg" data-id="${m.id}" data-rid="${r.id}" data-name="${esc(m.username)}" type="button">Delete message</button><button class="xbtn" data-mod="mute" data-uid="${m.user_id}" data-name="${esc(m.username)}" data-h="1" data-rid="${r.id}" type="button">Mute 1h</button><button class="xbtn" data-mod="mute" data-uid="${m.user_id}" data-name="${esc(m.username)}" data-h="24" data-rid="${r.id}" type="button">Mute 24h</button><button class="xbtn danger" data-mod="ban" data-uid="${m.user_id}" data-name="${esc(m.username)}" data-rid="${r.id}" type="button">Ban</button>` : ''}<button class="xbtn" data-mod="dismiss" data-rid="${r.id}" type="button">Dismiss</button></div></div>`; })()
    : (() => { const r = x.r; return `<div class="frep"><div class="frephead"><b>${r.target_type === 'profile' ? '👤 Profile' : '🤝 Friend code'}: ${esc(r.target_username)}</b><span class="muted">${ago(r.created_at)}</span></div><div class="muted">Reason: ${esc(r.reason)}</div>
      <div class="xactions"><button class="xbtn" data-mod="openprof" data-name="${esc(r.target_username)}" type="button">Open profile</button><button class="xbtn" data-mod="lookup" data-name="${esc(r.target_username)}" type="button">Look up user</button><button class="xbtn" data-mod="cdone" data-cid="${r.id}" data-name="${esc(r.target_username)}" type="button">Mark done</button></div></div>`; })()).join('') : '<div class="empty small">No open reports. 🎉</div>');
}
async function loadReports() { const had = !!IC.reports; if (had) paintReports(); const ch = await fetchReports(); if (ch || !had) paintReports(); }
async function fetchMutes() {
  const { data, error } = await sb().from('mutes').select('user_id,until_at,reason').gt('until_at', new Date().toISOString()).order('until_at');
  const ids = (data || []).map(r => r.user_id), names = {};
  if (!error && ids.length) { const p = await sb().from('profiles').select('id,username').in('id', ids); (p.data || []).forEach(x => names[x.id] = x.username); }
  const v = { data: data || [], names, error: slimErr(error) };
  const ch = sigOf(v) !== sigOf(IC.mutes); IC.mutes = v; return ch;
}
function paintMutes() {
  const box = $('#fmMutes'), c = IC.mutes; if (!box || !c) return;
  if (c.error) { box.innerHTML = `<div class="empty small">${esc(errText(c.error))}</div>`; return; }
  const names = c.names;
  box.innerHTML = c.data.length ? c.data.map(r => `<div class="fmrow"><span><b>${esc(names[r.user_id] || r.user_id.slice(0, 8))}</b><small>until ${new Date(r.until_at).toLocaleString()}${r.reason ? ' · ' + esc(r.reason) : ''}</small></span><button class="xbtn" data-mod="unmute" data-uid="${r.user_id}" data-name="${esc(names[r.user_id] || '')}" type="button">Unmute</button></div>`).join('') : '<div class="muted">Nobody is muted.</div>';
}
async function loadMutes() { const had = !!IC.mutes; if (had) paintMutes(); const ch = await fetchMutes(); if (ch || !had) paintMutes(); }
async function fetchWords() {
  const [w, s2] = await Promise.all([sb().from('banned_words').select('id,word').order('word'), sb().from('site_settings').select('value').eq('key', 'slowmode').maybeSingle()]);
  const v = { words: w.data || [], error: slimErr(w.error), slow: (s2.data && s2.data.value && s2.data.value.seconds) || 0 };
  const ch = sigOf(v) !== sigOf(IC.words); IC.words = v; return ch;
}
function paintWords() {
  const box = $('#fmWords'), c = IC.words; if (!box || !c) return;
  if (c.error) { box.innerHTML = esc(errText(c.error)); return; }
  box.innerHTML = c.words.length ? c.words.map(x => `<span class="xchip fword">${esc(x.word)} <button type="button" data-mod="worddel" data-id="${x.id}" data-name="${esc(x.word)}" aria-label="Remove ${esc(x.word)}">✕</button></span>`).join('') : '<span class="muted">No blocked words.</span>';
  const f = $('#fmSlowForm'); if (f) f.s.value = c.slow;
}
async function loadWords() { const had = !!IC.words; if (had) paintWords(); const ch = await fetchWords(); if (ch || !had) paintWords(); }
async function fetchLog() {
  const { data, error } = await sb().from('mod_log').select('*').order('created_at', { ascending: false }).limit(30);
  const v = { data: data || [], error: slimErr(error) };
  const ch = sigOf(v) !== sigOf(IC.log); IC.log = v; return ch;
}
function paintLog() {
  const box = $('#fmLog'), c = IC.log; if (!box || !c) return;
  if (c.error) { box.innerHTML = `<div class="empty small">${esc(errText(c.error))}</div>`; return; }
  box.innerHTML = c.data.length ? c.data.map(r => `<div><span class="muted">${ago(r.created_at)}</span> <b>${esc(r.admin_name || 'admin')}</b> ${esc(r.action)} <b>${esc(r.target)}</b>${r.detail ? ' <span class="muted">— ' + esc(r.detail) + '</span>' : ''}</div>`).join('') : '<div class="muted">Nothing logged yet.</div>';
}
async function loadLog() { const had = !!IC.log; if (had) paintLog(); const ch = await fetchLog(); if (ch || !had) paintLog(); }
async function lookupUser(name) {
  const box = $('#fmUser'); if (!box) return; box.innerHTML = '<div class="empty small"><i class="spin"></i></div>';
  const { data: p, error } = await sb().from('profiles').select('id,username,is_admin,is_mod,banned,ban_reason,banned_until').ilike('username', name.replace(/[%_]/g, '')).limit(1).maybeSingle();
  if (!$('#fmUser')) return; if (error || !p) { box.innerHTML = `<div class="empty small">${error ? esc(error.message) : 'No user with that name.'}</div>`; return; }
  const [c, mu, last, rep] = await Promise.all([
    sb().from('messages').select('id', { count: 'exact', head: true }).eq('user_id', p.id),
    sb().from('mutes').select('until_at,reason').eq('user_id', p.id).gt('until_at', new Date().toISOString()).maybeSingle(),
    sb().from('messages').select('id,body,created_at').eq('user_id', p.id).order('id', { ascending: false }).limit(8),
    sb().from('content_reports').select('id', { count: 'exact', head: true }).eq('target_username', p.username)
  ]);
  const muted = mu.data;
  const banLabel = p.banned ? (p.banned_until ? `banned until ${new Date(p.banned_until).toLocaleString()}` : 'banned (permanent)') : '';
  box.innerHTML = `<div class="fuser"><div class="fuserhead"><b>${esc(p.username)}</b> ${p.is_admin ? '<span class="xchip">admin</span>' : (p.is_mod ? '<span class="xchip">mod</span>' : '')}${p.banned ? `<span class="xchip fbanned">${esc(banLabel)}</span>` : ''}${muted ? `<span class="xchip fbanned">muted until ${new Date(muted.until_at).toLocaleString()}</span>` : ''}</div>
    <div class="muted">${fmtNum(c.count || 0)} chat messages · ${fmtNum(rep.count || 0)} reports about this profile/code${p.ban_reason ? ' · ban reason: ' + esc(p.ban_reason) : ''}</div>
    ${p.is_admin ? '<div class="muted">Admins can’t be moderated from here.</div>' : `<div class="xrow fmact"><label>Mute for<select id="fmDur">${DURS.map(d => `<option value="${d[1]}">${d[0]}</option>`).join('')}</select></label><label class="xgrow">Reason (optional)<input id="fmWhy" maxlength="200"></label></div>
    <div class="xrow fmact"><label>Ban for<select id="fmBanDur"><option value="0">Permanent</option><option value="24">24 hours</option><option value="168">7 days</option><option value="720">30 days</option></select></label></div>
    <div class="xactions"><button class="xbtn" data-mod="umute" data-uid="${p.id}" data-name="${esc(p.username)}" type="button">Mute</button>${muted ? `<button class="xbtn" data-mod="unmute" data-uid="${p.id}" data-name="${esc(p.username)}" type="button">Unmute</button>` : ''}
      ${isAdmin() && !p.is_admin ? `<button class="xbtn" data-mod="${p.is_mod ? 'demotemod' : 'promotemod'}" data-uid="${p.id}" data-name="${esc(p.username)}" type="button">${p.is_mod ? 'Remove mod' : 'Make mod'}</button>` : ''}
      <button class="xbtn ${p.banned ? '' : 'danger'}" data-mod="${p.banned ? 'unban' : 'ban'}" data-uid="${p.id}" data-name="${esc(p.username)}" type="button">${p.banned ? 'Unban' : 'Ban'}</button>
      <button class="xbtn danger" data-mod="wipemsgs" data-uid="${p.id}" data-name="${esc(p.username)}" type="button">Delete all their messages</button>
      <button class="xbtn danger" data-mod="delcard" data-uid="${p.id}" data-name="${esc(p.username)}" type="button">Remove from leaderboard</button>
      <button class="xbtn danger" data-mod="delcode" data-uid="${p.id}" data-name="${esc(p.username)}" type="button">Remove friend code</button></div>`}
    ${(last.data || []).length ? `<details><summary>Latest messages</summary><div class="fmlog">${last.data.map(m => `<div><span class="muted">${ago(m.created_at)}</span> ${esc(String(m.body || '').slice(0, 200))}</div>`).join('')}</div></details>` : ''}</div>`;
}
async function modAction(b) {
  const d = b.dataset, act = d.mod, name = d.name || '';
  const done = async (msg, log, detail) => { toast(msg); if (log) await logMod(log, name || d.id || '', detail || ''); loadReports(); loadMutes(); loadLog(); if ($('#fmUser .fuser') && name && act !== 'dismiss') lookupUser(name); };
  b.disabled = true;
  try {
    if (act === 'openprof') { location.hash = '#u=' + encodeURIComponent(name); return; }
    if (act === 'lookup') { const f = $('#fmLookup'); if (f) f.u.value = name; return void lookupUser(name); }
    if (act === 'delmsg') { const { error } = await sb().from('messages').delete().eq('id', d.id); if (error) return toast(error.message); await sb().from('reports').delete().eq('message_id', d.id); return done('Message deleted.', 'delete message', 'by ' + name); }
    if (act === 'dismiss') { const { error } = await sb().from('reports').delete().eq('id', d.rid); if (error) return toast(error.message); return done('Report dismissed.'); }
    if (act === 'cdone') { const { error } = await sb().from('content_reports').update({ status: 'done' }).eq('id', d.cid); if (error) return toast(error.message); return done('Marked done.', 'close report', name); }
    if (act === 'mute' || act === 'umute') {
      const hrs = act === 'mute' ? +d.h : +$('#fmDur').value, why = act === 'umute' ? ($('#fmWhy').value || '').trim().slice(0, 200) : 'From a report';
      const { error } = await sb().from('mutes').upsert({ user_id: d.uid, until_at: new Date(Date.now() + hrs * 3600e3).toISOString(), reason: why }, { onConflict: 'user_id' }); if (error) return toast(errText(error));
      if (d.rid) await sb().from('reports').delete().eq('id', d.rid); return done(`${name} muted.`, 'mute', (hrs >= 24 ? hrs / 24 + 'd' : hrs + 'h') + (why ? ' · ' + why : ''));
    }
    if (act === 'unmute') { const { error } = await sb().from('mutes').delete().eq('user_id', d.uid); if (error) return toast(error.message); return done(`${name || 'User'} unmuted.`, 'unmute'); }
    if (act === 'promotemod' || act === 'demotemod') {
      if (!isAdmin()) return toast('Admins only.');
      const on = act === 'promotemod';
      const { error } = await sb().from('profiles').update({ is_mod: on }).eq('id', d.uid);
      if (error) return toast(error.message);
      return done(on ? (name + ' is now a mod.') : (name + ' is no longer a mod.'), on ? 'promote mod' : 'demote mod');
    }
    if (act === 'ban' || act === 'unban') {
      if (act === 'ban') {
        const dlg = window.PDX_DIALOG;
        if (!dlg) return toast('Ban dialog unavailable.');
        const hoursEl = document.getElementById('fmBanDur');
        const hours = hoursEl ? Math.max(0, +hoursEl.value || 0) : 0;
        const durLabel = hours <= 0 ? 'permanently' : (hours === 24 ? 'for 24 hours' : hours === 168 ? 'for 7 days' : hours === 720 ? 'for 30 days' : `for ${hours} hours`);
        const r = await dlg({
          title: 'Ban ' + name,
          body: hours <= 0
            ? 'This permanently bans the account. They will not be able to log in again. Their username stays claimed.'
            : `This temporarily bans the account ${durLabel}. They can log in again after it expires.`,
          confirmLabel: hours <= 0 ? 'Ban permanently' : 'Ban ' + durLabel.replace('for ', ''),
          cancelLabel: 'Cancel',
          input: true,
          inputPlaceholder: 'Reason (required)',
          danger: true
        });
        if (!r) return;
        const reason = (r.value || '').trim().slice(0, 200);
        if (!reason) return toast('A ban reason is required.');
        const patch = { banned: true, ban_reason: reason, banned_until: hours > 0 ? new Date(Date.now() + hours * 3600e3).toISOString() : null };
        const { error } = await sb().from('profiles').update(patch).eq('id', d.uid);
        if (error) return toast(error.message);
        if (d.rid) await sb().from('reports').delete().eq('id', d.rid);
        return done(`${name} banned ${durLabel}.`, 'ban', reason + (hours ? ` (${durLabel})` : ' (permanent)'));
      }
      const dlg = window.PDX_DIALOG;
      const r = dlg ? await dlg({ title: 'Unban ' + name, body: 'They will be able to log in again.', confirmLabel: 'Unban', cancelLabel: 'Cancel' }) : { ok: true };
      if (!r) return;
      const { error } = await sb().from('profiles').update({ banned: false, ban_reason: '', banned_until: null }).eq('id', d.uid);
      if (error) return toast(error.message);
      if (d.rid) await sb().from('reports').delete().eq('id', d.rid);
      return done(`${name} unbanned.`, 'unban');
    }
    if (act === 'wipemsgs') { if (!confirm(`Delete ALL of ${name}'s chat messages? This can’t be undone.`)) return; const { data, error } = await sb().from('messages').delete().eq('user_id', d.uid).select('id'); if (error) return toast(error.message); return done(`Deleted ${(data || []).length} messages.`, 'delete all messages', `${(data || []).length} from ${name}`); }
    if (act === 'delcard') { if (!confirm(`Remove ${name}'s trainer card (and leaderboard spot)?`)) return; const { error } = await sb().from('trainer_cards').delete().eq('user_id', d.uid); if (error) return toast(error.message); return done('Trainer card removed.', 'remove card', name); }
    if (act === 'delcode') { if (!confirm(`Remove ${name}'s friend code?`)) return; const { error } = await sb().from('friend_codes').delete().eq('user_id', d.uid); if (error) return toast(error.message); return done('Friend code removed.', 'remove friend code', name); }
    if (act === 'worddel') { const { error } = await sb().from('banned_words').delete().eq('id', d.id); if (error) return toast(error.message); loadWords(); return void logMod('unblock word', name); }
  } finally { b.disabled = false; }
}
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('#insightsView [data-mod]'); if (b) modAction(b); if (e.target.id === 'fmReload') { loadReports(); loadMutes(); loadLog(); } });
document.addEventListener('submit', async e => {
  const f = e.target;
  if (f.id === 'fmLookup') { e.preventDefault(); lookupUser(f.u.value.trim()); }
  if (f.id === 'fmWordForm') { e.preventDefault(); const w = f.w.value.trim().toLowerCase(); if (w.length < 2) return; const { error } = await sb().from('banned_words').insert({ word: w }); if (error) return toast(/duplicate/i.test(error.message) ? 'Already blocked.' : errText(error)); f.reset(); loadWords(); logMod('block word', w); }
  if (f.id === 'fmSlowForm') { e.preventDefault(); const s = Math.max(0, Math.min(3600, +f.s.value || 0)); const { error } = await sb().from('site_settings').upsert({ key: 'slowmode', value: { seconds: s }, updated_at: new Date().toISOString() }); if (error) return toast(errText(error)); if (IC.words) IC.words.slow = s; toast(s ? `Slow mode: ${s}s between messages.` : 'Slow mode off.'); logMod('slow mode', s ? s + 's' : 'off'); }
});

/* ----- badge manager: create / edit / delete badges, award custom ones ----- */
const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), k = Math.min(128 / img.width, 128 / img.height), w = img.width * k, h = img.height * k;
      g.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h); URL.revokeObjectURL(u);
      let out = c.toDataURL('image/png'); if (out.length > 100000) out = c.toDataURL('image/webp', .85);
      out.length > 110000 ? rej(new Error('That image is too detailed — try a simpler one or host it and paste the link.')) : res(out);
    };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Could not read that image file.')); };
    img.src = u;
  });
}
async function tabBadgeMgr(body, fresh) {
  const host = body || $('#insBody');
  if (!host) return;
  const had = !!B.defs && !B.err, before = sigOf(B.defs);
  if (!fresh) { if (had) paintBadgeMgr(host); else host.innerHTML = `<div class="panel">${SKEL(5, 'rows')}</div>`; }
  await loadBadges(true);
  if (I.tab !== 'badges') return;
  // Prefer the same host we were given (Admin embed), fall back to #insBody
  const target = (host.isConnected ? host : $('#insBody'));
  if (!target) return;
  if (fresh || !had || sigOf(B.defs) !== before) paintBadgeMgr(target);
}
function paintBadgeMgr(body) {
  if (!body) return;
  if (B.err) { body.innerHTML = `<div class="panel"><div class="empty small">${esc(B.err)}</div></div>`; return; }
  body.innerHTML = `<div class="panel"><div class="xhead"><div><b>🏅 Badge manager</b><div class="muted">Milestone badges are earned automatically from a trainer’s numbers. Custom badges are handed out by you.</div></div><button class="xbtn primary" type="button" id="fbNew">＋ New badge</button></div>
    <div class="fbmgr">${B.defs.map(b => `<div class="fbmrow">${badgeIcon(b, 46)}<span class="fbmtxt"><b>${esc(b.name)}</b><small>${b.kind === 'milestone' || b.source === 'patreon' ? esc(reqText(b)) : 'Custom — awarded by you'}${b.secret ? ' · secret' : ''}</small></span><button class="xbtn" data-fb="edit" data-id="${b.id}" type="button">Edit</button><button class="xbtn danger" data-fb="del" data-id="${b.id}" type="button">Delete</button></div>`).join('') || '<div class="empty small">No badges yet.</div>'}</div></div>
    <div class="panel"><b>🎖 Award or take back a badge</b><form id="fbAward" class="xform"><div class="xrow"><label class="xgrow">Username<input name="u" required maxlength="40"></label><label class="xgrow">Badge<select name="b">${B.defs.map(b => `<option value="${b.id}">${esc(b.name)}${b.kind === 'milestone' ? ' (milestone)' : ''}</option>`).join('')}</select></label></div>
    <div class="xactions"><button class="xbtn primary" type="submit" data-do="award">Award</button><button class="xbtn danger" type="submit" data-do="revoke">Take back</button></div></form></div>`;
}
function refreshBadgeViews() {
  const v = document.body.dataset.view;
  if (v === 'badges') renderBadges();
  else if (I.tab === 'badges' && $('#insBody')) tabBadgeMgr($('#insBody'), true);
}
function badgeEditor(b) {
  b = b || {};
  const isNew = !b.id, type0 = b.kind === 'milestone' ? 'milestone' : (b.source === 'patreon' ? 'patreon' : (b.kind === 'custom' || isNew ? 'award' : 'milestone'));
  const m = modal(`<h2>${isNew ? 'New badge' : 'Edit badge'}</h2><form id="fbForm" class="xform">
    <div class="fbprev" id="fbPrev"></div>
    <div class="xrow"><label class="xgrow">Name<input name="name" required maxlength="60" value="${esc(b.name || '')}"></label>
      <label>Type<select name="type"><option value="milestone" ${type0 === 'milestone' ? 'selected' : ''}>Milestone — earned automatically</option><option value="award" ${type0 === 'award' ? 'selected' : ''}>I award it</option><option value="patreon" ${type0 === 'patreon' ? 'selected' : ''}>Patreon tier</option></select></label></div>
    <div class="xrow" id="fbRule"><label class="xgrow">Earned when<select name="metric">${Object.entries(METRIC).map(([k, v]) => `<option value="${k}" ${(b.metric || 'caught') === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label><label>is at least<input name="threshold" type="number" min="0" step="any" value="${esc(b.threshold ?? 100)}"></label></div>
    <div class="xrow" id="fbTier"><label class="xgrow">Tier name<input name="tier" maxlength="60" value="${esc(b.tier || '')}" placeholder="e.g. Gold · $10/month"></label></div>
    <div class="muted fsmall" id="fbTypeNote"></div>
    <label>Description<textarea name="description" maxlength="300" rows="2">${esc(b.description || '')}</textarea></label>
    <div class="xrow"><label>Display order (lowest first)<input name="sort" type="number" value="${esc(b.sort ?? 100)}"></label></div>
    <fieldset class="fbimg"><legend>Badge image</legend>
      <div class="muted fsmall">Upload a square PNG, JPG, WebP or GIF (a transparent background looks best). It is shrunk to 128×128 and stored with the badge, so it can’t disappear later.</div>
      <div class="xactions"><label class="xbtn fbfile">${isNew ? 'Upload image…' : 'Replace image…'}<input type="file" accept="image/*" hidden id="fbFile"></label></div></fieldset>
    <div class="xactions"><button class="xbtn primary" type="submit">${isNew ? 'Create badge' : 'Save changes'}</button><span class="muted" id="fbMsg"></span></div></form>`, 'fbeditor');
  const f = $('#fbForm', m); let img = b.image_url || '';
  const NOTES = { milestone: '', award: 'You give this badge out yourself: Insights → Badge manager → Award a badge, by username.', patreon: 'The site can’t see Patreon, so you give this badge to each supporter yourself (Insights → Badge manager → Award). Make one badge per tier.' };
  const prev = () => {
    const t = f.type.value; $('#fbRule', m).hidden = t !== 'milestone'; $('#fbTier', m).hidden = t !== 'patreon'; $('#fbTypeNote', m).textContent = NOTES[t];
    $('#fbPrev', m).innerHTML = badgeIcon({ image_url: img, emoji: b.emoji || '🏅', color: b.color || '#f4c96b' }, 96);
  };
  f.addEventListener('input', prev); f.addEventListener('change', prev);
  $('#fbFile', m).onchange = async e => { const file = e.target.files[0]; if (!file) return; try { img = await fileToDataUrl(file); $('#fbMsg', m).textContent = 'Image ready ✓'; prev(); } catch (err) { $('#fbMsg', m).textContent = err.message; } };
  prev();
  f.onsubmit = async e => {
    e.preventDefault(); const msg = $('#fbMsg', m), type = f.type.value, kind = type === 'milestone' ? 'milestone' : 'custom', name = f.name.value.trim();
    if (!name) return void (msg.textContent = 'Give the badge a name.');
    if (!img) return void (msg.textContent = 'Upload an image for the badge.');
    if (!okImg(img)) return void (msg.textContent = 'That image can’t be used — upload a new one.');
    let slug = (!isNew && b.slug) || slugify(name); if (slug.length < 2) slug = 'badge-' + Math.random().toString(36).slice(2, 6);
    const row = { name, slug, kind, description: f.description.value.trim().slice(0, 300), emoji: b.emoji || '🏅', color: b.color || '#f4c96b', sort: Math.round(+f.sort.value || 100), secret: !!b.secret, image_url: img,
      metric: kind === 'milestone' ? f.metric.value : null, threshold: kind === 'milestone' ? (+f.threshold.value || 0) : null, source: type === 'patreon' ? 'patreon' : 'manual', tier: type === 'patreon' ? f.tier.value.trim().slice(0, 60) : '' };
    const btn = $('button[type=submit]', f); btn.disabled = true; msg.textContent = 'Saving…';
    const save = r => isNew ? sb().from('badges').insert(r) : sb().from('badges').update(r).eq('id', b.id);
    let { error } = await save(row), note = '';
    if (error && /duplicate/i.test(error.message) && isNew) { row.slug = slug + '-' + Math.random().toString(36).slice(2, 6); ({ error } = await save(row)); }
    if (error && /column|schema cache/i.test(error.message) && /source|tier/i.test(error.message)) { delete row.source; delete row.tier; ({ error } = await save(row)); note = type === 'patreon' ? ' Run supabase/badges-v2.sql so Patreon-tier badges keep their tier label.' : ''; }
    btn.disabled = false; if (error) return void (msg.textContent = errText(error));
    closeModal(); toast('Badge saved.' + note, note ? 9000 : 4200); logMod(isNew ? 'create badge' : 'edit badge', name); B.defs = null; refreshBadgeViews();
  };
}
document.addEventListener('click', async e => {
  if (e.target.id === 'fbNew') return badgeEditor(null);
  if (e.target.id === 'fbNewTab') return badgeEditor({ kind: 'custom', emoji: '🏅', color: '#f4c96b', sort: 100, image_url: '', secret: false, metric: 'caught', threshold: 100 });
  const b = e.target.closest && e.target.closest('[data-fb]'); if (!b) return;
  const def = (B.defs || []).find(x => String(x.id) === b.dataset.id); if (!def) return;
  if (b.dataset.fb === 'edit') return badgeEditor(def);
  if (b.dataset.fb === 'del') { if (!confirm(`Delete the badge “${def.name}”? Everyone who earned it loses it.`)) return; const { error } = await sb().from('badges').delete().eq('id', def.id); if (error) return toast(errText(error)); logMod('delete badge', def.name); toast('Badge deleted.'); B.defs = null; refreshBadgeViews(); }
});
document.addEventListener('submit', async e => {
  if (e.target.id !== 'fbAward') return; e.preventDefault();
  const f = e.target, doIt = (e.submitter && e.submitter.dataset.do) || 'award', name = f.u.value.trim(), def = (B.defs || []).find(x => String(x.id) === f.b.value);
  const { data: p, error } = await sb().from('profiles').select('id,username').ilike('username', name.replace(/[%_]/g, '')).limit(1).maybeSingle();
  if (error || !p) return toast(error ? error.message : 'No user with that name.');
  if (doIt === 'award') {
    const r = await sb().from('user_badges').upsert({ user_id: p.id, badge_id: +f.b.value, awarded_by: user.id }, { onConflict: 'user_id,badge_id', ignoreDuplicates: true }); if (r.error) return toast(errText(r.error));
    if (def) sb().from('notifications').upsert({ user_id: p.id, kind: 'badge', title: 'You got a badge: ' + def.name, body: def.description || '', url: '?view=badges', dedupe_key: 'badge:' + def.id }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }).then(() => {});
    toast(`Awarded to ${p.username}.`); logMod('award badge', p.username, def && def.name);
  } else {
    const r = await sb().from('user_badges').delete().eq('user_id', p.id).eq('badge_id', +f.b.value); if (r.error) return toast(errText(r.error));
    toast(`Taken back from ${p.username}.`); logMod('revoke badge', p.username, def && def.name);
  }
});


/* #135 scheduled announcements (stored in site_settings.scheduled_announcements) */
async function loadScheduledAnnouncements() {
  if (!sb()) return [];
  const { data, error } = await sb().from('site_settings').select('value').eq('key', 'scheduled_announcements').maybeSingle();
  if (error || !data) return [];
  const v = data.value;
  return Array.isArray(v) ? v : [];
}
async function paintScheduledAnnouncements() {
  const box = $('#fsAnnSched'); if (!box) return;
  const list = (await loadScheduledAnnouncements()).filter(a => a && a.ts > Date.now() - 60000);
  if (!list.length) { box.innerHTML = '<span class="muted">No scheduled announcements.</span>'; return; }
  box.innerHTML = '<b>Upcoming</b>' + list.map(a =>
    `<div class="xrow" style="align-items:center;gap:8px;margin:4px 0"><span>${esc(a.title)} · <span class="muted">${new Date(a.ts).toLocaleString()}</span></span>
     <button type="button" class="xbtn" data-delsched="${esc(a.id)}">Cancel</button></div>`
  ).join('');
}
document.addEventListener('click', async e => {
  const b = e.target.closest && e.target.closest('[data-delsched]');
  if (!b || !sb()) return;
  const id = b.dataset.delsched;
  const list = (await loadScheduledAnnouncements()).filter(a => a.id !== id);
  await sb().from('site_settings').upsert({ key: 'scheduled_announcements', value: list, updated_at: new Date().toISOString() });
  paintScheduledAnnouncements(); toast('Scheduled announcement cancelled.');
});
async function processDueAnnouncements() {
  if (!user || !user.is_admin || !sb()) return;
  const list = await loadScheduledAnnouncements();
  const due = list.filter(a => a.ts <= Date.now());
  if (!due.length) return;
  const remain = list.filter(a => a.ts > Date.now());
  await sb().from('site_settings').upsert({ key: 'scheduled_announcements', value: remain, updated_at: new Date().toISOString() });
  for (const a of due) {
    try {
      await sb().functions.invoke('push-notify', { body: { broadcast: { title: a.title, body: a.body || '', url: a.url || '' } } });
      logMod('send scheduled announcement', a.title);
    } catch (err) { console.warn('[scheduled ann]', err); }
  }
  paintScheduledAnnouncements();
}

/* ----- settings: donation goal · push · announcements · event import ----- */
async function fetchSettings() {
  const { data, error } = await sb().from('site_settings').select('key,value');
  const v = error ? { err: errText(error) } : { rows: data || [] };
  const ch = sigOf(v) !== sigOf(IC.settings); IC.settings = v; return ch;
}
/* keep the cached copy in step with what this admin just saved, so reopening the tab never flashes old values */
function cacheSetting(key, value) { const c = IC.settings; if (!c || !c.rows) return; const r = c.rows.find(x => x.key === key); if (r) r.value = value; else c.rows.push({ key, value }); }
async function tabSettings(body) {
  const had = !!IC.settings;
  if (had) paintSettings(body); else body.innerHTML = `<div class="panel">${SKEL(5, 'rows')}</div>`;
  const ch = await fetchSettings(); if (I.tab !== 'settings' || !$('#insBody')) return;
  if (!had) paintSettings($('#insBody'));
  else if (ch) { const f = $('#fsGoal'); if (!f || !f.contains(document.activeElement)) paintSettings($('#insBody')); }   // never redraw under someone who is typing
}
function paintSettings(body) {
  const c = IC.settings; if (!c || !body) return;
  if (c.err) { body.innerHTML = `<div class="panel"><div class="empty small">${esc(c.err)}</div></div>`; return; }
  const S = Object.fromEntries(c.rows.map(r => [r.key, r.value])), g = goal || S.donation_goal || {}, vp = (S.push || {}).public_key || '';
  // Site-wide background image (rain is always on — no admin toggle)
  const bg = S.background || (window.PdxBackground && PdxBackground.get()) || { url: '' };
  const bgUrl = (bg.url || '').trim();
  const hasBg = !!bgUrl;

  body.innerHTML = `<div class="panel"><b>🎯 Donation goal bar</b><div class="muted">Shows under the header on every page. With automatic updates on, “raised so far” follows your Patreon by itself (set up once — see SETUP-FEATURES.md).</div>
    <form id="fsGoal" class="xform"><label class="xcheck"><input type="checkbox" name="enabled" ${g.enabled !== false ? 'checked' : ''}> <span>Show the bar</span></label>
    <label class="xcheck"><input type="checkbox" name="auto" ${g.auto !== false ? 'checked' : ''}> <span>Update “raised so far” automatically from Patreon</span></label>
    <div class="xrow"><label class="xgrow">Title<input name="title" maxlength="60" value="${esc(g.title || 'Monthly hosting')}"></label><label>Currency<input name="currency" maxlength="3" value="${esc(g.currency || '$')}"></label><label>Raised so far<input name="current" type="number" min="0" step="any" value="${esc(g.current ?? 0)}" ${g.auto !== false ? 'readonly title="Filled in automatically from Patreon"' : ''}></label><label>Goal<input name="goal" type="number" min="1" step="any" value="${esc(g.goal ?? 50)}"></label></div>
    <label>Link (https)<input name="url" value="${esc(g.url || '')}" placeholder="https://www.patreon.com/…"></label><label>Hover note (optional)<input name="note" maxlength="120" value="${esc(g.note || '')}"></label>
    <div class="xactions"><button class="xbtn primary" type="submit">Save</button><button class="xbtn" type="button" id="fsPatreon">Sync from Patreon now</button><span class="muted" id="fsGoalMsg"></span></div>
    <div class="muted fsmall" id="fsGoalSync">${g.synced_at ? `Last Patreon sync: <b>${esc(new Date(g.synced_at).toLocaleString())}</b>${g.patrons != null ? ` · ${fmtNum(g.patrons)} active patrons` : ''}${g.mode === 'lifetime' ? ' · counting lifetime support' : ' · counting monthly pledges'}.` : 'Not synced from Patreon yet.'}</div></form></div>

    <div class="panel"><b>🖼 Background image / video</b>
      <div class="muted">Site-wide wallpaper for every visitor. Upload an image or an MP4/WebM video. A fixed dark overlay keeps the UI readable.</div>
      <form id="fsBg" class="xform" style="margin-top:10px">
        <label>Upload file<input name="file" type="file" accept="video/mp4,video/webm,image/png,image/jpeg,image/webp,image/gif"></label>
        <div class="muted fsmall" id="fsBgStatus">${hasBg ? (bgUrl.startsWith('data:video') || /\.(mp4|webm|ogg)(\?|$)/i.test(bgUrl) ? 'Current: video set' : 'Current: image set') : 'No custom background — using theme default.'}</div>
        <div class="xactions">
          <button class="xbtn primary" type="submit">Save for everyone</button>
          <button class="xbtn" type="button" id="fsBgClear">Clear</button>
          <span class="muted" id="fsBgMsg"></span>
        </div>
      </form>
    </div>

    <div class="fgrid2"><div class="panel"><b>🔔 Push notifications</b><div class="muted">One-time setup: generate keys with <code>npx web-push generate-vapid-keys</code>, put the <b>public</b> key here and both keys in the function secrets (see SETUP-FEATURES.md).</div>
    <form id="fsPush" class="xform"><label>VAPID public key<input name="k" value="${esc(vp)}" placeholder="B…"></label><div class="xactions"><button class="xbtn primary" type="submit">Save key</button><span class="muted">${vp ? '✓ key saved' : 'not set'}</span></div></form>
    <hr><b>📣 Send an announcement</b><form id="fsAnn" class="xform"><label>Title<input name="t" required maxlength="100"></label><label>Message<textarea name="m" rows="2" maxlength="300"></textarea></label><label>Link when tapped (optional, e.g. ?view=events)<input name="u" maxlength="300"></label>
    <label>Schedule for later (optional)<input name="when" type="datetime-local" title="Leave empty to send now"></label>
    <div class="xactions"><button class="xbtn primary" type="submit">Send / schedule</button><span class="muted" id="fsAnnMsg"></span></div></form>
    <div id="fsAnnSched" class="muted" style="margin-top:8px"></div></div></div>`;
  paintScheduledAnnouncements();
}
document.addEventListener('submit', async e => {
  const f = e.target;
  if (f.id === 'fsGoal') {
    e.preventDefault(); const msg = $('#fsGoalMsg'), url = f.url.value.trim();
    if (url && !okUrl(url)) return void (msg.textContent = 'The link must start with https://');
    const value = { ...(goal || {}), enabled: f.enabled.checked, auto: f.auto.checked, title: f.title.value.trim().slice(0, 60), currency: f.currency.value.trim().slice(0, 3) || '$', current: Math.max(0, +f.current.value || 0), goal: Math.max(1, +f.goal.value || 1), url, note: f.note.value.trim().slice(0, 120) };
    const { error } = await sb().from('site_settings').upsert({ key: 'donation_goal', value, updated_at: new Date().toISOString() }); if (error) return void (msg.textContent = errText(error));
    goal = value; cacheSetting('donation_goal', value); paintGoal(); msg.textContent = 'Saved ✓'; logMod('update donation goal', value.title, `${value.current}/${value.goal}`);
  }
  if (f.id === 'fsPush') { e.preventDefault(); const k = f.k.value.trim(); if (k && !/^[A-Za-z0-9_-]{60,100}$/.test(k)) return toast('That doesn’t look like a VAPID public key.'); const { error } = await sb().from('site_settings').upsert({ key: 'push', value: { public_key: k }, updated_at: new Date().toISOString() }); if (!error) cacheSetting('push', { public_key: k }); toast(error ? errText(error) : 'Key saved.'); }
  if (f.id === 'fsAnn') {
    e.preventDefault(); const msg = $('#fsAnnMsg'), btn = f.querySelector('button[type=submit]') || $('button', f);
    const title = f.t.value.trim(), body = f.m.value.trim(), url = f.u.value.trim(), when = f.when && f.when.value;
    if (when) {
      const ts = new Date(when).getTime();
      if (!ts || ts < Date.now() + 60000) return void (msg.textContent = 'Pick a time at least 1 minute from now.');
      btn.disabled = true; msg.textContent = 'Scheduling…';
      const list = await loadScheduledAnnouncements();
      list.push({ id: 'a' + Date.now().toString(36), title, body, url, ts, by: (user && user.username) || 'admin' });
      list.sort((a, b) => a.ts - b.ts);
      const { error } = await sb().from('site_settings').upsert({ key: 'scheduled_announcements', value: list, updated_at: new Date().toISOString() });
      btn.disabled = false;
      if (error) return void (msg.textContent = errText(error));
      msg.textContent = 'Scheduled for ' + new Date(ts).toLocaleString() + ' ✓';
      f.reset(); paintScheduledAnnouncements(); logMod('schedule announcement', title, new Date(ts).toISOString());
      return;
    }
    if (!confirm('Send this to everyone’s inbox and push devices now?')) return;
    btn.disabled = true; msg.textContent = 'Sending…';
    const r = await sb().functions.invoke('push-notify', { body: { broadcast: { title, body, url } } }); btn.disabled = false;
    const err = await fnMsg(r); if (err || (r.data && r.data.ok === false)) return void (msg.textContent = err || r.data.error);
    msg.textContent = `Sent: ${r.data.sent} push, ${r.data.users} inboxes ✓`; f.reset(); logMod('announcement', title || 'announcement');
  }
});

document.addEventListener('click', async e => {
  if (e.target.id !== 'fsPatreon') return;
  const btn = e.target, msg = $('#fsGoalMsg'); btn.disabled = true; msg.textContent = 'Asking Patreon…';
  try {
    const client = sb();
    let data = null, errText = '';

    // Primary: supabase-js invoke
    try {
      const r = await client.functions.invoke('patreon-sync', { body: {} });
      const err = await fnMsg(r);
      if (err) errText = err;
      else if (r.data && r.data.ok === false) errText = r.data.error || 'Sync failed';
      else data = r.data;
    } catch (x) {
      errText = x.message || 'invoke failed';
    }

    // Fallback: direct fetch (helps when invoke reports "Failed to send a request to the Edge Function")
    if (!data && /failed to send|fetch|network|function could not be reached|is it deployed/i.test(errText || '')) {
      msg.textContent = 'Retrying via direct request…';
      const { data: sessWrap } = await client.auth.getSession();
      const token = sessWrap && sessWrap.session && sessWrap.session.access_token;
      if (!token) throw new Error('Sign in again, then retry Sync.');
      const base = (client.supabaseUrl || 'https://ntietoxpxrmssceavqqw.supabase.co').replace(/\/$/, '');
      const res = await fetch(base + '/functions/v1/patreon-sync', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'apikey': client.supabaseKey || '',
          'Content-Type': 'application/json'
        },
        body: '{}'
      });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      if (!res.ok) {
        errText = (body && (body.error || body.message)) || (`HTTP ${res.status} — deploy with: supabase functions deploy patreon-sync --no-verify-jwt`);
        data = null;
      } else if (body && body.ok === false) {
        errText = body.error || 'Sync failed';
        data = null;
      } else {
        data = body;
        errText = '';
      }
    }

    if (!data) {
      msg.textContent = errText || 'Sync failed';
      // Helpful deploy hint when the function is missing
      if (/failed to send|not found|404|deploy/i.test(errText || '')) {
        msg.textContent = (errText || 'Edge Function unreachable') + ' — run: supabase functions deploy patreon-sync --no-verify-jwt';
      }
    } else {
      await loadGoal();
      const f = $('#fsGoal');
      if (f && goal) { f.current.value = goal.current ?? 0; f.auto.checked = goal.auto !== false; }
      const info = $('#fsGoalSync');
      if (info && goal) info.innerHTML = `Last Patreon sync: <b>${esc(new Date(goal.synced_at || Date.now()).toLocaleString())}</b>${goal.patrons != null ? ` · ${fmtNum(goal.patrons)} active patrons` : ''}.`;
      const cur = (data && data.current != null) ? data.current : (goal && goal.current);
      msg.textContent = `Synced ✓ ${(goal && goal.currency) || '$'}${fmtNum(cur)} raised`;
    }
  } catch (x) {
    msg.textContent = (x.message || 'Could not reach the function') + ' — deploy: supabase functions deploy patreon-sync --no-verify-jwt';
  }
  btn.disabled = false;
});

/* ----- site-wide rain + background image (admin Settings) ----- */
document.addEventListener('click', async e => {
  if (e.target.id === 'fsBgClear') {
    e.target.disabled = true;
    const msg = document.getElementById('fsBgMsg');
    if (msg) msg.textContent = 'Clearing…';
    const value = { url: '', overlay: 0.55 };
    const oldUrl = bgCurrentUrl();
    const { error } = await sb().from('site_settings').upsert({
      key: 'background', value, updated_at: new Date().toISOString()
    });
    e.target.disabled = false;
    if (error) { if (msg) msg.textContent = errText(error); return toast(errText(error)); }
    bgRemoveOld(oldUrl);   // free the storage space (only touches files in our own bucket)
    cacheSetting('background', value);
    if (window.PdxBackground) PdxBackground.applyFromServer(value);
    if (msg) msg.textContent = 'Cleared ✓';
    toast('Background cleared — using default theme');
    logMod('background', 'cleared');
    return;
  }
});


/* Background files go to Supabase Storage (bucket "site-assets", see background-storage.sql); only the short public URL is saved in
   site_settings. (Saving the file itself as a base64 string in that row is what caused "canceling statement due to statement timeout".) */
const BG_BUCKET = 'site-assets';
const BG_EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
// path of one of our own uploads inside the bucket (so an old file can be deleted when it is replaced or cleared)
function bgStoragePath(url) {
  const m = /\/storage\/v1\/object\/public\/site-assets\/([^?#]+)/.exec(String(url || ''));
  return m ? decodeURIComponent(m[1]) : '';
}
async function bgRemoveOld(url) {
  const path = bgStoragePath(url);
  if (path) { try { await sb().storage.from(BG_BUCKET).remove([path]); } catch {} }   // best effort — never blocks the save
}
function bgCurrentUrl() {
  const row = IC.settings && IC.settings.rows && IC.settings.rows.find(r => r.key === 'background');
  return ((row && row.value && row.value.url) || (window.PdxBackground && PdxBackground.get().url) || '').trim();
}
function bgStorageHint(err) {
  const m = String((err && (err.message || err.error)) || '');
  if (/bucket not found/i.test(m)) return 'The “site-assets” storage bucket doesn’t exist yet — run background-storage.sql in the Supabase SQL Editor.';
  if (/row-level security|not authorized|unauthorized|policy/i.test(m)) return 'Upload blocked — run background-storage.sql in Supabase (it lets admins upload to the bucket) and make sure you’re logged in as an admin.';
  if (/exceeded the maximum|too large|payload/i.test(m)) return 'Supabase rejected the file as too large. Raise the limit in Supabase → Storage → Settings → “Upload file size limit” (needs a paid plan above 50 MB), then try again.';
  if (/mime|not supported|invalid.*type/i.test(m)) return 'That file type isn’t allowed. Use MP4, WebM, PNG, JPG, WebP or GIF.';
  return m || 'Upload failed';
}

document.addEventListener('submit', async e => {
  const f = e.target;
  if (f.id !== 'fsBg') return;
  e.preventDefault();
  const msg = document.getElementById('fsBgMsg'), btn = f.querySelector('button[type="submit"]');
  const say = t => { if (msg) msg.textContent = t; };
  const file = f.file && f.file.files && f.file.files[0];
  if (!file) { say('Choose a file first'); return toast('Choose an image or video file to upload'); }

  const ext = BG_EXT[file.type] || '';
  if (!ext) {
    say('Unsupported file type');
    return toast('Use an MP4 or WebM video, or a PNG / JPG / WebP / GIF image.' + (/\.(mov|mkv|avi|hevc)$/i.test(file.name) ? ' (Convert .mov/.mkv/.avi to MP4 first.)' : ''));
  }
  const mb = file.size / 1048576;

  if (btn) btn.disabled = true;
  try {
    say(`Uploading ${mb.toFixed(1)} MB… (keep this tab open)`);
    const path = `background/${Date.now()}.${ext}`;   // unique name → no stale CDN/browser cache when replaced
    const { error: upErr } = await sb().storage.from(BG_BUCKET).upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
    if (upErr) { say(bgStorageHint(upErr)); return toast(bgStorageHint(upErr), 8000); }
    const { data: pub } = sb().storage.from(BG_BUCKET).getPublicUrl(path);
    const url = pub && pub.publicUrl;
    if (!url) { say('Could not get the file URL'); return toast('Upload worked but no public URL came back — is the bucket public?'); }

    say('Saving…');
    const oldUrl = bgCurrentUrl();
    const value = { url, overlay: 0.55 };
    const { error } = await sb().from('site_settings').upsert({ key: 'background', value, updated_at: new Date().toISOString() });
    if (error) {
      await bgRemoveOld(url);   // don't leave an orphaned upload behind
      say(errText(error)); return toast(errText(error));
    }
    cacheSetting('background', value);
    if (window.PdxBackground) PdxBackground.applyFromServer(value);
    if (oldUrl && oldUrl !== url) bgRemoveOld(oldUrl);
    const st = document.getElementById('fsBgStatus');
    if (st) st.textContent = ext === 'mp4' || ext === 'webm' || ext === 'ogg' ? 'Current: video set' : 'Current: image set';
    f.reset();
    say('Saved ✓ — everyone will see this');
    toast('Background updated for everyone');
    logMod('background', 'uploaded file', `${file.name} (${mb.toFixed(1)} MB)`);
  } catch (err) {
    say(bgStorageHint(err)); toast(bgStorageHint(err), 8000);
  } finally {
    if (btn) btn.disabled = false;
  }
});

/* =====================================================================================================
   wiring: login/logout, view changes
   ===================================================================================================== */
async function onLogin(detail) {
  if (user && user.id === detail.id) { user = detail; paintAdminTab(); return; }
  user = detail; paintAdminTab(); B.mine = new Map(); N.ch = null;
  if (isMod()) { prefetchInsights(); if (isAdmin()) processDueAnnouncements(); }   // so every Insights sub-tab opens instantly
  await loadBadges(true); checkMilestones(); if (document.body.dataset.view === 'badges') renderBadges();
  loadNotifs(); listenNotifs(); setTimeout(() => scanMatches(false), 6000); paintMatchPanel(); decorateCodes();
  currentSub().then(s => { if (s && Notification.permission === 'granted') saveSub(s); });   // keeps the device tied to whoever is logged in + current time zone
  onView(document.body.dataset.view);
}
window.addEventListener('pdx:login', e => onLogin(e.detail));
window.addEventListener('pdx:logout', () => {
  user = null; for (const k of Object.keys(IC)) delete IC[k]; B.mine = new Map(); N.rows = []; N.unread = 0; N.loaded = false; paintBell(); paintAdminTab(); paintMatchPanel();
  if (N.ch && sb()) { try { sb().removeChannel(N.ch); } catch {} } N.ch = null; closeModal();
  const v = document.body.dataset.view; if (v === 'insights') { P() && P().setView('dex'); } else onView(v);
});
function onView(v) {
  if (v === 'badges') renderBadges();
  else if (v === 'insights') renderInsights();
  else if (v === 'dashboard') { ensureCalc(); paintMatchPanel(); if (user && Date.now() - MS.last > 120000) scanMatches(false); }
}
new MutationObserver(() => onView(document.body.dataset.view)).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });

ensureShell(); paintAdminTab(); loadGoal();
if (window.PDX_USER) onLogin(window.PDX_USER);
setTimeout(() => {
  ensureShell(); loadGoal();
  const q = new URLSearchParams(location.search).get('view');
  if (q === 'badges' && P() && !/^#/.test(location.hash)) P().setView('badges', 'replace');
  const v = document.body.dataset.view; if (v) onView(v);
}, 700);
})();
