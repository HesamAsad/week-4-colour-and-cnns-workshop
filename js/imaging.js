/* ------------------------------------------------------------------
   imaging.js — the toolkit behind every Workshop 4 demo.

   Three groups:
     1. loading / drawing            (same shapes as the Workshop 3 deck)
     2. colour science               sRGB <-> linear <-> XYZ <-> Lab, HSV,
                                     and spectrum -> tristimulus
     3. neural-net forward pass      conv / relu / maxpool / dense / softmax

   Everything is plain Float32Array + {w, h, channels}. No dependencies,
   works from file://
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  /* ================================================================
     1 · LOADING AND DRAWING
     ================================================================ */

  const _cache = new Map();

  function loadColor(dataURL, size) {
    // Key on the WHOLE data URI. Truncating it collides: every image here is a
    // JPEG written by the same encoder, so the first 64 characters are an
    // identical header and all of them would share one cache entry.
    const key = 'rgb:' + size + ':' + dataURL;
    if (_cache.has(key)) return _cache.get(key);
    const p = new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        const scale = size / Math.max(im.naturalWidth, im.naturalHeight);
        const w = Math.max(1, Math.round(im.naturalWidth * scale));
        const h = Math.max(1, Math.round(im.naturalHeight * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(im, 0, 0, im.naturalWidth, im.naturalHeight, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        const rgb = new Float32Array(w * h * 3);
        for (let i = 0; i < w * h; i++) {
          rgb[i * 3] = d[i * 4];
          rgb[i * 3 + 1] = d[i * 4 + 1];
          rgb[i * 3 + 2] = d[i * 4 + 2];
        }
        resolve({ w, h, channels: 3, data: rgb });
      };
      im.src = dataURL;
    });
    _cache.set(key, p);
    return p;
  }

  function toGray(img) {
    if (img.channels !== 3) return img;
    const g = new Float32Array(img.w * img.h);
    for (let i = 0; i < g.length; i++) {
      g[i] = 0.299 * img.data[i * 3] +
        0.587 * img.data[i * 3 + 1] + 0.114 * img.data[i * 3 + 2];
    }
    return { w: img.w, h: img.h, data: g };
  }

  // Draw a single-channel buffer. Auto-stretches to [0,255] unless a range
  // is given; `clip` clamps instead; `cmap` maps through a colour ramp.
  function draw(canvas, img, opts) {
    opts = opts || {};
    const { w, h, data } = img;
    let lo = opts.min, hi = opts.max;
    if (lo === undefined || hi === undefined) {
      if (opts.clip) { lo = 0; hi = 255; }
      else {
        lo = Infinity; hi = -Infinity;
        for (let i = 0; i < data.length; i++) {
          if (data[i] < lo) lo = data[i];
          if (data[i] > hi) hi = data[i];
        }
        if (hi - lo < 1e-9) hi = lo + 1;
      }
    }
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const out = ctx.createImageData(w, h);
    const scale = 255 / (hi - lo);
    for (let i = 0; i < w * h; i++) {
      let v = (data[i] - lo) * scale;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      if (opts.cmap) {
        const c = opts.cmap(v / 255);
        out.data[i * 4] = c[0]; out.data[i * 4 + 1] = c[1]; out.data[i * 4 + 2] = c[2];
      } else {
        out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
      }
      out.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }

  function drawColor(canvas, img) {
    const { w, h, data } = img;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const out = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      for (let c = 0; c < 3; c++) {
        const v = data[i * 3 + c];
        out.data[i * 4 + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      out.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }

  // matplotlib's "binary" colormap: 0 -> white, 1 -> black. The worksheet
  // draws MNIST with cmap='binary', so the deck matches what students see.
  const cmapBinary = (t) => { const v = Math.round(255 * (1 - t)); return [v, v, v]; };

  // A perceptually-ordered ramp for activation maps (dark blue -> orange -> white).
  function cmapHeat(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const stops = [[14, 17, 23], [30, 58, 110], [110, 90, 180],
    [214, 110, 120], [242, 166, 90], [255, 246, 214]];
    const f = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f)), u = f - i;
    return [0, 1, 2].map(c => Math.round(stops[i][c] + u * (stops[i + 1][c] - stops[i][c])));
  }

  /* ================================================================
     2 · COLOUR SCIENCE

     The pipeline is the real one: sRGB is gamma-encoded, so it must be
     linearised before any physically meaningful matrix is applied.
     (OpenCV's COLOR_*2XYZ skips that step — see the "gotchas" slide.)
     ================================================================ */

  const srgb2lin = (c) => {                      // c in [0,1]
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lin2srgb = (c) => {
    c = c < 0 ? 0 : c > 1 ? 1 : c;
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };

  // sRGB primaries, D65 white point (the matrix OpenCV also uses).
  const M_RGB2XYZ = [0.412453, 0.357580, 0.180423,
    0.212671, 0.715160, 0.072169,
    0.019334, 0.119193, 0.950227];
  const M_XYZ2RGB = [3.240479, -1.537150, -0.498535,
    -0.969256, 1.875992, 0.041556,
    0.055648, -0.204043, 1.057311];
  const WHITE = [0.950456, 1.0, 1.088754];       // D65

  function mat3(M, a, b, c) {
    return [M[0] * a + M[1] * b + M[2] * c,
    M[3] * a + M[4] * b + M[5] * c,
    M[6] * a + M[7] * b + M[8] * c];
  }

  // rgb in 0..255 -> XYZ (Y in 0..1). `linearise=false` reproduces OpenCV.
  function rgb2xyz(r, g, b, linearise) {
    let R = r / 255, G = g / 255, B = b / 255;
    if (linearise !== false) { R = srgb2lin(R); G = srgb2lin(G); B = srgb2lin(B); }
    return mat3(M_RGB2XYZ, R, G, B);
  }

  function xyz2rgb(X, Y, Z, linearise) {
    let [R, G, B] = mat3(M_XYZ2RGB, X, Y, Z);
    if (linearise !== false) { R = lin2srgb(R); G = lin2srgb(G); B = lin2srgb(B); }
    else { R = Math.min(1, Math.max(0, R)); G = Math.min(1, Math.max(0, G)); B = Math.min(1, Math.max(0, B)); }
    return [R * 255, G * 255, B * 255];
  }

  const _f = (t) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  const _fi = (t) => t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787;

  // L* in 0..100, a*/b* roughly -128..127
  function xyz2lab(X, Y, Z) {
    const fx = _f(X / WHITE[0]), fy = _f(Y / WHITE[1]), fz = _f(Z / WHITE[2]);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function lab2xyz(L, a, b) {
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    return [_fi(fx) * WHITE[0], _fi(fy) * WHITE[1], _fi(fz) * WHITE[2]];
  }
  const rgb2lab = (r, g, b) => xyz2lab(...rgb2xyz(r, g, b));
  const lab2rgb = (L, a, b) => xyz2rgb(...lab2xyz(L, a, b));

  // Linear (pre-gamma) sRGB for a Lab colour. Components outside [0,1] mean the
  // colour is outside the sRGB gamut — test here, before lin2srgb clamps it,
  // or everything looks in-gamut. Callers that need both the colour and the
  // gamut answer should use this once rather than calling both helpers.
  const lab2linRGB = (L, a, b) => mat3(M_XYZ2RGB, ...lab2xyz(L, a, b));
  const inGamut = (lin) => lin[0] >= -0.002 && lin[0] <= 1.002 &&
    lin[1] >= -0.002 && lin[1] <= 1.002 &&
    lin[2] >= -0.002 && lin[2] <= 1.002;
  const labInGamut = (L, a, b) => inGamut(lab2linRGB(L, a, b));

  // H in 0..360, S and V in 0..1  (OpenCV stores H/2 in a byte — see gotchas)
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d > 1e-9) {
      if (mx === r) h = 60 * (((g - b) / d) % 6);
      else if (mx === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return [h, mx < 1e-9 ? 0 : d / mx, mx];
  }
  function hsv2rgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    const t = Math.floor(h / 60);
    const tab = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][t];
    return [(tab[0] + m) * 255, (tab[1] + m) * 255, (tab[2] + m) * 255];
  }

  /* ---- whole-image helpers ---- */

  // fn(r,g,b) -> [a,b,c]; returns a 3-channel image of the transformed values
  function mapPixels(img, fn) {
    const out = new Float32Array(img.w * img.h * 3);
    for (let i = 0; i < img.w * img.h; i++) {
      const v = fn(img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2]);
      out[i * 3] = v[0]; out[i * 3 + 1] = v[1]; out[i * 3 + 2] = v[2];
    }
    return { w: img.w, h: img.h, channels: 3, data: out };
  }

  function channel(img, c) {
    const out = new Float32Array(img.w * img.h);
    for (let i = 0; i < out.length; i++) out[i] = img.data[i * 3 + c];
    return { w: img.w, h: img.h, data: out };
  }

  /* ---- spectrum -> tristimulus ----
     I_R = integral of I(lambda) * S_R(lambda) d(lambda), summed over the CIE
     table. This is the lecture's trichromatic response equation, discretised. */
  function spectrumToXYZ(spd) {
    const C = global.CIE;
    let X = 0, Y = 0, Z = 0, n = 0;
    for (let i = 0; i < C.lambda.length; i++) {
      X += spd[i] * C.x[i]; Y += spd[i] * C.y[i]; Z += spd[i] * C.z[i];
      n += C.y[i];
    }
    return [X / n, Y / n, Z / n];
  }

  // XYZ of a colour, scaled so the brightest channel is displayable
  function xyzToSwatch(X, Y, Z, gain) {
    gain = gain || 1;
    let [r, g, b] = xyz2rgb(X * gain, Y * gain, Z * gain);
    const m = Math.max(r, g, b, 255);
    return [r * 255 / m, g * 255 / m, b * 255 / m];
  }

  // Approximate sRGB for a single wavelength — used to paint the spectrum axis.
  function wavelengthRGB(nm) {
    const C = global.CIE, i = Math.round((nm - C.lambda[0]) / 5);
    if (i < 0 || i >= C.lambda.length) return [0, 0, 0];
    return xyzToSwatch(C.x[i], C.y[i], C.z[i]);
  }

  /* ================================================================
     3 · SHADING — the diffuse (Lambertian) reflectance model
                   I_D(x) = I_L * R * (N(x) · L)
     ================================================================ */

  // Render a sphere lit by one directional source. albedo = [r,g,b] in 0..1,
  // light = [r,g,b] intensity, dir = unit 3-vector towards the light.
  function shadeSphere(size, albedo, light, dir, ambient, opts) {
    opts = opts || {};
    const out = new Float32Array(size * size * 3);
    const R = size * 0.42, cx = size / 2, cy = size / 2;
    const bg = opts.bg === undefined ? 16 : opts.bg;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const dx = (x - cx) / R, dy = (y - cy) / R;
        const r2 = dx * dx + dy * dy;
        if (r2 > 1) { out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = bg; continue; }
        const nz = Math.sqrt(1 - r2);            // sphere normal, +z towards viewer
        let ndotl = dx * dir[0] + (-dy) * dir[1] + nz * dir[2];
        if (ndotl < 0) ndotl = 0;                // self-shadowed
        for (let c = 0; c < 3; c++) {
          const v = light[c] * albedo[c] * ndotl + (ambient || 0) * albedo[c];
          out[i * 3 + c] = Math.min(255, 255 * v);
        }
      }
    }
    return { w: size, h: size, channels: 3, data: out };
  }

  /* ================================================================
     4 · NEURAL-NET FORWARD PASS
        Enough to run the worksheet's CNN live: valid conv, ReLU,
        2x2 max pool, dense, softmax.
     ================================================================ */

  // x: {w,h,c,data} with data laid out [y][x][channel] (Keras "channels_last").
  // W is a flat (kh, kw, Cin, Cout) array, matching Keras kernel order.
  function conv2dValid(x, W, b, k, cout) {
    const OH = x.h - k + 1, OW = x.w - k + 1, cin = x.c;
    const out = new Float32Array(OH * OW * cout);
    for (let oy = 0; oy < OH; oy++) {
      for (let ox = 0; ox < OW; ox++) {
        for (let o = 0; o < cout; o++) {
          let s = b[o];
          for (let j = 0; j < k; j++) {
            for (let i = 0; i < k; i++) {
              const xbase = ((oy + j) * x.w + (ox + i)) * cin;
              const wbase = ((j * k + i) * cin) * cout + o;
              for (let c = 0; c < cin; c++) s += x.data[xbase + c] * W[wbase + c * cout];
            }
          }
          out[(oy * OW + ox) * cout + o] = s;
        }
      }
    }
    return { w: OW, h: OH, c: cout, data: out };
  }

  function relu(x) {
    const d = new Float32Array(x.data.length);
    for (let i = 0; i < d.length; i++) d[i] = x.data[i] > 0 ? x.data[i] : 0;
    return { w: x.w, h: x.h, c: x.c, data: d };
  }

  function maxpool2(x) {
    const OH = x.h >> 1, OW = x.w >> 1;
    const out = new Float32Array(OH * OW * x.c);
    for (let oy = 0; oy < OH; oy++)
      for (let ox = 0; ox < OW; ox++)
        for (let c = 0; c < x.c; c++) {
          let m = -Infinity;
          for (let j = 0; j < 2; j++)
            for (let i = 0; i < 2; i++)
              m = Math.max(m, x.data[((oy * 2 + j) * x.w + (ox * 2 + i)) * x.c + c]);
          out[(oy * OW + ox) * x.c + c] = m;
        }
    return { w: OW, h: OH, c: x.c, data: out };
  }

  function denseSoftmax(x, W, b, units) {
    const n = x.data.length, z = new Float32Array(units);
    for (let o = 0; o < units; o++) {
      let s = b[o];
      for (let i = 0; i < n; i++) s += x.data[i] * W[i * units + o];
      z[o] = s;
    }
    let mx = -Infinity;
    for (let o = 0; o < units; o++) mx = Math.max(mx, z[o]);
    let sum = 0;
    for (let o = 0; o < units; o++) { z[o] = Math.exp(z[o] - mx); sum += z[o]; }
    for (let o = 0; o < units; o++) z[o] /= sum;
    return z;
  }

  // Pull one channel of a {w,h,c} tensor out as a drawable single-channel image.
  function slice(x, c) {
    const d = new Float32Array(x.w * x.h);
    for (let i = 0; i < d.length; i++) d[i] = x.data[i * x.c + c];
    return { w: x.w, h: x.h, data: d };
  }

  global.IM = {
    loadColor, toGray, draw, drawColor, mapPixels, channel, cmapBinary, cmapHeat,
    srgb2lin, lin2srgb, rgb2xyz, xyz2rgb, xyz2lab, lab2xyz, rgb2lab, lab2rgb,
    lab2linRGB, inGamut, labInGamut,
    rgb2hsv, hsv2rgb, spectrumToXYZ, xyzToSwatch, wavelengthRGB,
    shadeSphere, conv2dValid, relu, maxpool2, denseSoftmax, slice
  };
})(window);
