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

  // The header mark (tools/chrome.html): /mark-anim.js plays its intro on the home page unless the
  // visitor came from another page of the site (the head script sets html.intro) and turns it on hover. Loaded at load, so it never
  // competes with the first paint; reduced motion: neither.
  const mark = document.querySelector('.brand img');
  const atLoad = (f) => (document.readyState === 'complete' ? f() : addEventListener('load', f, { once: true }));
  if (mark && !still) atLoad(() => import('/mark-anim.js').then((m) => m.header(mark)).catch(() => document.documentElement.classList.remove('intro')));

  // Scroll-linked entrances (style.css .rv) for what starts below the first screen only: the page
  // paints whole, and nothing on the first screen waits for a scroll.
  if (!still && window.CSS && CSS.supports('animation-timeline: view()')) {
    // an observer's first report, not a measurement here: it comes after the browser's own layout
    const io = new IntersectionObserver((es) => {
      for (const e of es) {
        io.unobserve(e.target);
        if (e.boundingClientRect.top > e.rootBounds.height) {
          e.target.classList.add('rv');
          if (e.target.matches('.doors > li, .index > li, .facts > li, .platforms > li')) rules.push(e.target), draw();
        }
      }
    });
    // The rules over rows follow the scroll through a short exponential chase (28 ms), so a wheel notch eases
    // in instead of jumping: target = how far the row has come in (0..48% of its pass), eased.
    const rules = [];
    let raf = 0, last = 0;
    const ease = (x) => x * x * (3 - 2 * x);
    const draw = () => { if (!raf) raf = requestAnimationFrame(step); };
    function step(now) {
      raf = 0;
      const k = 1 - Math.exp(-(last ? Math.min(now - last, 50) : 16) / 28), vh = innerHeight;
      last = now;
      let moving = false;
      for (const el of rules) {
        const r = el.getBoundingClientRect();
        const t = ease(Math.min(1, Math.max(0, (vh - r.top) / (0.48 * (vh + r.height)))));
        const c = el._draw ?? 0, n = Math.abs(t - c) < 0.001 ? t : c + (t - c) * k;
        if (n !== c) el.style.setProperty('--draw', (el._draw = n).toFixed(4));
        if (n !== t) moving = true;
      }
      if (moving) draw(); else last = 0;
    }
    addEventListener('scroll', draw, { passive: true });
    addEventListener('resize', draw, { passive: true });
    for (const e of document.querySelectorAll('main h2, .numbers > div, .doors > li, .index > li, .facts > li, .platforms > li, .split figure, .gallery figure, .renders figure, .stage-pcb')) io.observe(e);
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
    // the current step's bar (style.css .tab-bar): one element that glides between the tabs
    const tabBar = document.createElement('i');
    tabBar.className = 'tab-bar';
    tabs[0].parentElement.appendChild(tabBar);
    let placed = false;
    const place = (jump) => {
      const t = tabs[cur];
      if (!t) return;
      // the first placement and a resize jump; a step change glides
      const snap = jump || !placed;
      if (snap) tabBar.style.transition = 'none';
      tabBar.style.transform = `translate(${t.offsetLeft}px, ${t.offsetTop}px) scaleX(${t.offsetWidth / 100})`;
      if (snap) { void tabBar.offsetWidth; tabBar.style.transition = ''; }
      placed = true;
    };
    new ResizeObserver(() => place(true)).observe(tabs[0].parentElement);
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
      if (b !== cur) { cur = b; place(); }
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
  // The home hero's Phosphor (app() below) where the device can carry it; its clip stays the fallback.
  const appBox = able ? document.querySelector('.frame[data-app]') : null;
  for (const ol of document.querySelectorAll('ol.beats[data-dur]')) { const f = ol.closest('figure'); f.stepper = stepper(f, ol); }
  const first = document.querySelector('figure[data-live]');
  const liveFig = able && first && (!still || first.stepper) && first;
  for (const v of document.querySelectorAll('video[data-auto]')) {
    const f = v.closest('figure');
    if (f && f.stepper) { v.removeAttribute('controls'); continue; }
    if (still) continue;
    v.removeAttribute('controls');
    if (!(liveFig && liveFig.contains(v)) && !(appBox && appBox.contains(v))) clip(v);
  }
  if (appBox) afterLoad(() => app(appBox));
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
    }, { threshold: 0.01 });   // on screen, not near it: a piece the reader has not reached costs nothing
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
    box.innerHTML = `<svg id="scene" viewBox="${fig.dataset.vb || '0 0 1280 720'}" aria-hidden="true"></svg>`;
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

  // The home hero: the Phosphor demo (data-app) in an iframe once the page has loaded, the visitor has done
  // something (a pointer, key, wheel or scroll) or 4 s have passed, and the hero is on screen, sized to the
  // frame (no transform: a scaled iframe costs the compositor every frame). It shows over the poster on its 'ready' message; 'failed' or 20 s of silence removes it
  // and the clip plays as before. It is told 'pause' off screen and in a hidden tab, 'resume' back. It follows the theme toggle; reduced motion is the app's own (it starts
  // nothing). Constraints: the frame's size comes from style.css alone (no shift).
  function app(box) {
    const fallback = () => { f.remove(); if (!still) for (const v of box.querySelectorAll('video[data-auto]')) clip(v); };
    const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);   // the preview serves the mini build on :8791
    const url = new URL(local ? `http://${location.hostname}:8791/mini/` : box.dataset.app);
    const theme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
    const f = document.createElement('iframe');
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      url.searchParams.set('embed', '1');
      url.searchParams.set('theme', theme());
      f.src = url.href;
      f.title = box.dataset.title || '';
      f.allow = 'compute-pressure';   // the app's health readout
      box.appendChild(f);
      // off screen or in a hidden tab the app pauses: Neutrino's clock stops (sent again on ready, the first
      // message the app can hear)
      let seen = true;
      const tell = () => f.contentWindow && f.contentWindow.postMessage({ phosphor: seen && !document.hidden ? 'resume' : 'pause' }, url.origin);
      new IntersectionObserver(([e]) => { seen = e.isIntersecting; tell(); }).observe(box);
      document.addEventListener('visibilitychange', tell);
      const late = setTimeout(fallback, 20000);
      addEventListener('message', (m) => {
        if (m.source !== f.contentWindow || m.origin !== url.origin || !m.data) return;
        clearTimeout(late);
        if (m.data.phosphor === 'failed') return fallback();
        if (m.data.phosphor !== 'ready') return;
        tell();
        box.classList.add('on');
        for (const v of box.querySelectorAll('video')) { v.pause(); v.remove(); }
        const cap = box.parentElement.querySelector('figcaption[data-live-caption]');
        if (cap) {
          const a = Object.assign(document.createElement('a'), { href: box.dataset.app, textContent: 'Full size' });
          cap.replaceChildren(cap.dataset.liveCaption + ' ', a);
        }
      });
      addEventListener('themechange', () => f.contentWindow && f.contentWindow.postMessage({ theme: theme() }, url.origin));
    }, { threshold: 0.01 });
    // its first seconds are a heavy main thread: not while the page is still settling
    const IN = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'];
    const go = () => { clearTimeout(t); for (const n of IN) removeEventListener(n, go, true); io.observe(box); };
    const t = setTimeout(go, 4000);
    for (const n of IN) addEventListener(n, go, { capture: true, passive: true, once: true });
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

  // A catalog entry turning into a control (/valence/, figure.morph): the first time the figure is
  // well on screen, each field ([data-to] in the entry) travels to the part of the control drawn
  // from it, which comes up as it lands. The figure is whole before and after; reduced motion: none.
  for (const fig of document.querySelectorAll('figure.morph')) {
    if (still || !fig.animate) continue;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const box = fig.getBoundingClientRect();
      [...fig.querySelectorAll('[data-to]')].forEach((src, i) => {
        const dst = fig.querySelector('.ui ' + src.dataset.to), a = src.getBoundingClientRect(), b = dst.getBoundingClientRect();
        const fly = document.createElement('span');
        fly.className = 'fly';
        fly.setAttribute('aria-hidden', 'true');
        fly.textContent = src.textContent;
        fly.style.left = a.left - box.left - 8 + 'px';
        fly.style.top = a.top - box.top - 2 + 'px';
        fig.appendChild(fly);
        const at = 250 + i * 160, go = 720;
        const dx = b.left - a.left, dy = b.top + b.height / 2 - (a.top + a.height / 2);
        fly.animate([{ transform: 'none', opacity: 0 }, { transform: 'none', opacity: 1, offset: 0.12 }, { transform: `translate(${dx}px, ${dy}px)`, opacity: 1, offset: 0.85 }, { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 }],
          { delay: at, duration: go, easing: 'cubic-bezier(.45, 0, .2, 1)', fill: 'both' }).finished.then(() => fly.remove());
        dst.animate([{ opacity: 0.15 }, { opacity: 1 }], { delay: at + go * 0.8, duration: 260, easing: 'ease-out', fill: 'backwards' });
      });
    }, { threshold: 0.6 });
    io.observe(fig);
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
      if (!v.offsetParent) continue;   // not shown (the home hero's clip on a phone)
      const p = new Image();
      p.src = v.dataset.hiPoster;
      p.decode().then(() => { v.poster = p.src; }).catch(() => {});
    }
  }
  if (!lean) afterLoad(sharpen);

  // Downloads: the newest published Phosphor release, pre-releases included (/releases/latest skips
  // them; the API lists newest first and drafts only to the repo's own members). The static page is
  // the fallback; values change only when the API names a newer version than data-release. A file
  // missing from that release hides its button. Public names: Phosphor-<version>-<data-file>.
  const rel = document.querySelector('[data-release]');
  if (rel) fetch('https://api.github.com/repos/openvalence/Phosphor/releases?per_page=10')
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => {
      const r = list.find((x) => !x.draft);
      if (!r) return;
      const v = r.tag_name.replace(/^v/, ''), a = v.split('.').map(Number), b = rel.dataset.release.split('.').map(Number);
      const i = a.findIndex((x, k) => x !== b[k]);
      if (i < 0 || !(a[i] > (b[i] ?? -1))) return;
      const file = (name) => r.assets.find((x) => x.name === name);
      for (const el of document.querySelectorAll('[data-rel="v"]')) el.textContent = v;
      for (const el of document.querySelectorAll('[data-rel="notes"]')) el.href = r.html_url;
      for (const el of document.querySelectorAll('[data-rel="sums"]')) el.href = file('SHA256SUMS.txt')?.browser_download_url || r.html_url;
      for (const el of rel.querySelectorAll('a[data-file]')) {
        const f = file(`Phosphor-${v}-${el.dataset.file}`);
        el.closest('li').hidden = !f;
        if (!f) continue;
        el.href = f.browser_download_url;
        el.querySelector('b small').textContent = f.name;
        el.querySelector('b + small').textContent = (f.size / 1048576).toFixed(1) + ' MB';
      }
    })
    .catch(() => {});
})();
