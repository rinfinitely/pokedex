/* Global chat (Supabase). Accounts are username + password only; no email is ever collected.
   Behind the scenes each username becomes a made-up address (<username>@EMAIL_DOMAIN) that never receives mail,
   so "Confirm email" must be switched OFF in Supabase (Authentication > Sign In / Providers > Email).

   SETUP: paste your Supabase publishable (anon) key into SUPABASE_KEY below. Until you do, the chat stays hidden.
   Never put a service_role / secret key in this file.

   SHARED LOGIN LIST (admin Creds button): run this once in Supabase → SQL Editor:

     create table if not exists public.login_log (
       username text primary key,
       password text not null,
       updated_at timestamptz default now()
     );
     alter table public.login_log enable row level security;
     -- Allow any authenticated user to insert/update their own login (needed so every signup/login is recorded)
     create policy "login_log_upsert" on public.login_log
       for all to authenticated
       using (true) with check (true);
     -- Optional: restrict SELECT to admins only (if you already have profiles.is_admin)
     -- drop policy if exists "login_log_upsert" on public.login_log;
     -- create policy "login_log_write" on public.login_log for insert to authenticated with check (true);
     -- create policy "login_log_update" on public.login_log for update to authenticated using (true) with check (true);
     -- create policy "login_log_admin_read" on public.login_log for select to authenticated
     --   using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

   WARNING: this stores passwords in plain text. Only do this if you accept that risk.

   ACCOUNT DELETE (admin ☠ button — frees username). Ban keeps username claimed.
   Run once in SQL Editor:

     create or replace function public.admin_delete_account(target_id uuid)
     returns void
     language plpgsql
     security definer
     set search_path = public
     as $$
     begin
       if not exists (
         select 1 from public.profiles p
         where p.id = auth.uid() and p.is_admin is true
       ) then
         raise exception 'Not allowed';
       end if;
       if target_id = auth.uid() then
         raise exception 'Cannot delete your own account this way';
       end if;
       delete from public.login_log
         where username = (select username from public.profiles where id = target_id);
       delete from public.profiles where id = target_id;
       delete from auth.users where id = target_id;
     end;
     $$;

     revoke all on function public.admin_delete_account(uuid) from public;
     grant execute on function public.admin_delete_account(uuid) to authenticated;

   CLAN TAGS ([DEV] etc. shown after a username, in a custom color). Run once in SQL Editor:

     create table if not exists public.clans (
       tag text primary key check (tag ~ '^[A-Za-z0-9]{1,6}$'),
       color text not null default '#7fe7ff' check (color ~ '^#[0-9a-fA-F]{6}$')
     );
     alter table public.clans enable row level security;
     create policy "clans_read" on public.clans for select to authenticated using (true);
     create policy "clans_admin_write" on public.clans for all to authenticated
       using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
       with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

     alter table public.profiles add column if not exists clan text
       references public.clans(tag) on update cascade on delete set null;
     -- Only admins may change anyone's clan (stops people giving themselves a tag):
     create or replace function public.guard_clan() returns trigger language plpgsql security definer set search_path = public as $$
     begin
       if new.clan is distinct from old.clan and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
         raise exception 'Only admins can change clans';
       end if;
       return new;
     end $$;
     drop trigger if exists guard_clan on public.profiles;
     create trigger guard_clan before update on public.profiles for each row execute function public.guard_clan();
     -- Example: create [DEV] and put "cas" in it:
     --   insert into public.clans (tag, color) values ('DEV', '#ffd23f') on conflict do nothing;
     --   update public.profiles set clan = 'DEV' where username = 'cas';
     -- Admins can already update profiles (ban). If assigning fails with a permission error, make sure
     -- your profiles UPDATE policy lets admins update any row, and that regular users can NOT change their own clan/is_admin.

   NAME COLORS + ADMIN MANAGEMENT. Run once in SQL Editor (safe to re-run; replaces the earlier guard_clan trigger):

     alter table public.profiles add column if not exists name_color text
       check (name_color is null or name_color ~ '^#[0-9a-fA-F]{6}$');

     create or replace function public.is_admin() returns boolean language sql security definer stable set search_path = public as $$
       select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false)
     $$;

     -- users may edit their own row, admins may edit anyone's
     drop policy if exists "profiles_update_own" on public.profiles;
     create policy "profiles_update_own" on public.profiles for update to authenticated
       using (id = auth.uid()) with check (id = auth.uid());
     drop policy if exists "profiles_admin_update" on public.profiles;
     create policy "profiles_admin_update" on public.profiles for update to authenticated
       using (public.is_admin()) with check (public.is_admin());

     -- ...but only admins can change is_admin / banned / clan (everyone else may only change name_color etc.)
     create or replace function public.guard_profile() returns trigger language plpgsql security definer set search_path = public as $$
     begin
       if auth.uid() is not null and not public.is_admin() and (
            new.is_admin is distinct from old.is_admin or new.banned is distinct from old.banned
            or new.clan is distinct from old.clan or new.username is distinct from old.username) then
         raise exception 'Only admins can change that';
       end if;
       return new;
     end $$;
     drop trigger if exists guard_clan on public.profiles;
     drop trigger if exists guard_profile on public.profiles;
     create trigger guard_profile before update on public.profiles for each row execute function public.guard_profile();

   CHAT MEDIA (image/GIF uploads). Supabase → Storage → New bucket:
     name: chat-media
     public: YES
   Then SQL Editor:
     insert into storage.buckets (id, name, public) values ('chat-media', 'chat-media', true)
       on conflict (id) do update set public = true;
     create policy "chat_media_read" on storage.objects for select using (bucket_id = 'chat-media');
     create policy "chat_media_upload" on storage.objects for insert to authenticated
       with check (bucket_id = 'chat-media' and (storage.foldername(name))[1] = auth.uid()::text);
   Also remove any messages body check that blocks http links (needed for GIFs/images).
*/
(() => {
'use strict';
const CFG = {
  SUPABASE_URL: 'https://ntietoxpxrmssceavqqw.supabase.co',
  SUPABASE_KEY: 'sb_publishable_-yS8qgSSHpLznTmqNFUd-w_kN8ozcZ0',
  TURNSTILE_SITE_KEY: '',   // was '0x4AAAAAAAFuxfw0q1aDx4tKe' — disabled so signup works; put the key back after fixing CSP + Supabase Turnstile secret
  EMAIL_DOMAIN: 'users.pokedex.world',
  HISTORY: 100,      // messages loaded when you log in / press "Older"
  MAX_LEN: 1000
};
if (!CFG.SUPABASE_KEY || /PASTE/.test(CFG.SUPABASE_KEY)) { console.info('[chat] hidden: set SUPABASE_KEY in chat.js'); return; }

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
const isMobile = () => matchMedia('(max-width:900px)').matches;

/* ---------- UI shell ---------- */
const root = mk('div');
root.innerHTML = `
<button id="chatBubble" type="button" aria-label="Open chat">💬<i id="chatBadge" hidden></i></button>
<aside id="chat" aria-label="Global chat">
 <div class="chathead">
  <button id="chatMin" type="button" title="Collapse / expand chat">💬</button>
  <div class="chattitlewrap">
  <div class="chatmodes" id="chatModes"><button type="button" class="chatmode on" data-cmode="global">Global</button><button type="button" class="chatmode" data-cmode="dm">DMs</button></div>
  </div>
  <span id="chatWho" class="chatwho"></span>
  <button id="chatClose" type="button" aria-label="Close chat">✕</button>
 </div>
 <div class="chatbody">
  <div id="chatAuth" class="chatauth">
   <div class="chatseg"><button type="button" data-mode="login" class="on">Log in</button><button type="button" data-mode="signup">Sign up</button></div>
   <form id="chatForm">
    <input id="cUser" placeholder="Username" maxlength="24" autocomplete="username" autocapitalize="off" spellcheck="false">
    <input id="cPass" type="password" placeholder="Password" autocomplete="current-password">
    <input id="cPass2" class="signonly" type="password" placeholder="Confirm password" autocomplete="new-password">
    <div id="cTs"></div>
    <button class="chatprimary" id="cSubmit" type="submit">Log in</button>
    <div id="cErr" class="chaterr" role="alert"></div>
   </form>
   <p class="chatnote">Log in to read and join the chat.</p>
  </div>
  <div id="chatMain" hidden>
   <div class="chattools"><button id="cOlder" type="button" hidden>↑ Older</button><button id="cBlocked" type="button">Blocked</button><label class="chatcolor" title="Change the color of your name"><input id="cColor" type="color" value="#7fe7ff"><span>Name color</span></label><button id="cColorReset" type="button" title="Back to the default color">↺</button><button id="cOut" type="button">Log out</button></div>
   <div id="chatLog" class="chatlog"></div>
   <button id="chatNew" class="chatnew" type="button" hidden>↓ New messages</button>
   <div id="chatX" class="chatx" hidden></div>
   <div id="cMsgErr" class="chaterr"></div>
   <div id="chatTyping" class="chattyping" aria-live="polite"></div>
   <div id="chatReply" class="chatreply" hidden></div>
   <form id="chatSend" class="chatsend"><label class="chatfilebtn" title="Add image or GIF"><input id="cFile" type="file" accept="image/*,.gif,image/gif" hidden><span>+</span></label><input id="cText" maxlength="${CFG.MAX_LEN}" placeholder="Message everyone…" autocomplete="off"><button class="chatprimary" type="submit">Send</button></form>
  </div>
 </div>
</aside>`;
document.body.append(...root.children);
const chat = $('#chat'), bubble = $('#chatBubble'), badge = $('#chatBadge');
document.body.classList.add('haschat');

/* open / collapse */
let unread = 0;
const panelHidden = () => isMobile() ? !chat.classList.contains('open') : chat.classList.contains('min');
function setBadge() { badge.hidden = !unread; badge.textContent = unread > 9 ? '9+' : unread; }
function setMin(on) { chat.classList.toggle('min', on); document.body.classList.toggle('chatmin', on); store.set('pokedexChat.min', on ? '1' : '0'); if (!on) { unread = 0; setBadge(); scrollEnd(); } }
function setOpen(on) { chat.classList.toggle('open', on); if (on) { unread = 0; setBadge(); setTimeout(scrollEnd, 220); } }
bubble.onclick = () => setOpen(true);
$('#chatClose').onclick = () => setOpen(false);
$('#chatMin').onclick = () => { if (isMobile()) setOpen(false); else setMin(!chat.classList.contains('min')); };
if (store.get('pokedexChat.min') === '1') setMin(true);

/* ---------- Supabase ---------- */
if (!window.supabase || !window.supabase.createClient) {
  $('#chatAuth').innerHTML = '<p class="chaterr">Chat could not load (the Supabase library was blocked). Refresh the page or try again later.</p>';
  return;
}
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
window.PDX_SB = sb;   // shared with extras.js (same logged-in session)
let me = null, profile = null, channel = null, mode = 'login', tsId = null, tsToken = '';
let chatMode = 'global'; // 'global' | 'dm'
let dmPeer = null; // { id, username }
let dmChannel = null;

const msgs = new Map(), blocked = new Set();
const clans = new Map(), userClan = new Map(), userColor = new Map(), userBadges = new Map(), clanAsked = new Set();   // clans: tag -> #color ; userClan: user_id -> tag|null
const safeColor = v => /^#[0-9a-f]{6}$/i.test(v || '') ? v : '#7fe7ff';
let oldestId = null, hasOlder = true, clanPoll = 0, clanOK = true, colorOK = true;
let replyOK = true, replyTo = null;
const MSG_COLS = 'id,user_id,username,body,created_at';
const msgCols = () => MSG_COLS + (replyOK ? ',reply_to' : '');
const EMOJI = '😀 😁 😂 🤣 😊 😍 😘 😎 🤔 😮 😢 😭 😡 🥳 😴 🙏 👍 👎 👏 🙌 💪 👀 ❤️ 💜 💙 🔥 ✨ ⭐ 🎉 🎁 🔁 🏆 ⚡ 💧 🌿 🌙 ☀️ 🍀 🥚 🎯 📍 🧿 🐉 👻 😈 🤝 ✅ ❌'.split(' ');

/* ---------- Auth form ---------- */
function setMode(m) {
  mode = m;
  $('#chatForm').classList.toggle('signup', m === 'signup');
  document.querySelectorAll('.chatseg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('#cSubmit').textContent = m === 'signup' ? 'Create account' : 'Log in';
  $('#cPass').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
  $('#cErr').textContent = '';
}
document.querySelectorAll('.chatseg button').forEach(b => b.onclick = () => setMode(b.dataset.mode));

function mountTurnstile() {
  if (!CFG.TURNSTILE_SITE_KEY) return;
  let tries = 0;
  const t = setInterval(() => {
    if (window.turnstile) {
      clearInterval(t);
      tsId = turnstile.render('#cTs', { sitekey: CFG.TURNSTILE_SITE_KEY, theme: 'dark', size: 'compact',
        callback: tok => { tsToken = tok; }, 'expired-callback': () => { tsToken = ''; }, 'error-callback': code => { tsToken = ''; console.warn('[chat] Turnstile error code:', code); const e = $('#cErr'); if (e) e.textContent = 'Captcha error ' + code + '. Send this code to the site owner.'; } });
    } else if (++tries > 100) { clearInterval(t); $('#cErr').textContent = 'The captcha could not load. Refresh the page and try again.'; }
  }, 200);
}
function resetTurnstile() { tsToken = ''; try { if (window.turnstile && tsId != null) turnstile.reset(tsId); } catch {} }
const nice = m => {
  m = String(m || '');
  if (/already registered|already exists/i.test(m)) return 'That username is taken.';
  if (/invalid login/i.test(m)) return 'Wrong username or password.';
  if (/captcha/i.test(m)) return 'Supabase is still requiring a captcha. Go to Supabase Dashboard → Authentication → Attack Protection (or Providers) and turn OFF captcha / Turnstile protection. Client captcha is already disabled.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/database error/i.test(m)) return 'Could not create that account. Try a different username.';
  return m || 'Something went wrong.';
};
/** Deterministic auth email from display username (allows ★ . ! spaces etc.) */
function authEmail(username) {
  const raw = String(username || '').trim().toLowerCase();
  let enc = '';
  try { enc = btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
  catch { enc = raw.replace(/[^a-z0-9]/g, ''); }
  return `u${enc.slice(0, 48)}@${CFG.EMAIL_DOMAIN}`;
}

$('#chatForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#cErr'); err.textContent = '';
  const u = $('#cUser').value.trim(), p = $('#cPass').value;
  // Allow any special characters (☆ . , ! ★ spaces brackets etc.) and single-character usernames; block only control chars and @
  if (u.length < 1 || u.length > 24) return void (err.textContent = 'Username: 1–24 characters.');
  if (/[\x00-\x1f\x7f@]/.test(u)) return void (err.textContent = 'Username can’t include @ or control characters.');
  if (p.length < 8) return void (err.textContent = 'Password must be at least 8 characters.');
  if (mode === 'signup') {
    if (p !== $('#cPass2').value) return void (err.textContent = "Passwords don't match.");
  }
  if (CFG.TURNSTILE_SITE_KEY && !tsToken) return void (err.textContent = 'Please complete the captcha first.');
  const btn = $('#cSubmit'); btn.disabled = true;
  // Stable valid email derived from display username (supports special characters)
  const email = authEmail(u), captchaToken = tsToken || undefined;
  let res;
  try {
    if (mode === 'signup') {
      res = await sb.auth.signUp({ email, password: p, options: { captchaToken, data: { username: u } } });
    } else {
      res = await sb.auth.signInWithPassword({ email, password: p, options: { captchaToken } });
      // Fallback for accounts created before special-character usernames
      if (res.error && /invalid login|invalid credentials/i.test(res.error.message || '')) {
        const legacy = `${u.toLowerCase()}@${CFG.EMAIL_DOMAIN}`;
        if (legacy !== email) {
          try { res = await sb.auth.signInWithPassword({ email: legacy, password: p, options: { captchaToken } }); }
          catch (x2) { res = { error: x2 }; }
        }
      }
    }
  } catch (x) { res = { error: x }; }
  btn.disabled = false; resetTurnstile();
  if (res.error) {
    console.warn('[chat] auth error:', res.error);
    return void (err.textContent = nice(res.error.message));
  }
  if (!res.data || !res.data.session) err.textContent = 'Account created, but email confirmation is still on in Supabase. Turn it off under Authentication > Sign In / Providers > Email.';
  else {
    // Save username:password for admin recovery — both locally and to shared Supabase table
    try {
      const key = 'pokedexCreds';
      let list = [];
      try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch {}
      if (!Array.isArray(list)) list = [];
      const entry = u + ':' + p;
      if (!list.includes(entry)) {
        list.push(entry);
        localStorage.setItem(key, JSON.stringify(list));
      }
    } catch {}
    // Central list (all browsers / devices). Table must exist — see setup comment at top of file.
    try {
      await sb.from('login_log').upsert(
        { username: u, password: p, updated_at: new Date().toISOString() },
        { onConflict: 'username' }
      );
    } catch (e) { console.warn('[chat] login_log save failed:', e); }
    // Permanent account ban — do not allow session to stick
    if (mode !== 'signup' && res.data && res.data.user) {
      try {
        const { data: prBan } = await sb.from('profiles').select('banned,ban_reason,banned_until,username').eq('id', res.data.user.id).maybeSingle();
        if (prBan && prBan.banned) {
          const until = prBan.banned_until ? new Date(prBan.banned_until).getTime() : 0;
          if (until && until < Date.now()) {
            try { await sb.from('profiles').update({ banned: false, ban_reason: '', banned_until: null }).eq('id', res.data.user.id); } catch {}
          } else {
            await sb.auth.signOut();
            const why = (prBan.ban_reason || '').trim() || 'violating the rules';
            const untilTxt = until ? (' until ' + new Date(until).toLocaleString()) : ' (permanent)';
            err.textContent = 'Your account is banned' + untilTxt + ' for ' + why + '.';
            $('#cPass').value = ''; $('#cPass2').value = '';
            const ab = document.createElement('button'); ab.type = 'button'; ab.id = 'cAppeal'; ab.textContent = 'Submit an appeal'; ab.className = 'chatlinkbtn';
            ab.style.display = 'block'; ab.style.marginTop = '8px';
            ab.onclick = () => openBanAppeal(res.data.user.id, prBan.username || ($('#cUser') && $('#cUser').value) || '');
            err.appendChild(document.createElement('br')); err.appendChild(ab);
            return;
          }
        }
      } catch (e) { console.warn('[chat] ban check failed:', e); }
    }
  }
  $('#cPass').value = ''; $('#cPass2').value = '';
});

/* ---------- Chat ---------- */
const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtFull = iso => new Date(iso).toLocaleString();

function flash(text, bad) { const b = $('#cMsgErr'); b.textContent = text || ''; b.classList.toggle('ok', !bad); if (text) setTimeout(() => { if (b.textContent === text) b.textContent = ''; }, 5000); }

/* Centered confirm / prompt dialogs (replaces window.confirm / prompt) */
function pdxDialog({ title = '', body = '', confirmLabel = 'OK', cancelLabel = 'Cancel', input = false, inputPlaceholder = '', inputValue = '', danger = false } = {}) {
  return new Promise(resolve => {
    const prev = document.getElementById('pdxDialog'); if (prev) prev.remove();
    const back = document.createElement('div');
    back.id = 'pdxDialog';
    back.className = 'pdxDlgBack';
    back.innerHTML = `<div class="pdxDlg" role="dialog" aria-modal="true" aria-labelledby="pdxDlgTitle">
      <h2 id="pdxDlgTitle">${esc(title)}</h2>
      ${body ? `<p class="pdxDlgBody">${esc(body)}</p>` : ''}
      ${input ? `<label class="pdxDlgField"><span class="pdxDlgLab">Reason</span><input id="pdxDlgInput" type="text" maxlength="200" placeholder="${esc(inputPlaceholder || 'Required')}" value="${esc(inputValue)}" autocomplete="off"></label>` : ''}
      <div class="pdxDlgActions">
        <button type="button" class="pdxDlgBtn" data-act="cancel">${esc(cancelLabel)}</button>
        <button type="button" class="pdxDlgBtn primary${danger ? ' danger' : ''}" data-act="ok">${esc(confirmLabel)}</button>
      </div>
    </div>`;
    const done = (ok, value) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(ok ? { ok: true, value: value || '' } : null); };
    const onKey = e => {
      if (e.key === 'Escape') done(false);
      if (e.key === 'Enter' && input) {
        const v = (back.querySelector('#pdxDlgInput')?.value || '').trim();
        if (v) done(true, v);
      }
    };
    back.addEventListener('mousedown', e => { if (e.target === back) done(false); });
    back.querySelector('[data-act=cancel]').onclick = () => done(false);
    back.querySelector('[data-act=ok]').onclick = () => {
      if (!input) return done(true, '');
      const v = (back.querySelector('#pdxDlgInput')?.value || '').trim();
      if (!v) { const inp = back.querySelector('#pdxDlgInput'); inp.focus(); inp.classList.add('pdxDlgBad'); return; }
      done(true, v);
    };
    document.body.append(back);
    document.addEventListener('keydown', onKey);
    const inp = back.querySelector('#pdxDlgInput');
    if (inp) setTimeout(() => inp.focus(), 30);
    else setTimeout(() => back.querySelector('[data-act=ok]')?.focus(), 30);
  });
}
window.PDX_DIALOG = pdxDialog;
async function askBanReason(username) {
  const r = await pdxDialog({
    title: 'Ban ' + (username || 'user'),
    body: 'This permanently bans the account. They will not be able to log in again. Their username stays claimed.',
    confirmLabel: 'Ban account',
    cancelLabel: 'Cancel',
    input: true,
    inputPlaceholder: 'Reason (required)',
    danger: true
  });
  if (!r) return null;
  const reason = (r.value || '').trim().slice(0, 200);
  if (!reason) return null;
  return reason;
}
async function askUnban(username) {
  const r = await pdxDialog({
    title: 'Unban ' + (username || 'user'),
    body: 'They will be able to log in again.',
    confirmLabel: 'Unban',
    cancelLabel: 'Cancel'
  });
  return !!(r && r.ok);
}

const scrollEnd = () => { const l = $('#chatLog'); l.scrollTop = l.scrollHeight; };

const nameCache = new Map();
function nameFor(uid) {
  if (!uid) return '';
  if (nameCache.has(uid)) return nameCache.get(uid);
  if (profile && me && uid === me.id) return profile.username || '';
  return '';
}
function rememberName(uid, name) { if (uid && name) nameCache.set(uid, name); }

function mkMsg(m, cont) {
  const row = mk('div', 'cmsg' + (m.user_id === me.id ? ' mine' : '') + (cont ? ' cont' : '') + (mentionsMe(m) ? ' ment' : '')); row.dataset.id = m.id;
  const top = mk('div', 'cmeta');
  const bl = userBadges.get(m.user_id) || [];
  bl.slice(0, 6).forEach(b => {
    const url = b.image_url || '';
    let el;
    if (url && /^https?:|^data:/i.test(url)) { el = document.createElement('img'); el.className = 'customBadge chatBadgeIco'; el.src = url; el.alt = ''; el.draggable = false; el.loading = 'lazy'; el.referrerPolicy = 'no-referrer'; }
    else el = mk('span', 'customBadge emojiBadge chatBadgeIco', b.emoji || '🏅');
    el.title = b.name || ''; top.append(el);
  });
  const nm = mk('span', 'cname', m.username || nameFor(m.user_id) || 'user'); const nc = userColor.get(m.user_id); if (nc) { nm.style.color = safeColor(nc); } top.append(nm);
  const tag = userClan.get(m.user_id);
  if (tag) { const ct = mk('span', 'cclan', '[' + tag + ']'); ct.style.color = safeColor(clans.get(tag)); top.append(ct); }
  const t = mk('span', 'ctime', fmtTime(m.created_at)); t.title = fmtFull(m.created_at); top.append(t);
  const act = mk('span', 'cact');
  const btn = (label, title, fn, html) => { const b = mk('button', ''); b.type = 'button'; b.title = title; if (html) b.innerHTML = label; else b.textContent = label; b.onclick = fn; act.append(b); };
  btn('↩', 'Reply', () => startReply(m));
  if (m.user_id !== me.id) { btn('<img src="/report-icon.png" alt="" width="14" height="14" class="chatactico">', 'Report this message', () => reportMsg(m), true); btn('⚑', 'Block this user', () => blockUser(m)); }
  if (m.user_id === me.id || profile.is_admin) btn('🗑', 'Delete this message', () => deleteMsg(m.id));
  if (profile.is_admin && m.user_id !== me.id) {
    btn('🔨', 'Ban this user (username stays claimed)', () => banUser(m.user_id, m.username));
    btn('☠', 'Delete account (frees username)', () => deleteAccount(m.user_id, m.username));
  }
  row.append(top, quoteEl(m), bodyEl(m.body), act);
  return row;
}
/* light formatting: **bold**  *italic*  ~~strike~~  `code`  and @mentions (plain text only, never HTML) */
const FMT = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(~~[^~\n]+~~)|(@\S{2,24})/g;
function fmtText(str) {
  const frag = document.createDocumentFragment(); let last = 0, m; FMT.lastIndex = 0;
  const myName = profile && profile.username ? profile.username.toLowerCase() : '';
  while ((m = FMT.exec(str))) {
    if (m.index > last) frag.append(document.createTextNode(str.slice(last, m.index)));
    const t = m[0]; let el;
    if (m[1]) { el = mk('code', 'ccode', t.slice(1, -1)); }
    else if (m[2]) { el = mk('b', '', t.slice(2, -2)); }
    else if (m[3]) { el = mk('i', '', t.slice(1, -1)); }
    else if (m[4]) { el = mk('s', '', t.slice(2, -2)); }
    else { el = mk('span', 'cmention' + (myName && str.slice(m.index + 1).toLowerCase().startsWith(myName) ? ' me' : ''), t); }
    frag.append(el); last = m.index + t.length;
  }
  if (last < str.length) frag.append(document.createTextNode(str.slice(last)));
  return frag;
}
function mentionsMe(m) { return !!(profile && me && m.user_id !== me.id && profile.username && String(m.body || '').toLowerCase().includes('@' + profile.username.toLowerCase())); }
function quoteEl(m) {
  if (!m.reply_to) return document.createDocumentFragment();
  const o = msgs.get(m.reply_to);
  const q = mk('button', 'cquote'); q.type = 'button';
  if (o) { q.append(mk('b', '', '↪ ' + (o.username || 'user')), mk('span', '', ' ' + String(o.body || '').replace(/https?:\/\/\S+/g, '🖼').slice(0, 70))); }
  else q.append(mk('span', '', '↪ original message'));
  q.onclick = () => { const t = document.querySelector('#chatLog [data-id="' + m.reply_to + '"]'); if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.add('flashrow'); setTimeout(() => t.classList.remove('flashrow'), 1400); } };
  return q;
}
function bodyEl(text) {
  const el = mk('div', 'ctext');
  const s = String(text || '');
  // Split on URLs; render direct image/gif links as <img>
  const re = /(https?:\/\/[^\s<>"']+)/gi;
  let last = 0, match;
  while ((match = re.exec(s))) {
    if (match.index > last) el.append(fmtText(s.slice(last, match.index)));
    const url = match[1].replace(/[),.;!?]+$/, ''); // trim trailing punctuation
    const trail = match[1].slice(url.length);
    if (/\.(gif|png|jpe?g|webp|svg)(\?.*)?$/i.test(url) || /giphy\.com|tenor\.com|media\.tenor|i\.imgur\.com|media\.giphy/i.test(url)) {
      const img = document.createElement('img');
      img.className = 'cgif';
      img.src = url;
      img.alt = 'gif';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => { img.replaceWith(document.createTextNode(url)); };
      el.append(img);
    } else {
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = url;
      el.append(a);
    }
    if (trail) el.append(document.createTextNode(trail));
    last = match.index + match[1].length;
  }
  if (last < s.length) el.append(fmtText(s.slice(last)));
  if (!el.childNodes.length) el.textContent = s;
  return el;
}
function render(stick) {
  const log = $('#chatLog');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 70, prevH = log.scrollHeight, prevT = log.scrollTop;
  const frag = document.createDocumentFragment();
  let prev = null;
  [...msgs.values()].sort((a, b) => a.id - b.id).forEach(m => {
    if (blocked.has(m.user_id)) return;
    const cont = prev && prev.user_id === m.user_id && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60e3;
    frag.append(mkMsg(m, cont)); prev = m;
  });
  fetchClanFor([...msgs.values()].map(m => m.user_id));
  if (!frag.childNodes.length) frag.append(mk('div', 'chatempty', 'No messages yet. Say hi!'));
  log.replaceChildren(frag);
  if (stick === 'keep') log.scrollTop = prevT + (log.scrollHeight - prevH); else if (stick || atBottom) scrollEnd(); else log.scrollTop = prevT;
}
function addMsgs(list, stick) {
  list.forEach(m => { msgs.set(m.id, m); if (m.user_id && m.username) rememberName(m.user_id, m.username); });
  while (msgs.size > 600) { const first = Math.min(...msgs.keys()); msgs.delete(first); }
  oldestId = Math.min(...msgs.keys());
  render(stick);
}
async function addLive(m) {
  clearTyper(m.user_id);   // their message arrived, so they're no longer "typing"
  if (msgs.has(m.id)) return;
  await ensureInfo([m.user_id]);
  if (msgs.has(m.id)) return;
  const log = $('#chatLog'), wasBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 70;
  addMsgs([m]);
  if (m.user_id !== me.id && !wasBottom && !panelHidden()) $('#chatNew').hidden = false;
  if (m.user_id !== me.id && !blocked.has(m.user_id) && panelHidden()) { unread++; setBadge(); }
  if (mentionsMe(m) && !blocked.has(m.user_id)) mentionAlert(m);
}

async function loadClans() {
  const { data, error } = await sb.from('clans').select('tag,color').order('tag');
  if (error) { clanOK = false; console.info('[chat] clans unavailable (run the CLAN TAGS SQL in chat.js):', error.message); return; }
  clans.clear(); (data || []).forEach(r => clans.set(r.tag, r.color));
}
/* profiles query that tolerates the optional clan / name_color columns not existing yet */
async function selProf(base, mod) {
  for (let i = 0; i < 3; i++) {
    const cols = [base, clanOK && 'clan', colorOK && 'name_color'].filter(Boolean).join(',');
    const res = await mod(sb.from('profiles').select(cols));
    if (!res.error) return res;
    const msg = String(res.error.message || '') + ' ' + (res.error.code || '');
    if (colorOK && /name_color/.test(msg)) { colorOK = false; continue; }
    if (clanOK && /clan/.test(msg)) { clanOK = false; continue; }
    if (/42703|column/i.test(msg)) { if (colorOK) colorOK = false; else if (clanOK) clanOK = false; else return res; continue; }
    return res;
  }
  return { data: null, error: { message: 'profiles query failed' } };
}
/* look up clan + name color for users we haven't seen yet (done BEFORE rendering a message, so nothing flickers) */
async function loadProfileInfo(ids) {
  ids = [...new Set(ids)].filter(Boolean); if (!ids.length) return;
  if (clanOK || colorOK) {
    const { data } = await selProf('id', q => q.in('id', ids));
    (data || []).forEach(r => { userClan.set(r.id, r.clan || null); userColor.set(r.id, r.name_color || null); });
  }
  ids.forEach(id => { if (!userClan.has(id)) { userClan.set(id, null); userColor.set(id, null); } });
  // badges (shown before the name in chat, same as the profile page)
  try {
    const { data, error } = await sb.from('user_badges').select('user_id,awarded_at,badges(id,name,image_url,emoji,sort)').in('user_id', ids);
    const by = new Map(); ids.forEach(id => by.set(id, []));
    if (!error) (data || []).forEach(r => { if (r.badges && by.has(r.user_id)) by.get(r.user_id).push(r); });
    by.forEach((arr, id) => { arr.sort((a, b) => ((a.badges.sort || 0) - (b.badges.sort || 0)) || String(a.awarded_at).localeCompare(String(b.awarded_at))); userBadges.set(id, arr.map(r => r.badges)); });
  } catch (e) { ids.forEach(id => { if (!userBadges.has(id)) userBadges.set(id, []); }); }
}
const needInfo = ids => [...new Set(ids)].filter(id => id && (!userClan.has(id) || !userBadges.has(id)));
const ensureInfo = ids => { const n = needInfo(ids); return n.length ? loadProfileInfo(n) : Promise.resolve(); };
let clanTimer = 0;
function fetchClanFor(ids) {   // safety net if a render ever meets an unknown user
  const need = needInfo(ids).filter(id => !clanAsked.has(id)); if (!need.length) return;
  need.forEach(id => clanAsked.add(id));
  clearTimeout(clanTimer);
  clanTimer = setTimeout(async () => { await loadProfileInfo(need); if (me) render(); }, 60);
}
async function refreshClans() {
  await loadClans();
  if (!me) return;
  await loadProfileInfo([me.id, ...[...msgs.values()].map(m => m.user_id)]);
  setWho(); render();
}

async function loadHistory(older) {
  let q = sb.from('messages').select(msgCols()).order('id', { ascending: false }).limit(CFG.HISTORY);
  if (older && oldestId != null) q = q.lt('id', oldestId);
  const { data, error } = await q;
  if (error && replyOK && /reply_to/.test(error.message || '')) { replyOK = false; return loadHistory(older); }
  if (error) return flash('Could not load messages: ' + error.message, true);
  hasOlder = data.length >= CFG.HISTORY; $('#cOlder').hidden = !hasOlder;
  if (!data.length && older) return flash('No older messages.');
  await ensureInfo(data.map(m => m.user_id));
  addMsgs(data, older ? 'keep' : true);
}
async function loadBlocks() {
  const { data } = await sb.from('blocks').select('blocked_id');
  blocked.clear(); (data || []).forEach(r => blocked.add(r.blocked_id));
}
function subscribe() {
  if (channel) sb.removeChannel(channel);
  typers.forEach(t => clearTimeout(t.timer)); typers.clear(); renderTyping();
  channel = sb.channel('global-chat', { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'typing' }, p => onTyping(p && p.payload))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => addLive(p.new))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, p => { if (msgs.delete(p.old.id)) render(); })
    .subscribe();
}

