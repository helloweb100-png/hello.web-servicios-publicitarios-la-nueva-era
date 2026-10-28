/* ==========================================================================
   SERVICIOS PUBLICITARIOS LA NUEVA ERA | app.js
   Sin dependencias. Un solo bucle requestAnimationFrame (sin listeners de scroll)
   que lee scrollY, lo suaviza (sensación "slow motion") y reparte el progreso
   a cada coreografía. Todo respeta prefers-reduced-motion.
   ========================================================================== */
(() => {
'use strict';

/* ---------------------------------------------------------------- helpers */
const $  = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
const clamp  = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp   = (a, b, t) => a + (b - a) * t;
const rand   = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeInOut = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const docTop = el => el.getBoundingClientRect().top + window.scrollY;
const wait = ms => new Promise(r => setTimeout(r, ms));
const root = document.documentElement;
const body = document.body;

const WA_NUMBER = '524433099999';
const FOUNDED = 2001;
const waLink = msg => `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`;

const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
let reduce = mqReduce.matches;
const syncReduce = () => { reduce = mqReduce.matches; root.classList.toggle('rm', reduce); };
syncReduce();
if (mqReduce.addEventListener) mqReduce.addEventListener('change', syncReduce);
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// Bloqueo de scroll mientras carga y arranque siempre arriba
root.classList.add('lock');
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

/* Estado compartido del bucle */
const S = { y: 0, sy: 0, vy: 0, dir: 1, vh: innerHeight, vw: innerWidth, t: 0, dt: 16.67 };
S.y = S.sy = window.scrollY;
const tickers = [];
const measurers = [];

/* ------------------------------------------------------- texto por palabras */
function splitWords(el) {
  let n = 0;
  const walk = node => {
    Array.from(node.childNodes).forEach(ch => {
      if (ch.nodeType === 3) {
        const frag = document.createDocumentFragment();
        ch.textContent.split(/(\s+)/).forEach(part => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
          const w = document.createElement('span'); w.className = 'w';
          const i = document.createElement('span'); i.className = 'wi';
          i.style.setProperty('--i', n++);
          i.textContent = part;
          w.appendChild(i); frag.appendChild(w);
        });
        ch.replaceWith(frag);
      } else if (ch.nodeType === 1 && ch.tagName !== 'BR') {
        walk(ch);
      }
    });
  };
  walk(el);
}

function splitScrub(el) {
  const words = [];
  const walk = node => {
    Array.from(node.childNodes).forEach(ch => {
      if (ch.nodeType === 3) {
        const frag = document.createDocumentFragment();
        ch.textContent.split(/(\s+)/).forEach(part => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
          const s = document.createElement('span'); s.className = 'sw'; s.textContent = part;
          frag.appendChild(s); words.push(s);
        });
        ch.replaceWith(frag);
      } else if (ch.nodeType === 1) walk(ch);
    });
  };
  walk(el);
  return words;
}

/* -------------------------------------------------------- sprites de brillo */
const DARK_PAL  = [[255, 236, 170], [255, 247, 214], [244, 200, 100], [255, 220, 130]];
const LIGHT_PAL = [[168, 128, 36], [122, 90, 16], [190, 150, 50], [96, 68, 8]];

function makeSprite(rgb, star, light) {
  const s = 64, r = s / 2, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const [R, G, B] = rgb;
  const core = light ? `rgba(${R},${G},${B},1)` : 'rgba(255,255,255,1)';
  if (!star) {
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, core);
    gr.addColorStop(.16, `rgba(${R},${G},${B},.95)`);
    gr.addColorStop(.45, `rgba(${R},${G},${B},.26)`);
    gr.addColorStop(1, `rgba(${R},${G},${B},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  } else {
    const gr = g.createRadialGradient(r, r, 0, r, r, r * .55);
    gr.addColorStop(0, core);
    gr.addColorStop(1, `rgba(${R},${G},${B},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    g.fillStyle = `rgba(${R},${G},${B},1)`;
    g.beginPath();
    g.moveTo(r, 1);
    g.quadraticCurveTo(r + 2, r - 2, s - 1, r);
    g.quadraticCurveTo(r + 2, r + 2, r, s - 1);
    g.quadraticCurveTo(r - 2, r + 2, 1, r);
    g.quadraticCurveTo(r - 2, r - 2, r, 1);
    g.fill();
  }
  return c;
}
const SPR = {
  dark:  { glow: DARK_PAL.map(c => makeSprite(c, false, false)),  star: DARK_PAL.map(c => makeSprite(c, true, false)) },
  light: { glow: LIGHT_PAL.map(c => makeSprite(c, false, true)),  star: LIGHT_PAL.map(c => makeSprite(c, true, true)) }
};

/* ============================================================== SONIDO */
const Sound = (() => {
  const bgm = $('#bgm');
  const btn = $('#snd');
  const label = $('#snd-t');
  const sources = bgm ? $$('source', bgm) : [];
  const MAX = .5;
  let state = 'unknown';           // unknown | ok | none
  let failed = 0, want = false, raf = 0, ducked = false;
  const waiters = [];

  const settle = ok => {
    if (state !== 'unknown') return;
    state = ok ? 'ok' : 'none';
    waiters.splice(0).forEach(r => r(ok));
    if (!ok && btn) btn.hidden = true;
  };

  if (!bgm || !sources.length) {
    settle(false);
  } else {
    sources.forEach(s => s.addEventListener('error', () => { if (++failed >= sources.length) settle(false); }));
    bgm.addEventListener('loadedmetadata', () => settle(true));
    bgm.addEventListener('canplay', () => settle(true));
    bgm.load(); // reinicia la selección de recurso ya con los listeners puestos
  }

  const availability = (timeout = 1200) => {
    if (state !== 'unknown') return Promise.resolve(state === 'ok');
    return new Promise(res => {
      waiters.push(res);
      setTimeout(() => { if (state === 'unknown') settle(bgm.networkState !== 3); }, timeout);
    });
  };

  const ramp = (to, ms) => {
    cancelAnimationFrame(raf);
    const from = bgm.volume, t0 = performance.now();
    const step = now => {
      const k = clamp((now - t0) / ms);
      bgm.volume = clamp(from + (to - from) * k);
      if (k < 1) raf = requestAnimationFrame(step);
      else if (to === 0) bgm.pause();
    };
    raf = requestAnimationFrame(step);
  };

  const paint = () => {
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(want));
    if (label) label.textContent = want ? 'Sonido activado' : 'Sonido apagado';
  };

  const remember = () => { try { localStorage.setItem('lne-sound', want ? '1' : '0'); } catch (e) { /* sin storage */ } };

  async function start() {
    if (state !== 'ok') return;
    want = true;
    try { bgm.volume = 0; await bgm.play(); ramp(ducked ? .08 : MAX, 1800); }
    catch (e) { want = false; }
    paint();
  }
  function stop() { want = false; if (!bgm.paused) ramp(0, 600); paint(); }
  function toggle() { want ? stop() : start(); remember(); }
  function duck(on) { ducked = on; if (want) ramp(on ? .08 : MAX, 700); }

  if (btn) btn.addEventListener('click', toggle);
  document.addEventListener('visibilitychange', () => {
    if (!bgm || !want) return;
    if (document.hidden) bgm.pause(); else bgm.play().catch(() => {});
  });

  return { availability, start, stop, toggle, duck, get playing() { return want; }, get ready() { return state === 'ok'; } };
})();

