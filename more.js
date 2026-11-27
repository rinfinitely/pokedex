/* more.js — extra tracker tools (loads after features.js; needs window.PDX from app.js).
   Everything here is client-side and stored in this browser (localStorage keys start with "pdx.more.").
   Features: bulk select · missing lists per generation · form-family progress · living/national dex modes · regional form filters ·
   released/unreleased filter · variant tracker + completion bars (Mega/Dynamax/Gigantamax/XXL/XXS/…) · titles · trophy case ·
   event countdown + .ics export · automatic backup snapshots · seasonal skins · shiny sparkles ·
   skeleton screens · error log + real-user timing · costume checklist · showcase 6 · badge frames ·
   currently-available filter · events calendar · seasonal tracks · track tabs by category. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const P = () => window.PDX || null;
const K = 'pdx.more.';
const store = {
  get(k) { try { return localStorage.getItem(K + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(K + k, v); return true; } catch { return false; } },
  json(k, d) { try { const v = JSON.parse(localStorage.getItem(K + k) || 'null'); return v == null ? d : v; } catch { return d; } },
  save(k, v) { return store.set(k, JSON.stringify(v)); }
};
const pad = n => String(n).padStart(2, '0');
const debounce = (fn, ms) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const fmtDate = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDateTime = t => { const d = new Date(t); return d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const SPRITES = 'https://raw.githubusercontent.com/rinfinitely/pokedex/main/sprites';
const GEN_MAX = [151, 251, 386, 493, 649, 721, 809, 905, 1025];
const genOf = id => { id = +id; for (let i = 0; i < GEN_MAX.length; i++) if (id <= GEN_MAX[i]) return i + 1; return 9; };
const spriteUrl = (id, shiny) => `${SPRITES}/${shiny ? 'shiny' : 'normal'}/gen%20${genOf(id)}/pm${id}${shiny ? '.s' : ''}.icon.png`;

const dexEntry = (id) => {
  const p = P();
  if (!p) return {};
  if (typeof p.entry === 'function') return p.entry(id) || {};
  const d = p.data || {};
  return d[id] || {};
};


/* ---------- toast + modal ---------- */
let toastBox;
function toast(msg, opt = {}) {
  if (!toastBox) { toastBox = document.createElement('div'); toastBox.id = 'mToast'; toastBox.setAttribute('role', 'status'); toastBox.setAttribute('aria-live', 'polite'); document.body.append(toastBox); }
  const t = document.createElement('div'); t.className = 'mtoastmsg';
  const span = document.createElement('span'); span.textContent = msg; t.append(span);
  if (opt.action) { const b = document.createElement('button'); b.type = 'button'; b.textContent = opt.action; b.onclick = () => { try { opt.onAction && opt.onAction(); } finally { t.remove(); } }; t.append(b); }
  toastBox.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, opt.ms || 5000);
}
function closeModal() { const m = $('#mModal'); if (m) m.remove(); document.removeEventListener('keydown', escClose); }
const escClose = e => { if (e.key === 'Escape') closeModal(); };
function modal(html, cls = '') {
  closeModal();
  const back = document.createElement('div'); back.className = 'mmodalback'; back.id = 'mModal';
  back.innerHTML = `<div class="mmodal ${cls}" role="dialog" aria-modal="true"><button class="mclose" type="button" aria-label="Close">✕</button>${html}</div>`;
  back.addEventListener('mousedown', e => { if (e.target === back) closeModal(); });
  $('.mclose', back).onclick = closeModal;
  document.body.append(back); document.addEventListener('keydown', escClose);
  return $('.mmodal', back);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.append(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch { return false; }
}
function download(name, text, type = 'application/json') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function setSel(sel, v) { const el = $(sel); if (!el) return; el.value = v; el.dispatchEvent(new Event(el.tagName === 'INPUT' ? 'input' : 'change', { bubbles: true })); }
const goGrid = () => { const g = $('.sectionhead.dexonly') || $('#grid'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

/* ---------- labels ---------- */
const VARIANTS = [['mega', 'Mega'], ['dynamax', 'Dynamax'], ['gigantamax', 'Gigantamax'], ['shadow', 'Shadow'], ['purified', 'Purified'], ['lucky', 'Lucky'],
  ['perfect', 'Hundo (100% IV)'], ['nundo', 'Nundo (0% IV)'], ['xxl', 'XXL'], ['xxs', 'XXS'], ['costume', 'Costume']];
/* Grouped for the Track tabs UI */
const VARIANT_GROUPS = [
  { label: 'Forms', items: [['', 'Standard'], ['regional', 'Regional'], ['mega', 'Mega'], ['dynamax', 'Dynamax'], ['gigantamax', 'Gigantamax'], ['costume', 'Costume']] },
  { label: 'Status', items: [['shadow', 'Shadow'], ['purified', 'Purified'], ['lucky', 'Lucky']] },
  { label: 'Size / IV', items: [['xxl', 'XXL'], ['xxs', 'XXS'], ['location', 'Location Background'], ['perfect', 'Hundo'], ['special', 'Special Background'], ['nundo', 'Nundo']] }
];
/* Icons for every Track tab: the site's own PNG icons where they exist, an emoji otherwise. */
const TRACK_EMOJI = { '': '⚪', regional: '🌍', dynamax: '💥', costume: '🎩', lucky: '🍀', xxl: '🐘', xxs: '🐭' };
function trackIco(k, shiny) {
  const T = (P() && P().TAB_ICO) || {};
  const one = T[k] ? `<img class="tico" src="${T[k]}" alt="" draggable="false">` : `<span class="tico emo" aria-hidden="true">${TRACK_EMOJI[k] || '•'}</span>`;
  if (!shiny) return one;
  const sh = P() && P().SHINY_ICO;
  return (sh ? `<img class="tico shi" src="${sh}" alt="" draggable="false">` : '') + (k ? one : '');
}
const TAB_LABEL = { caught: 'Standard', location: 'Location Background', special: 'Special Background', shiny: 'Shiny', shiny_location: 'Shiny Location Background', shiny_special: 'Shiny Special Background', regional: 'Regional', shiny_regional: 'Shiny Regional' };
for (const [k, n] of VARIANTS) { TAB_LABEL[k] = n; TAB_LABEL['shiny_' + k] = 'Shiny ' + n; }
const blankEntry = () => ({ caught: false, shiny: false, shadow: false, purified: false, lucky: false, perfect: false, nundo: false, mega: false, dynamax: false, gigantamax: false, male: false, female: false, costumes: [] });
const markDirty = () => document.dispatchEvent(new Event('pdx:dex'));   // tells extras.js to sync to the cloud and features.js to re-check badges

/* ================= tools panel ================= */
const settings = Object.assign({ avail: 'all', regional: '', sparkles: true, skin: 'default' }, store.json('settings', {}));
const saveSettings = () => store.save('settings', settings);
const REGIONS = [['alola', 'Alolan'], ['galar', 'Galarian'], ['hisui', 'Hisuian'], ['paldea', 'Paldean']];

function buildPanel() {
  const bar = $('.toolbar.dexonly'); if (!bar || $('#moreTools')) return;
  const panel = document.createElement('div');
  panel.className = 'moretools'; panel.id = 'moreTools';
  panel.innerHTML = `
  <div class="mrow">
    <div class="mgroup" title="In GO = species already released in Pokémon GO. Unreleased = species not in GO yet (works with every generation filter)."><span class="mlabel">Availability</span>
      <span class="mseg" id="mAvail"><button type="button" data-v="all">All</button><button type="button" data-v="released">In GO</button><button type="button" data-v="unreleased">Unreleased</button></span></div>
    <div class="mgroup mtrackgroup"><span class="mlabel">Track</span>
      <div class="mtracktabs" id="mTrackTabs" role="tablist" aria-label="Track variant">
        ${VARIANT_GROUPS.map(g => `<div class="mtrackcat"><div class="mtrackseg">${g.items.map(([k, n]) => `<span class="mpair"><button type="button" data-track="${k}" data-shiny="0" class="mtrackbtn">${trackIco(k, false)}${esc(n)}</button><button type="button" data-track="${k}" data-shiny="1" class="mtrackbtn mtrackshiny" title="Shiny ${esc(n)}">${trackIco(k, true)}Shiny ${esc(n)}</button></span>`).join('')}</div></div>`).join('')}
      </div>
    </div>
    <span class="minfo" id="mFilterInfo"></span>
  </div>
  <div class="mrow mtools">
    <button type="button" class="mbtn" id="mProgress">📈 Progress</button>
  </div>`;
  bar.append(panel);   // lives inside the filter panel: one combined panel
  // countdown strip: visible on every page, right under the tab bar
  const vb = $('#viewbar');
  if (vb && !$('#mCountdown')) { const c = document.createElement('div'); c.id = 'mCountdown'; c.hidden = true; vb.after(c); }
}

/* ================= filters (DOM level, re-applied after every render) ================= */
function syncSegs() {
  $$('#mAvail button').forEach(b => b.classList.toggle('on', b.dataset.v === settings.avail));
  const act = (P() && P().active) || 'caught';
  const sh = act === 'shiny' || act.startsWith('shiny_');
  const base = act === 'shiny' ? '' : sh ? act.slice(6) : (act === 'caught' ? '' : act);
  $$('#mTrackTabs .mtrackbtn').forEach(b => {
    const tb = b.dataset.track || '';
    const ts = b.dataset.shiny === '1';
    const on = (tb === base || (tb === '' && (base === '' || base === 'caught'))) && ts === sh;
    b.classList.toggle('on', !!on);
  });
}
function applyFilters() {
  const grid = $('#grid'); if (!grid) return;
  let hidden = 0, total = 0;
  for (const c of grid.children) {
    if (!c.classList || !c.classList.contains('card')) continue;
    total++;
    const unrel = c.classList.contains('unreleased');
    let hide = false;
    c.classList.toggle('m-hide', hide);
    if (hide) hidden++;
  }
  const info = $('#mFilterInfo');
  if (info) info.textContent = settings.avail === 'released' ? 'Showing released Pokémon only' : settings.avail === 'unreleased' ? 'Showing unreleased Pokémon only' : '';
  syncSegs();
}
function wireFilters() {
  // Living dex only — always one card per species on Standard/Shiny
  try { setSel('#formView', 'base'); } catch {}
  const fv = $('#formView'); if (fv) { fv.value = 'base'; fv.disabled = true; fv.title = 'Living dex: one card per species'; }
  $('#mAvail') && $('#mAvail').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; settings.avail = b.dataset.v; saveSettings(); syncSegs(); if (P() && P().setAvail) P().setAvail(settings.avail); applyFilters(); });
  const trackBox = $('#mTrackTabs');
  if (trackBox) trackBox.addEventListener('click', e => {
    const b = e.target.closest('.mtrackbtn'); if (!b || !P()) return;
    const v = b.dataset.track || '';
    const sh = b.dataset.shiny === '1';
    P().setTab(v ? (sh ? 'shiny_' + v : v) : (sh ? 'shiny' : 'caught'));
    syncSegs();
  });
  let raf = 0;
  new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { applyFilters(); pruneSel(); }); }).observe($('#grid'), { childList: true });
  document.addEventListener('pdx:tab', syncSegs);
}