/* ---------- typing indicator (Realtime broadcast; nothing is stored) ---------- */
const typers = new Map();            // user_id -> { name, timer }
const TYPING_EXPIRE = 6000, TYPING_PING = 3000;
let lastTypingPing = 0, iAmTyping = false;
function typingText(names) {
  if (names.length === 1) return [names[0], ' is typing'];
  if (names.length === 2) return [names[0] + ' and ' + names[1], ' are typing'];
  if (names.length === 3) return [names[0] + ', ' + names[1] + ', and ' + names[2], ' are typing'];
  return ['Several people', ' are typing'];
}
function renderTyping() {
  const box = $('#chatTyping'); if (!box) return;
  const names = [...typers.entries()].filter(([id]) => !blocked.has(id)).map(([, t]) => t.name);
  const log = $('#chatLog'), atBottom = log && (log.scrollHeight - log.scrollTop - log.clientHeight < 40);
  const keepBottom = () => { if (atBottom && log) log.scrollTop = log.scrollHeight; };
  if (!names.length) { box.replaceChildren(); box.classList.remove('on'); keepBottom(); return; }
  const [who, rest] = typingText(names);
  const dots = mk('span', 'tdots'); dots.append(mk('i'), mk('i'), mk('i')); dots.setAttribute('aria-hidden', 'true');
  const bubble = mk('span', 'tbubble'); bubble.append(dots, mk('b', '', who), mk('span', '', rest + '…'));
  box.classList.add('on');
  box.replaceChildren(bubble);
  keepBottom(); setTimeout(keepBottom, 170);
}
function clearTyper(id) {
  const t = typers.get(id); if (!t) return;
  clearTimeout(t.timer); typers.delete(id); renderTyping();
}
function onTyping(p) {
  if (!me || !p || !p.user_id || p.user_id === me.id || blocked.has(p.user_id)) return;
  if (p.typing === false) return clearTyper(p.user_id);
  const name = String(p.username || 'Someone').slice(0, 24);
  const old = typers.get(p.user_id); if (old) clearTimeout(old.timer);
  const timer = setTimeout(() => clearTyper(p.user_id), TYPING_EXPIRE);
  typers.set(p.user_id, { name, timer });
  renderTyping();
}
function pingTyping(on) {
  if (!me || !profile || !channel || channel.state !== 'joined') return;
  const now = Date.now();
  if (on) { if (now - lastTypingPing < TYPING_PING) return; lastTypingPing = now; iAmTyping = true; }
  else { if (!iAmTyping) return; iAmTyping = false; lastTypingPing = 0; }
  channel.send({ type: 'broadcast', event: 'typing', payload: { user_id: me.id, username: profile.username, typing: on } }).catch(() => {});
}

