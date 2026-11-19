// Arena game client: loads GLB models + layout.json, bakes the static map, runs movement, collision and shooting.
(function () {
'use strict';
const $ = id => document.getElementById(id), BASE = 'assets/';
function fail(msg) { const l = $('loading'); l.hidden = false; l.classList.add('err'); $('loadText').textContent = msg; }
window.addEventListener('error', e => fail('שגיאה: ' + (e.message || '')));
window.addEventListener('unhandledrejection', e => fail('שגיאה: ' + ((e.reason && e.reason.message) || e.reason || '')));

async function boot() {
  // =====================================================================================================
  // m1: themed arenas. Every map is small (you see about a third of it), point-symmetric, with bushes to hide in.
  // The layout is abstract (wall / low / box / rock / bush); each theme decides how those look.
  // =====================================================================================================
  const GAME_MODE = window.GAME_MODE || 'city';
  const THEMES = {
    city: { name: 'רחובות העיר', ground: ['#4a5560', [['#55555b', 60, 26, .1], ['#2c2c30', 70, 22, .12], ['#6c6c72', 5200, 1.1, .5], ['#232327', 5200, 1.2, .55]]], outside: ['#b08a5e', [['#c29d6f', 50, 30, .12], ['#8c6c47', 3000, 1.3, .4]]], sky: 0xbfe4ff, hemi: [0xffffff, 0xb9a88f, .62], sun: 0xfff6e6, paint: 'rgba(255,255,255,.5)' },
    forest: { name: 'היער', ground: ['#5f9440', [['#6ea64c', 90, 30, .2], ['#527f36', 90, 26, .22], ['#86bb5c', 5000, 1.2, .45], ['#47722f', 5000, 1.3, .45], ['#8a6a44', 200, 2.4, .3]]], outside: ['#3f7030', [['#4c8239', 60, 30, .2], ['#2f5a24', 2000, 1.4, .5]]], sky: 0xa9dcff, hemi: [0xf2fff0, 0x4f6f3f, .74], sun: 0xfff1d0, paint: 'rgba(255,255,230,.45)' },
    beach: { name: 'חוף הים', ground: ['#ecd49f', [['#f4e0b4', 80, 30, .22], ['#dcc085', 80, 26, .22], ['#fff4d6', 5000, 1, .45], ['#c9ab73', 4000, 1.1, .4]]], outside: null, sky: 0x8fd8ff, hemi: [0xffffff, 0xd8c08f, .76], sun: 0xfff1d8, paint: 'rgba(255,255,255,.6)' },
    desert: { name: 'הקניון', ground: ['#d9a066', []], outside: ['#c98f58', [['#d9a066', 60, 30, .2], ['#b07a45', 2000, 1.4, .5]]], sky: 0xffd9a8, hemi: [0xfff1dd, 0xa0704a, .74], sun: 0xffe2b8, paint: 'rgba(255,240,210,.6)' },
  };
  const THEME_IDS = Object.keys(THEMES);
  let THEME_ID = (window.ARENA_SHELL && ARENA_SHELL.prof.nextMap) || THEME_IDS[Math.floor(Math.random() * THEME_IDS.length)];
  try { const q = (location.hash || '').slice(1); if (THEMES[q]) THEME_ID = q; } catch (e) { }
  if (!THEMES[THEME_ID]) THEME_ID = 'city';
  const THEME = THEMES[THEME_ID];
  const bushes = [], dress = [];  // dress: procedural props made after the scene exists
  function buildArena() {
    const MAP = GAME_MODE === 'knock' ? { HW: 13, HL: 18 } : { HW: 14, HL: 23 };
    const items = [], colliders = [], city = THEME_ID === 'city';
    const put = (id, x, z, ry, sx, sy, sz, y) => items.push([id, x, y || 0, z, 0, ry || 0, 0, sx || 1, sy || sx || 1, sz || sx || 1]);
    const boxC = (x, z, hx, hz, ry, h) => colliders.push({ t: 'b', kind: 'ob', x, z, hx, hz, ry: ry || 0, hFix: h });
    const circC = (x, z, r, h) => colliders.push({ t: 'c', kind: 'ob', x, z, r, hFix: h });
    // the four kinds of cover; each theme draws them its own way
    const T = THEME_ID, rr = () => Math.random() * 6.28, RK = T === 'desert' ? 'qd_Rock_Medium_' : 'q_Rock_Medium_', ri = i => 1 + ((i % 3) + 3) % 3;
    const wall = (x, z, len, ry) => { boxC(x, z, len / 2, .62, ry, 2.6); const co = Math.cos(ry), si = Math.sin(ry), at = k => [x + co * k, z - si * k];
      if (city) put('container_' + (1 + (Math.abs(Math.round(x * 3 + z)) % 3)), x, z, ry + Math.PI / 2, 1, 1, len / 6.1);
      else { const n = Math.max(2, Math.round(len / 2)); for (let i = 0; i < n; i++) { const [px, pz] = at(-len / 2 + len * (i + .5) / n); put(RK + ri(i + Math.round(x)), px, pz, rr(), .62, .75, .55); } } };
    const low = (x, z, len, ry) => { boxC(x, z, len / 2, .34, ry, .9);
      if (city) put('jersey_concrete_1', x, z, ry + Math.PI / 2, 1, 1, len / 3);
      else if (T === 'beach') put('sandbags_row_1', x, z, ry, len / 2.16, 2.2, 1.9);
      else { const n = Math.max(3, Math.round(len / .75)); for (let i = 0; i < n; i++) { const k = -len / 2 + len * (i + .5) / n; put(RK + ri(i + Math.round(x)), x + Math.cos(ry) * k, z - Math.sin(ry) * k, rr(), .3, .42 + Math.random() * .12, .26); } } };
    const box = (x, z, s, ry) => { boxC(x, z, s / 2, s / 2, ry || 0, 1.3);
      if (city || T === 'beach') put(s > 1 ? 'crate_1' : 'crate_2', x, z, ry || 0, s / (s > 1 ? 1.1 : .8));
      else put(RK + ri(Math.round(x * 7)), x, z, rr(), s * .36, s * .5, s * .36); };
    const rock = (x, z, r) => { circC(x, z, r, 1.6);
      if (city) put('tire_stack_5', x, z, x, r / .6);
      else put(RK + '2', x, z, rr(), r / 1.55, r / 1.3, r / 1.3); };
    const bush = () => { }; // bushes removed (they did not add anything) - the layout keeps the spots open
    const both = f => { f(1); f(-1); }; // s = 1: team A's half (z > 0); s = -1 the twin, rotated half a turn
    if (GAME_MODE === 'knock') {
      both(s => {
        low(-3.5 * s, 13 * s, 3, 0); low(3.5 * s, 13 * s, 3, 0);
        wall(-7 * s, 7 * s, 4.5, 0); wall(8.5 * s, 4 * s, 4, Math.PI / 2);
        box(-1.6 * s, 6 * s, 1.1, .2); box(1.4 * s, 5.4 * s, .8, -.3);
        rock(-4 * s, 2.2 * s, .7); rock(10.5 * s, 12.5 * s, .8);
        bush(-10.5 * s, 13 * s, 3, 3.4); bush(3.8 * s, 1.6 * s, 3, 2); bush(-8.5 * s, 1.5 * s, 2.4, 3); bush(9.5 * s, 9 * s, 2.4, 2.4);
      });
      wall(0, 0, 3, Math.PI / 2);
      return { arena: { halfWidth: MAP.HW, halfLength: MAP.HL }, items: items.concat(borderItems(MAP)), colliders, buildings: [], signs: [], turret: { id: 'turret', x: 0, y: -60, z: 0 },
        spawns: { A: [[-3, 16], [0, 16.6], [3, 16]], B: [[3, -16], [0, -16.6], [-3, -16]] } };
    }
    // City Hall: hall in the middle, two power links on the flanks, a titan camp on each half
    colliders.push({ t: 'b', kind: 'bld', x: 0, z: 0, hx: 2.7, hz: 2.2, ry: 0, hFix: 5, hall: true });
    both(s => {
      low(-3.6 * s, 17 * s, 3, 0); low(3.6 * s, 17 * s, 3, 0);
      wall(-6.8 * s, 10.5 * s, 4.6, 0); wall(10.6 * s, 15.5 * s, 4, Math.PI / 2);
      box(-1.6 * s, 8.6 * s, 1.1, .2); box(1.9 * s, 9.4 * s, .8, -.3); box(-12.2 * s, 19.5 * s, 1.1, .4);
      rock(-6.4 * s, 4.2 * s, .75); low(5.6 * s, 4.6 * s, 3, Math.PI / 2);
      box(12.6 * s, 10.5 * s, 1.1, .1);
      bush(-11.8 * s, 15.5 * s, 3, 3.6); bush(-3.6 * s, 4.8 * s, 2.6, 2); bush(9.8 * s, 9.6 * s, 2.2, 3.2); bush(12.6 * s, -2.6 * s, 1.6, 3.2); bush(4.2 * s, 13 * s, 2.6, 2.2);
    });
    return { arena: { halfWidth: MAP.HW, halfLength: MAP.HL }, items: items.concat(borderItems(MAP)), colliders, buildings: [], signs: [], turret: { id: 'turret', x: 0, y: -60, z: 0 },
      spawns: { A: [[-3, 20.6], [0, 21.2], [3, 20.6]], B: [[3, -20.6], [0, -21.2], [-3, -20.6]] } };
  }
  // models placed outside the play area, plus small non-blocking decoration inside it
  function borderItems(M) {
    const out = [], P = (id, x, z, ry, s, sy, sz, y) => out.push([id, x, y || 0, z, 0, ry || 0, 0, s || 1, sy || s || 1, sz || s || 1]), r = () => Math.random(), T = THEME_ID;
    if (T === 'city') { for (let x = -M.HW; x < M.HW - .1; x += 3.15) { P('fence_panel', x, -M.HL - .2, Math.PI); } for (let z = -M.HL; z < M.HL - .1; z += 3.15) { P('fence_panel', M.HW + .2, z, Math.PI / 2); P('fence_panel', -M.HW - .2, z + 3.15, -Math.PI / 2); } return out; }
    const ring = (fn, step, gap) => { for (let z = -M.HL - 3; z <= M.HL + 3; z += step) for (const sx of [-1, 1]) fn(sx * (M.HW + gap + r() * 2), z + r() * 1.5); for (let x = -M.HW; x <= M.HW; x += step) fn(x + r(), -M.HL - gap - r() * 2); };
    // a solid edge made of the map's own things, so the arena reads as a closed place
    const edge = (fn, step) => { const W = M.HW + .45, L = M.HL + .45; for (let x = -W; x <= W + .01; x += step) { fn(x, -L, false); fn(x, L, true); } for (let z = -L + step; z < L - .01; z += step) { fn(-W, z, false); fn(W, z, false); } };
    const RK = T === 'desert' ? 'qd_Rock_Medium_' : 'q_Rock_Medium_';
    edge((x, z, near) => P(RK + (1 + Math.floor(r() * 3)), x, z, r() * 6, .42 + r() * .15, near ? .3 : .45 + r() * .25), 1.7);
    if (T === 'forest') ring((x, z) => P(['q_CommonTree_1', 'q_CommonTree_2', 'q_Pine_1', 'q_Pine_2', 'q_CommonTree_3'][Math.floor(r() * 5)], x, z, r() * 6, .7 + r() * .25), 3.8, 2);
    if (T === 'desert') { ring((x, z) => P(r() < .6 ? 'qd_Rock_Medium_' + (1 + Math.floor(r() * 3)) : 'q_DeadTree_' + (1 + Math.floor(r() * 3)), x, z, r() * 6, .9 + r() * .5), 3.4, 2.4); }
    if (T === 'beach') { for (let i = 0; i < 6; i++) P('q_DeadTree_' + (1 + i % 3), (i % 2 ? 1 : -1) * (M.HW + 2 + r()), (r() * 2 - 1) * M.HL, r() * 6, .5, .5); }
    // a little life on the floor: grass tufts, flowers, clover, mushrooms (they do not block anything)
    const deco = T === 'forest' ? ['q_Grass_Common_Tall', 'q_Grass_Wispy_Tall', 'q_Flower_3_Group', 'q_Flower_4_Group', 'q_Clover_1', 'q_Mushroom_Common'] : T === 'desert' ? ['q_Grass_Wispy_Tall', 'q_Pebble_Round_2'] : ['q_Grass_Wispy_Tall', 'q_Pebble_Round_2'];
    const n = T === 'forest' ? 46 : 14; for (let i = 0; i < n; i++) { const x = (r() * 2 - 1) * (M.HW - .6), z = (r() * 2 - 1) * (M.HL - .6); const id = deco[Math.floor(r() * deco.length)], big = /Flower|Plant/.test(id); P(id, x, z, r() * 6, big ? .32 : .36, big ? .3 : .34); }
    return out;
  }
  // =====================================================================================================
  // m0: ground materials painted in code - tileable fractal noise, fine grain, ripples / blades / paving -
  // plus a matching normal map so the floor catches the light, and a big "macro" layer (wet sand, dirt paths, moss).
  // =====================================================================================================
  function tileNoise(N, period, seed) { // tileable value noise, smooth-stepped
    const g = new Float32Array(period * period); let s = seed * 9301 + 49297; for (let i = 0; i < g.length; i++) { s = (s * 9301 + 49297) % 233280; g[i] = s / 233280; }
    const out = new Float32Array(N * N), k = period / N;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const fx = x * k, fy = y * k, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
      const a = g[y0 * period + x0], b = g[y0 * period + x1], c = g[y1 * period + x0], d = g[y1 * period + x1]; out[y * N + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy; }
    return out;
  }
  function fbm(N, base, oct, seed) { const out = new Float32Array(N * N); let amp = .5, tot = 0; for (let o = 0; o < oct; o++) { const n = tileNoise(N, base << o, seed + o * 17); for (let i = 0; i < out.length; i++) out[i] += n[i] * amp; tot += amp; amp *= .5; } for (let i = 0; i < out.length; i++) out[i] /= tot; return out; }
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  function makeGround(id) {
    const N = 512, cv = document.createElement('canvas'); cv.width = cv.height = N; const x = cv.getContext('2d'), img = x.createImageData(N, N), D = img.data, H = new Float32Array(N * N);
    let rnd2 = 7; const rand = () => (rnd2 = (rnd2 * 16807) % 2147483647) / 2147483647;
    const big = fbm(N, 4, 4, 3), mid = fbm(N, 16, 3, 11), fine = fbm(N, 64, 2, 23);
    let C0, C1, C2, rep = 4;
    if (id === 'beach') { C0 = hex('#e9cf98'); C1 = hex('#f5e2b5'); C2 = hex('#d2b277'); rep = 5;
      for (let i = 0; i < N * N; i++) { const px = i % N, py = (i / N) | 0, warp = big[i] * 9, rip = .5 + .5 * Math.sin((py / N * 26 + warp + mid[i] * 2) * Math.PI * 2 / 1), r2 = Math.pow(rip, 3);
        let c = mix3(C0, C1, big[i] * .7 + r2 * .25); c = mix3(c, C2, Math.max(0, mid[i] - .55) * 1.4); const g = (rand() - .5) * 26; D[i * 4] = c[0] + g; D[i * 4 + 1] = c[1] + g * .9; D[i * 4 + 2] = c[2] + g * .7; H[i] = r2 * .6 + fine[i] * .4; } }
    else if (id === 'desert') { C0 = hex('#d39a62'); C1 = hex('#e6b27c'); C2 = hex('#b07a48'); rep = 5;
      for (let i = 0; i < N * N; i++) { let c = mix3(C0, C1, big[i] * .6 + mid[i] * .4); c = mix3(c, C2, Math.max(0, fine[i] - .55) * 1.2); const g = (rand() - .5) * 22; D[i * 4] = c[0] + g; D[i * 4 + 1] = c[1] + g * .85; D[i * 4 + 2] = c[2] + g * .7; H[i] = mid[i] * .5 + fine[i] * .5; } }
    else if (id === 'forest' || id === 'camp') { C0 = hex(id === 'camp' ? '#7f9e4c' : '#5f9440'); C1 = hex(id === 'camp' ? '#9ab85e' : '#7db556'); C2 = hex(id === 'camp' ? '#8c7448' : '#4a7a32'); rep = 3;
      for (let i = 0; i < N * N; i++) { let c = mix3(C0, C1, mid[i] * .9); c = mix3(c, C2, Math.max(0, big[i] - .6) * 1.6); const g = (rand() - .5) * 22; D[i * 4] = c[0] + g; D[i * 4 + 1] = c[1] + g; D[i * 4 + 2] = c[2] + g * .6; H[i] = fine[i] * .5 + mid[i] * .3; } }
    else if (id === 'temple') { C0 = hex('#c8b38a'); C1 = hex('#dccaa2'); C2 = hex('#a8926a'); rep = 4;
      for (let i = 0; i < N * N; i++) { let c = mix3(C0, C1, mid[i]); c = mix3(c, C2, fine[i] * .5); const g = (rand() - .5) * 16; D[i * 4] = c[0] + g; D[i * 4 + 1] = c[1] + g; D[i * 4 + 2] = c[2] + g; H[i] = .6 + fine[i] * .3; } }
    else { C0 = hex('#4b545e'); C1 = hex('#5c656f'); C2 = hex('#383f47'); rep = 3;
      for (let i = 0; i < N * N; i++) { let c = mix3(C0, C1, mid[i]); c = mix3(c, C2, Math.max(0, big[i] - .55) * 1.3); const g = (rand() - .5) * 34; D[i * 4] = c[0] + g; D[i * 4 + 1] = c[1] + g; D[i * 4 + 2] = c[2] + g; H[i] = fine[i] * .6 + (rand() < .04 ? .4 : 0); } }
    for (let i = 0; i < N * N; i++) D[i * 4 + 3] = 255;
    x.putImageData(img, 0, 0);
    // detail strokes on top
    if (id === 'forest' || id === 'camp') { for (let i = 0; i < 9000; i++) { const px = rand() * N, py = rand() * N, l = 3 + rand() * 6, a = -Math.PI / 2 + (rand() - .5) * .9, light = rand(); x.strokeStyle = light > .5 ? 'rgba(170,215,110,.55)' : 'rgba(40,80,25,.45)'; x.lineWidth = 1 + rand(); x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); } }
    if (id === 'beach') { for (let i = 0; i < 160; i++) { const px = rand() * N, py = rand() * N; x.fillStyle = rand() < .5 ? 'rgba(255,250,235,.8)' : 'rgba(200,160,120,.7)'; x.beginPath(); x.ellipse(px, py, 1.2 + rand() * 1.6, .8 + rand(), rand() * 3, 0, 7); x.fill(); } }
    if (id === 'temple') { // paving stones in a running bond, each with its own shade, dark grout and the odd crack
      const rows = 6, rh = N / rows; for (let r = 0; r < rows; r++) { let px = (r % 2) * rh * .6; while (px < N + rh) { const w = rh * (1 + rand() * .8); x.fillStyle = 'rgba(' + (rand() < .5 ? '255,245,220' : '120,100,70') + ',' + (rand() * .12).toFixed(2) + ')'; x.fillRect(px % N, r * rh, w, rh); if (px + w > N) x.fillRect(px - N, r * rh, w, rh); x.fillStyle = 'rgba(70,58,40,.55)'; x.fillRect(px % N, r * rh, 3, rh);
          if (rand() < .25) { x.strokeStyle = 'rgba(60,50,35,.5)'; x.lineWidth = 1; x.beginPath(); let cx = px % N + rand() * w, cy = r * rh + rand() * rh; x.moveTo(cx, cy); for (let k = 0; k < 4; k++) { cx += (rand() - .5) * 26; cy += (rand() - .5) * 26; x.lineTo(cx, cy); } x.stroke(); } px += w; } x.fillStyle = 'rgba(70,58,40,.55)'; x.fillRect(0, r * rh, N, 3); }
      for (let i = 0; i < 40; i++) { x.fillStyle = 'rgba(90,130,60,.35)'; x.beginPath(); x.arc(rand() * N, rand() * N, 3 + rand() * 9, 0, 7); x.fill(); } }
    if (id === 'desert') { x.lineCap = 'round'; for (let i = 0; i < 26; i++) { let cx = rand() * N, cy = rand() * N; x.strokeStyle = 'rgba(110,70,40,.45)'; x.lineWidth = 1 + rand() * 1.5; x.beginPath(); x.moveTo(cx, cy); for (let k = 0; k < 6; k++) { cx += (rand() - .5) * 40; cy += (rand() - .5) * 40; x.lineTo(cx, cy); } x.stroke(); } for (let i = 0; i < 300; i++) { x.fillStyle = rand() < .5 ? 'rgba(120,80,50,.5)' : 'rgba(255,225,180,.5)'; x.beginPath(); x.arc(rand() * N, rand() * N, .8 + rand() * 1.6, 0, 7); x.fill(); } }
    if (id === 'city') { for (let i = 0; i < 20; i++) { x.fillStyle = 'rgba(20,22,26,.18)'; x.beginPath(); x.ellipse(rand() * N, rand() * N, 10 + rand() * 30, 6 + rand() * 18, rand() * 3, 0, 7); x.fill(); } }
    // height from the painted image (brightness) + the noise, then a normal map from it
    const pix = x.getImageData(0, 0, N, N).data; for (let i = 0; i < N * N; i++) H[i] = H[i] * .5 + (pix[i * 4] + pix[i * 4 + 1] + pix[i * 4 + 2]) / 765 * .5;
    const ncv = document.createElement('canvas'); ncv.width = ncv.height = N; const nx = ncv.getContext('2d'), nimg = nx.createImageData(N, N), ND = nimg.data, S = id === 'beach' ? 3 : id === 'temple' ? 4 : 2.2;
    for (let y = 0; y < N; y++) for (let xx = 0; xx < N; xx++) { const i = y * N + xx, l = H[y * N + (xx + N - 1) % N], r = H[y * N + (xx + 1) % N], u = H[((y + N - 1) % N) * N + xx], d = H[((y + 1) % N) * N + xx]; let vx = (l - r) * S, vy = (u - d) * S, vz = 1; const m = Math.hypot(vx, vy, vz); ND[i * 4] = (vx / m * .5 + .5) * 255; ND[i * 4 + 1] = (vy / m * .5 + .5) * 255; ND[i * 4 + 2] = (vz / m * .5 + .5) * 255; ND[i * 4 + 3] = 255; }
    nx.putImageData(nimg, 0, 0);
    const map = new THREE.CanvasTexture(cv), normalMap = new THREE.CanvasTexture(ncv); map.encoding = THREE.sRGBEncoding; for (const t of [map, normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
    return { map, normalMap, rep };
  }
  // one big texture over the whole arena: wet sand at the edges, worn dirt lanes, moss in the corners
  function makeMacro(id, HW, HL) {
    const cv = document.createElement('canvas'), k = 16; cv.width = 2 * HW * k; cv.height = 2 * HL * k; const x = cv.getContext('2d'), X = v => (v + HW) * k, Z = v => (v + HL) * k;
    let rs = 3; const rand = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
    const blob = (cx, cz, r, col) => { const g = x.createRadialGradient(X(cx), Z(cz), 0, X(cx), Z(cz), r * k); g.addColorStop(0, col); g.addColorStop(1, col.replace(/[\d.]+\)$/, '0)')); x.fillStyle = g; x.fillRect(X(cx - r), Z(cz - r), 2 * r * k, 2 * r * k); };
    const path = (pts, w, col) => { x.strokeStyle = col; x.lineCap = 'round'; x.lineJoin = 'round'; x.lineWidth = w * k; x.filter = 'blur(' + (w * k * .16).toFixed(0) + 'px)'; x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(X(p[0]), Z(p[1])) : x.moveTo(X(p[0]), Z(p[1]))); x.stroke(); x.filter = 'none'; };
    if (id === 'beach') { for (const s of [-1, 1]) { const g = x.createLinearGradient(X(s * HW), 0, X(s * (HW - 3)), 0); g.addColorStop(0, 'rgba(150,120,80,.45)'); g.addColorStop(1, 'rgba(150,120,80,0)'); x.fillStyle = g; x.fillRect(Math.min(X(s * HW), X(s * (HW - 3))), 0, 3 * k, cv.height); } for (let i = 0; i < 14; i++) blob((rand() * 2 - 1) * HW, (rand() * 2 - 1) * HL, 1.5 + rand() * 2.5, 'rgba(255,245,220,.35)'); }
    if (id === 'forest' || id === 'camp') { const c = id === 'camp' ? 'rgba(140,108,66,.75)' : 'rgba(120,92,58,.6)'; path([[0, HL], [-2, HL * .6], [2, HL * .2], [-1, -HL * .2], [2, -HL * .6], [0, -HL]], 2.2, c); path([[-HW, HL * .3], [-HW * .4, 2], [HW * .4, -2], [HW, -HL * .3]], 1.4, c); for (let i = 0; i < 18; i++) blob((rand() * 2 - 1) * HW, (rand() * 2 - 1) * HL, 1 + rand() * 2.5, rand() < .5 ? 'rgba(40,70,25,.35)' : 'rgba(150,190,90,.3)'); }
    if (id === 'temple') { for (let i = 0; i < 16; i++) blob((rand() < .5 ? -1 : 1) * (HW - rand() * 3), (rand() * 2 - 1) * HL, 1.5 + rand() * 2.5, 'rgba(80,120,50,.45)'); blob(0, 0, 6, 'rgba(255,240,200,.25)'); }
    if (id === 'city') { for (let i = 0; i < 10; i++) blob((rand() * 2 - 1) * HW, (rand() * 2 - 1) * HL, 1 + rand() * 2, 'rgba(15,15,20,.25)'); }
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * HW, 2 * HL), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = .008; m.renderOrder = 1; return m;
  }

  if (typeof THREE === 'undefined' || !THREE.GLTFLoader) { fail('ספריית התלת-ממד לא נטענה. צריך חיבור לאינטרנט בפעם הראשונה, ואז לרענן.'); return; }
  let layout = window.ARENA_BUNDLE ? window.ARENA_BUNDLE.layout : null; // the models may already be on the page as script files
  if (!layout && location.protocol !== 'file:') { try { const res = await fetch(BASE + 'layout.json'); if (res.ok) layout = await res.json(); } catch (e) { } }
  if (!layout) { // opened straight from disk: read everything from the bundle file instead
    $('loadText').textContent = 'טוען את קובץ המודלים';
    await new Promise(res => { const sc = document.createElement('script'); sc.src = BASE + 'bundle.js'; sc.onload = res; sc.onerror = res; document.head.appendChild(sc); });
    if (!window.ARENA_BUNDLE) { fail('לא נמצא הקובץ assets/bundle.js. ודא שתיקיית assets נמצאת ליד index.html.'); return; }
    layout = window.ARENA_BUNDLE.layout;
  }
  layout = buildArena(); // version 4: the arena is designed in code (see h3_game.js), only the models come from the bundle
  // runtime layout edits: rings / medkits / city hall are drawn live, and the shared wind building moves out of the hot zone
  layout.items = layout.items.filter(i => !/^(zone_ring_|core_range_ring|medkit_|city_hall$)/.test(i[0]));
  // the three shared T3 buildings: electricity stays neutral on the centre line, wind sits a little toward team A, weapons a little toward team B
  for (const [id, ox, nx, nz] of [['bld_air_t3', 18, 25, 9], ['bld_weapon_t3', 37, 38, -10]]) {
    for (const i of layout.items) if (i[0] === id) { i[1] = nx; i[3] = nz; }
    for (const c of layout.colliders) if (c.kind === 'bld' && c.x === ox && c.z === 0) { c.x = nx; c.z = nz; }
    for (const b of layout.buildings) if (b.id === id) { b.x = nx; b.z = nz; }
  }
  layout.colliders = layout.colliders.filter(c => c.kind !== 'pick');
  const HW = layout.arena.halfWidth, HL = layout.arena.halfLength, coarse = window.matchMedia && matchMedia('(pointer:coarse)').matches;
  const canvas = $('view');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { fail('הדפדפן לא הצליח להפעיל WebGL.'); return; }
  const dpr = window.devicePixelRatio || 1, maxPr = Math.min(3, Math.max(2, dpr)); renderer.setPixelRatio(Math.min(2, dpr));
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.shadowMap.enabled = true; renderer.shadowMap.type = coarse ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(THEME.sky);
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 700);
  scene.add(new THREE.HemisphereLight(THEME.hemi[0], THEME.hemi[1], THEME.hemi[2]));
  const sun = new THREE.DirectionalLight(THEME.sun, .95); sun.position.set(-42, 90, 52); scene.add(sun); scene.add(sun.target);
  sun.castShadow = true; const sc = sun.shadow.camera; sc.left = -(HL + 16); sc.right = HL + 16; sc.top = HL + 16; sc.bottom = -(HL + 16); sc.near = 10; sc.far = 240;
  const sm = (!coarse && (renderer.capabilities.maxTextureSize || 0) >= 4096) ? 4096 : 2048; sun.shadow.mapSize.set(sm, sm); sun.shadow.bias = -.0004; sun.shadow.normalBias = .04;

  // ---------- load GLBs ----------
  const loader = new THREE.GLTFLoader();
  const b64 = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  const loadGLB = url => new Promise((res, rej) => {
    const err = () => rej(new Error('קובץ מודל לא נטען: ' + url)), B2 = window.ARENA_BUNDLE, key = url.slice(BASE.length);
    if (B2 && B2.files[key]) loader.parse(b64(B2.files[key]), '', g => res(g.scene), err); else loader.load(url, g => res(g.scene), undefined, err);
  });
  const need = Array.from(new Set(layout.items.map(i => i[0]))), lib = {}, avScenes = {};
  const jobs = Array.from(new Set(need.concat(['brick_pallet_1', 'brick_pallet_2', 'rock_1', 'rock_3', 'rock_5', 'brick_1', 'plank_1', 'cardboard_box_2']))).concat(['city_hall', 'medkit_2', 'jersey_plastic_1'].filter(i => need.indexOf(i) < 0)).map(id => ({ id: id, url: BASE + 'models/' + id + '.glb', to: lib }));
  const CHAR_IDS = ['brownhair_kid', 'purplegirl', 'ginger_kid'], WEAPON_IDS = ['stick', 'sword', 'slingshot', 'bow', 'pistol', 'jetpack'], BOSS_IDS = ['boxer', 'boxer', 'tommy', 'tommy', 'terminator'], A2 = {};
  for (const c of CHAR_IDS) for (const t of ['red', 'blue']) jobs.push({ id: 'chars/' + c + '_' + t, url: BASE + 'chars/' + c + '_' + t + '.glb', to: A2 });
  for (const w of WEAPON_IDS) jobs.push({ id: 'weapons/' + w, url: BASE + 'weapons/' + w + '.glb', to: A2 });
  BOSS_IDS.forEach((b, i) => jobs.push({ id: 'boss' + i, url: BASE + 'bosses/' + b + '.glb', to: A2 }));
  let ANIMS = window.ARENA_BUNDLE && window.ARENA_BUNDLE.anims;
  if (!ANIMS) { try { ANIMS = await (await fetch(BASE + 'anims.json')).json(); } catch (e) { fail('לא נמצא assets/anims.json. צריך להפעיל דרך start.command.'); return; } }
  jobs.push({ id: layout.turret.id, url: BASE + 'models/' + layout.turret.id + '.glb', to: lib });
  let done = 0, next = 0;
  async function worker() { while (next < jobs.length) { const j = jobs[next++]; if (!j.to[j.id]) j.to[j.id] = await loadGLB(j.url); done++; $('loadText').textContent = 'טוען מודלים ' + done + ' / ' + jobs.length; } }
  try { await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(worker)); } catch (e) { fail(e.message); return; }
  // nature models name their texture (shipped as data: images - the page may not fetch blob: URLs)
  { const TX = (window.ARENA_BUNDLE && window.ARENA_BUNDLE.tex) || {}, made = {};
    const texOf = n => { if (made[n]) return made[n]; const img = new Image(), t = new THREE.Texture(img); t.encoding = THREE.sRGBEncoding; t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; img.onload = () => { t.needsUpdate = true; }; img.src = 'data:image/png;base64,' + TX[n]; return made[n] = t; };
    const waits = []; for (const k in lib) lib[k].traverse(o => { if (!o.isMesh) return; const m = o.material; if (m && m.userData && m.userData.tex && TX[m.userData.tex]) { m.map = texOf(m.userData.tex); m.color.setRGB(1, 1, 1); m.needsUpdate = true; } });
    await Promise.all(Object.values(made).map(t => new Promise(r => { if (t.image.complete) r(); else { t.image.addEventListener('load', r); t.image.addEventListener('error', r); } }))); }
  // low-poly kit models: smooth the normals across soft edges (round logs look round), keep the sharp corners sharp
  function smoothNormals(geo, maxDeg) {
    const pos = geo.attributes.position, nor = geo.attributes.normal; if (!pos || !nor) return; const n = pos.count, cosT = Math.cos(maxDeg * Math.PI / 180), key = i => Math.round(pos.getX(i) * 1e4) + '_' + Math.round(pos.getY(i) * 1e4) + '_' + Math.round(pos.getZ(i) * 1e4), groups = new Map();
    for (let i = 0; i < n; i++) { const k = key(i); let g = groups.get(k); if (!g) groups.set(k, g = []); g.push(i); }
    const out = new Float32Array(n * 3);
    for (const g of groups.values()) for (const i of g) { const ax = nor.getX(i), ay = nor.getY(i), az = nor.getZ(i); let sx = 0, sy = 0, sz = 0; for (const j of g) { const bx = nor.getX(j), by = nor.getY(j), bz = nor.getZ(j); if (ax * bx + ay * by + az * bz >= cosT) { sx += bx; sy += by; sz += bz; } } const l = Math.hypot(sx, sy, sz) || 1; out[i * 3] = sx / l; out[i * 3 + 1] = sy / l; out[i * 3 + 2] = sz / l; }
    geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  }
  for (const k in lib) if (k.startsWith('k_')) lib[k].traverse(o => { if (o.isMesh) { o.geometry = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry; smoothNormals(o.geometry, 50); } });
  // foliage keeps its vertex colours: draw it as instanced meshes instead of merging it into the baked map
  const instItems = {};
  for (const k in lib) { let vc = false; lib[k].traverse(o => { if (o.isMesh && o.geometry.attributes.color && o.material.map) vc = true; }); lib[k].userData.inst = vc; }
  layout.items = layout.items.filter(it => { const m = lib[it[0]]; if (!m || !m.userData.inst) return true; (instItems[it[0]] = instItems[it[0]] || []).push(it); return false; });
  { const e2 = new THREE.Euler(0, 0, 0, 'YXZ'), q2 = new THREE.Quaternion(), m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
    for (const id in instItems) { const root = lib[id], list = instItems[id]; root.updateMatrixWorld(true);
      root.traverse(o => { if (!o.isMesh) return; const im = new THREE.InstancedMesh(o.geometry, o.material, list.length); list.forEach((it, i) => { e2.set(it[4], it[5], it[6], 'YXZ'); q2.setFromEuler(e2); m1.compose(v1.set(it[1], it[2], it[3]), q2, v2.set(it[7], it[8], it[9])); m2.multiplyMatrices(m1, o.matrixWorld); im.setMatrixAt(i, m2); }); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; scene.add(im); }); } }
  $('loadText').textContent = 'מרכיב את המפה';
  await new Promise(r => setTimeout(r, 30));

  // ---------- bake the static map ----------
  // Flat-coloured parts merge by colour into vertex colours, so a handful of materials cover the whole map,
  // and the map is cut into 20 m squares so the camera skips the squares it cannot see.
  const flagOf = m => (m.userData && m.userData.flag) || '';
  const isDecal = f => f.charAt(0) === 'd' && f !== 'ds';
  const CH = 20, chunkOf = (x, z) => Math.floor(x / CH) + ':' + Math.floor(z / CH);
  const bucketR = r => r < .35 ? .25 : r < .65 ? .55 : r < .85 ? .75 : .93, bucketM = m => m > .15 ? .3 : 0;
  const groupOf = m => {
    const f = flagOf(m);
    if (m.map || m.normalMap || m.alphaMap || m.transparent) return { key: 'u' + m.uuid, own: true, f: f };
    const rb = bucketR(m.roughness), mb = bucketM(m.metalness), ds = m.side === THREE.DoubleSide || f === 'ds' || f === 'w';
    return { key: [f, rb, mb, ds ? 2 : 0, f === 'em' ? m.color.getHexString() : ''].join('|'), f: f, rb: rb, mb: mb, ds: ds, em: f === 'em' ? m.color.clone() : null };
  };
  const groupMats = {};
  const matFor = (gr, src) => {
    if (gr.own) return src;
    if (groupMats[gr.key]) return groupMats[gr.key];
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: gr.rb, metalness: gr.mb, side: gr.ds ? THREE.DoubleSide : THREE.FrontSide });
    if (gr.em) { m.emissive = gr.em; m.emissiveIntensity = .4; }
    if (isDecal(gr.f)) { const n = +gr.f.charAt(1) || 1; m.polygonOffset = true; m.polygonOffsetFactor = -n; m.polygonOffsetUnits = -n * 2; }
    m.userData.flag = gr.f; return groupMats[gr.key] = m;
  };
  function partsOf(root) {
    root.updateMatrixWorld(true); const out = [];
    root.traverse(o => { if (!o.isMesh) return; const g = o.geometry; if (!g.attributes.normal) g.computeVertexNormals(); const mat = Array.isArray(o.material) ? o.material[0] : o.material; out.push({ pos: g.attributes.position, nor: g.attributes.normal, uv: g.attributes.uv || null, idx: g.index, mw: o.matrixWorld.clone(), mat: mat, gr: groupOf(mat) }); });
    return out;
  }
  const partCache = {}, batches = new Map();
  const mI = new THREE.Matrix4(), mF = new THREE.Matrix4(), n3 = new THREE.Matrix3(), q = new THREE.Quaternion(), eu = new THREE.Euler(0, 0, 0, 'YXZ'), vP = new THREE.Vector3(), vS = new THREE.Vector3();
  let tris = 0; const statics = [], HG = 2, hgW = 2 * HW * HG, hgH = 2 * HL * HG, hgrid = new Float32Array(hgW * hgH); // tallest baked vertex per half-metre cell
  for (const it of layout.items) {
    const parts = partCache[it[0]] || (partCache[it[0]] = partsOf(lib[it[0]])), ck = chunkOf(it[1], it[3]);
    eu.set(it[4], it[5], it[6], 'YXZ'); q.setFromEuler(eu); mI.compose(vP.set(it[1], it[2], it[3]), q, vS.set(it[7], it[8], it[9]));
    for (const p of parts) {
      mF.multiplyMatrices(mI, p.mw); n3.getNormalMatrix(mF);
      const k = ck + '#' + p.gr.key; let b = batches.get(k); if (!b) { b = { mat: matFor(p.gr, p.mat), own: !!p.gr.own, P: [], N: [], U: [], C: [], n: 0, uv: !!p.uv && !!p.gr.own }; batches.set(k, b); }
      const cnt = p.idx ? p.idx.count : p.pos.count, P = new Float32Array(cnt * 3), N = new Float32Array(cnt * 3), U = b.uv ? new Float32Array(cnt * 2) : null, Cc = b.own ? null : new Float32Array(cnt * 3), e = mF.elements, ne = n3.elements, col = p.mat.color || { r: 1, g: 1, b: 1 };
      for (let i = 0; i < cnt; i++) {
        const vi = p.idx ? p.idx.getX(i) : i, x = p.pos.getX(vi), y = p.pos.getY(vi), z = p.pos.getZ(vi), o = i * 3;
        P[o] = e[0] * x + e[4] * y + e[8] * z + e[12]; P[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; P[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        if (P[o + 1] > .25) { const gx = Math.floor((P[o] + HW) * HG), gz = Math.floor((P[o + 2] + HL) * HG); if (gx >= 0 && gz >= 0 && gx < hgW && gz < hgH && P[o + 1] > hgrid[gz * hgW + gx]) hgrid[gz * hgW + gx] = P[o + 1]; }
        const a = p.nor.getX(vi), bb = p.nor.getY(vi), c = p.nor.getZ(vi); let X = ne[0] * a + ne[3] * bb + ne[6] * c, Y = ne[1] * a + ne[4] * bb + ne[7] * c, Z = ne[2] * a + ne[5] * bb + ne[8] * c; const l = Math.sqrt(X * X + Y * Y + Z * Z) || 1;
        N[o] = X / l; N[o + 1] = Y / l; N[o + 2] = Z / l;
        if (Cc) { Cc[o] = col.r; Cc[o + 1] = col.g; Cc[o + 2] = col.b; }
        if (U) { U[i * 2] = p.uv.getX(vi); U[i * 2 + 1] = p.uv.getY(vi); }
      }
      b.P.push(P); b.N.push(N); if (U) b.U.push(U); if (Cc) b.C.push(Cc); b.n += cnt;
    }
  }
  const join = (arrs, n) => { const out = new Float32Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
  let staticMeshes = 0;
  batches.forEach(b => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(join(b.P, b.n * 3), 3)); g.setAttribute('normal', new THREE.BufferAttribute(join(b.N, b.n * 3), 3));
    if (b.C.length) g.setAttribute('color', new THREE.BufferAttribute(join(b.C, b.n * 3), 3));
    if (b.uv) g.setAttribute('uv', new THREE.BufferAttribute(join(b.U, b.n * 2), 2));
    g.computeBoundingSphere(); const f = flagOf(b.mat);
    if (b.own && isDecal(f)) { const n = +f.charAt(1) || 1; b.mat.polygonOffset = true; b.mat.polygonOffsetFactor = -n; b.mat.polygonOffsetUnits = -n * 2; }
    const me = new THREE.Mesh(g, b.mat); me.receiveShadow = true; me.castShadow = !isDecal(f) && f !== 'ns' && f !== 'w'; me.matrixAutoUpdate = false; scene.add(me); statics.push(me); tris += b.n / 3; staticMeshes++; b.P = b.N = b.U = b.C = null;
  });

  // ---------- ground + signs + turret ----------
  function noiseTex(base, specks, size) {
    const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d'); x.fillStyle = base; x.fillRect(0, 0, size, size);
    for (const s of specks) { x.fillStyle = s[0]; for (let i = 0; i < s[1]; i++) { const px = Math.random() * size, py = Math.random() * size, d = s[2] * (.5 + Math.random()); for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) { x.globalAlpha = s[3] * (.5 + Math.random() * .5); x.beginPath(); x.arc(px + ox * size, py + oy * size, d, 0, 6.3); x.fill(); } } }
    x.globalAlpha = 1; const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t;
  }
  const GT = makeGround(THEME_ID); GT.map.repeat.set(2 * HW / GT.rep, 2 * HL / GT.rep); GT.normalMap.repeat.copy(GT.map.repeat);
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(2 * HW, 2 * HL), new THREE.MeshStandardMaterial({ map: GT.map, normalMap: GT.normalMap, normalScale: new THREE.Vector2(.9, .9), roughness: THEME_ID === 'beach' ? .92 : .95, metalness: 0 })); asphalt.rotation.x = -Math.PI / 2; asphalt.receiveShadow = true; scene.add(asphalt); scene.add(makeMacro(THEME_ID, HW, HL));
  if (THEME.outside) { const diT = noiseTex(THEME.outside[0], THEME.outside[1], 1024); diT.repeat.set(70, 70); const dirt = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ map: diT, roughness: 1, metalness: 0 })); dirt.rotation.x = -Math.PI / 2; dirt.position.y = -.03; dirt.receiveShadow = true; scene.add(dirt); }
  const signMeshes = [];
  for (const s of layout.signs) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 96; const x = c.getContext('2d'); x.fillStyle = '#23262c'; x.fillRect(0, 0, 1024, 96); x.fillStyle = '#e9c45a'; x.font = '700 68px Georgia, "Times New Roman", serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(s.text.split('').join(' '), 512, 52);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; const me = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), new THREE.MeshStandardMaterial({ map: t, roughness: .6 })); me.position.set(s.x, s.y, s.z); me.rotation.y = s.ry; scene.add(me); signMeshes.push(me);
  }
  const shadowAll = o => o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  const noCast = o => o.traverse(c => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = true; } });
  const turret = lib[layout.turret.id]; turret.position.set(layout.turret.x, layout.turret.y, layout.turret.z); noCast(turret); scene.add(turret);
  // static shadows are drawn once; characters use a soft round shadow instead
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  const blobTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const blobGeo = new THREE.PlaneGeometry(1.1, 1.1), blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
  const makeBlob = () => { const b = new THREE.Mesh(blobGeo, blobMat); b.rotation.x = -Math.PI / 2; b.position.y = .025; b.renderOrder = 1; return b; };

  // ---------- collision ----------
  const SOLID = { ob: 1, bld: 1, wall: 1 }, cols = layout.colliders;
  for (const c of cols) { if (c.t === 'b') { c.co = Math.cos(c.ry); c.si = Math.sin(c.ry); } }
  const solids = cols.filter(c => SOLID[c.kind]);
  // collider heights from the baked geometry: jumps clear low things, shots pass over them, the jetpack clears buildings
  for (const c of solids) {
    let h = 0; const ex = c.t === 'c' ? c.r : Math.max(c.hx, c.hz);
    for (let dx = -ex; dx <= ex; dx += .5) for (let dz = -ex; dz <= ex; dz += .5) { const px = c.x + dx, pz = c.z + dz, gx = Math.floor((px + HW) * HG), gz = Math.floor((pz + HL) * HG); if (gx < 0 || gz < 0 || gx >= hgW || gz >= hgH) continue; if (c.t === 'c' ? Math.hypot(dx, dz) > c.r : (Math.abs(dx * c.co - dz * c.si) > c.hx || Math.abs(dx * c.si + dz * c.co) > c.hz)) continue; h = Math.max(h, hgrid[gz * hgW + gx]); }
    c.h = c.hFix ? c.hFix : c.kind === 'wall' ? 9 : c.kind === 'bld' ? Math.max(h, 3) : (h || 1.2);
  }
  // push a circle out of every solid collider; returns true if it touched something
  let passSide = '*'; // fences let their own team through; '*' = ignore every fence
  function resolve(p, r, clear) {
    let hit = false;
    for (let pass = 0; pass < 3; pass++) for (const c of solids) {
      if (clear !== undefined && c.h <= clear) continue; if (c.fside && (passSide === '*' || passSide === c.fside)) continue;
      if (c.t === 'c') { const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = r + c.r; if (d < m) { hit = true; if (d < 1e-4) { p.x += m; } else { p.x = c.x + dx / d * m; p.z = c.z + dz / d * m; } } }
      else {
        const dx = p.x - c.x, dz = p.z - c.z, lx = dx * c.co - dz * c.si, lz = dx * c.si + dz * c.co, qx = Math.max(-c.hx, Math.min(c.hx, lx)), qz = Math.max(-c.hz, Math.min(c.hz, lz));
        let ex = lx - qx, ez = lz - qz, d = Math.hypot(ex, ez), nx, nz;
        if (d >= r) continue; hit = true;
        if (d > 1e-5) { nx = lx + ex / d * (r - d); nz = lz + ez / d * (r - d); }
        else { const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz); if (px < pz) { nx = (lx < 0 ? -1 : 1) * (c.hx + r); nz = lz; } else { nx = lx; nz = (lz < 0 ? -1 : 1) * (c.hz + r); } }
        p.x = c.x + nx * c.co + nz * c.si; p.z = c.z - nx * c.si + nz * c.co;
      }
    }
    p.x = Math.max(-HW + r + .25, Math.min(HW - r - .25, p.x)); p.z = Math.max(-HL + r + .25, Math.min(HL - r - .25, p.z));
    return hit;
  }
  function blocked(x, z, r, clear) { for (const c of solids) { if (clear !== undefined && c.h <= clear) continue; if (c.fside && (passSide === '*' || passSide === c.fside)) continue; if (c.t === 'c') { if (Math.hypot(x - c.x, z - c.z) < r + c.r) return true; } else { const dx = x - c.x, dz = z - c.z, lx = dx * c.co - dz * c.si, lz = dx * c.si + dz * c.co; if (Math.hypot(Math.max(Math.abs(lx) - c.hx, 0), Math.max(Math.abs(lz) - c.hz, 0)) < r) return true; } } return Math.abs(x) > HW - r || Math.abs(z) > HL - r; }
  function freeNear(x, z) { for (let rr = 0; rr < 12; rr += .7) for (let a = 0; a < 6.28; a += .7) { const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr; if (!blocked(px, pz, .8)) return [px, pz]; } return [x, z]; }
  const colGroup = new THREE.Group(); colGroup.visible = false; scene.add(colGroup);
  { const cm = {}, cc = { ob: 0xff3b30, bld: 0xffd21f, bush: 0x35d05a, wall: 0xff3b30, pick: 0x3f8cff };
    for (const c of cols) { const m = cm[c.kind] || (cm[c.kind] = new THREE.MeshBasicMaterial({ color: cc[c.kind] || 0xffffff, transparent: true, opacity: .5, depthTest: false, depthWrite: false })); const me = new THREE.Mesh(c.t === 'c' ? new THREE.CircleGeometry(c.r, 24) : new THREE.PlaneGeometry(c.hx * 2, c.hz * 2), m); me.rotation.order = 'YXZ'; me.rotation.set(-Math.PI / 2, c.t === 'c' ? 0 : c.ry, 0); me.position.set(c.x, .06, c.z); me.renderOrder = 5; colGroup.add(me); } }



  // =====================================================================================================
  // g15: sound. Everything is synthesised with Web Audio (no sound files to load), plus a Hebrew announcer
  // through the browser's own speech voice. Audio starts after the first tap / key press (browser rule).
  // =====================================================================================================
  const SFX = (() => {
    let ctx = null, master = null, noise = null, unlocked = false, voiceAt = 0, listener = () => null;
    const last = {}, cfg = () => (typeof DBG !== 'undefined' ? DBG : { sound: true, voice: true });
    function unlock() {
      if (unlocked) return; unlocked = true;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = .55;
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; master.connect(comp); comp.connect(ctx.destination);
        noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) { ctx = null; }
      try { if (window.speechSynthesis) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch (e) { }
    }
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, unlock, { capture: true, passive: true }));
    // building blocks
    function env(g, t, a, peak, dur) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0008, t + dur); }
    function tone(f0, f1, dur, type, vol, delay, out) { const t = ctx.currentTime + (delay || 0), o = ctx.createOscillator(), g = ctx.createGain(); o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur); env(g, t, .005, vol, dur); o.connect(g); g.connect(out || master); o.start(t); o.stop(t + dur + .05); }
    function hiss(dur, ftype, f0, f1, q, vol, delay, out) { const t = ctx.currentTime + (delay || 0), s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noise; f.type = ftype; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur); f.Q.value = q || 1; env(g, t, .004, vol, dur); s.connect(f); f.connect(g); g.connect(out || master); s.start(t, Math.random() * .5); s.stop(t + dur + .05); }
    function notes(list, type, vol, step) { list.forEach((f, i) => tone(f, 0, step * 1.6, type || 'triangle', vol, i * step)); }
    const SOUNDS = {
      dart: v => { hiss(.07, 'highpass', 1800, 0, .7, .5 * v); tone(260, 90, .07, 'square', .18 * v); },
      stone: v => { tone(700, 220, .09, 'triangle', .3 * v); hiss(.05, 'bandpass', 1200, 0, 2, .2 * v); },
      arrow: v => { hiss(.14, 'bandpass', 3200, 900, 6, .45 * v); tone(180, 120, .05, 'triangle', .15 * v); },
      swing: v => hiss(.2, 'bandpass', 500, 1900, 3, .38 * v),
      thud: v => { tone(140, 48, .13, 'sine', .55 * v); hiss(.06, 'lowpass', 900, 0, 1, .3 * v); },
      hurtMe: v => { tone(330, 140, .18, 'sawtooth', .22 * v); tone(90, 50, .2, 'sine', .5 * v); hiss(.08, 'lowpass', 700, 0, 1, .3 * v); },
      shieldPop: v => { tone(1600, 2600, .12, 'sine', .25 * v); hiss(.15, 'highpass', 3000, 0, 1, .2 * v); },
      kill: v => notes([660, 990], 'square', .14 * v, .07),
      death: v => { tone(420, 70, .55, 'sawtooth', .2 * v); hiss(.3, 'lowpass', 600, 200, 1, .2 * v); },
      tracer: v => { hiss(.04, 'highpass', 2500, 0, 1, .25 * v); tone(520, 300, .03, 'square', .07 * v); },
      warn: v => notes([880, 880], 'square', .08 * v, .12),
      blast: v => { hiss(.7, 'lowpass', 900, 120, 1, .7 * v); tone(80, 35, .6, 'sine', .7 * v); },
      coreHit: v => { tone(900 + Math.random() * 200, 500, .08, 'square', .12 * v); hiss(.05, 'bandpass', 2500, 0, 3, .15 * v); },
      coreDown: v => { hiss(1.6, 'lowpass', 1400, 80, 1, .9 * v); tone(70, 28, 1.4, 'sine', .9 * v); for (let i = 0; i < 6; i++) hiss(.25, 'bandpass', 300 + Math.random() * 800, 0, 2, .4 * v, .15 + i * .18); },
      plug: v => { hiss(.18, 'highpass', 2000, 0, 1, .3 * v); tone(1200, 2600, .2, 'square', .15 * v); tone(220, 0, .35, 'sawtooth', .08 * v, .1); },
      pickup: v => notes([523, 659, 784], 'triangle', .22 * v, .06),
      heal: v => notes([587, 880, 1175], 'sine', .22 * v, .07),
      questStart: v => notes([440, 660], 'triangle', .22 * v, .09),
      gain: v => notes([523, 659, 784, 1047], 'square', .14 * v, .09),
      lost: v => notes([494, 370], 'triangle', .22 * v, .14),
      growl: v => { const t = ctx.currentTime, o = ctx.createOscillator(), l = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain(), f = ctx.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = 70; l.frequency.value = 18; lg.gain.value = 25; l.connect(lg); lg.connect(o.frequency); f.type = 'lowpass'; f.frequency.value = 500; env(g, t, .08, .45 * v, .8); o.connect(f); f.connect(g); g.connect(master); o.start(t); l.start(t); o.stop(t + .9); l.stop(t + .9); },
      dash: v => hiss(.22, 'bandpass', 900, 3000, 2, .4 * v),
      jump: v => tone(220, 520, .18, 'sine', .35 * v),
      jet: v => { hiss(.6, 'lowpass', 500, 1600, 1, .5 * v); tone(90, 140, .5, 'sawtooth', .15 * v); },
      click: v => tone(1400, 900, .04, 'square', .1 * v),
      tick: v => tone(1000, 0, .06, 'square', .14 * v),
      win: v => notes([523, 659, 784, 1047, 1319], 'square', .16 * v, .12),
      lose: v => notes([392, 330, 262, 196], 'triangle', .22 * v, .2),
      start: v => notes([392, 523, 659], 'square', .14 * v, .1),
    };
    // x,z given -> quieter with distance from the player; throttle = smallest gap between two of the same sound
    function play(name, x, z, throttle) {
      if (!ctx || !cfg().sound || !SOUNDS[name]) return; const now = ctx.currentTime; if (throttle && last[name] && now - last[name] < throttle) return; last[name] = now;
      let v = 1; const L = listener(); if (x !== undefined && L) { const d = Math.hypot(x - L.x, z - L.z); v = 1 / (1 + d / 9); if (v < .06) return; }
      try { SOUNDS[name](v); } catch (e) { }
    }
    // the announcer: short Hebrew lines, never piling up; important ones cut in
    let heVoice = null; const pickVoice = () => { try { const vs = speechSynthesis.getVoices(); heVoice = vs.find(v => /^he|iw/i.test(v.lang)) || null; } catch (e) { } };
    try { if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; } } catch (e) { }
    function say(text, important) { return; // version 3: no announcer
      if (!cfg().voice || !unlocked || !window.speechSynthesis) return; const now = performance.now();
      if (!important && (now - voiceAt < 2200 || speechSynthesis.speaking)) return; voiceAt = now;
      try { if (important) speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'he-IL'; if (heVoice) u.voice = heVoice; u.rate = 1.08; u.pitch = .9; u.volume = 1; speechSynthesis.speak(u); } catch (e) { }
    }
    return { play, say, setListener: f => { listener = f; }, unlock };
  })();


  // ===== h2: shared engine pieces carried over from the earlier versions (math, rays, effects, character animation, projectiles, path-finding) =====
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const SLOT = { stick: 'R', sword: 'R', pistol: 'R', pole: 'R', bow: 'L', slingshot: 'L', jetpack: 'B' };
  const LOOPS = /^(Idle|Running|RunningGinger|Running_girl|Carry Run|Pull Heavy Object|Flying)$/, TRIM = { Picking_Up: [.9, 3.6] };
  const TEAM_HEX = { blue: 0x2f8bff, red: 0xff4d42 }, TEAM_CSS = { blue: '#3d94ff', red: '#ff5548' };
  const WEAPONS = {
    sword: { name: 'חרב', melee: true, dmg: 36, range: 3.3, arc: 1.15, reload: 1.5, cd: .5, clips: ['Standing Melee Attack Horizontal'], at: .42, wind: .24, model: 'sword' },
    bow: { name: 'קשת', dmg: 32, range: 10, speed: 20, reload: 1.8, cd: .55, clips: ['Standing Draw Arrow'], at: .72, wind: .28, model: 'bow', shot: 'arrow', hand: 'LeftHand' },
    pistol: { name: 'אקדח', dmg: 15, burst: 2, range: 7.5, speed: 24, reload: 1.25, cd: .4, clips: ['Shooting'], at: .3, wind: .1, model: 'pistol', shot: 'dart', hand: 'RightHand' },
  };
  const ATTACK_CLIPS = new Set([].concat(...Object.values(WEAPONS).map(w => w.clips)));
  const DBG = { god: false, bots: true, sim: false, spectate: false, stats: false, sound: true, speed: 1, hero: '' };
  let NOW = 0;
  function glowTex() { return glowTex.t || (glowTex.t = tex(64, 64, x => { const g = x.createRadialGradient(32, 32, 2, 32, 32, 31); g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(.4, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); })); }
  const yawOf = (x, z) => Math.atan2(x, z), angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
  const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz), clamp = (v, a, b) => Math.max(a, Math.min(b, v)), rnd = (a, b) => a + Math.random() * (b - a);
  const tex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t; };

  // ---------- exact ray vs the map's colliders (circles + rotated boxes) ----------
  // returns the distance along the ray to the first collider taller than minH, or max
  function rayHitOne(c, ox, oz, dx, dz) {
    if (c.t === 'c') { const fx = ox - c.x, fz = oz - c.z, b = fx * dx + fz * dz, cc = fx * fx + fz * fz - c.r * c.r, d = b * b - cc; if (d < 0) return Infinity; const t = -b - Math.sqrt(d); return t >= 0 ? t : (cc < 0 ? 0 : Infinity); }
    const rx = ox - c.x, rz = oz - c.z, lx = rx * c.co - rz * c.si, lz = rx * c.si + rz * c.co, ldx = dx * c.co - dz * c.si, ldz = dx * c.si + dz * c.co;
    let t0 = -Infinity, t1 = Infinity;
    for (const [p, d, h] of [[lx, ldx, c.hx], [lz, ldz, c.hz]]) { if (Math.abs(d) < 1e-9) { if (Math.abs(p) > h) return Infinity; continue; } let a = (-h - p) / d, b = (h - p) / d; if (a > b) { const s = a; a = b; b = s; } t0 = Math.max(t0, a); t1 = Math.min(t1, b); }
    if (t0 > t1 || t1 < 0) return Infinity; return Math.max(0, t0);
  }
  function rayStatic(ox, oz, dx, dz, max, minH) { let best = max; for (const c of solids) { if (c.h <= minH) continue; const t = rayHitOne(c, ox, oz, dx, dz); if (t < best) best = t; } return best; }
  const lineClear = (ax, az, bx, bz, minH) => { const d = dist2(ax, az, bx, bz); if (d < .01) return true; return rayStatic(ax, az, (bx - ax) / d, (bz - az) / d, d, minH === undefined ? 1.0 : minH) >= d - .01; };

  // ---------- effects ----------
  const fx = [], puffGeo = new THREE.SphereGeometry(1, 8, 6);
  function puff(x, y, z, color, size, life, grow) { if (fx.length > 140) return; const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: .7, depthWrite: false })); m.position.set(x, y, z); m.scale.setScalar(size); scene.add(m); fx.push({ m, life: life || .5, t: 0, grow: grow || 2, s: size }); }
  function ringFx(x, z, r, color, life) { const m = new THREE.Mesh(new THREE.RingGeometry(r * .92, r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, .05, z); scene.add(m); fx.push({ m, life: life || .4, t: 0, grow: .3, s: 1, flat: true }); }
  function updateFx(dt) { for (let i = fx.length - 1; i >= 0; i--) { const f = fx[i]; f.t += dt; const k = f.t / f.life; if (f.flat) { const s = 1 + k * f.grow; f.m.scale.set(s, s, 1); } else f.m.scale.setScalar(f.s * (1 + k * f.grow)); f.m.material.opacity = .75 * (1 - k); if (k >= 1) { scene.remove(f.m); f.m.material.dispose(); fx.splice(i, 1); } } }
  function label3(text, color, w) { const t = tex(256, 64, x => { x.font = '700 34px Rubik, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl'; const ww = Math.min(250, x.measureText(text).width + 30); x.fillStyle = 'rgba(20,22,28,.82)'; x.fillRect(128 - ww / 2, 8, ww, 48); x.fillStyle = color || '#f4f1e8'; x.fillText(text, 128, 33); }); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, depthTest: false })); s.scale.set(w || 2.4, (w || 2.4) / 4, 1); s.renderOrder = 7; return s; }
  // small world-space bar (hp of bosses, fences, channel progress)
  function makeBar(w, color) { const g = new THREE.Group(), bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x15161a, depthTest: false })), fg = new THREE.Sprite(new THREE.SpriteMaterial({ color, depthTest: false })); bg.scale.set(w + .08, .17, 1); bg.renderOrder = 8; fg.center.set(0, .5); fg.scale.set(w, .1, 1); fg.position.x = -w / 2; fg.renderOrder = 9; g.add(bg, fg); g.userData = { fg, w }; return g; }
  const setBar = (bar, k) => { bar.userData.fg.scale.x = Math.max(.001, bar.userData.w * clamp(k, 0, 1)); };

  // ---------- characters ----------
  const weaponSrc = {}; for (const w of WEAPON_IDS) { weaponSrc[w] = A2['weapons/' + w]; noCast(weaponSrc[w]); }
  const poleSrc = new THREE.Group(); { const r = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .6, 8), new THREE.MeshStandardMaterial({ color: 0x2a2b30, roughness: .5 })); r.position.y = .1; poleSrc.add(r); const cap = new THREE.Mesh(new THREE.SphereGeometry(.045, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff7a1c })); cap.position.y = .4; poleSrc.add(cap); }
  weaponSrc.pole = poleSrc;
  function restWorld(kind, P) {
    const Bm = (X, Y, Z, p) => new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(p);
    if (SLOT[kind] === 'B') return Bm(V3(1, 0, 0), V3(0, 1, 0), V3(0, 0, 1), P.spine.clone().add(V3(0, -.02, -.17)));
    const R = SLOT[kind] === 'R', hand = R ? P.handR : P.handL, fore = R ? P.foreR : P.foreL, fing = hand.clone().sub(fore).normalize(), thumb = V3(0, 0, 1), grip = hand.clone().addScaledVector(fing, .075).add(V3(0, -.02, 0));
    let X, Y, Z;
    if (kind === 'pistol') { Z = fing; Y = thumb; X = Y.clone().cross(Z).normalize(); }
    else if (kind === 'stick' || kind === 'sword' || kind === 'pole') { Y = thumb; X = fing; Z = X.clone().cross(Y).normalize(); }
    else { Y = thumb; Z = fing; X = Y.clone().cross(Z).normalize(); }
    return Bm(X, Y, Z, grip);
  }
  function makeChar(root, id) {
    const holder = new THREE.Group(); holder.add(root); noCast(root);
    root.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    let ud = null; root.traverse(o => { if (!ud && o.userData && o.userData.hipsRest) ud = o.userData; }); if (!ud) ud = { hipsRest: ANIMS.hipsRest, vAxis: ANIMS.vAxis };
    root.updateMatrixWorld(true);
    // Mixamo attacks turn the whole body (hips included) as part of the swing. In a game the body must face where you aim,
    // so the hips' turn around the vertical is taken out of every attack clip; the swing itself (spine, arms) stays.
    const hipsN = root.getObjectByName('Hips'), Pq = new THREE.Quaternion(); hipsN.parent.getWorldQuaternion(Pq); const PqI = Pq.clone().invert(), restInv = Pq.clone().multiply(hipsN.quaternion).invert();
    const noHipsYaw = arr => { const out = Float32Array.from(arr), q = new THREE.Quaternion(), w = new THREE.Quaternion(), d = new THREE.Quaternion(), t = new THREE.Quaternion();
      for (let i = 0; i < out.length; i += 4) { q.fromArray(out, i); w.copy(Pq).multiply(q); d.copy(w).multiply(restInv); t.set(0, d.y, 0, d.w).normalize(); w.premultiply(t.invert()); q.copy(PqI).multiply(w); q.toArray(out, i); } return out; };
    const bone = n => root.getObjectByName(n), hips = bone('Hips'), M3 = new THREE.Matrix3().setFromMatrix4(hips.parent.matrixWorld), va = ANIMS.vAxis;
    const mixer = new THREE.AnimationMixer(root), clips = {}, speed = {}; let jumpRM = null;
    const upper = new Set(); bone('Spine').traverse(o => upper.add(o.name));
    for (const name in ANIMS.clips) {
      const c0 = ANIMS.clips[name], ratio = ud.hipsRest[ud.vAxis] / (c0.hr || ANIMS.hipsRest[va]), tr0 = TRIM[name], f0 = tr0 ? Math.round(tr0[0] * ANIMS.fps) : 0, f1 = tr0 ? Math.round(tr0[1] * ANIMS.fps) : c0.frames;
      const cut = (a, k) => a.length === k ? a : a.slice(f0 * k, f1 * k), dur = tr0 ? (f1 - f0 - 1) / ANIMS.fps : c0.dur, U = [], Lw = [];
      for (const b in c0.tracks) {
        if (!bone(b)) continue; const tr = c0.tracks[b], dst = upper.has(b) ? U : Lw;
        if (tr.r) { const r = b === 'Hips' && ATTACK_CLIPS.has(name) ? noHipsYaw(cut(tr.r, 4)) : cut(tr.r, 4), n = r.length / 4; dst.push(new THREE.QuaternionKeyframeTrack(b + '.quaternion', Array.from({ length: n }, (_, i) => i / ANIMS.fps), r)); }
        if (tr.t) {
          const t = Float32Array.from(cut(tr.t, 3), v => v * ratio), n = t.length / 3, first = t.slice(0, 3), last = t.slice(t.length - 3);
          const world = i => V3(...[0, 1, 2].map(a => a === va ? 0 : t[i * 3 + a] - first[a])).applyMatrix3(M3);
          if (LOOPS.test(name)) speed[name] = world(n - 1).length() / dur;
          if (name === 'Jump') { jumpRM = new Float32Array(n); for (let i = 0; i < n; i++) jumpRM[i] = world(i).length(); }
          // every clip plays in place: loops lose their steady drift, one-shots keep the hips over the feet. Movement is done by the game.
          const loop = LOOPS.test(name); for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) if (a !== va) t[i * 3 + a] = loop ? t[i * 3 + a] - (i / (n - 1)) * (last[a] - first[a]) : first[a];
          dst.push(new THREE.VectorKeyframeTrack(b + '.position', Array.from({ length: n }, (_, i) => i / ANIMS.fps), t));
        }
      }
      clips[name] = new THREE.AnimationClip(name, dur, Lw.concat(U)); clips['U:' + name] = new THREE.AnimationClip('U:' + name, dur, U); clips['L:' + name] = new THREE.AnimationClip('L:' + name, dur, Lw);
    }
    const wp = n => bone(n).getWorldPosition(V3(0, 0, 0));
    const P = { handR: wp('RightHand'), foreR: wp('RightForeArm'), handL: wp('LeftHand'), foreL: wp('LeftForeArm'), spine: wp('Spine2') }, offsets = {};
    for (const kind in SLOT) { const W0 = restWorld(kind, P), b = bone(SLOT[kind] === 'R' ? 'RightHand' : SLOT[kind] === 'L' ? 'LeftHand' : 'Spine2'); offsets[kind] = { bone: b, m: b.matrixWorld.clone().invert().multiply(W0) }; }
    const mats = []; root.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); mats.push(o.material); } });
    const c = { id, holder, root, mixer, clips, speed, jumpRM, offsets, mats, run: ud.run || 'Running', spine: ['Spine', 'Spine1', 'Spine2'].map(bone).filter(Boolean), handL: bone('LeftHand'), handR: bone('RightHand'), chest: bone('Spine2'), base: null, baseName: '', up: null, yaw: 0, twist: 0, held: {}, aimOff: {}, visible: true };
    // where the attack pose really points, measured on the pose itself: yaw from the chest to the weapon hand at the firing frame
    // Two ways an attack can play: whole body (standing still) or upper body only over running legs ('U'). In each, measure at the hit frame
    // which way the attack really points: the weapon hand from the chest for shots, the chest itself for melee. The body is then turned by that much.
    const rest = []; root.traverse(o => rest.push([o, o.quaternion.clone(), o.position.clone()])); const restore = () => { for (const [o, q, p] of rest) { o.quaternion.copy(q); o.position.copy(p); } };
    const chestB = bone('Spine2'), qr = new THREE.Quaternion(); chestB.getWorldQuaternion(qr); const fLocal = V3(0, 0, 1).applyQuaternion(qr.clone().invert());
    for (const key in WEAPONS) { const W = WEAPONS[key]; for (const clip of W.clips) for (const mode of ['F', 'U']) { const k = mode + clip + (W.hand || 'chest'); if (!clips[clip] || c.aimOff[k] !== undefined) continue;
      restore(); mixer.stopAllAction(); const ac = mixer.clipAction(clips[mode === 'U' ? 'U:' + clip : clip]); ac.reset(); ac.play(); ac.time = W.at * clips[clip].duration; mixer.update(0); root.updateMatrixWorld(true);
      if (W.hand) { const h = wp(W.hand), ch = wp('Spine2'); c.aimOff[k] = yawOf(h.x - ch.x, h.z - ch.z); } else { const q = new THREE.Quaternion(); chestB.getWorldQuaternion(q); const f = fLocal.clone().applyQuaternion(q); c.aimOff[k] = yawOf(f.x, f.z); }
      ac.stop(); } }
    mixer.stopAllAction(); restore();
    holder.add(makeBlob());
    return c;
  }
  function play(c, name, o) {
    o = o || {}; const full = (c.up ? 'L:' : '') + name; if (!c.clips[full]) return null;
    const a = c.mixer.clipAction(c.clips[full]), once = o.once !== undefined ? o.once : !LOOPS.test(name);
    if (c.base === a && (!once || o.keep)) { a.timeScale = o.ts || 1; return a; }
    a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once; a.timeScale = o.ts || 1;
    if (c.base && c.base !== a) { if (c.baseName === name) a.time = c.base.time; a.crossFadeFrom(c.base, c.baseName === name ? .08 : (o.fade !== undefined ? o.fade : .16), false); }
    a.play(); c.base = a; c.baseName = name; c.baseOpts = o; return a;
  }
  // upper-body layer (spine, arms, head): attacks and aiming run here while the legs keep doing whatever they do
  function upperStart(c, name, ts, t0, hold) {
    if (!c.clips['U:' + name]) return; const had = !!c.up; if (c.up) c.up.a.fadeOut(.06);
    const a = c.mixer.clipAction(c.clips['U:' + name]); a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = ts; a.fadeIn(.07); a.play(); a.time = t0 || 0; a.paused = !!hold;
    c.up = { a, name, dur: c.clips[name].duration, hold: !!hold };
    if (!had && c.baseName) play(c, c.baseName, c.baseOpts);
  }
  function upperStop(c, f) { if (!c.up) return; c.up.a.fadeOut(f || .18); c.up = null; if (c.baseName) play(c, c.baseName, c.baseOpts); }
  function attach(c, kind) { const o = c.offsets[kind]; let obj = c.held[kind]; if (!obj) { obj = weaponSrc[kind].clone(); c.held[kind] = obj; } o.m.decompose(obj.position, obj.quaternion, obj.scale); obj.visible = true; if (obj.parent !== o.bone) o.bone.add(obj); return obj; }
  function detach(c, kind) { const o = c.held[kind]; if (o && o.parent) o.parent.remove(o); }
  function flash(c, color) { for (const m of c.mats) { m.emissive = new THREE.Color(color); m.emissiveIntensity = .85; } c.flashT = .13; }
  function setGhost(c, on) { for (const m of c.mats) { m.transparent = on; m.opacity = on ? .35 : 1; m.depthWrite = !on; } }
  // spine twist after the mixer: chest/head/arms toward the aim, hips stay with the legs
  const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _ax = new THREE.Vector3();
  function applyTwist(c) {
    if (Math.abs(c.twist) < .01) return; c.holder.updateMatrixWorld(true);
    for (const b of c.spine) { b.parent.getWorldQuaternion(_pq); _ax.set(0, 1, 0).applyQuaternion(_pq.invert()); b.quaternion.premultiply(_q.setFromAxisAngle(_ax, c.twist / c.spine.length)); b.updateMatrixWorld(true); }
  }

  // a faceted crystal shell that spins, with a glint riding on it
  function makeShield() {
    const g = new THREE.Group(), geo = new THREE.IcosahedronGeometry(1.0, 1), shell = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x7fd4ff, emissive: 0x2a8fd0, emissiveIntensity: .6, metalness: .6, roughness: .15, flatShading: true, transparent: true, opacity: .12, depthWrite: false, side: THREE.DoubleSide }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xd8f4ff, transparent: true, opacity: .4 }));
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffffff, transparent: true, depthWrite: false, opacity: .95 })); glint.scale.set(.7, .7, 1); glint.position.set(.82, .45, .3);
    const glint2 = glint.clone(); glint2.scale.set(.4, .4, 1); glint2.position.set(-.7, -.3, -.6); g.add(shell, edges, glint, glint2); g.userData = { shell, edges }; return g;
  }
  function tintShield(g, hex) { g.userData.shell.material.color.setHex(hex); g.userData.shell.material.emissive.setHex(hex); g.userData.edges.material.color.setHex(hex).lerp(new THREE.Color(0xffffff), .6); }
  // proportions: the kids are kids (about 1.35 m) next to grown-up guards, and everyone gets a bigger, more readable head
  function styleBody(c, size, head) { c.holder.scale.setScalar(size); const h = c.root.getObjectByName('Head'); if (h) h.scale.setScalar(head); for (const k in c.speed) c.speed[k] *= size; c.size = size; }
  // ---------- projectiles ----------
  const shots = [];
  function shotMesh(kind) {
    if (kind === 'stone') return new THREE.Mesh(new THREE.SphereGeometry(.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: .9 }));
    const g = new THREE.Group();
    if (kind === 'dart') { const b = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .2, 8), new THREE.MeshStandardMaterial({ color: 0xff7a1c })); b.rotation.x = Math.PI / 2; g.add(b); const tip = new THREE.Mesh(new THREE.SphereGeometry(.036, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2f72d8 })); tip.position.z = .11; g.add(tip); }
    else if (kind === 'arrow') { const sh = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, .8, 6), new THREE.MeshStandardMaterial({ color: 0x8a6a45 })); sh.rotation.x = Math.PI / 2; g.add(sh); const hd = new THREE.Mesh(new THREE.ConeGeometry(.035, .1, 6), new THREE.MeshStandardMaterial({ color: 0xb8c2cc, metalness: .5, roughness: .4 })); hd.rotation.x = Math.PI / 2; hd.position.z = .44; g.add(hd); for (let k = 0; k < 3; k++) { const f = new THREE.Mesh(new THREE.PlaneGeometry(.07, .14), new THREE.MeshBasicMaterial({ color: 0xf2efe6, side: THREE.DoubleSide })); f.position.z = -.33; f.rotation.set(0, 0, k * 2.094); f.rotateX(Math.PI / 2); g.add(f); } }
    else { // machine-gun tracer: a hot core with a soft trail
      const core = new THREE.Mesh(new THREE.BoxGeometry(.05, .05, 1.1), new THREE.MeshBasicMaterial({ color: 0xfff3b0 })); g.add(core); const glow = new THREE.Mesh(new THREE.BoxGeometry(.13, .13, 1.7), new THREE.MeshBasicMaterial({ color: 0xff8a1e, transparent: true, opacity: .45, depthWrite: false })); glow.position.z = -.35; g.add(glow); }
    return g;
  }
  // owner: actor | 'core' | boss. Flies flat at chest height (the core's tracers dive from the roof); stops at the first thing it truly touches.
  function fireShot(owner, side, kind, x, y, z, yaw, range, speed, dmg, opts) {
    const dx = Math.sin(yaw), dz = Math.cos(yaw), m = shotMesh(kind); let max = range;
    if (!opts || !opts.overWalls) max = Math.min(range, rayStatic(x, z, dx, dz, range, 1.0));
    m.position.set(x, y, z); m.rotation.y = yaw; scene.add(m);
    shots.push(Object.assign({ m, owner, side, kind, x, z, y, dx, dz, left: max, speed, dmg, y1: y, drop: 0, total: max }, opts || {}));
  }
  function segCircle(x, z, dx, dz, s, cx, cz, r) { const fx = x - cx, fz = z - cz, b = fx * dx + fz * dz, c = fx * fx + fz * fz - r * r; if (c <= 0) return 0; const d = b * b - c; if (d < 0) return -1; const t = -b - Math.sqrt(d); return t >= 0 && t <= s ? t : -1; }
  const NW = 2 * HW, NH = 2 * HL, walk = new Uint8Array(NW * NH);
  function buildNav() { for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) walk[j * NW + i] = blocked(i - HW + .5, j - HL + .5, .62) ? 0 : 1; }
  buildNav();
  const cellOf = (x, z) => { const i = clamp(Math.floor(x + HW), 0, NW - 1), j = clamp(Math.floor(z + HL), 0, NH - 1); return j * NW + i; };
  function nearWalk(x, z) { const c = cellOf(x, z); if (walk[c]) return c; const ci = c % NW, cj = (c / NW) | 0; for (let r = 1; r < 9; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const i = ci + di, j = cj + dj; if (i >= 0 && j >= 0 && i < NW && j < NH && walk[j * NW + i]) return j * NW + i; } return c; }
  const navClear = (ax, az, bx, bz) => { const d = dist2(ax, az, bx, bz), n = Math.ceil(d / .6); for (let k = 1; k < n; k++) { const t = k / n; if (!walk[cellOf(ax + (bx - ax) * t, az + (bz - az) * t)]) return false; } return true; };
  const gS = new Float32Array(NW * NH), cameFrom = new Int32Array(NW * NH), stamp = new Uint16Array(NW * NH); let stampN = 0;
  function findPath(sx, sz, tx, tz) {
    const s = nearWalk(sx, sz), t = nearWalk(tx, tz); if (s === t) return [{ x: tx, z: tz }];
    stampN = (stampN + 1) & 0xffff; if (!stampN) { stamp.fill(0); stampN = 1; }
    const heap = [], ti = t % NW, tj = (t / NW) | 0, hh = c => { const dx = Math.abs(c % NW - ti), dz = Math.abs(((c / NW) | 0) - tj); return Math.max(dx, dz) + .41 * Math.min(dx, dz); };
    const push = (c, f) => { heap.push([f, c]); let i = heap.length - 1; while (i > 0) { const pI = (i - 1) >> 1; if (heap[pI][0] <= heap[i][0]) break; const tmp = heap[pI]; heap[pI] = heap[i]; heap[i] = tmp; i = pI; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; const tmp = heap[m]; heap[m] = heap[i]; heap[i] = tmp; i = m; } } return top; };
    gS[s] = 0; stamp[s] = stampN; cameFrom[s] = -1; push(s, hh(s)); let found = false, guard = 0;
    while (heap.length && guard++ < 9000) {
      const [, c] = pop(); if (c === t) { found = true; break; } const ci = c % NW, cj = (c / NW) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= NW || j >= NH) continue; const n = j * NW + i; if (!walk[n]) continue;
        if (di && dj && (!walk[cj * NW + i] || !walk[j * NW + ci])) continue; // no cutting corners
        const g = gS[c] + (di && dj ? 1.41 : 1); if (stamp[n] === stampN && g >= gS[n]) continue; stamp[n] = stampN; gS[n] = g; cameFrom[n] = c; push(n, g + hh(n));
      }
    }
    if (!found) return [{ x: tx, z: tz }];
    const raw = []; for (let c = t; c !== -1; c = cameFrom[c]) raw.push({ x: c % NW - HW + .5, z: ((c / NW) | 0) - HL + .5 }); raw.reverse(); raw.push({ x: tx, z: tz });
    const out = []; let i = 0; while (i < raw.length - 1) { let j = raw.length - 1; while (j > i + 1 && !navClear(raw[i].x, raw[i].z, raw[j].x, raw[j].z)) j--; out.push(raw[j]); i = j; } // string pulling
    return out;
  }


  // =====================================================================================================
  // m2: theme extras that are not static models - the sea around the beach, campfire flames - and the bush test.
  // (All props themselves are real models placed in m1 and baked with the map.)
  // =====================================================================================================
  const M = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: .8, metalness: 0 }, o || {}));
  const flat = (c, o) => M(c, Object.assign({ flatShading: true }, o || {}));
  let water = null; const flames = [];
  if (THEME_ID === 'beach') {
    water = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x2bb3e0, roughness: .2, metalness: .1 })); water.rotation.x = -Math.PI / 2; water.position.y = -.04; scene.add(water);
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(2 * HW + 7, 2 * HL + 7), new THREE.MeshStandardMaterial({ color: 0xe2c690, roughness: 1 })); sand.rotation.x = -Math.PI / 2; sand.position.y = -.02; sand.receiveShadow = true; scene.add(sand);
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(2 * HW + 8.2, 2 * HL + 8.2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .55 })); foam.rotation.x = -Math.PI / 2; foam.position.y = -.03; scene.add(foam);
  }
  for (const d of dress) if (d.k === 'fire') { const g = new THREE.Group(); g.position.set(d.x, .15, d.z); scene.add(g); const fl = new THREE.Mesh(new THREE.ConeGeometry(.32, .9, 7), new THREE.MeshBasicMaterial({ color: 0xffa53a, transparent: true, opacity: .9 })); fl.position.y = .45; const fl2 = new THREE.Mesh(new THREE.ConeGeometry(.18, .6, 6), new THREE.MeshBasicMaterial({ color: 0xfff1a0 })); fl2.position.y = .32; const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xff8a2a, transparent: true, depthWrite: false, opacity: .8 })); glow.scale.set(3, 3, 1); glow.position.y = .6; g.add(fl, fl2, glow); flames.push({ fl, fl2, glow }); }
  function updateDress(t) { for (const f of flames) { const k = 1 + .18 * Math.sin(t * 13) + .1 * Math.sin(t * 7.3); f.fl.scale.set(1, k, 1); f.fl2.scale.set(1, 2 - k, 1); f.glow.material.opacity = .6 + .2 * Math.sin(t * 9); } if (water) water.material.color.setHSL(.54, .72, .5 + .025 * Math.sin(t * 1.3)); }
  const inBush = (x, z) => bushes.some(b => Math.abs(x - b.x) < b.w && Math.abs(z - b.z) < b.d);
  // contact shadows: a soft dark footprint under every piece of cover, so things sit on the ground instead of floating
  { const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d'); x.filter = 'blur(10px)'; x.fillStyle = 'rgba(0,0,0,1)'; x.beginPath(); if (x.roundRect) x.roundRect(22, 22, 84, 84, 28); else x.rect(22, 22, 84, 84); x.fill();
    const sq = new THREE.CanvasTexture(cv), cv2 = document.createElement('canvas'); cv2.width = cv2.height = 128; const y = cv2.getContext('2d'), g = y.createRadialGradient(64, 64, 8, 64, 64, 62); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(.55, 'rgba(0,0,0,.6)'); g.addColorStop(1, 'rgba(0,0,0,0)'); y.fillStyle = g; y.fillRect(0, 0, 128, 128); const rd = new THREE.CanvasTexture(cv2);
    const mSq = new THREE.MeshBasicMaterial({ map: sq, transparent: true, opacity: .5, depthWrite: false }), mRd = new THREE.MeshBasicMaterial({ map: rd, transparent: true, opacity: .5, depthWrite: false }), geo = new THREE.PlaneGeometry(1, 1);
    for (const c of layout.colliders) { if (c.kind !== 'ob' && c.kind !== 'bld') continue; const m = new THREE.Mesh(geo, c.t === 'c' ? mRd : mSq); m.rotation.order = 'YXZ'; m.rotation.y = c.ry || 0; m.rotation.x = -Math.PI / 2; m.position.set(c.x, .015, c.z); if (c.t === 'c') m.scale.set(c.r * 3, c.r * 3, 1); else m.scale.set(c.hx * 2 * 1.55 + .5, c.hz * 2 * 1.55 + .5, 1); m.renderOrder = 1; scene.add(m); } }

  // =====================================================================================================
  // c3: the shared game core - heroes with fixed weapons and supers, combat, bushes, titans, heal pads.
  // A mode file (x_city.js / x_knock.js) fills MODE with its objectives, HUD and bot jobs.
  // =====================================================================================================
  const RULES = {
    radius: .42, accel: 12, respawn: 4, regenDelay: 3, regen: 16, baseHeal: 50, baseR: 4.5, spawnProt: 2,
    match: 240, overtime: 60, ammo: 3, revealT: 1.3, bushSee: 2.6, underdog: 1.25,
    titan: [null, { hp: 1100, hit: 26, base: 60, speed: 2.4, size: 1.15 }, { hp: 1500, hit: 32, base: 75, speed: 2.4, size: 1.25 }, { hp: 1900, hit: 40, base: 90, speed: 2.5, size: 1.35 }],
    pad: { heal: 60, every: 15 },
  };
  const HEROES = {
    brownhair_kid: { name: 'Boy', role: 'לוחם', hp: 170, speed: 4.9, weapon: 'sword', sup: 'charge', supName: 'הסתערות', need: 220, tip: 'חרב רחבה מקרוב. הסופר: זינוק שפוגע בכל מי שבדרך.' },
    purplegirl: { name: 'Girl', role: 'קשתית', hp: 115, speed: 4.7, weapon: 'bow', sup: 'jet', supName: "ג'טפק", need: 190, tip: 'חץ חזק מרחוק. הסופר: טיסה מעל קירות ונחיתה מתפוצצת.' },
    ginger_kid: { name: 'Ginger', role: 'תומך', hp: 140, speed: 4.7, weapon: 'pistol', sup: 'heal', supName: 'שדה ריפוי', need: 180, tip: 'צרור של שתי יריות. הסופר: שדה שמרפא את כל הקבוצה.' },
  };
  const MODE = { name: '', objs: () => [], update() { }, reset() { }, think() { return false; }, hud() { }, mini() { }, timeUp() { endMatch(null, 'תיקו'); }, onKill() { }, onTitanKilled() { }, titanGoal() { return null; }, start() { }, roundBased: false };
  const enemyOf = t => t === 'A' ? 'B' : t === 'B' ? 'A' : 'N', teams = { A: { color: 'blue', members: [], kills: 0, score: 0 }, B: { color: 'red', members: [], kills: 0, score: 0 } };
  const teamCss = s => s === 'N' ? '#e8e2d0' : TEAM_CSS[teams[s].color], teamHex = s => s === 'N' ? 0xe8e2d0 : TEAM_HEX[teams[s].color];
  const sideName = s => teams[s].color === 'blue' ? 'הכחולים' : 'האדומים';
  let matchOver = null, matchT = RULES.match, player = null, started = false, freezeT = 0;
  let banner = () => { }, feed = () => { }, shake = 0, hitStop = 0;

  // ---- damage numbers ----
  const pops = []; for (let i = 0; i < 24; i++) { const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64; const t = new THREE.CanvasTexture(cv); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false })); s.scale.set(1.5, .75, 1); s.visible = false; s.renderOrder = 12; scene.add(s); pops.push({ s, cv, t, life: 0 }); }
  let popI = 0;
  function popNum(x, z, text, color, big) { const p = pops[popI = (popI + 1) % pops.length], c = p.cv.getContext('2d'); c.clearRect(0, 0, 128, 64); c.font = '900 ' + (big ? 50 : 40) + 'px Rubik, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 8; c.strokeStyle = '#0b0c10'; c.strokeText(text, 64, 34); c.fillStyle = color; c.fillText(text, 64, 34); p.t.needsUpdate = true; p.s.position.set(x + rnd(-.3, .3), 2.6, z); p.s.visible = true; p.life = .8; p.s.material.opacity = 1; p.s.scale.set(big ? 1.9 : 1.5, big ? .95 : .75, 1); }
  function updatePops(dt) { for (const p of pops) if (p.life > 0) { p.life -= dt; p.s.position.y += dt * 1.6; p.s.material.opacity = Math.min(1, p.life * 3); if (p.life <= 0) p.s.visible = false; } }
  // ---- the HP number over every head ----
  function makeHpLabel() { const cv = document.createElement('canvas'); cv.width = 128; cv.height = 48; const t = new THREE.CanvasTexture(cv); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false })); s.scale.set(1.05, .4, 1); s.renderOrder = 10; scene.add(s); return { s, cv, t, v: -1 }; }
  function setHpLabel(L, v, color) { if (L.v === v && L.c === color) return; L.v = v; L.c = color; const c = L.cv.getContext('2d'); c.clearRect(0, 0, 128, 48); c.font = '900 36px Rubik, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 7; c.strokeStyle = '#0b0c10'; c.strokeText(String(v), 64, 26); c.fillStyle = color; c.fillText(String(v), 64, 26); L.t.needsUpdate = true; }

  // ---- actors ----
  const actors = [];
  function makeActor(heroKey, side, slot) {
    const H = HEROES[heroKey], color = teams[side].color, c = makeChar(A2['chars/' + heroKey + '_' + color], heroKey + '_' + color); styleBody(c, .82, 1.3);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.52, .66, 28), new THREE.MeshBasicMaterial({ color: TEAM_HEX[color], transparent: true, opacity: .95, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = .03; ring.renderOrder = 2; c.holder.add(ring);
    const bar = makeBar(1.15, TEAM_HEX[color]), ammo = makeBar(1.15, 0xffb52e), sup = new THREE.Mesh(new THREE.RingGeometry(.74, .9, 32), new THREE.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: .95, depthWrite: false })); sup.rotation.x = -Math.PI / 2; sup.position.y = .035; sup.visible = false; c.holder.add(sup);
    scene.add(bar, ammo); scene.add(c.holder); attach(c, WEAPONS[H.weapon].model); if (H.sup === 'jet') attach(c, 'jetpack');
    const a = { c, H, heroKey, side, slot, name: H.name, W: WEAPONS[H.weapon], hp: H.hp, maxHp: H.hp, alive: true, state: 'free', ammo: RULES.ammo, sup: 0, atkCd: 0, shot: null, shot2: 0, lastHit: -9, respawnT: 0, prot: 0, upT: 0, carry: null, kills: 0, dmg: 0, deaths: 0, revealT: 0, hidden: false, seen: true,
      inp: { mx: 0, mz: 0 }, aimYaw: 0, aiming: false, mvx: 0, mvz: 0, ring, bar, ammoBar: ammo, supRing: sup, lbl: makeHpLabel(), isPlayer: false };
    Object.defineProperty(a, 'x', { get: () => c.holder.position.x }); Object.defineProperty(a, 'z', { get: () => c.holder.position.z });
    actors.push(a); teams[side].members.push(a); return a;
  }
  function respawn(a) { const sp = layout.spawns[a.side][a.slot]; a.c.holder.position.set(sp[0], 0, sp[1]); a.c.yaw = a.side === 'A' ? Math.PI : 0; a.hp = a.maxHp; a.alive = true; a.state = 'free'; a.prot = RULES.spawnProt; a.ammo = RULES.ammo; a.mvx = a.mvz = 0; a.ring.visible = a.bar.visible = true; a.c.baseName = ''; a.c.holder.visible = true; play(a.c, 'Idle', { fade: 0 }); if (a.brain) a.brain.goal = null; }
  function kill(a, src) {
    a.hp = 0; a.alive = false; a.deaths++; a.respawnT = MODE.roundBased ? 1e9 : RULES.respawn; a.shot = null; a.aiming = false; if (a.carry && a.carry.drop) a.carry.drop(a); a.c.holder.position.y = 0; a.state = 'dead'; if (a.c.up) upperStop(a.c, .05); a.c.baseName = ''; play(a.c, Math.random() < .5 ? 'death1' : 'death2', { fade: .08 }); setGhost(a.c, false); a.c.holder.visible = true;
    a.ring.visible = a.bar.visible = a.ammoBar.visible = a.supRing.visible = false; a.lbl.s.visible = false; SFX.play('death', a.x, a.z); for (let i = 0; i < 6; i++) puff(a.x + rnd(-.4, .4), rnd(.3, 1.4), a.z + rnd(-.4, .4), teamHex(a.side), .22, .5, 2.2);
    const by = src && src.name ? src.name : '—'; feed(by + ' ← ' + a.name, src && (src.side === 'A' || src.side === 'B') ? src.side : enemyOf(a.side));
    if (src && src.H) { src.kills++; teams[src.side].kills++; src.sup = Math.min(1, src.sup + .15); if (src.isPlayer) { SFX.play('kill'); banner('חיסלת את ' + a.name + '!', '#ffd21f', 1.1); hitStop = .08; } }
    if (a.isPlayer) shake = .5; MODE.onKill(a, src);
  }
  // fewer of you alive than of them: you hit harder and charge faster (one good player can turn it around)
  const underdog = side => { const me = teams[side].members.filter(m => m.alive).length, them = teams[enemyOf(side)].members.filter(m => m.alive).length; return me < them ? RULES.underdog : 1; };
  function hurt(t, dmg, src) {
    if (matchOver || dmg <= 0 || freezeT > 0) return;
    if (src && src.H) dmg *= underdog(src.side);
    if (t.isObj) { if (t.dead || t.hp <= 0) return; t.hp = Math.max(0, t.hp - dmg); t.hitT = .15; popNum(t.x, t.z, '' + Math.round(dmg), '#ffd21f'); SFX.play('coreHit', t.x, t.z, .1); if (src && src.H) { src.sup = Math.min(1, src.sup + dmg * .45 / src.H.need); src.dmg += dmg; } t.onHurt && t.onHurt(dmg, src); return; }
    if (t.isTitan) { if (t.dead) return; t.hp -= dmg; flash(t.c, 0xffffff); setBar(t.bar, t.hp / t.maxHp); popNum(t.x, t.z, '' + Math.round(dmg), '#ffffff'); if (src && src.H) { src.sup = Math.min(1, src.sup + dmg * .6 / src.H.need); src.dmg += dmg; t.threat = src; t.dmgBy[src.side] = (t.dmgBy[src.side] || 0) + dmg; } if (t.hp <= 0) titanDied(t, src); return; }
    if (!t.alive || t.prot > 0 || t.state === 'fly') return; if (t.isPlayer && DBG.god) return;
    t.hp -= dmg; t.lastHit = NOW; t.revealT = NOW + .8; flash(t.c, 0xff3b30); popNum(t.x, t.z, '' + Math.round(dmg), t.isPlayer ? '#ff6a5e' : '#ffffff', dmg >= 30);
    if (src && src.H) { src.sup = Math.min(1, src.sup + dmg / src.H.need * underdog(src.side)); src.dmg += dmg; if (src.isPlayer) hitStop = Math.max(hitStop, .03); }
    if (t.isPlayer) { SFX.play('hurtMe', undefined, undefined, .08); shake = Math.max(shake, .22); onPlayerHit(); } else if (src && src.isPlayer) SFX.play('thud', t.x, t.z, .05);
    if (t.hp <= 0) kill(t, src);
  }
  let onPlayerHit = () => { };
  // ---- bushes: inside one you are invisible to the other team, unless they are right next to you or you just attacked ----
  function updateVis() {
    for (const a of actors) { a.hidden = a.alive && a.state !== 'fly' && inBush(a.x, a.z) && NOW > a.revealT;
      if (!a.hidden) { a.seenBy = { A: true, B: true }; continue; }
      a.seenBy = { A: a.side === 'A', B: a.side === 'B' }; const foe = enemyOf(a.side); for (const e of teams[foe].members) if (e.alive && dist2(e.x, e.z, a.x, a.z) < RULES.bushSee) { a.seenBy[foe] = true; break; } }
  }
  const visibleTo = (t, side) => !t.seenBy || t.seenBy[side] !== false;

  // ---- attacks: 3 ammo that refill one by one; tap = auto aim, drag = manual aim with a little magnetism ----
  const chestY = 1.0;
  const aimOffset = (a, W) => W.hand ? (a.c.aimOff['U' + W.clips[0] + W.hand] || 0) : 0;
  function enemiesOf(side, withObj) { const out = []; for (const e of teams[enemyOf(side)].members) if (e.alive && e.state !== 'fly' && visibleTo(e, side)) out.push(e); for (const t of titans) if (!t.dead && t.side !== side) out.push(t); if (withObj) for (const o of MODE.objs(side)) out.push(o); return out; }
  const objPt = (a, t) => [clamp(a.x, t.x - t.hx, t.x + t.hx), clamp(a.z, t.z - t.hz, t.z + t.hz)];
  const reach = (a, t) => t.isObj ? (t.hx ? (([px, pz]) => dist2(a.x, a.z, px, pz))(objPt(a, t)) : dist2(a.x, a.z, t.x, t.z) - t.r) : dist2(a.x, a.z, t.x, t.z) - (t.isTitan ? .8 : .45);
  function bestTarget(a, range, noObj) { let best = null, bd = 1e9; for (const t of enemiesOf(a.side, !noObj)) { const d = reach(a, t) + (t.isObj ? 1.5 : 0); if (d <= range + (t.isObj ? 1.5 : 0) && d < bd && (t.isObj || lineClear(a.x, a.z, t.x, t.z, 1.0))) { bd = d; best = t; } } return best; }
  const yawTo = (a, t) => t.isObj && t.hx ? (([px, pz]) => yawOf(px - a.x, pz - a.z))(objPt(a, t)) : yawOf(t.x - a.x, t.z - a.z);
  function assist(a, yaw) { let best = null, bd = .24; for (const t of enemiesOf(a.side, false)) { const d = dist2(a.x, a.z, t.x, t.z); if (d > a.W.range * 1.15) continue; const off = Math.abs(angDiff(yaw, yawOf(t.x - a.x, t.z - a.z))); if (off < bd) { bd = off; best = t; } } return best ? yaw + angDiff(yaw, yawOf(best.x - a.x, best.z - a.z)) * .75 : yaw; }
  function startAttack(a, yaw) {
    if (!a.alive || a.state !== 'free' || a.carry || a.atkCd > 0 || a.ammo < 1 || a.shot || freezeT > 0) return false;
    const W = a.W, clip = W.clips[0], dur = a.c.clips[clip].duration; a.ammo -= 1; a.atkCd = W.cd; a.aimYaw = yaw; a.shot = { t: W.wind }; a.upT = W.wind + .32; a.aiming = false; a.prot = 0; a.revealT = NOW + RULES.revealT;
    upperStart(a.c, clip, W.at * dur / W.wind, 0, false); if (W.melee) SFX.play('swing', a.x, a.z); return true;
  }
  function holdAim(a, yaw) { if (!a.alive || a.state !== 'free' || a.carry) { a.aiming = false; return; } a.aimYaw = yaw; if (a.shot) return; const clip = a.W.clips[0]; a.aiming = true; if (!a.c.up || !a.c.up.hold) upperStart(a.c, clip, 1, a.W.at * a.c.clips[clip].duration * (a.W.melee ? .3 : .92), true); }
  function cancelAim(a) { if (a.aiming) { a.aiming = false; if (a.c.up && a.c.up.hold) upperStop(a.c, .12); } }
  function fireOne(a) { const W = a.W, yaw = a.aimYaw, dx = Math.sin(yaw), dz = Math.cos(yaw); SFX.play(W.shot, a.x, a.z); fireShot(a, a.side, W.shot, a.x + dx * .45, chestY, a.z + dz * .45, yaw, W.range, W.speed, W.dmg); if (W.shot === 'dart') puff(a.x + dx * .6, chestY, a.z + dz * .6, 0xffe08a, .07, .12, 1.5); }
  function landAttack(a) {
    const W = a.W, yaw = a.aimYaw; if (!W.melee) { fireOne(a); if (W.burst > 1) a.shot2 = .13; return; }
    let any = false; for (const t of enemiesOf(a.side, true)) { const d = reach(a, t); if (d > W.range) continue; if (Math.abs(angDiff(yaw, yawTo(a, t))) > W.arc && d > .7) continue; if (!t.isObj && !lineClear(a.x, a.z, t.x, t.z, 1.3) && d > 1) continue; hurt(t, W.dmg, a); any = true; }
    slashFx(a.x, a.z, yaw, W.range); if (any) SFX.play('thud', a.x, a.z);
  }
  function slashFx(x, z, yaw, r) { const m = new THREE.Mesh(new THREE.RingGeometry(r * .55, r, 20, 1, -1.15, 2.3), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide })); m.rotation.order = 'YXZ'; m.rotation.y = yaw - Math.PI / 2; m.rotation.x = -Math.PI / 2; m.position.set(x, .12, z); scene.add(m); fx.push({ m, life: .18, t: 0, grow: .08, s: 1, flat: true }); }
  function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i], step = Math.min(s.left, s.speed * dt); let best = step + 1, hit = null;
      if (s.foes) { for (const t of s.foes()) { if (s.y > 2.6) break; const d = segCircle(s.x, s.z, s.dx, s.dz, step, t.x, t.z, t.isTitan ? .9 : .5); if (d >= 0 && d < best) { best = d; hit = t; } } }
      else { for (const t of enemiesOf(s.side, false)) { const d = segCircle(s.x, s.z, s.dx, s.dz, step, t.x, t.z, t.isTitan ? .95 : .6); if (d >= 0 && d < best) { best = d; hit = t; } }
        for (const o of MODE.objs(s.side)) { const d = o.col ? rayHitOne(o.col, s.x, s.z, s.dx, s.dz) : segCircle(s.x, s.z, s.dx, s.dz, step, o.x, o.z, o.r); if (d >= 0 && d <= step + .06 && d < best) { best = d; hit = o; } } }
      const adv = hit ? best : step; s.x += s.dx * adv; s.z += s.dz * adv; s.left -= adv; if (s.y0 !== undefined) s.y = s.y1 + (s.y0 - s.y1) * (s.left / s.total); s.m.position.set(s.x, s.y, s.z);
      if (hit) { hurt(hit, s.dmg * (hit.isTitan && s.owner.isObj ? 2 : 1), s.owner); puff(s.x, s.y, s.z, 0xffffff, .14, .2, 1.5); }
      if (hit || s.left <= 1e-4) { if (!hit) puff(s.x, Math.max(.15, s.y), s.z, 0xd8d4ca, .09, .25, 1.6); scene.remove(s.m); shots.splice(i, 1); }
    }
  }
  // ---- supers ----
  const fields = [];
  function useSuper(a, yaw) {
    if (!a.alive || a.state !== 'free' || a.sup < 1 || a.carry || matchOver || freezeT > 0) return false; a.sup = 0; cancelAim(a); if (a.c.up) upperStop(a.c, .05); a.revealT = NOW + RULES.revealT; if (a.isPlayer) banner(a.H.supName + '!', '#ffd21f', 1); ringFx(a.x, a.z, 1.4, 0xffd21f, .4);
    if (a.H.sup === 'charge') { a.c.yaw = yaw; a.aimYaw = yaw; a.state = 'dash'; a.sub = { left: 7.5, hit: new Set() }; SFX.play('dash', a.x, a.z); }
    else if (a.H.sup === 'jet') { const m = Math.hypot(a.inp.mx, a.inp.mz), d = m > .15 ? yawOf(a.inp.mx, a.inp.mz) : yaw; a.state = 'fly'; a.sub = { fuel: 2.1, dx: Math.sin(d), dz: Math.cos(d) }; play(a.c, 'Flying', { fade: .2 }); SFX.play('jet', a.x, a.z); }
    else { const ring = new THREE.Mesh(new THREE.CircleGeometry(3.6, 40), new THREE.MeshBasicMaterial({ color: 0x3fdc5d, transparent: true, opacity: .28, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.set(a.x, .04, a.z); scene.add(ring); const kit = lib.medkit_2.clone(); kit.position.set(a.x, .4, a.z); kit.scale.setScalar(1.8); scene.add(kit); fields.push({ x: a.x, z: a.z, side: a.side, t: 6, ring, kit }); SFX.play('heal', a.x, a.z); }
    return true;
  }
  function updateFields(dt) { for (let i = fields.length - 1; i >= 0; i--) { const f = fields[i]; f.t -= dt; f.kit.rotation.y += dt * 2; f.ring.material.opacity = .2 + .1 * Math.sin(NOW * 6); for (const a of teams[f.side].members) if (a.alive && a.hp < a.maxHp && dist2(a.x, a.z, f.x, f.z) < 3.6) a.hp = Math.min(a.maxHp, a.hp + 26 * dt); if (f.t <= 0) { scene.remove(f.ring); scene.remove(f.kit); fields.splice(i, 1); } } }

  // ---- titans: big bosses. Neutral ones ('N') guard a camp; team ones march on MODE.titanGoal() ----
  const titans = [], titanPool = { 1: [], 2: [], 3: [] }, teleGeo = new THREE.CircleGeometry(1, 28);
  BOSS_IDS.forEach((id, i) => { const tier = id === 'boxer' ? 1 : id === 'tommy' ? 2 : 3, c = makeChar(A2['boss' + i], id); styleBody(c, RULES.titan[tier].size, 1.15); c.holder.visible = false; scene.add(c.holder); c.tbar = makeBar(2, 0xffffff); c.tbar.visible = false; scene.add(c.tbar);
    c.tring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.25, 32), new THREE.MeshBasicMaterial({ transparent: true, opacity: .95, depthWrite: false })); c.tring.rotation.x = -Math.PI / 2; c.tring.position.y = .04; c.holder.add(c.tring); titanPool[tier].push(c); });
  function spawnTitan(side, tier, x, z, opts) {
    opts = opts || {}; let c = titanPool[tier].find(k => !k.busy), tr = tier; while (!c && tr > 1) c = titanPool[--tr].find(k => !k.busy); if (!c) { tr = tier; while (!c && tr < 3) c = titanPool[++tr].find(k => !k.busy); } if (!c) return null; c.busy = true;
    const R = RULES.titan[tier], hp = R.hp * (opts.hpK || 1), tele = new THREE.Mesh(teleGeo, new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0, depthWrite: false })); tele.rotation.x = -Math.PI / 2; tele.position.y = .05; scene.add(tele);
    const t = { isTitan: true, side, c, tier, R, hp, maxHp: hp, st: 'walk', t: 0, dead: false, tele, bar: c.tbar, path: null, pi: 0, pathT: 0, name: opts.name || 'הטיטאן', threat: null, home: opts.home || null, dmgBy: {}, camp: opts.camp || null, lbl: makeHpLabel() };
    Object.defineProperty(t, 'x', { get: () => c.holder.position.x }); Object.defineProperty(t, 'z', { get: () => c.holder.position.z });
    c.holder.position.set(x, 0, z); c.yaw = opts.yaw || 0; c.holder.visible = true; c.baseName = ''; c.base = null; c.mixer.stopAllAction(); play(c, 'Idle', { fade: 0 }); c.tring.material.color.setHex(teamHex(side)); t.bar.userData.fg.material.color.setHex(side === 'N' ? 0xffb52e : teamHex(side)); setBar(t.bar, 1); t.bar.visible = true; titans.push(t);
    for (let i = 0; i < 8; i++) puff(x + rnd(-1, 1), rnd(.5, 2.5), z + rnd(-1, 1), teamHex(side), .5, .6, 2); return t;
  }
  function titanDied(t, src) { t.dead = true; t.t = 1.6; t.tele.material.opacity = 0; t.bar.visible = false; t.lbl.s.visible = false; play(t.c, 'death1', { fade: .08 }); SFX.play('blast', t.x, t.z); shake = Math.max(shake, .25); if (src && src.H) src.sup = Math.min(1, src.sup + .4); MODE.onTitanKilled(t, src); }
  function clearTitans() { for (const t of titans) { t.c.holder.visible = false; t.c.busy = false; t.bar.visible = false; t.lbl.s.visible = false; scene.remove(t.tele); } titans.length = 0; }
  function updateTitans(dt) {
    for (let i = titans.length - 1; i >= 0; i--) {
      const t = titans[i], c = t.c, p = c.holder.position, R = t.R; t.bar.position.set(p.x, 3.4 * c.holder.scale.x / 1.2, p.z); t.lbl.s.position.set(p.x, 3.4 * c.holder.scale.x / 1.2 + .35, p.z); setHpLabel(t.lbl, Math.max(0, Math.ceil(t.hp)), t.side === 'N' ? '#ffd27a' : teamCss(t.side)); t.lbl.s.visible = !t.dead;
      if (t.dead) { c.mixer.update(dt); if ((t.t -= dt) <= 0) { puff(p.x, 1, p.z, 0xffffff, .6, .5, 2); c.holder.visible = false; c.busy = false; scene.remove(t.tele); titans.splice(i, 1); } continue; }
      const ox = p.x, oz = p.z, foes = t.side === 'N' ? actors : teams[enemyOf(t.side)].members;
      let tgt = null, bd = 3.4, goal = null;
      for (const o of titans) if (!o.dead && o.side !== t.side && o !== t && !(t.side === 'N' && o.side === 'N')) { const d = dist2(o.x, o.z, p.x, p.z); if (d < bd + .8) { bd = d; tgt = o; } }
      if (!tgt) for (const a of foes) { if (!a.alive || a.state === 'fly') continue; const d = dist2(a.x, a.z, p.x, p.z); if (d < bd) { bd = d; tgt = a; } }
      if (t.side === 'N') { // guard the camp: chase whoever comes close or hits it, give up and heal when dragged too far
        const hx = t.home.x, hz = t.home.z, far = dist2(p.x, p.z, hx, hz); if (t.threat && (!t.threat.alive || dist2(t.threat.x, t.threat.z, hx, hz) > 9.5)) t.threat = null;
        if (!t.threat) for (const a of actors) if (a.alive && a.state !== 'fly' && dist2(a.x, a.z, hx, hz) < 5.2) { t.threat = a; break; }
        goal = t.threat ? { x: t.threat.x, z: t.threat.z } : (far > .6 ? { x: hx, z: hz } : null); if (!t.threat && far < 1) t.hp = Math.min(t.maxHp, t.hp + t.maxHp * .08 * dt), setBar(t.bar, t.hp / t.maxHp);
      } else goal = MODE.titanGoal(t);
      let obj = goal && goal.obj && !goal.obj.dead && goal.obj.hp > 0 ? goal.obj : null; if (!tgt && obj && reach({ x: p.x, z: p.z }, obj) < 2.6) tgt = obj;
      if (t.st === 'wind') { t.t -= dt; t.tele.material.opacity = .25 + .4 * (1 - t.t / .7);
        if (t.t <= 0) { t.tele.material.opacity = 0; const tx = t.tele.position.x, tz = t.tele.position.z; if (t.hitObj) hurt(t.hitObj, R.base * (matchT <= RULES.overtime ? 1.4 : 1), t); for (const a of foes) if (a.alive && dist2(a.x, a.z, tx, tz) <= 2.5) hurt(a, R.hit, t); for (const o of titans) if (!o.dead && o !== t && o.side !== t.side && dist2(o.x, o.z, tx, tz) <= 3) hurt(o, R.hit * 4, t); ringFx(tx, tz, 2.1, 0xff3b30, .3); SFX.play('thud', tx, tz); if (t.side !== 'N') shake = Math.max(shake, dist2(player.x, player.z, tx, tz) < 8 ? .12 : 0); t.st = 'rest'; t.t = .8; } }
      else if (t.st === 'rest' && (t.t -= dt) > 0) { play(c, 'Idle', { fade: .2 }); }
      else if (tgt) { t.st = 'wind'; t.t = .7; t.hitObj = tgt.isObj ? tgt : null; c.yaw = tgt.isObj ? yawTo({ x: p.x, z: p.z }, tgt) : yawOf(tgt.x - p.x, tgt.z - p.z); t.tele.scale.setScalar(2.1); t.tele.position.set(p.x + Math.sin(c.yaw) * 1.5, .05, p.z + Math.cos(c.yaw) * 1.5); const clip = Math.random() < .5 ? 'Punching_left' : 'Punching_right'; c.baseName = ''; play(c, clip, { ts: .38 * c.clips[clip].duration / .7, fade: .1 }); }
      else if (goal) { t.st = 'walk'; if (!t.path || (t.pathT -= dt) <= 0) { t.path = findPath(p.x, p.z, goal.x, goal.z); t.pi = 0; t.pathT = 1.5; }
        while (t.pi < t.path.length - 1 && dist2(p.x, p.z, t.path[t.pi].x, t.path[t.pi].z) < 1) t.pi++; const w = t.path[t.pi], d = dist2(p.x, p.z, w.x, w.z); if (d > .3) { c.yaw += angDiff(c.yaw, yawOf(w.x - p.x, w.z - p.z)) * Math.min(1, dt * 6); p.x += (w.x - p.x) / d * R.speed * dt; p.z += (w.z - p.z) / d * R.speed * dt; resolve(p, .7); play(c, 'Running', { ts: R.speed / (c.speed.Running || 5) * 1.05, fade: .2 }); } else play(c, 'Idle', { fade: .2 }); }
      else { t.st = 'walk'; play(c, 'Idle', { fade: .2 }); }
      if (dt > 0) { t.vx = (p.x - ox) / dt; t.vz = (p.z - oz) / dt; } c.holder.rotation.y = c.yaw; if (c.flashT > 0 && (c.flashT -= dt) <= 0) for (const m of c.mats) m.emissiveIntensity = 0; c.mixer.update(dt);
    }
  }

  // ---- heal pads (MODE puts them on the map) ----
  const pads = [];
  function addPad(x, z) { const mesh = lib.medkit_2.clone(); mesh.position.set(x, 0, z); mesh.scale.setScalar(1.6); noCast(mesh); scene.add(mesh); const halo = new THREE.Mesh(new THREE.RingGeometry(.7, .9, 28), new THREE.MeshBasicMaterial({ color: 0x3fdc5d, transparent: true, opacity: .9, depthWrite: false })); halo.rotation.x = -Math.PI / 2; halo.position.set(x, .03, z); scene.add(halo); pads.push({ x, z, mesh, halo, t: 0 }); }
  function updatePads(dt) { for (const m of pads) { if (m.t > 0) { if ((m.t -= dt) <= 0) m.mesh.visible = m.halo.visible = true; continue; } m.mesh.rotation.y += dt; for (const a of actors) if (a.alive && a.hp < a.maxHp && dist2(a.x, a.z, m.x, m.z) < 1.2) { a.hp = Math.min(a.maxHp, a.hp + RULES.pad.heal); popNum(a.x, a.z, '+' + RULES.pad.heal, '#3fdc5d'); m.t = RULES.pad.every; m.mesh.visible = m.halo.visible = false; SFX.play('heal', a.x, a.z); break; } } }

  // ---- one hero, one step ----
  function updateActor(a, dt) {
    const c = a.c, p = c.holder.position, W = a.W; if (c.flashT > 0 && (c.flashT -= dt) <= 0) for (const m of c.mats) m.emissiveIntensity = 0;
    if (!a.alive) { a.lbl.s.visible = false; if (!matchOver && (a.respawnT -= dt) <= 0) respawn(a); return; }
    a.atkCd -= dt; a.prot -= dt; if (a.ammo < RULES.ammo) a.ammo = Math.min(RULES.ammo, a.ammo + dt / W.reload);
    const sp0 = layout.spawns[a.side][1], atBase = dist2(a.x, a.z, sp0[0], sp0[1]) < RULES.baseR + 2.5 && !MODE.roundBased; if (a.hp < a.maxHp && (atBase || NOW - a.lastHit > RULES.regenDelay)) a.hp = Math.min(a.maxHp, a.hp + (atBase ? RULES.baseHeal : RULES.regen) * dt);
    // what the player can see: enemies hidden in bushes vanish, our own team in a bush turns see-through
    const show = DBG.spectate || visibleTo(a, player.side), ghost = a.hidden && a.side === player.side;
    c.holder.visible = show; a.bar.visible = show; a.lbl.s.visible = show; if (c.ghost !== ghost) { setGhost(c, ghost); c.ghost = ghost; }
    setBar(a.bar, a.hp / a.maxHp); a.bar.position.set(p.x, 2.05 + p.y, p.z); a.lbl.s.position.set(p.x, 2.42 + p.y, p.z); setHpLabel(a.lbl, Math.max(0, Math.ceil(a.hp)), a.isPlayer ? '#7dff8e' : teamCss(a.side));
    a.ammoBar.visible = a.isPlayer && !DBG.spectate; if (a.ammoBar.visible) { a.ammoBar.userData.fg.scale.x = Math.max(.001, a.ammoBar.userData.w * a.ammo / RULES.ammo); a.ammoBar.position.set(p.x, 1.86 + p.y, p.z); }
    a.supRing.visible = a.sup >= 1 && show; if (a.supRing.visible) a.supRing.material.opacity = .6 + .35 * Math.sin(NOW * 8);
    const ox = p.x, oz = p.z, inp = a.inp, frozen = freezeT > 0, mag = frozen ? 0 : Math.min(1, Math.hypot(inp.mx, inp.mz)), moving = mag > .12, mdx = moving ? inp.mx / Math.hypot(inp.mx, inp.mz) : 0, mdz = moving ? inp.mz / Math.hypot(inp.mx, inp.mz) : 0;
    if (a.state === 'free') {
      const sp = a.H.speed * Math.min(1, mag * 1.2) * (a.carry ? .78 : 1), k = Math.min(1, dt * RULES.accel); a.mvx += ((moving ? mdx * sp : 0) - a.mvx) * k; a.mvz += ((moving ? mdz * sp : 0) - a.mvz) * k; p.x += a.mvx * dt; p.z += a.mvz * dt; resolve(p, RULES.radius);
      for (const t of titans) if (!t.dead) { const d = dist2(p.x, p.z, t.x, t.z); if (d < 1.2 && d > 1e-3) { p.x = t.x + (p.x - t.x) / d * 1.2; p.z = t.z + (p.z - t.z) / d * 1.2; } }
      const my = yawOf(mdx, mdz), aimed = c.up && !a.carry && (a.aiming || a.shot || a.upT > 0); let anim = 'Idle', ts = 1;
      if (aimed) { c.yaw += angDiff(c.yaw, a.aimYaw - aimOffset(a, W)) * Math.min(1, dt * 18); if (moving) { anim = c.run; ts = clamp(sp / (c.speed[c.run] || 5), .6, 1.6); if (Math.cos(angDiff(c.yaw, my)) < -.2) ts = -ts; } }
      else if (moving) { c.yaw += angDiff(c.yaw, my) * Math.min(1, dt * 12); anim = c.run; ts = clamp(sp / (c.speed[c.run] || 5), .6, 1.6); }
      play(c, anim, { ts, fade: .16 });
    } else if (a.state === 'dash') {
      const s = Math.min(a.sub.left, 19 * dt), bx = p.x, bz = p.z; a.sub.left -= s; p.x += Math.sin(c.yaw) * s; p.z += Math.cos(c.yaw) * s; resolve(p, RULES.radius); play(c, c.run, { ts: 1.8, fade: .05 }); puff(p.x, .5, p.z, teamHex(a.side), .28, .3, 1.6);
      for (const t of enemiesOf(a.side, true)) if (!a.sub.hit.has(t) && reach(a, t) < 1.5) { a.sub.hit.add(t); hurt(t, 55, a); }
      if (a.sub.left <= 1e-3 || dist2(bx, bz, p.x, p.z) < s * .3) { a.state = 'free'; a.mvx = a.mvz = 0; }
    } else if (a.state === 'fly') {
      const F = a.sub; F.fuel -= dt; if (moving) { F.dx = mdx; F.dz = mdz; } c.yaw += angDiff(c.yaw, yawOf(F.dx, F.dz)) * Math.min(1, dt * 6); const over = blocked(p.x, p.z, RULES.radius);
      if (F.fuel > 0) { p.y = Math.min(4.6, p.y + dt * 7); p.x += F.dx * 7 * dt * (moving ? 1 : .4); p.z += F.dz * 7 * dt * (moving ? 1 : .4); } else if (over) { p.x += F.dx * 6 * dt; p.z += F.dz * 6 * dt; } else p.y = Math.max(0, p.y - dt * 9);
      resolve(p, RULES.radius, Math.max(0, p.y - .2)); const jp = c.held.jetpack; if (jp && jp.parent && c.visible) { const n = jp.localToWorld(V3(0, -.28, -.04)); puff(n.x, n.y, n.z, Math.random() < .5 ? 0xff9a2a : 0xffd04a, .1, .2, 1.4); }
      if (F.fuel <= 0 && p.y <= 0 && !over) { a.state = 'free'; c.baseName = ''; a.mvx = a.mvz = 0; ringFx(p.x, p.z, 3, 0xff9a2a, .4); SFX.play('blast', p.x, p.z); for (const t of enemiesOf(a.side, true)) if (reach(a, t) < 3) hurt(t, 40, a); }
    }
    if (a.shot && (a.shot.t -= dt) <= 0) { a.shot = null; landAttack(a); } if (a.shot2 > 0 && (a.shot2 -= dt) <= 0 && a.alive) fireOne(a);
    if (a.upT > 0) a.upT -= dt; if (c.up && !c.up.hold && a.upT <= 0 && !a.shot) upperStop(c, .2);
    if (dt > 0) { a.vx = (p.x - ox) / dt; a.vz = (p.z - oz) / dt; } c.holder.rotation.y = c.yaw;
  }

  // ---- match flow ----
  function endMatch(side, why) { if (matchOver) return; matchOver = { side, why }; for (const a of actors) if (a.alive) { a.inp.mx = a.inp.mz = 0; a.shot = null; if (a.c.up) upperStop(a.c, .1); a.state = 'end'; a.c.holder.position.y = 0; a.c.baseName = ''; a.c.holder.visible = true; setGhost(a.c, false); play(a.c, side === null ? 'Idle' : (a.side === side ? ['Victory', 'Victory2'] : ['Defeat', 'Defeat2'])[Math.random() * 2 | 0], { fade: .2 }); } SFX.play(side === null ? 'lost' : side === player.side ? 'win' : 'lose'); showEnd(); }
  function timeUp() { MODE.timeUp(); }
  let showEnd = () => { };

  // =====================================================================================================
  // x_city: CITY HALL. Knock down the hall in the middle (it shoots back), then hold the Hot Zone where it stood.
  // On the way: plug a power cable from reel to socket to light up a MEDIC square for your team (enemies can unplug it),
  // and beat the neutral titan in a camp - it gets up again on YOUR side and marches on the hall.
  // =====================================================================================================
  const CITY = { hallHp: 4500, campFirst: 25, gunR: 7.2, gunDmg: 11, gunEvery: 1.3, zoneR: 4.2, zoneRate: 1.5, zoneBonus: 10, grab: .5, unplug: 2.4, cableMax: 16, medic: 42, campBack: 38 };
  MODE.name = 'CITY HALL'; RULES.match = 240; RULES.overtime = 60; matchT = RULES.match;
  // ---- floor paint ----
  { const cv = document.createElement('canvas'); cv.width = 280; cv.height = 460; const x = cv.getContext('2d'), X = v => (v + HW) * 10, Z = v => (v + HL) * 10;
    const zone = (z0, z1, col) => { const g = x.createLinearGradient(0, Z(z0), 0, Z(z1)); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, Math.min(Z(z0), Z(z1)), 280, Math.abs(Z(z1) - Z(z0))); };
    zone(HL, HL - 5.5, 'rgba(47,139,255,.3)'); zone(-HL, -HL + 5.5, 'rgba(255,77,66,.3)');
    x.strokeStyle = THEME.paint; x.lineWidth = 3; x.setLineDash([12, 9]); x.beginPath(); x.arc(X(0), Z(0), CITY.zoneR * 10, 0, 7); x.stroke(); x.setLineDash([]);
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * HW, 2 * HL), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = .012; m.renderOrder = 1; scene.add(m); }

  // ---- the City Hall: neutral, armed, and the whole first half of the match ----
  const hallCol = solids.find(c => c.hall);
  const hall = { isObj: true, side: 'N', x: 0, z: 0, hx: 2.7, hz: 2.2, hp: CITY.hallHp, maxHp: CITY.hallHp, col: hallCol, dead: false, hitT: 0, fireT: 1.5, burst: 0, burstT: 0, aim: null, name: 'העירייה', dmg: { A: 0, B: 0 }, model: null };
  { const m = lib.city_hall.clone(); const bb = new THREE.Box3().setFromObject(m), sz = bb.getSize(new THREE.Vector3()), k = Math.min(5.6 / sz.x, 4.6 / sz.z); m.scale.setScalar(k); const bb2 = new THREE.Box3().setFromObject(m), cx = (bb2.min.x + bb2.max.x) / 2, cz = (bb2.min.z + bb2.max.z) / 2; m.position.set(-cx, -bb2.min.y, -cz); const g = new THREE.Group(); g.add(m); scene.add(g); m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); hall.model = g; hall.top = bb2.max.y - bb2.min.y;
    hall.gun = lib.turret.clone(); hall.gun.position.set(0, hall.top - .05, 0); hall.gun.scale.setScalar(.8); g.add(hall.gun);
    hall.bar = makeBar(3.6, 0xffb52e); hall.bar.position.set(0, hall.top + 1.6, 0); hall.bar.scale.set(1, 1.5, 1); scene.add(hall.bar); hall.lbl = makeHpLabel(); hall.lbl.s.scale.set(1.5, .56, 1); hall.lbl.s.position.set(0, hall.top + 2.15, 0);
    hall.ring = new THREE.Mesh(new THREE.RingGeometry(CITY.gunR - .12, CITY.gunR, 64), new THREE.MeshBasicMaterial({ color: 0xff7a4d, transparent: true, opacity: .3, depthWrite: false })); hall.ring.rotation.x = -Math.PI / 2; hall.ring.position.y = .03; scene.add(hall.ring); }
  hall.onHurt = (dmg, src) => { const s = src && (src.side === 'A' || src.side === 'B') ? src.side : null; if (s) hall.dmg[s] += dmg; if (hall.hp <= 0) hallDown(s); };
  const zone = { on: false, p: { A: 0, B: 0 }, disc: null, contested: false };
  zone.disc = new THREE.Mesh(new THREE.CircleGeometry(CITY.zoneR, 48), new THREE.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: .22, depthWrite: false })); zone.disc.rotation.x = -Math.PI / 2; zone.disc.position.y = .03; zone.disc.visible = false; scene.add(zone.disc);
  zone.edge = new THREE.Mesh(new THREE.RingGeometry(CITY.zoneR - .2, CITY.zoneR, 64), new THREE.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: .9, depthWrite: false })); zone.edge.rotation.x = -Math.PI / 2; zone.edge.position.y = .035; zone.edge.visible = false; scene.add(zone.edge);
  const rubble = new THREE.Group(); scene.add(rubble); rubble.visible = false;
  for (let i = 0; i < 16; i++) { const id = ['brick_pallet_1', 'brick_pallet_2', 'rock_1', 'rock_3', 'rock_5', 'brick_1', 'plank_1', 'cardboard_box_2'][i % 8], src = lib[id]; if (!src) continue; const m = src.clone(); m.position.set(rnd(-2.6, 2.6), 0, rnd(-2.1, 2.1)); m.rotation.y = Math.random() * 6.3; m.scale.setScalar(rnd(1, 1.6)); m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); rubble.add(m); }
  function hallDown(s) {
    hall.dead = true; hall.model.visible = false; hall.bar.visible = false; hall.lbl.s.visible = false; hall.ring.visible = false; rubble.visible = true; const i = solids.indexOf(hallCol); if (i >= 0) solids.splice(i, 1); buildNav();
    for (let k = 0; k < 26; k++) puff(rnd(-2.6, 2.6), rnd(.5, 4), rnd(-2.2, 2.2), k % 2 ? 0xd8cbb0 : 0x6b6f78, rnd(.4, .9), rnd(.6, 1.2), 2.4); ringFx(0, 0, 6, 0xffd21f, .8); shake = .8; SFX.play('blast'); SFX.play('blast', 1, 1);
    zone.on = true; zone.disc.visible = zone.edge.visible = true; const lead = hall.dmg.A === hall.dmg.B ? null : hall.dmg.A > hall.dmg.B ? 'A' : 'B'; if (lead) zone.p[lead] = CITY.zoneBonus;
    banner('העירייה קרסה! תפסו את ה-Hot Zone', '#ffd21f', 3); feed((lead ? sideName(lead) + ' גרמו יותר נזק: +' + CITY.zoneBonus + '% התחלה' : 'נזק שווה לעירייה'), lead || 'A');
    for (const a of actors) if (a.brain) a.brain.goal = null;
  }
  function updateHall(dt) {
    if (hall.dead) return; setBar(hall.bar, hall.hp / hall.maxHp); setHpLabel(hall.lbl, Math.ceil(hall.hp), '#ffd27a'); if (hall.hitT > 0) hall.hitT -= dt;
    const foes = () => { const o = []; for (const t of titans) if (!t.dead && t.side !== 'N' && dist2(t.x, t.z, 0, 0) <= CITY.gunR + 1) o.push(t); for (const e of actors) if (e.alive && e.prot <= 0 && e.state !== 'fly' && reach(e, hall) <= CITY.gunR - 2.4 && !e.hidden) o.push(e); return o; };
    if (hall.burst > 0) { if ((hall.burstT -= dt) <= 0) { hall.burstT = .1; hall.burst--; const t = hall.aim; if (t && (t.alive || (t.isTitan && !t.dead))) { const d = dist2(t.x, t.z, 0, 0), tt = d / 36, px = t.x + (t.vx || 0) * tt, pz = t.z + (t.vz || 0) * tt, yaw = yawOf(px, pz), mx = Math.sin(yaw) * 1.2, mz = Math.cos(yaw) * 1.2; hall.gun.rotation.y = yaw; SFX.play('tracer', mx, mz);
          fireShot(hall, 'N', 'tracer', mx, hall.top + .6, mz, yaw, Math.hypot(px - mx, pz - mz) + 1.2, 36, CITY.gunDmg, { overWalls: true, y0: hall.top + .6, foes }); const sh = shots[shots.length - 1]; sh.y1 = 1; } } }
    else if ((hall.fireT -= dt) <= 0) { hall.fireT = CITY.gunEvery; const f = foes(); if (f.length) { f.sort((p, q) => dist2(p.x, p.z, 0, 0) - dist2(q.x, q.z, 0, 0)); hall.aim = f[0]; hall.burst = 3; hall.burstT = 0; } }
  }
  function updateZone(dt) {
    if (!zone.on) return; let nA = 0, nB = 0; for (const a of actors) if (a.alive && a.state !== 'fly' && dist2(a.x, a.z, 0, 0) <= CITY.zoneR) a.side === 'A' ? nA++ : nB++;
    zone.contested = nA > 0 && nB > 0; const rate = CITY.zoneRate * (matchT <= RULES.overtime ? 1.5 : 1) * dt;
    if (!zone.contested && (nA || nB)) { const s = nA ? 'A' : 'B'; zone.p[s] = Math.min(100, zone.p[s] + rate); if (zone.p[s] >= 100) endMatch(s, sideName(s) + ' החזיקו ב-Hot Zone עד הסוף'); }
    const col = zone.contested ? (Math.sin(NOW * 12) > 0 ? 0xffffff : 0xffd21f) : nA ? teamHex('A') : nB ? teamHex('B') : 0xffd21f; zone.edge.material.color.setHex(col); zone.disc.material.color.setHex(col); zone.disc.material.opacity = .16 + .08 * Math.sin(NOW * 4);
  }
  MODE.objs = side => hall.dead ? [] : [hall];

  // ---- power links: carry the cable from the reel to the socket; the square between them heals your team ----
  const cableMat = s => new THREE.MeshBasicMaterial({ color: teamHex(s) });
  const links = [-1, 1].map(s => {
    const x = -10.6 * s, reel = { x, z: 6.8 * s }, plug = { x, z: -6.8 * s }, med = { x, z: 0 };
    const g = new THREE.Group(); scene.add(g);
    const pad = (p, col) => { const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, .12, 1.5), M(0x30353d, { metalness: .4, roughness: .5 })); m.position.set(p.x, .06, p.z); m.receiveShadow = true; g.add(m); const r = new THREE.Mesh(new THREE.RingGeometry(.86, 1.02, 4, 1), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .9, depthWrite: false })); r.rotation.x = -Math.PI / 2; r.rotation.z = Math.PI / 4; r.position.set(p.x, .14, p.z); g.add(r); return r; };
    const reelRing = pad(reel, 0xffd21f), plugRing = pad(plug, 0xffd21f);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, .55, 16), M(0xff9a2a)); drum.rotation.z = Math.PI / 2; drum.position.set(reel.x, .55, reel.z); drum.castShadow = true; g.add(drum);
    const post = new THREE.Mesh(new THREE.BoxGeometry(.4, 1.1, .4), M(0x59606b, { metalness: .5 })); post.position.set(plug.x, .6, plug.z); post.castShadow = true; g.add(post);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.24, 12, 10), M(0xdfe3e8, { emissive: 0x000000 })); bulb.position.set(plug.x, 1.3, plug.z); g.add(bulb);
    // medic square
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const cx = cv.getContext('2d'); cx.fillStyle = 'rgba(255,255,255,.18)'; cx.fillRect(0, 0, 128, 128); cx.strokeStyle = '#fff'; cx.lineWidth = 8; cx.strokeRect(6, 6, 116, 116); cx.fillStyle = '#fff'; cx.fillRect(52, 24, 24, 80); cx.fillRect(24, 52, 80, 24);
    const medT = new THREE.CanvasTexture(cv), medM = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({ map: medT, color: 0x9aa3ad, transparent: true, opacity: .65, depthWrite: false })); medM.rotation.x = -Math.PI / 2; medM.position.set(med.x, .03, med.z); scene.add(medM);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, 1, 6), cableMat('A')); cable.visible = false; scene.add(cable);
    const prog = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.3, 32, 1, 0, .01), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .95, depthWrite: false, side: THREE.DoubleSide })); prog.rotation.x = -Math.PI / 2; prog.position.y = .16; prog.visible = false; scene.add(prog);
    const L = { i: s < 0 ? 0 : 1, reel, plug, med, owner: null, state: 'idle', by: null, grabT: 0, grabBy: null, unT: 0, unBy: null, cable, medM, bulb, prog, reelRing, plugRing, drop: null, isLink: true };
    L.drop = a => { a.carry = null; if (a.c.up && a.c.up.hold) upperStop(a.c, .1); a.c.held[a.W.model].visible = true; L.state = 'idle'; L.by = null; L.cable.visible = false; SFX.play('click', a.x, a.z); };
    return L;
  });
  const _hl = new THREE.Vector3(), _hr = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function cableTo(L, x, y, z) { const a = V3(L.reel.x, .6, L.reel.z), b = V3(x, y, z), d = b.clone().sub(a), len = d.length(); L.cable.position.copy(a).add(b).multiplyScalar(.5); L.cable.scale.set(1, len, 1); L.cable.quaternion.setFromUnitVectors(_up, d.normalize()); L.cable.visible = true; }
  function setProg(L, p, x, z, col) { L.prog.visible = p > 0; if (p <= 0) return; L.prog.geometry.dispose(); L.prog.geometry = new THREE.RingGeometry(1.1, 1.3, 32, 1, Math.PI / 2, Math.PI * 2 * Math.min(1, p)); L.prog.position.set(x, .16, z); L.prog.material.color.setHex(col); }
  function updateLinks(dt) {
    for (const L of links) {
      const blink = Math.sin(NOW * 6) > 0;
      if (L.state === 'carried') { const a = L.by; if (!a.alive) { L.drop(a); continue; } a.c.handL.getWorldPosition(_hl); a.c.handR.getWorldPosition(_hr); cableTo(L, (_hl.x + _hr.x) / 2, (_hl.y + _hr.y) / 2, (_hl.z + _hr.z) / 2);
        if (dist2(a.x, a.z, L.reel.x, L.reel.z) > CITY.cableMax) { L.drop(a); if (a.isPlayer) banner('הכבל קצר מדי!', '#ff6a5e', 1); continue; }
        if (dist2(a.x, a.z, L.plug.x, L.plug.z) < 1.15) { a.carry = null; if (a.c.up && a.c.up.hold) upperStop(a.c, .1); a.c.held[a.W.model].visible = true; L.state = 'on'; L.owner = a.side; L.by = null; cableTo(L, L.plug.x, .9, L.plug.z); L.cable.material = cableMat(a.side);
          ringFx(L.med.x, L.med.z, 2.4, teamHex(a.side), .6); SFX.play(a.side === player.side ? 'gain' : 'lost'); banner(a.side === player.side ? 'החשמל מחובר — ריבוע המדיק שלנו!' : 'היריב חיבר חשמל!', teamCss(a.side), 1.8); feed(a.name + ' חיבר את הכבל', a.side); a.sup = Math.min(1, a.sup + .25); } }
      else if (L.state !== 'on' || true) {
        // grab: stand on the reel (link not ours already)
        let grabber = null; if (L.state === 'idle') for (const a of actors) if (a.alive && a.state === 'free' && !a.carry && dist2(a.x, a.z, L.reel.x, L.reel.z) < 1.05) { grabber = a; break; }
        if (grabber) { if (L.grabBy !== grabber) { L.grabBy = grabber; L.grabT = 0; } L.grabT += dt; setProg(L, L.grabT / CITY.grab, L.reel.x, L.reel.z, teamHex(grabber.side));
          if (L.grabT >= CITY.grab) { const a = grabber; L.state = 'carried'; L.by = a; a.carry = L; cancelAim(a); a.shot = null; a.c.held[a.W.model].visible = false; upperStart(a.c, 'Carry Run', 1, .2, true); L.cable.material = cableMat(a.side); SFX.play('pickup', a.x, a.z); L.grabBy = null; L.prog.visible = false; } }
        else if (L.state === 'idle') { L.grabBy = null; if (!L.unBy) L.prog.visible = false; }
        // unplug: an enemy standing on either pad of a live link
        if (L.state === 'on') { let un = null; for (const a of teams[enemyOf(L.owner)].members) if (a.alive && a.state === 'free' && (dist2(a.x, a.z, L.reel.x, L.reel.z) < 1.15 || dist2(a.x, a.z, L.plug.x, L.plug.z) < 1.15)) { un = a; break; }
          if (un) { if (L.unBy !== un) { L.unBy = un; L.unT = 0; } L.unT += dt; const onReel = dist2(un.x, un.z, L.reel.x, L.reel.z) < 1.15; setProg(L, L.unT / CITY.unplug, onReel ? L.reel.x : L.plug.x, onReel ? L.reel.z : L.plug.z, 0xff6a5e);
            if (L.unT >= CITY.unplug) { const was = L.owner; L.state = 'idle'; L.owner = null; L.cable.visible = false; L.unBy = null; L.prog.visible = false; SFX.play(un.side === player.side ? 'gain' : 'lost'); banner(un.side === player.side ? 'ניתקת את החשמל של היריב!' : 'היריב ניתק לנו את החשמל!', teamCss(un.side), 1.6); feed(un.name + ' ניתק את הכבל', un.side); } }
          else { L.unBy = null; L.unT = Math.max(0, L.unT - dt); if (!L.grabBy) L.prog.visible = false; } }
      }
      const on = L.state === 'on', col = on ? teamHex(L.owner) : 0xffd21f;
      L.bulb.material.color.setHex(on ? col : 0xdfe3e8); L.bulb.material.emissive.setHex(on ? col : 0); L.bulb.material.emissiveIntensity = on ? .9 : 0;
      L.reelRing.material.color.setHex(L.state === 'idle' && blink ? 0xffffff : col); L.plugRing.material.color.setHex(L.state === 'carried' && blink ? 0xffffff : col);
      L.medM.material.color.setHex(on ? col : 0x9aa3ad); L.medM.material.opacity = on ? .55 + .2 * Math.sin(NOW * 4) : .35;
      if (on) for (const a of teams[L.owner].members) if (a.alive && Math.abs(a.x - L.med.x) < 1.7 && Math.abs(a.z - L.med.z) < 1.7 && a.hp < a.maxHp) { a.hp = Math.min(a.maxHp, a.hp + CITY.medic * dt); if (Math.random() < dt * 3) puff(a.x + rnd(-.3, .3), rnd(.5, 1.6), a.z + rnd(-.3, .3), 0x3fdc5d, .12, .5, 1.4); }
    }
  }

  // ---- titan camps: a neutral boss on each half. Beat it and it gets back up on your side ----
  const camps = [{ x: 6.2, z: 12.8 }, { x: -6.2, z: -12.8 }].map((p, i) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.6, 4.9, 48), new THREE.MeshBasicMaterial({ color: 0xffb52e, transparent: true, opacity: .4, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, .025, p.z); scene.add(ring);
    return { i, x: p.x, z: p.z, tier: 1, t: 0, titan: null, ring, pending: null };
  });
  function campSpawn(C) { C.titan = spawnTitan('N', C.tier, C.x, C.z, { home: { x: C.x, z: C.z }, camp: C, hpK: 1, name: 'טיטאן המחנה', yaw: C.z > 0 ? 0 : Math.PI }); }
  MODE.onTitanKilled = (t, src) => {
    if (t.side !== 'N' || !t.camp) { if (t.side !== 'N') banner(t.side === player.side ? 'הטיטאן שלנו נפל' : 'הטיטאן של היריב הושמד!', teamCss(enemyOf(t.side)), 1.6); return; }
    const C = t.camp, d = t.dmgBy, s = (d.A || 0) === (d.B || 0) ? (src && src.side) || 'A' : (d.A || 0) > (d.B || 0) ? 'A' : 'B'; C.titan = null; C.pending = { side: s, t: 1.7, tier: C.tier }; C.t = CITY.campBack; C.tier = Math.min(3, C.tier + 1);
    banner(s === player.side ? 'ניצחנו את הטיטאן — הוא איתנו עכשיו!' : 'היריב השתלט על טיטאן!', teamCss(s), 2.2); feed(sideName(s) + ' השתלטו על טיטאן', s);
  };
  function updateCamps(dt) {
    for (const C of camps) {
      if (C.pending && (C.pending.t -= dt) <= 0) { const P = C.pending; C.pending = null; const t = spawnTitan(P.side, P.tier, C.x, C.z, { hpK: .7, name: 'הטיטאן של ' + sideName(P.side), yaw: P.side === 'A' ? Math.PI : 0 }); if (t) SFX.play('growl'); }
      if (!C.titan && !C.pending && (C.t -= dt) <= 0) { campSpawn(C); feed('טיטאן חדש במחנה!', 'A'); }
      C.ring.material.opacity = C.titan ? .45 + .15 * Math.sin(NOW * 3) : .15;
    }
  }
  MODE.titanGoal = t => { if (!hall.dead) { const s = t.z >= 0 ? 1 : -1; return { x: clamp(t.x, -2, 2), z: 3.6 * s, obj: hall }; } return { x: 0, z: 0 }; };

  // ---- flow ----
  MODE.reset = () => {
    hall.dead = false; hall.hp = hall.maxHp; hall.dmg = { A: 0, B: 0 }; hall.model.visible = hall.bar.visible = hall.lbl.s.visible = hall.ring.visible = true; rubble.visible = false; if (solids.indexOf(hallCol) < 0) { solids.push(hallCol); buildNav(); } hall.fireT = 2; hall.burst = 0;
    zone.on = false; zone.p = { A: 0, B: 0 }; zone.disc.visible = zone.edge.visible = false;
    for (const L of links) { if (L.by) L.drop(L.by); L.state = 'idle'; L.owner = null; L.cable.visible = false; L.prog.visible = false; L.unBy = L.grabBy = null; }
    clearTitans(); for (const C of camps) { C.tier = 1; C.t = CITY.campFirst; C.pending = null; C.titan = null; }
  };
  MODE.update = dt => { updateHall(dt); updateZone(dt); updateLinks(dt); updateCamps(dt); };
  MODE.timeUp = () => {
    if (zone.on) { if (Math.abs(zone.p.A - zone.p.B) < .5) return endMatch(null, 'הזמן נגמר — Hot Zone שווה'); const s = zone.p.A > zone.p.B ? 'A' : 'B'; return endMatch(s, 'הזמן נגמר — ' + sideName(s) + ' החזיקו יותר ב-Hot Zone'); }
    if (Math.abs(hall.dmg.A - hall.dmg.B) < 1) return endMatch(null, 'הזמן נגמר — תיקו'); const s = hall.dmg.A > hall.dmg.B ? 'A' : 'B'; endMatch(s, 'הזמן נגמר — ' + sideName(s) + ' גרמו יותר נזק לעירייה');
  };
  MODE.intro = 'הרסו את העירייה · חברו חשמל · השתלטו על טיטאן';
  // ---- HUD: hall bar with both teams' damage, then the two zone meters; links and camps as icons ----
  MODE.hudHTML = '<div class="team plate" id="tMy"><div class="row"><span>אנחנו</span><b class="num" id="vMy">0</b></div><div class="bar"><i id="bMy" style="width:0"></i></div><small id="sMy">נזק לעירייה</small></div>' +
    '<div id="mid" class="plate"><div id="clock" class="num">4:00</div><div id="otTag" hidden>מתח יתר</div><div id="icons"><i id="ic0" class="bolt"></i><i id="ic2" class="skull"></i><i id="ic3" class="skull"></i><i id="ic1" class="bolt"></i></div></div>' +
    '<div class="team plate" id="tFoe"><div class="row"><span>היריב</span><b class="num" id="vFoe">0</b></div><div class="bar"><i id="bFoe" style="width:0"></i></div><small id="sFoe">נזק לעירייה</small></div>';
  MODE.hud = () => {
    const me = player.side, foe = enemyOf(me);
    if (!zone.on) { const tot = Math.max(1, hall.maxHp); $('vMy').textContent = Math.round(hall.dmg[me]); $('vFoe').textContent = Math.round(hall.dmg[foe]); $('bMy').style.width = (hall.dmg[me] / tot * 100) + '%'; $('bFoe').style.width = (hall.dmg[foe] / tot * 100) + '%'; $('sMy').textContent = $('sFoe').textContent = 'נזק לעירייה · ' + Math.ceil(hall.hp); }
    else { $('vMy').textContent = Math.floor(zone.p[me]) + '%'; $('vFoe').textContent = Math.floor(zone.p[foe]) + '%'; $('bMy').style.width = zone.p[me] + '%'; $('bFoe').style.width = zone.p[foe] + '%'; $('sMy').textContent = $('sFoe').textContent = zone.contested ? 'Hot Zone · במאבק!' : 'Hot Zone'; }
    links.forEach((L, i) => { const el = $('ic' + i); el.style.background = L.state === 'on' ? teamCss(L.owner) : L.state === 'carried' ? '#ffd21f' : '#59606b'; });
    camps.forEach((C, i) => { const el = $('ic' + (i + 2)); el.style.background = C.titan ? '#ffb52e' : C.pending ? teamCss(C.pending.side) : '#3a3f48'; el.classList.toggle('ct', !!(C.titan && C.titan.threat)); });
  };
  MODE.mini = (x, X, Z, k, mdpr) => {
    if (!hall.dead) { x.fillStyle = '#ffb52e'; x.strokeStyle = '#0b0c10'; x.lineWidth = mdpr; x.fillRect(X(-2.7), Z(-2.2), 5.4 * k, 4.4 * k); x.strokeRect(X(-2.7), Z(-2.2), 5.4 * k, 4.4 * k); }
    else { x.beginPath(); x.arc(X(0), Z(0), CITY.zoneR * k, 0, 7); x.fillStyle = 'rgba(255,210,31,.35)'; x.fill(); x.strokeStyle = zone.contested && Math.sin(NOW * 12) > 0 ? '#fff' : '#ffd21f'; x.lineWidth = 2 * mdpr; x.stroke(); }
    for (const L of links) { const col = L.state === 'on' ? teamCss(L.owner) : '#ffd21f'; x.fillStyle = 'rgba(160,170,180,.5)'; x.fillRect(X(L.med.x - 1.6), Z(-1.6), 3.2 * k, 3.2 * k); x.fillStyle = col; for (const p of [L.reel, L.plug]) { x.beginPath(); x.arc(X(p.x), Z(p.z), 1.1 * k, 0, 7); x.fill(); } if (L.state === 'on') { x.strokeStyle = col; x.lineWidth = 2 * mdpr; x.beginPath(); x.moveTo(X(L.reel.x), Z(L.reel.z)); x.lineTo(X(L.plug.x), Z(L.plug.z)); x.stroke(); } }
    for (const C of camps) { x.strokeStyle = 'rgba(255,181,46,.6)'; x.lineWidth = mdpr; x.beginPath(); x.arc(X(C.x), Z(C.z), 4.6 * k, 0, 7); x.stroke(); }
  };

  // ---- bot jobs ----
  const ROLE = { brownhair_kid: 'titan', purplegirl: 'hall', ginger_kid: 'link' };
  MODE.think = (a, set) => {
    const side = a.side, s = side === 'A' ? 1 : -1, mates = teams[side].members.filter(m => m.alive), role = ROLE[a.heroKey];
    if (a.carry && a.carry.isLink) return set({ type: 'go', o: a.carry, x: a.carry.plug.x, z: a.carry.plug.z });
    if (a.hp < a.maxHp * .33) { const med = links.find(L => L.state === 'on' && L.owner === side && dist2(a.x, a.z, L.med.x, L.med.z) < 14); const sp = layout.spawns[side][1]; return set(med ? { type: 'stand', o: med, x: med.med.x, z: med.med.z, flee: true } : { type: 'go', o: sp, x: sp[0], z: sp[1], flee: true }); }
    if (a.brain.goal && a.brain.goal.flee && a.hp < a.maxHp * .8) return true;
    if (zone.on) return set({ type: 'stand', o: zone, x: rnd(-1.5, 1.5) * (a.slot - 1), z: (a.slot - 1) * 1.2 * s, r: CITY.zoneR - .8 });
    const foeT = titans.find(t => !t.dead && t.side === enemyOf(side)); if (foeT) { const order = mates.slice().sort((p, q) => dist2(p.x, p.z, foeT.x, foeT.z) - dist2(q.x, q.z, foeT.x, foeT.z)); if (order.indexOf(a) < 2) return set({ type: 'kill', o: foeT }); }
    const myT = titans.find(t => !t.dead && t.side === side); if (myT && role !== 'link') return set({ type: 'escort', o: myT });
    // links: unplug theirs, grab free ones (one bot per link)
    const busy = L => mates.some(m => m !== a && m.brain && m.brain.goal && m.brain.goal.o === L);
    const want = links.filter(L => (L.state === 'on' && L.owner !== side) || (L.state === 'idle')).sort((p, q) => dist2(a.x, a.z, p.reel.x, p.reel.z) - dist2(a.x, a.z, q.reel.x, q.reel.z));
    if (want.length && (role === 'link' || (dist2(a.x, a.z, want[0].reel.x, want[0].reel.z) < 7 && !busy(want[0])))) { const L = want.find(l => !busy(l)) || want[0]; if (L.state === 'idle') return set({ type: 'stand', o: L, x: L.reel.x, z: L.reel.z, r: .6 }); const p = dist2(a.x, a.z, L.reel.x, L.reel.z) < dist2(a.x, a.z, L.plug.x, L.plug.z) ? L.reel : L.plug; return set({ type: 'stand', o: L, x: p.x, z: p.z, r: .6 }); }
    // camp: the fighter goes for the titan on our half, the others help when it is low
    const camp = camps.find(C => C.titan && !C.titan.dead && s * C.z > 0) || camps.find(C => C.titan && !C.titan.dead);
    if (camp && (role === 'titan' || camp.titan.hp < camp.titan.maxHp * .5 || camp.titan.threat && camp.titan.threat.side === side)) return set({ type: 'kill', o: camp.titan });
    return set({ type: 'hall', o: hall, x: (a.slot - 1) * 3.2, z: 6.4 * s });
  };


  // =====================================================================================================
  // h4: bots. MODE.think() picks a job every ~0.8 s; here they walk to it and fight whatever they can see on the way,
  // with human-ish reaction time and aim. They respect bushes: what they cannot see, they cannot shoot.
  // =====================================================================================================
  function makeBrain(a) { a.brain = { goal: null, path: null, pi: 0, thinkT: rnd(0, .6), pathT: 0, react: .3, strafe: Math.random() < .5 ? 1 : -1, lx: a.x, lz: a.z, stuckT: 0, moveT: 0, nudge: 0 }; }
  function botThink(a) {
    const br = a.brain, set = g => { if (!br.goal || br.goal.type !== g.type || br.goal.o !== g.o) { br.goal = g; br.path = null; } else { br.goal.x = g.x; br.goal.z = g.z; } return true; };
    if (!MODE.think(a, set)) { const s = a.side === 'A' ? 1 : -1; set({ type: 'go', o: 'mid', x: (a.slot - 1) * 3, z: 3 * s }); }
  }
  function botUpdate(a, dt) {
    const br = a.brain, inp = a.inp; inp.mx = inp.mz = 0; if (!a.alive || matchOver || a.state !== 'free' || freezeT > 0) return;
    if ((br.thinkT -= dt) <= 0 || !br.goal) { br.thinkT = rnd(.6, 1.0); botThink(a); } const g = br.goal; if (!g) return;
    const W = a.W, canFight = !a.carry; let dest = null, stop = .4, tgt = null, hold = null;
    if (g.type === 'go') dest = g;
    else if (g.type === 'stand') { dest = g; stop = g.r || .8; hold = g; }
    else if (g.type === 'kill') { tgt = g.o; if (tgt.dead || tgt.alive === false || (tgt.H && !visibleTo(tgt, a.side))) { br.goal = null; return; } }
    else if (g.type === 'escort') { if (g.o.dead) { br.goal = null; return; } const s = a.side === 'A' ? 1 : -1; dest = { x: g.o.x + (a.slot - 1) * 1.6, z: g.o.z + 2.4 * s }; stop = 1.2; }
    else if (g.type === 'hall') { if (g.o.dead) { br.goal = null; return; } dest = g; stop = 1; if (reach(a, g.o) < W.range + .2) tgt = g.o; }
    // fight what is close (and visible), unless carrying or running for health
    if (canFight && !(g.flee && a.hp < a.maxHp * .5)) { const near = bestTarget(a, tgt && tgt.isTitan ? 5 : 9.5, true); if (near) tgt = near; }
    let direct = false;
    if (tgt && canFight) {
      const d = reach(a, tgt), yaw = yawTo(a, tgt), los = tgt.isObj || lineClear(a.x, a.z, tgt.x, tgt.z), R = W.range - (W.melee ? .5 : .6); br.react = Math.max(0, br.react - dt); a.aimYaw = yaw;
      if (d <= R && los) { if (br.react <= 0 && a.ammo >= 1 && startAttack(a, yaw + rnd(-.12, .12))) br.react = rnd(.08, .3); } else br.react = rnd(.25, .45);
      if (a.sup >= 1) { if (a.H.sup === 'charge' && d < 5.5 && los && !tgt.isObj) useSuper(a, yaw); else if (a.H.sup === 'jet' && a.hp < a.maxHp * .4) { inp.mx = -Math.sin(yaw); inp.mz = -Math.cos(yaw); useSuper(a, yaw + Math.PI); } else if (a.H.sup === 'jet' && tgt.H && d < 6 && tgt.hp < 60) useSuper(a, yaw); }
      const tx = tgt.x, tz = tgt.z, danger = tgt.isTitan && tgt.st === 'wind' && dist2(a.x, a.z, tgt.tele.position.x, tgt.tele.position.z) < 2.9;
      if (danger) { const ax = a.x - tgt.tele.position.x, az = a.z - tgt.tele.position.z, l = Math.hypot(ax, az) || 1; inp.mx = ax / l; inp.mz = az / l; direct = true; }
      else if (los && d < 12) { direct = true; const dd = dist2(a.x, a.z, tx, tz) || 1, nx = (tx - a.x) / dd, nz = (tz - a.z) / dd, want = W.melee ? R * .7 : W.range * .72, low = a.ammo < 1 && !W.melee;
        if (tgt.isObj) { if (d > R - .3) { inp.mx = nx; inp.mz = nz; } }
        else if (d > want + .4 && !low) { inp.mx = nx; inp.mz = nz; } else if ((d < want - 1.5 && !W.melee) || low) { inp.mx = -nx * .9; inp.mz = -nz * .9; } else { if (Math.random() < dt * .7) br.strafe = -br.strafe; inp.mx = -nz * br.strafe * .85; inp.mz = nx * br.strafe * .85; }
        // do not walk off the spot we are holding just to chase
        if (hold && dist2(a.x, a.z, hold.x, hold.z) < (hold.r || .8) + .6 && dist2(a.x + inp.mx, a.z + inp.mz, hold.x, hold.z) > (hold.r || .8) + .4) { inp.mx = (hold.x - a.x) * .6; inp.mz = (hold.z - a.z) * .6; } }
      else dest = { x: tx, z: tz };
    }
    if (a.sup >= 1 && a.H.sup === 'heal' && teams[a.side].members.some(m => m.alive && m.hp < m.maxHp * .55 && dist2(a.x, a.z, m.x, m.z) < 3.4)) useSuper(a, a.c.yaw);
    if (!direct && dest) { const d = dist2(a.x, a.z, dest.x, dest.z);
      if (d > stop) { br.pathT -= dt; if (!br.path || br.pathT <= 0 || dist2(br.px, br.pz, dest.x, dest.z) > 2) { br.path = findPath(a.x, a.z, dest.x, dest.z); br.pi = 0; br.pathT = rnd(1.2, 1.8); br.px = dest.x; br.pz = dest.z; }
        while (br.pi < br.path.length - 1 && dist2(a.x, a.z, br.path[br.pi].x, br.path[br.pi].z) < .8) br.pi++; const wp = br.path[br.pi], l = dist2(a.x, a.z, wp.x, wp.z) || 1; inp.mx = (wp.x - a.x) / l; inp.mz = (wp.z - a.z) / l; if (d < 1.4) { inp.mx *= .6; inp.mz *= .6; } } }
    if (Math.hypot(inp.mx, inp.mz) > .3) { br.moveT += dt; if (br.moveT > .5) { if (dist2(a.x, a.z, br.lx, br.lz) < .45) { br.stuckT += br.moveT; br.path = null; if (br.stuckT > .9) { const k = Math.random() < .5 ? 1 : -1, t = inp.mx; br.nx = -inp.mz * k; br.nz = t * k; br.nudge = .35; } } else br.stuckT = 0; br.lx = a.x; br.lz = a.z; br.moveT = 0; } } else br.moveT = 0;
    if (br.nudge > 0) { br.nudge -= dt; inp.mx = br.nx; inp.mz = br.nz; }
  }

  function portraitOf(a) {
    try {
      const rt = new THREE.WebGLRenderTarget(128, 128), cam = new THREE.PerspectiveCamera(28, 1, .1, 30), c = a.c, bg = scene.background; c.holder.rotation.y = c.yaw; c.holder.updateMatrixWorld(true); const wasVis = c.root.visible, wasH = c.holder.visible; c.root.visible = true; c.holder.visible = true; if (!c.base) play(c, 'Idle', { fade: 0 }); c.mixer.update(0); c.holder.updateMatrixWorld(true);
      const head = c.root.getObjectByName('Head').getWorldPosition(V3(0, 0, 0)), f = V3(Math.sin(c.yaw + .45), 0, Math.cos(c.yaw + .45)); cam.position.copy(head).addScaledVector(f, 1.75).add(V3(0, .1, 0)); cam.lookAt(head.x, head.y - .06, head.z);
      scene.background = new THREE.Color(teams[a.side].color === 'blue' ? 0x1c3a6b : 0x6b1f1c); const vis = []; scene.traverse(o => { if ((o.isMesh || o.isSprite || o.isLine) && o.visible) { let p = o, mine = false; while (p) { if (p === c.root) { mine = true; break; } p = p.parent; } if (!mine) { vis.push(o); o.visible = false; } } });
      renderer.setRenderTarget(rt); renderer.render(scene, cam); const px = new Uint8Array(128 * 128 * 4); renderer.readRenderTargetPixels(rt, 0, 0, 128, 128, px); renderer.setRenderTarget(null); for (const o of vis) o.visible = true; scene.background = bg; renderer.shadowMap.needsUpdate = true; c.root.visible = wasVis; c.holder.visible = wasH;
      const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d'), im = x.createImageData(128, 128); for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) { const s0 = ((127 - j) * 128 + i) * 4, d = (j * 128 + i) * 4; for (let k = 0; k < 3; k++) im.data[d + k] = Math.pow(px[s0 + k] / 255, 1 / 2.2) * 255; im.data[d + 3] = 255; }
      x.putImageData(im, 0, 0); const g = x.createLinearGradient(0, 70, 0, 128); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.45)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); rt.dispose(); return cv.toDataURL('image/jpeg', .85);
    } catch (e) { return ''; }
  }


  // =====================================================================================================
  // h5: input (two sticks / mouse + keys), camera, HUD, minimap, hero select, simulation, main loop
  // =====================================================================================================
  $('top').innerHTML = MODE.hudHTML; $('pickTitle').textContent = MODE.name;
  let toastT = 0, bannerT = 0;
  banner = (text, color, secs) => { const b = $('banner'); b.textContent = text; b.style.color = color || '#fff'; b.hidden = false; b.classList.remove('in'); void b.offsetWidth; b.classList.add('in'); bannerT = secs || 2; };
  feed = (t, side) => { const d = document.createElement('div'); d.textContent = t; d.style.borderColor = side ? teamCss(side) : ''; const f = $('feed'); f.appendChild(d); while (f.children.length > 4) f.removeChild(f.firstChild); setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 5000); };
  onPlayerHit = () => { $('vig').style.opacity = '1'; setTimeout(() => { $('vig').style.opacity = '0'; }, 120); };

  // ---------- input ----------
  const keys = new Set(), L = { id: null, ox: 0, oy: 0, x: 0, y: 0 }, Rs = { id: null, ox: 0, oy: 0, x: 0, y: 0, moved: false }, mouse = { down: false, x: 0, y: 0, t: 0 }, SR = 54;
  let usedTouch = false, queued = null, queuedT = 0;
  const lS = $('lStick'), rS = $('rStick'), touchEl = $('touch');
  const home = k => { const w = window.innerWidth, h = window.innerHeight; return k === 'l' ? [104, h - 104] : [w - 104, h - 104]; };
  function placeStick(el, cx, cy, kx, ky, on) { el.style.transform = 'translate(' + (cx - 59) + 'px,' + (cy - 59) + 'px)'; el.firstChild.style.transform = 'translate(' + kx + 'px,' + ky + 'px)'; el.classList.toggle('on', !!on); }
  function restSticks() { const show = (usedTouch || coarse) && !DBG.spectate; lS.hidden = rS.hidden = !show; if (!show) return; if (L.id === null) { const p = home('l'); placeStick(lS, p[0], p[1], 0, 0, false); } if (Rs.id === null) { const p = home('r'); placeStick(rS, p[0], p[1], 0, 0, false); } }
  touchEl.addEventListener('pointerdown', e => {
    if (DBG.spectate) { sd.id = e.pointerId; sd.x = e.clientX; sd.y = e.clientY; return; }
    if (e.pointerType === 'mouse') { if (e.button === 0) { mouse.down = true; mouse.x = e.clientX; mouse.y = e.clientY; mouse.t = performance.now(); } return; }
    usedTouch = true; try { touchEl.setPointerCapture(e.pointerId); } catch (_) { }
    if (e.clientX < window.innerWidth / 2) { if (L.id !== null) return; L.id = e.pointerId; L.ox = e.clientX; L.oy = e.clientY; L.x = L.y = 0; placeStick(lS, L.ox, L.oy, 0, 0, true); }
    else if (Rs.id === null) { Rs.id = e.pointerId; Rs.ox = e.clientX; Rs.oy = e.clientY; Rs.x = Rs.y = 0; Rs.moved = false; placeStick(rS, Rs.ox, Rs.oy, 0, 0, true); }
    restSticks();
  });
  touchEl.addEventListener('pointermove', e => {
    if (DBG.spectate) { if (e.pointerId === sd.id) { spec.follow = null; spec.x -= (e.clientX - sd.x) * .05; spec.z -= (e.clientY - sd.y) * .05; sd.x = e.clientX; sd.y = e.clientY; } return; }
    if (e.pointerType === 'mouse') { mouse.x = e.clientX; mouse.y = e.clientY; return; }
    const s = e.pointerId === L.id ? L : e.pointerId === Rs.id ? Rs : null; if (!s) return; let dx = e.clientX - s.ox, dy = e.clientY - s.oy; const d = Math.hypot(dx, dy); if (s === Rs && d > 16) Rs.moved = true; if (d > SR) { dx *= SR / d; dy *= SR / d; }
    s.x = dx / SR; s.y = dy / SR; placeStick(s === L ? lS : rS, s.ox, s.oy, dx, dy, true);
  });
  const up = e => {
    if (DBG.spectate) { if (e.pointerId === sd.id) sd.id = null; return; }
    if (e.pointerType === 'mouse') { if (mouse.down && e.type === 'pointerup') { mouse.down = false; fireAt(performance.now() - mouse.t > 160 ? assist(player, mouseYaw()) : mouseYaw()); } mouse.down = false; return; }
    if (e.pointerId === L.id) { L.id = null; L.x = L.y = 0; }
    if (e.pointerId === Rs.id) { const moved = Rs.moved, yaw = yawOf(Rs.x, Rs.y), mag = Math.hypot(Rs.x, Rs.y); Rs.id = null; Rs.moved = false; if (e.type === 'pointerup') { if (moved && mag > .25) fireAt(assist(player, yaw)); else if (!moved) fireAt(autoYaw()); else cancelAim(player); } Rs.x = Rs.y = 0; rS.classList.remove('block'); }
    restSticks();
  };
  touchEl.addEventListener('pointerup', up); touchEl.addEventListener('pointercancel', up); touchEl.addEventListener('contextmenu', e => e.preventDefault());
  const gp = new THREE.Plane(new THREE.Vector3(0, 1, 0), -chestY), floor0 = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), gv = new THREE.Vector3(), mRay = new THREE.Raycaster();
  function mouseYaw() { const r = canvas.getBoundingClientRect(); mRay.setFromCamera({ x: (mouse.x - r.left) / r.width * 2 - 1, y: -((mouse.y - r.top) / r.height * 2 - 1) }, camera); const p = mRay.ray.intersectPlane(gp, gv); return p ? yawOf(p.x - player.x, p.z - player.z) : player.c.yaw; }
  function autoYaw() { const t = bestTarget(player, player.W.range + (player.W.melee ? .4 : .3)); return t ? yawTo(player, t) : (player.aiming ? player.aimYaw : player.c.yaw); }
  function fireAt(yaw) { if (!player.alive || matchOver || !started) return; if (!startAttack(player, yaw)) { if (player.ammo < 1) { $('noAmmo').hidden = false; toastT = .5; SFX.play('click', undefined, undefined, .2); } else if (player.atkCd > 0 || player.shot) { queued = yaw; queuedT = .4; } cancelAim(player); } }
  function doSuper() { if (!player.alive || !started) return; if (player.sup < 1) { SFX.play('click'); return; } const aim = Rs.moved && Math.hypot(Rs.x, Rs.y) > .25 ? yawOf(Rs.x, Rs.y) : mouse.down ? mouseYaw() : autoYaw(); useSuper(player, aim); }
  window.addEventListener('keydown', e => { if (/INPUT|SELECT/.test(e.target.tagName)) return; if (!e.repeat && (e.code === 'KeyE' || e.code === 'KeyF' || e.code === 'ShiftLeft' || e.code === 'KeyQ')) { if (DBG.spectate) specCycle(1); else doSuper(); } keys.add(e.code); if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault(); });
  window.addEventListener('keyup', e => keys.delete(e.code)); window.addEventListener('blur', () => { keys.clear(); mouse.down = false; });
  const tap = (el, fn) => el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (e.pointerType !== 'mouse') usedTouch = true; fn(); });
  tap($('btnSuper'), doSuper);
  // aim marker: a lane for shots, a fan for the sword; it stops at walls and turns red there
  const aimLine = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, .5), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .42, depthWrite: false })); aimLine.visible = false; aimLine.renderOrder = 3; scene.add(aimLine);
  const aimFan = new THREE.Mesh(new THREE.RingGeometry(.5, 1, 24, 1, -1.15, 2.3), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .4, depthWrite: false, side: THREE.DoubleSide })); aimFan.rotation.order = 'YXZ'; aimFan.rotation.x = -Math.PI / 2; aimFan.visible = false; aimFan.renderOrder = 3; scene.add(aimFan);
  function playerInput(dt) {
    const a = player, inp = a.inp; let x = L.x, z = L.y; if (keys.has('KeyA')) x -= 1; if (keys.has('KeyD')) x += 1; if (keys.has('KeyW')) z -= 1; if (keys.has('KeyS')) z += 1; const m = Math.hypot(x, z); if (m > 1) { x /= m; z /= m; } inp.mx = x; inp.mz = z;
    aimLine.visible = aimFan.visible = false; if (!a.alive || matchOver || !started) return;
    let aim = null; if (Rs.id !== null && Rs.moved && Math.hypot(Rs.x, Rs.y) > .25) aim = assist(a, yawOf(Rs.x, Rs.y)); else if (mouse.down && performance.now() - mouse.t > 130) aim = assist(a, mouseYaw());
    if (aim !== null) holdAim(a, aim); if (keys.has('Space') && a.atkCd <= 0 && !a.shot && a.ammo >= 1) fireAt(autoYaw());
    if (queued !== null) { queuedT -= dt; if (a.atkCd <= 0 && !a.shot) { if (a.ammo >= 1) startAttack(a, queued); queued = null; } else if (queuedT <= 0) queued = null; }
    if (a.aiming && aim !== null) { const W = a.W, dx = Math.sin(aim), dz = Math.cos(aim);
      if (W.melee) { aimFan.visible = true; aimFan.position.set(a.x, .07, a.z); aimFan.scale.set(W.range, W.range, 1); aimFan.rotation.y = aim - Math.PI / 2; }
      else { const free = rayStatic(a.x, a.z, dx, dz, W.range, 1.0), cut = free < W.range - .05; aimLine.visible = true; aimLine.position.set(a.x, .07, a.z); aimLine.rotation.y = aim; aimLine.scale.set(.5, 1, Math.max(.3, free)); aimLine.material.color.setHex(cut ? 0xff6a5e : 0xffffff); rS.classList.toggle('block', cut); } }
  }

  // ---------- camera ----------
  const camT = new THREE.Vector3(), CAM = { y: 11.2, z: 8.2 }, spec = { x: 0, z: 0, follow: null, zoom: 1.7 }, sd = { id: null, x: 0, y: 0 }; let zoom = 1;
  function resize() { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 54 : 40; zoom = w < h ? 1.35 : 1.12; camera.updateProjectionMatrix(); restSticks(); }
  window.addEventListener('resize', resize); window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  function specCycle(d) { let i = spec.follow ? actors.indexOf(spec.follow) : -1; spec.follow = actors[(i + d + actors.length) % actors.length]; }
  touchEl.addEventListener('wheel', e => { if (DBG.spectate) { spec.zoom = clamp(spec.zoom * (e.deltaY > 0 ? 1.1 : .9), .7, 3); e.preventDefault(); } }, { passive: false });
  function updateCamera(dt, snap) {
    let tx, tz, z2 = zoom;
    if (DBG.spectate) { let mx = 0, mz = 0; if (keys.has('KeyA')) mx -= 1; if (keys.has('KeyD')) mx += 1; if (keys.has('KeyW')) mz -= 1; if (keys.has('KeyS')) mz += 1; if (mx || mz) { spec.follow = null; spec.x += mx * 20 * dt; spec.z += mz * 20 * dt; } spec.x = clamp(spec.x, -HW, HW); spec.z = clamp(spec.z, -HL, HL); tx = spec.follow ? spec.follow.x : spec.x; tz = spec.follow ? spec.follow.z : spec.z; z2 *= spec.zoom; }
    else { tx = clamp(player.x, -HW + 6, HW - 6); tz = player.z - 2.4; }
    camT.set(tx, CAM.y * z2 + (DBG.spectate ? 0 : player.c.holder.position.y * .4), tz + CAM.z * z2); if (snap) camera.position.copy(camT); else camera.position.lerp(camT, Math.min(1, dt * 7));
    if (shake > 0) { shake = Math.max(0, shake - dt * 1.6); camera.position.x += rnd(-1, 1) * shake * .35; camera.position.z += rnd(-1, 1) * shake * .35; }
    camera.lookAt(camera.position.x, 1, camera.position.z - CAM.z * z2);
  }

  // ---------- HUD ----------
  function buildMates() { const box = $('mates'); box.innerHTML = ''; for (const a of teams[player.side].members) { const d = document.createElement('div'); d.className = 'mate' + (a === player ? ' me' : ''); d.innerHTML = '<img alt=""><em></em><i><b></b></i>'; d.querySelector('img').src = a.pic || ''; box.appendChild(d); a.mateEl = d; } }
  const fmt = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  function updateHud() {
    const a = player, t = Math.max(0, matchT), ot = t <= RULES.overtime && !MODE.roundBased; $('clock').textContent = fmt(t); $('clock').classList.toggle('ot', ot); if (!MODE.roundBased) $('otTag').hidden = !ot || !started;
    MODE.hud();
    for (const m of teams[a.side].members) { if (!m.mateEl) continue; m.mateEl.classList.toggle('dead', !m.alive); m.mateEl.querySelector('em').textContent = m.alive ? '' : (MODE.roundBased ? '✕' : Math.ceil(m.respawnT)); m.mateEl.querySelector('b').style.width = (Math.max(0, m.hp) / m.maxHp * 100) + '%'; }
    const sb = $('btnSuper'); sb.classList.toggle('ready', a.sup >= 1); sb.style.setProperty('--k', (a.sup * 360) + 'deg'); $('supName').textContent = a.H.supName;
    $('dead').hidden = a.alive || !!matchOver || DBG.spectate; if (!a.alive) $('dead').textContent = MODE.roundBased ? 'נפלת — הצופים על החברים' : 'חוזרים בעוד ' + Math.ceil(a.respawnT);
    $('carry').hidden = !a.carry; if (toastT > 0 && (toastT -= .033) <= 0) $('noAmmo').hidden = true;
  }
  // ---------- minimap ----------
  const mini = $('mini'), mctx = mini.getContext('2d'), mdpr = Math.min(2, dpr), MS = 2.9; mini.style.width = (2 * HW * MS) + 'px'; mini.style.height = (2 * HL * MS) + 'px'; mini.width = 2 * HW * MS * mdpr; mini.height = 2 * HL * MS * mdpr;
  function drawMini() {
    const x = mctx, k = MS * mdpr, X = v => (v + HW) * k, Z = v => (v + HL) * k, W = mini.width, H = mini.height; x.clearRect(0, 0, W, H); x.fillStyle = '#2b313b'; x.fillRect(0, 0, W, H);
    x.globalAlpha = .35; x.fillStyle = teamCss('A'); x.fillRect(0, Z(HL - 5), W, H - Z(HL - 5)); x.fillStyle = teamCss('B'); x.fillRect(0, 0, W, Z(-HL + 5)); x.globalAlpha = 1; x.fillStyle = 'rgba(80,170,70,.75)'; for (const b of bushes) x.fillRect(X(b.x - b.w), Z(b.z - b.d), b.w * 2 * k, b.d * 2 * k);
    x.fillStyle = '#5b6470'; for (const c of solids) if (c.t === 'b' && c.kind === 'ob') { x.save(); x.translate(X(c.x), Z(c.z)); x.rotate(-c.ry); x.fillRect(-c.hx * k, -c.hz * k, c.hx * 2 * k, c.hz * 2 * k); x.restore(); }
    MODE.mini(x, X, Z, k, mdpr);
    for (const t of titans) if (!t.dead) { x.fillStyle = t.side === 'N' ? '#ffb52e' : teamCss(t.side); x.strokeStyle = '#fff'; x.lineWidth = 2 * mdpr; x.beginPath(); x.rect(X(t.x) - 2.2 * k, Z(t.z) - 2.2 * k, 4.4 * k, 4.4 * k); x.fill(); x.stroke(); }
    for (const a of actors) { if (!a.alive || (!DBG.spectate && a.side !== player.side && (a.hidden || dist2(a.x, a.z, player.x, player.z) > 11))) continue; x.fillStyle = a === player && !DBG.spectate ? '#ffd21f' : teamCss(a.side); x.strokeStyle = '#0b0c10'; x.lineWidth = mdpr; x.beginPath(); x.arc(X(a.x), Z(a.z), (a === player ? 2.2 : 1.7) * k, 0, 7); x.fill(); x.stroke(); }
  }

  // ---------- start: all six heroes exist from the beginning; you pick which of the blue ones is yours ----------
  const HKEYS = Object.keys(HEROES);
  for (const side of ['A', 'B']) HKEYS.forEach((k, i) => makeActor(k, side, i));
  for (const a of actors) { respawn(a); a.prot = 0; makeBrain(a); }
  player = teams.A.members[0]; resize(); renderer.setPixelRatio(Math.min(2, dpr)); resize(); updateCamera(0, true);
  for (const a of teams.A.members) a.pic = portraitOf(a);
  { const box = $('heroes'); teams.A.members.forEach(a => { const b = document.createElement('button'); b.type = 'button'; b.className = 'hero'; b.innerHTML = '<img alt=""><b></b><span></span><small></small><em></em>'; b.querySelector('img').src = a.pic; b.querySelector('b').textContent = a.H.name; b.querySelector('span').textContent = a.H.role + ' · ' + a.H.hp + ' חיים'; b.querySelector('small').textContent = a.H.tip; b.querySelector('em').textContent = 'סופר: ' + a.H.supName; b.onclick = () => startMatch(a); box.appendChild(b); }); }
  function resetMatch() {
    matchOver = null; matchT = RULES.match; freezeT = 0; $('end').hidden = true; for (const s of shots) scene.remove(s.m); shots.length = 0; for (const f of fields) { scene.remove(f.ring); scene.remove(f.kit); } fields.length = 0;
    for (const s of ['A', 'B']) { teams[s].kills = 0; teams[s].score = 0; } for (const m of pads) { m.t = 0; m.mesh.visible = m.halo.visible = true; }
    for (const a of actors) { a.kills = a.dmg = a.deaths = 0; a.sup = 0; a.carry = null; if (a.c.up) upperStop(a.c, 0); respawn(a); a.prot = 0; makeBrain(a); } MODE.reset(); lastSec = 999;
  }
  function startMatch(a) { if (a) { player.isPlayer = false; player = a; } player.isPlayer = true; resetMatch(); started = true; $('pick').hidden = true; buildMates(); updateCamera(0, true); restSticks(); banner(MODE.intro, '#ffd21f', 3); setTimeout(() => feed('מפה: ' + THEME.name, player.side), 600); SFX.play('start'); }
  showEnd = () => { const s = matchOver.side, me = player; $('endTitle').textContent = s === null ? 'תיקו' : s === me.side ? 'ניצחון!' : 'הפסד'; $('endTitle').style.color = s === null ? '#fff' : s === me.side ? '#3fdc5d' : '#ff5548'; $('endWhy').textContent = matchOver.why;
    $('endStats').innerHTML = teams[me.side].members.map(m => '<div' + (m === me ? ' class="me"' : '') + '><b>' + m.name + '</b> חיסולים ' + m.kills + ' · נזק ' + Math.round(m.dmg) + ' · נפילות ' + m.deaths + '</div>').join(''); if (!DBG.sim) setTimeout(() => { if (matchOver) $('end').hidden = false; }, 1500); if (window.ARENA_SHELL && !DBG.sim && !DBG.spectate) { const r = ARENA_SHELL.result({ mode: GAME_MODE, hero: ARENA_SHELL.prof.hero, win: s === me.side, draw: s === null, kills: me.kills }); if (r && window.showReward) showReward(r); } };
  $('endBtn').onclick = () => { $('end').hidden = true; if (window.ARENA_SHELL) { ARENA_SHELL.again(); startMatch(player); } else { started = false; $('pick').hidden = false; resetMatch(); } };

  // ---------- debug ----------
  const CHECKS = [['sim', 'סימולציה: בוטים בלבד, מהיר, סטטיסטיקה'], ['spectate', 'מצב צופה (גרירה / WASD, Q לשחקן הבא)'], ['god', 'בלי למות'], ['bots', 'בוטים פעילים'], ['sound', 'צלילים'], ['stats', 'FPS']];
  function syncDbg() { if (DBG.sim) { DBG.spectate = true; DBG.bots = true; DBG.sound = false; if (!started) startMatch(null); } for (const [k] of CHECKS) $('chk_' + k).checked = !!DBG[k]; document.body.classList.toggle('spec', !!DBG.spectate); $('simBox').hidden = !DBG.sim; $('stats').hidden = !DBG.stats; restSticks(); }
  for (const [k, label] of CHECKS) { const l = document.createElement('label'); l.className = 'chk'; l.innerHTML = '<input type="checkbox" id="chk_' + k + '"><span></span>'; l.lastChild.textContent = label; $('checks').appendChild(l); l.firstChild.addEventListener('change', e => { DBG[k] = e.target.checked; syncDbg(); }); }
  const ACTS = [['טיטאן לנו', () => { spawnTitan('A', 2, 0, 12, { hpK: .7 }); }], ['טיטאן ליריב', () => { spawnTitan('B', 2, 0, -12, { hpK: .7 }); }], ['סופר מלא', () => { player.sup = 1; }], ['שעון ל-1:00', () => { matchT = 60; }], ['משחק חדש', () => { resetMatch(); }], ['מפה הבאה', () => { const ids = THEME_IDS, n = ids[(ids.indexOf(THEME_ID) + 1) % ids.length]; if (window.ARENA_SHELL) { ARENA_SHELL.prof.nextMap = n; ARENA_SHELL.save(); } location.reload(); }], ['מסך מלא', () => { try { const el = document.documentElement, f = el.requestFullscreen || el.webkitRequestFullscreen; if (f) { const r = f.call(el); if (r && r.catch) r.catch(() => { }); } } catch (e) { } }]];
  for (const [label, fn] of ACTS) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = fn; $('acts').appendChild(b); }
  $('menuBtn').onclick = () => { $('panel').hidden = !$('panel').hidden; }; $('closeMenu').onclick = () => { $('panel').hidden = true; };
  const sim = { list: [], done: false, wait: 0 };
  function simTick(rdt) {
    if (matchOver && !sim.done) { sim.done = true; sim.wait = 1; sim.list.push({ win: matchOver.side, t: MODE.roundBased ? 0 : RULES.match - matchT, why: matchOver.why, ka: teams.A.kills, kb: teams.B.kills }); }
    if (sim.done && (sim.wait -= rdt) <= 0) { sim.done = false; resetMatch(); }
    if (frame % 15) return; const Lm = sim.list, wa = Lm.filter(m => m.win === 'A').length, wb = Lm.filter(m => m.win === 'B').length, avg = f => Lm.length ? Lm.reduce((s, m) => s + f(m), 0) / Lm.length : 0;
    let o = MODE.name + ' · ' + THEME.name + ' · משחק ' + (Lm.length + 1) + ' · ' + fmt(RULES.match - matchT) + ' · חיסולים ' + teams.A.kills + '–' + teams.B.kills + '\n';
    o += 'נצחונות A ' + wa + ' · B ' + wb + ' · תיקו ' + (Lm.length - wa - wb) + ' · אורך ממוצע ' + fmt(avg(m => m.t)) + ' · חיסולים ' + avg(m => m.ka + m.kb).toFixed(1) + '\n';
    for (const m of Lm.slice(-7)) o += (m.win || '=') + ' ' + fmt(m.t) + ' · ' + m.why + ' · חיסולים ' + m.ka + '–' + m.kb + '\n'; $('simBox').textContent = o;
  }

  // ---------- go ----------
  syncDbg(); try { renderer.compile(scene, camera); } catch (e) { } $('loading').hidden = true;
  const clock = new THREE.Clock(), frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere(new THREE.Vector3(), 1.7); let frame = 0, fpsT = 0, fpsN = 0, lastSec = 999, slowT = 0;
  function stepGame(dt) {
    NOW += dt; const auto = DBG.spectate || DBG.sim;
    if (auto) botUpdate(player, dt); else playerInput(dt);
    for (const a of actors) { if (a === player) continue; if (DBG.bots && started) botUpdate(a, dt); else a.inp.mx = a.inp.mz = 0; }
    if (!matchOver) for (const a of actors) updateActor(a, dt);
    updateTitans(dt);
    if (!matchOver && started) { if (freezeT > 0) freezeT -= dt; updateVis(); updateShots(dt); MODE.update(dt); updateFields(dt); updatePads(dt); if (freezeT <= 0 && (matchT -= dt) <= 0) timeUp(); }
  }
  function loop() {
    requestAnimationFrame(loop); const rdt = Math.min(.05, clock.getDelta()); frame++;
    let hs = 1; if (hitStop > 0) { hitStop -= rdt; hs = .15; } const steps = DBG.sim ? 8 : 1, dt = DBG.sim ? .05 : rdt * DBG.speed * hs; if (started) for (let k = 0; k < steps; k++) stepGame(dt); else NOW += rdt; if (DBG.sim) simTick(rdt); updateDress(NOW);
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
    for (const a of actors) { const c = a.c; sph.center.set(a.x, 1, a.z); c.visible = frustum.intersectsSphere(sph); c.root.visible = c.visible; if (c.visible || a.carry) { c.mixer.update(started ? dt * steps : rdt); } }
    updateFx(rdt); updatePops(rdt); updateCamera(rdt); renderer.render(scene, camera);
    if ((frame & 1) === 0) updateHud(); if (frame % 3 === 0) drawMini();
    if (bannerT > 0 && (bannerT -= rdt) <= 0) $('banner').hidden = true;
    if (started && !matchOver) { const sec = Math.ceil(matchT); if (sec !== lastSec) { if (sec === RULES.overtime) { banner('מתח יתר! טעינה כפולה, טיטאנים חזקים יותר', '#ff9a2a', 2.8); SFX.play('warn'); } if (sec <= 10 && sec > 0) SFX.play('tick'); lastSec = sec; } }
    fpsT += rdt; fpsN++; if (fpsT >= 1) { const fps = fpsN / fpsT; fpsT = 0; fpsN = 0; if (DBG.stats) $('stats').textContent = fps.toFixed(0) + ' fps · ' + renderer.info.render.calls + ' calls · ' + (renderer.info.render.triangles / 1000 | 0) + 'k'; slowT = fps < 42 ? slowT + 1 : 0; if (slowT >= 3 && renderer.getPixelRatio() > 1.25) { renderer.setPixelRatio(renderer.getPixelRatio() - .25); resize(); slowT = 0; } }
  }
  if (window.ARENA_SHELL) { const hk = ARENA_SHELL.prof.hero, me = teams.A.members.find(m => m.c.id === hk || m.H === HEROES[hk]) || teams.A.members[0]; startMatch(me); }
  SFX.setListener(() => player && (DBG.spectate ? { x: camera.position.x, z: camera.position.z - CAM.z } : player));
  loop();
}
setTimeout(() => boot().catch(e => { fail('שגיאה: ' + (e && e.message)); console.error(e); }), 30);
})();