/* ================= bulk select ================= */
let bulk = false; const sel = new Set(); let lastPick = null;
const MARKS = [['tab', 'This tab’s Owned box'], ['caught', 'Registered (caught)'], ['shiny', 'Shiny'], ['shadow', 'Shadow'], ['purified', 'Purified'], ['lucky', 'Lucky'],
  ['perfect', 'Hundo (100% IV)'], ['nundo', 'Nundo (0% IV)'], ['xxl', 'XXL'], ['xxs', 'XXS']];
function buildBulkBar() {
  if ($('#bulkBar')) return;
  const b = document.createElement('div'); b.id = 'bulkBar'; b.className = 'mbar'; b.hidden = true;
  b.innerHTML = `<b id="bulkN">0 selected</b>
    <button type="button" data-a="all">Select all shown</button><button type="button" data-a="missing">Select missing</button><button type="button" data-a="clear">Clear</button>
    <label class="mchk">Mark as <select id="bulkMark">${MARKS.map(m => `<option value="${m[0]}">${m[1]}</option>`).join('')}</select></label>
    <button type="button" class="mprimary" data-a="on">✓ Mark</button><button type="button" data-a="off">✕ Unmark</button>
    <button type="button" data-a="exit">Done</button>`;
  document.body.append(b);
  b.addEventListener('click', e => {
    const a = e.target.closest('button'); if (!a) return;
    const act = a.dataset.a;
    if (act === 'all') pickAll(c => true); else if (act === 'missing') pickAll(c => !c.classList.contains('caught'));
    else if (act === 'clear') { clearSel(); } else if (act === 'on') applyBulk(true); else if (act === 'off') applyBulk(false); else if (act === 'exit') setBulk(false);
  });
}
const shownCards = () => $$('#grid .card[data-id]:not(.m-hide):not(.unreleased)');
function updateBar() { const n = sel.size; const el = $('#bulkN'); if (el) el.textContent = `${n} selected`; }
function clearSel() { sel.forEach(c => c.classList.remove('m-sel')); sel.clear(); lastPick = null; updateBar(); }
function pruneSel() { for (const c of [...sel]) if (!c.isConnected) sel.delete(c); updateBar(); }
function pickAll(test) { shownCards().forEach(c => { if (test(c)) { sel.add(c); c.classList.add('m-sel'); } }); updateBar(); }
function setBulk(on) {
  bulk = on; document.body.classList.toggle('m-bulk', on);
  $('#bulkBar').hidden = !on; $('#mBulk') && $('#mBulk').classList.toggle('on', on);
  if (!on) clearSel(); else toast('Bulk mode: click cards to select (Shift-click selects a range).', { ms: 3500 });
}
function wireBulk() {
  buildBulkBar();
  $('#mBulk') && ($('#mBulk').onclick = () => setBulk(!bulk));
  $('#grid').addEventListener('click', e => {
    if (!bulk) return;
    const card = e.target.closest('.card'); if (!card) return;
    e.preventDefault(); e.stopPropagation();
    if (card.classList.contains('unreleased') || !card.dataset.id) { toast('That card can’t be bulk-edited.', { ms: 2000 }); return; }
    const list = shownCards();
    if (e.shiftKey && lastPick && list.includes(lastPick)) {
      const a = list.indexOf(lastPick), b = list.indexOf(card);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) { sel.add(list[i]); list[i].classList.add('m-sel'); }
    } else if (sel.has(card)) { sel.delete(card); card.classList.remove('m-sel'); } else { sel.add(card); card.classList.add('m-sel'); }
    lastPick = card; updateBar();
  }, true);
  document.addEventListener('keydown', e => { if (bulk && e.key === 'Escape' && !$('#mModal')) setBulk(false); });
}
function applyBulk(v) {
  if (!sel.size) { toast('Select some cards first.', { ms: 2500 }); return; }
  const d = P().data, mark = $('#bulkMark').value, undo = []; let n = 0;
  for (const card of sel) {
    const id = card.dataset.id; if (!id) continue;
    let key;
    if (mark === 'tab') { const inp = card.querySelector('input[data-key]'); if (!inp) continue; key = inp.dataset.key; } else key = mark;
    const had = d[id] ? Object.prototype.hasOwnProperty.call(d[id], key) : false;
    const prev = d[id] ? d[id][key] : undefined;
    const e = d[id] || (d[id] = blankEntry());
    if (!!e[key] === v) continue;
    undo.push([id, key, had, prev]); e[key] = v; n++;
  }
  if (!n) { toast(v ? 'Everything selected is already marked.' : 'Nothing selected was marked.', { ms: 2500 }); return; }
  P().setData(d); markDirty(); clearSel();
  toast(`${v ? 'Marked' : 'Unmarked'} ${n.toLocaleString()} card${n === 1 ? '' : 's'}.`, {
    action: 'Undo', ms: 9000, onAction: () => {
      const dd = P().data;
      for (const [id, key, had, prev] of undo) { if (!dd[id]) continue; if (had) dd[id][key] = prev; else delete dd[id][key]; }
      P().setData(dd); markDirty(); toast('Undone.', { ms: 2000 });
    }
  });
}