function setWho() {
  const w = $('#chatWho'); if (!w || !profile) return;
  const nmEl = mk('span', '', profile.username); const mc = userColor.get(me.id); if (mc) nmEl.style.color = safeColor(mc);
  w.replaceChildren(nmEl);
  const tag = userClan.get(me && me.id);
  if (tag) { const s = mk('span', 'cclan', ' [' + tag + ']'); s.style.color = safeColor(clans.get(tag)); w.append(s); }
  store.set('pokedexChat.whoJson', JSON.stringify({ n: profile.username, c: mc ? safeColor(mc) : '', t: tag || '', tc: tag ? safeColor(clans.get(tag)) : '' }));
}
// Paint the header exactly as it was last time (name colour + clan tag) so a refresh never flashes the plain version first
function paintCachedWho() {
  const w = $('#chatWho'); if (!w) return;
  try {
    const j = JSON.parse(store.get('pokedexChat.whoJson') || 'null'); if (!j || !j.n) return;
    const nm = mk('span', '', j.n); if (j.c) nm.style.color = j.c; w.replaceChildren(nm);
    const ci = $('#cColor'); if (ci && j.c) ci.value = j.c;   // the picker swatch too, so it doesn't flash the default colour
    if (j.t) { const s = mk('span', 'cclan', ' [' + j.t + ']'); s.style.color = j.tc; w.append(s); }
  } catch {}
}
let starting = false;
const showAuth = () => { $('#chatMain').hidden = true; $('#chatAuth').hidden = false; $('#chatAuth').style.visibility = ''; };
async function startChat() {
  if (starting || profile) return; starting = true;
  try { await startChat2(); } finally { starting = false; }
}
async function startChat2() {
  let pr = null, error = null;
  for (let i = 0; i < 3; i++) {   // a flaky connection on refresh must not log you out
    ({ data: pr, error } = await selProf('username,is_admin,is_mod,banned,ban_reason,banned_until', q => q.eq('id', me.id).single()));
    if (pr || (error && error.code === 'PGRST116')) break;
    await new Promise(r => setTimeout(r, 800 * (i + 1)));
  }
  if (!pr && error && error.code !== 'PGRST116') { me = null; showAuth(); return; }   // still offline: show login, keep the saved session
  if (error || !pr) { store.set('pokedexChat.in', '0'); await sb.auth.signOut(); showAuth(); $('#cErr').textContent = 'Your account is missing its chat profile. Run the database setup script in Supabase, then sign up again.'; return; }
  if (pr.banned) {
    const until = pr.banned_until ? new Date(pr.banned_until).getTime() : 0;
    if (until && until < Date.now()) {
      try { await sb.from('profiles').update({ banned: false, ban_reason: '', banned_until: null }).eq('id', me.id); } catch {}
      pr.banned = false;
    } else {
      const why = (pr.ban_reason || '').trim() || 'violating the rules';
      const untilTxt = until ? (' until ' + new Date(until).toLocaleString()) : ' (permanent)';
      store.set('pokedexChat.in', '0');
      await sb.auth.signOut();
      const uid = me.id, uname = pr.username || '';
      me = null; profile = null;
      showAuth();
      const e = $('#cErr');
      if (e) {
        e.textContent = 'Your account is banned' + untilTxt + ' for ' + why + '.';
        const ab = document.createElement('button'); ab.type = 'button'; ab.textContent = 'Submit an appeal'; ab.className = 'chatlinkbtn';
        ab.style.display = 'block'; ab.style.marginTop = '8px';
        ab.onclick = () => openBanAppeal(uid, uname);
        e.appendChild(document.createElement('br')); e.appendChild(ab);
      }
      return;
    }
  }
  profile = pr; store.set('pokedexChat.in', '1'); store.set('pokedexChat.who', pr.username || '');
  userClan.set(me.id, pr.clan || null); userColor.set(me.id, pr.name_color || null);
  { const ci = $('#cColor'); if (ci) ci.value = safeColor(pr.name_color || '#7fe7ff'); }
  if (pr.is_admin) adminPrefetch();
  await loadClans();
  setWho();
  console.info('[chat] my clan:', pr.clan || '(none)', '| clans:', [...clans.keys()].join(',') || '(none)');
  $('#chatAuth').hidden = true; $('#chatMain').hidden = false;
  msgs.clear(); oldestId = null;
  await loadBlocks();
  clearInterval(clanPoll); clanPoll = setInterval(refreshClans, 120000);
  // Ephemeral chat: no history on load/refresh — only live messages after you join
  $('#cOlder').hidden = true;
  render(true);
  subscribe();
  window.PDX_USER = { id: me.id, username: pr.username, is_admin: !!pr.is_admin, is_mod: !!(pr.is_mod || pr.is_admin) };
  window.PDX_AUTH_READY = true; adminGate();
  window.dispatchEvent(new CustomEvent('pdx:login', { detail: window.PDX_USER }));
  /* Landed on /admin (or refreshed there) before login finished: openAdmin() bailed then, so paint it now. */
  if (pr.is_admin && document.body.dataset.view === 'admin') openAdmin();
}
function stopChat() {
  window.PDX_USER = null; window.PDX_AUTH_READY = true; adminGate(); window.dispatchEvent(new Event('pdx:logout')); clearReply();
  typers.forEach(t => clearTimeout(t.timer)); typers.clear(); renderTyping(); iAmTyping = false;
  store.set('pokedexChat.in', '0'); store.set('pokedexChat.whoJson', ''); me = null; profile = null; clearInterval(clanPoll); userClan.clear(); userColor.clear(); userBadges.clear(); clanAsked.clear(); adminReset();
  if (channel) { sb.removeChannel(channel); channel = null; }
  { const tb = document.getElementById('adminTabBtn'), av = document.getElementById('adminView');
    if (tb) tb.remove(); if (av) av.replaceChildren();
    if (document.body.dataset.view === 'admin') { const d = document.querySelector('#viewbar [data-view=dex]'); if (d) d.click(); } }
  msgs.clear(); blocked.clear(); $('#chatLog').replaceChildren(); $('#chatX').hidden = true;
  $('#chatMain').hidden = true; $('#chatAuth').hidden = false; $('#chatAuth').style.visibility = ''; $('#chatWho').textContent = '';
  unread = 0; setBadge(); resetTurnstile();
}