/* ================================================================ LOADER */
const Loader = (() => {
  const el = $('#loader');
  if (!el) { body.classList.remove('is-loading'); body.classList.add('is-ready'); root.classList.remove('lock'); return { entered: Promise.resolve() }; }

  const ticksBox = $('#ld-ticks'), arc = $('#ld-arc'), pct = $('#ld-pct'), status = $('#ld-status'), gate = $('#ld-gate');
  const N = 60, ticks = [];
  for (let i = 0; i < N; i++) {
    const t = document.createElement('i');
    t.style.setProperty('--a', (i * 360 / N) + 'deg');
    t.style.setProperty('--d', (Math.random() * 1.2).toFixed(2) + 's');
    ticksBox.appendChild(t); ticks.push(t);
  }
  const C = 2 * Math.PI * 88;
  arc.style.strokeDasharray = C;
  arc.style.strokeDashoffset = C;

  const msgs = [[0, 'Encendiendo la cabina'], [28, 'Afinando micrófonos'], [56, 'Probando bocinas'], [84, 'Al aire']];
  let shown = 0, target = 0, ready = false, finished = false, lastOn = -1;

  const heroImg = $('.hero-media img');
  Promise.all([
    document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve(),
    heroImg && heroImg.decode ? heroImg.decode().catch(() => {}) : Promise.resolve(),
    wait(reduce ? 400 : 2700)
  ]).then(() => { ready = true; });
  setTimeout(() => { ready = true; }, 8000); // red de seguridad

  let enter;
  const entered = new Promise(r => { enter = r; });

  function paint() {
    pct.textContent = String(Math.round(shown)).padStart(3, '0');
    arc.style.strokeDashoffset = C * (1 - shown / 100);
    const on = Math.floor(shown / 100 * N);
    if (on !== lastOn) { ticks.forEach((t, i) => t.classList.toggle('on', i < on)); lastOn = on; }
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (shown >= msgs[i][0]) { if (status.textContent !== msgs[i][1]) status.textContent = msgs[i][1]; break; }
    }
  }

  function loop() {
    target = ready ? 100 : Math.min(92, target + (92 - target) * .02 + .12);
    shown += (target - shown) * (ready ? .12 : .06);
    if (ready && shown > 99.5) shown = 100;
    paint();
    if (shown >= 100 && !finished) { finished = true; finish(); return; }
    requestAnimationFrame(loop);
  }

  function exit(withSound) {
    if (withSound) Sound.start();
    el.classList.add('is-out');
    body.classList.remove('is-loading');
    body.classList.add('is-ready');
    root.classList.remove('lock');
    el.setAttribute('aria-hidden', 'true');
    setTimeout(() => el.remove(), 1500);
    enter();
  }

  async function finish() {
    const hasAudio = await Sound.availability(900);
    if (!hasAudio) { await wait(450); exit(false); return; }
    gate.hidden = false;
    el.classList.add('is-gate');
    const yes = $('#ld-sound');
    yes.focus({ preventScroll: true });
    yes.addEventListener('click', () => exit(true), { once: true });
    $('#ld-mute').addEventListener('click', () => exit(false), { once: true });
  }

  requestAnimationFrame(loop);
  return { entered };
})();