/* ================= missing lists per generation + form families ================= */
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const bar = (a, b) => `<span class="mbbar"><i style="width:${b ? (a / b * 100).toFixed(1) : 0}%"></i></span>`;
function openMissing() {
  if (!P() || !P().pokemon.length) { toast('The Pokédex is still loading.'); return; }
  const g = P().genProgress();
  const tabName = TAB_LABEL[g.tab] || 'this tab';
  const m = modal(`<h2>Missing &amp; form progress</h2><p class="mmuted">Based on the <b>${esc(tabName)}</b> tab (change tabs first to see another).</p>
    <div class="mtabs"><button type="button" class="on" data-t="gen">By generation</button><button type="button" data-t="fam">Form families</button></div><div id="mMissBody"></div>`, 'wide');
  const body = $('#mMissBody', m);
  const listText = (gen) => `Missing in ${gen.name} (Gen ${gen.n}) · ${tabName} — ${gen.missing.length}\n` +
    gen.missing.map(x => `#${String(x.id).padStart(4, '0')} ${x.name}${x.form ? ' (' + x.form + ')' : ''}`).join('\n');
  const showGen = () => {
    const all = g.gens.reduce((a, x) => ({ own: a.own + x.own, tot: a.tot + x.tot }), { own: 0, tot: 0 });
    body.innerHTML = `<div class="mlist">` + g.gens.map(x => `<div class="mrowbar">
        <span class="mbname">Gen ${x.n} · ${esc(x.name)}</span>${bar(x.own, x.tot)}<span class="mbnum">${x.own}/${x.tot} · ${x.tot - x.own} left</span>
        <span class="mbtns two"><button type="button" class="mbtn sm" data-show="${x.n}" ${x.tot === x.own ? 'disabled' : ''}>Show missing</button>
        <button type="button" class="mbtn sm" data-copy="${x.n}" ${x.tot === x.own ? 'disabled' : ''}>Copy list</button></span></div>`).join('') +
      `<div class="mrowbar mtotal"><span class="mbname">All generations</span>${bar(all.own, all.tot)}<span class="mbnum">${all.own}/${all.tot} · ${all.tot - all.own} left</span>
        <span class="mbtns two"><button type="button" class="mbtn sm" data-show="all">Show missing</button></span></div></div>`;
  };
  let famQ = '', famInc = true, famLim = 40;
  const showFam = () => {
    const fams = Object.values(g.fam).filter(f => f.tot > 1).sort((a, b) => (a.own / a.tot) - (b.own / b.tot) || a.id - b.id);
    body.innerHTML = `<div class="mfamtools"><input type="search" id="mFamQ" placeholder="Search species…" value="${esc(famQ)}"><label class="mchk"><input type="checkbox" id="mFamInc" ${famInc ? 'checked' : ''}> Incomplete only</label><span class="mmuted" id="mFamN"></span></div><div class="mlist" id="mFamList"></div>`;
    const draw = () => {
      const q = norm(famQ);
      const rows = fams.filter(f => (!famInc || f.own < f.tot) && (!q || norm(f.name).includes(q) || String(f.id) === famQ.trim()));
      $('#mFamN', body).textContent = `${rows.length} species with multiple forms`;
      $('#mFamList', body).innerHTML = rows.slice(0, famLim).map(f => `<div class="mfam" data-name="${esc(f.name)}"><div class="mrowbar"><span class="mbname">#${String(f.id).padStart(4, '0')} ${esc(f.name)}</span>${bar(f.own, f.tot)}<span class="mbnum">${f.own}/${f.tot}</span>
          <span class="mbtns"><button type="button" class="mbtn sm" data-find="${esc(f.name)}">Find</button></span></div>
          <div class="mchips">${f.forms.map(x => `<span class="mchip ${x.own ? 'own' : ''}">${esc(x.label)}</span>`).join('')}</div></div>`).join('') +
        (rows.length > famLim ? `<button type="button" class="mbtn" id="mFamMore">Show ${Math.min(40, rows.length - famLim)} more</button>` : '');
      const more = $('#mFamMore', body); if (more) more.onclick = () => { famLim += 40; draw(); };
    };
    $('#mFamQ', body).oninput = debounce(e => { famQ = e.target.value; famLim = 40; draw(); }, 120);
    $('#mFamInc', body).onchange = e => { famInc = e.target.checked; famLim = 40; draw(); };
    draw();
  };
  showGen();
  m.addEventListener('click', e => {
    const t = e.target.closest('[data-t]'); if (t) { $$('.mtabs button', m).forEach(b => b.classList.toggle('on', b === t)); t.dataset.t === 'gen' ? showGen() : showFam(); return; }
    const s = e.target.closest('[data-show]'); if (s) { closeModal(); setSel('#search', ''); setSel('#generation', s.dataset.show); setSel('#status', 'missing'); goGrid(); return; }
    const c = e.target.closest('[data-copy]'); if (c) { const gen = g.gens[+c.dataset.copy - 1]; copyText(listText(gen)).then(ok => toast(ok ? `Copied ${gen.missing.length} missing Pokémon.` : 'Could not copy.')); return; }
    const f = e.target.closest('[data-find]'); if (f) { closeModal(); setSel('#generation', 'all'); setSel('#status', 'all'); setSel('#search', f.dataset.find); goGrid(); }
  });
}

/* ================= progress bars (variants) + titles ================= */
function dexCounts() {
  const d = P().data, c = { shadow: 0, purified: 0, lucky: 0, perfect: 0, nundo: 0, mega: 0, dynamax: 0, gigantamax: 0, xxl: 0, xxs: 0 };
  for (const id in d) {
    if (!/^\d+$/.test(id)) continue; const e = d[id]; if (!e || typeof e !== 'object') continue;
    for (const k of Object.keys(c)) if (e[k] === true) c[k]++;
    if (!e.mega && Object.keys(e).some(k => k.startsWith('mega_') && e[k] === true)) c.mega++;
  }
  return c;
}
const TITLES = [
  { id: 'rookie', name: 'Rookie Trainer', icon: '🎒', hint: 'Everyone starts here', ok: () => true },
  { id: 'collector', name: 'Collector', icon: '📦', hint: 'Register 100 entries', ok: x => x.caught >= 100 },
  { id: 'dexpro', name: 'Dex Pro', icon: '📖', hint: 'Reach 25% completion', ok: x => x.pct >= 25 },
  { id: 'dexmaster', name: 'Dex Master', icon: '🎓', hint: 'Reach 50% completion', ok: x => x.pct >= 50 },
  { id: 'completionist', name: 'Completionist', icon: '👑', hint: 'Reach 90% completion', ok: x => x.pct >= 90 },
  { id: 'shinyhunter', name: 'Shiny Hunter', icon: '✨', hint: 'Register 10 shinies', ok: x => x.shiny >= 10 },
  { id: 'shinymaster', name: 'Shiny Master', icon: '🌟', hint: 'Register 100 shinies', ok: x => x.shiny >= 100 },
  { id: 'shinylegend', name: 'Shiny Legend', icon: '💫', hint: 'Register 500 shinies', ok: x => x.shiny >= 500 },
  { id: 'shadow', name: 'Shadow Wrangler', icon: '🌑', hint: 'Track 10 Shadow Pokémon', ok: x => x.shadow >= 10 },
  { id: 'purifier', name: 'Purifier', icon: '💧', hint: 'Track 10 Purified Pokémon', ok: x => x.purified >= 10 },
  { id: 'mega', name: 'Mega Evolver', icon: '🧬', hint: 'Track 10 Megas', ok: x => x.mega >= 10 },
  { id: 'hundo', name: 'Hundo Hunter', icon: '💯', hint: 'Track 10 Hundos', ok: x => x.perfect >= 10 },
  { id: 'lucky', name: 'Lucky Charm', icon: '🍀', hint: 'Track 25 Lucky Pokémon', ok: x => x.lucky >= 25 },
  { id: 'size', name: 'Size Matters', icon: '📏', hint: 'Track 10 XXL / XXS', ok: x => x.xxl + x.xxs >= 10 }
];
function titleCtx() { return Object.assign({}, P().summary(), dexCounts()); }
const earnedTitles = () => { const x = titleCtx(); return TITLES.filter(t => t.ok(x)); };
const myTitle = () => { const id = store.get('title'); const t = TITLES.find(t => t.id === id); return t && t.id !== 'rookie' ? t : null; };

function openProgress() {
  if (!P() || !P().pokemon.length) { toast('The Pokédex is still loading.'); return; }
  const groups = [
    ['Mega / Dynamax / Gigantamax', ['mega', 'dynamax', 'gigantamax', 'shiny_mega', 'shiny_dynamax', 'shiny_gigantamax']],
    ['Main', ['caught', 'shiny', 'costume', 'shiny_costume']],
    ['Variants', ['shadow', 'purified', 'lucky', 'perfect', 'nundo', 'xxl', 'xxs']],
    ['Shiny variants', ['shiny_shadow', 'shiny_purified', 'shiny_lucky', 'shiny_perfect', 'shiny_nundo', 'shiny_xxl', 'shiny_xxs']],
    ['Backgrounds', ['location', 'special', 'shiny_location', 'shiny_special']]
  ];
  const row = t => `<div class="mrowbar" data-row="${t}" hidden><span class="mbname">${esc(TAB_LABEL[t] || t)}</span>${bar(0, 0)}<span class="mbnum">…</span><span class="mbtns"><button type="button" class="mbtn sm" data-open="${t}">Open</button></span></div>`;
  const m = modal(`<h2>Progress</h2><div id="mSeasonBox"></div>` +
    groups.map(([n, l]) => `<h3>${n}</h3><div class="mlist">${l.map(row).join('')}</div>`).join('') +
    `<p class="mmuted">“Open” jumps to that tab so you can tick Pokémon off. Rows with nothing to collect are hidden.</p>`, 'wide');
  paintSeasonalTracks(m);
  const queue = $$('[data-row]', m);
  (function next() {
    const r = queue.shift(); if (!r || !$('#mModal')) return;
    const t = r.dataset.row; let res = { tot: 0, own: 0 };
    try { res = P().tabTotals([t]); } catch {}
    if (res.tot > 0) { r.hidden = false; $('.mbbar i', r).style.width = (res.own / res.tot * 100).toFixed(1) + '%'; $('.mbnum', r).textContent = `${res.own}/${res.tot} · ${pct(res.own, res.tot)}%`; }
    setTimeout(next, 0);
  })();
  m.addEventListener('click', e => {
    const o = e.target.closest('[data-open]'); if (o) { closeModal(); P().setTab(o.dataset.open); setTimeout(syncSegs, 30); goGrid(); return; }
    const t = e.target.closest('[data-title]'); if (t) { store.set('title', t.dataset.title); paintTitles(m); paintShelf(); toast('Title equipped: ' + TITLES.find(x => x.id === t.dataset.title).name, { ms: 2500 }); }
  });
}