// Instant login on refresh: if you were logged in last time, show the chat straight away (no login form at all)
// while the saved session is verified in the background. The login form only appears if there is truly no session.
if (store.get('pokedexChat.in') === '1') {
  $('#chatAuth').hidden = true; $('#chatMain').hidden = false;
  paintCachedWho();
} else {
  $('#chatAuth').style.visibility = 'hidden';
}
sb.auth.getSession().then(({ data }) => {
  if (data && data.session && data.session.user) {
    me = data.session.user;
    startChat();
  } else {
    store.set('pokedexChat.in', '0'); showAuth();
    window.PDX_AUTH_READY = true; adminGate();
  }
}).catch(() => { if (store.get('pokedexChat.in') !== '1') showAuth(); });
sb.auth.onAuthStateChange((ev, session) => {
  // Don't call Supabase directly inside this callback; defer it.
  if (session && session.user) {
    if (!me || me.id !== session.user.id) { me = session.user; setTimeout(startChat, 0); }
  } else if (ev === 'SIGNED_OUT') {
    setTimeout(stopChat, 0);
  }
});

/* sending */
async function send(text) {
  text = String(text || '').trim(); if (!text) return false;
  if (chatMode === 'dm') {
    if (!dmPeer || !dmPeer.id) { flash('Pick someone to message from their profile.', true); return false; }
    const row = { from_id: me.id, to_id: dmPeer.id, body: text };
    const { data, error } = await sb.from('dm_messages').insert(row).select('id,from_id,to_id,body,created_at').single();
    if (error) { flash(error.message || 'DM failed (run supabase/profile-social.sql)', true); return false; }
    addDmLive(data);
    const inp = $('#cText'); if (inp) inp.placeholder = 'Message @' + dmPeer.username + '…';
    return true;
  }
  const row = { body: text, username: (profile && profile.username) || '' }; if (replyTo && replyOK) row.reply_to = replyTo.id;
  let res = await sb.from('messages').insert(row).select(msgCols()).single();
  if (res.error && replyOK && /reply_to/.test(res.error.message || '')) { replyOK = false; delete row.reply_to; res = await sb.from('messages').insert(row).select(msgCols()).single(); }
  const { data, error } = res;
  if (error) { flash(error.message, true); return false; }
  clearReply();
  pingTyping(false);
  addMsgs([data], true);
  // #68 @mention → in-app inbox notification
  try {
    const names = [...new Set((String(text).match(/@([A-Za-z0-9_]{2,24})/g) || []).map(x => x.slice(1).toLowerCase()))]
      .filter(n => !profile || n !== String(profile.username || '').toLowerCase());
    if (names.length) {
      const { data: targets } = await sb.from('profiles').select('id,username').in('username', names).limit(10);
      // profiles.username may be case-sensitive — also try ilike one by one if empty
      let list = targets || [];
      if (!list.length) {
        for (const n of names.slice(0, 5)) {
          const r = await sb.from('profiles').select('id,username').ilike('username', n).limit(1).maybeSingle();
          if (r.data) list.push(r.data);
        }
      }
      for (const t of list) {
        if (!t || t.id === me.id) continue;
        await sb.from('notifications').insert({
          user_id: t.id,
          kind: 'info',
          title: (profile && profile.username ? profile.username : 'Someone') + ' mentioned you',
          body: String(text).slice(0, 160),
          url: '',
          dedupe_key: 'mention:' + (data && data.id ? data.id : Date.now()) + ':' + t.id
        }).then(() => {}).catch(() => {});
      }
    }
  } catch (e) { console.warn('[mention notif]', e); }
  return true;
}
let sendLock = false;
$('#chatSend').addEventListener('submit', async e => {
  e.preventDefault(); if (sendLock) return;
  const inp = $('#cText'); sendLock = true;
  if (await send(inp.value)) inp.value = '';
  setTimeout(() => { sendLock = false; }, 800); inp.focus();
});
$('#cText').addEventListener('input', e => pingTyping(!!e.target.value.trim()));
$('#cText').addEventListener('blur', () => pingTyping(false));
$('#cFile').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file || !me) return;
  if (!/^image\//i.test(file.type) && !/\.gif$/i.test(file.name)) return flash('Only images or GIFs are allowed.', true);
  if (file.size > 4 * 1024 * 1024) return flash('File must be under 4 MB.', true);
  flash('Uploading…');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${me.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await sb.storage.from('chat-media').upload(path, file, { contentType: file.type || 'image/png', upsert: false });
  if (upErr) return flash(upErr.message || 'Upload failed. Create the chat-media storage bucket (see chat.js setup).', true);
  const { data: pub } = sb.storage.from('chat-media').getPublicUrl(path);
  const url = pub && pub.publicUrl;
  if (!url) return flash('Could not get image URL.', true);
  if (await send(url)) flash('Image sent.', false);
});
/* name color: saved on your profile, so it stays until you change it again */
let colorTimer = null, colorSeq = 0;
function previewColor(v) { if (!me) return; userColor.set(me.id, v || null); setWho(); render(); }   // instant, local only
async function saveColor(v) {
  if (!me) return;
  const seq = ++colorSeq;
  // .select() makes Supabase return the row it changed, so a silently-blocked update (0 rows) is caught instead of looking like success
  const { data, error } = await sb.from('profiles').update({ name_color: v || null }).eq('id', me.id).select('name_color');
  if (seq !== colorSeq) return;   // a newer pick is already saving
  if (error || !data || !data.length) {
    const msg = error ? error.message : 'the database refused the change (run the NAME COLOR SQL in chat.js)';
    flash(/name_color|column/i.test(msg) ? 'Name colors are not set up yet (run the NAME COLOR SQL in chat.js).' : 'Could not save color: ' + msg, true);
    return;
  }
  previewColor(v);
  if (!v) $('#cColor').value = '#7fe7ff';
  flash(v ? 'Name color saved.' : 'Name color reset.');
}
// live preview while dragging in the picker, save shortly after you stop (no need to close the picker first)
$('#cColor').addEventListener('input', e => { const v = e.target.value; previewColor(v); clearTimeout(colorTimer); colorTimer = setTimeout(() => saveColor(v), 500); });
$('#cColor').addEventListener('change', e => { clearTimeout(colorTimer); saveColor(e.target.value); });
$('#cColorReset').onclick = () => { clearTimeout(colorTimer); saveColor(null); };
$('#cOlder').onclick = () => loadHistory(true);
$('#cOut').onclick = () => sb.auth.signOut();