/* ================================================== POLVO DE HADAS (cursor) */
const Dust = (() => {
  const cv = $('#dust');
  if (!cv) return { tick() {}, measure() {} };
  const ctx = cv.getContext('2d');
  const lightEls = $$('.light');
  const parts = [];
  const MAX = 260;
  let W = 0, H = 0, dpr = 1, cleared = true;
  let lx = -1, ly = -1;

  function measure() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const isLight = y => lightEls.some(el => { const r = el.getBoundingClientRect(); return y >= r.top && y <= r.bottom; });

  function spawn(x, y, ivx, ivy, light, burst) {
    if (parts.length > MAX) parts.shift();
    const star = Math.random() < .26;
    const a = Math.random() * Math.PI * 2, sp = burst ? rand(.8, 3.2) : 0;
    parts.push({
      x: x + rand(-4, 4), y: y + rand(-4, 4),
      vx: ivx * .22 + rand(-.55, .55) + Math.cos(a) * sp,
      vy: ivy * .22 + rand(-.9, .25) + Math.sin(a) * sp,
      g: rand(.012, .034),
      size: star ? rand(10, 22) : rand(6, 16),
      life: 0, max: rand(50, 105),
      tw: rand(0, 6.28), rot: rand(0, 3.14), vr: rand(-.05, .05),
      star, c: (Math.random() * 4) | 0, light
    });
  }

  function move(x, y) {
    if (reduce) return;
    if (lx < 0) { lx = x; ly = y; return; }
    const dx = x - lx, dy = y - ly, d = Math.hypot(dx, dy);
    if (d < 2) return;
    const n = clamp(Math.round(d / 10), 1, 7);
    const light = isLight(y);
    for (let i = 1; i <= n; i++) { const t = i / n; spawn(lx + dx * t, ly + dy * t, dx, dy, light, false); }
    lx = x; ly = y;
  }

  function burst(x, y) {
    if (reduce) return;
    const light = isLight(y);
    for (let i = 0; i < 24; i++) spawn(x, y, 0, 0, light, true);
  }

  function drawPass(light, k) {
    ctx.globalCompositeOperation = light ? 'source-over' : 'lighter';
    const set = light ? SPR.light : SPR.dark;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.light !== light) continue;
      const t = p.life / p.max;
      const a = Math.pow(1 - t, 1.3) * (.7 + .3 * Math.sin(p.tw + p.life * .5));
      if (a <= .01) continue;
      const s = p.size * (1 - t * .45);
      ctx.globalAlpha = a;
      if (p.star) {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.drawImage(set.star[p.c], -s / 2, -s / 2, s, s);
        ctx.restore();
      } else {
        ctx.drawImage(set.glow[p.c], p.x - s / 2, p.y - s / 2, s, s);
      }
    }
  }

  function tick(st) {
    if (!parts.length) { if (!cleared) { ctx.clearRect(0, 0, W, H); cleared = true; } return; }
    cleared = false;
    const k = Math.min(3, st.dt / 16.67);
    ctx.clearRect(0, 0, W, H);
    drawPass(false, k);
    drawPass(true, k);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += k; p.vx *= .988; p.vy += p.g * k;
      p.x += p.vx * k; p.y += p.vy * k; p.rot += p.vr * k;
      if (p.life >= p.max) parts.splice(i, 1);
    }
  }

  window.addEventListener('pointermove', e => { if (e.pointerType !== 'touch') move(e.clientX, e.clientY); }, { passive: true });
  window.addEventListener('touchstart', e => { const t = e.touches[0]; if (t) { lx = t.clientX; ly = t.clientY; } }, { passive: true });
  window.addEventListener('touchmove', e => { const t = e.touches[0]; if (t) move(t.clientX, t.clientY); }, { passive: true });
  window.addEventListener('pointerdown', e => burst(e.clientX, e.clientY), { passive: true });
  document.documentElement.addEventListener('mouseleave', () => { lx = -1; });

  return { tick, measure };
})();