/* ================= #76 Seasonal badge / goal tracks ================= */
const SEASON_TRACKS = [
  { id: 'spring', name: 'Spring track', icon: '🌸', hint: 'Catch & shiny goals for spring events', goals: [
    { label: 'Register 50 species', metric: 'caught', need: 50 },
    { label: '10 shinies', metric: 'shiny', need: 10 },
    { label: '5 special / costume', metric: 'special', need: 5 }
  ]},
  { id: 'summer', name: 'Summer track', icon: '☀️', hint: 'GO Fest & summer Community Days', goals: [
    { label: 'Register 100 species', metric: 'caught', need: 100 },
    { label: '25 shinies', metric: 'shiny', need: 25 },
    { label: '15 special / costume', metric: 'special', need: 15 }
  ]},
  { id: 'fall', name: 'Fall track', icon: '🍂', hint: 'Halloween & autumn events', goals: [
    { label: 'Register 200 species', metric: 'caught', need: 200 },
    { label: '40 shinies', metric: 'shiny', need: 40 },
    { label: '25 special / costume', metric: 'special', need: 25 }
  ]},
  { id: 'winter', name: 'Winter track', icon: '❄️', hint: 'Holiday events & year-end push', goals: [
    { label: 'Register 300 species', metric: 'caught', need: 300 },
    { label: '60 shinies', metric: 'shiny', need: 60 },
    { label: '40 special / costume', metric: 'special', need: 40 }
  ]}
];
function seasonMetric(metric) {
  const p = P(); if (!p) return 0;
  const s = p.summary ? p.summary() : {};
  if (metric === 'caught') return s.caught || 0;
  if (metric === 'shiny') return s.shiny || 0;
  if (metric === 'special') return s.special || 0;
  return 0;
}
function paintSeasonalTracks(m) {
  const box = $('#mSeasonBox', m); if (!box) return;
  const html = SEASON_TRACKS.map(tr => {
    const parts = tr.goals.map(g => {
      const val = seasonMetric(g.metric);
      const done = val >= g.need;
      const pct = Math.min(100, Math.round(val / g.need * 100));
      return `<div class="mrowbar"><span class="mbname">${esc(g.label)}</span><span class="mbbar"><i style="width:${pct}%"></i></span><span class="mbnum">${done ? '✓' : val + '/' + g.need}</span></div>`;
    }).join('');
    const complete = tr.goals.every(g => seasonMetric(g.metric) >= g.need);
    return `<div class="mseason ${complete ? 'done' : ''}"><div class="mseasonh">${tr.icon} <b>${esc(tr.name)}</b>${complete ? ' <span class="mchip own">Complete</span>' : ''}<small class="mmuted"> — ${esc(tr.hint)}</small></div>${parts}</div>`;
  }).join('');
  box.innerHTML = `<h3>Seasonal tracks</h3><p class="mmuted">Lightweight seasonal goals based on your current numbers. They reset only when you clear browser data.</p>${html}`;
}

function paintTitles(m) {
  const box = $('#mTitleBox', m); if (!box) return;
  const ctx = titleCtx(), cur = store.get('title') || 'rookie';
  box.innerHTML = `<h3>Titles</h3><div class="mtitles">` + TITLES.map(t => {
    const ok = t.ok(ctx);
    return `<button type="button" class="mtitle ${ok ? '' : 'locked'} ${cur === t.id ? 'on' : ''}" ${ok ? `data-title="${t.id}"` : 'disabled'} title="${esc(t.hint)}">${ok ? t.icon : '🔒'} ${esc(t.name)}<small>${ok ? (cur === t.id ? 'Equipped' : 'Earned') : esc(t.hint)}</small></button>`;
  }).join('') + `</div><p class="mmuted">Your title shows next to your tools here. Titles are saved in this browser.</p>`;
}
function checkNewTitles() {
  return;   // titles were removed from the UI
  if (!P() || !P().pokemon.length) return;
  const ids = earnedTitles().map(t => t.id), seen = store.json('titlesSeen', null);
  if (seen === null) { store.save('titlesSeen', ids); return; }
  const fresh = ids.filter(i => !seen.includes(i));
  if (fresh.length) {
    store.save('titlesSeen', ids);
    const t = TITLES.find(x => x.id === fresh[0]);
    toast(`🎖 New title unlocked: ${t.name}!`, { ms: 9000, action: 'Equip', onAction: () => { store.set('title', t.id); paintShelf(); } });
  }
}