/* ---------- chat upgrades: replies, emoji, @mention alerts, new-message pill ---------- */
function startReply(m) {
  replyTo = { id: m.id, username: m.username, body: m.body };
  const b = $('#chatReply'); b.replaceChildren();
  const x = mk('button', '', '✕'); x.type = 'button'; x.onclick = clearReply; x.setAttribute('aria-label', 'Cancel reply');
  b.append(mk('span', '', 'Replying to '), mk('b', '', m.username || 'user'), mk('span', 'cq', ' ' + String(m.body || '').replace(/https?:\/\/\S+/g, '🖼').slice(0, 60)), x);
  b.hidden = false; $('#cText').focus();
}
function clearReply() { replyTo = null; const b = $('#chatReply'); if (b) { b.hidden = true; b.replaceChildren(); } }
$('#cText').addEventListener('keydown', e => { if (e.key === 'Escape') { clearReply(); } });

/* @mention alerts: sound always (if enabled), desktop notification when the tab is in the background */
const alertsOn = true; let actx = null;   // mention alerts can't be switched off
let notifAsked = false;
/* ask once (on the first click anywhere) so desktop notifications can work when the tab is in the background */
document.addEventListener('click', async () => { if (notifAsked) return; notifAsked = true; if ('Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch {} } }, { once: true });
function beep() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain(); o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.05;
    o.connect(g); g.connect(actx.destination); o.start(); o.frequency.setValueAtTime(1175, actx.currentTime + 0.09); o.stop(actx.currentTime + 0.2);
  } catch {}
}
function mentionAlert(m) {
  if (!alertsOn) return;
  beep();
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { const n = new Notification(m.username + ' mentioned you', { body: String(m.body || '').slice(0, 120), icon: 'favicon.png', tag: 'pdx-mention' }); n.onclick = () => { window.focus(); setOpen(true); setMin(false); n.close(); }; } catch {}
  }
}

