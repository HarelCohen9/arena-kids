// Arena game client: loads GLB models + layout.json, bakes the static map, runs movement, collision and shooting.
(function () {
'use strict';
const $ = id => document.getElementById(id), BASE = 'assets/';
function fail(msg) { const l = $('loading'); l.hidden = false; l.classList.add('err'); $('loadText').textContent = msg; }
window.addEventListener('error', e => fail('שגיאה: ' + (e.message || '')));
window.addEventListener('unhandledrejection', e => fail('שגיאה: ' + ((e.reason && e.reason.message) || e.reason || '')));

async function boot() {
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
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xbfe4ff);
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 700);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9a88f, .62));
  const sun = new THREE.DirectionalLight(0xfff6e6, .95); sun.position.set(-42, 90, 52); scene.add(sun); scene.add(sun.target);
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
  const jobs = need.concat(['city_hall', 'medkit_2', 'jersey_plastic_1']).map(id => ({ id: id, url: BASE + 'models/' + id + '.glb', to: lib }));
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
  const asT = noiseTex('#4a5560', [['#55555b', 60, 26, .1], ['#2c2c30', 70, 22, .12], ['#6c6c72', 5200, 1.1, .5], ['#232327', 5200, 1.2, .55], ['#8d8d92', 900, .8, .6], ['#4a463f', 500, 1.6, .35]], 1024); asT.repeat.set(2 * HW / 7, 2 * HL / 7);
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(2 * HW, 2 * HL), new THREE.MeshStandardMaterial({ map: asT, roughness: .95, metalness: 0 })); asphalt.rotation.x = -Math.PI / 2; asphalt.receiveShadow = true; scene.add(asphalt);
  const diT = noiseTex('#b08a5e', [['#c29d6f', 50, 30, .12], ['#9a7850', 60, 26, .12], ['#8c6c47', 3000, 1.3, .4], ['#cdaa7c', 3000, 1.2, .4], ['#6f573b', 500, 1.8, .4]], 1024); diT.repeat.set(70, 70);
  const dirt = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ map: diT, roughness: 1, metalness: 0 })); dirt.rotation.x = -Math.PI / 2; dirt.position.y = -.03; dirt.receiveShadow = true; scene.add(dirt);
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
    c.h = c.kind === 'wall' ? 9 : c.kind === 'bld' ? Math.max(h, 3) : (h || 1.2);
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
  // h3: TITAN RUSH. The arena, the three heroes, pylons, the battery, titans, reactors.
  // Goal: destroy the enemy reactor. You can't do it alone - reactors shred heroes - so teams hold pylons to
  // charge up a Titan that marches on the enemy base. Everything a hero does feeds that loop.
  // =====================================================================================================
  const RULES = {
    radius: .42, accel: 12, respawn: 5, regenDelay: 3.5, regen: 14, baseHeal: 45, baseR: 5, spawnProt: 2,
    match: 345, overtime: 75,                       // 5:45 in all; the last 1:15 is overtime (double charge)
    ammo: 3, pylonR: 3.6, capTime: 3.2, charge: 1.5,  // charge per second for each pylon a team holds
    battery: { first: 35, every: 45, charge: 30, heal: 200, slow: .8, idle: 14 },
    reactor: { hp: 3000, range: 9, dmg: 11, burst: 3, every: 1.25, vsTitan: 2.2 },
    titan: [null, { hp: 1500, hit: 26, base: 90, speed: 2.3, size: 1.2 }, { hp: 2100, hit: 32, base: 125, speed: 2.3, size: 1.3 }, { hp: 2800, hit: 40, base: 165, speed: 2.4, size: 1.4 }],
    pad: { heal: 55, every: 20 }, dmgSuper: 1,
  };
  const HEROES = {
    brownhair_kid: { name: 'Boy', role: 'לוחם', hp: 170, speed: 4.9, weapon: 'sword', sup: 'charge', supName: 'הסתערות', need: 230, tip: 'חרב רחבה מקרוב. הסופר: זינוק שפוגע בכל מי שבדרך.' },
    purplegirl: { name: 'Girl', role: 'קשתית', hp: 115, speed: 4.7, weapon: 'bow', sup: 'jet', supName: "ג'טפק", need: 200, tip: 'חץ חזק מרחוק. הסופר: טיסה מעל קירות ונחיתה מתפוצצת.' },
    ginger_kid: { name: 'Ginger', role: 'תומך', hp: 140, speed: 4.7, weapon: 'pistol', sup: 'heal', supName: 'שדה ריפוי', need: 190, tip: 'צרור של שתי יריות. הסופר: שדה שמרפא את כל הקבוצה.' },
  };
  // ---- the arena: point-symmetric (every piece at x,z has a twin at -x,-z), three lanes, cover around each pylon ----
  function buildArena() {
    const HW4 = 20, HL4 = 32;
    const items = [], colliders = [], put = (id, x, z, ry, s) => items.push([id, x, 0, z, 0, ry || 0, 0, s || 1, s || 1, s || 1]);
    const box = (x, z, hx, hz, ry, kind) => colliders.push({ t: 'b', kind: kind || 'ob', x, z, hx, hz, ry: ry || 0 }), circ = (x, z, r) => colliders.push({ t: 'c', kind: 'ob', x, z, r });
    const both = f => { f(1); f(-1); }; // s = 1 is team A's half (z > 0), s = -1 the mirrored twin
    both(s => {
      put('bld_elec_t1_a', 0, 26 * s, s > 0 ? Math.PI : 0); box(-.45 * -s, 26 * s, 2.5, 2.2, 0, 'bld');       // reactor house
      for (const x of [-5, 0, 5]) put(s > 0 ? 'spawn_pad_blue' : 'spawn_pad_red', x * s, 30.3 * s);
      put('container_' + (s > 0 ? 1 : 2), -9.5 * s, 18.5 * s, Math.PI / 2); box(-9.5 * s, 18.5 * s, 1.25, 3.07, Math.PI / 2);   // base walls: gate in the middle, gaps at the sides
      put('container_' + (s > 0 ? 3 : 1), 9.5 * s, 18.5 * s, Math.PI / 2); box(9.5 * s, 18.5 * s, 1.25, 3.07, Math.PI / 2);
      put('container_2', -6 * s, 0.0 * s + (s > 0 ? 0 : 0), 0); if (s > 0) { } box(-6 * s, 0, 1.25, 3.07, 0);                         // the two containers that split the middle into lanes
      put('jersey_concrete_1', -12 * s, 5.2 * s, Math.PI / 2); box(-12 * s, 5.2 * s, .31, 1.5, Math.PI / 2);
      put('jersey_concrete_1', 12 * s, 5.2 * s, Math.PI / 2); box(12 * s, 5.2 * s, .31, 1.5, Math.PI / 2);
      put('crate_1', -3 * s, 9.5 * s, .3); put('crate_2', -1.9 * s, 9.9 * s, -.2); box(-2.6 * s, 9.6 * s, 1.0, .6, 0);
      put('concrete_pipes_1', 15.5 * s, 11 * s, .2); box(15.5 * s, 11 * s, 1.35, .9, .2);
      put('dumpster_1', -16 * s, 12 * s, .1); box(-16 * s, 12 * s, .63, 1.0, .1);
      put('crate_1', 6.5 * s, 13.5 * s, .5); circ(6.5 * s, 13.5 * s, .7);
      put('tree_1', -17.5 * s, 28.5 * s, s); circ(-17.5 * s, 28.5 * s, .55); put('tree_2', 17.5 * s, 29 * s, 2 * s); circ(17.5 * s, 29 * s, .55);
      put('tire_stack_5', 17.8 * s, 2.5 * s, s); circ(18 * s, 2.5 * s, .6);
      if (s < 0) /* the near (camera) side stays open so the fence never hides your own spawn */ for (let x = -HW4; x < HW4 - .1; x += 3.15) put('fence_panel', x * s, HL4 * s, s > 0 ? 0 : Math.PI);
      for (let z = -HL4; z < HL4 - .1; z += 3.15) put('fence_panel', HW4 * s, z * s, s > 0 ? Math.PI / 2 : -Math.PI / 2);
    });
    return { arena: { halfWidth: HW4, halfLength: HL4 }, items, colliders, buildings: [], signs: [], turret: { id: 'turret', x: 0, y: -60, z: 0 },
      spawns: { A: [[-5, 30.3], [0, 30.3], [5, 30.3]], B: [[5, -30.3], [0, -30.3], [-5, -30.3]] } };
  }
  const enemyOf = t => t === 'A' ? 'B' : 'A', teams = { A: { color: 'blue', members: [], charge: 0, titans: 0, kills: 0 }, B: { color: 'red', members: [], charge: 0, titans: 0, kills: 0 } };
  const teamCss = s => TEAM_CSS[teams[s].color], teamHex = s => TEAM_HEX[teams[s].color];
  let matchOver = null, matchT = RULES.match, player = null, started = false;
  let banner = () => { }, feed = () => { }, shake = 0;

  // ---- floor paint: team-coloured bases, lane arrows, a clean centre line (drawn once into one texture) ----
  { const cv = document.createElement('canvas'); cv.width = 400; cv.height = 640; const x = cv.getContext('2d'), HW4 = HW, HL4 = HL, X = v => (v + HW4) * 10, Z = v => (v + HL4) * 10;
    const zone = (z0, z1, col) => { const g = x.createLinearGradient(0, Z(z0), 0, Z(z1)); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, Math.min(Z(z0), Z(z1)), 400, Math.abs(Z(z1) - Z(z0))); };
    zone(32, 17, 'rgba(47,139,255,.55)'); zone(-32, -17, 'rgba(255,77,66,.55)');
    x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 3; x.setLineDash([14, 10]); x.beginPath(); x.moveTo(0, 320); x.lineTo(400, 320); x.stroke(); x.setLineDash([]);
    x.strokeStyle = 'rgba(255,255,255,.22)'; x.lineWidth = 5; for (const z of [12, -12]) for (const px of [-12, 0, 12]) { const d = z > 0 ? -1 : 1; x.beginPath(); x.moveTo(X(px) - 14, Z(z) - 10 * d); x.lineTo(X(px), Z(z) + 10 * d); x.lineTo(X(px) + 14, Z(z) - 10 * d); x.stroke(); }
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * HW4, 2 * HL4), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = .012; m.renderOrder = 1; scene.add(m); }

  // ---- damage numbers ----
  const pops = []; for (let i = 0; i < 22; i++) { const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64; const t = new THREE.CanvasTexture(cv); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false })); s.scale.set(1.5, .75, 1); s.visible = false; s.renderOrder = 12; scene.add(s); pops.push({ s, cv, t, life: 0 }); }
  let popI = 0;
  function popNum(x, z, text, color, big) { const p = pops[popI = (popI + 1) % pops.length], c = p.cv.getContext('2d'); c.clearRect(0, 0, 128, 64); c.font = '900 ' + (big ? 50 : 40) + 'px Rubik, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 8; c.strokeStyle = '#0b0c10'; c.strokeText(text, 64, 34); c.fillStyle = color; c.fillText(text, 64, 34); p.t.needsUpdate = true; p.s.position.set(x + rnd(-.3, .3), 2.2, z); p.s.visible = true; p.life = .8; p.s.material.opacity = 1; }
  function updatePops(dt) { for (const p of pops) if (p.life > 0) { p.life -= dt; p.s.position.y += dt * 1.6; p.s.material.opacity = Math.min(1, p.life * 3); if (p.life <= 0) p.s.visible = false; } }

  // ---- hero bar: one canvas sprite - rounded bar, team colour fill, the HP number inside, green glow while healing ----
  function makeHpBar() { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false })); s.scale.set(1.5, .375, 1); s.renderOrder = 10; s.userData = { cv, t, key: '' }; return s; }
  function drawHpBar(bar, hp, max, col, heal, me) {
    const v = Math.max(0, Math.ceil(hp)), k = Math.max(0, Math.min(1, hp / max)), key = v + '|' + col + '|' + (heal ? 1 : 0) + '|' + (me ? 1 : 0); if (bar.userData.key === key) return; bar.userData.key = key;
    const x = bar.userData.cv.getContext('2d'), rr = (X, Y, W, H, R) => { x.beginPath(); x.moveTo(X + R, Y); x.arcTo(X + W, Y, X + W, Y + H, R); x.arcTo(X + W, Y + H, X, Y + H, R); x.arcTo(X, Y + H, X, Y, R); x.arcTo(X, Y, X + W, Y, R); x.closePath(); };
    x.clearRect(0, 0, 256, 64); rr(4, 8, 248, 50, 14); x.fillStyle = '#0b0c10'; x.fill(); if (heal) { x.lineWidth = 5; x.strokeStyle = '#5dff7a'; x.stroke(); }
    if (k > 0) { rr(10, 14, Math.max(24, 236 * k), 38, 10); const low = k < .35, g = x.createLinearGradient(0, 14, 0, 52); g.addColorStop(0, low ? '#ff8c80' : col === 'me' ? '#9dff9a' : col === 'A' ? '#8cc4ff' : '#ff958c'); g.addColorStop(1, low ? '#d8392d' : col === 'me' ? '#2fc84a' : col === 'A' ? '#2a7bdc' : '#d23a30'); x.fillStyle = g; x.fill(); }
    x.font = '900 36px Rubik, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineWidth = 7; x.strokeStyle = '#0b0c10'; x.strokeText(String(v), 128, 34); x.fillStyle = '#fff'; x.fillText(String(v), 128, 34);
    if (heal) { x.fillStyle = '#5dff7a'; x.font = '900 34px Rubik, Arial'; x.fillText('+', 228, 33); }
    bar.userData.t.needsUpdate = true;
  }

  // ---- actors ----
  const actors = [];
  function styleBody(c, size, head) { c.holder.scale.setScalar(size); const h = c.root.getObjectByName('Head'); if (h) h.scale.setScalar(head); for (const k in c.speed) c.speed[k] *= size; }
  function makeActor(heroKey, side, slot) {
    const H = HEROES[heroKey], color = teams[side].color, c = makeChar(A2['chars/' + heroKey + '_' + color], heroKey + '_' + color); styleBody(c, .82, 1.3);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.52, .66, 28), new THREE.MeshBasicMaterial({ color: TEAM_HEX[color], transparent: true, opacity: .95, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = .03; ring.renderOrder = 2; c.holder.add(ring);
    const bar = makeHpBar(), ammo = makeBar(1.15, 0xffb52e), sup = new THREE.Mesh(new THREE.RingGeometry(.74, .9, 32), new THREE.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: .95, depthWrite: false })); sup.rotation.x = -Math.PI / 2; sup.position.y = .035; sup.visible = false; c.holder.add(sup);
    scene.add(bar, ammo); scene.add(c.holder); attach(c, WEAPONS[H.weapon].model); if (H.sup === 'jet') attach(c, 'jetpack');
    const a = { c, H, heroKey, side, slot, name: H.name, W: WEAPONS[H.weapon], hp: H.hp, maxHp: H.hp, alive: true, state: 'free', ammo: RULES.ammo, sup: 0, atkCd: 0, shot: null, shot2: 0, lastHit: -9, respawnT: 0, prot: 0, upT: 0, carry: null, kills: 0, dmg: 0, deaths: 0,
      inp: { mx: 0, mz: 0 }, aimYaw: 0, aiming: false, mvx: 0, mvz: 0, ring, bar, ammoBar: ammo, supRing: sup, isPlayer: false };
    Object.defineProperty(a, 'x', { get: () => c.holder.position.x }); Object.defineProperty(a, 'z', { get: () => c.holder.position.z });
    actors.push(a); teams[side].members.push(a); return a;
  }
  function respawn(a) { const sp = layout.spawns[a.side][a.slot]; a.c.holder.position.set(sp[0], 0, sp[1]); a.c.yaw = a.side === 'A' ? Math.PI : 0; a.hp = a.maxHp; a.alive = true; a.state = 'free'; a.prot = RULES.spawnProt; a.ammo = RULES.ammo; a.mvx = a.mvz = 0; a.ring.visible = a.bar.visible = true; a.c.baseName = ''; play(a.c, 'Idle', { fade: 0 }); if (a.brain) a.brain.goal = null; }
  function kill(a, src) {
    a.hp = 0; a.alive = false; a.deaths++; a.respawnT = RULES.respawn; a.shot = null; a.aiming = false; if (a.carry) dropBattery(a); a.c.holder.position.y = 0; a.state = 'dead'; if (a.c.up) upperStop(a.c, .05); a.c.baseName = ''; play(a.c, Math.random() < .5 ? 'death1' : 'death2', { fade: .08 });
    a.ring.visible = a.bar.visible = a.ammoBar.visible = a.supRing.visible = false; SFX.play('death', a.x, a.z);
    const by = src && src.name ? src.name : src && src.isTitan ? 'הטיטאן' : src && src.isReactor ? 'הכור' : '—'; feed(by + ' ← ' + a.name, src && src.side ? src.side : enemyOf(a.side));
    if (src && src.H) { src.kills++; teams[src.side].kills++; if (src.isPlayer) { SFX.play('kill'); banner('חיסלת את ' + a.name, '#ffd21f', 1.2); } } if (a.isPlayer) shake = .5;
  }
  function hurt(t, dmg, src) {
    if (matchOver || dmg <= 0) return;
    if (t.isReactor) { if (t.hp <= 0) return; t.hp = Math.max(0, t.hp - dmg); t.hitT = .15; popNum(t.x, t.z, '' + Math.round(dmg), '#ffd21f'); SFX.play('coreHit', t.x, t.z, .1); if (src && src.H) { src.sup = Math.min(1, src.sup + dmg * .5 / src.H.need); src.dmg += dmg; } if (t.hp <= 0) endMatch(enemyOf(t.side), 'הכור הושמד'); return; }
    if (t.isTitan) { if (t.dead) return; t.hp -= dmg; flash(t.c, 0xffffff); setBar(t.bar, t.hp / t.maxHp); popNum(t.x, t.z, '' + Math.round(dmg), '#ffffff'); if (src && src.H) { src.sup = Math.min(1, src.sup + dmg * .6 / src.H.need); src.dmg += dmg; t.threat = src; } if (t.hp <= 0) titanDied(t, src); return; }
    if (!t.alive || t.prot > 0 || t.state === 'fly') return; if (t.isPlayer && DBG.god) return;
    t.hp -= dmg; t.lastHit = NOW; flash(t.c, 0xff3b30); popNum(t.x, t.z, '' + Math.round(dmg), t.isPlayer ? '#ff6a5e' : '#ffffff', dmg >= 30);
    if (src && src.H) { src.sup = Math.min(1, src.sup + dmg / src.H.need); src.dmg += dmg; }
    if (t.isPlayer) { SFX.play('hurtMe', undefined, undefined, .08); shake = Math.max(shake, .22); onPlayerHit(); } else if (src && src.isPlayer) SFX.play('thud', t.x, t.z, .05);
    if (t.hp <= 0) kill(t, src);
  }
  let onPlayerHit = () => { };

  // ---- attacks: 3 ammo that refill one by one; tap = auto aim, drag = manual aim with a little magnetism ----
  const chestY = 1.0;
  const aimOffset = (a, W) => W.hand ? (a.c.aimOff['U' + W.clips[0] + W.hand] || 0) : 0;
  function enemiesOf(side, withBase) { const out = []; for (const e of teams[enemyOf(side)].members) if (e.alive && e.state !== 'fly') out.push(e); for (const t of titans) if (!t.dead && t.side !== side) out.push(t); if (withBase) out.push(reactors[enemyOf(side)]); return out; }
  const reach = (a, t) => t.isReactor ? Math.max(0, dist2(a.x, a.z, clamp(a.x, t.x - 2.5, t.x + 2.5), clamp(a.z, t.z - 2.2, t.z + 2.2))) : dist2(a.x, a.z, t.x, t.z) - (t.isTitan ? .8 : .45);
  function bestTarget(a, range) { let best = null, bd = 1e9; for (const t of enemiesOf(a.side, true)) { const d = reach(a, t); if (d <= range && d < bd && (t.isReactor || lineClear(a.x, a.z, t.x, t.z, 1.0))) { bd = d; best = t; } } return best; }
  const yawTo = (a, t) => t.isReactor ? yawOf(clamp(a.x, t.x - 2.5, t.x + 2.5) - a.x, clamp(a.z, t.z - 2.2, t.z + 2.2) - a.z) : yawOf(t.x - a.x, t.z - a.z);
  // manual aim is nudged onto a target that is nearly lined up (helps a lot on a phone)
  function assist(a, yaw) { let best = null, bd = .24; for (const t of enemiesOf(a.side, false)) { const d = dist2(a.x, a.z, t.x, t.z); if (d > a.W.range * 1.15) continue; const off = Math.abs(angDiff(yaw, yawOf(t.x - a.x, t.z - a.z))); if (off < bd) { bd = off; best = t; } } return best ? yaw + angDiff(yaw, yawOf(best.x - a.x, best.z - a.z)) * .75 : yaw; }
  function startAttack(a, yaw) {
    if (!a.alive || a.state !== 'free' || a.carry || a.atkCd > 0 || a.ammo < 1 || a.shot) return false;
    const W = a.W, clip = W.clips[0], dur = a.c.clips[clip].duration; a.ammo -= 1; a.atkCd = W.cd; a.aimYaw = yaw; a.shot = { t: W.wind }; a.upT = W.wind + .32; a.aiming = false; a.prot = 0;
    upperStart(a.c, clip, W.at * dur / W.wind, 0, false); if (W.melee) SFX.play('swing', a.x, a.z); return true;
  }
  function holdAim(a, yaw) { if (!a.alive || a.state !== 'free' || a.carry) { a.aiming = false; return; } a.aimYaw = yaw; if (a.shot) return; const clip = a.W.clips[0]; a.aiming = true; if (!a.c.up || !a.c.up.hold) upperStart(a.c, clip, 1, a.W.at * a.c.clips[clip].duration * (a.W.melee ? .3 : .92), true); }
  function cancelAim(a) { if (a.aiming) { a.aiming = false; if (a.c.up && a.c.up.hold) upperStop(a.c, .12); } }
  function fireOne(a) { const W = a.W, yaw = a.aimYaw, dx = Math.sin(yaw), dz = Math.cos(yaw); SFX.play(W.shot, a.x, a.z); fireShot(a, a.side, W.shot, a.x + dx * .45, chestY, a.z + dz * .45, yaw, W.range, W.speed, W.dmg); if (W.shot === 'dart') puff(a.x + dx * .6, chestY, a.z + dz * .6, 0xffe08a, .07, .12, 1.5); }
  function landAttack(a) {
    const W = a.W, yaw = a.aimYaw; if (!W.melee) { fireOne(a); if (W.burst > 1) a.shot2 = .13; return; }
    let any = false; for (const t of enemiesOf(a.side, true)) { const d = reach(a, t); if (d > W.range) continue; if (Math.abs(angDiff(yaw, yawTo(a, t))) > W.arc && d > .7) continue; if (!t.isReactor && !lineClear(a.x, a.z, t.x, t.z, 1.3) && d > 1) continue; hurt(t, W.dmg, a); any = true; }
    slashFx(a.x, a.z, yaw, W.range, teamHex(a.side)); if (any) SFX.play('thud', a.x, a.z);
  }
  // a bright arc on the floor so a sword swing reads clearly
  function slashFx(x, z, yaw, r, color) { const m = new THREE.Mesh(new THREE.RingGeometry(r * .55, r, 20, 1, -1.15, 2.3), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide })); m.rotation.set(-Math.PI / 2, 0, yaw - Math.PI / 2, 'YXZ'); m.rotation.order = 'YXZ'; m.rotation.y = yaw - Math.PI / 2; m.rotation.x = -Math.PI / 2; m.rotation.z = 0; m.position.set(x, .12, z); scene.add(m); fx.push({ m, life: .18, t: 0, grow: .08, s: 1, flat: true }); }
  function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i], step = Math.min(s.left, s.speed * dt); let best = step + 1, hit = null;
      if (s.owner.isReactor) { for (const t of s.foes()) { if (s.y > 2.6) break; const d = segCircle(s.x, s.z, s.dx, s.dz, step, t.x, t.z, t.isTitan ? .9 : .5); if (d >= 0 && d < best) { best = d; hit = t; } } }
      else { for (const t of enemiesOf(s.side, false)) { const d = segCircle(s.x, s.z, s.dx, s.dz, step, t.x, t.z, t.isTitan ? .95 : .6); if (d >= 0 && d < best) { best = d; hit = t; } }
        const R = reactors[enemyOf(s.side)], d = rayHitOne(R.col, s.x, s.z, s.dx, s.dz); if (d <= step && d < best) { best = d; hit = R; } }
      const adv = hit ? best : step; s.x += s.dx * adv; s.z += s.dz * adv; s.left -= adv; if (s.y0 !== undefined) s.y = s.y1 + (s.y0 - s.y1) * (s.left / s.total); s.m.position.set(s.x, s.y, s.z);
      if (hit) { hurt(hit, s.dmg * (hit.isTitan && s.owner.isReactor ? RULES.reactor.vsTitan : 1), s.owner); puff(s.x, s.y, s.z, 0xffffff, .14, .2, 1.5); }
      if (hit || s.left <= 1e-4) { if (!hit) puff(s.x, Math.max(.15, s.y), s.z, 0xd8d4ca, .09, .25, 1.6); scene.remove(s.m); shots.splice(i, 1); }
    }
  }
  // ---- supers ----
  const fields = [];
  function useSuper(a, yaw) {
    if (!a.alive || a.state !== 'free' || a.sup < 1 || a.carry || matchOver) return false; a.sup = 0; cancelAim(a); if (a.c.up) upperStop(a.c, .05); banner3(a);
    if (a.H.sup === 'charge') { a.c.yaw = yaw; a.aimYaw = yaw; a.state = 'dash'; a.sub = { left: 7.5, hit: new Set() }; SFX.play('dash', a.x, a.z); }
    else if (a.H.sup === 'jet') { const m = Math.hypot(a.inp.mx, a.inp.mz), d = m > .15 ? yawOf(a.inp.mx, a.inp.mz) : yaw; a.state = 'fly'; a.sub = { fuel: 2.3, dx: Math.sin(d), dz: Math.cos(d) }; play(a.c, 'Flying', { fade: .2 }); SFX.play('jet', a.x, a.z); }
    else { const ring = new THREE.Mesh(new THREE.CircleGeometry(4, 40), new THREE.MeshBasicMaterial({ color: 0x3fdc5d, transparent: true, opacity: .28, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.set(a.x, .04, a.z); scene.add(ring); const kit = lib.medkit_2.clone(); kit.position.set(a.x, .4, a.z); kit.scale.setScalar(1.8); scene.add(kit); fields.push({ x: a.x, z: a.z, side: a.side, t: 6, ring, kit }); SFX.play('heal', a.x, a.z); }
    return true;
  }
  function banner3(a) { if (a.isPlayer) banner(a.H.supName + '!', '#ffd21f', 1); ringFx(a.x, a.z, 1.4, 0xffd21f, .4); }
  function updateFields(dt) { for (let i = fields.length - 1; i >= 0; i--) { const f = fields[i]; f.t -= dt; f.kit.rotation.y += dt * 2; f.ring.material.opacity = .2 + .1 * Math.sin(NOW * 6); for (const a of teams[f.side].members) if (a.alive && a.hp < a.maxHp && dist2(a.x, a.z, f.x, f.z) < 4) a.hp = Math.min(a.maxHp, a.hp + 24 * dt); if (f.t <= 0) { scene.remove(f.ring); scene.remove(f.kit); fields.splice(i, 1); } } }

  // ---- reactors: the two bases. A roof gun defends each; a floating bar shows its health ----
  const reactors = {};
  for (const side of ['A', 'B']) {
    const s = side === 'A' ? 1 : -1, z = 26 * s, gun = lib.turret.clone(); gun.position.set(0, 4.3, z); noCast(gun); scene.add(gun);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: teamHex(side), transparent: true, depthWrite: false, opacity: .9 })); glow.scale.set(5, 5, 1); glow.position.set(0, 5.4, z); scene.add(glow);
    const ring = new THREE.Mesh(new THREE.RingGeometry(RULES.reactor.range - .12, RULES.reactor.range, 64), new THREE.MeshBasicMaterial({ color: teamHex(side), transparent: true, opacity: .35, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.set(0, .03, z); scene.add(ring);
    const bar = makeBar(4.2, teamHex(side)); bar.position.set(0, 5.6, z); bar.scale.set(.85, 1.5, 1); scene.add(bar);
    reactors[side] = { isReactor: true, side, x: 0, z, hp: RULES.reactor.hp, maxHp: RULES.reactor.hp, col: solids.find(c => c.kind === 'bld' && Math.sign(c.z) === s), gun, glow, bar, fireT: 1, burst: 0, burstT: 0, aim: null, hitT: 0, name: 'הכור' };
  }
  function updateReactors(dt) {
    for (const side of ['A', 'B']) { const R = reactors[side], RR = RULES.reactor; setBar(R.bar, R.hp / R.maxHp); R.glow.material.opacity = .6 + .3 * Math.sin(NOW * 3) + (R.hitT > 0 ? .5 : 0); if (R.hitT > 0) R.hitT -= dt;
      const foes = () => { const o = []; for (const t of titans) if (!t.dead && t.side !== side && dist2(t.x, t.z, R.x, R.z) <= RR.range) o.push(t); for (const e of teams[enemyOf(side)].members) if (e.alive && e.prot <= 0 && e.state !== 'fly' && dist2(e.x, e.z, R.x, R.z) <= RR.range) o.push(e); return o; };
      if (R.burst > 0) { if ((R.burstT -= dt) <= 0) { R.burstT = .09; R.burst--; const t = R.aim; if (t && (t.alive || (t.isTitan && !t.dead))) { const d = dist2(t.x, t.z, R.x, R.z), tt = d / 40, px = t.x + (t.vx || 0) * tt, pz = t.z + (t.vz || 0) * tt, yaw = yawOf(px - R.x, pz - R.z), mx = R.x + Math.sin(yaw) * 1.5, mz = R.z + Math.cos(yaw) * 1.5; R.gun.rotation.y = yaw; SFX.play('tracer', mx, mz);
            fireShot(R, side, 'tracer', mx, 5, mz, yaw, Math.hypot(px - mx, pz - mz) + 1.2, 40, RR.dmg, { overWalls: true, y0: 5, foes }); const sh = shots[shots.length - 1]; sh.y1 = 1; sh.m.rotation.order = 'YXZ'; sh.m.rotation.x = Math.atan2(4, d); } } }
      else if ((R.fireT -= dt) <= 0) { R.fireT = RR.every; const f = foes(); if (f.length) { R.aim = f[0]; R.burst = RR.burst; R.burstT = 0; } } }
  }

  // ---- pylons: stand in the ring to turn it your colour. Every pylon you hold charges your Titan ----
  const pylons = [-12, 0, 12].map((x, i) => {
    const g = new THREE.Group(); g.position.set(x, 0, 0); const pole = new THREE.Mesh(new THREE.CylinderGeometry(.16, .24, 3.2, 10), new THREE.MeshStandardMaterial({ color: 0x8f979e, metalness: .5, roughness: .4 })); pole.position.y = 1.6; pole.castShadow = true;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.6, .75, .35, 14), new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: .7 })); base.position.y = .17; const bulb = new THREE.Mesh(new THREE.SphereGeometry(.55, 16, 12), new THREE.MeshStandardMaterial({ color: 0xdfe3e8, emissive: 0x000000, roughness: .3 })); bulb.position.y = 3.5;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffffff, transparent: true, depthWrite: false, opacity: 0 })); glow.scale.set(4, 4, 1); glow.position.y = 3.5; g.add(pole, base, bulb, glow); scene.add(g);
    const ring = new THREE.Mesh(new THREE.RingGeometry(RULES.pylonR - .16, RULES.pylonR, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .7, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.set(x, .03, 0); scene.add(ring);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(RULES.pylonR - .16, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })); fill.rotation.x = -Math.PI / 2; fill.position.set(x, .025, 0); scene.add(fill);
    solids.push({ t: 'c', kind: 'ob', x, z: 0, r: .6, h: 3 }); return { i, x, z: 0, p: 0, owner: null, bulb, glow, ring, fill, contested: false };
  });
  function updatePylons(dt) {
    for (const P of pylons) { let nA = 0, nB = 0; for (const a of actors) if (a.alive && a.state !== 'fly' && dist2(a.x, a.z, P.x, P.z) <= RULES.pylonR) a.side === 'A' ? nA++ : nB++;
      P.contested = nA > 0 && nB > 0; const n = nA - nB && !P.contested ? (nA ? nA : -nB) : 0;
      if (n) { const before = P.owner; P.p = clamp(P.p + Math.sign(n) * (1 + .4 * (Math.abs(n) - 1)) / RULES.capTime * dt, -1, 1); if (P.p >= 1) P.owner = 'A'; else if (P.p <= -1) P.owner = 'B'; else if (P.owner && Math.sign(P.p) !== (P.owner === 'A' ? 1 : -1)) P.owner = null;
        if (P.owner !== before) { if (P.owner) { ringFx(P.x, P.z, RULES.pylonR, teamHex(P.owner), .6); feed((teams[P.owner].color === 'blue' ? 'הכחולים' : 'האדומים') + ' כבשו עמוד', P.owner); SFX.play(P.owner === player.side ? 'gain' : 'lost', P.x, P.z); } } }
      const col = P.owner ? teamHex(P.owner) : 0xdfe3e8, lean = P.p > 0 ? 'A' : P.p < 0 ? 'B' : null; P.bulb.material.color.setHex(col); P.bulb.material.emissive.setHex(P.owner ? col : 0); P.bulb.material.emissiveIntensity = .9; P.glow.material.color.setHex(col); P.glow.material.opacity = P.owner ? .7 : 0;
      P.ring.material.color.setHex(P.contested ? (Math.sin(NOW * 12) > 0 ? 0xffffff : 0xffd21f) : col); P.fill.material.color.setHex(lean ? teamHex(lean) : 0xffffff); P.fill.material.opacity = Math.abs(P.p) * .32; P.fill.scale.setScalar(Math.max(.05, Math.sqrt(Math.abs(P.p))));
      if (P.owner && !matchOver && started) { const T = teams[P.owner]; if (!titans.some(t => t.side === P.owner && !t.dead)) T.charge = Math.min(100, T.charge + RULES.charge * (matchT <= RULES.overtime ? 2 : 1) * dt); } }
    for (const s of ['A', 'B']) if (teams[s].charge >= 100 && !titans.some(t => t.side === s && !t.dead)) spawnTitan(s);
  }

  // ---- the battery: drops in the middle; carry it home for a big chunk of charge and a reactor repair ----
  const batt = { state: 'none', x: 0, z: 0, by: null, next: RULES.battery.first, idle: 0, mesh: null, beam: null };
  { const g = new THREE.Group(), body = new THREE.Mesh(new THREE.CylinderGeometry(.26, .26, .7, 14), new THREE.MeshStandardMaterial({ color: 0x2bd46a, emissive: 0x1a8a44, emissiveIntensity: .7, roughness: .4 })), cap = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, .14, 10), new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: .6, roughness: .3 })); cap.position.y = .42; const band = new THREE.Mesh(new THREE.CylinderGeometry(.27, .27, .16, 14), new THREE.MeshStandardMaterial({ color: 0xffd21f })); g.add(body, cap, band); g.visible = false; scene.add(g); batt.mesh = g;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(.45, .45, 12, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x2bd46a, transparent: true, opacity: .3, depthWrite: false, side: THREE.DoubleSide })); beam.position.y = 6; beam.visible = false; scene.add(beam); batt.beam = beam; }
  function dropBattery(a) { a.carry = null; batt.by = null; batt.state = 'ground'; batt.idle = 0; const p = freeNear(a.x, a.z); batt.x = p[0]; batt.z = p[1]; if (a.c.up && a.c.up.hold) upperStop(a.c, .1); a.c.held[a.W.model].visible = true; }
  const _hl = new THREE.Vector3(), _hr = new THREE.Vector3();
  function updateBattery(dt) {
    const B = RULES.battery;
    if (batt.state === 'none') { if (!started || matchOver) return; batt.next -= dt; if (batt.next <= 5 && !batt.warned) { batt.warned = true; banner('סוללה נוחתת במרכז!', '#2bd46a', 2); SFX.play('warn'); } if (batt.next <= 0) { batt.warned = false; const p = freeNear(0, 2.2 * (Math.random() < .5 ? 1 : -1)); batt.state = 'ground'; batt.x = p[0]; batt.z = p[1]; batt.idle = 0; ringFx(batt.x, batt.z, 2, 0x2bd46a, .6); } batt.mesh.visible = batt.beam.visible = false; return; }
    batt.mesh.visible = true;
    if (batt.state === 'ground') { batt.idle += dt; batt.mesh.position.set(batt.x, .6 + Math.sin(NOW * 4) * .12, batt.z); batt.mesh.rotation.set(0, NOW * 2, .3); batt.beam.visible = true; batt.beam.position.set(batt.x, 6, batt.z);
      for (const a of actors) if (a.alive && a.state === 'free' && dist2(a.x, a.z, batt.x, batt.z) < 1.2) { batt.state = 'carried'; batt.by = a; a.carry = batt; cancelAim(a); a.shot = null; a.c.held[a.W.model].visible = false; upperStart(a.c, 'Carry Run', 1, .2, true); SFX.play('pickup', a.x, a.z); feed(a.name + ' לקח את הסוללה', a.side); if (a.side === player.side && !a.isPlayer) banner(a.name + ' מחזיק בסוללה — ללוות!', teamCss(a.side), 1.6); else if (a.side !== player.side) banner('היריב לקח את הסוללה!', teamCss(a.side), 1.6); break; }
      if (batt.idle > B.idle) { batt.state = 'none'; batt.next = B.every * .6; } return; }
    const a = batt.by, c = a.c; batt.beam.visible = false; c.handL.getWorldPosition(_hl); c.handR.getWorldPosition(_hr); batt.x = a.x; batt.z = a.z; batt.mesh.position.set((_hl.x + _hr.x) / 2, (_hl.y + _hr.y) / 2 + .1, (_hl.z + _hr.z) / 2); batt.mesh.rotation.set(0, c.yaw, Math.PI / 2);
    const R = reactors[a.side]; if (dist2(a.x, a.z, R.x, R.z) < 5) { const T = teams[a.side]; T.charge = Math.min(100, T.charge + B.charge); R.hp = Math.min(R.maxHp, R.hp + B.heal); a.carry = null; batt.by = null; batt.state = 'none'; batt.next = B.every; if (c.up && c.up.hold) upperStop(c, .1); c.held[a.W.model].visible = true; a.sup = Math.min(1, a.sup + .35);
      banner((a.side === player.side ? 'הסוללה אצלנו! ' : 'היריב הביא סוללה! ') + '+' + B.charge + ' טעינה', teamCss(a.side), 2); ringFx(R.x, R.z, 4, 0x2bd46a, .7); SFX.play(a.side === player.side ? 'gain' : 'lost'); }
  }

  // ---- titans: boxer, then Tommy, then the Terminator. They walk down the middle and smash the enemy reactor ----
  const titans = [], titanPool = { 1: [], 2: [], 3: [] }, teleGeo = new THREE.CircleGeometry(1, 28);
  BOSS_IDS.forEach((id, i) => { const tier = id === 'boxer' ? 1 : id === 'tommy' ? 2 : 3, c = makeChar(A2['boss' + i], id); styleBody(c, RULES.titan[tier].size, 1.15); c.holder.visible = false; scene.add(c.holder); c.tbar = makeBar(2, 0xffffff); c.tbar.visible = false; scene.add(c.tbar);
    c.tring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.25, 32), new THREE.MeshBasicMaterial({ transparent: true, opacity: .95, depthWrite: false })); c.tring.rotation.x = -Math.PI / 2; c.tring.position.y = .04; c.holder.add(c.tring); titanPool[tier].push(c); });
  function spawnTitan(side) {
    const T = teams[side]; let tier = Math.min(3, T.titans + 1), c = titanPool[tier].find(k => !k.busy); while (!c && tier > 1) c = titanPool[--tier].find(k => !k.busy); if (!c) return; c.busy = true; T.titans++; T.charge = 0;
    const R = RULES.titan[Math.min(3, T.titans)], s = side === 'A' ? 1 : -1, tele = new THREE.Mesh(teleGeo, new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0, depthWrite: false })); tele.rotation.x = -Math.PI / 2; tele.position.y = .05; scene.add(tele);
    const t = { isTitan: true, side, c, tier: Math.min(3, T.titans), R, hp: R.hp, maxHp: R.hp, st: 'walk', t: 0, dead: false, tele, bar: c.tbar, path: null, pi: 0, pathT: 0, name: 'הטיטאן', threat: null };
    Object.defineProperty(t, 'x', { get: () => c.holder.position.x }); Object.defineProperty(t, 'z', { get: () => c.holder.position.z });
    c.holder.position.set(0, 0, 21 * s); c.yaw = s > 0 ? Math.PI : 0; c.holder.visible = true; c.baseName = ''; c.base = null; c.mixer.stopAllAction(); play(c, 'Idle', { fade: 0 }); c.tring.material.color.setHex(teamHex(side)); t.bar.userData.fg.material.color.setHex(teamHex(side)); setBar(t.bar, 1); t.bar.visible = true; titans.push(t);
    for (let i = 0; i < 8; i++) puff(rnd(-1, 1), rnd(.5, 2.5), 21 * s + rnd(-1, 1), teamHex(side), .5, .6, 2);
    banner(side === player.side ? 'הטיטאן שלנו יצא לדרך — ללוות אותו!' : 'טיטאן של היריב בדרך — לעצור אותו!', teamCss(side), 2.6); SFX.play('growl'); SFX.play(side === player.side ? 'gain' : 'warn');
  }
  function titanDied(t, src) { t.dead = true; t.t = 2; t.tele.material.opacity = 0; t.bar.visible = false; play(t.c, 'death1', { fade: .08 }); banner(t.side === player.side ? 'הטיטאן שלנו נפל' : 'הטיטאן של היריב הושמד!', teamCss(enemyOf(t.side)), 1.8); SFX.play('blast', t.x, t.z); if (src && src.H) src.sup = Math.min(1, src.sup + .4); }
  function updateTitans(dt) {
    for (let i = titans.length - 1; i >= 0; i--) {
      const t = titans[i], c = t.c, p = c.holder.position, R = t.R, foeR = reactors[enemyOf(t.side)]; t.bar.position.set(p.x, 3.4, p.z);
      if (t.dead) { c.mixer.update(dt); if ((t.t -= dt) <= 0) { puff(p.x, 1, p.z, 0xffffff, .6, .5, 2); c.holder.visible = false; c.busy = false; scene.remove(t.tele); titans.splice(i, 1); } continue; }
      const ox = p.x, oz = p.z;
      // who is in arm's reach: an enemy titan first, then heroes, then the reactor itself
      let tgt = null, bd = 3.4; for (const o of titans) if (!o.dead && o.side !== t.side) { const d = dist2(o.x, o.z, p.x, p.z); if (d < bd + .8) { bd = d; tgt = o; } }
      if (!tgt) for (const a of teams[enemyOf(t.side)].members) { if (!a.alive || a.state === 'fly') continue; const d = dist2(a.x, a.z, p.x, p.z); if (d < bd) { bd = d; tgt = a; } }
      const atBase = dist2(p.x, p.z, foeR.x, foeR.z) < 4.6; if (!tgt && atBase) tgt = foeR;
      if (t.st === 'wind') { t.t -= dt; t.tele.material.opacity = .25 + .4 * (1 - t.t / .7);
        if (t.t <= 0) { t.tele.material.opacity = 0; const tx = t.tele.position.x, tz = t.tele.position.z; if (t.atBase) hurt(foeR, R.base * (matchT <= RULES.overtime ? 1.5 : 1), t); for (const a of teams[enemyOf(t.side)].members) if (a.alive && dist2(a.x, a.z, tx, tz) <= 2.5) hurt(a, R.hit, t); for (const o of titans) if (!o.dead && o.side !== t.side && dist2(o.x, o.z, tx, tz) <= 3) hurt(o, R.hit * 5, t); ringFx(tx, tz, 2.1, 0xff3b30, .3); SFX.play('thud', tx, tz); t.st = 'rest'; t.t = .9; } }
      else if (t.st === 'rest' && (t.t -= dt) > 0) { play(c, 'Idle', { fade: .2 }); }
      else if (tgt) { t.st = 'wind'; t.t = .7; t.atBase = tgt === foeR; c.yaw = yawOf(tgt.x - p.x, tgt.z - p.z); t.tele.scale.setScalar(2.1); t.tele.position.set(p.x + Math.sin(c.yaw) * 1.5, .05, p.z + Math.cos(c.yaw) * 1.5); const clip = Math.random() < .5 ? 'Punching_left' : 'Punching_right'; c.baseName = ''; play(c, clip, { ts: .38 * c.clips[clip].duration / .7, fade: .1 }); }
      else { t.st = 'walk'; if (!t.path || (t.pathT -= dt) <= 0) { t.path = findPath(p.x, p.z, foeR.x, foeR.z + (t.side === 'A' ? 3.6 : -3.6)); t.pi = 0; t.pathT = 3; }
        while (t.pi < t.path.length - 1 && dist2(p.x, p.z, t.path[t.pi].x, t.path[t.pi].z) < 1) t.pi++; const w = t.path[t.pi], d = dist2(p.x, p.z, w.x, w.z) || 1; c.yaw += angDiff(c.yaw, yawOf(w.x - p.x, w.z - p.z)) * Math.min(1, dt * 6); p.x += (w.x - p.x) / d * R.speed * dt; p.z += (w.z - p.z) / d * R.speed * dt; resolve(p, .7); play(c, 'Running', { ts: R.speed / (c.speed.Running || 5) * 1.05, fade: .2 }); }
      if (dt > 0) { t.vx = (p.x - ox) / dt; t.vz = (p.z - oz) / dt; } c.holder.rotation.y = c.yaw; if (c.flashT > 0 && (c.flashT -= dt) <= 0) for (const m of c.mats) m.emissiveIntensity = 0; c.mixer.update(dt);
    }
  }

  // ---- heal pads (one on each half) ----
  const pads = [[-17, 14], [17, -14]].map(p => { const mesh = lib.medkit_2.clone(); mesh.position.set(p[0], 0, p[1]); mesh.scale.setScalar(1.7); noCast(mesh); scene.add(mesh); const halo = new THREE.Mesh(new THREE.RingGeometry(.7, .9, 28), new THREE.MeshBasicMaterial({ color: 0x3fdc5d, transparent: true, opacity: .9, depthWrite: false })); halo.rotation.x = -Math.PI / 2; halo.position.set(p[0], .03, p[1]); scene.add(halo); return { x: p[0], z: p[1], mesh, halo, t: 0 }; });
  function updatePads(dt) { for (const m of pads) { if (m.t > 0) { if ((m.t -= dt) <= 0) m.mesh.visible = m.halo.visible = true; continue; } m.mesh.rotation.y += dt; for (const a of actors) if (a.alive && a.hp < a.maxHp && dist2(a.x, a.z, m.x, m.z) < 1.2) { a.hp = Math.min(a.maxHp, a.hp + RULES.pad.heal); popNum(a.x, a.z, '+' + RULES.pad.heal, '#3fdc5d'); m.t = RULES.pad.every; m.mesh.visible = m.halo.visible = false; SFX.play('heal', a.x, a.z); break; } } }

  // ---- one hero, one step ----
  function updateActor(a, dt) {
    const c = a.c, p = c.holder.position, W = a.W; if (c.flashT > 0 && (c.flashT -= dt) <= 0) for (const m of c.mats) m.emissiveIntensity = 0;
    if (!a.alive) { if (!matchOver && (a.respawnT -= dt) <= 0) respawn(a); return; }
    a.atkCd -= dt; a.prot -= dt; if (a.ammo < RULES.ammo) a.ammo = Math.min(RULES.ammo, a.ammo + dt / W.reload);
    const sp0 = layout.spawns[a.side][1], atBase = dist2(a.x, a.z, sp0[0], sp0[1]) < RULES.baseR + 2.5; const h0 = a.hp; if (a.hp < a.maxHp && (atBase || NOW - a.lastHit > RULES.regenDelay)) a.hp = Math.min(a.maxHp, a.hp + (atBase ? RULES.baseHeal : RULES.regen) * dt); a.healGain = (a.healGain || 0) + (a.hp - h0); if (a.hp > h0) a.healT = NOW + .3; a.healing = (a.healT || 0) > NOW; if (a.healGain >= 30 && a.isPlayer) { popNum(a.x, a.z, '+' + Math.round(a.healGain), '#5dff7a'); a.healGain = 0; } if (a.hp >= a.maxHp) a.healGain = 0;
    a.bar.position.set(p.x, 2.15 + p.y, p.z); drawHpBar(a.bar, a.hp, a.maxHp, a.isPlayer ? 'me' : (a.side === player.side ? 'A' : 'B'), a.healing, a.isPlayer); a.ammoBar.visible = a.isPlayer && !DBG.spectate; if (a.ammoBar.visible) { setBar(a.ammoBar, Math.floor(a.ammo + .001) / RULES.ammo + (a.ammo % 1) / RULES.ammo * .0); a.ammoBar.userData.fg.scale.x = Math.max(.001, a.ammoBar.userData.w * a.ammo / RULES.ammo); a.ammoBar.position.set(p.x, 1.86 + p.y, p.z); }
    a.supRing.visible = a.sup >= 1; if (a.supRing.visible) a.supRing.material.opacity = .6 + .35 * Math.sin(NOW * 8);
    const ox = p.x, oz = p.z, inp = a.inp, mag = Math.min(1, Math.hypot(inp.mx, inp.mz)), moving = mag > .12, mdx = moving ? inp.mx / Math.hypot(inp.mx, inp.mz) : 0, mdz = moving ? inp.mz / Math.hypot(inp.mx, inp.mz) : 0;
    if (a.state === 'free') {
      const sp = a.H.speed * Math.min(1, mag * 1.2) * (a.carry ? RULES.battery.slow : 1), k = Math.min(1, dt * RULES.accel); a.mvx += ((moving ? mdx * sp : 0) - a.mvx) * k; a.mvz += ((moving ? mdz * sp : 0) - a.mvz) * k; p.x += a.mvx * dt; p.z += a.mvz * dt; resolve(p, RULES.radius);
      for (const t of titans) if (!t.dead) { const d = dist2(p.x, p.z, t.x, t.z); if (d < 1.2 && d > 1e-3) { p.x = t.x + (p.x - t.x) / d * 1.2; p.z = t.z + (p.z - t.z) / d * 1.2; } }
      const my = yawOf(mdx, mdz), aimed = c.up && !a.carry && (a.aiming || a.shot || a.upT > 0); let anim = 'Idle', ts = 1;
      if (aimed) { c.yaw += angDiff(c.yaw, a.aimYaw - aimOffset(a, W)) * Math.min(1, dt * 18); if (moving) { anim = c.run; ts = clamp(sp / (c.speed[c.run] || 5), .6, 1.6); if (Math.cos(angDiff(c.yaw, my)) < -.2) ts = -ts; } }
      else if (moving) { c.yaw += angDiff(c.yaw, my) * Math.min(1, dt * 12); anim = c.run; ts = clamp(sp / (c.speed[c.run] || 5), .6, 1.6); }
      play(c, anim, { ts, fade: .16 });
    } else if (a.state === 'dash') { // the Boy's super: a charge that hits everything it passes
      const s = Math.min(a.sub.left, 19 * dt), bx = p.x, bz = p.z; a.sub.left -= s; p.x += Math.sin(c.yaw) * s; p.z += Math.cos(c.yaw) * s; resolve(p, RULES.radius); play(c, c.run, { ts: 1.8, fade: .05 }); puff(p.x, .5, p.z, teamHex(a.side), .28, .3, 1.6);
      for (const t of enemiesOf(a.side, true)) if (!a.sub.hit.has(t) && reach(a, t) < 1.5) { a.sub.hit.add(t); hurt(t, 55, a); }
      if (a.sub.left <= 1e-3 || dist2(bx, bz, p.x, p.z) < s * .3) { a.state = 'free'; a.mvx = a.mvz = 0; }
    } else if (a.state === 'fly') { // the Girl's super: over the walls, and a blast where she lands
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
  function endMatch(side, why) { if (matchOver) return; matchOver = { side, why }; for (const a of actors) if (a.alive) { a.inp.mx = a.inp.mz = 0; a.shot = null; if (a.c.up) upperStop(a.c, .1); a.state = 'end'; a.c.holder.position.y = 0; a.c.baseName = ''; play(a.c, side === null ? 'Idle' : (a.side === side ? ['Victory', 'Victory2'] : ['Defeat', 'Defeat2'])[Math.random() * 2 | 0], { fade: .2 }); } SFX.play(side === null ? 'lost' : side === player.side ? 'win' : 'lose'); showEnd(); }
  function timeUp() { const a = reactors.A.hp, b = reactors.B.hp; if (Math.abs(a - b) > .5) endMatch(a > b ? 'A' : 'B', 'נגמר הזמן — לכור שלהם נשארו יותר חיים'); else if (teams.A.charge !== teams.B.charge) endMatch(teams.A.charge > teams.B.charge ? 'A' : 'B', 'נגמר הזמן — יותר טעינה'); else endMatch(null, 'תיקו'); }
  let showEnd = () => { };
  buildNav(); // again, now that the pylons are in


  // =====================================================================================================
  // h4: bots. Each one picks a job every ~0.8 s (carry, heal, battery, stop a titan, escort ours, take a pylon)
  // and fights whatever is in front of it on the way, with human-ish reaction time and aim.
  // =====================================================================================================
  function makeBrain(a) { a.brain = { goal: null, path: null, pi: 0, thinkT: rnd(0, .6), pathT: 0, react: .3, strafe: Math.random() < .5 ? 1 : -1, lx: a.x, lz: a.z, stuckT: 0, moveT: 0, nudge: 0 }; }
  const PREF = { brownhair_kid: 1, purplegirl: 0, ginger_kid: 2 };
  function botThink(a) {
    const br = a.brain, side = a.side, s = side === 'A' ? 1 : -1, R = reactors[side], mates = teams[side].members.filter(m => m.alive), set = g => { if (!br.goal || br.goal.type !== g.type || br.goal.o !== g.o) { br.goal = g; br.path = null; } };
    if (a.carry) return set({ type: 'go', o: R, x: R.x, z: R.z - 3.4 * s });
    if (a.hp < a.maxHp * .32) { const pad = pads.find(p => p.t <= 0 && dist2(a.x, a.z, p.x, p.z) < 15); const sp = layout.spawns[side][1]; return set(pad ? { type: 'go', o: pad, x: pad.x, z: pad.z, flee: true } : { type: 'go', o: sp, x: sp[0], z: sp[1], flee: true }); }
    if (br.goal && br.goal.flee && a.hp < a.maxHp * .8) return;
    if (batt.state === 'ground') { const near = mates.slice().sort((p, q) => dist2(p.x, p.z, batt.x, batt.z) - dist2(q.x, q.z, batt.x, batt.z))[0]; if (near === a || dist2(a.x, a.z, batt.x, batt.z) < 7) return set({ type: 'go', o: batt, x: batt.x, z: batt.z }); }
    if (batt.state === 'carried' && batt.by.side !== side && dist2(a.x, a.z, batt.x, batt.z) < 16) return set({ type: 'kill', o: batt.by });
    const foeT = titans.find(t => !t.dead && t.side !== side); if (foeT && s * foeT.z > -8) { const order = mates.slice().sort((p, q) => dist2(p.x, p.z, foeT.x, foeT.z) - dist2(q.x, q.z, foeT.x, foeT.z)); if (order.indexOf(a) < 2 || s * foeT.z > 12) return set({ type: 'kill', o: foeT }); }
    const myT = titans.find(t => !t.dead && t.side === side); if (myT && (a.heroKey !== 'purplegirl' || dist2(a.x, a.z, myT.x, myT.z) < 9)) return set({ type: 'escort', o: myT });
    const pref = pylons[s > 0 ? PREF[a.heroKey] : 2 - PREF[a.heroKey]], open = pylons.filter(P => P.owner !== side || P.contested);
    if (open.length) { const taken = P => mates.some(m => m !== a && m.brain && m.brain.goal && m.brain.goal.o === P); let pick = open.indexOf(pref) >= 0 ? pref : null; if (!pick) { open.sort((p, q) => (taken(p) ? 30 : 0) + dist2(a.x, a.z, p.x, p.z) - (taken(q) ? 30 : 0) - dist2(a.x, a.z, q.x, q.z)); pick = open[0]; } return set({ type: 'cap', o: pick, x: pick.x + (a.slot - 1) * .9, z: pick.z + 1.6 * s }); }
    set({ type: 'cap', o: pref, x: pref.x + (a.slot - 1) * .9, z: pref.z + 1.6 * s }); // we hold everything: stand guard
  }
  function botUpdate(a, dt) {
    const br = a.brain, inp = a.inp; inp.mx = inp.mz = 0; if (!a.alive || matchOver || a.state !== 'free') return;
    if ((br.thinkT -= dt) <= 0 || !br.goal) { br.thinkT = rnd(.6, 1.0); botThink(a); } const g = br.goal; if (!g) return;
    const W = a.W, canFight = !a.carry; let dest = null, stop = .4, tgt = null;
    if (g.type === 'go') { dest = g; if (g.o === batt) { dest = batt; if (batt.state !== 'ground') br.goal = null; } }
    else if (g.type === 'cap') { dest = g; stop = .8; }
    else if (g.type === 'kill') { tgt = g.o; if (g.o.dead || g.o.alive === false) { br.goal = null; return; } }
    else if (g.type === 'escort') { if (g.o.dead) { br.goal = null; return; } const s = a.side === 'A' ? 1 : -1; dest = { x: g.o.x + (a.slot - 1) * 1.6, z: g.o.z + 2.6 * s }; stop = 1.2; if (dist2(g.o.x, g.o.z, reactors[enemyOf(a.side)].x, reactors[enemyOf(a.side)].z) < 7) tgt = reactors[enemyOf(a.side)]; }
    // fight what is close, unless carrying or running for health
    if (canFight && !(g.flee && a.hp < a.maxHp * .5)) { const near = bestTarget(a, tgt && tgt.isTitan ? 5 : 10.5); if (near && !(near.isReactor && g.type !== 'escort')) tgt = near.isReactor && tgt ? tgt : near; }
    let direct = false;
    if (tgt && canFight) {
      const d = reach(a, tgt), yaw = yawTo(a, tgt), los = tgt.isReactor || lineClear(a.x, a.z, tgt.x, tgt.z), R = W.range - (W.melee ? .5 : .6); br.react = Math.max(0, br.react - dt); a.aimYaw = yaw;
      if (d <= R && los) { if (br.react <= 0 && a.ammo >= 1 && startAttack(a, yaw + rnd(-.12, .12))) br.react = rnd(.08, .3); } else br.react = rnd(.25, .45);
      // supers
      if (a.sup >= 1) { if (a.H.sup === 'charge' && d < 5.5 && los) useSuper(a, yaw); else if (a.H.sup === 'jet' && a.hp < a.maxHp * .4) { inp.mx = -Math.sin(yaw); inp.mz = -Math.cos(yaw); useSuper(a, yaw + Math.PI); } }
      const tx = tgt.isReactor ? clamp(a.x, -2.5, 2.5) : tgt.x, tz = tgt.isReactor ? tgt.z : tgt.z, danger = tgt.isTitan && tgt.st === 'wind' && dist2(a.x, a.z, tgt.tele.position.x, tgt.tele.position.z) < 2.9;
      if (danger) { const ax = a.x - tgt.tele.position.x, az = a.z - tgt.tele.position.z, l = Math.hypot(ax, az) || 1; inp.mx = ax / l; inp.mz = az / l; direct = true; }
      else if (los && d < 13) { direct = true; const dd = dist2(a.x, a.z, tx, tz) || 1, nx = (tx - a.x) / dd, nz = (tz - a.z) / dd, want = W.melee ? R * .7 : W.range * .72, low = a.ammo < 1 && !W.melee;
        if (d > want + .4 && !low) { inp.mx = nx; inp.mz = nz; } else if ((d < want - 1.5 && !W.melee) || low) { inp.mx = -nx * .9; inp.mz = -nz * .9; } else if (!tgt.isReactor) { if (Math.random() < dt * .7) br.strafe = -br.strafe; inp.mx = -nz * br.strafe * .85; inp.mz = nx * br.strafe * .85; }
        // do not abandon a pylon we are standing on just to chase
        if (g.type === 'cap' && dist2(a.x, a.z, g.o.x, g.o.z) < RULES.pylonR && dist2(a.x + inp.mx, a.z + inp.mz, g.o.x, g.o.z) > RULES.pylonR - .3) { inp.mx = (g.o.x - a.x) * .5; inp.mz = (g.o.z - a.z) * .5; } }
      else dest = { x: tx, z: tz };
    }
    if (a.sup >= 1 && a.H.sup === 'heal' && teams[a.side].members.some(m => m.alive && m.hp < m.maxHp * .55 && dist2(a.x, a.z, m.x, m.z) < 3.8)) useSuper(a, a.c.yaw);
    if (!direct && dest) { const d = dist2(a.x, a.z, dest.x, dest.z);
      if (d > stop) { br.pathT -= dt; if (!br.path || br.pathT <= 0 || dist2(br.px, br.pz, dest.x, dest.z) > 2) { br.path = findPath(a.x, a.z, dest.x, dest.z); br.pi = 0; br.pathT = rnd(1.2, 1.8); br.px = dest.x; br.pz = dest.z; }
        while (br.pi < br.path.length - 1 && dist2(a.x, a.z, br.path[br.pi].x, br.path[br.pi].z) < .8) br.pi++; const wp = br.path[br.pi], l = dist2(a.x, a.z, wp.x, wp.z) || 1; inp.mx = (wp.x - a.x) / l; inp.mz = (wp.z - a.z) / l; } }
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
  function resize() { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 54 : 40; zoom = w < h ? 1.3 : 1.15; camera.updateProjectionMatrix(); restSticks(); }
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
    const a = player, t = Math.max(0, matchT), ot = t <= RULES.overtime; $('clock').textContent = fmt(t); $('clock').classList.toggle('ot', ot); $('otTag').hidden = !ot || !started;
    for (const s of ['A', 'B']) { const R = reactors[s], T = teams[s], k = s === player.side ? 'My' : 'Foe'; $('hp' + k).style.width = (R.hp / R.maxHp * 100) + '%'; $('hpN' + k).textContent = Math.ceil(R.hp); const tOut = titans.find(x => !x.dead && x.side === s); $('ch' + k).style.width = (tOut ? 100 : T.charge) + '%'; $('ch' + k).classList.toggle('out', !!tOut); $('chN' + k).textContent = tOut ? 'טיטאן בשטח!' : 'טיטאן ' + Math.floor(T.charge) + '%'; }
    pylons.forEach((P, i) => { const el = $('py' + i); el.style.background = P.owner ? teamCss(P.owner) : '#59606b'; el.classList.toggle('ct', P.contested); });
    for (const m of teams[a.side].members) { if (!m.mateEl) continue; m.mateEl.classList.toggle('dead', !m.alive); m.mateEl.querySelector('em').textContent = m.alive ? '' : Math.ceil(m.respawnT); m.mateEl.querySelector('b').style.width = (Math.max(0, m.hp) / m.maxHp * 100) + '%'; }
    const sb = $('btnSuper'); sb.classList.toggle('ready', a.sup >= 1); sb.style.setProperty('--k', (a.sup * 360) + 'deg'); $('supName').textContent = a.H.supName;
    $('dead').hidden = a.alive || !!matchOver || DBG.spectate; if (!a.alive) $('dead').textContent = 'חוזרים בעוד ' + Math.ceil(a.respawnT);
    $('carry').hidden = !a.carry; if (toastT > 0 && (toastT -= .033) <= 0) $('noAmmo').hidden = true;
  }
  // ---------- minimap ----------
  const mini = $('mini'), mctx = mini.getContext('2d'), mdpr = Math.min(2, dpr), MS = 2.9; mini.style.width = (2 * HW * MS) + 'px'; mini.style.height = (2 * HL * MS) + 'px'; mini.width = 2 * HW * MS * mdpr; mini.height = 2 * HL * MS * mdpr;
  function drawMini() {
    const x = mctx, k = MS * mdpr, X = v => (v + HW) * k, Z = v => (v + HL) * k, W = mini.width, H = mini.height; x.clearRect(0, 0, W, H); x.fillStyle = '#2b313b'; x.fillRect(0, 0, W, H);
    x.globalAlpha = .4; x.fillStyle = teamCss('A'); x.fillRect(0, Z(18), W, H - Z(18)); x.fillStyle = teamCss('B'); x.fillRect(0, 0, W, Z(-18)); x.globalAlpha = 1;
    x.fillStyle = '#5b6470'; for (const c of solids) if (c.t === 'b' && c.kind === 'ob') { x.save(); x.translate(X(c.x), Z(c.z)); x.rotate(-c.ry); x.fillRect(-c.hx * k, -c.hz * k, c.hx * 2 * k, c.hz * 2 * k); x.restore(); }
    for (const s of ['A', 'B']) { const R = reactors[s]; x.fillStyle = teamCss(s); x.strokeStyle = '#0b0c10'; x.lineWidth = mdpr; x.beginPath(); x.rect(X(R.x) - 3 * k, Z(R.z) - 2.5 * k, 6 * k, 5 * k); x.fill(); x.stroke(); }
    for (const P of pylons) { x.beginPath(); x.arc(X(P.x), Z(P.z), 2.6 * k, 0, 7); x.fillStyle = P.owner ? teamCss(P.owner) : '#aab1bb'; x.fill(); x.strokeStyle = P.contested && Math.sin(NOW * 12) > 0 ? '#ffd21f' : '#0b0c10'; x.lineWidth = 1.5 * mdpr; x.stroke(); }
    if (batt.state !== 'none') { x.fillStyle = '#2bd46a'; x.strokeStyle = '#fff'; x.beginPath(); x.arc(X(batt.x), Z(batt.z), (2 + Math.sin(NOW * 6)) * k, 0, 7); x.fill(); x.stroke(); }
    for (const t of titans) if (!t.dead) { x.fillStyle = teamCss(t.side); x.strokeStyle = '#fff'; x.lineWidth = 2 * mdpr; x.beginPath(); x.rect(X(t.x) - 2.2 * k, Z(t.z) - 2.2 * k, 4.4 * k, 4.4 * k); x.fill(); x.stroke(); }
    for (const a of (DBG.spectate ? actors : teams[player.side].members)) { if (!a.alive) continue; x.fillStyle = a === player && !DBG.spectate ? '#ffd21f' : teamCss(a.side); x.strokeStyle = '#0b0c10'; x.lineWidth = mdpr; x.beginPath(); x.arc(X(a.x), Z(a.z), (a === player ? 2.2 : 1.7) * k, 0, 7); x.fill(); x.stroke(); }
  }

  // ---------- start: all six heroes exist from the beginning; you pick which of the blue ones is yours ----------
  const HKEYS = Object.keys(HEROES);
  for (const side of ['A', 'B']) HKEYS.forEach((k, i) => makeActor(k, side, i));
  for (const a of actors) { respawn(a); a.prot = 0; makeBrain(a); }
  player = teams.A.members[0]; resize(); renderer.setPixelRatio(Math.min(2, dpr)); resize(); updateCamera(0, true);
  for (const a of teams.A.members) a.pic = portraitOf(a);
  { const box = $('heroes'); teams.A.members.forEach(a => { const b = document.createElement('button'); b.type = 'button'; b.className = 'hero'; b.innerHTML = '<img alt=""><b></b><span></span><small></small><em></em>'; b.querySelector('img').src = a.pic; b.querySelector('b').textContent = a.H.name; b.querySelector('span').textContent = a.H.role + ' · ' + a.H.hp + ' חיים'; b.querySelector('small').textContent = a.H.tip; b.querySelector('em').textContent = 'סופר: ' + a.H.supName; b.onclick = () => startMatch(a); box.appendChild(b); }); }
  function resetMatch() {
    matchOver = null; matchT = RULES.match; $('end').hidden = true; for (const s of shots) scene.remove(s.m); shots.length = 0;
    for (const t of titans.slice()) { t.c.holder.visible = false; t.c.busy = false; t.bar.visible = false; scene.remove(t.tele); } titans.length = 0; for (const f of fields) { scene.remove(f.ring); scene.remove(f.kit); } fields.length = 0;
    for (const s of ['A', 'B']) { teams[s].charge = 0; teams[s].titans = 0; teams[s].kills = 0; reactors[s].hp = reactors[s].maxHp; } for (const P of pylons) { P.p = 0; P.owner = null; }
    if (batt.by) { batt.by.carry = null; batt.by.c.held[batt.by.W.model].visible = true; } batt.state = 'none'; batt.by = null; batt.next = RULES.battery.first; batt.warned = false; for (const m of pads) { m.t = 0; m.mesh.visible = m.halo.visible = true; }
    for (const a of actors) { a.kills = a.dmg = a.deaths = 0; a.sup = 0; a.carry = null; if (a.c.up) upperStop(a.c, 0); respawn(a); a.prot = 0; makeBrain(a); } lastSec = 999;
  }
  function startMatch(a) { if (a) { player.isPlayer = false; player = a; } player.isPlayer = true; resetMatch(); started = true; $('pick').hidden = true; buildMates(); updateCamera(0, true); restSticks(); banner('כבשו עמודים · טענו טיטאן · השמידו את הכור!', '#ffd21f', 3); SFX.play('start'); }
  showEnd = () => { const s = matchOver.side, me = player; $('endTitle').textContent = s === null ? 'תיקו' : s === me.side ? 'ניצחון!' : 'הפסד'; $('endTitle').style.color = s === null ? '#fff' : s === me.side ? '#3fdc5d' : '#ff5548'; $('endWhy').textContent = matchOver.why;
    $('endStats').innerHTML = teams[me.side].members.map(m => '<div' + (m === me ? ' class="me"' : '') + '><b>' + m.name + '</b> חיסולים ' + m.kills + ' · נזק ' + Math.round(m.dmg) + ' · נפילות ' + m.deaths + '</div>').join(''); if (!DBG.sim) setTimeout(() => { if (matchOver) $('end').hidden = false; }, 1500); if (window.ARENA_SHELL && !DBG.sim && !DBG.spectate) { const r = ARENA_SHELL.result({ mode: 'titan', hero: ARENA_SHELL.prof.hero, win: s === me.side, draw: s === null, kills: me.kills }); if (r && window.showReward) showReward(r); } };
  $('endBtn').onclick = () => { $('end').hidden = true; if (window.ARENA_SHELL) { ARENA_SHELL.again(); startMatch(player); } else { started = false; $('pick').hidden = false; resetMatch(); } };

  // ---------- debug ----------
  const CHECKS = [['sim', 'סימולציה: בוטים בלבד, מהיר, סטטיסטיקה'], ['spectate', 'מצב צופה (גרירה / WASD, Q לשחקן הבא)'], ['god', 'בלי למות'], ['bots', 'בוטים פעילים'], ['sound', 'צלילים'], ['stats', 'FPS']];
  function syncDbg() { if (DBG.sim) { DBG.spectate = true; DBG.bots = true; DBG.sound = false; if (!started) startMatch(null); } for (const [k] of CHECKS) $('chk_' + k).checked = !!DBG[k]; document.body.classList.toggle('spec', !!DBG.spectate); $('simBox').hidden = !DBG.sim; $('stats').hidden = !DBG.stats; restSticks(); }
  for (const [k, label] of CHECKS) { const l = document.createElement('label'); l.className = 'chk'; l.innerHTML = '<input type="checkbox" id="chk_' + k + '"><span></span>'; l.lastChild.textContent = label; $('checks').appendChild(l); l.firstChild.addEventListener('change', e => { DBG[k] = e.target.checked; syncDbg(); }); }
  const ACTS = [['טיטאן לנו', () => { teams.A.charge = 100; }], ['טיטאן ליריב', () => { teams.B.charge = 100; }], ['סוללה עכשיו', () => { batt.next = .1; }], ['סופר מלא', () => { player.sup = 1; }], ['שעון ל-1:20', () => { matchT = 80; }], ['משחק חדש', () => { resetMatch(); }], ['מסך מלא', () => { try { const el = document.documentElement, f = el.requestFullscreen || el.webkitRequestFullscreen; if (f) { const r = f.call(el); if (r && r.catch) r.catch(() => { }); } } catch (e) { } }]];
  for (const [label, fn] of ACTS) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = fn; $('acts').appendChild(b); }
  $('menuBtn').onclick = () => { $('panel').hidden = !$('panel').hidden; }; $('closeMenu').onclick = () => { $('panel').hidden = true; };
  const sim = { list: [], done: false, wait: 0 };
  function simTick(rdt) {
    if (matchOver && !sim.done) { sim.done = true; sim.wait = 1; sim.list.push({ win: matchOver.side, t: RULES.match - matchT, a: reactors.A.hp | 0, b: reactors.B.hp | 0, ta: teams.A.titans, tb: teams.B.titans, ka: teams.A.kills, kb: teams.B.kills }); }
    if (sim.done && (sim.wait -= rdt) <= 0) { sim.done = false; resetMatch(); }
    if (frame % 15) return; const Lm = sim.list, wa = Lm.filter(m => m.win === 'A').length, wb = Lm.filter(m => m.win === 'B').length, avg = f => Lm.length ? Lm.reduce((s, m) => s + f(m), 0) / Lm.length : 0;
    let o = 'משחק ' + (Lm.length + 1) + ' · ' + fmt(RULES.match - matchT) + ' · כורים ' + (reactors.A.hp | 0) + '–' + (reactors.B.hp | 0) + ' · טעינה ' + (teams.A.charge | 0) + '–' + (teams.B.charge | 0) + ' · עמודים ' + pylons.map(P => P.owner || '·').join('') + '\n';
    o += 'נצחונות A ' + wa + ' · B ' + wb + ' · תיקו ' + (Lm.length - wa - wb) + ' · אורך ממוצע ' + fmt(avg(m => m.t)) + ' · טיטאנים ' + avg(m => m.ta + m.tb).toFixed(1) + ' · חיסולים ' + avg(m => m.ka + m.kb).toFixed(1) + '\n';
    for (const m of Lm.slice(-7)) o += (m.win || '=') + ' ' + fmt(m.t) + ' · כורים ' + m.a + '–' + m.b + ' · טיטאנים ' + m.ta + '–' + m.tb + ' · חיסולים ' + m.ka + '–' + m.kb + '\n'; $('simBox').textContent = o;
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
    if (!matchOver && started) { updateShots(dt); updateReactors(dt); updatePylons(dt); updateBattery(dt); updateFields(dt); updatePads(dt); if ((matchT -= dt) <= 0) timeUp(); }
  }
  function loop() {
    requestAnimationFrame(loop); const rdt = Math.min(.05, clock.getDelta()); frame++;
    const steps = DBG.sim ? 8 : 1, dt = DBG.sim ? .05 : rdt * DBG.speed; if (started) for (let k = 0; k < steps; k++) stepGame(dt); else NOW += rdt; if (DBG.sim) simTick(rdt);
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
