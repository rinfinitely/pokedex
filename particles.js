/**
 * Background rain for GO Pokédex Tracker
 * Same animation style as the Krunker menu-particle userscript (rain mode only).
 * Respects prefers-reduced-motion. Site-wide on/off via site_settings key "particles".
 */
(function () {
  'use strict';

  const SETTING_KEY = 'particles';
  const CACHE_KEY = 'pdx.particles.site';
  const rand = (a, b) => a + Math.random() * (b - a);

  // Match the userscript rain look
  const CONFIG = {
    count: 110,
    color: '200, 220, 255',
    width: 1.6,
    alpha: [0.35, 0.7],
    speed: 2.4,
    zIndex: -1
  };

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function readCache() {
    try {
      const v = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (v && typeof v.enabled === 'boolean') return v.enabled;
    } catch {}
    return true;
  }
  function writeCache(enabled) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ enabled: !!enabled })); } catch {}
  }

  // Rain is always on site-wide (no admin toggle). Only prefers-reduced-motion can suppress it.
  let siteEnabled = true;
  let enabled = !reduced;

  const canvas = document.createElement('canvas');
  canvas.id = 'pdxParticles';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d', { alpha: true });

  let particles = [];
  let raf = 0;
  let last = 0;
  let dt = 1;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function makeParticle(initial) {
    const len = rand(60, 220);
    return {
      x: rand(0, innerWidth),
      y: initial ? rand(0, innerHeight + len) : -len,
      len,
      vy: rand(9, 18),
      a: rand(CONFIG.alpha[0], CONFIG.alpha[1])
    };
  }

  function step(p) {
    p.y += p.vy * dt;
    return p.y - p.len > innerHeight;
  }

  function draw(p) {
    const c = CONFIG.color;
    const g = ctx.createLinearGradient(0, p.y - p.len, 0, p.y);
    g.addColorStop(0, 'rgba(' + c + ', 0)');
    g.addColorStop(1, 'rgba(' + c + ', 1)');
    ctx.globalAlpha = p.a;
    ctx.strokeStyle = g;
    ctx.lineWidth = CONFIG.width;
    ctx.beginPath();
    ctx.moveTo(p.x + 0.5, p.y - p.len);
    ctx.lineTo(p.x + 0.5, p.y);
    ctx.stroke();
  }

  function tick(now) {
    dt = Math.min(Math.max((now - last) / 16.667, 0), 3) * CONFIG.speed;
    last = now;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (step(p)) {
        Object.assign(p, makeParticle(false));
        continue;
      }
      draw(p);
    }
    raf = requestAnimationFrame(tick);
  }

  function start() {
    if (raf || !enabled) return;
    if (!canvas.isConnected) document.body.appendChild(canvas);
    resize();
    particles = Array.from({ length: CONFIG.count }, () => makeParticle(true));
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (ctx) ctx.clearRect(0, 0, innerWidth, innerHeight);
  }

  function applyEnabled(on, { fromServer } = {}) {
    // Always on — ignore off requests from old settings rows
    siteEnabled = true;
    enabled = !reduced;
    writeCache(true);
    if (enabled) start();
    else stop();
    announce();
  }

  function announce() {
    try {
      window.dispatchEvent(new CustomEvent('pdx:particles', {
        detail: { enabled: siteEnabled, active: enabled }
      }));
    } catch {}
  }

  async function loadFromServer() {
    // No remote toggle — rain stays on
    applyEnabled(true, { fromServer: true });
  }

  async function saveToServer(on) {
    const client = window.PDX_SB;
    if (!client) return;
    try {
      await client.from('site_settings').upsert({
        key: SETTING_KEY,
        value: { enabled: !!on },
        updated_at: new Date().toISOString()
      });
    } catch {}
  }

  function listenRealtime() {
    const client = window.PDX_SB;
    if (!client || window.__pdxPartChan) return;
    try {
      window.__pdxPartChan = client
        .channel('particles-live')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'site_settings',
          filter: 'key=eq.' + SETTING_KEY
        }, payload => {
          applyEnabled(true, { fromServer: true });
        })
        .subscribe();
    } catch {}
  }

  function injectStyles() {
    if (document.getElementById('pdxParticleCSS')) return;
    const style = document.createElement('style');
    style.id = 'pdxParticleCSS';
    style.textContent = `
      #pdxParticles {
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: ${CONFIG.zIndex};
        opacity: 0.9;
      }
    `;
    document.head.appendChild(style);
  }

  window.PdxParticles = {
    setEnabled(on) { applyEnabled(on); },
    applyFromServer(on) { applyEnabled(on, { fromServer: true }); },
    isEnabled: () => siteEnabled,
    isActive: () => enabled,
    reload: loadFromServer
  };

  function boot() {
    injectStyles();
    addEventListener('resize', () => { if (raf) resize(); }, { passive: true });

    if (document.body) {
      if (enabled) start();
      announce();
    }

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

  const later = () => setTimeout(boot, 3000);
  if (document.readyState === 'complete') later(); else window.addEventListener('load', later);
})();