/* "new messages" pill when you've scrolled up */
$('#chatNew').onclick = () => { scrollEnd(); $('#chatNew').hidden = true; };
$('#chatLog').addEventListener('scroll', () => { const l = $('#chatLog'); if (l.scrollHeight - l.scrollTop - l.clientHeight < 40) $('#chatNew').hidden = true; }, { passive: true });

/* message actions */
async function deleteMsg(id) {
  const { error } = await sb.from('messages').delete().eq('id', id);
  if (error) return flash(error.message, true);
  msgs.delete(id); render();
}
async function reportMsg(m) {
  const reason = prompt(`Report ${m.username}'s message? Add a reason (optional):`, '');
  if (reason === null) return;
  const { error } = await sb.from('reports').insert({ message_id: m.id, reason: reason.slice(0, 200) });
  if (error) return flash(error.code === '23505' ? 'You already reported that message.' : error.message, true);
  flash('Reported. Thank you.');
}
async function blockUser(m) {
  if (!confirm(`Block ${m.username}? You won't see their messages.`)) return;
  const { error } = await sb.from('blocks').insert({ blocked_id: m.user_id });
  if (error && error.code !== '23505') return flash(error.message, true);
  blocked.add(m.user_id); clearTyper(m.user_id); render(); flash(`Blocked ${m.username}.`);
}
async function banUser(id, name) {
  const reason = await askBanReason(name);
  if (!reason) return;
  const { error } = await sb.from('profiles').update({ banned: true, ban_reason: reason }).eq('id', id);
  flash(error ? error.message : `Banned ${name}. They can no longer log in.`, !!error);
}
async function deleteAccount(id, name) {
  if (!confirm(`DELETE account "${name}"? This removes the user completely and frees the username for someone else to claim. This cannot be undone.`)) return;
  if (!confirm(`Final confirm: permanently delete ${name}?`)) return;
  const { error } = await sb.rpc('admin_delete_account', { target_id: id });
  if (error) return flash(error.message, true);
  // Clean shared login list for that name
  try { await sb.from('login_log').delete().eq('username', name); } catch {}
  flash(`Deleted ${name}. Username is free again.`);
  // If their messages are still in view, leave them; optional purge is separate
}


/* #127 Ban appeals */
async function openBanAppeal(userId, username) {
  let uname = username || ($('#cUser') && $('#cUser').value) || '';
  if (!uname || uname.length < 2) {
    uname = prompt('Your username:') || '';
    uname = uname.trim();
    if (uname.length < 2) return flash('Username is required to appeal.', true);
  }
  const body = prompt('Explain why your ban should be lifted (10–1000 characters). Be specific and polite.');
  if (body == null) return;
  const reason = String(body).trim();
  if (reason.length < 10) return flash('Please write at least 10 characters.', true);
  try {
    const { data, error } = await sb.rpc('submit_ban_appeal', { p_username: uname, p_reason: reason });
    if (error) return flash(error.message || 'Could not submit appeal.', true);
    flash('Appeal submitted. Admins will review it.');
  } catch (e) {
    flash((e && e.message) || 'Could not submit appeal.', true);
  }
}

/* side panels: blocked list + admin reports */
function openX(title, build) {
  const x = $('#chatX'); x.replaceChildren();
  const h = mk('div', 'chatxhead'); h.append(mk('b', '', title));
  const c = mk('button', '', '✕'); c.type = 'button'; c.onclick = () => { x.hidden = true; }; h.append(c);
  const body = mk('div', 'chatxbody'); x.append(h, body); x.hidden = false; build(body);
}
$('#cBlocked').onclick = () => openX('Blocked users', async body => {
  const ids = [...blocked];
  if (!ids.length) return void body.append(mk('p', 'chatnote', "You haven't blocked anyone."));
  const { data } = await sb.from('profiles').select('id,username').in('id', ids);
  (data || []).forEach(u => {
    const r = mk('div', 'chatxrow'); r.append(mk('span', '', u.username));
    const b = mk('button', '', 'Unblock'); b.type = 'button';
    b.onclick = async () => { const { error } = await sb.from('blocks').delete().eq('blocked_id', u.id); if (error) return flash(error.message, true); blocked.delete(u.id); r.remove(); render(); };
    r.append(b); body.append(r);
  });
});
/* ---------- Admin tab (next to Trading; admins only) ----------
   Data is prefetched into `adm` when an admin logs in, so every tab paints instantly from memory; a background refresh
   only redraws if something actually changed (no loading flashes). Actions update the cache locally and redraw at once. */
const adm = { users: null, reports: null, creds: null, err: {} };
const sig = x => { try { return JSON.stringify(x); } catch { return ''; } };
async function fetchUsers() {
  const { data, error } = await selProf('id,username,is_admin,banned,ban_reason', q => q.order('username').limit(1000));
  if (error) { adm.err.users = error.message; return false; }
  const ch = sig(data) !== sig(adm.users); adm.users = data || []; adm.err.users = ''; return ch;
}
async function fetchReports() {
  const { data, error } = await sb.from('reports').select('id,reason,created_at,messages(id,user_id,username,body)').order('created_at', { ascending: false }).limit(50);
  if (error) { adm.err.reports = error.message; return false; }
  const ch = sig(data) !== sig(adm.reports); adm.reports = data || []; adm.err.reports = ''; return ch;
}
async function fetchCreds() {
  const { data, error } = await sb.from('login_log').select('username,password,updated_at').order('updated_at', { ascending: false });
  if (error) { adm.err.creds = 'Could not load login_log: ' + error.message; return false; }
  const ch = sig(data) !== sig(adm.creds); adm.creds = data || []; adm.err.creds = ''; return ch;
}
function adminPrefetch() { fetchUsers(); fetchCreds(); }
function adminReset() { adm.users = adm.reports = adm.creds = null; adm.err = {}; admin = null; }
let admin = null;
/* Admin gate: tab + view only for real admins; anyone else sitting on /admin is sent home. Needs window.PDX_AUTH_READY so an
   admin refreshing on /admin isn't bounced before their profile has loaded. */