/* ===================================================== HERO (polvo + onda) */
const Hero = (() => {
  const hero = $('#inicio');
  if (!hero) return { tick() {}, measure() {} };
  const media = $('#hero-media'), copy = $('#hero-copy');
  const dc = $('#hero-dust'), wc = $('#hero-wave');
  const dctx = dc.getContext('2d'), wctx = wc.getContext('2d');
  let heroH = 1, dpr = 1, dw = 0, dh = 0, ww = 0, wh = 0;
  let motes = [];
  const mouse = { x: .5, y: .5, tx: .5, ty: .5, px: -999, py: -999 };
  let energy = .4, swell = 0;

  function measure() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    heroH = hero.offsetHeight || 1;
    dw = hero.clientWidth; dh = hero.clientHeight;
    dc.width = Math.round(dw * dpr); dc.height = Math.round(dh * dpr);
    dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ww = wc.clientWidth; wh = wc.clientHeight;
    wc.width = Math.round(ww * dpr); wc.height = Math.round(wh * dpr);
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = dw >= 900 ? 64 : 30;
    motes = Array.from({ length: n }, () => ({
      x: rand(0, dw), y: rand(0, dh), z: rand(.25, 1), r: rand(7, 22),
      vy: rand(.1, .36), sw: rand(0, 6.28), sv: rand(.25, .8), tw: rand(0, 6.28), c: (Math.random() * 4) | 0
    }));
  }

  window.addEventListener('pointermove', e => {
    mouse.tx = e.clientX / innerWidth; mouse.ty = e.clientY / innerHeight;
    mouse.px = e.clientX; mouse.py = e.clientY;
  }, { passive: true });

  const layers = [
    { amp: 1,   f: .0062, sp: .9,  a: .9,  w: 1.7, ph: 0 },
    { amp: .66, f: .0108, sp: -.6, a: .5,  w: 1.2, ph: 2 },
    { amp: .4,  f: .0185, sp: 1.3, a: .34, w: 1,   ph: 4 }
  ];

  function drawWave(t) {
    wctx.clearRect(0, 0, ww, wh);
    energy += ((Sound.playing ? 1 : .42) - energy) * .04;
    const r = wc.getBoundingClientRect();
    const mid = wh * .6;
    const near = 1 - clamp(Math.abs(mouse.py - (r.top + mid)) / 280);
    swell += (near - swell) * .08;
    for (let li = 0; li < layers.length; li++) {
      const L = layers[li];
      wctx.beginPath();
      for (let x = 0; x <= ww; x += 4) {
        const env = Math.sin(Math.PI * (x / ww));
        const s = Math.sin(x * L.f + t * L.sp + L.ph) + .5 * Math.sin(x * L.f * 2.3 - t * L.sp * 1.4 + L.ph * 2) + .25 * Math.sin(x * L.f * 4.1 + t * L.sp * 2.1);
        const bump = Math.exp(-Math.pow((x - mouse.px) / (ww * .09), 2)) * 30 * swell * L.amp;
        const y = mid + (s * 18 * L.amp * (.55 + energy) + bump * (s < 0 ? -1 : 1)) * env;
        if (x === 0) wctx.moveTo(x, y); else wctx.lineTo(x, y);
      }
      const g = wctx.createLinearGradient(0, 0, ww, 0);
      g.addColorStop(0, 'rgba(230,205,130,0)');
      g.addColorStop(.25, `rgba(230,205,130,${L.a})`);
      g.addColorStop(.6, `rgba(255,240,190,${L.a})`);
      g.addColorStop(1, 'rgba(230,205,130,0)');
      wctx.strokeStyle = g; wctx.lineWidth = L.w; wctx.stroke();
    }
  }

  function drawMotes(st) {
    dctx.clearRect(0, 0, dw, dh);
    dctx.globalCompositeOperation = 'lighter';
    const k = Math.min(3, st.dt / 16.67);
    mouse.x += (mouse.tx - mouse.x) * .06; mouse.y += (mouse.ty - mouse.y) * .06;
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i];
      m.y -= m.vy * m.z * k; m.sw += m.sv * .01 * k;
      m.x += Math.sin(m.sw) * .18 * k;
      if (m.y < -30) { m.y = dh + 30; m.x = rand(0, dw); }
      const a = (.22 + .5 * m.z) * (.6 + .4 * Math.sin(m.tw + st.t * 1.3));
      dctx.globalAlpha = a;
      const px = m.x + (mouse.x - .5) * m.z * -28, py = m.y + (mouse.y - .5) * m.z * -18;
      const s = m.r * m.z * 1.6;
      dctx.drawImage(SPR.dark.glow[m.c], px - s / 2, py - s / 2, s, s);
    }
    dctx.globalAlpha = 1; dctx.globalCompositeOperation = 'source-over';
  }

  function tick(st) {
    if (st.sy > heroH * 1.15) return;
    const p = clamp(st.sy / heroH);
    if (!reduce) {
      const mx = (mouse.x - .5), my = (mouse.y - .5);
      media.style.transform = `translate3d(${(mx * -22).toFixed(1)}px,${(p * st.vh * .16 + my * -14).toFixed(1)}px,0) scale(${(1 + p * .1).toFixed(4)})`;
      media.style.opacity = (1 - p * .75).toFixed(3);
      copy.style.transform = `translate3d(0,${(-p * st.vh * .09).toFixed(1)}px,0)`;
      copy.style.opacity = (1 - clamp(p * 1.5)).toFixed(3);
      drawMotes(st);
    }
    drawWave(reduce ? 1 : st.t);
  }
  return { tick, measure };
})();

/* ============================================ BANDA DORADA (único marquee) */
const Band = (() => {
  const track = $('#band-track');
  const band = track && track.parentElement;
  if (!track) return { tick() {}, measure() {} };
  const base = track.innerHTML;
  const perSet = track.children.length;
  let loop = 1, x = 0, skew = 0;

  function measure() {
    track.innerHTML = base;
    const first = track.children[0].offsetLeft;
    const need = Math.ceil((window.innerWidth * 1.3) / track.scrollWidth) + 2;
    track.innerHTML = base.repeat(need);
    loop = track.children[perSet].offsetLeft - first || 1;
  }

  function tick(st) {
    if (reduce) return;
    const speed = (70 + Math.min(Math.abs(st.vy), 90) * 38) * st.dir;
    x -= speed * st.dt / 1000;
    if (x <= -loop) x += loop;
    if (x > 0) x -= loop;
    track.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
    skew += (clamp(-st.vy * .1, -5, 5) - skew) * .12;
    band.style.transform = `rotate(-1.6deg) skewX(${skew.toFixed(2)}deg)`;
  }
  return { tick, measure };
})();

