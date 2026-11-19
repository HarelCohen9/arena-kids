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
  const asT = noiseTex('#3b3b40', [['#55555b', 60, 26, .1], ['#2c2c30', 70, 22, .12], ['#6c6c72', 5200, 1.1, .5], ['#232327', 5200, 1.2, .55], ['#8d8d92', 900, .8, .6], ['#4a463f', 500, 1.6, .35]], 1024); asT.repeat.set(2 * HW / 7, 2 * HL / 7);
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


  // =====================================================================================================
  // g2: rules numbers, helpers, characters + animation layers, weapons, damage
  // =====================================================================================================
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  // VERSION 3 numbers. The goal: slower, more deliberate fights (about 4-6 s to kill), the same powers for both teams,
  // a city hall that only opens once a team has earned it, and a hot zone that takes a real push to win.
  const RULES = {
    hp: 150, speed: 4.3, accel: 11, turn: 11, regenDelay: 6, regen: 5, baseHeal: 30, baseR: 7, respawn: 9, respawnBehind: 2, spawnProt: 2, radius: .42,
    ringR: 7, ringR3: 7, coreR: 18, hzR: 8.5, coreHp: 2000, coreNeed: 4, coreDmg: 16, coreEvery: 2.2, coreAoe: 14, coreAoeEvery: 7, coreAoeR: 3.2, coreAoeWarn: 1.0,
    hz: [0, 1.3, 1.85, 2.3], match: 420, immunity: 12, claim: [0, 9, 12, 15], pendingMax: 20, leaveGrace: 2.5, partWindow: 15,
    guard: [null, { hp: 800, dmg: 14, every: 2.8, speed: 2.6 }, { hp: 1300, dmg: 18, every: 2.8, speed: 2.8 }, { hp: 1900, dmg: 22, every: 2.8, speed: 3.0 }],
    carry: [0, .85, .75, .65], dragSpeed: .5, medkit: 45, medkitRespawn: 30, itemIdle: 20,
    dash: { dist: 3.2, cd: 8, charges: 2 }, jump: { dist: 3.5, cd: .3 }, jet: { fuel: 2.6, cd: 14, speed: 6, alt: 5.2 }, shieldCd: 15, hpBonus: 30, speedBonus: 1.1,
    fence: { hp: 80, regen: 25, r: 5.2, n: 9 }, invis: { dur: 2, cd: 20 }, reflect: { dur: 2, cd: 22, pct: .4, cap: 30 }, unplug: [0, 3, 4.5, 3],
  };
  // dmg / seconds between attacks / range come from the balance document; clip + 'at' = the frame of the clip where the hit happens
  const WEAPONS = {
    fist: { name: 'אגרופים', dmg: 11, every: 0.62, range: 3.0, melee: true, clips: ['Punching_left', 'Punching_right'], at: .38, wind: .2, model: null },
    stick: { name: 'מקל', dmg: 19, every: 0.78, range: 1.8 + 1.2, melee: true, clips: ['Standing Melee Attack Horizontal'], at: .42, wind: .28, model: 'stick' },
    sling: { name: 'רוגטקה', dmg: 13, every: 0.6, range: 6.5, clips: ['Standing Draw Arrow'], at: .72, wind: .22, model: 'slingshot', shot: 'stone', speed: 17, pve: 1.28, hand: 'LeftHand' },
    sword: { name: 'חרב', dmg: 21, every: 0.75, range: 1.9 + 1.2, melee: true, clips: ['Standing Melee Attack Downward'], at: .45, wind: .28, model: 'sword' },
    bow: { name: 'קשת', dmg: 21, every: 0.82, range: 7.5, clips: ['Standing Draw Arrow'], at: .72, wind: .28, model: 'bow', shot: 'arrow', speed: 18, pve: 1.28, hand: 'LeftHand' },
    pistol: { name: 'אקדח', dmg: 13, every: .42, range: 6.2, clips: ['Shooting'], at: .3, wind: .12, model: 'pistol', shot: 'dart', speed: 22, hand: 'RightHand' },
  };
  const ATTACK_CLIPS = new Set([].concat(...Object.values(WEAPONS).map(w => w.clips)));
  const TEAM_HEX = { blue: 0x3f7fe0, red: 0xd6453b }, TEAM_CSS = { blue: '#4f8ff0', red: '#e5574c' };
  const TRACK_HEX = { elec: 0xffd21f, air: 0x56c1ff, weapon: 0xff7a4d }, TRACK_NAME = { elec: 'חשמל', air: 'רוח', weapon: 'נשק' };
  const SLOT = { stick: 'R', sword: 'R', pistol: 'R', pole: 'R', bow: 'L', slingshot: 'L', jetpack: 'B' };
  const LOOPS = /^(Idle|Running|RunningGinger|Running_girl|Carry Run|Pull Heavy Object|Flying)$/, TRIM = { Picking_Up: [.9, 3.6] };
  const DBG = { clock: true, allies: true, enemies: true, aggressive: true, god: false, oneHit: false, noCd: false, coreFires: true, bossesAttack: true, minimap: true, zoom: 1, auto: false, spectate: false, sound: true, voice: false, sim: false, cols: false, stats: false, paths: false, speed: 1, res: 0, char: 0, color: 'blue' };
  try { Object.assign(DBG, JSON.parse(localStorage.getItem('arenaDbg') || '{}')); } catch (e) { }
  if (window.ARENA_SHELL) { DBG.sim = false; DBG.spectate = false; DBG.auto = false; DBG.voice = false; DBG.color = 'blue'; DBG.char = Math.max(0, ARENA_SHELL.HEROES.indexOf(ARENA_SHELL.prof.hero)); }
  const saveDbg = () => { try { localStorage.setItem('arenaDbg', JSON.stringify(DBG)); } catch (e) { } };

  const yawOf = (x, z) => Math.atan2(x, z), angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
  const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz), clamp = (v, a, b) => Math.max(a, Math.min(b, v)), rnd = (a, b) => a + Math.random() * (b - a);
  const tex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t; };
  let NOW = 0; // game clock, seconds

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
  // ---------- actors (the six players) ----------
  const actors = [], teams = { A: { side: 'A', color: 'blue', members: [], hz: 0, coreDmg: 0 }, B: { side: 'B', color: 'red', members: [], hz: 0, coreDmg: 0 } };
  const NAMES = { brownhair_kid: 'Boy', purplegirl: 'Girl', ginger_kid: 'Ginger' };
  const enemyOf = t => t === 'A' ? 'B' : 'A';
  function makeActor(charKey, side, slot) {
    const color = teams[side].color, c = makeChar(A2['chars/' + charKey + '_' + color], charKey + '_' + color); styleBody(c, .8, 1.32);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.5, .62, 28), new THREE.MeshBasicMaterial({ color: TEAM_HEX[color], transparent: true, opacity: .9, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = .03; ring.renderOrder = 2; c.holder.add(ring);
    const bar = makeHpBar(); scene.add(bar);
    const bubble = makeShield(); bubble.position.y = .95; bubble.visible = false; c.holder.add(bubble);
    scene.add(c.holder);
    const a = { c, side, slot, charKey, name: NAMES[charKey], isPlayer: false, hp: RULES.hp, alive: true, state: 'free', weapon: 'fist', atkCd: 0, shot: null, lastHit: -99, respawnT: 0, prot: 0, cd: {}, shieldUp: false, shieldAt: 0, invisT: 0, reflectT: 0, slowT: 0, hitT: 0,
      dashN: RULES.dash.charges, dashT: 0, noAct: 0, back: false, inp: { mx: 0, mz: 0, aim: null }, aimYaw: 0, aiming: false, carry: null, cable: null, chan: null, sub: null, ring, bar, bubble, ringMat: ring.material, kills: 0 };
    Object.defineProperty(a, 'x', { get: () => c.holder.position.x }); Object.defineProperty(a, 'z', { get: () => c.holder.position.z });
    actors.push(a); teams[side].members.push(a); return a;
  }
  const maxHp = a => RULES.hp + (has(a.side, 'e1') ? RULES.hpBonus : 0);
  const moveSpeed = a => RULES.speed * (has(a.side, 'a1') ? RULES.speedBonus : 1) * (a.slowT > 0 ? .85 : 1);
  const efficient = side => false;
  function ownedWeapons(a) { const w = ['fist']; if (has(a.side, 'w1')) w.push('stick'); if (has(a.side, 'w2')) w.push('bow'); if (has(a.side, 'w3')) w.push('pistol'); return w; }
  function setWeapon(a, key) { a.weapon = key; if (a.full) { a.full = null; a.c.baseName = ''; } for (const k of ['stick', 'sword', 'slingshot', 'bow', 'pistol']) detach(a.c, k); const m = WEAPONS[key].model; if (m) attach(a.c, m); a.shot = null; if (a.c.up) upperStop(a.c, .1); a.aiming = false; }
  // called when a team's upgrades change: best weapon in hand, jetpack on the back, max hp
  function refreshLoadout(side, gained) {
    for (const a of teams[side].members) {
      const own = ownedWeapons(a); if (own.indexOf(a.weapon) < 0 || gained === 'w') setWeapon(a, own[own.length - 1]);
      if (has(side, 'a3')) attach(a.c, 'jetpack'); else { detach(a.c, 'jetpack'); if (a.state === 'fly') a.sub.fuel = 0; }
      a.hp = Math.min(a.hp, maxHp(a)); if (gained === 'e1' && a.alive) a.hp = Math.min(maxHp(a), a.hp + RULES.hpBonus);
      if (has(side, 'e2')) { if (!a.shieldUp && a.shieldAt === 0) a.shieldUp = true; } else a.shieldUp = false;
    }
  }
  const visibleTo = (target, side) => target.alive && (target.side === side || target.invisT <= 0);
  function hideHands(a, hide) { const m = WEAPONS[a.weapon].model; if (m && a.c.held[m]) a.c.held[m].visible = !hide; }

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
  // exact swept test: segment (x,z)->(x+dx*s) against a circle; returns distance along the segment or -1
  function segCircle(x, z, dx, dz, s, cx, cz, r) { const fx = x - cx, fz = z - cz, b = fx * dx + fz * dz, c = fx * fx + fz * fz - r * r; if (c <= 0) return 0; const d = b * b - c; if (d < 0) return -1; const t = -b - Math.sqrt(d); return t >= 0 && t <= s ? t : -1; }
  function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i], step = Math.min(s.left, s.speed * dt); let best = step + 1, hit = null;
      if (s.owner === 'core' || s.boss) { for (const a of actors) { if (!a.alive || a.state === 'fly' && !s.overWalls) continue; if (s.y0 !== undefined && s.y > 2.3) continue; /* a diving tracer only hits near the ground */ const t = segCircle(s.x, s.z, s.dx, s.dz, step, a.x, a.z, .5); if (t >= 0 && t < best) { best = t; hit = a; } } }
      else {
        for (const a of actors) { if (!a.alive || a.side === s.side || a.state === 'fly') continue; const t = segCircle(s.x, s.z, s.dx, s.dz, step, a.x, a.z, .5); if (t >= 0 && t < best) { best = t; hit = a; } }
        for (const g of guards) { if (g.dead || g.owner === s.side) continue; const t = segCircle(s.x, s.z, s.dx, s.dz, step, g.x, g.z, .75); if (t >= 0 && t < best) { best = t; hit = g; } }
        for (const f of fences) { if (f.side === s.side || f.broken) continue; const t = rayHitOne(f.col, s.x, s.z, s.dx, s.dz); if (t <= step && t < best) { best = t; hit = f; } }
        if (!core.dead) for (const c of core.cols) { const t = rayHitOne(c, s.x, s.z, s.dx, s.dz); if (t <= step && t < best) { best = t; hit = core; } }
      }
      const adv = hit ? best : step; s.x += s.dx * adv; s.z += s.dz * adv; s.left -= adv;
      if (s.y0 !== undefined) s.y = s.y1 + (s.y0 - s.y1) * (s.left / s.total); else if (s.kind === 'stone') s.y = s.y1 - .5 * (1 - s.left / s.total);
      s.m.position.set(s.x, s.y, s.z);
      if (hit) { hurt(hit, s.dmg * (hit.isGuard && s.pve ? s.pve : 1), s.owner, s.side); puff(s.x, s.y, s.z, 0xffffff, .12, .2, 1.5); }
      if (hit || s.left <= 1e-4) { if (!hit) puff(s.x, Math.max(.15, s.y), s.z, 0xd8d4ca, .09, .25, 1.6); scene.remove(s.m); shots.splice(i, 1); }
    }
  }

  // ---------- attacking ----------
  const chestY = .95;
  function aimOffset(a, W) { if (!W.hand) return 0; const clip = a.atkClip || W.clips[0]; return a.c.aimOff[(a.full ? 'F' : 'U') + clip + W.hand] || 0; }
  const isMoving = a => Math.hypot(a.inp.mx, a.inp.mz) > .12;
  // begin an attack toward yaw: the animation starts now and the hit lands when the clip reaches its hit frame
  function startAttack(a, yaw) {
    if (!a.alive || a.atkCd > 0 || a.shot || a.carry || a.cable || a.chan || a.state === 'fly' || a.state === 'dead' || a.state === 'jump') return false;
    const W = WEAPONS[a.weapon], clip = W.clips[(a.atkIdx = (a.atkIdx || 0) + 1) % W.clips.length], dur = a.c.clips[clip].duration, ts = W.at * dur / W.wind;
    a.aimYaw = yaw; a.atkCd = W.every; a.shot = { t: W.wind, W }; a.attackT = Math.max(W.wind + .25, W.every * .9); a.atkClip = clip;
    if (!isMoving(a)) { // standing: the whole body swings / shoots, legs included
      const held = a.full && a.full.hold && a.full.clip === clip; if (a.c.up) { a.c.up.a.fadeOut(.06); a.c.up = null; }
      if (!held) play(a.c, clip, { once: true, ts, fade: .08 }); a.c.base.timeScale = ts; a.full = { clip, hold: false }; a.shot.t = Math.max(.04, (W.at * dur - a.c.base.time) / ts);
    } else if (a.aiming && a.c.up && a.c.up.hold && a.c.up.name === clip) { a.full = null; a.c.up.hold = false; a.c.up.a.paused = false; a.c.up.a.timeScale = ts; a.shot.t = Math.max(.04, (W.at * dur - a.c.up.a.time) / ts); }
    else { a.full = null; upperStart(a.c, clip, ts, 0, false); }
    if (W.melee) SFX.play('swing', a.x, a.z);
    a.aiming = false; if (a.invisT > 0) { a.invisT = 0; setGhost(a.c, false); } a.prot = 0;
    return true;
  }
  function holdAim(a, yaw) { // pose held just before the hit frame while the player is aiming
    if (!a.alive || a.carry || a.cable || a.chan || a.state !== 'free') { a.aiming = false; return; }
    a.aimYaw = yaw; if (a.shot) return;
    const W = WEAPONS[a.weapon], clip = W.clips[0], holdT = W.at * a.c.clips[clip].duration * (W.melee ? .3 : .92); a.aiming = true; a.atkClip = clip; // melee waits in its wind-up, not mid-swing
    if (!isMoving(a)) { if (!a.full || !a.full.hold || a.full.clip !== clip) { if (a.c.up) { a.c.up.a.fadeOut(.06); a.c.up = null; } a.full = { clip, hold: true }; const ac = play(a.c, clip, { once: true, ts: 1, fade: .1 }); ac.time = holdT; ac.timeScale = 0; } }
    else if (!a.c.up || !a.c.up.hold || a.c.up.name !== clip) { a.full = null; upperStart(a.c, clip, 1, holdT, true); }
  }
  function cancelAim(a) { if (a.aiming) { a.aiming = false; if (a.c.up && a.c.up.hold) upperStop(a.c, .12); if (a.full && a.full.hold) { a.full = null; a.c.baseName = ''; } } }
  function landAttack(a, W) {
    const yaw = a.aimYaw, dx = Math.sin(yaw), dz = Math.cos(yaw);
    if (!W.melee) { SFX.play(W.shot, a.x, a.z); fireShot(a, a.side, W.shot, a.x + dx * .45, chestY, a.z + dz * .45, yaw, W.range, W.speed, W.dmg * (DBG.oneHit && a.isPlayer ? 50 : 1), { pve: (W.pve || 1) * (efficient(a.side) ? 1.2 : 1) }); if (W.shot === 'dart') puff(a.x + dx * .6, chestY, a.z + dz * .6, 0xffe08a, .07, .12, 1.5); return; }
    // melee: everything in a 120 degree arc within reach, unless a wall is in the way
    const reach = W.range, dmg = W.dmg * (DBG.oneHit && a.isPlayer ? 50 : 1), test = (tx, tz, r) => { const d = dist2(a.x, a.z, tx, tz); if (d > reach + r) return false; if (d > .3 && Math.abs(angDiff(yaw, yawOf(tx - a.x, tz - a.z))) > 1.05 + Math.atan2(r, d)) return false; return lineClear(a.x, a.z, tx, tz, 1.3) || d < r + .6; };
    let any = false;
    for (const t of actors) if (t.alive && t.side !== a.side && t.state !== 'fly' && test(t.x, t.z, .45)) { hurt(t, dmg, a, a.side); any = true; }
    for (const g of guards) if (!g.dead && g.owner !== a.side && test(g.x, g.z, .75)) { hurt(g, dmg * (efficient(a.side) ? 1.2 : 1), a, a.side); any = true; }
    for (const f of fences) if (f.side !== a.side && !f.broken && test(f.x, f.z, 1.3)) { hurt(f, dmg, a, a.side); any = true; }
    if (!core.dead) { const c = core.cols[0], px = clamp(a.x, c.x - c.hx, c.x + c.hx), pz = clamp(a.z, c.z - c.hz, c.z + c.hz); if (dist2(a.x, a.z, px, pz) <= reach && Math.abs(angDiff(yaw, yawOf(px - a.x, pz - a.z))) < 1.3) { hurt(core, dmg, a, a.side); any = true; puff(px, 1.3, pz, 0xffffff, .14, .2, 1.5); } }
    if (any) { puff(a.x + dx * 1.1, 1.1, a.z + dz * 1.1, 0xffffff, .16, .16, 1.4); SFX.play('thud', a.x, a.z); }
  }

  // ---------- damage ----------
  let feed = () => { }, toast = () => { }, onPlayerHit = () => { };
  function hurt(t, dmg, src, srcSide, reflected) {
    if (matchOver) return;
    if (t === core) { if (core.dead) return; if (srcSide && !coreOpenFor(srcSide)) { SFX.play('shieldPop', 0, 0, .4); return; } SFX.play('coreHit', 0, 0, .12); core.hp = Math.max(0, core.hp - dmg); if (srcSide) teams[srcSide].coreDmg += dmg; core.shake = .12; if (core.hp <= 0) destroyCore(srcSide); return; }
    if (t.isFence) { if (t.broken) return; t.hp -= dmg; if (!t.bar) { t.bar = makeBar(1.3, 0x4f8ff0); t.bar.position.set(t.x, 1.6, t.z); scene.add(t.bar); } setBar(t.bar, t.hp / RULES.fence.hp); t.bar.visible = true; t.mesh.material.opacity = .55 + .45 * Math.max(0, t.hp / RULES.fence.hp); if (t.hp <= 0) breakFence(t); return; }
    if (t.isGuard) { if (t.dead || t.immune) return; t.hp -= dmg; flash(t.c, 0xff3b30); setBar(t.bar, t.hp / t.maxHp); if (src && src.side) t.threat = src; if (t.hp <= 0) guardDied(t); return; }
    if (!t.alive || t.prot > 0) return;
    if (t.isPlayer && DBG.god) dmg = 0;
    if (t.shieldUp) { SFX.play('shieldPop', t.x, t.z); t.shieldUp = false; t.shieldAt = NOW + RULES.shieldCd; ringFx(t.x, t.z, 1, 0x7fd4ff, .35); t.lastHit = NOW; return; }
    if (t.reflectT > 0 && !reflected && src && src !== 'core') { hurt(src, Math.min(RULES.reflect.cap, dmg * RULES.reflect.pct), t, t.side, true); ringFx(t.x, t.z, 1.1, 0xc58cff, .3); }
    t.hp -= dmg; t.lastHit = NOW; flash(t.c, 0xff3b30); if (t.carry) t.slowT = .75;
    if (t.isPlayer) SFX.play('hurtMe', undefined, undefined, .08); else if (src && src.isPlayer && src.weapon && !WEAPONS[src.weapon].melee) SFX.play('thud', t.x, t.z, .05);
    if (t.isPlayer) onPlayerHit(dmg);
    if (t.hp <= 0) { kill(t, src); return; }
    if (!t.c.up && !t.full && t.state === 'free' && !t.carry && !t.cable) { upperStart(t.c, Math.random() < .5 ? 'Head Hit' : 'Stomach Hit', 1.5, .05, false); t.hitT = .5; }
  }
  function kill(a, src) {
    a.hp = 0; a.alive = false; a.respawnT = RULES.respawn - (ownedCount(a.side) < ownedCount(enemyOf(a.side)) ? RULES.respawnBehind : 0); a.shot = null; a.aiming = false; a.chan = null; a.full = null;
    if (a.carry) dropItem(a); if (a.cable) dropCable(a); if (a.state === 'fly' || a.state === 'jump') a.c.holder.position.y = 0;
    a.state = 'dead'; if (a.c.up) upperStop(a.c, .05); a.c.twist = 0; a.c.baseName = ''; play(a.c, Math.random() < .5 ? 'death1' : 'death2', { fade: .08 });
    a.ring.visible = false; a.bar.visible = false; a.bubble.visible = false; a.back = false; setGhost(a.c, false); a.invisT = 0; a.reflectT = 0;
    if (src && src.side && src !== a) src.kills++;
    SFX.play('death', a.x, a.z); if (src && src.isPlayer) { SFX.play('kill'); SFX.say('חיסלת את ' + a.name); } else if (a.isPlayer) SFX.say('חוסלת');
    else if (a.side === player.side) SFX.say(a.name + ' נפל'); 
    feed((src === 'core' ? 'העירייה' : src && src.isGuard ? 'השומר' : src && src.name ? src.name : '—') + ' חיסל את ' + a.name, a.side);
  }
  function respawn(a) {
    const sp = layout.spawns[a.side][a.slot]; a.c.holder.position.set(sp[0], 0, sp[1]); a.c.yaw = a.side === 'A' ? Math.PI : 0; a.hp = maxHp(a); a.alive = true; a.state = 'free'; a.prot = RULES.spawnProt; a.lastHit = -99; a.atkCd = 0;
    a.ring.visible = true; a.bar.visible = true; a.c.baseName = ''; play(a.c, 'Idle', { fade: 0 }); a.c.holder.visible = true; if (a.brain) a.brain.goal = null;
  }


  // =====================================================================================================
  // g3: buildings + quest engine, guards, wind items, cables, core + hot zone, fences, medkits, abilities, actor update
  // =====================================================================================================
  let matchOver = null, matchT = RULES.match;
  const KEY = { weapon: 'w', air: 'a', elec: 'e' };
  const blds = layout.buildings.map(b => ({ track: b.track, tier: b.tier, x: b.x, z: b.z, ry: b.ry, home: b.tier === 3 ? null : (b.z > 0 ? 'A' : 'B'), active: false, holder: null, q: null, immune: 0, R: b.tier === 3 ? RULES.ringR3 : RULES.ringR }));
  const bldOf = (side, track, tier) => blds.find(b => b.track === track && b.tier === tier && (tier === 3 || b.home === side));
  const ownedCount = side => blds.filter(b => b.tier === 3 ? b.holder === side : (b.home === side && b.active)).length;
  const coreOpenFor = side => ownedCount(side) >= RULES.coreNeed;
  function has(side, key) { const b = bldOf(side, key[0] === 'w' ? 'weapon' : key[0] === 'a' ? 'air' : 'elec', +key[1]); return b.tier === 3 ? b.holder === side : b.active; }
  const bName = b => TRACK_NAME[b.track] + ' T' + b.tier;
  const inRing = (b, side) => actors.filter(a => a.alive && a.side === side && a.state !== 'fly' && dist2(a.x, a.z, b.x, b.z) <= b.R);
  function canStart(side, b) {
    if (b.q || NOW < b.immune || matchOver) return false;
    if (b.tier < 3) return b.home === side ? (!b.active && (b.tier === 1 || bldOf(side, b.track, 1).active)) : b.active;
    return b.holder !== side && bldOf(side, b.track, 2).active;
  }
  // ---- building visuals: ground ring + state colour, bulb / socket on the electricity ones ----
  const ray = new THREE.Raycaster();
  for (const b of blds) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(b.R - .16, b.R, 56), new THREE.MeshBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: .55, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.set(b.x, .03, b.z); scene.add(ring); b.ring = ring;
    // ownership you can read from across the map: the ring's floor fills with the owner's colour and a big flag flies on the roof
    const fill = new THREE.Mesh(new THREE.CircleGeometry(b.R - .16, 48), new THREE.MeshBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0, depthWrite: false })); fill.rotation.x = -Math.PI / 2; fill.position.set(b.x, .025, b.z); scene.add(fill); b.fill = fill;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(.38), new THREE.MeshBasicMaterial({ color: 0x9aa0a8 })); const top = hgrid[Math.floor((b.z + HL) * HG) * hgW + Math.floor((b.x + HW) * HG)] || 4; b.top = top; gem.position.set(b.x, top + 1.9, b.z); scene.add(gem); b.gem = gem;
    const flag = new THREE.Group(), pole = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 2.2, 8), new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: .5, roughness: .4 })), cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.2, .75, 8, 1), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, side: THREE.DoubleSide, roughness: .8 }));
    pole.position.y = 1.1; cloth.position.set(.62, 1.8, 0); flag.add(pole, cloth); flag.position.set(b.x + 1.6, top, b.z - 1.2); flag.visible = false; scene.add(flag); b.flag = { g: flag, cloth, base: cloth.geometry.attributes.position.array.slice() };
    const toCore = Math.hypot(b.x, b.z) || 1, fp = freeNear(b.x - b.x / toCore * 4.6, b.z - b.z / toCore * 4.6); b.front = { x: fp[0], z: fp[1] };
    if (b.track !== 'elec') continue;
    // socket glued to the wall: a ray from outside finds the real wall surface. T1 faces its base, the others face the middle of the map.
    const s = Math.sign(b.z), o = b.tier === 1 ? V3(b.x - 1.7 * Math.cos(b.ry), .95, b.z + 6 * s) : V3(b.x + 6, .95, b.z + .5), d = b.tier === 1 ? V3(0, 0, -s) : V3(-1, 0, 0);
    ray.set(o, d); ray.far = 8; const hit = ray.intersectObjects(statics, false)[0], p = hit ? hit.point : o.clone().addScaledVector(d, 4);
    const sock = new THREE.Mesh(new THREE.PlaneGeometry(.5, .5), new THREE.MeshStandardMaterial({ map: socketTex(), roughness: .6, emissive: 0x000000, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); sock.position.copy(p).addScaledVector(d, -.015); sock.rotation.y = yawOf(-d.x, -d.z); scene.add(sock);
    b.sock = { x: p.x, y: .95, z: p.z, nx: -d.x, nz: -d.z, fx: p.x - d.x * .95, fz: p.z - d.z * .95, mesh: sock };
    const bulb = new THREE.Group(), glass = new THREE.Mesh(new THREE.SphereGeometry(.62, 16, 12), new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: .25, emissive: 0x000000, transparent: true, opacity: .92 })), neck = new THREE.Mesh(new THREE.CylinderGeometry(.26, .32, .42, 12), new THREE.MeshStandardMaterial({ color: 0x8f979e, metalness: .5, roughness: .4 }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffd21f, transparent: true, depthWrite: false, opacity: 0 })); glow.scale.set(4.2, 4.2, 1);
    glass.position.y = .78; neck.position.y = .2; glow.position.y = .78; bulb.add(neck, glass, glow); bulb.position.set(b.x, top, b.z); scene.add(bulb); b.bulb = { glass, glow };
  }
  function socketTex() { return socketTex.t || (socketTex.t = tex(128, 128, x => { x.fillStyle = '#f1efe6'; x.fillRect(4, 4, 120, 120); x.strokeStyle = '#2a2a2e'; x.lineWidth = 6; x.strokeRect(4, 4, 120, 120); x.fillStyle = '#d9d5c8'; x.beginPath(); x.arc(64, 64, 40, 0, 7); x.fill(); x.fillStyle = '#2a2a2e'; for (const dx of [-15, 15]) { x.beginPath(); x.arc(64 + dx, 64, 7, 0, 7); x.fill(); } })); }
  function glowTex() { return glowTex.t || (glowTex.t = tex(64, 64, x => { const g = x.createRadialGradient(32, 32, 2, 32, 32, 31); g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(.4, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); })); }
  function paintBuilding(b) {
    const owner = b.tier === 3 ? b.holder : (b.active ? b.home : null), base = owner ? TEAM_HEX[teams[owner].color] : 0x9aa0a8, blink = Math.sin(NOW * 8) > 0;
    let col = base; if (b.q) col = b.q.phase === 'pending' ? (blink ? 0xffd21f : base) : (blink ? 0xffffff : TEAM_HEX[teams[b.q.side].color]);
    b.ring.material.color.setHex(col); b.ring.material.opacity = NOW < b.immune ? .3 + .2 * Math.sin(NOW * 5) : .7; b.gem.material.color.setHex(base); b.gem.rotation.y = NOW * 1.5; b.gem.visible = !!owner;
    b.fill.material.color.setHex(owner ? base : 0x9aa0a8); b.fill.material.opacity = owner ? .2 : 0;
    b.flag.g.visible = !!owner; if (owner) { b.flag.cloth.material.color.setHex(base); const P = b.flag.cloth.geometry.attributes.position, B0 = b.flag.base; for (let i = 0; i < P.count; i++) { const u = (B0[i * 3] + .6) / 1.2; P.array[i * 3 + 2] = Math.sin(NOW * 5 + u * 4) * .18 * u; } P.needsUpdate = true; }
    if (b.bulb) { const lit = !!owner; b.bulb.glass.material.emissive.setHex(lit ? (b.tier === 3 ? base : 0xffd21f) : 0); b.bulb.glass.material.emissiveIntensity = lit ? .95 + .1 * Math.sin(NOW * 6) : 0; b.bulb.glow.material.opacity = lit ? .75 : 0; b.bulb.glow.material.color.setHex(b.tier === 3 && lit ? base : 0xffd21f); b.sock.mesh.material.emissive.setHex(lit ? 0xffd21f : 0); b.sock.mesh.material.emissiveIntensity = lit ? .4 : 0; }
  }

  // ---- quest engine (states from the behaviour document: AVAILABLE -> QUEST_ACTIVE -> PENDING -> REWARDED+IMMUNITY, or RESET) ----
  function startQuest(b, a, kind) {
    b.q = { side: a.side, kind: kind || (b.tier === 3 ? 'steal' : b.home === a.side ? 'open' : 'sab'), phase: 'active', parts: new Map([[a, NOW]]), leaveT: 0, pendT: 0, idleT: 0 };
    if (b.track === 'weapon') spawnGuard(b); if (b.track === 'air') spawnItem(b);
    if (a.side === player.side) SFX.play('questStart'); if (b.track === 'weapon') { SFX.play('growl', b.x, b.z); if (a.side === player.side || b.home === player.side) SFX.say('השומר יצא!'); }
    note(a.side, 'התחילה משימה: ' + bName(b)); note(enemyOf(a.side), (b.home === enemyOf(a.side) ? 'מחבלים לכם ב' : 'היריב התחיל ') + bName(b)); return b.q;
  }
  function completeQuest(b) { if (!b.q || b.q.phase !== 'active') return; b.q.phase = 'pending'; b.q.pendT = RULES.pendingMax; if (inRing(b, enemyOf(b.q.side)).length) note(b.q.side, 'המשימה הושלמה — הרחיקו אויבים מהמעגל כדי לקבל את הכוח'); if (b.q.side === player.side) SFX.say('גרשו את האויב מהמעגל'); }
  function reward(b) {
    const q = b.q, side = q.side; let gained = null;
    if (b.tier === 3) { const prev = b.holder; b.holder = side; gained = KEY[b.track] + '3'; if (prev) refreshLoadout(prev); }
    else if (b.home === side) { b.active = true; gained = KEY[b.track] + b.tier; } else { b.active = false; if (b.wire) { scene.remove(b.wire); b.wire = null; } }
    cleanupQuest(b, true); b.q = null; b.immune = NOW + RULES.immunity;
    refreshLoadout('A', side === 'A' ? gained && gained[0] === 'w' ? 'w' : gained : null); refreshLoadout('B', side === 'B' ? gained && gained[0] === 'w' ? 'w' : gained : null);
    feed(gained ? (teamName(side) + ' פתחו ' + bName(b)) : (teamName(side) + ' השביתו ' + bName(b)), side);
    const mine = side === player.side; SFX.play(mine ? 'gain' : 'lost'); SFX.say(mine ? (gained ? 'פתחתם ' : 'השבתתם ') + spoken(b) : (gained ? 'היריב פתח ' : 'היריב השבית לכם ') + spoken(b)); ringFx(b.x, b.z, b.R, TEAM_HEX[teams[side].color], .8);
  }
  function resetQuest(b, why) { const side = b.q.side; cleanupQuest(b, false); b.q = null; note(side, 'המשימה ב' + bName(b) + ' התאפסה' + (why ? ' (' + why + ')' : '')); }
  function cleanupQuest(b, ok) {
    if (b.q && b.q.bar) { scene.remove(b.q.bar); b.q.bar = null; }
    const q = b.q; if (q.guard) removeGuard(q.guard, ok); if (q.item) removeItem(q.item);
    if (q.cable) { const c = q.cable; if (c.by) { detach(c.by.c, 'pole'); c.by.cable = null; hideHands(c.by, false); } if (c.pole.parent) scene.remove(c.pole); cables.splice(cables.indexOf(c), 1); if (ok && c.state === 'plugged') { if (b.wire) scene.remove(b.wire); b.wire = c.mesh; } else if (c.mesh) scene.remove(c.mesh); }
    for (const a of actors) if (a.chan && a.chan.b === b) endChan(a);
  }
  function tickQuests(dt) {
    for (const b of blds) {
      paintBuilding(b); const q = b.q; if (!q) continue;
      const own = inRing(b, q.side), foe = inRing(b, enemyOf(q.side)); for (const a of own) q.parts.set(a, NOW);
      if (q.item && q.item.by) q.parts.set(q.item.by, NOW); if (q.cable && q.cable.by) q.parts.set(q.cable.by, NOW);
      let live = 0, seen = 0; q.parts.forEach((t, a) => { if (NOW - t <= RULES.partWindow) { seen++; if (a.alive) live++; } });
      if (seen && !live) { resetQuest(b, 'כל המשתתפים חוסלו'); continue; }
      // after the task: the building is claimed by standing in its ring with no enemy inside. Contested = the bar stops; empty = it drains.
      if (q.phase === 'pending') {
        if (!q.bar) { q.bar = makeBar(2.2, TEAM_HEX[teams[q.side].color]); q.bar.position.set(b.x, (b.top || 4) + 1.2, b.z); scene.add(q.bar); q.claim = 0; }
        if (own.length && !foe.length) q.claim += dt * (1 + .35 * (own.length - 1)); else if (!own.length && !foe.length) q.claim = Math.max(0, q.claim - dt * .5);
        setBar(q.bar, q.claim / RULES.claim[b.tier]); if (q.claim >= RULES.claim[b.tier]) { scene.remove(q.bar); reward(b); continue; }
        if (foe.length && (q.pendT -= dt) <= 0) { scene.remove(q.bar); resetQuest(b, 'היריב החזיק במעגל'); } continue; }
      if (b.track === 'weapon') { if (!own.length) { q.leaveT += dt; if (q.leaveT > RULES.leaveGrace) resetQuest(b, 'נטישה'); } else q.leaveT = 0; }
      if (b.track === 'air') { if (q.item.by) q.idleT = 0; else if ((q.idleT += dt) > RULES.itemIdle) resetQuest(b, 'החפץ ננטש'); }
    }
  }
  const spoken = b => ({ weapon: 'נשק', air: 'רוח', elec: 'חשמל' })[b.track] + ' ' + ['', 'אחת', 'שתיים', 'שלוש'][b.tier];
  const teamName = side => teams[side].color === 'blue' ? 'הכחולים' : 'האדומים';
  let note = () => { };

  // ---- guards (weapon track): boxer / Tommy / Terminator ----
  const guards = [], bossPool = { 1: [], 2: [], 3: [] };
  BOSS_IDS.forEach((id, i) => { const c = makeChar(A2['boss' + i], id); styleBody(c, 1.12, 1.12); c.holder.visible = false; const bar = makeBar(1.6, 0xff5a4d); bar.position.y = 2.6; bar.visible = false; scene.add(bar); c.bar = bar; scene.add(c.holder); bossPool[id === 'boxer' ? 1 : id === 'tommy' ? 2 : 3].push(c); });
  const teleGeo = new THREE.CircleGeometry(1, 28);
  function spawnGuard(b) {
    for (const old of guards.slice()) if (old.b === b) purgeGuard(old);
    const c = bossPool[b.tier].find(k => !k.busy); if (!c) return; c.busy = true; const R = RULES.guard[b.tier];
    const tele = new THREE.Mesh(teleGeo, new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: .0, depthWrite: false })); tele.rotation.x = -Math.PI / 2; tele.position.y = .04; scene.add(tele);
    // whose guard is it: one that answers a sabotage defends the building's owner, one that answers a steal defends the holder; a fresh unlock is neutral
    const owner = b.q.kind === 'sab' ? b.home : b.q.kind === 'steal' ? b.holder : null;
    const g = { isGuard: true, c, b, tier: b.tier, hp: R.hp, maxHp: R.hp, R, st: 'rest', t: 1.2, dead: false, immune: false, tele, bar: c.bar, name: 'השומר', threat: null, owner };
    if (!c.ownRing) { c.ownRing = new THREE.Mesh(new THREE.RingGeometry(.85, 1.05, 32), new THREE.MeshBasicMaterial({ transparent: true, opacity: .95, depthWrite: false })); c.ownRing.rotation.x = -Math.PI / 2; c.ownRing.position.y = .04; c.holder.add(c.ownRing); }
    const oc = owner ? TEAM_HEX[teams[owner].color] : 0x9aa0a8; c.ownRing.material.color.setHex(oc); g.bar.userData.fg.material.color.setHex(owner ? oc : 0xff5a4d);
    if (owner) { const l = label3(owner === player.side ? 'השומר שלכם' : 'השומר שלהם', TEAM_CSS[teams[owner].color], 2.6); l.position.y = 3.15; c.holder.add(l); g.lab = l; }
    Object.defineProperty(g, 'x', { get: () => c.holder.position.x }); Object.defineProperty(g, 'z', { get: () => c.holder.position.z });
    c.holder.position.set(b.front.x, 0, b.front.z); c.holder.visible = true; c.yaw = yawOf(-b.x, -b.z); c.baseName = ''; c.base = null; c.mixer.stopAllAction(); play(c, 'Idle', { fade: 0 }); setBar(g.bar, 1); g.bar.visible = true;
    puff(b.front.x, 1, b.front.z, 0xffffff, .5, .5, 2); guards.push(g); b.q.guard = g;
  }
  function guardDied(g) { g.dead = true; g.t = 2.2; g.tele.material.opacity = 0; g.bar.visible = false; play(g.c, 'death1', { fade: .08 }); completeQuest(g.b); }
  function purgeGuard(g) { const i = guards.indexOf(g); if (i < 0) return; if (g.lab) { g.c.holder.remove(g.lab); g.lab = null; } const p = g.c.holder.position; puff(p.x, 1, p.z, 0xffffff, .5, .5, 2); g.c.holder.visible = false; g.c.busy = false; g.bar.visible = false; scene.remove(g.tele); guards.splice(i, 1); }
  function removeGuard(g, ok) { if (!g.dead || !ok) purgeGuard(g); else g.gone = true; }
  function updateGuards(dt) {
    for (let i = guards.length - 1; i >= 0; i--) {
      const g = guards[i], c = g.c, p = c.holder.position; g.bar.position.set(p.x, 2.7, p.z);
      if (g.dead) { g.t -= dt; c.mixer.update(dt); if (g.t <= 0 && g.gone) purgeGuard(g); continue; }
      let tgt = g.threat && g.threat.alive && g.threat.side !== g.owner && dist2(g.threat.x, g.threat.z, g.b.x, g.b.z) <= g.b.R + 1 ? g.threat : null, bd = 1e9;
      if (!tgt) for (const a of actors) { if (!a.alive || a.state === 'fly' || a.invisT > 0 || a.side === g.owner) continue; const d = dist2(a.x, a.z, p.x, p.z); if (dist2(a.x, a.z, g.b.x, g.b.z) <= g.b.R + 1 && d < bd) { bd = d; tgt = a; } }
      if (!DBG.bossesAttack) tgt = null;
      const goTo = (x, z, sp) => { const d = dist2(x, z, p.x, p.z); if (d < .15) return false; c.yaw += angDiff(c.yaw, yawOf(x - p.x, z - p.z)) * Math.min(1, dt * 8); p.x += (x - p.x) / d * sp * dt; p.z += (z - p.z) / d * sp * dt; resolve(p, .6); const dd = dist2(p.x, p.z, g.b.x, g.b.z); if (dd > g.b.R - .5) { p.x = g.b.x + (p.x - g.b.x) / dd * (g.b.R - .5); p.z = g.b.z + (p.z - g.b.z) / dd * (g.b.R - .5); } play(c, 'Running', { ts: sp / (c.speed.Running || 5) * 1.1, fade: .2 }); return true; };
      if (g.st === 'wind') {
        g.t -= dt; g.tele.material.opacity = .25 + .35 * (1 - g.t / .75);
        if (g.t <= 0) { g.tele.material.opacity = 0; if (g.ranged) { fireShot(g, null, 'tracer', p.x + Math.sin(c.yaw) * .6, 1.4, p.z + Math.cos(c.yaw) * .6, c.yaw, 9, 30, g.R.dmg, { boss: true }); } else { for (const a of actors) if (a.alive && a.side !== g.owner && dist2(a.x, a.z, g.tele.position.x, g.tele.position.z) <= 1.9 + .4) hurt(a, g.R.dmg, g, null); ringFx(g.tele.position.x, g.tele.position.z, 1.9, 0xff3b30, .3); } g.st = 'rest'; g.t = g.R.every - .75; }
      } else if (!tgt) { if (!goTo(g.b.front.x, g.b.front.z, 2)) play(c, 'Idle', { fade: .25 }); g.t = Math.max(g.t - dt, .4); g.st = 'rest'; }
      else {
        const d = dist2(tgt.x, tgt.z, p.x, p.z); if (g.st === 'rest') { g.t -= dt; }
        const ready = g.t <= 0, far = g.tier === 3 && d > 3.2 && d < 8.5 && lineClear(p.x, p.z, tgt.x, tgt.z);
        if (ready && (d <= 2.1 || far)) {
          g.st = 'wind'; g.t = .75; g.ranged = far && d > 2.1; c.yaw = yawOf(tgt.x - p.x, tgt.z - p.z);
          if (g.ranged) { g.tele.scale.set(.18, 4.5, 1); g.tele.position.set(p.x + Math.sin(c.yaw) * 4.5, .04, p.z + Math.cos(c.yaw) * 4.5); g.tele.rotation.z = c.yaw; } else { g.tele.scale.set(1.9, 1.9, 1); g.tele.rotation.z = 0; g.tele.position.set(p.x + Math.sin(c.yaw) * 1.3, .04, p.z + Math.cos(c.yaw) * 1.3); }
          const clip = Math.random() < .5 ? 'Punching_left' : 'Punching_right'; c.baseName = ''; play(c, clip, { ts: .38 * c.clips[clip].duration / .75, fade: .1 });
        } else if (d > 1.7) goTo(tgt.x, tgt.z, g.R.speed); else { c.yaw += angDiff(c.yaw, yawOf(tgt.x - p.x, tgt.z - p.z)) * Math.min(1, dt * 8); play(c, 'Idle', { fade: .2 }); }
      }
      c.holder.rotation.y = c.yaw; if (c.flashT > 0 && (c.flashT -= dt) <= 0) for (const m of c.mats) m.emissiveIntensity = 0; c.mixer.update(dt);
    }
  }

  // ---- wind parts: heavier with every tier ----
  const items = [];
  function itemMesh(tier) {
    const g = new THREE.Group(), steel = new THREE.MeshStandardMaterial({ color: 0x8f979e, metalness: .45, roughness: .4 }), blue = new THREE.MeshStandardMaterial({ color: 0x56c1ff, roughness: .5 }), dark = new THREE.MeshStandardMaterial({ color: 0x2f3640, roughness: .6 });
    if (tier === 1) { // a light propeller
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, .1, 14), steel); g.add(hub); for (let k = 0; k < 3; k++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(.12, .02, .36), blue); bl.position.set(Math.sin(k * 2.094) * .22, 0, Math.cos(k * 2.094) * .22); bl.rotation.y = k * 2.094; g.add(bl); }
    } else if (tier === 2) { // a caged fan
      const cage = new THREE.Mesh(new THREE.TorusGeometry(.3, .035, 8, 24), steel); cage.rotation.x = Math.PI / 2; g.add(cage); const cage2 = cage.clone(); cage2.position.y = .16; g.add(cage2); const body = new THREE.Mesh(new THREE.CylinderGeometry(.11, .11, .22, 14), dark); body.position.y = .08; g.add(body);
      for (let k = 0; k < 4; k++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(.13, .02, .2), blue); bl.position.set(Math.sin(k * 1.571) * .17, .08, Math.cos(k * 1.571) * .17); bl.rotation.y = k * 1.571; g.add(bl); const bar = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, .16, 6), steel); bar.position.set(Math.sin(k * 1.571 + .78) * .3, .08, Math.cos(k * 1.571 + .78) * .3); g.add(bar); }
    } else { // a turbine engine
      const body = new THREE.Mesh(new THREE.CylinderGeometry(.2, .24, .62, 16), dark); body.rotation.z = Math.PI / 2; body.position.y = .12; g.add(body); const lip = new THREE.Mesh(new THREE.TorusGeometry(.24, .04, 8, 20), steel); lip.rotation.y = Math.PI / 2; lip.position.set(-.31, .12, 0); g.add(lip); const cone = new THREE.Mesh(new THREE.ConeGeometry(.12, .22, 12), blue); cone.rotation.z = Math.PI / 2; cone.position.set(-.34, .12, 0); g.add(cone); const noz = new THREE.Mesh(new THREE.CylinderGeometry(.12, .18, .16, 12), steel); noz.rotation.z = Math.PI / 2; noz.position.set(.38, .12, 0); g.add(noz);
      for (const s of [-1, 1]) { const strap = new THREE.Mesh(new THREE.TorusGeometry(.225, .02, 6, 18), blue); strap.rotation.y = Math.PI / 2; strap.position.set(s * .14, .12, 0); g.add(strap); }
    }
    noCast(g); return g;
  }
  // where each wind part waits (for team A; mirrored for B). T1 may sit behind its building, in an awkward corner;
  // T2 and T3 always lie forward of their building, toward the enemy, on contested ground.
  const ITEM_SPOT = { 1: [24, 47], 2: [-18, 11], 3: [11, -15] }, ITEM_NAME = ['', 'מדחף', 'מאוורר', 'מנוע טורבינה'];
  function spawnItem(b) {
    const s = b.tier === 3 ? (b.q.side === 'A' ? 1 : -1) : Math.sign(b.z), sp = freeNear(ITEM_SPOT[b.tier][0], ITEM_SPOT[b.tier][1] * s), mesh = itemMesh(b.tier);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, 9, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x56c1ff, transparent: true, opacity: .28, depthWrite: false, side: THREE.DoubleSide })); beacon.position.set(sp[0], 4.5, sp[1]); scene.add(beacon);
    const it = { b, tier: b.tier, side: b.q.side, mesh, beacon, home: sp, x: sp[0], z: sp[1], state: 'spot', by: null, dropT: 0, lastBy: null, lastT: 0 }; mesh.position.set(it.x, .25, it.z); scene.add(mesh); items.push(it); b.q.item = it;
  }
  function removeItem(it) { if (it.by) { it.by.carry = null; if (it.by.c.up && it.by.c.up.hold) upperStop(it.by.c, .15); hideHands(it.by, false); } scene.remove(it.mesh); scene.remove(it.beacon); const i = items.indexOf(it); if (i >= 0) items.splice(i, 1); }
  function takeItem(a, it) { SFX.play('pickup', a.x, a.z); it.state = 'carried'; it.by = a; a.carry = it; cancelAim(a); a.shot = null; hideHands(a, true); upperStart(a.c, 'Carry Run', 1, .2, true); it.beacon.visible = false; }
  function dropItem(a) { const it = a.carry; if (!it) return; a.carry = null; it.by = null; it.state = 'dropped'; it.dropT = 8; it.lastBy = a; it.lastT = NOW; const p = freeNear(a.x + Math.sin(a.c.yaw) * .9, a.z + Math.cos(a.c.yaw) * .9); it.x = p[0]; it.z = p[1]; it.mesh.position.set(it.x, .25, it.z); it.mesh.rotation.set(0, 0, 0); it.mesh.visible = true; if (a.c.up && a.c.up.hold) upperStop(a.c, .15); hideHands(a, false); }
  function itemHome(it) { it.state = 'spot'; it.x = it.home[0]; it.z = it.home[1]; it.mesh.position.set(it.x, .25, it.z); it.mesh.visible = true; it.beacon.visible = true; }
  const _hl = new THREE.Vector3(), _hr = new THREE.Vector3();
  function updateItems(dt) {
    for (const it of items.slice()) {
      if (it.by) { // sits exactly on the two hands
        const a = it.by, c = a.c; c.handL.getWorldPosition(_hl); c.handR.getWorldPosition(_hr); it.x = a.x; it.z = a.z; it.mesh.position.set((_hl.x + _hr.x) / 2, (_hl.y + _hr.y) / 2 + (it.tier === 3 ? -.06 : .04), (_hl.z + _hr.z) / 2); it.mesh.rotation.set(0, c.yaw + c.twist + (it.tier === 3 ? Math.PI / 2 : 0), 0);
        if (dist2(a.x, a.z, it.b.x, it.b.z) < 4.6) { const b = it.b; removeItem(it); b.q.item = null; completeQuest(b); puff(b.x, 2, b.z, 0x56c1ff, .6, .6, 2); }
        continue;
      }
      it.mesh.rotation.y += dt * 1.5;
      if (it.state === 'dropped') { it.dropT -= dt; it.mesh.visible = it.dropT > 3 || Math.floor(it.dropT * 4) % 2 === 0; if (it.dropT <= 0) { itemHome(it); continue; } }
      for (const a of actors) {
        if (!a.alive || a.state !== 'free' || a.carry || a.cable || dist2(a.x, a.z, it.x, it.z) > 1.15) continue;
        if (a.side !== it.side) { if (it.state === 'dropped') { itemHome(it); note(it.side, 'היריב נגע בחפץ — הוא חזר למקומו'); } break; }
        if (it.lastBy === a && NOW - it.lastT < 1.2) continue;
        a.state = 'pick'; a.sub = { t: 0, it, done: false }; cancelAim(a); if (a.c.up) upperStop(a.c, .05); a.c.baseName = ''; play(a.c, 'Picking_Up', { ts: 2.4, fade: .1 }); break;
      }
    }
  }

  // ---- electricity: cable reels at both bases, cables chained building to building ----
  const cables = [], cableMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: .45 }), reels = {};
  function buildReel(side) {
    const s = side === 'A' ? 1 : -1, p = freeNear(-30, 51 * s), g = new THREE.Group(); g.position.set(p[0], 0, p[1]);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xe0b33a, roughness: .7 })); box.position.y = .5; g.add(box);
    const plug = tex(128, 128, x => { x.fillStyle = '#1d1f24'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#ffd21f'; x.fillRect(46, 44, 36, 34); x.fillRect(51, 26, 7, 20); x.fillRect(70, 26, 7, 20); x.fillRect(58, 78, 12, 22); });
    for (const k of [0, 1, 2, 3]) { const f = new THREE.Mesh(new THREE.PlaneGeometry(.6, .6), new THREE.MeshStandardMaterial({ map: plug })); f.position.set(Math.sin(k * Math.PI / 2) * .506, .5, Math.cos(k * Math.PI / 2) * .506); f.rotation.y = k * Math.PI / 2; g.add(f); }
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(.36, .36, .76, 20), new THREE.MeshStandardMaterial({ color: 0x2a2b30, roughness: .6 })); drum.rotation.z = Math.PI / 2; drum.position.y = 1.4; g.add(drum);
    for (let i = 0; i < 8; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(.38, .05, 6, 20), cableMat); r.rotation.y = Math.PI / 2; r.position.set(-.3 + i * .086, 1.4, 0); g.add(r); }
    for (const k of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(.07, .55, .55), new THREE.MeshStandardMaterial({ color: 0x8f979e, metalness: .3, roughness: .5 })); leg.position.set(k * .44, 1.22, 0); g.add(leg); }
    shadowAll(g); scene.add(g); const col = { t: 'c', kind: 'ob', x: p[0], z: p[1], r: .75, h: 1.8 }; solids.push(col); reels[side] = { x: p[0], z: p[1], y: 1.4 };
  }
  buildReel('A'); buildReel('B');
  // what this actor could do with the electricity track right here
  function elecOption(a) {
    const side = a.side, near = (x, z, r) => dist2(a.x, a.z, x, z) < (r || 2.3), t1 = bldOf(side, 'elec', 1), t2 = bldOf(side, 'elec', 2), t3 = bldOf(side, 'elec', 3), en = enemyOf(side);
    for (const c of cables) if (c.state === 'dropped' && c.side === side && near(c.end.x, c.end.z, 1.7)) return { type: 'grab', c, text: 'לתפוס את הכבל' };
    if (canStart(side, t1) && near(reels[side].x, reels[side].z, 2.4)) return { type: 'cable', b: t1, src: reels[side], text: 'לקחת כבל מהסליל' };
    if (canStart(side, t2) && near(t1.sock.fx, t1.sock.fz)) return { type: 'cable', b: t2, src: t1.sock, text: 'למשוך כבל למבנה הבא' };
    if (canStart(side, t3) && t3.holder === null && near(t2.sock.fx, t2.sock.fz)) return { type: 'cable', b: t3, src: t2.sock, text: 'למשוך כבל ל-T3' };
    if (t3.holder === en && NOW >= t3.immune && !t3.q && near(t3.sock.fx, t3.sock.fz)) return { type: 'chan', b: t3, kind: 'unplug', text: 'לנתק את הכבל של היריב' };
    for (const tier of [1, 2]) { const b = bldOf(en, 'elec', tier); if (canStart(side, b) && near(b.sock.fx, b.sock.fz)) return { type: 'chan', b, kind: 'sab', text: 'לנתק את החשמל ליריב' }; }
    return null;
  }
  function startCable(a, b, src) {
    const q = startQuest(b, a), pole = poleSrc.clone(); const c = { b, side: a.side, src: { x: src.x, y: src.y, z: src.z }, trail: [], state: 'held', by: null, end: null, idleT: 0, mesh: null, pole, frame: 0 }; q.cable = c; cables.push(c); grabCable(a, c);
  }
  function grabCable(a, c) { c.state = 'held'; c.by = a; a.cable = c; c.idleT = 0; if (c.pole.parent) scene.remove(c.pole); cancelAim(a); a.shot = null; if (a.c.up) upperStop(a.c, .05); hideHands(a, true); attach(a.c, 'pole'); if (c.mesh) c.mesh.visible = true; }
  function dropCable(a) { const c = a.cable; if (!c) return; const tip = a.c.held.pole.localToWorld(V3(0, .4, 0)); detach(a.c, 'pole'); hideHands(a, false); a.cable = null; c.by = null; c.state = 'dropped'; c.idleT = 0; c.end = V3(tip.x, .06, tip.z); c.pole.position.set(tip.x, .06, tip.z); c.pole.rotation.set(Math.PI / 2, 0, .5); scene.add(c.pole); drawCable(c); }
  function drawCable(c) {
    if (c.mesh) { scene.remove(c.mesh); c.mesh.geometry.dispose(); }
    const pts = [V3(c.src.x, c.src.y, c.src.z), V3(c.src.x + (c.src.nx || .5) * .5, .06, c.src.z + (c.src.nz || 0) * .5)].concat(c.trail.map(p => V3(p.x, .06, p.z)));
    const end = c.state === 'held' ? c.by.c.held.pole.localToWorld(V3(0, .4, 0)) : c.end;
    if (end) { const l = pts[pts.length - 1]; if (c.state !== 'dropped') pts.push(V3((l.x + end.x) / 2, .12, (l.z + end.z) / 2)); pts.push(end.clone ? end.clone() : V3(end.x, end.y, end.z)); }
    c.mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), Math.min(160, Math.max(16, pts.length * 3)), .035, 5, false), cableMat); scene.add(c.mesh);
  }
  function updateCables(dt) {
    for (const c of cables.slice()) {
      const b = c.b;
      if (c.state === 'held') {
        const a = c.by, last = c.trail[c.trail.length - 1]; if (!last || dist2(last.x, last.z, a.x, a.z) > .8) c.trail.push({ x: a.x, z: a.z });
        if ((c.frame++ & 1) === 0) drawCable(c);
        if (dist2(a.x, a.z, b.sock.fx, b.sock.fz) < 1.35) { detach(a.c, 'pole'); hideHands(a, false); a.cable = null; c.by = null; c.state = 'plugged'; c.end = V3(b.sock.x, b.sock.y, b.sock.z); drawCable(c); SFX.play('plug', b.sock.x, b.sock.z); for (let k = 0; k < 8; k++) puff(b.sock.x + rnd(-.2, .2), b.sock.y + rnd(-.2, .2), b.sock.z + rnd(-.2, .2), 0xffe14a, .05, .35, 2); completeQuest(b); }
      } else if (c.state === 'dropped') {
        c.idleT += dt; const on = c.idleT < 5 || Math.floor((c.idleT - 5) * 4) % 2 === 0; c.mesh.visible = on; c.pole.visible = on;
        let gone = c.idleT >= 8; for (const a of actors) if (a.alive && a.side !== c.side && dist2(a.x, a.z, c.end.x, c.end.z) < 1.1) gone = true;
        for (const a of actors) if (!gone && a.alive && a.side === c.side && !a.isPlayer && a.state === 'free' && !a.carry && !a.cable && dist2(a.x, a.z, c.end.x, c.end.z) < 1.2) grabCable(a, c);
        if (gone && c.state === 'dropped') resetQuest(b, 'הכבל נגלל חזרה');
      }
    }
  }
  // channel = stand still at a socket to unplug the enemy
  function startChan(a, b, kind) { if (kind === 'sab') startQuest(b, a, 'sab'); const bar = makeBar(1.3, 0xffd21f); bar.position.set(b.sock.x, 2.2, b.sock.z); scene.add(bar); a.chan = { b, kind, t: 0, need: RULES.unplug[b.tier] / (efficient(a.side) ? 1.2 : 1), bar }; cancelAim(a); a.c.yaw = yawOf(b.sock.x - a.x, b.sock.z - a.z); }
  function endChan(a, done) { const ch = a.chan; if (!ch) return; scene.remove(ch.bar); a.chan = null; if (!done && ch.kind === 'sab' && ch.b.q && ch.b.q.kind === 'sab' && ch.b.q.phase === 'active') { const b = ch.b; cleanupQuest(b, false); b.q = null; } }
  function tickChan(a, dt) {
    const ch = a.chan; ch.t += dt; setBar(ch.bar, ch.t / ch.need); if (Math.random() < .2) puff(ch.b.sock.x, ch.b.sock.y, ch.b.sock.z, 0xffe14a, .04, .3, 2);
    if (ch.t < ch.need) return; const b = ch.b; endChan(a, true);
    if (ch.kind === 'unplug') { const prev = b.holder; b.holder = null; if (b.wire) { scene.remove(b.wire); b.wire = null; } refreshLoadout(prev); feed(teamName(a.side) + ' ניתקו את ' + bName(b), a.side); } else completeQuest(b);
  }

  // ---- city hall (the core), its roof gun, the ruin and the hot zone ----
  const hall = lib.city_hall; shadowAll(hall); scene.add(hall);
  const core = { hp: RULES.coreHp, dead: false, cols: solids.filter(c => c.kind === 'bld' && Math.abs(c.x) < 1 && Math.abs(c.z) < 6), fireT: 2, aoeT: 4, burst: 0, burstT: 0, aim: null, aoe: null, shake: 0 };
  const coreRing = new THREE.Mesh(new THREE.RingGeometry(RULES.coreR - .2, RULES.coreR, 96), new THREE.MeshBasicMaterial({ color: 0xd9534a, transparent: true, opacity: .5, depthWrite: false })); coreRing.rotation.x = -Math.PI / 2; coreRing.position.y = .03; scene.add(coreRing);
  // hot zone floor: a swirling storm. Empty = grey, one team inside = its colour, both = yin-yang of the two
  const stormCv = document.createElement('canvas'); stormCv.width = stormCv.height = 256; const stormTex = new THREE.CanvasTexture(stormCv); stormTex.encoding = THREE.sRGBEncoding; let stormKey = '';
  function drawStorm(ca, cb) {
    const x = stormCv.getContext('2d'), R = 126; x.clearRect(0, 0, 256, 256); x.save(); x.translate(128, 128);
    const half = (col, flip) => { x.save(); x.rotate(flip ? Math.PI : 0); x.beginPath(); x.arc(0, 0, R, -Math.PI / 2, Math.PI / 2); x.arc(0, R / 2, R / 2, Math.PI / 2, -Math.PI / 2, true); x.arc(0, -R / 2, R / 2, Math.PI / 2, -Math.PI / 2, false); x.closePath(); x.fillStyle = col; x.fill(); x.restore(); };
    if (cb) { half(ca, false); half(cb, true); } else { x.beginPath(); x.arc(0, 0, R, 0, 7); x.fillStyle = ca; x.fill(); }
    // spiral arms of lighter air on top
    x.globalCompositeOperation = 'source-atop'; x.strokeStyle = 'rgba(255,255,255,.28)'; x.lineCap = 'round';
    for (let arm = 0; arm < 5; arm++) { x.lineWidth = 9 - arm; x.beginPath(); for (let t = 0; t <= 1; t += .02) { const r = 12 + t * (R - 14), ang = arm * 1.2566 + t * 4.2; const px = Math.cos(ang) * r, py = Math.sin(ang) * r; if (t === 0) x.moveTo(px, py); else x.lineTo(px, py); } x.stroke(); }
    x.globalCompositeOperation = 'source-over'; x.lineWidth = 6; x.strokeStyle = 'rgba(255,255,255,.75)'; x.beginPath(); x.arc(0, 0, R - 3, 0, 7); x.stroke(); x.restore(); stormTex.needsUpdate = true;
  }
  const hzDisc = new THREE.Mesh(new THREE.CircleGeometry(RULES.hzR, 64), new THREE.MeshBasicMaterial({ map: stormTex, transparent: true, opacity: .62, depthWrite: false })); hzDisc.rotation.x = -Math.PI / 2; hzDisc.position.y = .04; hzDisc.visible = false; hzDisc.renderOrder = 2; scene.add(hzDisc);
  const muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffc23a, transparent: true, depthWrite: false, opacity: 0 })); muzzle.scale.set(2.2, 2.2, 1); scene.add(muzzle);
  const aoeMesh = new THREE.Mesh(teleGeo, new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0, depthWrite: false })); aoeMesh.rotation.x = -Math.PI / 2; aoeMesh.position.y = .05; aoeMesh.scale.setScalar(RULES.coreAoeR); scene.add(aoeMesh);
  const hallShield = new THREE.Mesh(new THREE.SphereGeometry(9.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: .1, depthWrite: false, side: THREE.DoubleSide })); hallShield.scale.set(1, .75, .85); scene.add(hallShield);
  const rubble = new THREE.Group(); rubble.visible = false; scene.add(rubble);
  { const cs = [0x8d8a84, 0x6f6c68, 0xa39f97, 0x5b4a3e, 0x7a6a5c]; let sd = 7; const R = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 46; i++) { const w = .5 + R() * 1.8, h = .25 + R() * 1.1, d = .5 + R() * 1.6, m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: cs[i % 5], roughness: .95 })); const a = R() * 6.28, r = Math.sqrt(R()) * 6.2; m.position.set(Math.cos(a) * r * 1.15, h / 2 - .05 + (r < 2.5 ? R() * .8 : 0), Math.sin(a) * r * .8); m.rotation.set(R() * .5 - .25, R() * 6.28, R() * .5 - .25); m.castShadow = true; m.receiveShadow = true; rubble.add(m); }
    for (let i = 0; i < 5; i++) { const beam = new THREE.Mesh(new THREE.BoxGeometry(.18, .18, 3 + R() * 2), new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: .4, roughness: .6 })); beam.position.set(R() * 8 - 4, .5 + R() * .8, R() * 6 - 3); beam.rotation.set(R() * .9 - .45, R() * 6.28, 0); beam.castShadow = true; rubble.add(beam); } }
  function destroyCore(side) {
    core.dead = true; core.hp = 0; for (const c of core.cols) { const i = solids.indexOf(c); if (i >= 0) solids.splice(i, 1); }
    hall.visible = false; turret.visible = false; hallShield.visible = false; for (const s of signMeshes) s.visible = false; rubble.visible = true; coreRing.material.color.setHex(0xffffff); coreRing.scale.setScalar(RULES.hzR / RULES.coreR); hzDisc.visible = true; stormKey = '-'; aoeMesh.material.opacity = 0; muzzle.material.opacity = 0;
    for (let i = 0; i < 26; i++) puff(rnd(-6, 6), rnd(.5, 6), rnd(-4, 4), i % 2 ? 0x8d8a84 : 0x55524e, rnd(.8, 1.8), rnd(.8, 1.8), 2.5);
    renderer.shadowMap.needsUpdate = true; buildNav(); feed('העירייה נהרסה! השטח הפך ל-Hot Zone', side); SFX.play('coreDown'); SFX.say('העירייה נהרסה! כבשו את ההוט זון', true); note('A', 'העירייה נהרסה — כבשו את ה-Hot Zone'); note('B', '');
  }
  function updateCore(dt) {
    if (core.dead) { // hot zone: only one team inside -> its meter climbs
      const n = { A: 0, B: 0 }; for (const a of actors) if (a.alive && a.state !== 'fly' && Math.hypot(a.x, a.z) <= RULES.hzR) n[a.side]++;
      core.holder = n.A && !n.B ? 'A' : n.B && !n.A ? 'B' : null; const key = (n.A ? 'A' : '') + (n.B ? 'B' : '');
      if (key !== stormKey) { stormKey = key; const col = s => TEAM_CSS[teams[s].color]; if (key === 'AB') drawStorm(col('A'), col('B')); else if (key) drawStorm(col(key)); else drawStorm('#8a8f98'); }
      hzDisc.rotation.z -= dt * .9;
      for (const s of ['A', 'B']) if (n[s] && !n[enemyOf(s)]) { teams[s].hz = Math.min(100, teams[s].hz + RULES.hz[Math.min(3, n[s])] * dt); /* about a minute with three, nearly two alone */ if (teams[s].hz >= 100) endMatch(s, 'כבשו את ה-Hot Zone'); }
      core.contested = n.A > 0 && n.B > 0; return;
    }
    hallShield.visible = !coreOpenFor('A') && !coreOpenFor('B'); hallShield.material.opacity = .08 + .04 * Math.sin(NOW * 2);
    if (core.shake > 0) { core.shake -= dt; hall.position.x = core.shake > 0 ? rnd(-.04, .04) : 0; }
    muzzle.material.opacity = Math.max(0, muzzle.material.opacity - dt * 9);
    const inRange = DBG.coreFires ? actors.filter(a => a.alive && a.prot <= 0 && a.invisT <= 0 && Math.hypot(a.x, a.z) <= RULES.coreR) : [];
    // focused fire: a burst of tracers from the roof gun, led onto where the target is running
    if (core.burst > 0) { if ((core.burstT -= dt) <= 0) { core.burstT = .075; core.burst--; const t = core.aim; if (t && t.alive) { const d = Math.hypot(t.x, t.z), tt = d / 44, px = t.x + (t.vx || 0) * tt + rnd(-.25, .25), pz = t.z + (t.vz || 0) * tt + rnd(-.25, .25), yaw = yawOf(px, pz), mx = Math.sin(yaw) * 1.6, mz = Math.cos(yaw) * 1.6; turret.rotation.y = yaw; SFX.play('tracer', mx, mz); fireShot('core', null, 'tracer', mx, layout.turret.y + .5, mz, yaw, Math.hypot(px - mx, pz - mz) + 1.2, 44, RULES.coreDmg / 4, { overWalls: true, y0: layout.turret.y + .5, only: t }); const s = shots[shots.length - 1]; s.y1 = 1.0; s.m.rotation.order = 'YXZ'; s.m.rotation.x = Math.atan2(layout.turret.y - .5, Math.hypot(px, pz)); muzzle.position.set(mx, layout.turret.y + .5, mz); muzzle.material.opacity = 1; } } }
    else if ((core.fireT -= dt) <= 0) { core.fireT = RULES.coreEvery; if (inRange.length) { let best = inRange[0]; for (const a of inRange) if (Math.hypot(a.x, a.z) < Math.hypot(best.x, best.z)) best = a; core.aim = best; core.burst = 4; core.burstT = 0; } }
    // area strike: a warning circle, then the blast
    if (core.aoe) { core.aoe.t -= dt; aoeMesh.material.opacity = .2 + .4 * (1 - core.aoe.t / RULES.coreAoeWarn); if (core.aoe.t <= 0) { const o = core.aoe; core.aoe = null; aoeMesh.material.opacity = 0; SFX.play('blast', o.x, o.z); for (const a of actors) if (a.alive && a.state !== 'fly' && dist2(a.x, a.z, o.x, o.z) <= RULES.coreAoeR) hurt(a, RULES.coreAoe, 'core', null); for (let i = 0; i < 7; i++) puff(o.x + rnd(-1.5, 1.5), rnd(.3, 1.6), o.z + rnd(-1.5, 1.5), i % 2 ? 0xff9a2a : 0x55524e, rnd(.4, .9), .45, 2); ringFx(o.x, o.z, RULES.coreAoeR, 0xff7a1c, .4); } }
    else if ((core.aoeT -= dt) <= 0) { core.aoeT = RULES.coreAoeEvery; if (inRange.length) { const t = inRange[Math.random() * inRange.length | 0]; core.aoe = { x: t.x, z: t.z, t: RULES.coreAoeWarn }; aoeMesh.position.set(t.x, .05, t.z); SFX.play('warn', t.x, t.z); } }
  }

  // ---- fences (blue, electricity T2): a barrier anyone can break ----
  const fences = [], fenceGeo = new THREE.PlaneGeometry(3, 1.15), fenceMat = {};
  function fenceMaterial(color) { return new THREE.MeshBasicMaterial({ map: fenceMaterial.t || (fenceMaterial.t = tex(256, 96, x => { x.clearRect(0, 0, 256, 96); x.fillStyle = '#e8edf2'; for (const px of [6, 122, 238]) x.fillRect(px, 4, 12, 92); x.strokeStyle = '#ffffff'; x.lineWidth = 5; for (const y of [18, 46, 74]) { x.beginPath(); x.moveTo(0, y); x.lineTo(256, y); x.stroke(); } x.strokeStyle = '#ffd21f'; x.lineWidth = 4; for (const cx of [64, 180]) { x.beginPath(); x.moveTo(cx + 8, 26); x.lineTo(cx - 6, 50); x.lineTo(cx + 6, 50); x.lineTo(cx - 8, 72); x.stroke(); } })), color, transparent: true, alphaTest: .25, side: THREE.DoubleSide, depthWrite: true }); }
  function buildFence(b, side) {
    b.fenceSide = side; const F = RULES.fence, hex = TEAM_HEX[teams[side].color];
    for (let i = 0; i < F.n; i++) {
      const th = i / F.n * Math.PI * 2 + .2, x = b.x + Math.cos(th) * F.r, z = b.z + Math.sin(th) * F.r, ry = Math.atan2(-Math.sin(th), Math.cos(th));
      if (solids.some(c => (c.kind === 'bld' || c.kind === 'wall') && !c.fside && rayHitOne(c, x, z, 1, 0) === 0)) continue;
      const mesh = new THREE.Mesh(fenceGeo, fenceMaterial(hex)); mesh.position.set(x, .6, z); mesh.rotation.y = ry + Math.PI / 2; scene.add(mesh);
      const col = { t: 'b', kind: 'ob', x, z, hx: .18, hz: 1.5, ry, co: Math.cos(ry), si: Math.sin(ry), h: .95, fside: side }; solids.push(col);
      fences.push({ isFence: true, side, b, x, z, hp: F.hp, mesh, col, bar: null, broken: false, t: 0 });
    }
  }
  function breakFence(f) { f.broken = true; f.t = RULES.fence.regen; f.mesh.visible = false; if (f.bar) f.bar.visible = false; const i = solids.indexOf(f.col); if (i >= 0) solids.splice(i, 1); for (let k = 0; k < 5; k++) puff(f.x + rnd(-1, 1), rnd(.2, 1), f.z + rnd(-1, 1), 0xd8d4ca, .25, .4, 2); }
  function clearFence(b) { for (let i = fences.length - 1; i >= 0; i--) { const f = fences[i]; if (f.b !== b) continue; scene.remove(f.mesh); f.mesh.material.dispose(); if (f.bar) scene.remove(f.bar); const k = solids.indexOf(f.col); if (k >= 0) solids.splice(k, 1); fences.splice(i, 1); } b.fenceSide = null; }
  // called twice a second: every active building of a team that owns the fence power gets its ring, broken panels grow back
  function syncFences(dt) { return; /* version 3: no fences */
    for (const b of blds) { const owner = b.tier === 3 ? b.holder : (b.active ? b.home : null), want = owner && has(owner, 'e2') && teams[owner].color === 'blue' ? owner : null; if (b.fenceSide && b.fenceSide !== want) clearFence(b); if (want && !b.fenceSide) buildFence(b, want); }
    for (const f of fences) if (f.broken && (f.t -= dt) <= 0) { f.broken = false; f.hp = RULES.fence.hp; f.mesh.visible = true; f.mesh.material.opacity = 1; solids.push(f.col); }
  }

  // ---- medkits ----
  const medkits = [[18, 42], [18, -42], [-23, 13], [23, -13]].map(p => { const q = freeNear(p[0], p[1]), mesh = lib.medkit_2.clone(); mesh.position.set(q[0], 0, q[1]); mesh.scale.setScalar(1.5); noCast(mesh); scene.add(mesh); const halo = new THREE.Mesh(new THREE.RingGeometry(.5, .64, 24), new THREE.MeshBasicMaterial({ color: 0x3fdc5d, transparent: true, opacity: .8, depthWrite: false })); halo.rotation.x = -Math.PI / 2; halo.position.set(q[0], .03, q[1]); scene.add(halo); return { x: q[0], z: q[1], mesh, halo, t: 0 }; });
  function updateMedkits(dt) { for (const m of medkits) { if (m.t > 0) { if ((m.t -= dt) <= 0) { m.mesh.visible = m.halo.visible = true; } continue; } m.mesh.rotation.y += dt; for (const a of actors) if (a.alive && a.hp < maxHp(a) && dist2(a.x, a.z, m.x, m.z) < 1.1) { a.hp = Math.min(maxHp(a), a.hp + RULES.medkit); SFX.play('heal', a.x, a.z); m.t = RULES.medkitRespawn; m.mesh.visible = m.halo.visible = false; ringFx(m.x, m.z, 1, 0x3fdc5d, .4); break; } } }

  // ---- abilities ----
  const ABIL = {
    dash: { name: 'דאש', ok: a => has(a.side, 'a2'), cd: RULES.dash.cd },
    jump: { name: 'קפיצה', ok: a => false, cd: RULES.jump.cd },
    jet: { name: "ג'טפק", ok: a => has(a.side, 'a3'), cd: RULES.jet.cd },
    invis: { name: 'היעלמות', ok: a => false, cd: RULES.invis.cd },
    reflect: { name: 'החזרה', ok: a => has(a.side, 'e3'), cd: RULES.reflect.cd },
  };
  const abilitiesOf = a => Object.keys(ABIL).filter(k => ABIL[k].ok(a));
  function useAbility(a, k) {
    if (!a.alive || matchOver || !ABIL[k].ok(a)) return false;
    if (k === 'jet' && a.state === 'fly') { a.sub.fuel = 0; return true; }
    if ((a.cd[k] || 0) > NOW || a.state !== 'free' || a.chan) return false;
    if ((a.carry || a.cable) && k !== 'reflect') { if (a.isPlayer) toast('אי אפשר בזמן נשיאה'); return false; }
    const m = Math.hypot(a.inp.mx, a.inp.mz), dir = m > .15 ? yawOf(a.inp.mx, a.inp.mz) : a.c.yaw; cancelAim(a);
    SFX.play(k === 'dash' ? 'dash' : k === 'jump' ? 'jump' : k === 'jet' ? 'jet' : 'shieldPop', a.x, a.z);
    if (k === 'dash') { a.c.yaw = dir; a.state = 'dash'; a.sub = { left: RULES.dash.dist }; }
    if (k === 'jump') { a.c.yaw = dir; a.state = 'jump'; a.sub = { t: 0, prev: 0 }; if (a.c.up) upperStop(a.c, .05); a.c.baseName = ''; play(a.c, 'Jump', { fade: .08 }); }
    if (k === 'jet') { a.state = 'fly'; a.sub = { fuel: RULES.jet.fuel, dx: Math.sin(dir), dz: Math.cos(dir) }; if (a.c.up) upperStop(a.c, .05); play(a.c, 'Flying', { fade: .2 }); }
    if (k === 'invis') { a.invisT = RULES.invis.dur; setGhost(a.c, true); }
    if (k === 'reflect') { a.reflectT = RULES.reflect.dur; }
    const free = DBG.noCd && a.isPlayer;
    if (k === 'dash') { a.dashN--; a.dashT = NOW; a.cd.dash = NOW + (a.dashN <= 0 && !free ? RULES.dash.cd : .25); if (a.dashN <= 0) a.dashN = RULES.dash.charges; } // a few in a row, then the wait
    else a.cd[k] = NOW + (free ? .3 : ABIL[k].cd);
    return true;
  }

  // ---- interaction (the Action button) ----
  function actionOption(a) {
    if (!a.alive || a.state !== 'free') return null;
    if (a.cable) return { type: 'dropCable', text: 'להניח את הכבל' }; if (a.carry) return { type: 'dropItem', text: 'להניח את ה' + ITEM_NAME[a.carry.tier] }; if (a.chan) return { type: 'stopChan', text: 'להפסיק' };
    const e = elecOption(a); if (e) return e;
    for (const b of blds) if (b.track !== 'elec' && dist2(a.x, a.z, b.x, b.z) <= b.R && canStart(a.side, b)) return { type: 'quest', b, text: (b.tier < 3 && b.home !== a.side ? 'לחבל ב' : 'להתחיל ') + bName(b) };
    return null;
  }
  function doAction(a) {
    const o = actionOption(a); if (!o) return false;
    if (o.type === 'dropCable') { dropCable(a); a.noAct = 2.5; } else if (o.type === 'dropItem') { dropItem(a); a.noAct = 1; } else if (o.type === 'stopChan') { endChan(a); a.noAct = 2; }
    else if (o.type === 'grab') grabCable(a, o.c); else if (o.type === 'cable') startCable(a, o.b, o.src); else if (o.type === 'chan') startChan(a, o.b, o.kind); else if (o.type === 'quest') startQuest(o.b, a);
    return true;
  }

  // ---- one actor, one frame: input -> movement, facing, animation layers, timers ----
  function updateActor(a, dt) {
    const c = a.c, p = c.holder.position;
    if (c.flashT > 0 && (c.flashT -= dt) <= 0) for (const m of c.mats) m.emissiveIntensity = 0;
    if (!a.alive) { if (!matchOver && (a.respawnT -= dt) <= 0) respawn(a); return; }
    a.atkCd -= dt; a.prot -= dt; a.slowT -= dt;
    if (a.invisT > 0 && (a.invisT -= dt) <= 0) setGhost(c, false); if (a.reflectT > 0) a.reflectT -= dt;
    if (a.shieldAt && NOW >= a.shieldAt) { a.shieldAt = 0; if (has(a.side, 'e2')) a.shieldUp = true; }
    a.bubble.visible = a.shieldUp || a.reflectT > 0 || a.prot > 0; if (a.bubble.visible) { tintShield(a.bubble, a.reflectT > 0 ? 0xc58cff : a.prot > 0 ? 0xf2f2f2 : 0x7fd4ff); a.bubble.rotation.y += dt * 1.6; a.bubble.rotation.x = Math.sin(NOW * 1.3) * .25; }
    if (a.dashN < RULES.dash.charges && NOW - a.dashT >= RULES.dash.cd) a.dashN = RULES.dash.charges;
    passSide = a.side;
    const sp0 = layout.spawns[a.side][1], atBase = dist2(a.x, a.z, sp0[0], sp0[1]) < RULES.baseR;
    const h0 = a.hp; if (a.hp < maxHp(a) && (atBase || NOW - a.lastHit >= RULES.regenDelay)) a.hp = Math.min(maxHp(a), a.hp + (atBase ? RULES.baseHeal : RULES.regen) * dt); if (a.hp > h0) a.healT = NOW + .3; a.healing = (a.healT || 0) > NOW; a.healGain = (a.healGain || 0) + (a.hp - h0); if (a.healGain >= 12 && a.side === player.side) { a.healGain = 0; } if (a.hp >= maxHp(a)) a.healGain = 0;
    drawHpBar(a.bar, a.hp, maxHp(a), a.isPlayer ? 'me' : (a.side === player.side ? 'A' : 'B'), a.healing, a.isPlayer); a.bar.visible = a.side === player.side || a.invisT <= 0; // bars over everyone (team-mates' health lives here, not in the HUD)
    const ox = p.x, oz = p.z, inp = a.inp, mag = Math.min(1, Math.hypot(inp.mx, inp.mz)), mdx = mag > .12 ? inp.mx / Math.hypot(inp.mx, inp.mz) : 0, mdz = mag > .12 ? inp.mz / Math.hypot(inp.mx, inp.mz) : 0, moving = mag > .12;
    c.twist = 0;
    if (a.state === 'free') {
      if (a.chan) { if (moving) { endChan(a); a.noAct = 1; } else tickChan(a, dt); }
      // missions start by walking in: no button. (Dropping something pauses this for a moment.)
      else if (!a.carry && !a.cable && (a.noAct -= dt) <= 0 && !matchOver) { const o = actionOption(a); if (o && o.type === 'quest' && o.b.track === 'weapon') doAction(a); } // only the guards come out by themselves; wind and cables are started by pressing on them
      let sp = moveSpeed(a) * Math.min(1, mag * 1.2); const eff = efficient(a.side) ? 1.2 : 1;
      if (a.carry) sp *= Math.min(1, RULES.carry[a.carry.tier] * eff); if (a.cable) sp *= Math.min(1, RULES.dragSpeed * eff);
      const k = Math.min(1, dt * RULES.accel), wx = moving ? mdx * sp : 0, wz = moving ? mdz * sp : 0; a.mvx = (a.mvx || 0) + (wx - (a.mvx || 0)) * k; a.mvz = (a.mvz || 0) + (wz - (a.mvz || 0)) * k; p.x += a.mvx * dt; p.z += a.mvz * dt;
      resolve(p, RULES.radius); for (const g of guards) if (!g.dead) { const d = dist2(p.x, p.z, g.x, g.z); if (d < 1.05 && d > 1e-3) { p.x = g.x + (p.x - g.x) / d * 1.05; p.z = g.z + (p.z - g.z) / d * 1.05; } }
      const my = yawOf(mdx, mdz), W = WEAPONS[a.weapon];
      // a whole-body attack that starts moving hands over to the upper-body layer at the same frame, so nothing pops
      if (a.full && moving) { const b = c.base, t = b ? b.time : 0, hold = a.full.hold, ts0 = b && b.timeScale ? b.timeScale : 1; a.full = null; c.baseName = ''; upperStart(c, a.atkClip || W.clips[0], hold ? 1 : ts0, t, hold); }
      if (a.full && !a.full.hold && a.upT <= 0 && !a.shot) { a.full = null; c.baseName = ''; }
      const aimed = (c.up || a.full) && !a.carry && (a.aiming || a.shot || a.upT > 0 && a.hitT <= 0);
      let ts = 1, anim = 'Idle';
      if (a.cable) { if (moving) { c.yaw += angDiff(c.yaw, my + Math.PI) * Math.min(1, dt * 10); anim = 'Pull Heavy Object'; ts = 1.9; } }
      else if (aimed) { // the chest always faces the aim. The hips lean toward the run direction but never more than 60 degrees away from the chest,
        // so nothing ever has to spin around; running away from the aim plays the run backwards. Hysteresis stops flip-flopping at the side.
        // the aim itself is smoothed first (a mouse / stick jitters), then legs and chest follow it at their own pace
        // One rule, nothing to fight over: while aiming or attacking the whole body faces the aim. The legs just run under it -
        // forwards when moving roughly toward the aim, backwards when moving away. No spine twist, no leg/torso split, so no spinning.
        const want = a.aimYaw - aimOffset(a, W); c.yaw += angDiff(c.yaw, want) * Math.min(1, dt * 18);
        if (moving) { anim = c.run; ts = clamp(sp / (c.speed[c.run] || 5), .6, 1.6); if (Math.cos(angDiff(c.yaw, my)) < -.2) ts = -ts; }
        c.twist = 0;
      } else if (moving) { c.yaw += angDiff(c.yaw, my) * Math.min(1, dt * RULES.turn); anim = c.run; ts = clamp(sp / (c.speed[c.run] || 5), .6, 1.6); }
      if (!a.full) play(c, anim, { ts, fade: .16 }); else c.twist = 0; // a whole-body attack owns the legs
    } else if (a.state === 'dash') {
      const s = Math.min(a.sub.left, 17 * dt), bx = p.x, bz = p.z; a.sub.left -= s; p.x += Math.sin(c.yaw) * s; p.z += Math.cos(c.yaw) * s; resolve(p, RULES.radius);
      c.root.position.y = Math.sin(Math.PI * (1 - a.sub.left / RULES.dash.dist)) * .2; play(c, c.run, { ts: 1.7, fade: .05 }); if (Math.random() < .8) puff(p.x - Math.sin(c.yaw) * .4, .3, p.z - Math.cos(c.yaw) * .4, 0xd8d4ca, .17, .4, 2);
      if (a.sub.left <= 1e-3 || dist2(bx, bz, p.x, p.z) < s * .3) { a.state = 'free'; c.root.position.y = 0; }
    } else if (a.state === 'jump') { // travels exactly as the clip does, scaled to the ability's distance; low things are cleared while in the air
      const J = c.jumpRM || [0, 1], dur = c.clips.Jump.duration, sub = a.sub; sub.t = Math.min(dur, sub.t + dt); const f = sub.t / dur * (J.length - 1), i = Math.min(J.length - 2, Math.floor(f)), cur = (J[i] + (J[i + 1] - J[i]) * (f - i)) / J[J.length - 1] * RULES.jump.dist, d = cur - sub.prev; sub.prev = cur;
      const k = sub.t / dur, air = k > .12 && k < .85; p.x += Math.sin(c.yaw) * d; p.z += Math.cos(c.yaw) * d; resolve(p, RULES.radius, air ? 1.05 : undefined);
      if (k >= .97) { a.state = 'free'; resolve(p, RULES.radius); c.baseName = ''; }
    } else if (a.state === 'fly') {
      const F = a.sub; F.fuel -= dt; if (moving) { F.dx = mdx; F.dz = mdz; } c.yaw += angDiff(c.yaw, yawOf(F.dx, F.dz)) * Math.min(1, dt * 6);
      const over = blocked(p.x, p.z, RULES.radius), sp = RULES.jet.speed;
      if (F.fuel > 0) { p.y = Math.min(RULES.jet.alt, p.y + dt * 6); if (moving) { p.x += mdx * sp * dt; p.z += mdz * sp * dt; } }
      else if (over) { p.x += F.dx * sp * dt; p.z += F.dz * sp * dt; } // out of fuel above something: keep going the same way until clear
      else { p.y = Math.max(0, p.y - dt * 5); if (moving) { p.x += mdx * sp * .6 * dt; p.z += mdz * sp * .6 * dt; } }
      resolve(p, RULES.radius, Math.max(0, p.y - .2)); if (F.fuel <= 0 && p.y <= 0 && !over) { a.state = 'free'; c.baseName = ''; a.cd.jet = NOW + (DBG.noCd && a.isPlayer ? .3 : RULES.jet.cd); }
      const jp = c.held.jetpack; if (jp && jp.parent && c.visible) { const n = jp.localToWorld(V3(0, -.28, -.04)); puff(n.x, n.y, n.z, Math.random() < .5 ? 0xff9a2a : 0xffd04a, .09, .2, 1.4); }
    } else if (a.state === 'pick') {
      const s = a.sub; s.t += dt; const dur = c.clips.Picking_Up.duration / 2.4;
      if (!s.done && s.t >= dur * .46) { s.done = true; if (items.indexOf(s.it) >= 0 && !s.it.by && dist2(a.x, a.z, s.it.x, s.it.z) < 1.8) takeItem(a, s.it); }
      if (s.t >= dur * .8) { a.state = 'free'; c.baseName = ''; }
    }
    // attack timers
    if (a.shot && (a.shot.t -= dt) <= 0) { const W = a.shot.W; a.shot = null; landAttack(a, W); }
    if (a.attackT > 0) a.attackT -= dt; if (a.hitT > 0) a.hitT -= dt;
    a.upT = Math.max(a.attackT || 0, a.hitT || 0);
    if (c.up && !c.up.hold && a.upT <= 0 && !a.shot) upperStop(c, .2);
    passSide = '*'; a.bar.position.set(p.x, 2.1 + p.y, p.z);
    if (dt > 0) { a.vx = (p.x - ox) / dt; a.vz = (p.z - oz) / dt; }
    c.holder.rotation.y = c.yaw;
  }


  // =====================================================================================================
  // g4: navigation grid + A*, and the bots' state machine
  // =====================================================================================================
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

  const ROLE = ['elec', 'air', 'weapon'];
  function makeBrain(a) { a.brain = { goal: null, path: null, pi: 0, thinkT: rnd(0, .5), pathT: 0, dx: 0, dz: 0, stuckT: 0, lx: a.x, lz: a.z, react: 0, strafe: Math.random() < .5 ? 1 : -1, role: ROLE[a.slot % 3] }; }
  const mateHas = (a, b) => teams[a.side].members.some(m => m !== a && m.brain && m.alive && m.brain.goal && m.brain.goal.b === b);
  function botThink(a) {
    const br = a.brain, side = a.side, en = enemyOf(side), set = g => { if (!br.goal || br.goal.type !== g.type || br.goal.b !== g.b || br.goal.it !== g.it) { br.goal = g; br.path = null; } };
    if (a.carry) return set({ type: 'deliver', b: a.carry.b }); if (a.cable) return set({ type: 'plug', b: a.cable.b }); if (a.chan) return;
    if (a.hp < maxHp(a) * .3 && !a.carry && !a.cable) { const sp = layout.spawns[a.side][1]; return set({ type: 'heal', b: { x: sp[0], z: sp[1] } }); }
    if (a.hp < 60) { let best = null, bd = 45; for (const m of medkits) if (m.t <= 0) { const d = dist2(a.x, a.z, m.x, m.z); if (d < bd) { bd = d; best = m; } } if (best) return set({ type: 'medkit', m: best, b: best }); }
    if (core.dead) return set({ type: 'hot', b: core, x: br.goal && br.goal.type === 'hot' ? br.goal.x : rnd(-8, 8), z: br.goal && br.goal.type === 'hot' ? br.goal.z : rnd(-8, 8) });
    // help a running quest of my team
    for (const b of blds) { const q = b.q; if (!q || q.side !== side || q.phase !== 'active') continue;
      if (q.item && !q.item.by && !teams[side].members.some(m => m !== a && m.brain && m.brain.goal && m.brain.goal.it === q.item)) return set({ type: 'item', it: q.item, b });
      if (q.guard && !q.guard.dead && (br.role === 'weapon' || dist2(a.x, a.z, b.x, b.z) < 22)) return set({ type: 'quest', b });
      if (q.cable && q.cable.state === 'dropped' && !mateHas(a, b)) return set({ type: 'grab', c: q.cable, b }); }
    for (const b of blds) if (b.q && b.q.side === side && b.q.phase === 'pending' && dist2(a.x, a.z, b.x, b.z) < 34) return set({ type: 'clear', b });
    if (br.goal && (br.goal.type === 'quest' || br.goal.type === 'cableSrc' || br.goal.type === 'chan') && (canStart(side, br.goal.b) || br.goal.type === 'chan' && br.goal.b.holder === en)) return; // keep walking to what I chose
    // open the next building: my own track first, then anything nobody is on
    const tracks = [br.role].concat(ROLE.filter(t => t !== br.role));
    for (const tr of tracks) for (const tier of [1, 2, 3]) { const b = bldOf(side, tr, tier); if (mateHas(a, b)) continue;
      if (tr === 'elec' && tier === 3 && b.holder === en && NOW >= b.immune && !b.q && bldOf(side, 'elec', 2).active) return set({ type: 'chan', b });
      if (!canStart(side, b)) continue; if (tr !== br.role && tier === 1 && teams[side].members.some(m => m !== a && m.brain && m.brain.role === tr && m.alive)) continue;
      return set(tr === 'elec' ? { type: 'cableSrc', b, src: tier === 1 ? reels[side] : { x: bldOf(side, 'elec', tier - 1).sock.fx, z: bldOf(side, 'elec', tier - 1).sock.fz } } : { type: 'quest', b }); }
    // nothing to open: sabotage sometimes, otherwise the core
    if (!br.goal || br.goal.type !== 'core') { const opts = blds.filter(b => b.tier < 3 && b.home === en && canStart(side, b) && !mateHas(a, b)); if (opts.length && Math.random() < .45) { const b = opts[Math.random() * opts.length | 0]; return set(b.track === 'elec' ? { type: 'chan', b } : { type: 'quest', b }); } }
    if (br.goal && (br.goal.type === 'quest' || br.goal.type === 'chan') && br.goal.b.q && br.goal.b.q.side === side) return;
    if (coreOpenFor(side)) set({ type: 'core', b: core }); else { const opts = blds.filter(b => b.tier < 3 && b.home === en && canStart(side, b)); if (opts.length) { const b = opts[(a.slot + (NOW / 20 | 0)) % opts.length]; set(b.track === 'elec' ? { type: 'chan', b } : { type: 'quest', b }); } else set({ type: 'core', b: core }); }
  }
  function botUpdate(a, dt) {
    const br = a.brain, inp = a.inp; inp.mx = inp.mz = 0; if (!a.alive || matchOver) return;
    if ((br.thinkT -= dt) <= 0 || !br.goal) { br.thinkT = rnd(.7, 1.2); botThink(a); }
    const g = br.goal; if (!g) return; const W = WEAPONS[a.weapon], canFight = !a.carry && !a.cable && !a.chan && a.state === 'free';
    let dest = null, stop = 0, tgt = null, tr = .45;
    // what to walk to
    if (g.type === 'heal') { dest = g.b; stop = 2; if (a.hp >= maxHp(a) * .95) br.goal = null; }
    else if (g.type === 'medkit') { dest = g.m; if (g.m.t > 0 || a.hp > 75) br.goal = null; }
    else if (g.type === 'deliver') dest = g.b; else if (g.type === 'plug') dest = { x: g.b.sock.fx, z: g.b.sock.fz };
    else if (g.type === 'item') { dest = g.it; if (items.indexOf(g.it) < 0 || g.it.by) br.goal = null; }
    else if (g.type === 'grab') { dest = g.c.end; if (cables.indexOf(g.c) < 0 || g.c.state !== 'dropped') br.goal = null; }
    else if (g.type === 'hot') { dest = g; stop = 1.5; if (dist2(a.x, a.z, g.x, g.z) < 2 && Math.random() < dt * .3) { g.x = rnd(-9, 9); g.z = rnd(-9, 9); } }
    else if (g.type === 'clear') { dest = g.b; stop = Math.max(1.5, g.b.R - 2.5); if (!g.b.q) br.goal = null; }
    else if (g.type === 'cableSrc') { dest = g.src; stop = 1.6; const o = elecOption(a); if (o && o.type === 'cable' && o.b === g.b) { startCable(a, o.b, o.src); br.goal = null; } else if (!canStart(a.side, g.b)) br.goal = null; }
    else if (g.type === 'chan') { dest = { x: g.b.sock.fx, z: g.b.sock.fz }; stop = 1.2; if (!a.chan) { const o = elecOption(a); if (o && o.type === 'chan' && o.b === g.b) startChan(a, o.b, o.kind); else if (dist2(a.x, a.z, dest.x, dest.z) < 1.5) br.goal = null; } }
    else if (g.type === 'quest') { const b = g.b, q = b.q;
      if (!q) { dest = b.front; stop = 1; if (dist2(a.x, a.z, b.x, b.z) < b.R - 1) { if (canStart(a.side, b)) startQuest(b, a); else br.goal = null; } }
      else if (q.side !== a.side) br.goal = null;
      else if (q.guard && !q.guard.dead) { tgt = q.guard; tr = .75; } else if (q.phase === 'pending') { dest = b.front; stop = 2; } else br.goal = null; }
    else if (g.type === 'core') { if (core.dead) { br.goal = null; return; } tgt = core; }
    // enemies nearby take priority over the errand, unless my hands are full
    if (canFight && DBG.aggressive && !(g.type === 'heal' && a.hp < maxHp(a) * .6)) { let bd = tgt && tgt.isGuard ? 4 : 10.5; for (const e of teams[enemyOf(a.side)].members) { if (!visibleTo(e, a.side) || e.state === 'fly') continue; const d = dist2(a.x, a.z, e.x, e.z); if (d < bd && lineClear(a.x, a.z, e.x, e.z)) { bd = d; tgt = e; tr = .45; } } }
    if (canFight && br.stuckT > 1.2) for (const f of fences) if (f.side !== a.side && !f.broken && dist2(a.x, a.z, f.x, f.z) < 2.6) { tgt = f; tr = 1.3; }
    let direct = false;
    if (tgt && canFight) {
      let tx = tgt === core ? clamp(a.x, -6.7, 6.7) : tgt.x, tz = tgt === core ? clamp(a.z, -4.7, 4.7) : tgt.z; const d = dist2(a.x, a.z, tx, tz), reach = W.melee ? W.range + tr - .5 : W.range - .4, yaw = yawOf(tx - a.x, tz - a.z), los = tgt === core || lineClear(a.x, a.z, tx, tz);
      br.react = Math.max(0, br.react - dt);
      if (d <= reach && los) { if (br.react <= 0 && startAttack(a, yaw + rnd(-.13, .13))) br.react = rnd(.05, .25); } else br.react = rnd(.25, .45);
      a.aimYaw = yaw;
      // footwork: melee closes in; ranged keeps its distance and strafes; step out of a guard's wind-up circle
      const danger = tgt.isGuard && tgt.st === 'wind' && !tgt.ranged && dist2(a.x, a.z, tgt.tele.position.x, tgt.tele.position.z) < 2.6;
      if (danger) { const ax = a.x - tgt.tele.position.x, az = a.z - tgt.tele.position.z, l = Math.hypot(ax, az) || 1; inp.mx = ax / l; inp.mz = az / l; direct = true; }
      else if (los && d < 12) { direct = true; const nx = (tx - a.x) / (d || 1), nz = (tz - a.z) / (d || 1), want = W.melee ? reach * .7 : W.range * .72;
        if (d > want + .4) { inp.mx = nx; inp.mz = nz; } else if (d < want - 1.2 && !W.melee) { inp.mx = -nx; inp.mz = -nz; } else if (tgt !== core && !tgt.isFence) { if (Math.random() < dt * .6) br.strafe = -br.strafe; inp.mx = -nz * br.strafe * .8; inp.mz = nx * br.strafe * .8; } }
      else dest = { x: tx, z: tz };
    }
    if (!direct && dest) {
      const d = dist2(a.x, a.z, dest.x, dest.z);
      if (d > Math.max(.35, stop)) {
        br.pathT -= dt; if (!br.path || br.pathT <= 0 || dist2(br.px, br.pz, dest.x, dest.z) > 2) { br.path = findPath(a.x, a.z, dest.x, dest.z); br.pi = 0; br.pathT = rnd(1.2, 1.8); br.px = dest.x; br.pz = dest.z; }
        while (br.pi < br.path.length - 1 && dist2(a.x, a.z, br.path[br.pi].x, br.path[br.pi].z) < .8) br.pi++;
        const wp = br.path[br.pi], l = dist2(a.x, a.z, wp.x, wp.z) || 1; inp.mx = (wp.x - a.x) / l; inp.mz = (wp.z - a.z) / l;
        if (d > 9 && !a.carry && !a.cable && ABIL.dash.ok(a) && Math.random() < dt * .5) useAbility(a, 'dash');
      }
    }
    if (a.hp < 45 && NOW - a.lastHit < .5) { if (ABIL.reflect.ok(a)) useAbility(a, 'reflect'); if (ABIL.invis.ok(a)) useAbility(a, 'invis'); }
    // stuck? nudge sideways and re-plan
    if (Math.hypot(inp.mx, inp.mz) > .3) { br.moveT = (br.moveT || 0) + dt; if (br.moveT > .5) { if (dist2(a.x, a.z, br.lx, br.lz) < .5) { br.stuckT += br.moveT; br.path = null; if (br.stuckT > .9) { const s = Math.random() < .5 ? 1 : -1, t = inp.mx; inp.mx = -inp.mz * s; inp.mz = t * s; br.nudge = .35; br.nx = inp.mx; br.nz = inp.mz; } } else br.stuckT = 0; br.lx = a.x; br.lz = a.z; br.moveT = 0; } } else br.moveT = 0;
    if (br.nudge > 0) { br.nudge -= dt; inp.mx = br.nx; inp.mz = br.nz; }
  }


  // =====================================================================================================
  // g5: match flow, player input, camera, HUD, minimap, debug panel, main loop
  // =====================================================================================================
  let player = null;
  function teardownActors() { for (const a of actors) { for (const k in a.c.held) detach(a.c, k); scene.remove(a.bar); a.c.mixer.stopAllAction(); scene.remove(a.c.holder); a.c.holder.remove(a.c.root); } actors.length = 0; teams.A.members = []; teams.B.members = []; }
  function setupTeams() {
    teardownActors(); teams.A.color = DBG.color; teams.B.color = DBG.color === 'blue' ? 'red' : 'blue';
    for (const side of ['A', 'B']) CHAR_IDS.forEach((ck, i) => makeActor(ck, side, i));
    player = teams.A.members[DBG.char] || teams.A.members[0]; player.isPlayer = true; for (const a of actors) makeBrain(a);
    resetMatch(); makePortrait(); buildMates(); buildPowers(); hudKey = '';
  }
  function resetMatch() {
    matchOver = null; matchT = RULES.match; $('end').hidden = true;
    for (const b of blds) { if (b.q) { cleanupQuest(b, false); b.q = null; } b.active = false; b.holder = null; b.immune = 0; if (b.wire) { scene.remove(b.wire); b.wire = null; } }
    for (const b of blds) clearFence(b); for (const s of shots) scene.remove(s.m); shots.length = 0; for (const a of actors) if (a.chan) endChan(a);
    for (const m of medkits) { m.t = 0; m.mesh.visible = m.halo.visible = true; }
    if (core.dead) { for (const c of core.cols) if (solids.indexOf(c) < 0) solids.push(c); hall.visible = true; turret.visible = true; for (const s of signMeshes) s.visible = true; rubble.visible = false; hzDisc.visible = false; coreRing.scale.setScalar(1); coreRing.material.color.setHex(0xd9534a); core.holder = null; renderer.shadowMap.needsUpdate = true; buildNav(); }
    core.dead = false; core.hp = RULES.coreHp; core.fireT = 2; core.aoeT = 4; core.aoe = null; core.burst = 0; aoeMesh.material.opacity = 0; teams.A.hz = teams.B.hz = 0; teams.A.coreDmg = teams.B.coreDmg = 0;
    for (const a of actors) { a.kills = 0; a.cd = {}; a.dashN = RULES.dash.charges; a.noAct = 0; a.shieldUp = false; a.shieldAt = 0; a.invisT = 0; a.reflectT = 0; setGhost(a.c, false); a.c.holder.position.y = 0; if (a.c.up) upperStop(a.c, 0); respawn(a); a.prot = 0; setWeapon(a, 'fist'); if (a.brain) makeBrain(a); }
    refreshLoadout('A'); refreshLoadout('B'); pan.x = pan.z = 0; hudKey = ''; lastSec = 999; SFX.play('start'); SFX.say('המשחק מתחיל', true);
  }
  function endMatch(side, why) {
    if (matchOver) return; matchOver = { side, why }; SFX.play(side === null ? 'lost' : side === player.side ? 'win' : 'lose'); SFX.say(side === null ? 'תיקו' : side === player.side ? 'ניצחון!' : 'הפסד', true);
    for (const a of actors) { if (!a.alive) continue; a.inp.mx = a.inp.mz = 0; a.shot = null; a.aiming = false; if (a.carry) dropItem(a); if (a.cable) dropCable(a); if (a.c.up) upperStop(a.c, .1); a.state = 'end'; a.c.holder.position.y = 0; a.c.baseName = ''; const n = side === null ? 'Idle' : (a.side === side ? ['Victory', 'Victory2', 'Victory3'] : ['Defeat', 'Defeat2', 'Defeat3'])[Math.random() * 3 | 0]; play(a.c, n, { fade: .2 }); }
    $('endTitle').textContent = side === null ? 'תיקו' : side === player.side ? 'ניצחון!' : 'הפסד'; $('endTitle').style.color = side === null ? '' : side === player.side ? 'var(--ok)' : 'var(--hit)'; $('endWhy').textContent = why || '';
    if (window.ARENA_SHELL && !DBG.sim && !DBG.spectate) { const r = ARENA_SHELL.result({ mode: 'city', hero: ARENA_SHELL.prof.hero, win: side === player.side, draw: side === null, kills: player.kills }); if (r && window.showReward) showReward(r); } $('endStats').textContent = 'חיסולים: ' + player.kills + ' · נזק לעירייה: ' + Math.round(teams.A.coreDmg) + ' מול ' + Math.round(teams.B.coreDmg); setTimeout(() => { if (matchOver) $('end').hidden = false; }, 1600);
  }
  function timeUp() {
    const A = teams.A, B = teams.B, n = s => blds.filter(b => b.tier === 3 ? b.holder === s : (b.home === s && b.active)).length;
    if (core.dead) return A.hz === B.hz ? endMatch(null, 'הזמן נגמר — אחוזי כיבוש שווים') : endMatch(A.hz > B.hz ? 'A' : 'B', 'הזמן נגמר — יותר אחוזי כיבוש');
    if (Math.abs(A.coreDmg - B.coreDmg) > .5) return endMatch(A.coreDmg > B.coreDmg ? 'A' : 'B', 'הזמן נגמר — יותר נזק לעירייה');
    if (n('A') !== n('B')) return endMatch(n('A') > n('B') ? 'A' : 'B', 'הזמן נגמר — יותר מבנים'); endMatch(null, 'הזמן נגמר');
  }
  $('endBtn').onclick = () => { if (window.ARENA_SHELL) ARENA_SHELL.again(); resetMatch(); };

  // ---------- messages ----------
  let toastT = 0; toast = t => { if (!t) return; $('toast').textContent = t; $('toast').hidden = false; toastT = 2.4; };
  note = (side, t) => { if (player && side === player.side) toast(t); };
  feed = (t, side) => { const d = document.createElement('div'); d.textContent = t; d.style.borderColor = side && teams[side] ? TEAM_CSS[teams[side].color] : ''; const f = $('feed'); f.appendChild(d); while (f.children.length > 4) f.removeChild(f.firstChild); setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 6000); };
  onPlayerHit = () => { $('vig').style.opacity = '1'; setTimeout(() => { $('vig').style.opacity = '0'; }, 120); };

  // ---------- input ----------
  const keys = new Set(), L = { id: null, ox: 0, oy: 0, x: 0, y: 0 }, Rs = { id: null, ox: 0, oy: 0, x: 0, y: 0, moved: false }, mouse = { down: false, x: 0, y: 0, t: 0 }, SR = 54;
  let queued = null, queuedT = 0, usedTouch = false;
  const lS = $('lStick'), rS = $('rStick'), touchEl = $('touch');
  const home = k => { const w = window.innerWidth, h = window.innerHeight, cs = getComputedStyle(document.documentElement), px = v => parseFloat(cs.getPropertyValue(v)) || 10, m = Math.max(px('--sl'), px('--sr')) + 34, y = h - px('--sb') - 30 - 59; return k === 'l' ? [m + 59, y] : [w - m - 59, y]; };
  function placeStick(el, cx, cy, kx, ky, on) { el.style.transform = 'translate(' + (cx - 59) + 'px,' + (cy - 59) + 'px)'; el.firstChild.style.transform = 'translate(' + kx + 'px,' + ky + 'px)'; el.classList.toggle('on', !!on); }
  function restSticks() { if (!usedTouch && !coarse) return; lS.hidden = rS.hidden = false; if (L.id === null) { const p = home('l'); placeStick(lS, p[0], p[1], 0, 0, false); } if (Rs.id === null) { const p = home('r'); placeStick(rS, p[0], p[1], 0, 0, false); } }
  touchEl.addEventListener('pointerdown', e => {
    if (DBG.spectate) return;
    if (e.pointerType === 'mouse') { if (e.button === 0) { mouse.down = true; mouse.x = e.clientX; mouse.y = e.clientY; mouse.t = performance.now(); } return; }
    usedTouch = true; try { touchEl.setPointerCapture(e.pointerId); } catch (_) { }
    if (e.clientX < window.innerWidth / 2) { if (L.id !== null) return; L.id = e.pointerId; L.ox = e.clientX; L.oy = e.clientY; L.x = L.y = 0; placeStick(lS, L.ox, L.oy, 0, 0, true); }
    else if (Rs.id === null) { Rs.id = e.pointerId; Rs.ox = e.clientX; Rs.oy = e.clientY; Rs.x = Rs.y = 0; Rs.moved = false; placeStick(rS, Rs.ox, Rs.oy, 0, 0, true); }
    restSticks();
  });
  touchEl.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse') { mouse.x = e.clientX; mouse.y = e.clientY; return; }
    const s = e.pointerId === L.id ? L : e.pointerId === Rs.id ? Rs : null; if (!s) return;
    let dx = e.clientX - s.ox, dy = e.clientY - s.oy; const d = Math.hypot(dx, dy); if (s === Rs && d > 16) Rs.moved = true; if (d > SR) { dx *= SR / d; dy *= SR / d; }
    s.x = dx / SR; s.y = dy / SR; placeStick(s === L ? lS : rS, s.ox, s.oy, dx, dy, true);
  });
  const up = e => {
    if (DBG.spectate) { mouse.down = false; return; }
    if (e.pointerType === 'mouse') { if (mouse.down && e.type === 'pointerup') { mouse.down = false; fireAt(mouseYaw()); } mouse.down = false; return; }
    if (e.pointerId === L.id) { L.id = null; L.x = L.y = 0; }
    if (e.pointerId === Rs.id) { const moved = Rs.moved, yaw = yawOf(Rs.x, Rs.y); Rs.id = null; Rs.moved = false; if (e.type === 'pointerup') { if (moved && Math.hypot(Rs.x, Rs.y) > .25) fireAt(yaw); else if (!moved) fireAt(autoYaw()); else cancelAim(player); } Rs.x = Rs.y = 0; rS.classList.remove('block'); }
    restSticks();
  };
  touchEl.addEventListener('pointerup', up); touchEl.addEventListener('pointercancel', up);
  touchEl.addEventListener('contextmenu', e => e.preventDefault());
  const gp = new THREE.Plane(new THREE.Vector3(0, 1, 0), -chestY), gv = new THREE.Vector3(), mRay = new THREE.Raycaster();
  function groundAt(cx, cy, plane) { const r = canvas.getBoundingClientRect(); mRay.setFromCamera({ x: (cx - r.left) / r.width * 2 - 1, y: -((cy - r.top) / r.height * 2 - 1) }, camera); return mRay.ray.intersectPlane(plane || gp, gv) ? gv : null; }
  function mouseYaw() { const p = groundAt(mouse.x, mouse.y); return p ? yawOf(p.x - player.x, p.z - player.z) : player.c.yaw; }
  // nearest thing worth hitting within reach, else straight ahead
  function autoYaw() {
    const W = WEAPONS[player.weapon], r = W.range + (W.melee ? .6 : .2); let best = null, bd = 1e9; const consider = (x, z, pad) => { const d = dist2(player.x, player.z, x, z) - (pad || 0); if (d <= r && d < bd && lineClear(player.x, player.z, x, z, 1.0)) { bd = d; best = [x, z]; } };
    for (const e of teams[enemyOf(player.side)].members) if (visibleTo(e, player.side) && e.state !== 'fly') consider(e.x, e.z, .4);
    for (const g of guards) if (!g.dead && g.owner !== player.side) consider(g.x, g.z, .7); for (const f of fences) if (f.side !== player.side && !f.broken) consider(f.x, f.z, 1);
    if (!best && !core.dead) { const px = clamp(player.x, -6.7, 6.7), pz = clamp(player.z, -4.7, 4.7), d = dist2(player.x, player.z, px, pz); if (d <= r) best = [px, pz]; }
    return best ? yawOf(best[0] - player.x, best[1] - player.z) : (player.aiming ? player.aimYaw : player.c.yaw);
  }
  function fireAt(yaw) { if (!player.alive || matchOver) return; if (!startAttack(player, yaw)) { if (player.atkCd > 0 && player.atkCd < .45) { queued = yaw; queuedT = .45; } else cancelAim(player); } }
  let lastSec = 999;
  function swapWeapon() { SFX.play('click'); const own = ownedWeapons(player); if (own.length < 2 || player.shot) return; setWeapon(player, own[(own.indexOf(player.weapon) + 1) % own.length]); hudKey = ''; }
  function pickW(i) { const w = ownedWeapons(player)[i]; if (w && !player.shot) { setWeapon(player, w); hudKey = ''; } }
  function ability(i) { const l = abilitiesOf(player); if (l[i]) useAbility(player, l[i]); }
  const KEYACT = { KeyE: () => doAction(player), KeyQ: swapWeapon, KeyZ: () => pickW(0), KeyX: () => pickW(1), KeyC: () => pickW(2), KeyV: () => pickW(3), Digit1: () => ability(0), Digit2: () => ability(1), Digit3: () => ability(2), Digit4: () => ability(3), KeyF: () => useAbility(player, 'jet'), ShiftLeft: () => useAbility(player, 'dash') || useAbility(player, 'jump'), KeyM: () => { DBG.minimap = !DBG.minimap; syncDbg(); } };
  KEYACT.ShiftRight = KEYACT.ShiftLeft;
  window.addEventListener('keydown', e => { if (/INPUT|SELECT/.test(e.target.tagName)) return; if (!e.repeat && KEYACT[e.code] && player.alive && !matchOver && !DBG.spectate) { KEYACT[e.code](); e.preventDefault(); } keys.add(e.code); if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); });
  window.addEventListener('keyup', e => keys.delete(e.code)); window.addEventListener('blur', () => { keys.clear(); mouse.down = false; });
  const tap = (el, fn) => el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (e.pointerType !== 'mouse') usedTouch = true; fn(); });
  tap($('btnAct'), () => doAction(player)); tap($('wbtn'), () => doAction(player)); tap($('btnAtk'), () => fireAt(autoYaw()));
  const aimLine = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, .5), new THREE.MeshBasicMaterial({ color: 0xdedede, transparent: true, opacity: .5, depthWrite: false })); aimLine.visible = false; aimLine.renderOrder = 3; scene.add(aimLine);
  function playerInput(dt) {
    const a = player, inp = a.inp; let x = L.x, z = L.y; if (keys.has('KeyA')) x -= 1; if (keys.has('KeyD')) x += 1; if (keys.has('KeyW')) z -= 1; if (keys.has('KeyS')) z += 1; const m = Math.hypot(x, z); if (m > 1) { x /= m; z /= m; } inp.mx = x; inp.mz = z;
    if (!a.alive || matchOver) { aimLine.visible = false; return; }
    let aim = null; if (Rs.id !== null && Rs.moved && Math.hypot(Rs.x, Rs.y) > .25) aim = yawOf(Rs.x, Rs.y); else if (mouse.down && performance.now() - mouse.t > 130) aim = mouseYaw();
    else { let ax = 0, az = 0; if (keys.has('ArrowLeft')) ax -= 1; if (keys.has('ArrowRight')) ax += 1; if (keys.has('ArrowUp')) az -= 1; if (keys.has('ArrowDown')) az += 1; if (ax || az) { aim = yawOf(ax, az); a.arrowAim = aim; } else if (a.arrowAim !== undefined && a.aiming) { fireAt(a.arrowAim); a.arrowAim = undefined; } }
    if (aim !== null) holdAim(a, aim);
    if (keys.has('Space') && a.atkCd <= 0 && !a.shot) fireAt(autoYaw());
    if (queued !== null) { queuedT -= dt; if (a.atkCd <= 0) { startAttack(a, queued); queued = null; } else if (queuedT <= 0) queued = null; }
    // the aim marker: as long as the weapon reaches, cut short where an obstacle stops the shot
    const show = a.aiming && aim !== null; aimLine.visible = show;
    if (show) { const W = WEAPONS[a.weapon], dx = Math.sin(aim), dz = Math.cos(aim), free = rayStatic(a.x, a.z, dx, dz, W.range, W.melee ? 1.3 : 1.0), cut = free < W.range - .05; aimLine.position.set(a.x, .06, a.z); aimLine.rotation.y = aim; aimLine.scale.set(W.melee ? 1.5 : .22, 1, Math.max(.3, free)); aimLine.material.color.setHex(cut ? 0xff6a5e : 0xdedede); rS.classList.toggle('block', cut); }
  }

  // ---------- camera ----------
  const pan = { x: 0, z: 0, drag: false }, camT = new THREE.Vector3(); let zoom = 1;
  function resize() { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 52 : 40; zoom = (w < h ? 1.12 : 1) * (+DBG.zoom || 1); camera.updateProjectionMatrix(); restSticks(); document.body.classList.toggle('desk', !coarse && !usedTouch); }
  window.addEventListener('resize', resize); window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  function applyRes() { const want = +DBG.res || Math.min(2, dpr); renderer.setPixelRatio(Math.min(maxPr, want)); resize(); }
  const CAM = { y: 7.4, z: 6.6 }; // closer and a little flatter, so the characters read clearly
  const spec = { x: 0, z: 30, follow: null, zoom: 1.6 };
  function specTarget() { const f = spec.follow; return f ? [f.x, f.z] : [spec.x, spec.z]; }
  function updateCamera(dt, snap) {
    if (DBG.spectate) { // free camera over the whole arena; WASD / drag to fly, wheel to zoom, follow any player
      let mx = 0, mz = 0; if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1; if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1; if (keys.has('KeyW') || keys.has('ArrowUp')) mz -= 1; if (keys.has('KeyS') || keys.has('ArrowDown')) mz += 1;
      if (mx || mz) { if (spec.follow) { spec.x = spec.follow.x; spec.z = spec.follow.z; spec.follow = null; } spec.x += mx * 22 * spec.zoom * dt; spec.z += mz * 22 * spec.zoom * dt; }
      spec.x = clamp(spec.x, -HW, HW); spec.z = clamp(spec.z, -HL, HL); const [tx, tz] = specTarget(), z2 = zoom * spec.zoom;
      camT.set(tx, CAM.y * z2, tz + CAM.z * z2); if (snap) camera.position.copy(camT); else camera.position.lerp(camT, Math.min(1, dt * 6)); camera.lookAt(camera.position.x, 1, camera.position.z - CAM.z * z2); return;
    }
    if (!pan.drag) { pan.x += (0 - pan.x) * Math.min(1, dt * 7); pan.z += (0 - pan.z) * Math.min(1, dt * 7); }
    const tx = clamp(player.x + pan.x, -HW, HW), tz = clamp(player.z + pan.z, -HL, HL); camT.set(tx, CAM.y * zoom + player.c.holder.position.y * .4, tz + CAM.z * zoom);
    if (snap) camera.position.copy(camT); else camera.position.lerp(camT, Math.min(1, dt * 7)); camera.lookAt(camera.position.x, 1, camera.position.z - CAM.z * zoom);
  }

  // ---------- HUD ----------
  let hudKey = '';
  // a head-and-shoulders shot of each team-mate, rendered once from their own model
  function portraitOf(a) {
    try {
      const rt = new THREE.WebGLRenderTarget(128, 128), cam = new THREE.PerspectiveCamera(28, 1, .1, 30), c = a.c, bg = scene.background; c.holder.rotation.y = c.yaw; const wasVis = c.root.visible, wasH = c.holder.visible; c.root.visible = true; c.holder.visible = true; if (!c.base) play(c, 'Idle', { fade: 0 }); c.mixer.update(0); c.holder.updateMatrixWorld(true);
      const head = c.root.getObjectByName('Head').getWorldPosition(V3(0, 0, 0)), f = V3(Math.sin(c.yaw + .45), 0, Math.cos(c.yaw + .45)); cam.position.copy(head).addScaledVector(f, 1.75).add(V3(0, .1, 0)); cam.lookAt(head.x, head.y - .06, head.z);
      scene.background = new THREE.Color(teams[a.side].color === 'blue' ? 0x1c3a6b : 0x6b1f1c); const vis = []; scene.traverse(o => { if ((o.isMesh || o.isSprite || o.isLine) && o.visible) { let p = o, mine = false; while (p) { if (p === c.root) { mine = true; break; } p = p.parent; } if (!mine) { vis.push(o); o.visible = false; } } });
      renderer.setRenderTarget(rt); renderer.render(scene, cam); const px = new Uint8Array(128 * 128 * 4); renderer.readRenderTargetPixels(rt, 0, 0, 128, 128, px); renderer.setRenderTarget(null); for (const o of vis) o.visible = true; scene.background = bg; renderer.shadowMap.needsUpdate = true; c.root.visible = wasVis; c.holder.visible = wasH;
      const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d'), im = x.createImageData(128, 128); for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) { const s0 = ((127 - j) * 128 + i) * 4, d = (j * 128 + i) * 4; for (let k = 0; k < 3; k++) im.data[d + k] = Math.pow(px[s0 + k] / 255, 1 / 2.2) * 255; im.data[d + 3] = 255; }
      x.putImageData(im, 0, 0); const g = x.createLinearGradient(0, 70, 0, 128); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.45)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); rt.dispose(); return cv.toDataURL('image/jpeg', .85);
    } catch (e) { return ''; }
  }
  function makePortrait() { document.documentElement.style.setProperty('--team', TEAM_CSS[teams.A.color]); for (const a of teams.A.members) a.pic = portraitOf(a); $('portrait').src = player.pic; $('meNm').textContent = player.name; }
  function buildMates() { const box = $('mates'); box.innerHTML = ''; for (const a of teams[player.side].members) { if (a === player) continue; const d = document.createElement('div'); d.className = 'plate mate'; d.innerHTML = '<span class="wrap"><img class="pic" alt=""><em></em></span>'; d.querySelector('img').src = a.pic || ''; d.querySelector('img').alt = a.name; box.appendChild(d); a.mateEl = d; } }
  // every power as a small picture: faded until my team owns it, then lit in its track's colour
  const IC = {
    stick: '<path d="M5 19L19 5"/><path d="M16 4l4 4"/>', sling: '<path d="M12 21v-8M12 13L6 4M12 13l6-9"/><path d="M6 4c2 4 10 4 12 0" stroke-dasharray="2 2"/>',
    sword: '<path d="M20 4v3L10.5 16.5l-3-3L17 4z"/><path d="M5.5 12.5l6 6"/><path d="M8.5 15.5l-4 4"/><circle cx="4" cy="20" r="1.2"/>', bow: '<path d="M6 3c8 3 8 15 0 18"/><path d="M6 3v18M3 12h17M17 9l3 3-3 3"/>',
    pistol: '<path d="M3 7h16v4h-7l-1 3H8v6H4v-9H3z"/>', speed: '<path d="M4 6l6 6-6 6M12 6l6 6-6 6"/>', dash: '<path d="M3 8h8M2 12h10M3 16h8M14 7l6 5-6 5"/>',
    jump: '<path d="M12 19V7M7 11l5-5 5 5M5 21h14"/>', gear: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
    fist: '<path d="M7 11V7.5a1.5 1.5 0 013 0V10M10 9.5V6.5a1.5 1.5 0 013 0V10M13 9.5V7a1.5 1.5 0 013 0v3M16 10V8.5a1.5 1.5 0 013 0V14a6 6 0 01-6 6h-1.5A5.5 5.5 0 016 14.5V12a1.5 1.5 0 013 0v1"/>',
    jet: '<path d="M12 2c4 3 5 8 3 13H9C7 10 8 5 12 2z"/><path d="M9 15l-3 4M15 15l3 4M12 17v5"/>', shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z"/><path d="M12 9v5M9.5 11.5h5"/>', fence: '<path d="M5 21V7l2-3 2 3v14M15 21V7l2-3 2 3v14M3 11h18M3 16h18"/>',
    ghost: '<path d="M5 21V10a7 7 0 0114 0v11l-2.5-2-2.2 2-2.3-2-2.3 2-2.2-2z"/><path d="M9.5 10.5v1M14.5 10.5v1"/>', reflect: '<path d="M4 12a8 8 0 0113-6l2 2M20 4v4h-4"/><path d="M20 12a8 8 0 01-13 6l-2-2M4 20v-4h4"/>' };
  const svg = k => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[k] + '</svg>';
  const POWERS = { w1: ['stick', 'stick', 'מקל', 'מקל'], w2: ['bow', 'bow', 'קשת', 'קשת'], w3: ['pistol', 'pistol', 'אקדח', 'אקדח'], a1: ['speed', 'speed', '+10% מהירות', '+10% מהירות'], a2: ['dash', 'dash', 'דאש', 'דאש'], a3: ['jet', 'jet', "ג'טפק", "ג'טפק"], e1: ['heart', 'heart', '+30 חיים', '+30 חיים'], e2: ['shield', 'shield', 'מגן', 'מגן'], e3: ['reflect', 'reflect', 'החזרת נזק', 'החזרת נזק'] };
  const W_IC = { fist: 'fist', stick: 'stick', sword: 'sword', sling: 'sling', bow: 'bow', pistol: 'pistol' };
  const ABIL_IC = { dash: 'dash', jump: 'jump', jet: 'jet', invis: 'ghost', reflect: 'reflect' };
  function buildPowers() { const red = teams[player.side].color === 'red', box = $('powers'); box.innerHTML = ''; for (const tr of ['w', 'a', 'e']) { const g = document.createElement('div'); g.className = 'pgroup p-' + tr; for (const t of [1, 2, 3]) { const k = tr + t, d = document.createElement('div'); d.className = 'pw'; d.id = 'pw_' + k; d.title = POWERS[k][red ? 3 : 2]; d.innerHTML = svg(POWERS[k][red ? 1 : 0]) + '<b>' + POWERS[k][red ? 3 : 2] + '</b>'; g.appendChild(d); } box.appendChild(g); } }
  function updateHud() {
    const a = player, mh = maxHp(a), hpk = Math.max(0, a.hp) / mh, hb = $('meHp'); hb.style.width = (hpk * 100).toFixed(1) + '%'; hb.className = hpk > .5 ? '' : hpk > .25 ? 'mid' : 'low'; $('meHpNum').innerHTML = Math.ceil(Math.max(0, a.hp)) + '<small>/' + mh + '</small>';
    const st = []; if (a.shieldUp) st.push('מגן'); if (a.prot > 0) st.push('הגנת ריספאון'); if (a.invisT > 0) st.push('בלתי נראה'); if (a.reflectT > 0) st.push('מחזיר נזק'); if (a.carry) st.push('נושא ' + ITEM_NAME[a.carry.tier]); if (a.cable) st.push('גורר כבל'); if (has(a.side, 'a1')) st.push('+10% מהירות'); if (efficient(a.side)) st.push('+20% יעילות');
    const own = ownedWeapons(a), ab = abilitiesOf(a), key = st.join() + '|' + own.join() + '|' + a.weapon + '|' + ab.join();
    if (key !== hudKey) { hudKey = key; $('statusRow').innerHTML = st.map(s => '<span>' + s + '</span>').join('');
      const wb = $('weapons'); wb.innerHTML = ''; own.forEach((w, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'plate wslot' + (w === a.weapon ? ' cur' : ''); b.setAttribute('aria-label', WEAPONS[w].name); b.innerHTML = svg(W_IC[w]) + '<small>' + (i + 1) + '</small>'; tap(b, () => { if (!player.shot && player.weapon !== w) { setWeapon(player, w); SFX.play('click'); hudKey = ''; } }); wb.appendChild(b); });
      const box = $('abil'); box.innerHTML = ''; ab.forEach((k, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'rb'; b.dataset.k = k; b.innerHTML = svg(ABIL_IC[k]) + ABIL[k].name; tap(b, () => useAbility(player, k)); box.appendChild(b); });  }
    for (const b of $('abil').children) { const left = (a.cd[b.dataset.k] || 0) - NOW, n = b.querySelector('.n'); if (left > .35) { if (!n) { const s = document.createElement('span'); s.className = 'n'; b.appendChild(s); } b.querySelector('.n').textContent = Math.ceil(left); } else if (n) b.removeChild(n); }
    for (const m of teams[a.side].members) { if (!m.mateEl) continue; m.mateEl.classList.toggle('dead', !m.alive); m.mateEl.querySelector('em').textContent = m.alive ? '' : Math.ceil(m.respawnT); }
    const t = Math.max(0, matchT), ck = $('clock'); ck.textContent = (DBG.clock ? '' : '⏸ ') + Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); ck.classList.toggle('low', t < 30);
    if (core.dead) { $('coreBar').hidden = true; $('hzBox').hidden = false; $('coreLbl').innerHTML = '<span>HOT ZONE</span><b>' + (core.contested ? 'במחלוקת' : core.holder ? (core.holder === a.side ? 'שלנו' : 'שלהם') : 'פנוי') + '</b>'; const pa = teams.A.hz, pb = teams.B.hz; $('hzA').style.width = pa + '%'; $('hzB').style.width = pb + '%'; $('hzA').style.background = TEAM_CSS[teams.A.color]; $('hzB').style.background = TEAM_CSS[teams.B.color]; $('hzAn').textContent = Math.floor(pa) + '%'; $('hzBn').textContent = Math.floor(pb) + '%'; }
    else { $('coreBar').hidden = false; $('hzBox').hidden = true; $('coreLbl').innerHTML = coreOpenFor(a.side) ? '<span>עירייה — פתוחה לתקיפה</span><b>' + Math.ceil(core.hp) + '</b>' : '<span>עירייה מוגנת · ' + ownedCount(a.side) + '/' + RULES.coreNeed + ' מבנים</span><b>' + Math.ceil(core.hp) + '</b>'; $('coreHp').style.width = (core.hp / RULES.coreHp * 100) + '%'; }
    for (const k in POWERS) { const el = $('pw_' + k), b = bldOf(a.side, k[0] === 'w' ? 'weapon' : k[0] === 'a' ? 'air' : 'elec', +k[1]); el.classList.toggle('on', has(a.side, k)); el.classList.toggle('busy', !!b.q); }
    let o = a.alive && !matchOver ? actionOption(a) : null; const wb = $('wbtn'); $('btnAct').hidden = !(o && /^(drop|stop)/.test(o.type)); // only when there is something to put down
    // things that are started by pressing on them get a button floating right on them
    if (o && !/^(drop|stop)/.test(o.type) && !(o.type === 'quest' && o.b.track === 'weapon')) {
      const p = o.type === 'quest' ? V3(o.b.x, 2.6, o.b.z) : o.type === 'cable' ? V3(o.src.x, 2.3, o.src.z) : o.type === 'grab' ? V3(o.c.end.x, 1.2, o.c.end.z) : V3(o.b.sock.x, 2.2, o.b.sock.z); p.project(camera);
      const r = canvas.getBoundingClientRect(); wb.hidden = false; wb.textContent = o.text; wb.style.transform = 'translate(' + ((p.x + 1) / 2 * r.width).toFixed(0) + 'px,' + ((1 - p.y) / 2 * r.height).toFixed(0) + 'px) translate(-50%,-100%)'; o = null;
    } else { wb.hidden = true; if (o && o.type === 'quest') o = null; }
    const h = $('hint'); h.hidden = !o; if (o) h.textContent = 'פעולה: ' + o.text; $('btnAct').classList.toggle('ready', !!o);
    const pq = blds.find(b => b.q && b.q.side === a.side && b.q.phase === 'active' && b.track === 'weapon' && b.q.leaveT > 0 && b.q.parts.has(a)); if (pq) { toastT = .3; $('toast').hidden = false; $('toast').textContent = 'חזרו למעגל! ' + Math.max(0, RULES.leaveGrace - pq.q.leaveT).toFixed(1); }
    $('dead').hidden = a.alive || !!matchOver; if (!a.alive) $('dead').textContent = 'חוזרים בעוד ' + Math.ceil(a.respawnT);
    $('fuel').hidden = a.state !== 'fly'; if (a.state === 'fly') $('fuelBar').style.width = Math.max(0, a.sub.fuel / RULES.jet.fuel * 100) + '%';
  }

  // ---------- minimap: whole map, my team only, a yellow window for what the camera sees (drag it to look around) ----------
  const mini = $('mini'), mctx = mini.getContext('2d'), mdpr = Math.min(2, dpr); let MS = 1; function sizeMini() { const w = mini.parentNode.getBoundingClientRect().width || 190; MS = w / (2 * HW); mini.style.height = (2 * HL * MS) + 'px'; mini.width = Math.round(2 * HW * MS * mdpr); mini.height = Math.round(2 * HL * MS * mdpr); } sizeMini(); window.addEventListener('resize', () => setTimeout(sizeMini, 50));
  const floor0 = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), viewPoly = [];
  function miniTo(e) { const r = mini.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * 2 * HW - HW, (e.clientY - r.top) / r.height * 2 * HL - HL]; }
  mini.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (DBG.spectate) { const p = miniTo(e); spec.follow = null; spec.x = p[0]; spec.z = p[1]; pan.drag = true; return; } pan.drag = true; try { mini.setPointerCapture(e.pointerId); } catch (_) { } const p = miniTo(e); pan.x = p[0] - player.x; pan.z = p[1] - player.z; });
  mini.addEventListener('pointermove', e => { if (!pan.drag) return; const p = miniTo(e); if (DBG.spectate) { spec.x = p[0]; spec.z = p[1]; return; } pan.x = p[0] - player.x; pan.z = p[1] - player.z; });
  const mEnd = () => { pan.drag = false; }; mini.addEventListener('pointerup', mEnd); mini.addEventListener('pointercancel', mEnd);
  const GLYPH = { weapon: 'M-1.6 1.6L1.6-1.6M.6-1.6h1v1', air: 'M-1.8-.6h2.4a.9.9 0 10-.9-.9M-1.8.6h3a.9.9 0 11-.9.9', elec: 'M.4-2L-1 .3h1.2L-.4 2 1 -.3H-.2z' };
  function drawMini() {
    const x = mctx, k = MS * mdpr, X = v => (v + HW) * k, Z = v => (v + HL) * k, W = mini.width, H = mini.height; x.clearRect(0, 0, W, H);
    x.fillStyle = '#2b2f38'; x.fillRect(0, 0, W, H); x.strokeStyle = 'rgba(255,255,255,.05)'; x.lineWidth = 1; for (let g = -HW; g <= HW; g += 15) { x.beginPath(); x.moveTo(X(g), 0); x.lineTo(X(g), H); x.stroke(); } for (let g = -HL; g <= HL; g += 15) { x.beginPath(); x.moveTo(0, Z(g)); x.lineTo(W, Z(g)); x.stroke(); }
    // bases
    const mine = TEAM_CSS[teams.A.color], theirs = TEAM_CSS[teams.B.color]; x.globalAlpha = .35; x.fillStyle = mine; x.fillRect(0, Z(HL - 10), W, 10 * k); x.fillStyle = theirs; x.fillRect(0, 0, W, 10 * k); x.globalAlpha = 1;
    x.font = '700 ' + (7 * k).toFixed(0) + 'px Rubik, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = 'rgba(255,255,255,.75)'; x.fillText('הבסיס שלנו', W / 2, Z(HL - 5)); x.fillText('האויב', W / 2, Z(-HL + 5));
    // centre: hall or hot zone
    x.beginPath(); x.arc(X(0), Z(0), (core.dead ? RULES.hzR : RULES.coreR) * k, 0, 7); x.fillStyle = core.dead ? (core.holder ? TEAM_CSS[teams[core.holder].color] : 'rgba(255,122,28,.5)') : 'rgba(217,83,74,.14)'; x.globalAlpha = core.dead ? .55 : 1; x.fill(); x.globalAlpha = 1;
    if (!core.dead) { x.fillStyle = '#d9d2c3'; x.fillRect(X(-6.7), Z(-4.7), 13.4 * k, 9.4 * k); x.fillStyle = '#ff7a2e'; x.fillRect(X(-6.7), Z(-4.7) - 2.2 * k, 13.4 * k * core.hp / RULES.coreHp, 1.6 * k); }
    // buildings: square in the owner's colour, track glyph on top, dashed outline while a mission runs
    for (const b of blds) { const owner = b.tier === 3 ? b.holder : (b.active ? b.home : null), s = (b.tier === 3 ? 8 : 7) * k, cx = X(b.x), cz = Z(b.z);
      x.fillStyle = owner ? TEAM_CSS[teams[owner].color] : '#5d636e'; x.strokeStyle = '#0b0c10'; x.lineWidth = 1.5 * mdpr; x.beginPath(); x.rect(cx - s / 2, cz - s / 2, s, s); x.fill(); x.stroke();
      if (b.q) { x.setLineDash([2 * k, 1.5 * k]); x.strokeStyle = Math.sin(NOW * 8) > 0 ? '#fff' : TEAM_CSS[teams[b.q.side].color]; x.lineWidth = 1.6 * mdpr; x.strokeRect(cx - s / 2 - 1.5 * k, cz - s / 2 - 1.5 * k, s + 3 * k, s + 3 * k); x.setLineDash([]); }
      x.save(); x.translate(cx, cz); x.scale(k * s / (7 * k) * 1.1, k * s / (7 * k) * 1.1); x.strokeStyle = '#' + TRACK_HEX[b.track].toString(16).padStart(6, '0'); x.fillStyle = x.strokeStyle; x.lineWidth = .7; const pth = new Path2D(GLYPH[b.track]); if (b.track === 'elec') x.fill(pth); else x.stroke(pth); x.restore(); }
    x.fillStyle = '#3fdc5d'; for (const m of medkits) if (m.t <= 0) { x.fillRect(X(m.x) - 1.8 * k, Z(m.z) - .6 * k, 3.6 * k, 1.2 * k); x.fillRect(X(m.x) - .6 * k, Z(m.z) - 1.8 * k, 1.2 * k, 3.6 * k); }
    // our wind part: a pulsing beacon so it is easy to find
    for (const it of items) if (it.side === player.side) { const px = X(it.x), pz = Z(it.z), pr = (4 + 2.5 * (.5 + .5 * Math.sin(NOW * 5))) * k; x.strokeStyle = 'rgba(86,193,255,.9)'; x.lineWidth = 1.6 * mdpr; x.beginPath(); x.arc(px, pz, pr, 0, 7); x.stroke(); x.fillStyle = '#56c1ff'; x.strokeStyle = '#0b0c10'; x.lineWidth = 1.4 * mdpr; x.beginPath(); x.moveTo(px, pz - 3.4 * k); x.lineTo(px + 3 * k, pz); x.lineTo(px, pz + 3.4 * k); x.lineTo(px - 3 * k, pz); x.closePath(); x.fill(); x.stroke(); }
    x.fillStyle = '#e0b33a'; x.strokeStyle = '#0b0c10'; x.beginPath(); x.rect(X(reels[player.side].x) - 2 * k, Z(reels[player.side].z) - 2 * k, 4 * k, 4 * k); x.fill(); x.stroke();
    // my team: dot with a ring showing their health; a cross when down
    for (const a of (DBG.spectate ? actors : teams[player.side].members)) { const px = X(a.x), pz = Z(a.z);
      if (!a.alive) { x.strokeStyle = '#fff'; x.lineWidth = 1.6 * mdpr; x.beginPath(); x.moveTo(px - 2.6 * k, pz - 2.6 * k); x.lineTo(px + 2.6 * k, pz + 2.6 * k); x.moveTo(px + 2.6 * k, pz - 2.6 * k); x.lineTo(px - 2.6 * k, pz + 2.6 * k); x.stroke(); continue; }
      if (a === player && !DBG.spectate) { x.save(); x.translate(px, pz); x.rotate(-a.c.yaw); x.fillStyle = '#ffd21f'; x.strokeStyle = '#0b0c10'; x.lineWidth = 1.2 * mdpr; x.beginPath(); x.moveTo(0, 5 * k); x.lineTo(3.4 * k, -3.4 * k); x.lineTo(0, -1.6 * k); x.lineTo(-3.4 * k, -3.4 * k); x.closePath(); x.fill(); x.stroke(); x.restore(); continue; }
      const hk = a.hp / maxHp(a); x.fillStyle = TEAM_CSS[teams[a.side].color]; if (spec.follow === a && DBG.spectate) { x.strokeStyle = '#ffd21f'; x.lineWidth = 2 * mdpr; x.beginPath(); x.arc(px, pz, 6.5 * k, 0, 7); x.stroke(); } x.strokeStyle = '#0b0c10'; x.lineWidth = 1.2 * mdpr; x.beginPath(); x.arc(px, pz, 2.8 * k, 0, 7); x.fill(); x.stroke(); x.strokeStyle = hk > .5 ? '#3fdc5d' : hk > .25 ? '#ffd21f' : '#ff5a4d'; x.lineWidth = 1.3 * k; x.beginPath(); x.arc(px, pz, 4.3 * k, -Math.PI / 2, -Math.PI / 2 + hk * Math.PI * 2); x.stroke(); }
    // what the camera sees
    viewPoly.length = 0; for (const c of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) { mRay.setFromCamera({ x: c[0], y: c[1] }, camera); const p = mRay.ray.intersectPlane(floor0, gv); if (p) viewPoly.push([X(p.x), Z(p.z)]); }
    if (viewPoly.length === 4) { x.beginPath(); x.moveTo(viewPoly[0][0], viewPoly[0][1]); for (let i = 1; i < 4; i++) x.lineTo(viewPoly[i][0], viewPoly[i][1]); x.closePath(); x.fillStyle = 'rgba(255,210,31,' + (pan.drag ? .3 : .16) + ')'; x.fill(); x.strokeStyle = '#ffd21f'; x.lineWidth = 1.5 * mdpr; x.stroke(); }
  }

  // ---------- debug panel ----------
  const CHECKS = [['sim', 'סימולציה: בוטים בלבד, מהיר, סטטיסטיקה'], ['sound', 'צלילים'], ['spectate', 'מצב צופה: 6 בוטים, מצלמה חופשית'], ['auto', 'טייס אוטומטי (בוט משחק במקומי)'], ['clock', 'שעון רץ'], ['allies', 'בוטים בקבוצה שלי'], ['enemies', 'בוטים יריבים'], ['aggressive', 'בוטים תוקפים שחקנים'], ['god', 'בלי למות (אני)'], ['oneHit', 'הנזק שלי ×50'], ['noCd', 'יכולות בלי המתנה'], ['coreFires', 'העירייה יורה'], ['bossesAttack', 'שומרים תוקפים'], ['minimap', 'מיני-מפה'], ['cols', 'להציג התנגשויות'], ['paths', 'להציג מסלולי בוטים'], ['stats', 'FPS ונתוני ציור']];
  const pathLines = new THREE.Group(); scene.add(pathLines);
  function syncDbg() { if (DBG.sim) { DBG.spectate = true; DBG.allies = DBG.enemies = DBG.aggressive = DBG.clock = true; DBG.sound = false; } $('simBox').hidden = !DBG.sim; document.body.classList.toggle('spec', !!DBG.spectate); if (DBG.spectate && !spec.inited) { spec.inited = true; spec.x = player.x; spec.z = player.z; } $('specBar').hidden = !DBG.spectate; specLabel(); for (const [k] of CHECKS) $('chk_' + k).checked = !!DBG[k]; $('dChar').value = DBG.char; $('dColor').value = DBG.color; $('dSpeed').value = DBG.speed; $('dRes').value = DBG.res; $('dZoom').value = DBG.zoom; mini.hidden = !DBG.minimap; colGroup.visible = DBG.cols; $('stats').hidden = !DBG.stats; pathLines.visible = DBG.paths; saveDbg(); }
  for (const [k, label] of CHECKS) { const l = document.createElement('label'); l.className = 'chk'; l.innerHTML = '<input type="checkbox" id="chk_' + k + '"><span></span>'; l.lastChild.textContent = label; $('checks').appendChild(l); l.firstChild.addEventListener('change', e => { DBG[k] = e.target.checked; syncDbg(); }); }
  $('dChar').addEventListener('change', e => { DBG.char = +e.target.value; saveDbg(); setupTeams(); updateCamera(0, true); }); $('dColor').addEventListener('change', e => { DBG.color = e.target.value; saveDbg(); setupTeams(); updateCamera(0, true); });
  $('dSpeed').addEventListener('change', e => { DBG.speed = +e.target.value; saveDbg(); }); $('dRes').addEventListener('change', e => { DBG.res = +e.target.value; saveDbg(); applyRes(); }); $('dZoom').addEventListener('change', e => { DBG.zoom = +e.target.value; saveDbg(); resize(); });
  function grant(side, tiers) { for (const b of blds) { if (b.q) { cleanupQuest(b, false); b.q = null; } if (b.tier === 3) { if (tiers.indexOf(3) >= 0) b.holder = side; } else if (b.home === side && tiers.indexOf(b.tier) >= 0) { b.active = true; } } refreshLoadout('A', 'w'); refreshLoadout('B', 'w'); hudKey = ''; }
  const ACTS = [['משחק חדש', () => resetMatch()], ['לפתוח לי T1', () => grant('A', [1])], ['לפתוח לי T1+T2', () => grant('A', [1, 2])], ['לתת לי הכול', () => grant('A', [1, 2, 3])], ['לתת ליריב הכול', () => grant('B', [1, 2, 3])], ['עירייה ל-10%', () => { if (!core.dead) core.hp = RULES.coreHp * .1; }], ['להרוס עירייה', () => { if (!core.dead) hurt(core, 1e6, null, 'A'); }], ['Hot Zone שלי 90%', () => { teams.A.hz = 90; }], ['שעון ל-0:10', () => { matchT = 10; }], ['לרפא אותי', () => { player.hp = maxHp(player); }], ['להרוג אותי', () => { const g = DBG.god; DBG.god = false; hurt(player, 1e4, null, null); DBG.god = g; }], ['להרוג יריבים', () => { for (const e of teams.B.members) if (e.alive) kill(e, player); }], ['מסך מלא', () => { try { const el = document.documentElement, f = el.requestFullscreen || el.webkitRequestFullscreen; if (f) { const r = f.call(el); if (r && r.catch) r.catch(() => toast('הדפדפן הזה לא מאפשר מסך מלא מכאן')); } else toast('הדפדפן הזה לא מאפשר מסך מלא מכאן'); } catch (e) { } }], ['ניצחון', () => endMatch('A', 'דיבוג')], ['הפסד', () => endMatch('B', 'דיבוג')]];
  for (const [label, fn] of ACTS) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = fn; $('acts').appendChild(b); }
  { const tp = $('dTp'), pts = [['העירייה', 0, 16], ['הבסיס שלי', 0, 52], ['בסיס היריב', 0, -52]].concat(blds.map(b => [bName(b) + (b.home ? (b.home === 'A' ? ' (שלי)' : ' (יריב)') : ''), b.front.x, b.front.z])); pts.forEach((p, i) => { const o = document.createElement('option'); o.value = i; o.textContent = p[0]; tp.appendChild(o); });
    tp.addEventListener('change', () => { const p = pts[+tp.value]; if (!p || tp.value === '') return; if (player.carry) dropItem(player); if (player.cable) dropCable(player); const f = freeNear(p[1], p[2]); player.c.holder.position.set(f[0], 0, f[1]); player.state = 'free'; tp.value = ''; updateCamera(0, true); }); }
  const panel = $('panel'), setPanel = open => { panel.hidden = !open; $('menuBtn').setAttribute('aria-expanded', String(open)); };
  $('menuBtn').onclick = () => setPanel(panel.hidden); $('closeMenu').onclick = () => setPanel(false);

  const pin = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(128, 176, x => { x.fillStyle = '#ffd21f'; x.beginPath(); x.arc(64, 62, 54, Math.PI * .8, Math.PI * .2); x.lineTo(64, 170); x.closePath(); x.fill(); x.lineWidth = 7; x.strokeStyle = '#1d1f24'; x.stroke(); x.fillStyle = '#1d1f24'; x.fillRect(46, 46, 36, 34); x.fillRect(51, 26, 7, 22); x.fillRect(70, 26, 7, 22); x.fillRect(58, 80, 12, 24); }), depthTest: false, transparent: true })); pin.scale.set(1.5, 2.06, 1); pin.center.set(.5, 0); pin.renderOrder = 10; pin.visible = false; scene.add(pin);
  let fenceT = 0;
  function specLabel() { const f = spec.follow; $('specWho').textContent = f ? f.name + ' · ' + (teams[f.side].color === 'blue' ? 'כחול' : 'אדום') + (f.alive ? ' · ' + Math.ceil(f.hp) : ' · מת') : 'מצלמה חופשית'; }
  function specCycle(d) { const list = actors; let i = spec.follow ? list.indexOf(spec.follow) : -1; i = (i + d + list.length) % list.length; spec.follow = list[i]; specLabel(); }
  tap($('specPrev'), () => specCycle(-1)); tap($('specNext'), () => specCycle(1)); tap($('specFree'), () => { if (spec.follow) { spec.x = spec.follow.x; spec.z = spec.follow.z; } spec.follow = null; specLabel(); });
  tap($('specExit'), () => { DBG.spectate = false; syncDbg(); updateCamera(0, true); });
  window.addEventListener('keydown', e => { if (!DBG.spectate || /INPUT|SELECT/.test(e.target.tagName)) return; if (e.code === 'Tab' || e.code === 'KeyE') { specCycle(e.shiftKey ? -1 : 1); e.preventDefault(); } if (e.code === 'KeyQ') specCycle(-1); if (e.code === 'Space') { spec.follow = null; specLabel(); } });
  const sd = { id: null, x: 0, y: 0 };
  touchEl.addEventListener('pointerdown', e => { if (!DBG.spectate) return; sd.id = e.pointerId; sd.x = e.clientX; sd.y = e.clientY; }, true);
  touchEl.addEventListener('pointermove', e => { if (!DBG.spectate || e.pointerId !== sd.id) return; const k = .045 * spec.zoom; if (spec.follow) { spec.x = spec.follow.x; spec.z = spec.follow.z; spec.follow = null; specLabel(); } spec.x -= (e.clientX - sd.x) * k; spec.z -= (e.clientY - sd.y) * k; sd.x = e.clientX; sd.y = e.clientY; }, true);
  const sdEnd = e => { if (e.pointerId === sd.id) sd.id = null; }; touchEl.addEventListener('pointerup', sdEnd, true); touchEl.addEventListener('pointercancel', sdEnd, true);
  touchEl.addEventListener('wheel', e => { if (!DBG.spectate) return; spec.zoom = clamp(spec.zoom * (e.deltaY > 0 ? 1.1 : .9), .7, 3.2); e.preventDefault(); }, { passive: false });
  let specT = 0;
  // ---------- go ----------
  SFX.setListener(() => player && (DBG.spectate ? { x: camera.position.x, z: camera.position.z - CAM.z } : player));
  setupTeams(); syncDbg(); applyRes(); updateCamera(0, true);
  try { renderer.compile(scene, camera); } catch (e) { }
  $('loading').hidden = true; toast('פתחו מבנים, הרסו את העירייה וכבשו את ה-Hot Zone');
  const clock = new THREE.Clock(), frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere(new THREE.Vector3(), 1.7); let frame = 0, fpsT = 0, fpsN = 0, fps = 60, slowT = 0;
  // one fixed step of the rules (bots, movement, quests, shots, hall, clock). The simulation runs several per frame.
  function stepGame(dt, lastStep) {
    NOW += dt;
    if (DBG.spectate || DBG.sim) { player.inp.mx = player.inp.mz = 0; if (player.alive) botUpdate(player, dt); } else { playerInput(dt); if (DBG.auto && player.alive) botUpdate(player, dt); }
    for (const a of actors) { if (a === player) continue; const on = a.side === player.side ? DBG.allies : DBG.enemies; if (on) botUpdate(a, dt); else { a.inp.mx = a.inp.mz = 0; } }
    if (!matchOver) for (const a of actors) updateActor(a, dt);
    updateGuards(dt);
    if (!matchOver) { updateItems(dt); updateCables(dt); updateShots(dt); updateCore(dt); tickQuests(dt); updateMedkits(dt); if (DBG.clock && (matchT -= dt) <= 0) timeUp(); }
    if ((fenceT -= dt) <= 0) { syncFences(.5); fenceT = .5; }
  }
  // ---------- simulation: bots only, fast, and a running score sheet of every match ----------
  const sim = { list: [], cur: null, wait: 0 };
  function simNew() { sim.cur = { first: { A: {}, B: {} }, coreT: null }; }
  function simTick(rdt) {
    if (!sim.cur) simNew(); const c = sim.cur, t = RULES.match - matchT;
    for (const s of ['A', 'B']) { const n = ownedCount(s); for (const m of [1, 3, 5, 7]) if (n >= m && c.first[s][m] === undefined) c.first[s][m] = t; }
    if (core.dead && c.coreT === null) c.coreT = t;
    if (matchOver && !c.done) { c.done = true; c.t = t; c.win = matchOver.side; c.why = matchOver.why; c.k = { A: teams.A.members.reduce((x, a) => x + a.kills, 0), B: teams.B.members.reduce((x, a) => x + a.kills, 0) }; c.b = { A: ownedCount('A'), B: ownedCount('B') }; c.hz = { A: teams.A.hz | 0, B: teams.B.hz | 0 }; sim.list.push(c); sim.wait = 1.2; }
    if (c.done && (sim.wait -= rdt) <= 0) { simNew(); resetMatch(); }
    if (frame % 15) return;
    const L = sim.list, f = v => v === undefined || v === null ? '—' : (v / 60 | 0) + ':' + String(v % 60 | 0).padStart(2, '0'), avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const wa = L.filter(m => m.win === 'A').length, wb = L.filter(m => m.win === 'B').length;
    let out = 'סימולציה · משחק ' + (L.length + 1) + ' · ' + f(t) + '\n' + 'עכשיו: מבנים ' + ownedCount('A') + '–' + ownedCount('B') + ' · עירייה ' + (core.dead ? 'הרוסה' : Math.ceil(core.hp)) + ' · HZ ' + (teams.A.hz | 0) + '–' + (teams.B.hz | 0) + '\n';
    out += 'נצחונות A ' + wa + ' · B ' + wb + ' · תיקו ' + (L.length - wa - wb) + ' · אורך ממוצע ' + f(avg(L.map(m => m.t))) + ' · חיסולים ממוצע ' + avg(L.map(m => m.k.A + m.k.B)).toFixed(1) + '\n';
    out += 'מבנה ראשון ' + f(avg(L.map(m => Math.min(m.first.A[1] ?? 999, m.first.B[1] ?? 999)))) + ' · 3 מבנים ' + f(avg(L.map(m => Math.min(m.first.A[3] ?? 999, m.first.B[3] ?? 999)))) + ' · עירייה נפלה ב-' + L.filter(m => m.coreT !== null).length + '/' + L.length + '\n';
    for (const m of L.slice(-6)) out += (m.win || '=') + ' ' + f(m.t) + ' · ' + m.why + ' · חיסולים ' + m.k.A + '–' + m.k.B + ' · מבנים ' + m.b.A + '–' + m.b.B + ' · עירייה ' + f(m.coreT) + '\n';
    $('simBox').textContent = out;
  }
  function loop() {
    requestAnimationFrame(loop);
    const rdt = Math.min(.05, clock.getDelta()); frame++;
    const steps = DBG.sim ? 8 : 1, dt = DBG.sim ? .05 : rdt * DBG.speed;
    for (let k = 0; k < steps; k++) stepGame(dt, k === steps - 1);
    if (DBG.sim) simTick(rdt);
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
    for (const a of actors) { const c = a.c; sph.center.set(a.x, 1, a.z); c.visible = frustum.intersectsSphere(sph) && !(a.invisT > 0 && a.side !== player.side); c.root.visible = c.visible; a.ring.visible = a.alive && c.visible; if (c.visible || a === player || a.carry || a.cable) { c.mixer.update(dt * steps); applyTwist(c); } }
    pin.visible = !!player.cable; if (pin.visible) { const s = player.cable.b.sock; pin.position.set(s.x + s.nx * .3, 1.7 + Math.abs(Math.sin(NOW * 3.5)) * .45, s.z + s.nz * .3); }
    updateFx(dt); updateCamera(rdt);
    renderer.render(scene, camera);
    if ((frame & 1) === 0) updateHud(); if (DBG.minimap && frame % 3 === 0) drawMini();
    if (toastT > 0 && (toastT -= rdt) <= 0) $('toast').hidden = true;
    if (DBG.spectate && (specT -= rdt) <= 0) { specT = .4; specLabel(); }
    if (!matchOver && DBG.clock) { const sec = Math.ceil(matchT); if (sec !== lastSec) { if (sec === 60) SFX.say('דקה אחרונה!', true); if (sec <= 10 && sec > 0) SFX.play('tick'); if (core.dead && sec === 30) SFX.say('שלושים שניות'); lastSec = sec; } }
    if (DBG.paths && frame % 20 === 0) { while (pathLines.children.length) { const l = pathLines.children[0]; pathLines.remove(l); l.geometry.dispose(); } for (const a of actors) if (a.brain && a.brain.path && a.alive) { const pts = [V3(a.x, .3, a.z)].concat(a.brain.path.slice(a.brain.pi).map(p => V3(p.x, .3, p.z))); pathLines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: TEAM_HEX[teams[a.side].color] }))); } }
    // frame rate: shown on request, and in automatic mode the resolution steps down if the phone cannot keep up
    fpsT += rdt; fpsN++; if (fpsT >= 1) { fps = fpsN / fpsT; fpsT = 0; fpsN = 0; if (DBG.stats) $('stats').textContent = player.state + ' ' + player.x.toFixed(1) + ',' + player.z.toFixed(1) + ' ' + (player.brain && player.brain.goal ? player.brain.goal.type : '-') + ' · ' + fps.toFixed(0) + ' fps · ' + renderer.info.render.calls + ' calls · ' + (renderer.info.render.triangles / 1000 | 0) + 'k tris · ×' + renderer.getPixelRatio().toFixed(2);
      if (!+DBG.res) { slowT = fps < 42 ? slowT + 1 : 0; if (slowT >= 3 && renderer.getPixelRatio() > 1.25) { renderer.setPixelRatio(renderer.getPixelRatio() - .25); resize(); slowT = 0; } } }
  }
  loop();
}
setTimeout(() => boot().catch(e => { fail('שגיאה: ' + (e && e.message)); console.error(e); }), 30);
})();