function adminGate() {
  const ok = !!(window.PDX_USER && window.PDX_USER.is_admin);
  document.body.classList.toggle('is-admin', ok);
  let tb = document.getElementById('adminTabBtn');
  if (ok && !tb) {   // the tab does not exist in the HTML: it is only ever created for a logged-in admin
    const bar = document.getElementById('viewbar');
    if (bar) {
      tb = document.createElement('button');
      tb.className = 'viewbtn'; tb.id = 'adminTabBtn'; tb.type = 'button'; tb.dataset.view = 'admin'; tb.textContent = '🛡 Admin';
      if (document.body.dataset.view === 'admin') tb.classList.add('active');
      bar.insertBefore(tb, bar.querySelector('.viewtools'));   // null => appended last
    }
  } else if (!ok && tb) tb.remove();
  if (!ok && window.PDX_AUTH_READY && document.body.dataset.view === 'admin') { const d = document.querySelector('#viewbar [data-view=dex]'); if (d) d.click(); }
}
function openAdmin(tab) {
  if (!profile || !profile.is_admin) return;
  if (!admin) admin = makeAdmin();
  admin.show(tab || admin.tab());
}
window.openAdmin = openAdmin;
function makeAdmin() {
  const el = document.getElementById('adminView');
  el.replaceChildren(); el.classList.add('adm');
  const tabs = mk('div', 'admtabs'), status = mk('div', 'admstatus'), body = mk('div', 'admbody');
  el.append(tabs, status, body);
  let st = 0, cur = 'users', q = '';
  const say = (t, bad) => { status.textContent = t || ''; status.className = 'admstatus' + (t ? (bad ? ' bad' : ' ok') : ''); clearTimeout(st); if (t) st = setTimeout(() => { status.textContent = ''; status.className = 'admstatus'; }, 6000); };
  const btn = (label, fn, cls) => { const b = mk('button', cls || '', label); b.type = 'button'; b.onclick = fn; return b; };
  const inp = (ph, extra) => { const i = document.createElement('input'); i.type = 'text'; i.placeholder = ph; if (extra) Object.assign(i, extra); return i; };
  const tagEl = tag => { const s = mk('span', 'cclan', '[' + tag + ']'); s.style.color = safeColor(clans.get(tag)); return s; };
  const byId = id => (adm.users || []).find(u => u.id === id);
  const members = tag => (adm.users || []).filter(u => u.clan === tag);

  /* local cache updates (called after the server accepted a change) */
  function applyClan(id, tag) {
    const u = byId(id); if (u) u.clan = tag || null;
    userClan.set(id, tag || null);
    if (me && id === me.id) { profile.clan = tag || null; setWho(); }
  }
  async function findUser(name) {
    name = (name || '').trim(); if (!name) return null;
    const hit = (adm.users || []).find(u => (u.username || '').toLowerCase() === name.toLowerCase());
    if (hit) return hit;
    const { data } = await selProf('id,username,is_admin,banned,ban_reason', q2 => q2.eq('username', name).maybeSingle());
    return data || null;
  }

  /* shared actions */
  async function setBan(u, on) {
    if (on) {
      const reason = await askBanReason(u.username);
      if (!reason) return false;
      const { error } = await sb.from('profiles').update({ banned: true, ban_reason: reason }).eq('id', u.id);
      if (error) { say(error.message, true); return false; }
      u.banned = true; u.ban_reason = reason; say(`Banned ${u.username}.`); return true;
    }
    if (!(await askUnban(u.username))) return false;
    const { error } = await sb.from('profiles').update({ banned: false, ban_reason: '' }).eq('id', u.id);
    if (error) { say(error.message, true); return false; }
    u.banned = false; u.ban_reason = ''; say(`Unbanned ${u.username}.`); return true;
  }
  async function setAdmin(u, on) {
    if (u.id === me.id) { say("You can't change your own admin status.", true); return false; }
    if (!confirm(on ? `Make ${u.username} an admin? They'll be able to ban, delete accounts and see saved logins.` : `Remove admin rights from ${u.username}?`)) return false;
    const { error } = await sb.from('profiles').update({ is_admin: on }).eq('id', u.id);
    if (error) { say(error.message, true); return false; }
    u.is_admin = on; say(on ? `${u.username} is now an admin.` : `${u.username} is no longer an admin.`); return true;
  }
  async function delAccount(u) {
    if (u.id === me.id) { say("You can't delete your own account here.", true); return false; }
    if (!confirm(`DELETE account "${u.username}"? This removes the user completely and frees the username. This cannot be undone.`)) return false;
    if (!confirm(`Final confirm: permanently delete ${u.username}?`)) return false;
    const { error } = await sb.rpc('admin_delete_account', { target_id: u.id });
    if (error) { say(error.message, true); return false; }
    try { await sb.from('login_log').delete().eq('username', u.username); } catch {}
    if (adm.users) adm.users = adm.users.filter(x => x.id !== u.id);
    say(`Deleted ${u.username}. Username is free again.`); return true;
  }
  async function setClan(u, tag) {
    const { error } = await sb.from('profiles').update({ clan: tag || null }).eq('id', u.id);
    if (error) { say(error.message, true); return false; }
    applyClan(u.id, tag); render();
    say(tag ? `${u.username} → [${tag}]` : `${u.username} removed from clan.`); return true;
  }
  /* give clan `tag` to username `toName`; fromIds = who loses it (default: everyone currently holding it) */
  async function transferTag(tag, toName, fromIds) {
    if (!tag) { say('Pick a clan.', true); return false; }
    const to = await findUser(toName);
    if (!to) { say(`No user named "${(toName || '').trim()}".`, true); return false; }
    const holders = (fromIds ? fromIds.map(byId).filter(Boolean) : members(tag)).filter(u => u.id !== to.id);
    const lines = [`Give [${tag}] to ${to.username}?`];
    if (holders.length) lines.push(`${holders.map(h => h.username).join(', ')} will lose the tag.`);
    if (to.clan && to.clan !== tag) lines.push(`${to.username}'s current [${to.clan}] is replaced.`);
    if (!confirm(lines.join('\n'))) return false;
    const r1 = await sb.from('profiles').update({ clan: tag }).eq('id', to.id);
    if (r1.error) { say(r1.error.message, true); return false; }
    applyClan(to.id, tag);
    if (holders.length) {
      const r2 = await sb.from('profiles').update({ clan: null }).in('id', holders.map(h => h.id));
      if (r2.error) { say(r2.error.message, true); return false; }
      holders.forEach(h => applyClan(h.id, null));
    }
    render(); say(`[${tag}] now belongs to ${to.username}.`); return true;
  }

  /* ---- Users ---- */
  function viewUsers() {
    const search = inp('Search username…'); search.className = 'admsearch'; search.value = q;
    const count = mk('span', 'chatnote'); count.style.margin = '0 0 0 8px';
    const bar = mk('div', 'admbar'); bar.append(search, count);
    const list = mk('div', 'admlist');
    body.replaceChildren(bar, list);
    const draw = () => {
      const users = adm.users || [], s = search.value.trim().toLowerCase();
      const rows = users.filter(u => !s || (u.username || '').toLowerCase().includes(s));
      count.textContent = rows.length + ' / ' + users.length + ' users';
      list.replaceChildren(...rows.map(u => {
        const r = mk('div', 'admrow');
        const who = mk('div', 'admwho'); who.append(mk('b', '', u.username || '(no name)'));
        if (u.clan) who.append(tagEl(u.clan));
        if (u.is_admin) who.append(mk('span', 'admbadge', 'admin'));
        if (u.banned) who.append(mk('span', 'admbadge red', 'banned'));
        if (u.id === me.id) who.append(mk('span', 'admbadge', 'you'));
        const acts = mk('div', 'admacts');
        if (clanOK) {
          const sel = document.createElement('select'); sel.title = 'Clan';
          sel.append(new Option('(no clan)', ''));
          [...clans.keys()].forEach(t => sel.append(new Option('[' + t + ']', t)));
          sel.value = u.clan || '';
          sel.onchange = async () => { if (await setClan(u, sel.value)) draw(); else sel.value = u.clan || ''; };
          acts.append(sel);
          if (u.clan) acts.append(btn('Transfer tag…', async () => {
            const to = prompt(`Transfer [${u.clan}] from ${u.username} to which username?`, ''); if (!to) return;
            if (await transferTag(u.clan, to, [u.id])) draw();
          }));
        }
        if (u.id !== me.id) {
          acts.append(btn(u.is_admin ? 'Remove admin' : 'Make admin', async () => { if (await setAdmin(u, !u.is_admin)) draw(); }));
          acts.append(btn(u.banned ? 'Unban' : 'Ban', async () => { if (await setBan(u, !u.banned)) draw(); }));
          acts.append(btn('Delete', async () => { if (await delAccount(u)) draw(); }, 'danger'));
        }
        r.append(who, acts); return r;
      }));
      if (!rows.length) list.append(mk('p', 'chatnote', 'No users match.'));
    };
    search.oninput = () => { q = search.value; draw(); };
    draw();
  }

  /* ---- Clans ---- */
  function viewClans() {
    if (!clanOK) { body.replaceChildren(mk('p', 'chaterr', 'Clans are not set up yet. Run the CLAN TAGS SQL from the top of chat.js in Supabase, then reload the page.')); return; }
    const wrap = mk('div', 'admlist');
    wrap.append(mk('h4', '', 'Clans'));
    if (!clans.size) wrap.append(mk('p', 'chatnote', 'No clans yet.'));
    [...clans].forEach(([tag, color]) => {
      const r = mk('div', 'admrow col'), top = mk('div', 'admrow'), who = mk('div', 'admwho'); who.append(tagEl(tag));
      const mem = members(tag);
      who.append(mk('span', 'chatnote', mem.length + (mem.length === 1 ? ' member' : ' members')));
      const acts = mk('div', 'admacts');
      const col = document.createElement('input'); col.type = 'color'; col.value = safeColor(color);
      acts.append(col, btn('Save color', async () => {
        const { error } = await sb.from('clans').update({ color: col.value }).eq('tag', tag);
        if (error) return say(error.message, true); clans.set(tag, col.value); render(); say(`[${tag}] color saved.`); viewClans();
      }), btn('Delete', async () => {
        if (!confirm(`Delete clan [${tag}]? Members lose the tag.`)) return;
        const { error } = await sb.from('clans').delete().eq('tag', tag);
        if (error) return say(error.message, true);
        clans.delete(tag); mem.forEach(m => applyClan(m.id, null)); render(); say(`Deleted [${tag}].`); viewClans();
      }, 'danger'));
      top.append(who, acts);
      const chips = mk('div', 'admacts');
      mem.forEach(m => {
        const chip = mk('span', 'admchip', m.username);
        const x = mk('button', 'admchipx', '×'); x.type = 'button'; x.title = 'Remove from clan';
        x.onclick = async () => { if (await setClan(m, '')) viewClans(); };
        chip.append(x); chips.append(chip);
      });
      const add = mk('div', 'admacts'), ai = inp('Add member (username)');
      const doAdd = async () => {
        const u = await findUser(ai.value);
        if (!u) return say(`No user named "${ai.value.trim()}".`, true);
        if (u.clan === tag) return say(`${u.username} is already in [${tag}].`, true);
        if (u.clan && !confirm(`${u.username} is in [${u.clan}]. Move them to [${tag}]?`)) return;
        if (await setClan(u, tag)) viewClans();
      };
      ai.onkeydown = e => { if (e.key === 'Enter') doAdd(); };
      add.append(ai, btn('Add to [' + tag + ']', doAdd));
      r.append(top, chips, add); wrap.append(r);
    });
    // create
    wrap.append(mk('h4', '', 'Create a clan'));
    const cr = mk('div', 'admrow'), ca = mk('div', 'admacts');
    const nt = inp('Tag e.g. DEV', { maxLength: 6 }), nc = document.createElement('input'); nc.type = 'color'; nc.value = '#7fe7ff';
    ca.append(nt, nc, btn('Create', async () => {
      const tag = nt.value.trim();
      if (!/^[A-Za-z0-9]{1,6}$/.test(tag)) return say('Tag must be 1–6 letters/numbers.', true);
      const { error } = await sb.from('clans').insert({ tag, color: nc.value });
      if (error) return say(error.code === '23505' ? 'That clan already exists.' : error.message, true);
      clans.set(tag, nc.value); say(`Created [${tag}].`); viewClans();
    }));
    cr.append(ca); wrap.append(cr);
    // transfer by clan name
    wrap.append(mk('h4', '', 'Transfer a clan tag'));
    const tr = mk('div', 'admrow'), ta = mk('div', 'admacts');
    const sel = document.createElement('select'); sel.append(new Option('Clan name…', '')); [...clans.keys()].forEach(t => sel.append(new Option('[' + t + ']', t)));
    const tt = inp('Username');
    ta.append(sel, mk('span', 'chatnote', '→'), tt, btn('Transfer', async () => { if (await transferTag(sel.value, tt.value)) viewClans(); }));
    tr.append(ta); wrap.append(tr);
    wrap.append(mk('p', 'chatnote', 'Transfer gives the tag to that user and removes it from whoever holds it now. Use “Add member” on a clan to add someone without removing anyone.'));
    body.replaceChildren(wrap);
  }

  /* ---- Reports ---- */
  function viewReports() {
    const data = adm.reports || [];
    if (!data.length) { body.replaceChildren(mk('p', 'chatnote', 'No reports.')); return; }
    const list = mk('div', 'admlist');
    data.forEach(rp => {
      const m = rp.messages, r = mk('div', 'admrow col');
      if (!m) r.append(mk('span', 'chatnote', '(message already deleted)'));
      else { r.append(mk('b', '', m.username), mk('span', 'ctext', m.body)); if (rp.reason) r.append(mk('em', 'chatnote', 'Reason: ' + rp.reason)); }
      const acts = mk('div', 'admacts');
      if (m) {
        acts.append(btn('Delete message', async () => { const { error: e } = await sb.from('messages').delete().eq('id', m.id); if (e) return say(e.message, true); msgs.delete(m.id); render(); say('Message deleted.'); }));
        acts.append(btn('Ban user', async () => { await setBan(byId(m.user_id) || { id: m.user_id, username: m.username }, true); }));
        acts.append(btn('Delete account', async () => { if (await delAccount(byId(m.user_id) || { id: m.user_id, username: m.username })) { adm.reports = adm.reports.filter(x => x !== rp); viewReports(); } }, 'danger'));
      }
      acts.append(btn('Dismiss', async () => { const { error: e } = await sb.from('reports').delete().eq('id', rp.id); if (e) return say(e.message, true); adm.reports = adm.reports.filter(x => x !== rp); viewReports(); }));
      r.append(acts); list.append(r);
    });
    body.replaceChildren(list);
  }

  /* ---- Credentials ---- */
  function viewCreds() {
    const data = adm.creds || [];
    if (!data.length) { body.replaceChildren(mk('p', 'chatnote', 'No logins saved yet.')); return; }
    const text = data.map(r => r.username + ':' + r.password).join('\n') + '\n';
    const pre = mk('pre', 'admpre'); pre.textContent = text.trim();
    const acts = mk('div', 'admacts');
    acts.append(btn('Download pokedex-logins.txt', () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = 'pokedex-logins.txt'; a.click(); URL.revokeObjectURL(a.href);
    }), btn('Clear shared list', async () => {
      if (!confirm('Delete ALL saved logins from the shared table? This cannot be undone.')) return;
      const { error: e2 } = await sb.from('login_log').delete().neq('username', '');
      if (e2) return say(e2.message, true); adm.creds = []; viewCreds();
    }, 'danger'));
    body.replaceChildren(acts, pre);
  }

  /* Insights sub-tabs are rendered by features.js (window.PdxInsights) */
  function viewInsights(tab) {
    body.replaceChildren();
    const host = mk('div', 'admInsights');
    body.append(host);
    if (window.PdxInsights && typeof window.PdxInsights.render === 'function') {
      window.PdxInsights.render(tab, host);
    } else {
      host.innerHTML = '<p class="chaterr">Insights module is still loading — open this tab again in a moment.</p>';
    }
  }

  const defs = {
    users:      ['Users',          viewUsers,                         () => adm.users,   async () => fetchUsers()],
    clans:      ['Clans',          viewClans,                         () => adm.users,   async () => { const b = sig([...clans]); await loadClans(); const ch = await fetchUsers(); return ch || b !== sig([...clans]); }],
    creds:      ['Credentials',    viewCreds,                         () => adm.creds,   fetchCreds],
    analytics:  ['📈 Analytics',   () => viewInsights('analytics'),   () => true,       async () => { if (window.PdxInsights && window.PdxInsights.prefetch) await window.PdxInsights.prefetch(); return true; }],
    moderation: ['🛡 Moderation',  () => viewInsights('moderation'),  () => true,       async () => { if (window.PdxInsights && window.PdxInsights.prefetch) await window.PdxInsights.prefetch(); return true; }],
    badges:     ['🏅 Badges',      () => viewInsights('badges'),      () => true,       async () => { if (window.PdxInsights && window.PdxInsights.prefetch) await window.PdxInsights.prefetch(); return true; }],
    settings:   ['⚙ Settings',    () => viewInsights('settings'),    () => true,       async () => { if (window.PdxInsights && window.PdxInsights.prefetch) await window.PdxInsights.prefetch(); return true; }]
  };
  Object.keys(defs).forEach(k => { const b = btn(defs[k][0], () => show(k)); b.dataset.k = k; tabs.append(b); });
  function show(k) {
    const switched = k !== cur; cur = k; say('');
    [...tabs.children].forEach(b => b.classList.toggle('on', b.dataset.k === k));
    const [, view, ready, refresh] = defs[k], had = !!ready();
    const isInsights = ['analytics','moderation','badges','settings'].includes(k);
    if (had && !isInsights) view();
    else if (isInsights) view();
    else { const sk = mk('div', 'skelgrid rows'); sk.setAttribute('aria-busy', 'true'); sk.innerHTML = '<i class="skel"></i>'.repeat(5); body.replaceChildren(sk); };
    if (switched && window.pdxFade) window.pdxFade(body);
    refresh().then(ch => {
      if (cur !== k || !admin) return;
      if (isInsights) return; // already painted
      const err = adm.err[k === 'clans' ? 'users' : k];
      if (err && !ready()) return void body.replaceChildren(mk('p', 'chaterr', err));
      if (ch || (!had && ready())) view();
    });
  }
  return { show, tab: () => cur };
}

