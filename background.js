/**
 * Site-wide background image for GO Pokédex Tracker.
 * Admin sets URL in Insights → Settings; stored in site_settings key "background".
 * Applies a fixed cover image with a dark overlay so UI stays readable.
 */
(function () {
  'use strict';

  const SETTING_KEY = 'background';
  const CACHE_KEY = 'pdx.bg.site';
  const DEFAULT_URL = ''; // empty = theme solid / CSS default

  function readCache() {
    try {
      const v = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (v && typeof v.url === 'string') return { url: v.url, overlay: clampOverlay(v.overlay) };
    } catch {}
    return { url: DEFAULT_URL, overlay: 0.55 };
  }
  function writeCache(cfg) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cfg)); } catch {}
  }
  function clampOverlay(n) {
    const x = Number(n);
    if (!isFinite(x)) return 0.55;
    return Math.max(0, Math.min(0.95, x));
  }

  let cfg = readCache();
  let styleEl = null;

  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return styleEl;
    styleEl = document.getElementById('pdxBgCSS');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'pdxBgCSS';
      document.head.appendChild(styleEl);
    }
    return styleEl;
  }

  function apply(cfgIn, { fromServer } = {}) {
    cfg = {
      url: (cfgIn && typeof cfgIn.url === 'string') ? cfgIn.url.trim() : '',
      overlay: clampOverlay(cfgIn && cfgIn.overlay)
    };
    writeCache(cfg);

    const el = ensureStyle();
    // Remove previous video layer if any
    const oldVid = document.getElementById('pdxBgVideo');
    if (oldVid) oldVid.remove();
    { const L = document.getElementById('pdxBgImg'); if (L && (!cfg.url || /\.(mp4|webm|ogg)(\?|$)/i.test(cfg.url))) L.remove(); }

    if (!cfg.url) {
      el.textContent = '';
    } else {
      const o = cfg.overlay;
      const url = cfg.url;
      const isVideo = /\.(mp4|webm|ogg)(\?|$)/i.test(url) || /^data:video\//i.test(url);
      if (isVideo) {
        el.textContent = `
          body {
            background: #0a0a0f !important;
          }
          body::before {
            content: "";
            position: fixed;
            inset: 0;
            z-index: -1;
            pointer-events: none;
            background: rgba(10, 10, 15, ${o}) !important;
          }
          #pdxBgVideo {
            position: fixed;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            z-index: -2;
            pointer-events: none;
          }
        `;
        const v = document.createElement('video');
        v.id = 'pdxBgVideo';
        v.src = url;
        v.autoplay = true;
        v.loop = true;
        v.muted = true;
        v.playsInline = true;
        v.setAttribute('aria-hidden', 'true');
        document.body.prepend(v);
        v.play().catch(() => {});
      } else {
        const safeUrl = url.replace(/\\/g, '\\\\').replace(/"/g, '%22').replace(/'/g, '%27');
        el.textContent = `
          body { background: #0a0a0f !important; }
          body::before { background: transparent !important; }
          #pdxBgImg {
            position: fixed; inset: 0; z-index: -2; pointer-events: none;
            background:
              linear-gradient(rgba(10, 10, 15, ${o}), rgba(10, 10, 15, ${o})),
              url("${safeUrl}") center top / cover no-repeat;
            transform: translateZ(0); will-change: transform;
          }
        `;
        let layer = document.getElementById('pdxBgImg');
        if (!layer) { layer = document.createElement('div'); layer.id = 'pdxBgImg'; layer.setAttribute('aria-hidden', 'true'); document.body.prepend(layer); }
      }
    }

    try {
      window.dispatchEvent(new CustomEvent('pdx:background', { detail: { ...cfg } }));
    } catch {}

    if (!fromServer) saveToServer(cfg);
  }

  async function loadFromServer() {
    const client = window.PDX_SB;
    if (!client) return;
    try {
      const { data, error } = await client.from('site_settings').select('value').eq('key', SETTING_KEY).maybeSingle();
      if (error || !data || !data.value) return;
      const next = {
        url: typeof data.value.url === 'string' ? data.value.url : '',
        overlay: clampOverlay(data.value.overlay)
      };
      if (next.url !== cfg.url || next.overlay !== cfg.overlay) apply(next, { fromServer: true });
    } catch {}
  }

  async function saveToServer(c) {
    const client = window.PDX_SB;
    if (!client) return;
    try {
      await client.from('site_settings').upsert({
        key: SETTING_KEY,
        value: { url: c.url || '', overlay: clampOverlay(c.overlay) },
        updated_at: new Date().toISOString()
      });
    } catch {}
  }

  function listenRealtime() {
    const client = window.PDX_SB;
    if (!client || window.__pdxBgChan) return;
    try {
      window.__pdxBgChan = client
        .channel('background-live')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'site_settings',
          filter: 'key=eq.' + SETTING_KEY
        }, payload => {
          const v = payload.new && payload.new.value;
          if (!v) return;
          apply({
            url: typeof v.url === 'string' ? v.url : '',
            overlay: clampOverlay(v.overlay)
          }, { fromServer: true });
        })
        .subscribe();
    } catch {}
  }

  window.PdxBackground = {
    set(cfg) { apply(cfg); },
    applyFromServer(cfg) { apply(cfg, { fromServer: true }); },
    get: () => ({ ...cfg }),
    reload: loadFromServer
  };

  function boot() {
    // Apply cached immediately so first paint is correct
    apply(cfg, { fromServer: true });

    const tryLoad = () => {
      if (window.PDX_SB) {
        loadFromServer().then(() => listenRealtime());
        return true;
      }
      return false;
    };
    if (!tryLoad()) {
      let n = 0;
      const t = setInterval(() => {
        if (tryLoad() || ++n > 40) clearInterval(t);
      }, 250);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