/* ================= trophy case ================= */
const TROPHY_KINDS = [['Shiny', '✨'], ['Hundo', '💯'], ['Shadow', '🌑'], ['Lucky', '🍀'], ['Mega', '🧬'], ['XXL', '🐘'], ['XXS', '🐭'], ['Costume', '🎩'], ['Event', '🎉'], ['Other', '⭐']];
const kindIcon = k => (TROPHY_KINDS.find(x => x[0] === k) || [0, '⭐'])[1];
const trophies = () => store.json('trophies', []);
function findDex(txt) {
  const v = String(txt || '').trim(); if (!v) return null;
  const list = P().pokemon;
  if (/^#?\d+$/.test(v)) { const n = +v.replace('#', ''); return list[n - 1] || null; }
  const q = norm(v);
  return list.find(p => norm(p.name) === q) || (() => { const c = list.filter(p => norm(p.name).startsWith(q)); return c.length === 1 ? c[0] : null; })();
}
function openTrophies() {
  if (!P() || !P().pokemon.length) { toast('The Pokédex is still loading.'); return; }
  const m = modal(`<h2>🏆 Trophy case</h2><p class="mmuted">Pin your rarest catches (up to 24) with a note. Saved in this browser.</p>
    <div class="mform">
      <input id="tName" list="mTrophyDl" placeholder="Pokémon name or #" autocomplete="off"><datalist id="mTrophyDl">${P().pokemon.map(p => `<option value="${esc(p.name)}">`).join('')}</datalist>
      <select id="tKind">${TROPHY_KINDS.map(k => `<option>${k[0]}</option>`).join('')}</select>
      <input id="tDate" type="date" value="${fmtDate(Date.now())}">
      <input id="tNote" maxlength="120" placeholder="Note (where / how you got it)">
      <button type="button" class="mbtn mprimary" id="tAdd">＋ Add</button></div>
    <div class="mtrophies" id="mTrophyGrid"></div>`, 'wide');
  const draw = () => {
    const list = trophies();
    $('#mTrophyGrid', m).innerHTML = list.length ? list.map((t, i) => {
      const p = P().pokemon[t.id - 1];
      return `<div class="mtrophy"><button type="button" class="mdel" data-del="${i}" aria-label="Remove">✕</button>
        <img src="${spriteUrl(t.id, t.kind === 'Shiny')}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity='.2'">
        <b>${esc(p ? p.name : '#' + t.id)}</b><span class="mchip own">${kindIcon(t.kind)} ${esc(t.kind)}</span>
        <small>${esc(t.date || '')}</small>${t.note ? `<em>${esc(t.note)}</em>` : ''}</div>`;
    }).join('') : '<div class="mempty">No trophies yet. Add your first rare catch above.</div>';
  };
  draw();
  $('#tAdd', m).onclick = () => {
    const p = findDex($('#tName', m).value);
    if (!p) { toast('Pick a Pokémon from the list (name or number).', { ms: 3000 }); return; }
    const list = trophies(); if (list.length >= 24) { toast('The case is full (24). Remove one first.', { ms: 3000 }); return; }
    list.unshift({ id: p.id, kind: $('#tKind', m).value, date: $('#tDate', m).value, note: $('#tNote', m).value.trim().slice(0, 120) });
    store.save('trophies', list); $('#tName', m).value = ''; $('#tNote', m).value = ''; draw(); paintShelf();
  };
  m.addEventListener('click', e => { const d = e.target.closest('[data-del]'); if (!d) return; const list = trophies(); list.splice(+d.dataset.del, 1); store.save('trophies', list); draw(); paintShelf(); });
}
function paintShelf() {
  const el = $('#mShelf'); if (!el) return;
  const t = myTitle(), list = trophies();
  if (!t && !list.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = (t ? `<span class="mtitlechip" title="Your equipped title">${t.icon} ${esc(t.name)}</span>` : '') +
    list.slice(0, 8).map(x => { const p = P().pokemon[x.id - 1]; return `<span class="mshelfitem" title="${esc((p ? p.name : '#' + x.id) + ' · ' + x.kind + (x.note ? ' — ' + x.note : ''))}"><img src="${spriteUrl(x.id, x.kind === 'Shiny')}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity='.2'"><i>${kindIcon(x.kind)}</i></span>`; }).join('') +
    (list.length ? `<button type="button" class="mlink" id="mShelfOpen">${list.length === 1 ? '1 trophy' : list.length + ' trophies'}</button>` : '');
  const o = $('#mShelfOpen'); if (o) o.onclick = openTrophies;
}

/* ================= event countdown + calendar (.ics) ================= */
const events = () => store.json('events', []);
const fmtLeft = ms => { const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
const evEnd = e => e.ts + (e.hours || 1) * 3600e3;
function paintCountdown() {
  const el = $('#mCountdown'); if (!el) return;
  const now = Date.now(), list = events().filter(e => evEnd(e) > now).sort((a, b) => a.ts - b.ts).slice(0, 3);
  if (!list.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = list.map(e => now >= e.ts
    ? `<span class="mcd live" title="${esc(e.note || '')}"><b>🔴 ${esc(e.name)}</b> <span>LIVE · ends in ${fmtLeft(evEnd(e) - now)}</span></span>`
    : `<span class="mcd" title="${esc(fmtDateTime(e.ts) + (e.note ? ' — ' + e.note : ''))}"><b>⏰ ${esc(e.name)}</b> <span>in ${fmtLeft(e.ts - now)}</span></span>`).join('') +
    `<button type="button" class="mlink" id="mCdOpen">Manage events</button>`;
  $('#mCdOpen').onclick = openEvents;
}
const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsFold = l => { let o = ''; while (l.length > 73) { o += l.slice(0, 73) + '\r\n '; l = l.slice(73); } return o + l; };
const icsDate = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function makeIcs(list) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GO Pokedex Tracker//Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of list) {
    L.push('BEGIN:VEVENT', `UID:${e.id}@go-pokedex-tracker`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(new Date(e.ts))}`, `DTEND:${icsDate(new Date(evEnd(e)))}`, `SUMMARY:${icsEsc(e.name)}`);
    if (e.note) L.push(`DESCRIPTION:${icsEsc(e.note)}`);
    L.push('BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(e.name)} starts in 30 minutes`, 'END:VALARM', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(icsFold).join('\r\n') + '\r\n';
}
function openEvents() {
  const now = new Date();
  let viewY = now.getFullYear(), viewM = now.getMonth(); // 0-based
  const m = modal(`<h2>⏰ Events &amp; calendar</h2><p class="mmuted">Community Days, raids, GO Fest… Next three appear under the tab bar. Download as .ics for Google / Apple / Outlook.</p>
    <div class="mcalhead"><button type="button" class="mbtn sm" id="calPrev">‹</button><b id="calTitle"></b><button type="button" class="mbtn sm" id="calNext">›</button><button type="button" class="mbtn sm" id="calToday">Today</button></div>
    <div class="mcal" id="mCal"></div>
    <div class="mform">
      <input id="eName" maxlength="60" placeholder="Event name (Community Day, Raid Hour…)" autocomplete="off">
      <input id="eWhen" type="datetime-local">
      <input id="eHours" type="number" min="0.5" max="168" step="0.5" value="3" title="Duration (hours)" style="width:5.5em">
      <input id="eNote" maxlength="120" placeholder="Note (optional)" autocomplete="off">
      <button type="button" class="mbtn mprimary" id="eAdd">＋ Add</button></div>
    <div class="mlist" id="mEvList"></div>
    <div class="mrow"><button type="button" class="mbtn" id="eIcsAll">📅 Download all upcoming (.ics)</button><button type="button" class="mbtn" id="eClearPast">Clear finished</button></div>`, 'wide');

  const monthName = (y, mo) => new Date(y, mo, 1).toLocaleString([], { month: 'long', year: 'numeric' });
  const drawCal = () => {
    $('#calTitle', m).textContent = monthName(viewY, viewM);
    const first = new Date(viewY, viewM, 1);
    const startDow = first.getDay(); // 0 Sun
    const daysIn = new Date(viewY, viewM + 1, 0).getDate();
    const list = events();
    const byDay = {};
    for (const e of list) {
      const d = new Date(e.ts);
      if (d.getFullYear() === viewY && d.getMonth() === viewM) {
        const day = d.getDate();
        (byDay[day] = byDay[day] || []).push(e);
      }
    }
    const today = new Date();
    let html = '<div class="mcalrow mcaldows">' + ['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => `<span>${d}</span>`).join('') + '</div>';
    let cells = [];
    for (let i = 0; i < startDow; i++) cells.push('<span class="mcalempty"></span>');
    for (let day = 1; day <= daysIn; day++) {
      const evs = byDay[day] || [];
      const isToday = today.getFullYear() === viewY && today.getMonth() === viewM && today.getDate() === day;
      const live = evs.some(e => Date.now() >= e.ts && Date.now() < evEnd(e));
      cells.push(`<button type="button" class="mcalday ${isToday ? 'today' : ''} ${evs.length ? 'has' : ''} ${live ? 'live' : ''}" data-day="${day}" title="${evs.map(e => e.name).join(', ')}"><b>${day}</b>${evs.length ? `<i>${evs.length}</i>` : ''}</button>`);
    }
    while (cells.length % 7) cells.push('<span class="mcalempty"></span>');
    for (let i = 0; i < cells.length; i += 7) html += '<div class="mcalrow">' + cells.slice(i, i + 7).join('') + '</div>';
    $('#mCal', m).innerHTML = html;
  };

  const draw = () => {
    const tnow = Date.now(), list = events().sort((a, b) => a.ts - b.ts);
    $('#mEvList', m).innerHTML = list.length ? list.map(e => {
      const over = evEnd(e) <= tnow;
      return `<div class="mevent ${over ? 'over' : ''}"><div><b>${esc(e.name)}</b><small>${esc(fmtDateTime(e.ts))} · ${e.hours || 1}h${e.note ? ' · ' + esc(e.note) : ''}</small></div>
        <span class="mcdn">${over ? 'finished' : tnow >= e.ts ? 'LIVE' : 'in ' + fmtLeft(e.ts - tnow)}</span>
        <button type="button" class="mbtn sm" data-ics="${e.id}">📅 .ics</button><button type="button" class="mbtn sm" data-rm="${e.id}">✕</button></div>`;
    }).join('') : '<div class="mempty">No events yet.</div>';
    drawCal();
  };
  draw();

  $('#calPrev', m).onclick = () => { viewM--; if (viewM < 0) { viewM = 11; viewY--; } drawCal(); };
  $('#calNext', m).onclick = () => { viewM++; if (viewM > 11) { viewM = 0; viewY++; } drawCal(); };
  $('#calToday', m).onclick = () => { viewY = now.getFullYear(); viewM = now.getMonth(); drawCal(); };
  m.addEventListener('click', e => {
    const dayBtn = e.target.closest('.mcalday[data-day]');
    if (dayBtn) {
      const day = +dayBtn.dataset.day;
      const dt = new Date(viewY, viewM, day, 12, 0);
      const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      $('#eWhen', m).value = local;
      $('#eName', m).focus();
    }
  });

  $('#eAdd', m).onclick = () => {
    const name = $('#eName', m).value.trim(), when = $('#eWhen', m).value;
    if (!name || !when) { toast('Give the event a name and a start time.', { ms: 3000 }); return; }
    const list = events(); if (list.length >= 40) { toast('Too many events — remove some first.', { ms: 3000 }); return; }
    list.push({ id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, ts: new Date(when).getTime(), hours: Math.max(.5, +$('#eHours', m).value || 1), note: $('#eNote', m).value.trim() });
    store.save('events', list); $('#eName', m).value = ''; $('#eNote', m).value = ''; draw(); paintCountdown();
  };
  m.addEventListener('click', e => {
    const i = e.target.closest('[data-ics]'), r = e.target.closest('[data-rm]');
    if (i) { const ev = events().find(x => x.id === i.dataset.ics); if (ev) download(norm(ev.name || 'event') + '.ics', makeIcs([ev]), 'text/calendar'); }
    if (r) { store.save('events', events().filter(x => x.id !== r.dataset.rm)); draw(); paintCountdown(); }
  });
  $('#eIcsAll', m).onclick = () => { const l = events().filter(e => evEnd(e) > Date.now()); if (!l.length) { toast('No upcoming events to export.', { ms: 2500 }); return; } download('go-dex-events.ics', makeIcs(l), 'text/calendar'); };
  $('#eClearPast', m).onclick = () => { store.save('events', events().filter(e => evEnd(e) > Date.now())); draw(); paintCountdown(); };
}

/* ================= automatic backup snapshots ================= */
const MAX_SNAPS = 7;
const b64enc = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const b64dec = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
async function pack(str) {
  if ('CompressionStream' in window) { try { const buf = await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(); return { z: b64enc(new Uint8Array(buf)) }; } catch {} }
  return { raw: str };
}
async function unpack(s) {
  if (s.raw != null) return s.raw;
  return await new Response(new Blob([b64dec(s.z)]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
const hasData = d => { for (const k in d) { const e = d[k]; if (!e || typeof e !== 'object') continue; if (k === 'bgs') { if (Object.values(e).some(Boolean)) return true; continue; } if (Object.values(e).some(v => v === true || (Array.isArray(v) && v.length))) return true; } return false; };
async function takeSnapshot(label) {
  const p = P(); if (!p || !hasData(p.data)) return false;
  const json = JSON.stringify({ version: 1, exported: new Date().toISOString(), pokemon: p.data, trade: p.trade });
  const snap = Object.assign({ t: Date.now(), label: label || 'auto', n: p.summary().caught, size: json.length }, await pack(json));
  let list = [snap, ...store.json('snaps', [])].slice(0, MAX_SNAPS);
  while (!store.save('snaps', list)) { if (list.length <= 1) return false; list.pop(); }   // storage full: drop the oldest until it fits
  return true;
}
async function autoSnapshot() {
  const last = (store.json('snaps', []).find(s => s.label === 'auto') || {}).t || 0;
  if (Date.now() - last > 20 * 3600e3) await takeSnapshot('auto');
}
function openBackups() {
  const m = modal(`<h2>💾 Backups</h2><p class="mmuted">A snapshot of your Pokédex and trade lists is saved automatically about once a day (last ${MAX_SNAPS}) in this browser. Restoring replaces your current progress, and a safety copy is taken first.</p>
    <div class="mrow"><button type="button" class="mbtn mprimary" id="bNow">＋ Snapshot now</button></div><div class="mlist" id="mSnapList"></div>`, 'wide');
  const draw = () => {
    const list = store.json('snaps', []);
    $('#mSnapList', m).innerHTML = list.length ? list.map((s, i) => `<div class="mevent"><div><b>${esc(fmtDateTime(s.t))}</b><small>${esc(s.label)} · ${s.n} registered · ${(s.size / 1024).toFixed(0)} KB${s.z ? ' (compressed)' : ''}</small></div><span></span>
      <button type="button" class="mbtn sm" data-dl="${i}">Download</button><button type="button" class="mbtn sm" data-rs="${i}">Restore</button><button type="button" class="mbtn sm" data-rm="${i}">✕</button></div>`).join('')
      : '<div class="mempty">No snapshots yet. They start once you have something registered.</div>';
  };
  draw();
  $('#bNow', m).onclick = async () => { const ok = await takeSnapshot('manual'); toast(ok ? 'Snapshot saved.' : 'Nothing to save yet (or the browser storage is full).', { ms: 3000 }); draw(); };
  m.addEventListener('click', async e => {
    const dl = e.target.closest('[data-dl]'), rs = e.target.closest('[data-rs]'), rm = e.target.closest('[data-rm]');
    const list = store.json('snaps', []);
    if (dl) { const s = list[+dl.dataset.dl]; if (s) download(`go-pokedex-backup-${fmtDate(s.t)}.json`, await unpack(s)); }
    if (rm) { list.splice(+rm.dataset.rm, 1); store.save('snaps', list); draw(); }
    if (rs) {
      const s = list[+rs.dataset.rs]; if (!s) return;
      if (!confirm(`Replace your current progress with the snapshot from ${fmtDateTime(s.t)}?\nA safety copy of the current state is saved first.`)) return;
      try {
        const j = JSON.parse(await unpack(s)); await takeSnapshot('before restore');
        P().setData(j.pokemon || {}); if (j.trade) P().setTrade(j.trade); markDirty();
        closeModal(); toast('Snapshot restored.', { ms: 4000 });
      } catch { toast('That snapshot could not be read.', { ms: 4000 }); }
    }
  });
}

/* ================= seasonal skins + effects ================= */
const SKINS = [['default', 'Default', '#6366f1'], ['gofest', 'GO Fest', '#00c2ff'], ['halloween', 'Halloween', '#ff7a1a'], ['holidays', 'Holidays', '#e5484d'], ['spring', 'Spring', '#f472b6'], ['auto', 'Auto (by season)', 'linear-gradient(90deg,#ff7a1a,#e5484d,#f472b6)']];
function seasonSkin() { const d = new Date(), m = d.getMonth() + 1, day = d.getDate(); if (m === 10) return 'halloween'; if (m === 12 || (m === 1 && day <= 5)) return 'holidays'; if (m === 3 || m === 4) return 'spring'; return 'default'; }
function applySkin() { const s = settings.skin === 'auto' ? seasonSkin() : settings.skin; if (!s || s === 'default') delete document.body.dataset.skin; else document.body.dataset.skin = s; }
function openSkin() {
  const curFrame = store.get('badgeFrame') || 'none';
  const frames = [['none', 'None'], ['gold', 'Gold'], ['silver', 'Silver'], ['rainbow', 'Rainbow'], ['shadow', 'Shadow']];
  const m = modal(`<h2>🎨 Skin &amp; effects</h2><p class="mmuted">Changes the site’s colours on this device only.</p>
    <div class="mskins">${SKINS.map(s => `<button type="button" class="mskin ${settings.skin === s[0] ? 'on' : ''}" data-skin="${s[0]}"><i style="background:${s[2]}"></i>${esc(s[1])}</button>`).join('')}</div>
    <label class="mchk big"><input type="checkbox" id="mSpark" ${settings.sparkles ? 'checked' : ''}> ✨ Sparkle animation when you tick a shiny</label>
    <h3 style="margin-top:14px">Badge showcase frames</h3>
    <p class="mmuted">Decorative frame around badges on the Badges page and profiles. Tap a frame to apply it.</p>
    <div class="mskins" id="mFrames">${frames.map(f => `<button type="button" class="mskin ${curFrame === f[0] ? 'on' : ''}" data-frame="${f[0]}" style="cursor:pointer">${esc(f[1])}</button>`).join('')}</div>`);
  m.addEventListener('click', e => {
    const b = e.target.closest('[data-skin]');
    if (b) {
      settings.skin = b.dataset.skin; saveSettings(); applySkin();
      $$('.mskin[data-skin]', m).forEach(x => x.classList.toggle('on', x === b));
      return;
    }
    const f = e.target.closest('[data-frame]');
    if (f) {
      const frame = f.dataset.frame || 'none';
      store.set('badgeFrame', frame);
      applyBadgeFrames();
      $$('#mFrames .mskin', m).forEach(x => x.classList.toggle('on', x === f));
      toast('Badge frame: ' + (f.textContent || frame), { ms: 1800 });
    }
  });
  const sparkEl = $('#mSpark', m);
  if (sparkEl) sparkEl.onchange = e => { settings.sparkles = e.target.checked; saveSettings(); if (settings.sparkles) sparkle(sparkEl, true); };
}
let lastPtr = { x: innerWidth / 2, y: innerHeight / 2 };
document.addEventListener('pointerdown', e => { lastPtr = { x: e.clientX, y: e.clientY }; }, true);
function sparkle(el, demo) {
  if (!settings.sparkles || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let r = el.getBoundingClientRect(); if (!r.width) r = { left: lastPtr.x - 40, top: lastPtr.y - 40, width: 80, height: 80 };
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2, layer = document.createElement('div'); layer.className = 'm-sparklayer'; document.body.append(layer);
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('i'); s.className = 'm-spark'; s.textContent = i % 3 ? '✦' : '✨'; s.style.left = cx + 'px'; s.style.top = cy + 'px'; layer.append(s);
    const a = Math.random() * Math.PI * 2, d = 36 + Math.random() * Math.max(40, Math.min(r.width, r.height) * .9), sc = .8 + Math.random() * .9;
    s.animate([{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(${sc}) rotate(${Math.random() * 180}deg)`, opacity: 0 }],
      { duration: 650 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
  }
  setTimeout(() => layer.remove(), 1400);
  if (!demo && el.classList) { el.classList.add('m-pop'); setTimeout(() => el.classList.remove('m-pop'), 900); }
}
function wireSparkles() {
  $('#grid').addEventListener('change', e => {
    const t = e.target; if (!(t instanceof HTMLInputElement) || t.type !== 'checkbox' || !t.checked) return;
    const act = (P() && P().active) || '', key = t.dataset.key || '';
    if (key.startsWith('shiny') || act === 'shiny' || act.startsWith('shiny_')) {
      const card = t.closest('.card') || t;
      sparkle(card);
      // #146 share shiny moment
      try {
        const id = +(card.dataset && (card.dataset.id || card.dataset.pid)) || 0;
        const p = P() && P().pokemon && (id ? P().pokemon.find(x => x.id === id) : null);
        const name = (p && p.name) || (card.querySelector('.pname') && card.querySelector('.pname').textContent) || 'a Pokémon';
        const text = `✨ Just registered a shiny ${name} in Pokémon GO! Tracked on GO Pokédex Tracker.`;
        toast('Shiny registered — share it?', {
          ms: 6000,
          action: 'Share',
          onAction: async () => {
            if (navigator.share) {
              try { await navigator.share({ title: 'Shiny ' + name, text }); return; } catch {}
            }
            try { await navigator.clipboard.writeText(text); toast('Share text copied.', { ms: 2000 }); }
            catch { toast(text, { ms: 5000 }); }
          }
        });
      } catch {}
    }
  });
}

/* ================= health: error log + real-user timing ================= */
const MAX_ERR = 50;
function logError(o) {
  const list = store.json('errors', []), key = o.msg + '|' + o.src, ex = list.find(x => x.k === key);
  if (ex) { ex.n++; ex.t = Date.now(); } else list.unshift({ k: key, msg: String(o.msg).slice(0, 300), src: o.src, stack: String(o.stack || '').slice(0, 600), view: document.body.dataset.view || '', t: Date.now(), n: 1 });
  store.save('errors', list.slice(0, MAX_ERR));
}
function installErrorLog() {
  window.addEventListener('error', e => {
    const el = e.target;
    if (el && el !== window && el.tagName) { if (el.tagName === 'SCRIPT' || el.tagName === 'LINK') logError({ msg: 'Failed to load a ' + el.tagName.toLowerCase(), src: (el.src || el.href || '').replace(location.origin, '') }); return; }
    logError({ msg: e.message || 'Error', src: `${(e.filename || '').replace(location.origin, '')}:${e.lineno || 0}:${e.colno || 0}`, stack: e.error && e.error.stack });
  }, true);
  window.addEventListener('unhandledrejection', e => { const r = e.reason; logError({ msg: 'Unhandled promise: ' + ((r && r.message) || r), src: 'promise', stack: r && r.stack }); });
}
function startRum() {
  let lcp = 0, saved = false;
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
  const save = () => {
    if (saved) return; saved = true;
    try {
      const n = performance.getEntriesByType('navigation')[0]; if (!n) return;
      const list = store.json('rum', []);
      list.unshift({ t: Date.now(), ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd || performance.now()), lcp: Math.round(lcp), view: document.body.dataset.view || '' });
      store.save('rum', list.slice(0, 30));
    } catch {}
  };
  setTimeout(save, 8000); addEventListener('pagehide', save);
}
const med = a => { const s = a.filter(x => x > 0).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
function openHealth() {
  const rum = store.json('rum', []), errs = store.json('errors', []);
  const stat = (label, v, good, bad) => `<div class="mstat ${!v ? '' : v <= good ? 'good' : v <= bad ? 'warn' : 'bad'}"><small>${label}</small><b>${v ? (v / 1000).toFixed(2) + ' s' : '—'}</b></div>`;
  const m = modal(`<h2>🐞 Site health</h2><p class="mmuted">Recorded in this browser only: how fast the site loads for you and any errors it hit. Use “Copy report” when you ask for help.</p>
    <h3>Load speed (median of ${rum.length} visit${rum.length === 1 ? '' : 's'})</h3>
    <div class="mstats">${stat('First byte', med(rum.map(r => r.ttfb)), 800, 1800)}${stat('Content ready', med(rum.map(r => r.dcl)), 1800, 3500)}${stat('Largest paint', med(rum.map(r => r.lcp)), 2500, 4000)}${stat('Fully loaded', med(rum.map(r => r.load)), 3000, 6000)}</div>
    <h3>Errors (${errs.reduce((a, e) => a + e.n, 0)} total, ${errs.length} unique)</h3>
    <div class="mlist">${errs.length ? errs.map(e => `<div class="merr"><b>${esc(e.msg)}</b><small>${esc(e.src)} · ${e.n}× · last ${esc(fmtDateTime(e.t))}${e.view ? ' · ' + esc(e.view) + ' view' : ''}</small></div>`).join('') : '<div class="mempty">No errors recorded. 🎉</div>'}</div>
    <div class="mrow"><button type="button" class="mbtn" id="hCopy">Copy report</button><button type="button" class="mbtn" id="hClear">Clear log</button></div>`, 'wide');
  $('#hCopy', m).onclick = async () => {
    const txt = [`GO Pokédex Tracker health report — ${new Date().toISOString()}`, `UA: ${navigator.userAgent}`, `Screen: ${innerWidth}x${innerHeight} @${devicePixelRatio}x`,
      `Median load (ms): ttfb ${med(rum.map(r => r.ttfb))}, dcl ${med(rum.map(r => r.dcl))}, lcp ${med(rum.map(r => r.lcp))}, load ${med(rum.map(r => r.load))}`, '',
      ...errs.map(e => `${e.n}x ${e.msg} @ ${e.src}${e.stack ? '\n' + e.stack : ''}`)].join('\n');
    toast((await copyText(txt)) ? 'Report copied.' : 'Could not copy.', { ms: 2500 });
  };
  $('#hClear', m).onclick = () => { store.save('errors', []); store.save('rum', []); closeModal(); toast('Log cleared.', { ms: 2000 }); };
}

/* ================= #8 Costume checklist (event name + year) ================= */
function costumeEntries() {
  const pdx = P(); if (!pdx || !pdx.pokemon) return [];
  const IMG = (typeof pdx.IMG !== 'undefined' ? pdx.IMG : null) || window.IMG || {};
  const byId = IMG.byId || new Map();
  const out = [];
  const yearRe = /(20\d{2}|ANNIV|GOFEST|GOTOUR|HALLOWEEN|HOLIDAY|CHRISTMAS|VALENTINE|SPRING|SUMMER|WINTER|FASHION|COSTUME|HAT|CAP|NOEVOLVE|BB_)/i;
  for (const p of pdx.pokemon) {
    const list = byId.get(p.id) || [];
    for (const it of list) {
      if ((it.f || []).some(t => /^(MEGA|PRIMAL|DYNAMAX|GIGANTAMAX)/i.test(t))) continue;
      const isCostume = it.c || (it.f || []).some(t => yearRe.test(t)) || (it.stem && yearRe.test(it.stem));
      if (!isCostume) continue;
      const stem = it.stem || (it.f && it.f.join('.')) || '';
      const yearM = stem.match(/(20\d{2})/);
      const year = yearM ? yearM[1] : '';
      let event = '';
      const tags = (it.f || []).concat(stem.split(/[._-]/)).filter(Boolean);
      for (const t of tags) {
        if (/^(20\d{2}|s|n|icon|pm\d+)$/i.test(t)) continue;
        if (/GOFEST|GO.?FEST/i.test(t)) { event = 'GO Fest'; break; }
        if (/GOTOUR|TOUR/i.test(t)) { event = 'GO Tour'; break; }
        if (/HALLOWEEN/i.test(t)) { event = 'Halloween'; break; }
        if (/HOLIDAY|CHRISTMAS|XMAS/i.test(t)) { event = 'Holiday'; break; }
        if (/VALENTINE/i.test(t)) { event = 'Valentine'; break; }
        if (/FASHION|COSTUME|HAT|CAP|ANNIV/i.test(t)) { event = t.replace(/[_-]/g, ' '); break; }
      }
      if (!event && year) event = 'Event ' + year;
      if (!event) event = 'Costume';
      const d = dexEntry(p.id) || {};
      const owned = !!(d.costumeOwned || (d.costumes && d.costumes.length) || Object.keys(d).some(k => k.startsWith('cos_') && d[k]));
      const shiny = !!(d.shiny_costume || (d.costumes && d.costumes.some(c => c && c.shiny)));
      out.push({ id: p.id, name: p.name, stem, year, event, owned, shiny, label: it.label || stem || p.name });
    }
  }
  // de-dupe by id+stem
  const seen = new Set();
  return out.filter(c => { const k = c.id + '|' + c.stem; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.year || '0').localeCompare(a.year || '0') || a.event.localeCompare(b.event) || a.name.localeCompare(b.name));
}

function openCostumes() {
  const list = costumeEntries();
  const byEvent = {};
  for (const c of list) {
    const key = (c.year ? c.year + ' · ' : '') + c.event;
    (byEvent[key] = byEvent[key] || []).push(c);
  }
  const keys = Object.keys(byEvent).sort((a, b) => b.localeCompare(a));
  const total = list.length, owned = list.filter(c => c.owned).length;
  let html = `<h2>🎩 Costume checklist</h2>
    <p class="mmuted">${owned} / ${total} costume forms tracked. Event names and years are best-effort from sprite stems.</p>
    <div class="mfamtools"><input type="search" id="cosQ" placeholder="Search species or event…" autocomplete="off"></div>
    <div id="cosList">`;
  for (const k of keys) {
    const items = byEvent[k];
    const o = items.filter(c => c.owned).length;
    html += `<div class="mfam cosgrp" data-ev="${esc(k)}"><div class="mrow" style="justify-content:space-between"><b>${esc(k)}</b><span class="mmuted">${o}/${items.length}</span></div>
      <div class="mchips">${items.map(c => `<span class="mchip ${c.owned ? 'own' : ''}" data-id="${c.id}" title="${esc(c.label)}">${c.shiny ? '✨' : ''}${esc(c.name)}</span>`).join('')}</div></div>`;
  }
  html += `</div><div class="mrow"><button type="button" class="mbtn" id="cosJump">Open Costume tab</button></div>`;
  const m = modal(html, 'wide');
  const filter = () => {
    const q = norm($('#cosQ', m).value);
    $$('.cosgrp', m).forEach(g => {
      const show = !q || norm(g.dataset.ev).includes(q) || [...g.querySelectorAll('.mchip')].some(c => norm(c.textContent).includes(q));
      g.hidden = !show;
    });
  };
  $('#cosQ', m).oninput = debounce(filter, 120);
  $('#cosJump', m).onclick = () => {
    closeModal();
    const track = $('#mTrack'); if (track) { track.value = 'costume'; track.dispatchEvent(new Event('change')); }
    const bar = $('.toolbar.dexonly'); if (bar) bar.scrollIntoView({ behavior: 'smooth' });
  };
}

/* ================= #47 Showcase 6 Pokémon ================= */
const SHOWCASE_MAX = 6;
function getShowcase() { return store.json('showcase', []).slice(0, SHOWCASE_MAX); }
function saveShowcase(arr) { store.save('showcase', arr.slice(0, SHOWCASE_MAX)); paintShowcaseShelf(); }

function paintShowcaseShelf() {
  const shelf = $('#mShowcaseShelf'); if (!shelf) return;
  const list = getShowcase();
  if (!list.length) { shelf.hidden = true; shelf.innerHTML = ''; return; }
  const pdx = P();
  shelf.hidden = false;
  shelf.innerHTML = `<div class="mshowhead"><b>⭐ My showcase</b><button type="button" class="mbtn" id="mShowEdit">Edit</button></div>
    <div class="mshowrow">${list.map(s => {
      const p = pdx && pdx.pokemon && pdx.pokemon.find(x => x.id === s.id);
      const name = p ? p.name : '#' + s.id;
      return `<div class="mshowcard" title="${esc(name)}"><img src="${spriteUrl(s.id, !!s.shiny)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span>${esc(name)}${s.shiny ? ' ✨' : ''}</span></div>`;
    }).join('')}</div>`;
  const ed = $('#mShowEdit', shelf); if (ed) ed.onclick = openShowcase;
}

function openShowcase() {
  const pdx = P(); if (!pdx) return toast('Pokédex not ready yet.');
  let picks = getShowcase().map(s => ({ ...s }));
  const caught = (pdx.pokemon || []).filter(p => {
    const d = dexEntry(p.id) || {};
    if (d.caught || d.shiny || d.shadow || d.purified || d.lucky || d.perfect || d.nundo || d.mega || d.dynamax || d.gigantamax || d.xxl || d.xxs || d.costumeOwned) return true;
    if ((d.costumes || []).length) return true;
    return Object.keys(d).some(k => d[k] && (k.startsWith('mega_') || k.startsWith('shiny_') || k.startsWith('cos_') || k.startsWith('bg_')));
  });
  const m = modal(`<h2>⭐ Showcase (up to ${SHOWCASE_MAX})</h2>
    <p class="mmuted">Pick up to ${SHOWCASE_MAX} Pokémon you’ve caught. They appear under the tools on the Pokédex page (this browser).</p>
    <div class="mfamtools"><input type="search" id="shQ" placeholder="Search caught…" autocomplete="off"></div>
    <div id="shPicks" class="mshowrow"></div>
    <div id="shGrid" class="mshgrid"></div>
    <div class="mrow"><button type="button" class="mbtn mprimary" id="shSave">Save showcase</button><button type="button" class="mbtn" id="shClear">Clear</button></div>`, 'wide');

  const paintPicks = () => {
    $('#shPicks', m).innerHTML = picks.length ? picks.map((s, i) => {
      const p = caught.find(x => x.id === s.id) || { name: '#' + s.id };
      return `<div class="mshowcard on" data-i="${i}"><img src="${spriteUrl(s.id, !!s.shiny)}" alt=""><span>${esc(p.name)}${s.shiny ? ' ✨' : ''}</span><button type="button" class="mshx" data-i="${i}" aria-label="Remove">✕</button></div>`;
    }).join('') : '<span class="mmuted">None selected yet — click a Pokémon below.</span>';
  };
  const paintGrid = () => {
    const q = norm($('#shQ', m).value);
    const html = caught.filter(p => !q || norm(p.name).includes(q) || String(p.id).includes(q))
      .map(p => {
        const d = dexEntry(p.id) || {};
        const on = picks.some(s => s.id === p.id);
        return `<button type="button" class="mshpick ${on ? 'on' : ''}" data-id="${p.id}" data-shiny="${d.shiny ? 1 : 0}">
          <img src="${spriteUrl(p.id, false)}" alt="" loading="lazy"><span>${esc(p.name)}</span></button>`;
      }).join('');
    $('#shGrid', m).innerHTML = html || '<div class="mempty">No caught Pokémon match.</div>';
  };
  paintPicks(); paintGrid();
  $('#shQ', m).oninput = debounce(paintGrid, 100);
  m.addEventListener('click', e => {
    const x = e.target.closest('.mshx');
    if (x) { picks.splice(+x.dataset.i, 1); paintPicks(); paintGrid(); return; }
    const b = e.target.closest('.mshpick');
    if (!b) return;
    const id = +b.dataset.id;
    const idx = picks.findIndex(s => s.id === id);
    if (idx >= 0) picks.splice(idx, 1);
    else if (picks.length < SHOWCASE_MAX) picks.push({ id, shiny: b.dataset.shiny === '1' });
    else toast(`Max ${SHOWCASE_MAX} in showcase.`, { ms: 2000 });
    paintPicks(); paintGrid();
  });
  $('#shSave', m).onclick = () => { saveShowcase(picks); closeModal(); toast('Showcase saved.', { ms: 2000 }); };
  $('#shClear', m).onclick = () => { picks = []; paintPicks(); paintGrid(); };
}

/* ================= #86 Badge showcase frames ================= */
function applyBadgeFrames() {
  const frame = store.get('badgeFrame') || 'none';
  document.documentElement.dataset.badgeFrame = frame;
  // re-apply when badges view is painted
  const obs = new MutationObserver(() => {
    $$('#badgesView .badge, #badgesView .fbadge, .profileShell .badge, .spSection .badge, .socCard .badge').forEach(el => {
      el.classList.remove('bframe-gold', 'bframe-silver', 'bframe-rainbow', 'bframe-shadow');
      if (frame && frame !== 'none') el.classList.add('bframe-' + frame);
    });
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

/* ================= startup ================= */
function whenLoaded(fn, tries = 120) { const t = setInterval(() => { if (P() && P().pokemon.length) { clearInterval(t); fn(); } else if (--tries <= 0) clearInterval(t); }, 500); }
function init() {
  installErrorLog(); startRum();
  if (!P() || !$('.toolbar.dexonly') || !$('#grid')) return;
  buildPanel(); wireFilters(); wireBulk(); wireSparkles();
  $('#mProgress').onclick = openProgress;
  if (P().setAvail) P().setAvail(settings.avail, true);
  applySkin(); applyFilters(); paintShelf(); paintShowcaseShelf(); paintCountdown(); setInterval(paintCountdown, 30000);
  whenLoaded(() => { paintShelf(); paintShowcaseShelf(); applyFilters(); checkNewTitles(); setTimeout(() => autoSnapshot().catch(() => {}), 4000); });
  document.addEventListener('pdx:dex', debounce(() => { if (P() && P().pokemon.length) { checkNewTitles(); paintShowcaseShelf(); } }, 4000));
  setInterval(() => autoSnapshot().catch(() => {}), 6 * 3600e3);
  applyBadgeFrames();
}
init();
})();