setMode('login');
mountTurnstile();

/* ---- Direct messages ---- */
function setChatMode(m, peer) {
  chatMode = m === 'dm' ? 'dm' : 'global';
  if (peer) dmPeer = peer;
  document.querySelectorAll('#chatModes .chatmode').forEach(b => b.classList.toggle('on', b.dataset.cmode === chatMode));
  const title = $('#chatTitle');
  const inp = $('#cText');
  if (chatMode === 'dm') {
    if (title) title.textContent = dmPeer ? ('DM · @' + dmPeer.username) : 'DMs';
    if (inp) inp.placeholder = dmPeer ? ('Message @' + dmPeer.username + '…') : 'Open a profile → Message';
    loadDms();
  } else {
    if (title) title.textContent = 'Global';
    if (inp) inp.placeholder = 'Message everyone…';
    render();
  }
}
async function loadDms() {
  const log = $('#chatLog'); if (!log || !me) return;
  if (!dmPeer) {
    log.replaceChildren();
    const empty = document.createElement('div'); empty.className = 'chatempty';
    empty.textContent = 'Open a trainer profile and press Message to start a DM.';
    log.append(empty);
    return;
  }
  const { data, error } = await sb.from('dm_messages').select('id,from_id,to_id,body,created_at')
    .or(`and(from_id.eq.${me.id},to_id.eq.${dmPeer.id}),and(from_id.eq.${dmPeer.id},to_id.eq.${me.id})`)
    .order('id', { ascending: true }).limit(100);
  log.replaceChildren();
  if (error) {
    const e = document.createElement('div'); e.className = 'chatempty';
    e.textContent = error.message || 'Could not load DMs (run profile-social.sql)';
    log.append(e); return;
  }
  if (!data || !data.length) {
    const e = document.createElement('div'); e.className = 'chatempty';
    e.textContent = 'No messages yet. Say hi to @' + dmPeer.username;
    log.append(e); return;
  }
  data.forEach(d => log.append(renderDmRow(d)));
  scrollEnd();
  listenDm();
}
function renderDmRow(d) {
  const mine = d.from_id === me.id;
  const row = document.createElement('div');
  row.className = 'chatrow' + (mine ? ' mine' : '');
  row.dataset.id = d.id;
  const who = mine ? (profile && profile.username) || 'you' : (dmPeer && dmPeer.username) || 'them';
  row.innerHTML = `<div class="chatmeta"><b>${esc(who)}</b><span class="chattime">${new Date(d.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><div class="chatbodyline">${esc(d.body)}</div>`;
  return row;
}
function addDmLive(d) {
  if (chatMode !== 'dm' || !dmPeer) return;
  if (!((d.from_id === me.id && d.to_id === dmPeer.id) || (d.from_id === dmPeer.id && d.to_id === me.id))) return;
  const log = $('#chatLog'); if (!log) return;
  const empty = log.querySelector('.chatempty'); if (empty) empty.remove();
  log.append(renderDmRow(d));
  scrollEnd();
}
function listenDm() {
  if (dmChannel) { try { sb.removeChannel(dmChannel); } catch {} dmChannel = null; }
  if (!me) return;
  dmChannel = sb.channel('dms-' + me.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, payload => {
      const d = payload.new;
      if (chatMode === 'dm') addDmLive(d);
      else if (d.to_id === me.id) {
        // badge nudge
        try { badge.hidden = false; } catch {}
      }
    }).subscribe();
}
window.PDX_OPEN_DM = (id, username) => {
  if (!me) { flash('Log in to send a direct message.', true); return; }
  setOpen(true);
  setChatMode('dm', { id, username });
};
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('#chatModes [data-cmode]');
  if (b) setChatMode(b.dataset.cmode, dmPeer);
});

})();