/* ======================================== MANIFIESTO (palabras con scroll) */
const Scrub = (() => {
  const el = $('#scrub');
  if (!el) return { tick() {}, measure() {} };
  const words = splitScrub(el);
  const cache = new Array(words.length).fill(-1);
  let top = 0, h = 1;
  function measure() { top = docTop(el); h = el.offsetHeight; }
  function tick(st) {
    if (reduce) return;
    const start = top - st.vh * .85, end = top + h - st.vh * .4;
    const p = clamp((st.sy - start) / (end - start));
    const n = words.length;
    for (let i = 0; i < n; i++) {
      const o = +(.2 + .8 * clamp((p * (n + 5) - i) / 5)).toFixed(2);
      if (o !== cache[i]) { words[i].style.opacity = o; cache[i] = o; }
    }
  }
  return { tick, measure };
})();

/* ================================== LOS 200 FOCOS (escenario fijo + canvas) */
const Focos = (() => {
  const sec = $('#focos');
  if (!sec) return { tick() {}, measure() {} };
  const cv = $('#bulbs'), ctx = cv.getContext('2d');
  const panels = $$('.fp', sec);
  const cta = $('.fp-cta', sec);
  const BULB_RGB = [[255, 236, 170], [255, 247, 214], [244, 200, 100]];
  const sprites = BULB_RGB.map(c => makeSprite(c, false, false));
  let top = 0, h = 1, W = 0, H = 0, dpr = 1, cols = 20, rows = 10, rb = 6, cw = 1, heroR = 100, heroIdx = 0;
  let bulbs = [];
  let ctaOn = null;

  function measure() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    top = docTop(sec); h = sec.offsetHeight;
    const wide = W >= 768;
    cols = wide ? 20 : 10; rows = wide ? 10 : 20;
    const padX = W * .04, padY = H * .07;
    cw = (W - padX * 2) / cols;
    const ch = (H - padY * 2) / rows;
    bulbs = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      bulbs.push({ x: padX + (c + .5) * cw, y: padY + (r + .5) * ch + ch * .12, b: .1, k: (r * 7 + c) % 3 });
    }
    rb = Math.min(cw, ch) * .24;
    heroR = Math.min(W, H) * (W >= 768 ? .16 : .2);
    const tx = wide ? .74 : .5, ty = wide ? .46 : .25;
    heroIdx = Math.round(ty * rows - .5) * cols + Math.round(tx * cols - .5);
  }

  function draw(p, t) {
    ctx.clearRect(0, 0, W, H);
    const m1 = 1 - smooth(.3, .4, p);          // peso del patrón "se turnan"
    const m3 = smooth(.6, .74, p);             // peso del foco único
    const grow = smooth(.62, .95, p);
    const wireY = b => b.y - rb * 1.9;
    const sag = cw * .14;

    // Cable de la serie de luces: cuelga entre foco y foco y se desvanece al final
    ctx.globalAlpha = .22 * (1 - m3);
    ctx.strokeStyle = 'rgb(240,238,232)'; ctx.lineWidth = 1;
    for (let r = 0; r < rows; r++) {
      ctx.beginPath();
      for (let c = 0; c < cols; c++) {
        const b = bulbs[r * cols + c];
        if (c === 0) ctx.moveTo(b.x - cw * .5, wireY(b));
        const nx = c === cols - 1 ? b.x + cw * .5 : (b.x + bulbs[r * cols + c + 1].x) / 2;
        ctx.quadraticCurveTo(b.x, wireY(b) + sag * 2, nx, wireY(b));
      }
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < bulbs.length; i++) {
      const b = bulbs[i];
      const r = (i / cols) | 0, c = i % cols;
      const chase = ((c + r * 3 + Math.floor(t * 2.6)) % 5) === 0 ? 1 : .08;
      const sd = Math.sin(i * 12.9898 + Math.floor(t * 3.2) * 78.233) * 43758.5453;
      const chaos = (sd - Math.floor(sd)) < .13 ? 1 : .05;
      let tb = lerp(chaos, chase, m1);
      tb = lerp(tb, i === heroIdx ? 1 : .035, m3);
      b.b += (tb - b.b) * .16;
      if (i === heroIdx && m3 > .02) continue;           // el foco final se dibuja aparte
      const [R, G, B] = BULB_RGB[b.k];
      const a = Math.min(1, b.b);

      // portalámparas
      ctx.globalAlpha = .35 * (1 - m3 * .8);
      ctx.fillStyle = 'rgb(240,238,232)';
      ctx.fillRect(b.x - 1.5, wireY(b) + sag * .9, 3, rb * .9);

      // resplandor + vidrio + núcleo
      if (a > .03) { ctx.globalAlpha = a * .8; ctx.drawImage(sprites[b.k], b.x - rb * 2.6, b.y - rb * 2.6, rb * 5.2, rb * 5.2); }
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgba(${R},${G},${B},${.1 + .7 * a})`;
      ctx.beginPath(); ctx.arc(b.x, b.y, rb * .7, 0, 6.2832); ctx.fill();
      if (a > .05) {
        ctx.fillStyle = `rgba(255,252,238,${a})`;
        ctx.beginPath(); ctx.arc(b.x, b.y, rb * .3, 0, 6.2832); ctx.fill();
      }
    }

    // El foco que no se apaga: vidrio dorado definido con halo
    const hb = bulbs[heroIdx];
    if (m3 > .02) {
      const R = lerp(rb * .7, heroR, easeInOut(grow));
      ctx.globalAlpha = .55 * m3;
      ctx.drawImage(sprites[0], hb.x - R * 3.4, hb.y - R * 3.4, R * 6.8, R * 6.8);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      const g = ctx.createRadialGradient(hb.x - R * .3, hb.y - R * .35, R * .05, hb.x, hb.y, R);
      g.addColorStop(0, 'rgba(255,252,236,1)');
      g.addColorStop(.42, 'rgba(244,228,160,1)');
      g.addColorStop(.82, 'rgba(214,176,84,1)');
      g.addColorStop(1, 'rgba(154,122,44,1)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(hb.x, hb.y, R, 0, 6.2832); ctx.fill();
      ctx.lineWidth = Math.max(1, R * .02);
      ctx.strokeStyle = 'rgba(255,246,210,.7)';
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function tick(st) {
    const rect = sec.getBoundingClientRect();
    if (rect.bottom < -50 || rect.top > st.vh + 50) return;
    const pinned = !reduce;
    const p = pinned ? clamp((st.sy - top) / Math.max(1, h - st.vh)) : .9;

    if (pinned) {
      const a0 = 1 - smooth(.26, .34, p);
      const a1 = smooth(.3, .38, p) * (1 - smooth(.58, .66, p));
      const in2 = smooth(.62, .7, p);
      const al = [a0, a1, in2];
      const ty = [
        smooth(.26, .34, p) * -34,
        (1 - smooth(.3, .38, p)) * 34 + smooth(.58, .66, p) * -34,
        (1 - in2) * 34
      ];
      panels.forEach((el, i) => {
        el.style.opacity = al[i].toFixed(3);
        el.style.transform = `translate3d(0,${ty[i].toFixed(1)}px,0)`;
      });
      const on = in2 > .5;
      if (on !== ctaOn && cta) { cta.tabIndex = on ? 0 : -1; ctaOn = on; }
    }
    draw(p, reduce ? 0 : st.t);
  }
  return { tick, measure };
})();

/* =================================== SERVICIOS (tarjetas apiladas con scroll) */
const Stack = (() => {
  const wrap = $('#stack');
  if (!wrap) return { tick() {}, measure() {} };
  const cards = $$('.svc', wrap);
  const inners = cards.map(c => c.firstElementChild);
  const cache = new Array(cards.length).fill(-1);
  let top = 0, ch = 1, on = false;
  function measure() {
    on = innerWidth >= 900 && !reduce;
    if (!on) { inners.forEach(i => i.style.setProperty('--p', 0)); cache.fill(-1); return; }
    top = docTop(wrap); ch = cards[0].offsetHeight || 1;
  }
  function tick(st) {
    if (!on) return;
    for (let i = 0; i < cards.length - 1; i++) {
      const rel = top + (i + 1) * ch - st.sy;
      const p = +clamp(1 - rel / st.vh).toFixed(3);
      if (p !== cache[i]) { inners[i].style.setProperty('--p', p); cache[i] = p; }
    }
  }
  return { tick, measure };
})();

/* ============================== LA CALLE (la imagen se abre a pantalla completa) */
const Expand = (() => {
  const sec = $('#calle');
  if (!sec) return { tick() {}, measure() {} };
  const frame = $('#ex-frame'), img = $('img', frame), p2 = $('#ex-p'), cta = $('#ex-cta');
  let top = 0, h = 1;
  function measure() { top = docTop(sec); h = sec.offsetHeight; }
  function tick(st) {
    if (reduce) return;
    const rect = sec.getBoundingClientRect();
    if (rect.bottom < -50 || rect.top > st.vh + 50) return;
    const p = clamp((st.sy - top) / Math.max(1, h - st.vh));
    const e = easeInOut(clamp(p / .58));
    const wide = st.vw >= 900;
    frame.style.clipPath = `inset(${lerp(wide ? 18 : 22, 0, e).toFixed(2)}% ${lerp(wide ? 28 : 7, 0, e).toFixed(2)}% round ${lerp(26, 0, e).toFixed(1)}px)`;
    img.style.transform = `scale(${lerp(1.25, 1, e).toFixed(4)})`;
    const a = smooth(.56, .78, p), b = smooth(.62, .84, p);
    p2.style.opacity = a.toFixed(3); p2.style.transform = `translate3d(0,${((1 - a) * 26).toFixed(1)}px,0)`;
    cta.style.opacity = b.toFixed(3); cta.style.transform = `translate3d(0,${((1 - b) * 26).toFixed(1)}px,0)`;
    cta.style.pointerEvents = b > .5 ? 'auto' : 'none';
  }
  return { tick, measure };
})();

/* ================================= CASOS (scroll vertical mueve la galería) */
const HPan = (() => {
  const sec = $('#casos');
  if (!sec) return { tick() {}, measure() {} };
  const track = $('#hp-track'), bar = $('#hp-bar');
  let top = 0, dist = 0;
  function measure() {
    if (reduce) { sec.style.height = ''; track.style.transform = ''; return; }
    track.style.transform = 'none';
    dist = Math.max(0, track.scrollWidth - innerWidth);
    sec.style.height = (dist + innerHeight) + 'px';
    top = docTop(sec);
  }
  function tick(st) {
    if (reduce) return;
    const rect = sec.getBoundingClientRect();
    if (rect.bottom < -50 || rect.top > st.vh + 50) return;
    const p = clamp((st.sy - top) / Math.max(1, dist));
    track.style.transform = `translate3d(${(-p * dist).toFixed(1)}px,0,0)`;
    bar.style.transform = `scaleX(${p.toFixed(4)})`;
  }
  return { tick, measure };
})();

/* ===================================================== PIE (entrada suave) */
const Foot = (() => {
  const foot = $('#footer'), logo = $('.foot-logo');
  if (!foot) return { tick() {}, measure() {} };
  let top = 0;
  function measure() { top = docTop(foot); }
  function tick(st) {
    if (reduce) return;
    const t = clamp((st.sy + st.vh - top) / (st.vh * .9));
    logo.style.transform = `translate3d(0,${((1 - t) * 50).toFixed(1)}px,0)`;
    logo.style.opacity = (.25 + .75 * t).toFixed(3);
  }
  return { tick, measure };
})();

/* ============================================ PROGRESO + NAVEGACIÓN */
const Nav = (() => {
  const nav = $('#nav'), bar = $('#progress');
  let docH = 1, solid = false, hidden = false;
  function measure() { docH = Math.max(1, document.documentElement.scrollHeight - innerHeight); }
  function tick(st) {
    bar.style.transform = `scaleX(${clamp(st.y / docH).toFixed(4)})`;
    const s = st.y > 40;
    if (s !== solid) { nav.classList.toggle('is-solid', s); solid = s; }
    let hd = hidden;
    if (st.vy > 3 && st.y > 520) hd = true; else if (st.vy < -3 || st.y < 200) hd = false;
    if (body.classList.contains('menu-open')) hd = false;
    if (hd !== hidden) { nav.classList.toggle('is-hidden', hd); hidden = hd; }
  }
  return { tick, measure };
})();

/* ================================================== BUCLE PRINCIPAL */
const modules = [HPan, Hero, Band, Scrub, Focos, Stack, Expand, Foot, Nav, Dust];
function measureAll() {
  S.vh = innerHeight; S.vw = innerWidth;
  modules.forEach(m => m.measure && m.measure());
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(64, now - last); last = now;
  S.t = now / 1000; S.dt = dt;
  const y = window.scrollY;
  S.vy = y - S.y;
  if (S.vy) S.dir = S.vy > 0 ? 1 : -1;
  S.y = y;
  const k = reduce ? 1 : 1 - Math.pow(1 - .085, dt / 16.67);
  S.sy += (y - S.sy) * k;
  if (Math.abs(y - S.sy) < .05) S.sy = y;
  for (let i = 0; i < modules.length; i++) modules[i].tick(S);
  requestAnimationFrame(frame);
}

/* =============================================== OBSERVADORES (reveal, spy, contadores) */
function setupObservers() {
  const revealIO = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target;
      el.classList.add('in');
      revealIO.unobserve(el);
      if (el.hasAttribute('data-reveal')) {
        el.addEventListener('transitionend', function done(ev) {
          if (ev.target !== el || ev.propertyName !== 'opacity') return;
          el.removeAttribute('data-reveal');
          el.removeEventListener('transitionend', done);
        });
      }
    });
  }, { threshold: .12, rootMargin: '0px 0px -6% 0px' });
  $$('[data-reveal]').forEach(el => revealIO.observe(el));
  $$('[data-split]').forEach(el => { if (!el.classList.contains('h-hero')) revealIO.observe(el); });

  // Contadores
  const countIO = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      countIO.unobserve(e.target);
      const span = $('[data-count]', e.target);
      if (!span) return;
      const to = parseFloat(span.dataset.count || span.textContent) || 0;
      if (reduce) { span.textContent = to.toLocaleString('es-MX'); return; }
      const t0 = performance.now(), dur = 1900;
      const step = now => {
        const k = clamp((now - t0) / dur), v = Math.round(to * (1 - Math.pow(1 - k, 4)));
        span.textContent = v.toLocaleString('es-MX');
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, { threshold: .5 });
  $$('.stat').forEach(el => countIO.observe(el));

  // Enlace activo en la navegación
  const links = $$('[data-spy]');
  const spyIO = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      links.forEach(a => a.removeAttribute('aria-current'));
      links.filter(a => a.dataset.spy === e.target.id).forEach(a => a.setAttribute('aria-current', 'true'));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  ['nosotros', 'servicios', 'casos', 'cobertura', 'clientes', 'contacto'].forEach(id => { const s = document.getElementById(id); if (s) spyIO.observe(s); });
}

/* ======================================= EFECTOS DE PUNTERO (spot, tilt, imán) */
function setupPointerFx() {
  if (!finePointer || reduce) return;
  document.addEventListener('pointermove', e => {
    const t = e.target;
    if (!t.closest) return;
    const spot = t.closest('.spot');
    if (spot) {
      const r = spot.getBoundingClientRect();
      spot.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      spot.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }
    const tilt = t.closest('.tilt');
    if (tilt) {
      const r = tilt.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      tilt.style.setProperty('--ry', ((px - .5) * 9).toFixed(2) + 'deg');
      tilt.style.setProperty('--rx', ((.5 - py) * 7).toFixed(2) + 'deg');
      tilt.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
      tilt.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
    }
    const mag = t.closest('.magnetic');
    if (mag) {
      const r = mag.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      mag.style.transform = `translate(${(dx * .2).toFixed(1)}px,${(dy * .28).toFixed(1)}px)`;
    }
  }, { passive: true });

  document.addEventListener('pointerout', e => {
    const t = e.target;
    if (!t.closest) return;
    const tilt = t.closest('.tilt');
    if (tilt && !tilt.contains(e.relatedTarget)) { tilt.style.setProperty('--rx', '0deg'); tilt.style.setProperty('--ry', '0deg'); }
    const mag = t.closest('.magnetic');
    if (mag && !mag.contains(e.relatedTarget)) mag.style.transform = '';
  }, { passive: true });
}

/* ===================================================== MENÚ MÓVIL */
function setupMenu() {
  const burger = $('#burger'), menu = $('#menu');
  if (!burger || !menu) return;
  menu.inert = true;
  const set = open => {
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    menu.classList.toggle('open', open);
    menu.setAttribute('aria-hidden', String(!open));
    menu.inert = !open;
    body.classList.toggle('menu-open', open);
    root.classList.toggle('lock', open);
  };
  burger.addEventListener('click', () => set(burger.getAttribute('aria-expanded') !== 'true'));
  $$('a', menu).forEach(a => a.addEventListener('click', () => set(false)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
  window.addEventListener('resize', () => { if (innerWidth >= 1100) set(false); });
}

/* ===================================================== SPOT (reproductor opcional) */
function setupSpotPlayer() {
  const audio = $('#spot-audio'), wrap = $('#spot-player');
  if (!audio || !wrap) return;
  const btn = $('#spot-btn'), range = $('#spot-range'), time = $('#spot-time');
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  audio.addEventListener('loadedmetadata', () => { wrap.hidden = false; });
  audio.addEventListener('timeupdate', () => {
    if (audio.duration) range.value = (audio.currentTime / audio.duration) * 100;
    time.textContent = fmt(audio.currentTime);
  });
  audio.addEventListener('ended', () => { btn.setAttribute('aria-pressed', 'false'); Sound.duck(false); });
  btn.addEventListener('click', () => {
    if (audio.paused) { audio.play(); btn.setAttribute('aria-pressed', 'true'); Sound.duck(true); }
    else { audio.pause(); btn.setAttribute('aria-pressed', 'false'); Sound.duck(false); }
  });
  range.addEventListener('input', () => { if (audio.duration) audio.currentTime = (range.value / 100) * audio.duration; });
  audio.load();
}

/* ===================================================== FORMULARIO -> WHATSAPP */
function setupForm() {
  const form = $('#form');
  if (!form) return;
  const note = $('#form-note');
  const fields = {
    nombre: { input: $('#f-nombre'), err: $('#e-nombre') },
    tel: { input: $('#f-tel'), err: $('#e-tel') }
  };
  const setErr = (f, msg) => {
    f.err.textContent = msg;
    f.input.closest('.field').classList.toggle('has-err', !!msg);
    f.input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  };
  Object.values(fields).forEach(f => f.input.addEventListener('input', () => setErr(f, '')));

  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = fields.nombre.input.value.trim();
    const tel = fields.tel.input.value.trim();
    const digits = tel.replace(/\D/g, '');
    let bad = null;
    if (name.length < 2) { setErr(fields.nombre, 'Escribe tu nombre para saber con quién hablamos.'); bad = bad || fields.nombre.input; } else setErr(fields.nombre, '');
    if (digits.length < 10) { setErr(fields.tel, 'Escribe un teléfono de 10 dígitos para poder responderte.'); bad = bad || fields.tel.input; } else setErr(fields.tel, '');
    if (bad) { bad.focus(); note.textContent = ''; return; }

    const services = $$('input[name="servicio"]:checked', form).map(i => i.value);
    const msg = $('#f-msg').value.trim();
    const text = [
      `Hola, La Nueva Era. Soy ${name}.`,
      `Mi teléfono es ${tel}.`,
      services.length ? `Me interesa: ${services.join(', ')}.` : '',
      msg ? `Detalles: ${msg}` : '',
      '¿Me ayudan con una cotización?'
    ].filter(Boolean).join(' ');
    const url = waLink(text);
    window.open(url, '_blank', 'noopener');
    note.innerHTML = '';
    note.append('Listo, se abrió WhatsApp con tu mensaje. Si no se abrió, ');
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'toca aquí';
    note.append(a, '.');
  });
}

/* ===================================================== VARIOS */
function setupMisc() {
  // Años de experiencia siempre al día
  const years = new Date().getFullYear() - FOUNDED;
  $$('[data-years]').forEach(el => { el.textContent = years; });
  const y = $('#year'); if (y) y.textContent = new Date().getFullYear();

  // Enlaces a WhatsApp con mensaje prellenado
  $$('[data-wa]').forEach(a => { a.href = waLink(a.dataset.wa); });

  // Ver más marcas
  const more = $('#wall-more'), extra = $('#wall-extra');
  if (more && extra) {
    $$('.tile', extra).forEach((t, i) => t.style.setProperty('--i', i));
    more.addEventListener('click', () => {
      const open = extra.hidden;
      extra.hidden = !open;
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? 'Ver menos' : 'Ver más marcas';
      if (open) measureAll();
    });
  }

  const top = $('#to-top');
  if (top) top.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }));
}

/* ===================================================== ARRANQUE */
setupMisc();
$$('[data-split]').forEach(splitWords);
setupObservers();
setupPointerFx();
setupMenu();
setupSpotPlayer();
setupForm();
measureAll();
requestAnimationFrame(frame);

let rzT = 0;
window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(measureAll, 140); });
window.addEventListener('load', measureAll);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureAll);

Loader.entered.then(() => {
  const h1 = $('.h-hero');
  if (h1) h1.classList.add('in');
  setTimeout(measureAll, 200);
});
})();
