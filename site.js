// Progressive extras. Every page reads fine without this file.
// Respects prefers-reduced-motion: nothing starts moving on its own when it is set.
(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const net = navigator.connection;
  const lean = net && (net.saveData || /2g|3g/.test(net.effectiveType || ''));
  const afterLoad = (f) => {
    const later = () => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 2000 }) : setTimeout(f, 300));
    document.readyState === 'complete' ? later() : addEventListener('load', later, { once: true });
  };

  // Narrow screens scroll the header links sideways: bring the current one into view.
  const nav = document.querySelector('.chips'), here = nav && nav.querySelector('[aria-current]');
  if (here && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = here.offsetLeft - nav.offsetLeft - (nav.clientWidth - here.offsetWidth) / 2;

  // A pause button for anything that moves on its own (WCAG 2.2.2).
  function toggle(host, onPlay, onPause) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vtoggle';
    let playing = true;
    const show = () => { b.textContent = playing ? 'Pause' : 'Play'; b.setAttribute('aria-pressed', String(!playing)); };
    b.addEventListener('click', () => { playing = !playing; playing ? onPlay() : onPause(); show(); });
    show();
    host.appendChild(b);
    return () => playing;
  }

  // Looping clips: play only while on screen.
  function clip(v) {
    v.removeAttribute('controls');
    const wanted = toggle(v.parentElement, () => v.play().catch(() => {}), () => v.pause());
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting && wanted()) { v.preload = 'auto'; v.play().catch(() => {}); } else v.pause();
    }, { threshold: 0.25 }).observe(v);
  }

  // A figure with data-live (the scripts of a motion/ piece) runs the piece live where the
  // device can carry it: sharp at any size, themed by the tokens. The video is the fallback:
  // weak or unknown-lean devices get it from the start, and a live run whose first second
  // drops frames hands over to it at the same loop position. Reduced motion keeps the poster.
  // Constraints: one data-live figure per page (a piece's scripts share the page's globals).
  const able = !still && !lean && (navigator.hardwareConcurrency || 0) >= 4 && (navigator.deviceMemory || 4) >= 4;
  const liveFig = able && document.querySelector('figure[data-live]');
  for (const v of document.querySelectorAll('video[data-auto]')) {
    if (still) continue;
    v.removeAttribute('controls');
    if (!(liveFig && liveFig.contains(v))) clip(v);
  }
  if (liveFig) afterLoad(() => {
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      window.motionHost = (api) => live(liveFig, api);
      for (const src of liveFig.dataset.live.split(' ')) {
        const s = document.createElement('script');
        s.src = src;
        s.async = false;
        s.onerror = () => fallback(liveFig);
        document.head.appendChild(s);
      }
    }, { rootMargin: '400px' });
    io.observe(liveFig);
  });
  function fallback(fig) {
    if (fig.dataset.live === '') return;
    fig.dataset.live = '';
    for (const v of fig.querySelectorAll('video[data-auto]')) clip(v);
  }
  function live(fig, api) {
    const shown = () => [...fig.querySelectorAll('video')].find((v) => v.offsetParent);
    const scheme = matchMedia('(prefers-color-scheme: light)');
    const box = document.createElement('div');
    box.className = 'live';
    box.innerHTML = '<svg id="scene" viewBox="0 0 1280 720" aria-hidden="true"></svg>';
    const svg = box.firstChild;
    let t = 0, last = 0, raf = 0, ready = false, seen = false, dt = [], video = null, at = -1, onSeeked = null;
    const build = () => {
      const v = shown();
      if (!v) return Promise.resolve();
      v.after(box);
      svg.replaceChildren();
      return api.start(scheme.matches ? 'light' : 'dark').then(() => api.draw(t));
    };
    const frame = (ms) => {
      const d = last ? ms - last : 0;
      last = ms;
      if (d < 250) t = (t + d / 1000) % api.dur;   // longer: the tab was hidden; carry on, no jump
      api.draw(t);
      if (dt && d && d < 250 && dt.push(d) > 3 && dt.reduce((a, b) => a + b, 0) >= 1000) {
        const s = dt.slice(3).sort((a, b) => a - b), med = s[s.length >> 1];
        dt = null;
        if (s[Math.floor(s.length * 0.9)] > Math.max(20, 1.5 * med)) handover();   // relative to the display, so 50 and 30 Hz screens keep the live clip
      }
      // the video sits seeked at `at`, under the live picture: start it as the clock passes
      if (at >= 0 && (t - at + api.dur) % api.dur < 0.25) {
        video.removeEventListener('seeked', onSeeked);
        video.play().catch(() => {});
        stop();
        box.remove();
        scheme.removeEventListener('change', build);
        fallback(fig);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    const go = () => { if (ready && !raf) { last = 0; raf = requestAnimationFrame(frame); } };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    function handover() {
      video = shown();
      const seek = () => { at = -1; video.currentTime = (t + 0.5) % api.dur; };
      onSeeked = () => {
        if (((video.currentTime - t + api.dur) % api.dur) > 0.5) seek();   // the clock got there first
        else at = video.currentTime;
      };
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('loadedmetadata', seek, { once: true });
      video.preload = 'auto';
      video.load();
    }
    const wanted = toggle(box, go, stop);
    new IntersectionObserver(([e]) => { seen = e.isIntersecting; seen && wanted() ? go() : stop(); }, { threshold: 0.25 }).observe(box);
    scheme.addEventListener('change', build);
    build().then(() => { ready = true; if (seen && wanted()) go(); }, () => { box.remove(); fallback(fig); });
  }

  // Kinetic figure: knots, then the curve through them, then a playhead riding it.
  for (const svg of document.querySelectorAll('svg[data-knots]')) {
    if (still) continue;
    const K = JSON.parse(svg.dataset.knots);
    const [x0, x1, y0, y1] = JSON.parse(svg.dataset.box);
    const T = K[K.length - 1][0];
    const X = (t) => x0 + (t / T) * (x1 - x0);
    const Y = (p) => y1 - p * (y1 - y0);
    const f = pchip(K);
    const curve = svg.querySelector('.curve'), knots = [...svg.querySelectorAll('.knot')];
    const segs = svg.querySelector('.seg'), head = svg.querySelector('.head');
    const now = svg.querySelector('.now'), car = svg.querySelector('.car');
    const L = curve.getTotalLength();
    curve.style.strokeDasharray = `${L} ${L}`;
    const DOTS = 1.6, DRAW = 1.6, RIDE = T, HOLD = 0.6, LOOP = DOTS + DRAW + RIDE + HOLD;
    let t0 = performance.now(), paused = t0, raf = 0;
    const frame = (ms) => {
      const s = ((ms - t0) / 1000) % LOOP;
      knots.forEach((k, i) => { k.style.opacity = s >= (i / knots.length) * DOTS ? 1 : 0; });
      segs.style.opacity = s < DOTS + DRAW ? Math.min(1, s / DOTS) : 0.35;
      const d = Math.min(1, Math.max(0, (s - DOTS) / DRAW));
      curve.style.strokeDashoffset = String(L * (1 - d));
      const r = s - DOTS - DRAW, on = r >= 0 && r <= RIDE;
      const t = on ? r : (r > RIDE ? T : 0), p = f(t);
      head.style.opacity = now.style.opacity = on ? 1 : 0;
      head.setAttribute('cx', X(t)); head.setAttribute('cy', Y(p));
      now.setAttribute('x1', X(t)); now.setAttribute('x2', X(t));
      car.setAttribute('y', Y(p) - 7);
      raf = requestAnimationFrame(frame);
    };
    const go = () => { if (!raf) { t0 += performance.now() - paused; raf = requestAnimationFrame(frame); } };
    const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; paused = performance.now(); } };
    const wanted = toggle(svg.parentElement, go, stop);
    new IntersectionObserver(([e]) => { e.isIntersecting && wanted() ? go() : stop(); }).observe(svg);
  }

  // Monotone cubic (Fritsch-Carlson): no overshoot between monotone knots.
  function pchip(K) {
    const n = K.length, h = [], d = [], m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) { h[i] = K[i + 1][0] - K[i][0]; d[i] = (K[i + 1][1] - K[i][1]) / h[i]; }
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) continue;
      const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
    return (t) => {
      let i = 0;
      while (i < n - 2 && t > K[i + 1][0]) i++;
      const u = Math.min(1, Math.max(0, (t - K[i][0]) / h[i])), u2 = u * u, u3 = u2 * u;
      return (2 * u3 - 3 * u2 + 1) * K[i][1] + (u3 - 2 * u2 + u) * h[i] * m[i]
        + (-2 * u3 + 3 * u2) * K[i + 1][1] + (u3 - u2) * h[i] * m[i + 1];
    };
  }

  // Click-to-load embeds: nothing heavy loads until asked.
  for (const box of document.querySelectorAll('[data-embed]')) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn go';
    b.textContent = box.dataset.label || 'Load it here';
    b.addEventListener('click', () => {
      const f = document.createElement('iframe');
      f.src = box.dataset.embed;
      f.title = box.dataset.title || '';
      f.loading = 'lazy';
      box.replaceChildren(f);
      f.focus();
    });
    box.appendChild(b);
  }

  // Sharper images after the page has loaded. The light files paint first; an image
  // with data-hi (on the <img>, or on the <source> that matches the color scheme) is
  // swapped for its 2x file once the page is idle and the image is near the screen.
  // Skipped on Save-Data and 2g/3g connections.
  function hiFor(img) {
    const pic = img.parentElement && img.parentElement.tagName === 'PICTURE' ? img.parentElement : null;
    if (pic) for (const s of pic.querySelectorAll('source')) {
      if (!s.media || matchMedia(s.media).matches) return s.dataset.hi ? [s, s.dataset.hi] : null;
    }
    return img.dataset.hi ? [img, img.dataset.hi] : null;
  }
  function upgrade(img) {
    const hit = hiFor(img);
    if (!hit) return;
    const [el, url] = hit;
    const pre = new Image();
    pre.src = url;
    pre.decode().then(() => {
      const swap = () => {
        if (el !== img) el.srcset = url;
        else { img.removeAttribute('srcset'); img.removeAttribute('sizes'); img.src = url; }
      };
      if (still || !img.offsetParent) return swap();
      // Crossfade: the sharp copy fades in over the light one, then takes its place.
      const g = img.cloneNode();
      for (const a of ['srcset', 'sizes', 'loading', 'fetchpriority', 'id']) g.removeAttribute(a);
      g.alt = '';
      g.setAttribute('aria-hidden', 'true');
      g.src = url;
      Object.assign(g.style, { position: 'absolute', left: img.offsetLeft + 'px', top: img.offsetTop + 'px', width: img.offsetWidth + 'px', height: img.offsetHeight + 'px', margin: '0', opacity: '0', transition: 'opacity .35s ease', pointerEvents: 'none' });
      img.after(g);
      requestAnimationFrame(() => requestAnimationFrame(() => { g.style.opacity = '1'; }));
      setTimeout(() => { swap(); img.decode().catch(() => {}).then(() => g.remove()); }, 400);
    }).catch(() => {});
  }
  function sharpen() {
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); upgrade(e.target); }
    }, { rootMargin: '800px' });
    for (const img of document.querySelectorAll('img')) if (hiFor(img)) io.observe(img);
    for (const v of document.querySelectorAll('video[data-hi-poster]')) {
      const p = new Image();
      p.src = v.dataset.hiPoster;
      p.decode().then(() => { v.poster = p.src; }).catch(() => {});
    }
  }
  if (!lean) afterLoad(sharpen);
})();
