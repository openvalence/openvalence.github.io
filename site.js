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

  // The Components menu (the header in tools/chrome.html). Mouse: hover opens, leaving closes after
  // a grace, a click on Components navigates. Touch: the first tap opens, the second navigates.
  // Keyboard: the arrow button toggles it, Escape closes it and returns focus to the button, and
  // tabbing out closes it. A click outside closes it.
  // Constraints: the Kinetic playground's site-nav.js is a copy; change both.
  for (const m of document.querySelectorAll('.menu')) {
    const btn = m.querySelector('.menu-btn'), link = m.querySelector('.chip');
    let timer = 0, touch = false, hover = false;
    const set = (on, byHover = false) => { clearTimeout(timer); hover = on && byHover; m.classList.toggle('open', on); btn.setAttribute('aria-expanded', String(on)); };
    m.classList.add('live');
    m.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') m.classList.contains('open') ? clearTimeout(timer) : set(true, true); });
    m.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') timer = setTimeout(() => set(false), 300); });
    m.addEventListener('focusout', (e) => { if (!m.contains(e.relatedTarget) && !m.matches(':hover')) set(false); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !m.classList.contains('open')) return;
      if (m.querySelector('.menu-panel').contains(document.activeElement)) btn.focus();
      set(false);
    });
    // a click on the arrow of a menu that hover just opened keeps it open
    btn.addEventListener('click', () => set(hover || !m.classList.contains('open')));
    link.addEventListener('pointerdown', (e) => { touch = e.pointerType !== 'mouse'; });
    link.addEventListener('click', (e) => {
      if (touch && !m.classList.contains('open')) { e.preventDefault(); set(true); }
      touch = false;
    });
    document.addEventListener('pointerdown', (e) => { if (!m.contains(e.target)) set(false); });
  }

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

  // Looping clips: play only while on screen. wanted: the stepper's play state, else a toggle.
  function clip(v, wanted) {
    v.removeAttribute('controls');
    wanted = wanted || toggle(v.parentElement, () => v.play().catch(() => {}), () => v.pause());
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting && wanted()) { v.preload = 'auto'; v.play().catch(() => {}); } else v.pause();
    }, { threshold: 0.25 }).observe(v);
  }

  // Step-through for a clip: the figure's <ol class="beats" data-dur data-offset> has one <li
  // data-at data-hold> per beat, in clip seconds (data-offset is the clip time at video 0).
  // Prev / Next hold at a stop: a beat's end state, or the live piece's own stops inside a
  // beat (api.steps). On the live piece (drive.smooth) a step runs the clip to its stop, eased,
  // 0.4 to 1.2 s by distance, Prev backward; reduced motion and the video jump. The scrubber is
  // immediate. The page's markup holds the controls, so nothing shifts when this runs.
  // Constraints: the drive (live piece or video) registers with use(); the stepper owns play.
  function stepper(fig, ol) {
    const dur = +ol.dataset.dur, off = +ol.dataset.offset || 0, items = [...ol.children];
    const starts = items.map((li) => +li.dataset.at), caps = items.map((li) => li.textContent.trim());
    const base = items.map((li, i) => ({ beat: i, at: +li.dataset.hold }));
    const bar = fig.querySelector('.stepbar'), [prev, play, next, range] = bar.querySelectorAll('button, input');
    const tabs = [...fig.querySelectorAll('.steptabs button')], note = fig.querySelector('.stepnote'), say = bar.querySelector('[aria-live]');
    let stops = base, drive = null, playing = !still, touched = false, u = +range.value, cur = -1, anim = 0;
    const host = (x) => (x - off + dur) % dur;
    const beatOf = (x) => starts.reduce((b, s, i) => (x >= s ? i : b), 0);
    // keep: leave the note as it is (a step on its way)
    function show(x, stop, keep) {
      u = x;
      range.value = x.toFixed(2);
      const b = stop ? stop.beat : beatOf(x);
      if (b !== cur) {
        items.forEach((li, i) => li.classList.toggle('on', i === b));
        tabs.forEach((t, i) => (i === b ? t.setAttribute('aria-current', 'step') : t.removeAttribute('aria-current')));
      }
      if (!keep) note.textContent = (stop && stop.note) || '';
      range.setAttribute('aria-valuetext', `Step ${b + 1} of ${items.length}, ${x.toFixed(1)} s`);
      cur = b;
    }
    function setPlay(on) {
      cancelAnimationFrame(anim);
      playing = on;
      play.textContent = on ? 'Pause' : 'Play';
      if (drive) on ? drive.play() : drive.pause();
    }
    // dir: 1 runs forward (through the loop's end if the stop is behind), -1 backward, 0 the short way in the clip
    function hold(stop, dir = 0) {
      const was = cur;
      setPlay(false);
      touched = true;
      say.textContent = (stop.beat !== was ? `Step ${stop.beat + 1} of ${items.length}. ${caps[stop.beat]} ` : '') + (stop.note || '');
      const land = () => { if (drive) drive.seek(host(stop.at), true); show(stop.at, stop); };
      let d = stop.at - u;
      if (dir > 0 && d < 0) d += dur; else if (dir < 0 && d > 0) d -= dur;
      if (!drive || !drive.smooth || still || Math.abs(d) < 0.01) return land();
      const from = u, ms = Math.min(1200, Math.max(400, 300 + Math.abs(d) * 120)), t0 = performance.now();
      const f = (now) => {
        const k = Math.min(1, (now - t0) / ms), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(2 - 2 * k, 3) / 2;
        if (k >= 1) return land();
        const x = (((from + d * e) % dur) + dur) % dur;
        drive.seek(host(x));
        show(x, null, true);
        anim = requestAnimationFrame(f);
      };
      anim = requestAnimationFrame(f);
    }
    const step = (d) => {
      const i = d > 0 ? stops.findIndex((s) => s.at > u + 0.01) : stops.findLastIndex((s) => s.at < u - 0.01);
      hold(stops[i >= 0 ? i : d > 0 ? 0 : stops.length - 1], d);
    };
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    play.addEventListener('click', () => setPlay(!playing));
    tabs.forEach((t, i) => t.addEventListener('click', () => hold(stops.find((s) => s.beat === i))));
    range.addEventListener('input', () => {
      setPlay(false);
      touched = true;
      if (drive) drive.seek(host(+range.value));
      show(+range.value, null);
    });
    fig.tabIndex = 0;
    fig.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight Space');
    fig.addEventListener('keydown', (e) => {
      if (e.target === range || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === ' ' && e.target === fig) setPlay(!playing);
      else return;
      e.preventDefault();
    });
    setPlay(playing);
    return {
      // d: {seek(hostT, held), play(), pause(), smooth}; steps: the live piece's stops
      use(d, steps) {
        drive = d;
        if (steps) stops = items.flatMap((_, i) => { const s = steps.filter((x) => x.beat === i); return s.length ? s : [base[i]]; });
        if (touched && !playing) d.seek(host(u), stops.some((s) => s.at === u));
        return () => playing;
      },
      tick: (t) => { if (playing) show((t + off) % dur, null); },
    };
  }
  // The video drives a stepper figure where the live piece does not run.
  function videoDrive(fig) {
    const S = fig.stepper, all = [...fig.querySelectorAll('video')], shown = () => all.find((v) => v.offsetParent);
    const wanted = S.use({
      seek(x) {
        const v = shown();
        if (!v) return;
        v.pause();
        if (v.readyState) { v.currentTime = x; return; }
        v.addEventListener('loadedmetadata', () => { v.currentTime = x; }, { once: true });
        if (v.preload !== 'auto') { v.preload = 'auto'; v.load(); }
      },
      play() { const v = shown(); if (v) { v.preload = 'auto'; v.play().catch(() => {}); } },
      pause() { all.forEach((v) => v.pause()); },
    });
    for (const v of all) {
      v.addEventListener('timeupdate', () => { if (v.offsetParent) S.tick(v.currentTime); });
      clip(v, wanted);
    }
  }

  // A figure with data-live (the scripts of a motion/ piece) runs the piece live where the
  // device can carry it: sharp at any size, themed by the tokens. The video is the fallback:
  // weak or unknown-lean devices get it from the start, and a live run whose first second
  // drops frames hands over to it at the same loop position. Reduced motion keeps the poster,
  // or, on a stepper figure, a still picture per step.
  // Constraints: one data-live figure per page (a piece's scripts share the page's globals).
  const able = !lean && (navigator.hardwareConcurrency || 0) >= 4 && (navigator.deviceMemory || 4) >= 4;
  for (const ol of document.querySelectorAll('ol.beats[data-dur]')) { const f = ol.closest('figure'); f.stepper = stepper(f, ol); }
  const first = document.querySelector('figure[data-live]');
  const liveFig = able && first && (!still || first.stepper) && first;
  for (const v of document.querySelectorAll('video[data-auto]')) {
    const f = v.closest('figure');
    if (f && f.stepper) { v.removeAttribute('controls'); continue; }
    if (still) continue;
    v.removeAttribute('controls');
    if (!(liveFig && liveFig.contains(v))) clip(v);
  }
  for (const f of document.querySelectorAll('figure')) if (f.stepper && f !== liveFig) videoDrive(f);
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
    if (fig.stepper) videoDrive(fig);
    else for (const v of fig.querySelectorAll('video[data-auto]')) clip(v);
  }
  function live(fig, api) {
    const shown = () => [...fig.querySelectorAll('video')].find((v) => v.offsetParent);
    const box = document.createElement('div');
    box.className = 'live';
    box.innerHTML = '<svg id="scene" viewBox="0 0 1280 720" aria-hidden="true"></svg>';
    const svg = box.firstChild;
    let t = 0, last = 0, raf = 0, ready = false, seen = false, dt = [], video = null, at = -1, onSeeked = null, held = false;
    const build = () => {
      const v = shown();
      if (!v) return Promise.resolve();
      v.after(box);
      svg.replaceChildren();
      return api.start(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark').then(() => api.draw(t, held));
    };
    const frame = (ms) => {
      const d = last ? ms - last : 0;
      last = ms;
      if (d < 250) t = (t + d / 1000) % api.dur;   // longer: the tab was hidden; carry on, no jump
      held = false;
      api.draw(t);
      if (S) S.tick(t);
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
        removeEventListener('themechange', build);
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
    const S = fig.stepper;
    const wanted = S ? S.use({ seek: (x, h) => { t = x; held = !!h; if (ready) api.draw(t, held); }, play: go, pause: stop, smooth: true }, api.steps) : toggle(box, go, stop);
    new IntersectionObserver(([e]) => { seen = e.isIntersecting; seen && wanted() ? go() : stop(); }, { threshold: 0.25 }).observe(box);
    addEventListener('themechange', build);
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

  // Light and dark pictures: a <source media="(prefers-color-scheme: light)"> follows the page's
  // theme (the head script's data-theme), which the toggle can set against the system's.
  const schemed = [...document.querySelectorAll('picture > source[media*="prefers-color-scheme"]')];
  function pictures() {
    const light = document.documentElement.dataset.theme === 'light';
    for (const s of schemed) {
      s.dataset.scheme = s.dataset.scheme || (s.media.includes('light') ? 'light' : 'dark');
      s.media = (s.dataset.scheme === 'light') === light ? 'all' : 'not all';
    }
    if (io) for (const s of schemed) io.observe(s.parentElement.querySelector('img'));
  }
  let io = null;
  pictures();
  addEventListener('themechange', pictures);

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
    if (el.getAttribute(el === img ? 'src' : 'srcset') === url) return;
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
    io = new IntersectionObserver((es) => {
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
