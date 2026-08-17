/* ==================================================================
   demos.js — every animated / interactive figure in the Workshop 4 deck.
   Each demo fills its own container element, is created lazily the first
   time its slide is shown, and stops its animation when the slide is left.
   ================================================================== */
(function (global) {
  'use strict';

  const D = {};                       // demo registry
  const running = new Map();          // element -> stop()

  /* ---------------- small DOM helpers ---------------- */

  function h(tag, attrs, kids) {
    const e = document.createElement(tag);
    for (const k in (attrs || {})) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'style') e.style.cssText = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(k => e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k));
    return e;
  }
  const svgEl = (tag, attrs) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in (attrs || {})) e.setAttribute(k, attrs[k]);
    return e;
  };

  function figure(caption, w) {
    const c = h('canvas');
    if (w) { c.style.width = w + 'px'; c.style.height = 'auto'; }
    const f = h('div', { class: 'figure' }, [c]);
    const cap = h('div', { class: 'caption' }, [caption || '']);
    f.appendChild(cap);
    return { wrap: f, canvas: c, cap };
  }

  function slider(label, min, max, step, val, onInput, fmt) {
    fmt = fmt || (v => String(v));
    const out = h('span', { class: 'mono', style: 'color:var(--accent);min-width:3.4em' }, [fmt(val)]);
    const inp = h('input', { type: 'range', min, max, step, value: val });
    inp.addEventListener('input', () => {
      out.textContent = fmt(parseFloat(inp.value));
      onInput(parseFloat(inp.value));
    });
    return { wrap: h('label', {}, [label, inp, out]), input: inp, out, set: v => { inp.value = v; out.textContent = fmt(v); } };
  }

  function buttons(items, onPick, initial) {
    const g = h('div', { class: 'btn-group' });
    const btns = items.map((it, i) => {
      const b = h('button', { class: 'btn' + (i === (initial || 0) ? ' active' : '') }, [it.label]);
      b.addEventListener('click', () => {
        btns.forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        onPick(it.value, it);
      });
      g.appendChild(b);
      return b;
    });
    return { wrap: g, buttons: btns };
  }

  function snippet(html) {
    const e = h('div', { class: 'snippet' });
    e.innerHTML = html;
    return e;
  }

  const IMG = (name, size) => IM.loadColor(IMAGES[name], size || 320);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  /* ---------------- tiny line-plot helper ---------------- */

  // Draws one or more series on a shared axis. series = [{y:[], color, width}]
  function plot(canvas, W, H, series, opts) {
    opts = opts || {};
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const pad = opts.pad || { l: 6, r: 6, t: 8, b: 16 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    let lo = opts.min, hi = opts.max;
    if (lo === undefined) {
      lo = Infinity; hi = -Infinity;
      series.forEach(s => s.y.forEach(v => { lo = Math.min(lo, v); hi = Math.max(hi, v); }));
      if (hi - lo < 1e-9) hi = lo + 1;
    }
    // background wash (e.g. the visible-spectrum strip)
    if (opts.bg) opts.bg(g, pad.l, pad.t, iw, ih);
    // baseline
    g.strokeStyle = 'rgba(107,119,137,.45)'; g.lineWidth = 1;
    g.beginPath();
    const y0 = pad.t + ih - (0 - lo) / (hi - lo) * ih;
    g.moveTo(pad.l, clamp(y0, pad.t, pad.t + ih)); g.lineTo(pad.l + iw, clamp(y0, pad.t, pad.t + ih));
    g.stroke();
    series.forEach(s => {
      if (!s.y.length) return;
      g.strokeStyle = s.color; g.lineWidth = s.width || 2;
      g.setLineDash(s.dash || []);
      if (s.fill) {
        g.beginPath();
        s.y.forEach((v, i) => {
          const x = pad.l + i / (s.y.length - 1) * iw, y = pad.t + ih - (v - lo) / (hi - lo) * ih;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        });
        g.lineTo(pad.l + iw, pad.t + ih); g.lineTo(pad.l, pad.t + ih); g.closePath();
        g.fillStyle = s.fill; g.fill();
      }
      g.beginPath();
      s.y.forEach((v, i) => {
        const x = pad.l + i / (s.y.length - 1) * iw, y = pad.t + ih - (v - lo) / (hi - lo) * ih;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.stroke();
      g.setLineDash([]);
    });
    if (opts.labels) {
      g.fillStyle = css('--ink-faint'); g.font = '10px ' + css('--mono');
      opts.labels.forEach(([t, frac]) => {
        g.textAlign = 'center';
        g.fillText(t, pad.l + frac * iw, H - 4);
      });
    }
  }

  /* ==================================================================
     PART 1 · COLOUR
     ================================================================== */


  /* ---------- shared spectral helpers ---------- */

  const spdGauss = (mu, s) => CIE.lambda.map(l => Math.exp(-0.5 * ((l - mu) / s) ** 2));

  // paints the visible spectrum faintly behind a wavelength plot
  function spectrumWash(g, x, y, iw, ih) {
    const C = CIE, n = C.lambda.length;
    for (let i = 0; i < iw; i++) {
      const nm = C.lambda[0] + (i / iw) * (C.lambda[n - 1] - C.lambda[0]);
      const c = IM.wavelengthRGB(Math.round(nm / 5) * 5);
      g.fillStyle = `rgba(${c.map(Math.round).join(',')},.20)`;
      g.fillRect(x + i, y, 1.5, ih);
    }
  }
  const NM_LABELS = [['400', 0.03], ['500', .32], ['600', .61], ['700', .90]];

  /* ---- 1a. Each of the three numbers is an overlap area ----
     The integral I(λ)·S(λ)dλ is literally the area where the light and one
     sensor's sensitivity overlap, so we draw that area rather than assert it. */
  D.trichromacy = function (root) {
    let peak = 560, width = 55;

    const spdCv = h('canvas', { class: 'plot' });
    const overlapCv = [0, 1, 2].map(() => h('canvas', { class: 'plot' }));
    const values = [0, 1, 2].map(() => h('div', { class: 'caption', style: 'margin-top:.2em' }));
    const sw = h('div', { class: 'swatch', style: 'height:88px;width:96px' });

    const CH = [
      { key: 'x', name: 'X', colour: '#ff6b6b', fill: 'rgba(255,107,107,.32)' },
      { key: 'y', name: 'Y', colour: '#6bd97f', fill: 'rgba(107,217,127,.32)' },
      { key: 'z', name: 'Z', colour: '#6ea8fe', fill: 'rgba(110,168,254,.32)' }
    ];

    root.appendChild(h('div', { class: 'figure', style: 'margin-bottom:.5em' }, [spdCv,
      h('div', { class: 'caption' }, ['① the light: how much energy at every wavelength'])]));

    const cols = CH.map((c, i) => h('div', { class: 'col', style: 'gap:.1em' }, [
      overlapCv[i], values[i]
    ]));
    root.appendChild(h('div', { class: 'row', style: 'gap:.7em;align-items:center' }, [
      h('div', { class: 'col', style: 'gap:.25em' }, [
        h('div', { class: 'row', style: 'gap:.7em' }, cols),
        h('div', { class: 'caption' }, [
          '② each sensor multiplies the light by its own sensitivity — the shaded area is the answer'])
      ]),
      h('div', { class: 'arrow' }, ['→']),
      h('div', { class: 'col', style: 'gap:.25em' }, [sw,
        h('div', { class: 'caption', style: 'margin:0' }, ['③ the colour'])])
    ]));
    root.appendChild(h('div', { class: 'controls-row' }, [
      slider('peak λ', 420, 660, 5, peak, v => { peak = v; render(); }, v => v + 'nm').wrap,
      slider('width', 14, 120, 2, width, v => { width = v; render(); }, v => v + 'nm').wrap
    ]));

    function render() {
      const spd = spdGauss(peak, width);
      const XYZ = IM.spectrumToXYZ(spd);

      plot(spdCv, 560, 96, [{ y: spd, color: css('--accent-4'), width: 2.4, fill: 'rgba(217,143,208,.16)' }],
        { min: 0, max: 1.06, bg: spectrumWash, labels: NM_LABELS });

      CH.forEach((c, i) => {
        const curve = CIE[c.key];
        const product = curve.map((v, k) => v * spd[k]);
        plot(overlapCv[i], 176, 82, [
          { y: curve, color: c.colour, width: 1.3, dash: [3, 3] },
          { y: product, color: c.colour, width: 2, fill: c.fill }
        ], { min: 0, max: 1.9 });
        values[i].innerHTML =
          `<b style="color:${c.colour};font-size:1.15em">${c.name} = ${XYZ[i].toFixed(3)}</b>`;
      });

      const gain = 0.85 / Math.max(1e-6, XYZ[1]);
      const rgb = IM.xyzToSwatch(XYZ[0], XYZ[1], XYZ[2], gain);
      sw.style.background = `rgb(${rgb.map(Math.round).join(',')})`;
    }
    render();
    return () => { };
  };

  /* ---- 1b. Metamers: two spectra the sensor cannot tell apart ----
     Spectrum B is a mixture of three narrow display primaries, solved so that
     it integrates to exactly the same X, Y, Z as spectrum A. */
  D.metamers = function (root) {
    let peak = 560;

    const cvA = h('canvas', { class: 'plot' });
    const cvB = h('canvas', { class: 'plot' });
    // A single element painted with a hard-stop gradient, NOT two divs side by
    // side: reveal scales the slide by a non-integer factor, so the boundary
    // between two elements lands mid-pixel and gets antialiased into a visible
    // hairline — precisely the seam this slide claims does not exist. With one
    // gradient, identical colours either side blend to themselves.
    const swPair = h('div', {
      style: 'height:78px;width:244px;border:1px solid var(--line);border-radius:10px'
    });
    const readout = h('div', { class: 'caption', style: 'margin-top:.5em' });

    root.appendChild(h('div', { class: 'row', style: 'gap:1.1em;align-items:center' }, [
      h('div', { class: 'col', style: 'gap:.45em' }, [
        h('div', { class: 'figure' }, [cvA, h('div', { class: 'caption' }, [
          'A — one smooth hump, like daylight off a surface'])]),
        h('div', { class: 'figure' }, [cvB, h('div', { class: 'caption' }, [
          'B — three narrow spikes, like the pixels in this projector'])])
      ]),
      h('div', { class: 'arrow' }, ['→']),
      h('div', { class: 'col', style: 'gap:.3em' }, [
        swPair,
        h('div', { class: 'swatch-lbl' }, ['A on the left, B on the right'])
      ])
    ]));
    root.appendChild(h('div', { class: 'controls-row' }, [
      slider('peak λ of spectrum A', 450, 640, 5, peak, v => { peak = v; render(); }, v => v + 'nm').wrap
    ]));
    root.appendChild(readout);

    // 3x3 solve by Cramer's rule — finds the primary weights that match A's XYZ
    function solve3(M, v) {
      const det = (A) => A[0] * (A[4] * A[8] - A[5] * A[7]) - A[1] * (A[3] * A[8] - A[5] * A[6]) +
        A[2] * (A[3] * A[7] - A[4] * A[6]);
      const d = det(M);
      if (Math.abs(d) < 1e-12) return [0, 0, 0];
      const col = (j) => { const A = M.slice(); A[j] = v[0]; A[j + 3] = v[1]; A[j + 6] = v[2]; return A; };
      return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
    }

    function render() {
      const spdA = spdGauss(peak, 55);
      const XYZ = IM.spectrumToXYZ(spdA);

      const prim = [spdGauss(450, 8), spdGauss(540, 8), spdGauss(610, 8)];
      const P = prim.map(p => IM.spectrumToXYZ(p));
      const M = [P[0][0], P[1][0], P[2][0],
      P[0][1], P[1][1], P[2][1],
      P[0][2], P[1][2], P[2][2]];
      let w = solve3(M, XYZ);
      const feasible = w.every(v => v > -1e-6);
      w = w.map(v => Math.max(0, v));
      const spdB = CIE.lambda.map((_, i) => w[0] * prim[0][i] + w[1] * prim[1][i] + w[2] * prim[2][i]);
      const XYZb = IM.spectrumToXYZ(spdB);

      const top = Math.max(1.05, ...spdB) * 1.06;
      plot(cvA, 430, 92, [{ y: spdA, color: css('--accent-4'), width: 2.4, fill: 'rgba(217,143,208,.16)' }],
        { min: 0, max: top, bg: spectrumWash, labels: NM_LABELS });
      plot(cvB, 430, 92, [{ y: spdB, color: css('--accent-3'), width: 2.2, fill: 'rgba(127,214,168,.16)' }],
        { min: 0, max: top, bg: spectrumWash, labels: NM_LABELS });

      const gain = 0.85 / Math.max(1e-6, XYZ[1]);
      const cA = `rgb(${IM.xyzToSwatch(XYZ[0], XYZ[1], XYZ[2], gain).map(Math.round).join(',')})`;
      const cB = `rgb(${IM.xyzToSwatch(XYZb[0], XYZb[1], XYZb[2], gain).map(Math.round).join(',')})`;
      swPair.style.backgroundImage = feasible
        ? `linear-gradient(90deg, ${cA} 0 50%, ${cB} 50% 100%)`
        // out of gamut: A on the left, hatching showing through on the right
        : `linear-gradient(90deg, ${cA} 0 50%, rgba(0,0,0,0) 50% 100%),` +
        ` repeating-linear-gradient(45deg,#242833 0 6px,#343a48 6px 12px)`;

      readout.innerHTML = feasible
        ? `Both integrate to <b>X = ${XYZ[0].toFixed(3)}</b>, <b>Y = ${XYZ[1].toFixed(3)}</b>, ` +
        `<b>Z = ${XYZ[2].toFixed(3)}</b>. Different light, identical numbers, <b>no visible seam</b>.`
        : `No positive mixture of these three primaries reaches this colour — it is <b>outside the display's gamut</b>, ` +
        `so no seam can be hidden here.`;
    }
    render();
    return () => { };
  };

  /* ---- 1c. All four spaces, side by side, on one picture ----
     Hue and the two opponent axes get their own colour maps, because they are
     angles and signed axes rather than intensities — grey ramps hide that. */
  D.colourContact = function (root) {
    const cmapHue = (t) => IM.hsv2rgb(t * 360, 0.85, 0.95).map(Math.round);
    const diverge = (neg, pos) => (t) => {
      const g = [150, 150, 150], k = Math.abs(t - 0.5) * 2, end = t < 0.5 ? neg : pos;
      return [0, 1, 2].map(c => Math.round(g[c] + (end[c] - g[c]) * k));
    };
    const cmapA = diverge([64, 190, 96], [244, 78, 78]);     // green ↔ red
    const cmapB = diverge([80, 130, 235], [242, 206, 74]);   // blue  ↔ yellow

    const SPACES = [
      {
        name: 'RGB', colour: '#6ea8fe', ch: ['R', 'G', 'B'],
        fwd: (r, g, b) => [r, g, b],
        disp: [{ min: 0, max: 255 }, { min: 0, max: 255 }, { min: 0, max: 255 }],
        gist: '<b>All three look like the photo</b> — brightness is baked into every channel, so you cannot touch colour without touching brightness.'
      },
      {
        name: 'HSV', colour: '#d98fd0', ch: ['H', 'S', 'V'],
        fwd: (r, g, b) => IM.rgb2hsv(r, g, b),
        disp: [{ min: 0, max: 360, cmap: cmapHue }, { min: 0, max: 1 }, { min: 0, max: 1 }],
        gist: 'Which colour, how pure, how bright. <b>V holds the picture</b>; H is an angle round a colour wheel, so it wraps at 360°.'
      },
      {
        name: 'XYZ', colour: '#7fd6a8', ch: ['X', 'Y', 'Z'],
        fwd: (r, g, b) => IM.rgb2xyz(r, g, b),
        disp: [{ min: 0, max: 1 }, { min: 0, max: 1 }, { min: 0, max: 1.1 }],
        gist: 'What the standard eye responds to. <b>Y is exactly luminance</b>; X and Z are sensor responses, not viewable pictures.'
      },
      {
        name: 'L*a*b*', colour: '#f7d774', ch: ['L*', 'a*', 'b*'],
        fwd: (r, g, b) => IM.rgb2lab(r, g, b),
        disp: [{ min: 0, max: 100 }, { min: -90, max: 90, cmap: cmapA }, { min: -90, max: 90, cmap: cmapB }],
        gist: 'Lightness, then distance from grey along two opponent axes. <b>Colour is fully separated from brightness</b> — and equal steps look equally different.'
      }
    ];

    const grid = h('div', { class: 'contact' });
    root.appendChild(grid);
    const origCv = h('canvas');
    // capped to a channel cell's width — left to itself it fills the wide text
    // column and pushes the fourth row off the bottom of the slide
    grid.appendChild(h('div', { class: 'col', style: 'gap:.2em;width:120px;justify-self:start' }, [
      origCv, h('div', { class: 'chname' }, ['the original'])]));
    ['channel 1', 'channel 2', 'channel 3'].forEach(t =>
      grid.appendChild(h('div', { class: 'chname', style: 'align-self:end' }, [t])));

    const cells = SPACES.map(sp => {
      grid.appendChild(h('div', {}, [
        h('div', { class: 'sp-name', style: `color:${sp.colour}` }, [sp.name]),
        h('div', { class: 'sp-int' })
      ]));
      return sp.ch.map(() => {
        const cv = h('canvas');
        const name = h('div', { class: 'chname' }, ['']);
        grid.appendChild(h('div', { class: 'col', style: 'gap:.1em' }, [cv, name]));
        return { cv, name };
      });
    });
    // fill in the descriptions (they were appended above as empty divs)
    grid.querySelectorAll('.sp-int').forEach((el, i) => el.innerHTML = SPACES[i].gist);

    IMG('macaws', 260).then(img => {
      IM.drawColor(origCv, img);
      SPACES.forEach((sp, r) => {
        const conv = IM.mapPixels(img, sp.fwd);
        sp.ch.forEach((chName, c) => {
          IM.draw(cells[r][c].cv, IM.channel(conv, c), sp.disp[c]);
          cells[r][c].name.textContent = chName;
        });
      });
    });
    return () => { };
  };

  /* ---- 1d. The same colours, three coordinate systems ----
     One point set throughout: the surface of the RGB cube. Replotted in HSV
     cylindrical coordinates it becomes the cylinder exactly (the cube's
     max=1 faces are the lid, its min=0 faces the wall), and replotted in Lab
     it becomes the irregular solid whose cross-section the gamut slide draws. */
  D.colourGeometry = function (root) {
    let yaw = -0.62, pitch = 0.42, drag = null;
    const SZ = 268;

    // sample the RGB cube's surface once
    const pts = [];
    const N = 38;
    for (let face = 0; face < 6; face++) {
      const axis = face >> 1, lo = face & 1;
      for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
        const u = i / N, v = j / N, c = [0, 0, 0];
        c[axis] = lo ? 0 : 1;
        c[(axis + 1) % 3] = u; c[(axis + 2) % 3] = v;
        const [r, g, b] = c.map(t => t * 255);
        const [H, S, V] = IM.rgb2hsv(r, g, b);
        const [L, A, B] = IM.rgb2lab(r, g, b);
        const th = H * Math.PI / 180;
        pts.push({
          css: `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`,
          rgb: [c[0] * 2 - 1, c[1] * 2 - 1, c[2] * 2 - 1],
          hsv: [S * Math.cos(th), S * Math.sin(th), V * 2 - 1],
          lab: [A / 108, B / 108, L / 50 - 1]
        });
      }
    }

    const VIEWS = [
      {
        key: 'rgb', title: 'RGB — a cube', colour: '#6ea8fe',
        axes: [['R', [1, 0, 0]], ['G', [0, 1, 0]], ['B', [0, 0, 1]]],
        gist: 'Three perpendicular axes, one per light. Corners are the primaries; the grey ramp is the diagonal from black to white.'
      },
      {
        key: 'hsv', title: 'HSV — a cylinder', colour: '#d98fd0',
        axes: [['S', [1, 0, 0]], ['', [0, 1, 0]], ['V', [0, 0, 1]]],
        gist: 'The same cube in polar coordinates: hue is the <b>angle</b> round, saturation the <b>radius</b> out, value the <b>height</b> up.'
      },
      {
        key: 'lab', title: 'L*a*b* — a lumpy solid', colour: '#f7d774',
        axes: [['a*', [1, 0, 0]], ['b*', [0, 1, 0]], ['L*', [0, 0, 1]]],
        gist: 'Perpendicular axes again, but perceptual — so the reachable set is a <b>lumpy blob</b>, not a neat shape.'
      }
    ];

    const canvases = VIEWS.map(() => h('canvas', {
      style: `width:${SZ}px;height:${SZ}px;cursor:grab;touch-action:none`
    }));
    root.appendChild(h('div', { class: 'row', style: 'gap:.9em;align-items:flex-start' },
      VIEWS.map((v, i) => {
        // h() sends unknown keys to setAttribute, so innerHTML has to be set as a property
        const gist = h('div', { class: 'sp-int', style: 'text-align:center' });
        gist.innerHTML = v.gist;
        return h('div', { class: 'col', style: 'gap:.25em;width:' + SZ + 'px' }, [
          h('div', { class: 'sp-name', style: `color:${v.colour};text-align:center` }, [v.title]),
          canvases[i], gist
        ]);
      })));
    root.appendChild(h('div', { class: 'caption', style: 'margin-top:.5em;text-align:center' }, [
      'Every dot is the same colour in all three pictures — drag any one of them to rotate all three together.'
    ]));

    // drag anywhere rotates all three, because they are one object
    canvases.forEach(cv => {
      cv.addEventListener('pointerdown', e => {
        drag = { x: e.clientX, y: e.clientY, yaw, pitch };
        // capture keeps the drag alive outside the canvas, but throws for a
        // pointer id the browser does not know about — never let that kill the drag
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
        cv.style.cursor = 'grabbing';
      });
      cv.addEventListener('pointermove', e => {
        if (!drag) return;
        yaw = drag.yaw + (e.clientX - drag.x) * 0.011;
        pitch = clamp(drag.pitch + (e.clientY - drag.y) * 0.011, -1.4, 1.4);
        paint();
      });
      const stop = () => { drag = null; cv.style.cursor = 'grab'; };
      cv.addEventListener('pointerup', stop);
      cv.addEventListener('pointercancel', stop);
    });

    function project(p) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const x = p[0] * cy - p[1] * sy;
      const z0 = p[0] * sy + p[1] * cy;
      const y = p[2] * cp - z0 * sp;
      const depth = p[2] * sp + z0 * cp;
      return [x, y, depth];
    }

    function paint() {
      VIEWS.forEach((view, vi) => {
        const cv = canvases[vi], dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.width = SZ * dpr; cv.height = SZ * dpr;
        const g = cv.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, SZ, SZ);
        const R = SZ * 0.30, cx = SZ / 2, cyy = SZ / 2;

        // axes behind the cloud
        g.lineWidth = 1; g.font = '10px ' + css('--mono'); g.textAlign = 'center';
        view.axes.forEach(([name, dir]) => {
          if (!name) return;
          const a = project(dir.map(d => -d * 1.32)), b = project(dir.map(d => d * 1.32));
          g.strokeStyle = 'rgba(154,167,186,.28)';
          g.beginPath(); g.moveTo(cx + a[0] * R, cyy - a[1] * R);
          g.lineTo(cx + b[0] * R, cyy - b[1] * R); g.stroke();
          g.fillStyle = css('--ink-faint');
          g.fillText(name, cx + b[0] * R * 1.1, cyy - b[1] * R * 1.1 + 3);
        });

        // painter's algorithm — far points first
        const proj = pts.map(p => { const q = project(p[view.key]); return { q, css: p.css }; });
        proj.sort((a, b) => a.q[2] - b.q[2]);
        const s = 3.4;
        for (const { q, css: col } of proj) {
          g.fillStyle = col;
          g.fillRect(cx + q[0] * R - s / 2, cyy - q[1] * R - s / 2, s, s);
        }
      });
    }
    paint();
    return () => { };
  };

  /* ---- 1e. One image in four colour spaces, one at a time ---- */
  D.colourSpaces = function (root) {
    const SZ = 250;
    let img = null, space = 'RGB';

    const orig = figure('original (RGB)', 200);
    const chans = [figure('', SZ), figure('', SZ), figure('', SZ)];
    const names = chans.map(() => h('div', { class: 'chan-name' }, ['']));
    const back = figure('converted back to RGB', 200);
    const code = snippet('');

    const chanCol = (i) => h('div', { class: 'col', style: 'gap:.1em' }, [names[i], chans[i].wrap]);
    root.appendChild(h('div', { class: 'row', style: 'gap:.9em;align-items:flex-start' }, [
      orig.wrap,
      h('div', { class: 'chan-grid', style: 'flex:1' }, [chanCol(0), chanCol(1), chanCol(2)]),
      back.wrap
    ]));
    root.appendChild(h('div', { class: 'controls-row' }, [
      buttons([{ label: 'RGB', value: 'RGB' }, { label: 'HSV', value: 'HSV' },
      { label: 'XYZ', value: 'XYZ' }, { label: 'Lab', value: 'Lab' }],
        v => { space = v; render(); }, 0).wrap
    ]));
    root.appendChild(code);

    const DEF = {
      RGB: {
        ch: ['R', 'G', 'B'], colors: ['#ff6b6b', '#6bd97f', '#6ea8fe'],
        fwd: (r, g, b) => [r, g, b], rng: [[0, 255], [0, 255], [0, 255]],
        note: 'what the file stores. Channels are correlated: all three rise and fall with brightness.',
        code: 'img  <span class="c"># already BGR from cv2.imread — no conversion needed</span>'
      },
      HSV: {
        ch: ['H — hue', 'S — saturation', 'V — value'], colors: ['#d98fd0', '#f2a65a', '#e8ecf3'],
        fwd: (r, g, b) => IM.rgb2hsv(r, g, b), rng: [[0, 360], [0, 1], [0, 1]],
        note: 'separates "which colour" from "how much" and "how bright".',
        code: 'img_hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)   <span class="c"># H is 0–179 in uint8!</span>'
      },
      XYZ: {
        ch: ['X', 'Y — luminance', 'Z'], colors: ['#ff6b6b', '#6bd97f', '#6ea8fe'],
        fwd: (r, g, b) => IM.rgb2xyz(r, g, b), rng: [[0, 1], [0, 1], [0, 1.1]],
        note: 'device-independent. Y is defined to match the eye\'s brightness sensitivity.',
        code: 'img_xyz = cv2.cvtColor(img, cv2.COLOR_BGR2XYZ)'
      },
      Lab: {
        ch: ['L* — lightness', 'a* — green→red', 'b* — blue→yellow'],
        colors: ['#e8ecf3', '#ff8fa0', '#f7d774'],
        fwd: (r, g, b) => IM.rgb2lab(r, g, b), rng: [[0, 100], [-90, 90], [-90, 90]],
        note: 'lightness is split off from colour, and equal steps look equally different.',
        code: 'img_lab = cv2.cvtColor(img, cv2.COLOR_BGR2Lab)   <span class="c"># a,b stored +128 in uint8</span>'
      }
    };

    function render() {
      if (!img) return;
      const d = DEF[space];
      const conv = IM.mapPixels(img, d.fwd);
      for (let c = 0; c < 3; c++) {
        names[c].textContent = d.ch[c];
        names[c].style.color = d.colors[c];
        IM.draw(chans[c].canvas, IM.channel(conv, c), { min: d.rng[c][0], max: d.rng[c][1] });
        chans[c].cap.textContent = `${d.rng[c][0]} … ${d.rng[c][1]}`;
      }
      // round trip
      const inv = { RGB: (a, b, c) => [a, b, c], HSV: IM.hsv2rgb, XYZ: IM.xyz2rgb, Lab: IM.lab2rgb }[space];
      IM.drawColor(back.canvas, IM.mapPixels(conv, inv));
      code.innerHTML = d.code + '\n<span class="c"># ' + d.note + '</span>';
    }

    IMG('macaws', 300).then(i => { img = i; IM.drawColor(orig.canvas, i); render(); });
    return () => { };
  };

  /* ---- 1c. Probe one pixel in every space ---- */
  D.pixelProbe = function (root) {
    let img = null, px = 0.80, py = 0.35;    // starts on the red macaw's plumage: a* ≈ +59
    const cv = h('canvas', { style: 'cursor:crosshair' });
    const fig = h('div', { class: 'figure' }, [cv,
      h('div', { class: 'caption' }, ['click or drag anywhere on the birds'])]);
    const sw = h('div', { class: 'swatch', style: 'height:60px;width:110px' });
    const tbl = h('table', { class: 'tbl small', style: 'font-size:.62em' });

    root.appendChild(h('div', { class: 'row', style: 'gap:1.4em;align-items:center' }, [
      fig,
      h('div', { class: 'col', style: 'gap:.5em' }, [sw, h('div', { class: 'swatch-lbl' }, ['the pixel'])]),
      h('div', { style: 'min-width:19em' }, [tbl])
    ]));

    function paint() {
      if (!img) return;
      IM.drawColor(cv, img);
      const g = cv.getContext('2d');
      const x = px * img.w, y = py * img.h;
      g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 7, 0, 6.284); g.stroke();
      g.strokeStyle = '#000'; g.lineWidth = 1;
      g.beginPath(); g.arc(x, y, 9, 0, 6.284); g.stroke();

      const i = (Math.round(clamp(y, 0, img.h - 1)) * img.w + Math.round(clamp(x, 0, img.w - 1))) * 3;
      const r = img.data[i], gg = img.data[i + 1], b = img.data[i + 2];
      sw.style.background = `rgb(${Math.round(r)},${Math.round(gg)},${Math.round(b)})`;
      const hsv = IM.rgb2hsv(r, gg, b), xyz = IM.rgb2xyz(r, gg, b), lab = IM.rgb2lab(r, gg, b);
      const row = (name, vals, col) =>
        `<tr><td style="color:${col};font-weight:600;width:4.5em">${name}</td>` +
        vals.map(v => `<td class="num">${v}</td>`).join('') + '</tr>';
      tbl.innerHTML =
        row('RGB', [Math.round(r), Math.round(gg), Math.round(b)], '#6ea8fe') +
        row('HSV', [hsv[0].toFixed(0) + '°', hsv[1].toFixed(2), hsv[2].toFixed(2)], '#d98fd0') +
        row('XYZ', xyz.map(v => v.toFixed(3)), '#7fd6a8') +
        row('L*a*b*', [lab[0].toFixed(1), lab[1].toFixed(1), lab[2].toFixed(1)], '#f7d774');
    }

    let down = false;
    const pick = (ev) => {
      const r = cv.getBoundingClientRect();
      px = clamp((ev.clientX - r.left) / r.width, 0, 1);
      py = clamp((ev.clientY - r.top) / r.height, 0, 1);
      paint();
    };
    cv.addEventListener('pointerdown', e => { down = true; pick(e); });
    cv.addEventListener('pointermove', e => { if (down) pick(e); });
    window.addEventListener('pointerup', () => { down = false; });

    IMG('macaws', 340).then(i => { img = i; cv.style.width = '340px'; paint(); });
    return () => { };
  };

  /* ---- 1d. The lecture's own example: swap in RGB vs invert a* in Lab ---- */
  D.colourSwap = function (root) {
    let img = null;
    const orig = figure('original', 210);
    const rgbSwap = figure('swap R and G channels', 210);
    const labFlip = figure('invert the a* axis in Lab', 210);
    const code = snippet('');

    root.appendChild(h('div', { class: 'row', style: 'gap:1em' }, [
      orig.wrap, rgbSwap.wrap, labFlip.wrap
    ]));
    root.appendChild(code);
    code.innerHTML =
      '<b>rgb_swap</b> = img[:, :, [1, 0, 2]]' +
      '<span class="c">                      # move whole channels around</span>\n' +
      'lab = cv2.cvtColor(img, cv2.COLOR_BGR2Lab)\n' +
      '<b>lab[:, :, 1] = 255 - lab[:, :, 1]</b>' +
      '<span class="c">              # reflect a* through neutral grey</span>';

    IMG('macaws', 300).then(i => {
      img = i;
      IM.drawColor(orig.canvas, i);
      IM.drawColor(rgbSwap.canvas, IM.mapPixels(i, (r, g, b) => [g, r, b]));
      IM.drawColor(labFlip.canvas, IM.mapPixels(i, (r, g, b) => {
        const [L, a, bb] = IM.rgb2lab(r, g, b);
        return IM.lab2rgb(L, -a, bb);
      }));
    });
    return () => { };
  };

  /* ---- 1e. The a*b* plane at a chosen lightness ----
     The colour field is rendered at SS x the displayed size and let the browser
     downscale it, which is what anti-aliases the ragged gamut boundary. Axes and
     labels are drawn afterwards in CSS units, so text stays crisp. */
  D.labPlane = function (root) {
    const CSS = 300, SS = 3, N = CSS * SS, RANGE = 110;
    let L = 65, pending = null;

    const cv = h('canvas', { style: `width:${CSS}px;height:${CSS}px` });
    const cap = h('div', { class: 'caption' }, ['']);
    const fig = h('div', { class: 'figure' }, [cv, cap]);
    root.appendChild(h('div', { class: 'row' }, [fig]));
    root.appendChild(h('div', { class: 'controls-row' }, [
      // repaint on the next frame so dragging the slider stays smooth
      slider('L* (lightness)', 20, 95, 1, L, v => {
        L = v;
        if (pending === null) pending = requestAnimationFrame(() => { pending = null; paint(); });
      }).wrap
    ]));

    function paint() {
      cv.width = N; cv.height = N;
      const g = cv.getContext('2d');
      const out = g.createImageData(N, N);
      const d = out.data;
      // out-of-gamut pixels keep a faint hint of their direction over the panel
      // colour, rather than a muddy half-transparent wash
      const BG = [16, 20, 28], TINT = 0.16;
      let inside = 0;

      for (let y = 0; y < N; y++) {
        const b = (N / 2 - y) / (N / 2) * RANGE;
        for (let x = 0; x < N; x++) {
          const a = (x - N / 2) / (N / 2) * RANGE;
          const lin = IM.lab2linRGB(L, a, b);         // one conversion, both answers
          const ok = IM.inGamut(lin);
          const i = (y * N + x) * 4;
          if (ok) {
            inside++;
            d[i] = IM.lin2srgb(lin[0]) * 255;
            d[i + 1] = IM.lin2srgb(lin[1]) * 255;
            d[i + 2] = IM.lin2srgb(lin[2]) * 255;
          } else {
            for (let c = 0; c < 3; c++) {
              const v = IM.lin2srgb(clamp(lin[c], 0, 1)) * 255;
              d[i + c] = BG[c] + (v - BG[c]) * TINT;
            }
          }
          d[i + 3] = 255;
        }
      }
      g.putImageData(out, 0, 0);

      // overlay in CSS units — text renders at SS x device resolution, so it stays sharp
      g.setTransform(SS, 0, 0, SS, 0, 0);
      const M = CSS / 2;
      g.strokeStyle = 'rgba(232,236,243,.30)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, M); g.lineTo(CSS, M); g.moveTo(M, 0); g.lineTo(M, CSS); g.stroke();
      // neutral grey sits exactly at the origin — the fixed point of the a* flip
      g.fillStyle = 'rgba(232,236,243,.9)';
      g.beginPath(); g.arc(M, M, 2.6, 0, 6.284); g.fill();
      g.font = '11px ' + css('--mono');
      g.fillStyle = css('--ink-dim');
      g.textAlign = 'left'; g.fillText('−a* green', 4, M - 6);
      g.textAlign = 'right'; g.fillText('red +a*', CSS - 4, M - 6);
      g.textAlign = 'center'; g.fillText('+b* yellow', M, 13); g.fillText('−b* blue', M, CSS - 5);
      g.setTransform(1, 0, 0, 1, 0, 0);

      const pct = 100 * inside / (N * N);
      cap.innerHTML = `a*–b* plane at <b>L* = ${L}</b> · <b>solid</b> = your screen can show it ` +
        `(${pct.toFixed(0)}% of this square) · <b>faded</b> = it cannot`;
    }
    paint();
    return () => { if (pending !== null) cancelAnimationFrame(pending); };
  };

  /* ==================================================================
     PART 2 · LIGHT, SURFACES AND SHADING
     ================================================================== */

  /* ---- 2a. The diffuse reflectance model, one term at a time ---- */
  D.lambert = function (root) {
    let ang = 35, ilum = 1.0, albedo = 0.75, tint = 'white';
    const SZ = 200, GW = 268, GH = 196, PW = 268, PH = 196;
    const sphere = figure('a matte sphere, one light source', SZ);
    const geom = h('canvas', { class: 'plot', style: `width:${GW}px;height:${GH}px` });
    const curve = h('canvas', { class: 'plot', style: `width:${PW}px;height:${PH}px` });
    const geomCap = h('div', { class: 'caption' });
    geomCap.innerHTML = 'the dot product is a <b>projection</b>: how much of L lies along N';
    const geomFig = h('div', { class: 'figure' }, [geom, geomCap]);
    const curveFig = h('div', { class: 'figure' }, [curve,
      h('div', { class: 'caption' }, ['…and past 90° the surface faces away, so it gets nothing'])]);
    const readout = h('div', { class: 'caption', style: 'margin-top:.4em' });

    root.appendChild(h('div', { class: 'row', style: 'gap:1.1em;align-items:center' },
      [sphere.wrap, geomFig, curveFig]));
    root.appendChild(h('div', { class: 'controls-row' }, [
      slider('light direction', -115, 115, 1, ang, v => { ang = v; paint(); }, v => v + '°').wrap,
      slider('light intensity', 0.15, 1.4, 0.05, ilum, v => { ilum = v; paint(); }, v => v.toFixed(2)).wrap,
      slider('surface reflectance', 0.08, 1, 0.02, albedo, v => { albedo = v; paint(); }, v => v.toFixed(2)).wrap,
      buttons([{ label: 'white light', value: 'white' }, { label: 'warm light', value: 'warm' },
      { label: 'blue light', value: 'blue' }], v => { tint = v; paint(); }, 0).wrap
    ]));
    root.appendChild(readout);

    // a line with a solid arrowhead on the far end
    function arrow(g, x1, y1, x2, y2, colour, w) {
      const a = Math.atan2(y2 - y1, x2 - x1), head = 9;
      g.strokeStyle = colour; g.lineWidth = w; g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2 - Math.cos(a) * head * 0.8, y2 - Math.sin(a) * head * 0.8);
      g.stroke();
      g.fillStyle = colour;
      g.beginPath();
      g.moveTo(x2, y2);
      g.lineTo(x2 - head * Math.cos(a - 0.4), y2 - head * Math.sin(a - 0.4));
      g.lineTo(x2 - head * Math.cos(a + 0.4), y2 - head * Math.sin(a + 0.4));
      g.closePath(); g.fill();
      g.lineCap = 'butt';
    }

    function ctx2d(cv, W, H) {
      const dpr = Math.min(2, window.devicePixelRatio || 1) * 1.5;
      cv.width = W * dpr; cv.height = H * dpr;
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      return g;
    }

    function paint() {
      const a = ang * Math.PI / 180;
      // The light lies in the x–z plane, so N·L at the point facing the camera is
      // exactly cos(ang). An out-of-plane tilt would look prettier but would make
      // the number in the readout disagree with the diagram beside it.
      const L = [Math.sin(a), 0, Math.cos(a)];
      const ndl = Math.max(0, Math.cos(a));
      const lightRGB = { white: [1, 1, 1], warm: [1.15, .92, .62], blue: [.62, .82, 1.2] }[tint];
      IM.drawColor(sphere.canvas, IM.shadeSphere(SZ, [albedo, albedo * .82, albedo * .62],
        lightRGB.map(v => v * ilum), L, 0.04));
      sphere.canvas.style.width = SZ + 'px';

      /* ---------- geometry: N, L, theta, and the projection ---------- */
      const g = ctx2d(geom, GW, GH);
      const cx = GW / 2, cy = GH * 0.80, R = 92;

      g.strokeStyle = 'rgba(154,167,186,.55)'; g.lineWidth = 1.4;   // the surface
      g.beginPath(); g.moveTo(cx - 108, cy); g.lineTo(cx + 108, cy); g.stroke();
      g.strokeStyle = 'rgba(154,167,186,.28)'; g.lineWidth = 1;      // hatching under it
      for (let x = -104; x <= 100; x += 13) {
        g.beginPath(); g.moveTo(cx + x, cy); g.lineTo(cx + x - 6, cy + 7); g.stroke();
      }
      g.setLineDash([3, 4]); g.strokeStyle = 'rgba(154,167,186,.22)';  // unit circle: |N| = |L| = 1
      g.beginPath(); g.arc(cx, cy, R, Math.PI, 2 * Math.PI); g.stroke();
      g.setLineDash([]);

      const lx = cx + R * Math.sin(a), ly = cy - R * Math.cos(a);
      const projLen = R * Math.cos(a);                               // signed: negative when facing away

      // the projection of L onto N, drawn before the vectors so they sit on top
      if (projLen > 0) {
        g.strokeStyle = 'rgba(110,168,254,.85)'; g.lineWidth = 7; g.lineCap = 'butt';
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - projLen); g.stroke();
      }
      g.setLineDash([4, 4]); g.strokeStyle = 'rgba(232,236,243,.45)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(lx, ly); g.lineTo(cx, cy - projLen); g.stroke();
      g.setLineDash([]);

      arrow(g, cx, cy, cx, cy - R, css('--accent-3'), 2.6);          // N
      arrow(g, cx, cy, lx, ly, css('--accent-5'), 2.6);              // L

      // theta arc
      g.strokeStyle = 'rgba(232,236,243,.6)'; g.lineWidth = 1.3;
      g.beginPath(); g.arc(cx, cy, 30, -Math.PI / 2, -Math.PI / 2 + a, a < 0); g.stroke();

      g.font = '600 13px ' + css('--font'); g.textAlign = 'center';
      g.fillStyle = css('--accent-3'); g.fillText('N', cx, cy - R - 9);
      g.fillStyle = css('--accent-5');
      g.fillText('L', lx + 13 * Math.sign(Math.sin(a) || 1), ly - 8);
      g.fillStyle = 'rgba(232,236,243,.75)'; g.font = '12px ' + css('--font');
      g.fillText('θ', cx + 44 * Math.sin(a / 2), cy - 44 * Math.cos(a / 2) + 4);
      if (projLen > 0) {
        // parked well to the right of the theta arc so the two never collide
        g.fillStyle = css('--accent'); g.font = '600 12px ' + css('--mono');
        g.textAlign = 'left';
        g.fillText(`N·L = ${ndl.toFixed(2)}`, cx + 56, cy - projLen / 2 + 4);
      } else {
        g.fillStyle = css('--ink-faint'); g.font = '12px ' + css('--font');
        g.textAlign = 'center';
        g.fillText('N·L ≤ 0 — no light reaches it', cx, cy - R - 12);
      }

      /* ---------- the cos curve, with real axes ---------- */
      const p = ctx2d(curve, PW, PH);
      const m = { l: 34, r: 12, t: 16, b: 30 };
      const iw = PW - m.l - m.r, ih = PH - m.t - m.b;
      const X = d => m.l + (d + 130) / 260 * iw;
      const Y = v => m.t + ih - v * ih;

      p.strokeStyle = 'rgba(43,53,70,.9)'; p.lineWidth = 1;          // gridlines
      p.font = '10px ' + css('--mono'); p.fillStyle = css('--ink-faint');
      [0, 0.5, 1].forEach(v => {
        p.beginPath(); p.moveTo(m.l, Y(v)); p.lineTo(m.l + iw, Y(v)); p.stroke();
        p.textAlign = 'right'; p.fillText(v.toFixed(1), m.l - 6, Y(v) + 3);
      });
      p.textAlign = 'center';
      [-90, -45, 0, 45, 90].forEach(d => {
        p.beginPath(); p.moveTo(X(d), m.t + ih); p.lineTo(X(d), m.t + ih + 4); p.stroke();
        p.fillText(d + '°', X(d), m.t + ih + 16);
      });

      // shaded area under max(0, cos)
      p.beginPath(); p.moveTo(X(-130), Y(0));
      for (let d = -130; d <= 130; d += 2) p.lineTo(X(d), Y(Math.max(0, Math.cos(d * Math.PI / 180))));
      p.lineTo(X(130), Y(0)); p.closePath();
      p.fillStyle = 'rgba(110,168,254,.16)'; p.fill();
      p.beginPath();
      for (let d = -130; d <= 130; d += 2) {
        const y = Y(Math.max(0, Math.cos(d * Math.PI / 180)));
        d === -130 ? p.moveTo(X(d), y) : p.lineTo(X(d), y);
      }
      p.strokeStyle = css('--accent'); p.lineWidth = 2.2; p.stroke();

      // the current angle
      p.setLineDash([3, 3]); p.strokeStyle = 'rgba(232,236,243,.4)'; p.lineWidth = 1;
      p.beginPath(); p.moveTo(X(ang), Y(0)); p.lineTo(X(ang), Y(ndl));
      p.lineTo(m.l, Y(ndl)); p.stroke(); p.setLineDash([]);
      p.fillStyle = css('--accent-3');
      p.beginPath(); p.arc(X(ang), Y(ndl), 4.5, 0, 6.284); p.fill();
      p.fillStyle = css('--ink-faint'); p.font = '10px ' + css('--font');
      p.textAlign = 'left'; p.fillText('N·L', 4, m.t - 5);
      p.textAlign = 'center'; p.fillText('angle between N and L', m.l + iw / 2, PH - 4);

      readout.innerHTML = `<span class="mono">N·L = max(0, cos ${Math.abs(ang)}°) = ` +
        `<b style="color:var(--accent)">${ndl.toFixed(2)}</b></span> &nbsp;×&nbsp; ` +
        `<span class="mono">I<sub>L</sub> = <b style="color:var(--accent-5)">${ilum.toFixed(2)}</b></span> &nbsp;×&nbsp; ` +
        `<span class="mono">R = <b style="color:var(--accent-2)">${albedo.toFixed(2)}</b></span> &nbsp;=&nbsp; ` +
        `<span class="mono">I<sub>D</sub> = <b style="color:var(--accent-3)">${(ndl * ilum * albedo).toFixed(3)}</b></span>`;
    }
    paint();
    return () => { };
  };

  /* ---- 2b. Why recovering the world is underconstrained ----
     R and I_L are traded against each other with their product held fixed, so the
     rendered sphere is bit-for-bit identical at every slider position. */
  D.ambiguity = function (root) {
    const SZ = 180, PRODUCT = 0.45;          // R * I_L, held constant
    let R = 0.9;

    const surfSw = h('div', { class: 'swatch', style: 'height:52px;width:130px' });
    const lampBar = h('div', {
      style: 'height:52px;width:130px;border-radius:10px;border:1px solid var(--line)'
    });
    const worldCard = h('div', { class: 'card', style: 'padding:.7em .9em' }, [
      h('div', { class: 'chan-name', style: 'color:var(--ink-dim)' }, ['the world (unknown)']),
      h('div', { class: 'row', style: 'gap:.8em;align-items:flex-start' }, [
        h('div', { class: 'col', style: 'gap:.25em' }, [surfSw,
          h('div', { class: 'swatch-lbl' }, ['reflectance'])]),
        h('div', { class: 'col', style: 'gap:.25em' }, [lampBar,
          h('div', { class: 'swatch-lbl' }, ['illumination'])])
      ])
    ]);
    const img = figure('the image (measured)', SZ);
    const readout = h('div', { class: 'caption', style: 'margin-top:.5em' });

    root.appendChild(h('div', { class: 'row', style: 'gap:1.5em' }, [
      worldCard, h('div', { class: 'arrow' }, ['⟶']), img.wrap
    ]));
    root.appendChild(h('div', { class: 'controls-row' }, [
      slider('surface reflectance R', 0.25, 1.0, 0.01, R,
        v => { R = v; paint(); }, v => v.toFixed(2)).wrap
    ]));
    root.appendChild(readout);

    function paint() {
      const IL = PRODUCT / R;                 // compensate so R * IL never changes
      const dir = [0.42, 0.28, 0.86], n = Math.hypot(...dir), L = dir.map(v => v / n);
      IM.drawColor(img.canvas, IM.shadeSphere(SZ, [R, R * .9, R * .78], [IL, IL, IL], L, 0));
      img.canvas.style.width = SZ + 'px';

      const g = Math.round(255 * R);
      surfSw.style.background = `rgb(${g},${Math.round(g * .9)},${Math.round(g * .78)})`;
      // brightness of the lamp swatch tracks I_L, which runs from 0.45 up to 1.8
      const li = Math.min(1, IL / 1.8);
      lampBar.style.background =
        `radial-gradient(circle at 50% 45%, rgba(247,215,116,${0.15 + li * 0.85}) 0%, ` +
        `rgba(247,215,116,${li * 0.25}) 55%, rgba(14,17,23,1) 100%)`;

      readout.innerHTML =
        `<span class="mono">R = <b style="color:var(--accent-2)">${R.toFixed(2)}</b></span> &nbsp;×&nbsp; ` +
        `<span class="mono">I<sub>L</sub> = <b style="color:var(--accent-5)">${IL.toFixed(2)}</b></span> &nbsp;=&nbsp; ` +
        `<span class="mono"><b style="color:var(--accent-3)">${PRODUCT.toFixed(2)}</b></span>, always. ` +
        `Drag the slider: the world on the left changes a great deal, and <b>the image on the right does not change at all</b>.`;
    }
    paint();
    return () => { };
  };

  /* ---- 2c. The worksheet exercise: which parameter is changing? ---- */
  D.chessQuiz = function (root) {
    const CASES = [
      {
        img: 'chess1', mark: [0.463, 0.667],
        title: 'Image 1',
        answer: '<b style="color:var(--accent-5)">Illumination changes.</b> One flat square, one wood finish — ' +
          'so R and N are constant across the arrow. What changes is how much light lands there.'
      },
      {
        img: 'chess2', mark: [0.384, 0.698],
        title: 'Image 2',
        answer: '<b style="color:var(--accent-2)">Reflectance changes.</b> The arrow crosses from a light square ' +
          'to a dark one. Same flat board, same lighting — a different surface colour.'
      },
      {
        img: 'chess3', mark: [0.629, 0.719],
        title: 'Image 3',
        answer: '<b style="color:var(--accent-2)">Reflectance</b> and <b style="color:var(--accent-3)">surface ' +
          'normal</b> both change; the light source does not. The arrow leaves the flat board and climbs the ' +
          'curved base of the piece.'
      }
    ];
    let idx = 0, shown = false;

    const full = h('canvas', { style: 'width:430px' });
    const zoom = h('canvas', { style: 'width:190px' });
    const fullFig = h('div', { class: 'figure' }, [full, h('div', { class: 'caption' }, ['the scene'])]);
    const zoomFig = h('div', { class: 'figure' }, [zoom, h('div', { class: 'caption' }, ['the marked region, magnified'])]);
    const ansBox = h('div', { class: 'takeaway', style: 'min-height:2.6em' });
    const revealBtn = h('button', { class: 'btn' }, ['Reveal answer']);

    root.appendChild(h('div', { class: 'row', style: 'gap:1.2em;align-items:center' }, [fullFig, zoomFig]));
    root.appendChild(h('div', { class: 'controls-row' }, [
      buttons(CASES.map((c, i) => ({ label: c.title, value: i })),
        v => { idx = v; shown = false; render(); }, 0).wrap,
      revealBtn
    ]));
    root.appendChild(ansBox);
    revealBtn.addEventListener('click', () => { shown = !shown; render(); });

    const cache = {};
    function render() {
      const cse = CASES[idx];
      ansBox.innerHTML = shown ? cse.answer
        : '<b>Ask in order:</b> is this the same surface? is it facing the same way? is it getting the same light? ' +
        'At least one of R, N or I<sub>L</sub> has to move to explain the change — and sometimes more than one does.';
      revealBtn.textContent = shown ? 'Hide answer' : 'Reveal answer';
      revealBtn.classList.toggle('active', shown);

      const done = (im) => {
        IM.drawColor(full, im);
        const cx = cse.mark[0] * im.w, cy = cse.mark[1] * im.h, r = Math.round(im.w * 0.11);
        const x0 = Math.round(clamp(cx - r, 0, im.w - 2 * r)), y0 = Math.round(clamp(cy - r, 0, im.h - 2 * r));
        const n = 2 * r, sub = new Float32Array(n * n * 3);
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
          for (let c = 0; c < 3; c++) sub[(y * n + x) * 3 + c] = im.data[((y0 + y) * im.w + (x0 + x)) * 3 + c];
        IM.drawColor(zoom, { w: n, h: n, channels: 3, data: sub });
        // outline the magnified region on the full frame
        const g = full.getContext('2d');
        g.strokeStyle = '#7fd6a8'; g.lineWidth = 2; g.setLineDash([6, 4]);
        g.strokeRect(x0, y0, n, n); g.setLineDash([]);
      };
      if (cache[cse.img]) done(cache[cse.img]);
      else IMG(cse.img, 470).then(im => { cache[cse.img] = im; render(); });
    }
    render();
    return () => { };
  };

  /* ==================================================================
     PART 3 · FROM DESIGNED KERNELS TO LEARNED ONES
     ================================================================== */

  const digitImg = (d) => {
    const data = new Float32Array(28 * 28);
    for (let i = 0; i < 784; i++) data[i] = d.px[i];
    return { w: 28, h: 28, data };
  };
  const digitTensor = (d) => {
    const data = new Float32Array(28 * 28);
    for (let i = 0; i < 784; i++) data[i] = d.px[i] / 255;
    return { w: 28, h: 28, c: 1, data };
  };

  /* ---- 3a. What MNIST looks like ---- */
  D.mnistStrip = function (root) {
    const strip = h('div', { class: 'row', style: 'gap:.45em;flex-wrap:wrap' });
    root.appendChild(strip);
    const picks = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18];
    picks.forEach(i => {
      const d = CNN.digits[i];
      const cv = h('canvas', { style: 'width:74px;image-rendering:pixelated' });
      IM.draw(cv, digitImg(d), { min: 0, max: 255, cmap: IM.cmapBinary });
      strip.appendChild(h('div', { class: 'figure' }, [cv,
        h('div', { class: 'caption', style: 'margin-top:.25em' }, ['y = ' + d.label])]));
    });
    root.appendChild(snippet(
      '(train_images, train_labels), (test_images, test_labels) = keras.datasets.mnist.load_data()\n' +
      'train_images = train_images.astype(float) / 255' +
      '<span class="c">          # (60000, 28, 28) uint8 → float in [0, 1]</span>\n' +
      '<b>train_images = np.expand_dims(train_images, axis=-1)</b>' +
      '<span class="c">   # (60000, 28, 28, 1) — Keras wants a channel</span>'));
    return () => { };
  };

  /* ---- 3b. Flattening throws the geometry away ---- */
  D.flatten = function (root) {
    let perm = null, scrambled = false;
    const a = figure('the image a CNN sees', 150);
    const b = figure('the 784-vector an MLP sees', 150);
    const c = figure('', 150);
    const readout = h('div', { class: 'caption', style: 'margin-top:.35em' });

    root.appendChild(h('div', { class: 'row', style: 'gap:1.3em;align-items:flex-start' }, [
      a.wrap, h('div', { class: 'arrow' }, ['→']), b.wrap, h('div', { class: 'arrow' }, ['⇄']), c.wrap
    ]));
    root.appendChild(h('div', { class: 'controls-row' }, [
      h('button', { class: 'btn', onclick: () => { scrambled = !scrambled; draw(); } }, ['New shuffle'])
    ]));
    root.appendChild(readout);

    const d0 = CNN.digits[6];
    function draw() {
      const img = digitImg(d0);
      IM.draw(a.canvas, img, { min: 0, max: 255, cmap: IM.cmapBinary });
      a.canvas.style.width = '150px'; a.canvas.classList.add('pixelated');
      // the flattened vector, drawn as 28 rows of 28 laid end to end
      IM.draw(b.canvas, { w: 784, h: 1, data: img.data }, { min: 0, max: 255, cmap: IM.cmapBinary });
      b.canvas.style.width = '150px'; b.canvas.style.height = '26px';
      perm = perm && !scrambled ? perm : Array.from({ length: 784 }, (_, i) => i);
      if (scrambled) for (let i = 783; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[perm[i], perm[j]] = [perm[j], perm[i]]; }
      const sc = new Float32Array(784);
      for (let i = 0; i < 784; i++) sc[i] = img.data[perm[i]];
      IM.draw(c.canvas, { w: 28, h: 28, data: sc }, { min: 0, max: 255, cmap: IM.cmapBinary });
      c.canvas.style.width = '150px'; c.canvas.classList.add('pixelated');
      c.cap.textContent = scrambled
        ? 'the same 784 numbers, permuted' : 'not shuffled yet — press the button';
      readout.innerHTML = scrambled
        ? 'Apply that shuffle to <b>every</b> image and an MLP learns exactly as well — it never knew which pixels were neighbours. A conv layer would be destroyed.'
        : 'Press the button: shuffling the 784 entries costs the MLP nothing, because <b>Flatten</b> already discarded which pixels touch which.';
    }
    draw();
    return () => { };
  };

  /* ---- 3c. A convolution step, on an actual digit ---- */
  D.convStep = function (root) {
    let t = 0, timer = null, playing = true, fi = 0;
    const IN = 28, K = 5, OUT = IN - K + 1;
    const inCv = h('canvas', { class: 'pixelated', style: 'width:200px' });
    const kCv = h('canvas', { class: 'pixelated', style: 'width:80px' });
    const outCv = h('canvas', { class: 'pixelated', style: 'width:200px' });
    const readout = h('div', { class: 'caption', style: 'margin-top:.4em' });

    root.appendChild(h('div', { class: 'row', style: 'gap:1.1em;align-items:center' }, [
      h('div', { class: 'figure' }, [inCv, h('div', { class: 'caption' }, ['input 28×28×1'])]),
      h('div', { class: 'arrow' }, ['✳']),
      h('div', { class: 'figure' }, [kCv, h('div', { class: 'caption' }, ['one learned 5×5 kernel'])]),
      h('div', { class: 'arrow' }, ['=']),
      h('div', { class: 'figure' }, [outCv, h('div', { class: 'caption' }, ['activation map 24×24'])])
    ]));
    const playBtn = h('button', { class: 'btn active' }, ['❚❚  Pause']);
    root.appendChild(h('div', { class: 'controls-row' }, [
      playBtn,
      buttons(Array.from({ length: 8 }, (_, i) => ({ label: 'filter ' + i, value: i })),
        v => { fi = v; t = 0; render(); }, 0).wrap
    ]));
    root.appendChild(readout);
    playBtn.addEventListener('click', () => {
      playing = !playing;
      playBtn.textContent = playing ? '❚❚  Pause' : '▶  Play';
      playBtn.classList.toggle('active', playing);
    });

    const d0 = CNN.digits[8];
    const x = digitTensor(d0);

    function render() {
      // the whole activation map, but only revealed up to the current position
      const full = IM.relu(IM.conv2dValid(x, CNN.W1, CNN.b1, 5, 8));
      const fm = IM.slice(full, fi);
      const shown = new Float32Array(OUT * OUT).fill(NaN);
      const upto = Math.min(OUT * OUT - 1, Math.floor(t));
      let mx = 1e-6;
      for (let i = 0; i < fm.data.length; i++) mx = Math.max(mx, fm.data[i]);
      for (let i = 0; i <= upto; i++) shown[i] = fm.data[i];
      for (let i = upto + 1; i < shown.length; i++) shown[i] = 0;

      IM.draw(inCv, digitImg(d0), { min: 0, max: 255, cmap: IM.cmapBinary });
      // highlight the 5x5 window
      const oy = Math.floor(upto / OUT), ox = upto % OUT;
      const g = inCv.getContext('2d');
      g.strokeStyle = css('--accent-2'); g.lineWidth = 0.9;
      g.strokeRect(ox, oy, K, K);
      g.fillStyle = 'rgba(242,166,90,.22)'; g.fillRect(ox, oy, K, K);

      // the kernel itself
      const kd = new Float32Array(25);
      for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) kd[j * 5 + i] = CNN.W1[((j * 5 + i) * 1) * 8 + fi];
      let km = 0; for (let i = 0; i < 25; i++) km = Math.max(km, Math.abs(kd[i]));
      IM.draw(kCv, { w: 5, h: 5, data: kd }, { min: -km, max: km });

      IM.draw(outCv, { w: OUT, h: OUT, data: shown }, { min: 0, max: mx, cmap: IM.cmapHeat });

      readout.innerHTML = `The kernel never changes — only where it sits. ` +
        `Position <span class="mono">(${oy}, ${ox})</span> of ${OUT}×${OUT}. ` +
        `<b>The 25 weights in that little matrix are what training chooses.</b>`;
    }

    timer = setInterval(() => {
      if (playing) { t += 7; if (t >= OUT * OUT) t = 0; render(); }
    }, 40);
    render();
    return () => clearInterval(timer);
  };

  /* ---- 3d. Max pooling, with the numbers visible ---- */
  D.pooling = function (root) {
    const N = 8;
    const vals = [];
    for (let y = 0; y < N; y++) { vals.push([]); for (let x = 0; x < N; x++) vals[y].push(Math.round(Math.random() * 90) / 10); }
    const S = 34;

    function grid(v, n, hot) {
      const wrap = svgEl('svg', { width: n * S, height: n * S, viewBox: `0 0 ${n * S} ${n * S}` });
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const isHot = hot && hot(y, x);
        wrap.appendChild(svgEl('rect', {
          x: x * S, y: y * S, width: S - 2, height: S - 2, rx: 4,
          fill: isHot ? 'rgba(127,214,168,.28)' : '#141924', stroke: isHot ? '#7fd6a8' : '#2b3546', 'stroke-width': 1
        }));
        const t = svgEl('text', {
          x: x * S + (S - 2) / 2, y: y * S + (S - 2) / 2 + 4, 'text-anchor': 'middle',
          'font-size': 11, fill: isHot ? '#7fd6a8' : '#8fa0b8'
        });
        t.textContent = v[y][x].toFixed(1);
        wrap.appendChild(t);
      }
      // 2x2 block separators
      if (n === N) for (let i = 2; i < n; i += 2) {
        wrap.appendChild(svgEl('line', { x1: i * S - 1, y1: 0, x2: i * S - 1, y2: n * S, stroke: '#3d4a60', 'stroke-width': 1.5 }));
        wrap.appendChild(svgEl('line', { x1: 0, y1: i * S - 1, x2: n * S, y2: i * S - 1, stroke: '#3d4a60', 'stroke-width': 1.5 }));
      }
      return wrap;
    }

    const out = [], winners = new Set();
    for (let y = 0; y < N / 2; y++) {
      out.push([]);
      for (let x = 0; x < N / 2; x++) {
        let m = -1, my = 0, mx = 0;
        for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
          if (vals[y * 2 + j][x * 2 + i] > m) { m = vals[y * 2 + j][x * 2 + i]; my = y * 2 + j; mx = x * 2 + i; }
        }
        out[y].push(m); winners.add(my * N + mx);
      }
    }

    root.appendChild(h('div', { class: 'row', style: 'gap:1.6em' }, [
      h('div', { class: 'figure' }, [grid(vals, N, (y, x) => winners.has(y * N + x)),
      h('div', { class: 'caption' }, ['8×8 activation map — each 2×2 block outlined'])]),
      h('div', { class: 'arrow' }, ['→']),
      h('div', { class: 'figure' }, [grid(out, N / 2),
      h('div', { class: 'caption' }, ['4×4 after MaxPooling2D((2, 2))'])])
    ]));
    root.appendChild(h('div', { class: 'caption', style: 'margin-top:.5em;text-align:center' }, [
      'Stride 2 with a 2×2 window means the blocks do not overlap — so three quarters of the numbers are dropped.'
    ]));
    return () => { };
  };

  /* ---- 3e. The eight learned first-layer filters ---- */
  D.learnedFilters = function (root) {
    const wrap = h('div', { class: 'filtgrid' });
    for (let f = 0; f < 8; f++) {
      const kd = new Float32Array(25);
      for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) kd[j * 5 + i] = CNN.W1[(j * 5 + i) * 8 + f];
      // stretch each filter over its own range, so the weak ones are still readable
      let m = 1e-6;
      for (let i = 0; i < 25; i++) m = Math.max(m, Math.abs(kd[i]));
      const cv = h('canvas', { class: 'pixelated', style: 'width:84px' });
      IM.draw(cv, { w: 5, h: 5, data: kd }, { min: -m, max: m });
      wrap.appendChild(h('div', { class: 'figure' }, [cv,
        h('div', { class: 'caption', style: 'margin-top:.25em' }, [`filter ${f}  ·  ±${m.toFixed(2)}`])]));
    }
    root.appendChild(wrap);
    root.appendChild(h('div', { class: 'caption', style: 'margin-top:.6em;text-align:center' }, [
      'Nobody typed these numbers — gradient descent chose them. Black = most negative weight, white = most positive; ' +
      'each filter is stretched over its own range, so ± is that filter\'s largest weight.'
    ]));
    return () => { };
  };

  /* ---- 3f. The whole network, running live ---- */
  D.cnnLive = function (root) {
    let di = 0;
    const inCv = h('canvas', { class: 'pixelated', style: 'width:104px' });
    const l1 = h('div', { class: 'row', style: 'gap:3px;flex-wrap:wrap;max-width:210px' });
    const l2 = h('div', { class: 'row', style: 'gap:3px;flex-wrap:wrap;max-width:210px' });
    const probs = h('div', { class: 'probs', style: 'min-width:14em' });
    const readout = h('div', { class: 'caption', style: 'margin-top:.5em' });

    const box = (title, sub, kid) => h('div', { class: 'figure' }, [
      kid, h('div', { class: 'caption' }, [h('b', {}, [title]), h('br'), sub])
    ]);

    root.appendChild(h('div', { class: 'row', style: 'gap:.9em;align-items:center' }, [
      box('input', '28×28×1', inCv),
      h('div', { class: 'arrow' }, ['→']),
      box('conv 1 + pool', '8 maps, 12×12', l1),
      h('div', { class: 'arrow' }, ['→']),
      box('conv 2 + pool', '16 maps, 4×4', l2),
      h('div', { class: 'arrow' }, ['→']),
      box('softmax', '10 probabilities', probs)
    ]));
    root.appendChild(h('div', { class: 'controls-row' }, [
      h('button', { class: 'btn', onclick: () => { di = (di + 1) % CNN.digits.length; run(); } }, ['Next digit ›']),
      h('button', { class: 'btn', onclick: () => { di = (Math.random() * CNN.digits.length) | 0; run(); } }, ['Random'])
    ]));
    root.appendChild(readout);

    function mapsInto(container, tensor, px) {
      container.innerHTML = '';
      let m = 1e-6;
      for (let i = 0; i < tensor.data.length; i++) m = Math.max(m, tensor.data[i]);
      for (let c = 0; c < tensor.c; c++) {
        const cv = h('canvas', { class: 'pixelated', style: `width:${px}px` });
        IM.draw(cv, IM.slice(tensor, c), { min: 0, max: m, cmap: IM.cmapHeat });
        container.appendChild(cv);
      }
    }

    function run() {
      const d = CNN.digits[di];
      IM.draw(inCv, digitImg(d), { min: 0, max: 255, cmap: IM.cmapBinary });
      const x = digitTensor(d);
      const p1 = IM.maxpool2(IM.relu(IM.conv2dValid(x, CNN.W1, CNN.b1, 5, 8)));
      const p2 = IM.maxpool2(IM.relu(IM.conv2dValid(p1, CNN.W2, CNN.b2, 5, 16)));
      const pr = IM.denseSoftmax(p2, CNN.W3, CNN.b3, 10);
      mapsInto(l1, p1, 46);
      mapsInto(l2, p2, 30);

      const best = pr.indexOf(Math.max(...pr));
      probs.innerHTML = '';
      for (let k = 0; k < 10; k++) {
        const win = k === best;
        const row = h('div', { class: 'probs', style: 'display:contents' });
        const cls = win ? 'win' : '';
        probs.appendChild(h('span', { class: 'd ' + cls }, [String(k)]));
        const bar = h('div', { class: 'bar', style: `width:${(pr[k] * 100).toFixed(1)}%` });
        probs.appendChild(h('div', { class: 'bar-wrap ' + cls }, [bar]));
        probs.appendChild(h('span', { class: 'v ' + cls }, [pr[k] < 0.001 ? '<0.1%' : (pr[k] * 100).toFixed(1) + '%']));
        if (win) { probs.children[probs.children.length - 3].classList.add('win'); bar.style.background = css('--accent-3'); probs.lastChild.style.color = css('--accent-3'); }
      }
      readout.innerHTML = `True label <b>${d.label}</b> · predicted <b style="color:var(--accent-3)">${best}</b>` +
        ` — computed in your browser from the 5,994 trained weights, no server involved.`;
    }
    run();
    return () => { };
  };

  /* ---- 3g. ReLU and softmax ---- */
  D.activations = function (root) {
    const reluCv = h('canvas', { class: 'plot' });
    const smCv = h('div', { class: 'probs', style: 'min-width:15em' });
    let temp = 1.0;
    const logits = [0.4, -1.2, 2.9, 0.1, -0.6, 1.4, -2.0, 3.4, 0.9, -0.3];

    root.appendChild(h('div', { class: 'row', style: 'gap:2em;align-items:center' }, [
      h('div', { class: 'figure' }, [reluCv, h('div', { class: 'caption' }, [
        'ReLU(z) = max(0, z) — keeps positive evidence, discards the rest'])]),
      h('div', { class: 'figure' }, [smCv, h('div', { class: 'caption', style: 'margin-top:.6em' }, [
        'softmax turns 10 raw scores into 10 numbers that sum to 1'])])
    ]));
    root.appendChild(h('div', { class: 'controls-row' }, [
      slider('scale the scores', 0.25, 3, 0.05, temp, v => { temp = v; draw(); }, v => '×' + v.toFixed(2)).wrap
    ]));

    function draw() {
      const xs = [], ys = [], id = [];
      for (let i = 0; i <= 100; i++) { const z = -4 + i * 0.08; xs.push(z); ys.push(Math.max(0, z)); id.push(z); }
      plot(reluCv, 300, 150, [
        { y: id, color: 'rgba(107,119,137,.5)', width: 1.4, dash: [4, 4] },
        { y: ys, color: css('--accent-3'), width: 2.6 }
      ], { min: -4, max: 4 });

      const z = logits.map(v => v * temp);
      const mx = Math.max(...z), e = z.map(v => Math.exp(v - mx)), s = e.reduce((a, b) => a + b);
      const p = e.map(v => v / s), best = p.indexOf(Math.max(...p));
      smCv.innerHTML = '';
      p.forEach((v, k) => {
        const win = k === best;
        smCv.appendChild(h('span', { class: 'd' + (win ? ' win' : ''), style: win ? 'color:var(--accent-3);font-weight:600' : '' }, [String(k)]));
        smCv.appendChild(h('div', { class: 'bar-wrap' }, [h('div', {
          class: 'bar', style: `width:${(v * 100).toFixed(1)}%;background:${win ? css('--accent-3') : css('--accent')}`
        })]));
        smCv.appendChild(h('span', { class: 'v', style: win ? 'color:var(--accent-3)' : '' }, [(v * 100).toFixed(1) + '%']));
      });
    }
    draw();
    return () => { };
  };

  /* ---- 3h. Why rescale the inputs ----
     Loss L(u,v) = u^2 + b*v^2, where b is how much more strongly one weight
     affects the loss than the other. Gradient descent with a single step size
     multiplies u by (1 - 2*lr) and v by (1 - 2*lr*b) each iteration — so one
     learning rate cannot suit both directions unless b is close to 1. */
  D.normalise = function (root) {
    let scaled = false;
    const LR = 0.075;                    // same step size in both cases, deliberately
    const cv = h('canvas', { class: 'plot' });
    const cap = h('div', { class: 'caption' }, ['']);
    const fig = h('div', { class: 'figure' }, [cv, cap]);
    root.appendChild(h('div', { class: 'row' }, [fig]));
    const btn = h('button', { class: 'btn' }, ['Rescale inputs to [0, 1]']);
    root.appendChild(h('div', { class: 'controls-row' }, [btn]));
    const readout = h('div', { class: 'caption', style: 'margin-top:.4em;text-align:center' });
    root.appendChild(readout);
    btn.addEventListener('click', () => { scaled = !scaled; btn.classList.toggle('active', scaled); draw(); });

    function draw() {
      const W = 520, H = 312, dpr = 2, RX = 142;
      cv.width = W * dpr; cv.height = H * dpr;
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);

      const b = scaled ? 1 : 12;         // curvature ratio between the two weights
      const cx = W / 2, cy = H / 2;
      const RY = RX / Math.sqrt(b);      // the outermost contour always fits the box
      for (let k = 6; k >= 1; k--) {
        g.beginPath();
        g.ellipse(cx, cy, RX * k / 6, RY * k / 6, 0, 0, 6.284);
        g.strokeStyle = `rgba(110,168,254,${0.10 + k * 0.045})`; g.lineWidth = 1.2; g.stroke();
      }

      let u = -0.95, v = -0.95 / Math.sqrt(b);          // start on the outer contour
      g.beginPath(); g.strokeStyle = css('--accent-2'); g.lineWidth = 2;
      g.moveTo(cx + u * RX, cy + v * RX);
      for (let i = 0; i < 70; i++) {
        u *= (1 - 2 * LR);
        v *= (1 - 2 * LR * b);
        g.lineTo(cx + u * RX, cy + v * RX);
      }
      g.stroke();
      g.fillStyle = css('--accent-3');
      g.beginPath(); g.arc(cx, cy, 5, 0, 6.284); g.fill();

      cap.innerHTML = scaled
        ? 'inputs in <b>[0, 1]</b> — both weights on the same scale'
        : 'inputs in <b>[0, 255]</b> — one weight matters 12× more than the other';
      readout.innerHTML = scaled
        ? 'Round contours: <b>one step size suits every direction</b>, and the path heads almost straight for the minimum.'
        : 'The step that is safe in the steep direction bounces, while the shallow direction crawls — <b>same learning rate, both wrong</b>.';
    }
    draw();
    return () => { };
  };

  /* ==================================================================
     mounting / lifecycle
     ================================================================== */
  function mount(scope) {
    scope.querySelectorAll('.demo[data-demo]').forEach(el => {
      if (el.dataset.mounted) return;
      const fn = D[el.dataset.demo];
      if (!fn) { el.innerHTML = '<div class="caption">missing demo: ' + el.dataset.demo + '</div>'; return; }
      el.dataset.mounted = '1';
      try { running.set(el, fn(el) || (() => { })); }
      catch (e) { console.error('demo', el.dataset.demo, e); }
    });
  }

  global.Demos = {
    mount,
    mountVisible() {
      const cur = document.querySelector('.reveal .slides section.present');
      if (cur) mount(cur);
    }
  };
})(window);
