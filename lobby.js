// ===== Lobby: loads the three heroes + weapons + animations, then shows the hero on a pedestal =====
(function () {
'use strict';
const $ = id => document.getElementById(id), S = window.ARENA_SHELL;
async function boot() {
  S.splash('ARENA KIDS');
  const t0 = performance.now();
  try { await S.load(window.LOBBY_CFG.files || [{ src: 'bundle_hero.js', size: window.LOBBY_CFG.heroSize }], k => S.progress(k * .82)); }
  catch (e) { S.splashError((e && e.message) || 'שגיאה בטעינה'); return; }
  if (typeof THREE === 'undefined' || !THREE.GLTFLoader) { S.splashError('ספריית התלת-ממד לא נטענה. צריך חיבור לאינטרנט, ואז לרענן.'); return; }
  const B = window.ARENA_BUNDLE, ANIMS = B.anims, A2 = {}, loader = new THREE.GLTFLoader();
  const b64 = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  const parse = k => new Promise((res, rej) => loader.parse(b64(B.files[k + '.glb']), '', g => res(g.scene), () => rej(new Error('מודל לא נטען: ' + k))));
  const CHAR_IDS = S.HEROES, WEAPON_IDS = ['stick', 'sword', 'slingshot', 'bow', 'pistol', 'jetpack'];
  const keys = CHAR_IDS.map(c => 'chars/' + c + '_blue').concat(WEAPON_IDS.map(w => 'weapons/' + w));
  try { for (let i = 0; i < keys.length; i++) { A2[keys[i]] = await parse(keys[i]); S.progress(.82 + .14 * (i + 1) / keys.length); } }
  catch (e) { S.splashError(e.message); return; }

  // ---------- renderer / scene ----------
  const canvas = $('view');
  let renderer; try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch (e) { S.splashError('הדפדפן לא הצליח להפעיל WebGL.'); return; }
  const dpr = Math.min(2, window.devicePixelRatio || 1); renderer.setPixelRatio(dpr); renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, .1, 100);
  scene.add(new THREE.HemisphereLight(0xd6e6ff, 0x26304d, .85));
  const key = new THREE.DirectionalLight(0xfff1dc, 1.35); key.position.set(2.5, 5, 4); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = key.shadow.camera.bottom = -3; key.shadow.camera.right = key.shadow.camera.top = 3; key.shadow.bias = -.0005; scene.add(key);
  const rim = new THREE.DirectionalLight(0x5aa8ff, 1.1); rim.position.set(-3, 3, -4); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffc8a0, .35); fill.position.set(-4, 1.5, 3); scene.add(fill);
  const noCast = o => o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = false; } });
  const makeBlob = () => new THREE.Group();

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

  // =====================================================================================================
  // lobby: hero on a pedestal (drag to spin, tap for an emote), profile, currencies, mode select, matchmaking
  // =====================================================================================================
  const P = S.prof;
  const META = {
    brownhair_kid: { name: 'Boy', role: 'לוחם · קרב מקרוב', weapon: 'sword', hp: 170, dmg: 36, range: 'קצר', sup: 'הסתערות' },
    purplegirl: { name: 'Girl', role: 'קשתית · צלפית', weapon: 'bow', hp: 115, dmg: 32, range: 'ארוך', sup: "ג'טפק" },
    ginger_kid: { name: 'Ginger', role: 'תומך · מרפא', weapon: 'pistol', hp: 140, dmg: 30, range: 'בינוני', sup: 'שדה ריפוי' },
  };
  // pedestal: dark drum, glowing blue rim, soft light pool under it
  const ped = new THREE.Group(); scene.add(ped);
  { const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.22, .32, 64), new THREE.MeshStandardMaterial({ color: 0x070b18, roughness: .5, metalness: .3 })); drum.position.y = -.16; drum.receiveShadow = true; ped.add(drum);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, .02, 64), new THREE.MeshStandardMaterial({ color: 0x0c1430, roughness: .85 })); top.position.y = .005; top.receiveShadow = true; ped.add(top);
    const rimR = new THREE.Mesh(new THREE.TorusGeometry(1.03, .035, 10, 80), new THREE.MeshBasicMaterial({ color: 0x5fb2ff })); rimR.rotation.x = Math.PI / 2; rimR.position.y = .01; ped.add(rimR);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.215, 1.215, .05, 64, 1, true), new THREE.MeshBasicMaterial({ color: 0x2f8bff, transparent: true, opacity: .85, side: THREE.DoubleSide })); band.position.y = -.27; ped.add(band);
    const pool = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0x3d8bff, transparent: true, opacity: .35, depthWrite: false })); pool.scale.set(4.6, 1.3, 1); pool.position.set(0, -.36, 0); ped.add(pool);
    const shade = new THREE.Mesh(new THREE.CircleGeometry(.98, 48), new THREE.ShadowMaterial({ opacity: .38 })); shade.rotation.x = -Math.PI / 2; shade.position.y = .02; shade.receiveShadow = true; ped.add(shade); }
  // sparkles drifting up around the hero
  const sparks = []; { const mat = new THREE.SpriteMaterial({ map: glowTex(), color: 0x9fd0ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < 26; i++) { const s = new THREE.Sprite(mat.clone()); s.userData = { a: Math.random() * 6.28, r: .9 + Math.random() * .7, y: Math.random() * 2.6, v: .15 + Math.random() * .3 }; s.scale.setScalar(.06 + Math.random() * .08); scene.add(s); sparks.push(s); } }

  // the three heroes, built once
  const chars = {};
  for (const id of CHAR_IDS) { const c = makeChar(A2['chars/' + id + '_blue'], id + '_blue'); styleBody(c, 1, 1.18); c.holder.visible = false; scene.add(c.holder); chars[id] = c; }
  let cur = null, yaw = .35, vel = 0, idleT = 0, emoteT = 0, popT = 0;
  function armed(c, on) { const w = META[c.id.replace('_blue', '')].weapon; if (on) attach(c, w); else detach(c, w); }
  function idle(c) { emoteT = 0; play(c, 'Idle', { fade: .25 }); }
  function showHero(id, jump) {
    if (cur) { cur.holder.visible = false; cur.mixer.stopAllAction(); cur.base = null; cur.baseName = ''; }
    cur = chars[id]; cur.holder.visible = true; armed(cur, !!P.armed); popT = .35;
    if (jump) { play(cur, 'Jump', { once: true, fade: .05 }); emoteT = cur.clips.Jump.duration * .95; } else idle(cur);
    const m = META[id]; $('hName').textContent = m.name; $('hRole').textContent = m.role;
    $('stats').innerHTML = '<div><b>' + m.hp + '</b>חיים</div><div><b>' + m.dmg + '</b>נזק</div><div><b>' + m.range + '</b>טווח</div><div><b>' + m.sup + '</b>סופר</div>';
  }
  function emote() {
    if (!cur) return; const m = META[cur.id.replace('_blue', '')];
    const name = P.armed ? WEAPONS[m.weapon].clips[0] : ['Victory', 'Punching_right', 'Victory'][Math.floor(Math.random() * 3)];
    if (!cur.clips[name]) return; play(cur, name, { once: true, fade: .15 }); emoteT = Math.min(cur.clips[name].duration, 4.2); idleT = 0; blip(660);
  }

  // ---------- portraits (for the matchmaking slots) ----------
  const portraits = {};
  { const pr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); pr.setSize(128, 128); pr.outputEncoding = THREE.sRGBEncoding; pr.setClearColor(0x000000, 0);
    const pc = new THREE.PerspectiveCamera(24, 1, .1, 20);
    for (const id of CHAR_IDS) { const c = chars[id]; c.holder.visible = true; c.holder.rotation.y = .25; play(c, 'Idle', { fade: 0 }); c.mixer.update(.4); c.root.updateMatrixWorld(true);
      const h = c.root.getObjectByName('Head'), p = new THREE.Vector3(); h.getWorldPosition(p); pc.position.set(p.x + .35, p.y + .05, p.z + 1.25); pc.lookAt(p.x, p.y - .02, p.z);
      pr.render(scene, pc); portraits[id] = pr.domElement.toDataURL(); c.holder.visible = false; c.mixer.stopAllAction(); c.base = null; c.baseName = ''; }
    pr.dispose(); }

  // ---------- camera / resize ----------
  function resize() { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; const port = w < h;
    camera.fov = port ? 40 : 28; camera.position.set(0, port ? 1.2 : 1.15, port ? 8.4 : 6.6); camera.lookAt(0, port ? .38 : .62, 0); camera.updateProjectionMatrix(); }
  window.addEventListener('resize', resize); resize();

  // ---------- spin by dragging, tap the hero for an emote ----------
  const drag = { id: null, x: 0, x0: 0, t: 0 };
  canvas.addEventListener('pointerdown', e => { drag.id = e.pointerId; drag.x = drag.x0 = e.clientX; drag.t = performance.now(); vel = 0; try { canvas.setPointerCapture(e.pointerId); } catch (_) { } unlock(); });
  canvas.addEventListener('pointermove', e => { if (e.pointerId !== drag.id) return; const dx = e.clientX - drag.x; drag.x = e.clientX; vel = dx * .011; yaw += vel; idleT = 0; });
  const endDrag = e => { if (e.pointerId !== drag.id) return; drag.id = null; if (Math.abs(e.clientX - drag.x0) < 8 && performance.now() - drag.t < 350 && e.type === 'pointerup') emote(); };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);

  // ---------- tiny UI sounds ----------
  let ac = null; function unlock() { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } } }
  function blip(f, d) { if (!ac) return; const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime; o.type = 'triangle'; o.frequency.setValueAtTime(f || 520, t); o.frequency.exponentialRampToValueAtTime((f || 520) * 1.6, t + .08); g.gain.setValueAtTime(.12, t); g.gain.exponentialRampToValueAtTime(.001, t + (d || .14)); o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + (d || .14)); }
  document.addEventListener('pointerdown', unlock, { capture: true });

  // ---------- HUD ----------
  const fmt = n => n >= 10000 ? (n / 1000).toFixed(1) + 'K' : String(n);
  function hud() { $('lvlN').textContent = P.level; $('pNameT').textContent = P.name; const nd = S.need(P.level); $('xp').firstElementChild.style.width = (P.xp / nd * 100) + '%'; $('xpT').textContent = P.xp + '/' + nd;
    $('trT').textContent = fmt(P.trophies); $('coT').textContent = fmt(P.coins); $('geT').textContent = fmt(P.gems); $('armBtn').classList.toggle('on', !!P.armed);
    const md = MODES[P.mode] || MODES.city; $('modeN').textContent = md.n; $('modeIc').style.background = md.art; $('modeIc').style.backgroundSize = 'cover'; $('modeIc').style.backgroundPosition = 'center'; }
  const BOLT = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath d='M58 4 22 56h22l-8 40 42-58H54z' fill='%23ffd21f' stroke='%23000' stroke-width='5' stroke-linejoin='round'/%3E%3C/svg%3E\")";
  const ART_TITAN = BOLT + " center/55% no-repeat, linear-gradient(125deg,#ff5a4d 0 48%,#0b0f1e 48% 52%,#2f8bff 52%)", ART_CITY = "url(splash.jpg) 50% 12%/240% no-repeat";
  $('artTitan').style.background = BOLT + " 50% 38%/46% no-repeat, radial-gradient(circle at 50% 40%,rgba(255,255,255,.25),transparent 55%), linear-gradient(125deg,#ff5a4d 0 48%,#0b0f1e 48% 52%,#2f8bff 52%)";
  const crop = (x, tint) => tint + ", url(splash.jpg) " + x + "% 30%/auto 118% no-repeat";
  $('artClassic').style.background = crop(40, 'linear-gradient(180deg,rgba(0,0,0,0) 60%,rgba(0,0,0,.2))');
  $('artCity').style.background = BOLT + " 88% 6%/26% no-repeat, " + crop(50, 'linear-gradient(180deg,rgba(255,150,40,.35),rgba(255,90,20,.25))');
  $('artTitan').style.background = BOLT + " 88% 6%/26% no-repeat, " + crop(67, 'linear-gradient(125deg,rgba(255,77,66,.45) 0 48%,rgba(47,139,255,.45) 52%)');
  const ART_KNOCK = crop(31, 'linear-gradient(180deg,rgba(110,50,220,.5),rgba(60,20,140,.45))'); $('artKnock').style.background = ART_KNOCK;
  const MODES = { classic: { n: 'City Hall', art: ART_CITY, page: 'classic.html' }, city: { n: 'City Hall Rush', art: crop(50, 'linear-gradient(rgba(255,150,40,.35),rgba(255,90,20,.25))'), page: 'city.html' }, knock: { n: 'Knockout', art: ART_KNOCK, page: 'knock.html' }, titan: { n: 'Titan Rush', art: ART_TITAN, page: 'titan.html' } };
  const MAPS = { city: 'רחובות העיר', forest: 'היער', beach: 'חוף הים', desert: 'הקניון' };
  let toastT = 0; const toast = t => { $('toast').textContent = t; $('toast').hidden = false; toastT = 1.8; };
  function idx() { return CHAR_IDS.indexOf(cur.id.replace('_blue', '')); }
  function step(d) { const i = (idx() + d + CHAR_IDS.length) % CHAR_IDS.length; P.hero = CHAR_IDS[i]; S.save(); showHero(P.hero, true); blip(440 + i * 80); }
  $('prevH').onclick = () => step(-1); $('nextH').onclick = () => step(1);
  window.addEventListener('keydown', e => { if (!$('nameModal').hidden) return; if (e.code === 'ArrowLeft') step(-1); else if (e.code === 'ArrowRight') step(1); else if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); $('play').click(); } });
  $('armBtn').onclick = () => { P.armed = !P.armed; S.save(); armed(cur, P.armed); idle(cur); hud(); blip(P.armed ? 700 : 400); };
  $('emoBtn').onclick = () => emote();
  // modals
  const open = id => { $(id).hidden = false; blip(560); }, close = id => { $(id).hidden = true; };
  for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => close(b.closest('.modal').id);
  for (const m of document.querySelectorAll('.modal')) m.addEventListener('pointerdown', e => { if (e.target === m && m.id !== 'mmModal') close(m.id); });
  $('prof').onclick = () => { $('nameIn').value = P.name; $('profStats').textContent = 'משחקים ' + P.games + ' · ניצחונות ' + P.wins + ' · חיסולים ' + P.kills; open('nameModal'); setTimeout(() => { try { $('nameIn').focus(); $('nameIn').select(); } catch (e) { } }, 60); };
  const saveName = () => { const v = $('nameIn').value.trim().slice(0, 16); if (v) { P.name = v; S.save(); hud(); toast('השם נשמר'); } close('nameModal'); };
  $('nameOk').onclick = saveName; $('nameIn').addEventListener('keydown', e => { if (e.key === 'Enter') saveName(); });
  $('modeChip').onclick = () => open('modeModal');
  $('play').onclick = () => { for (const b of document.querySelectorAll('.mode')) b.classList.toggle('sel', b.dataset.mode === P.mode); open('modeModal'); };
  for (const b of document.querySelectorAll('.mode')) b.onclick = () => { P.mode = b.dataset.mode; S.save(); hud(); close('modeModal'); matchmake(); };
  // matchmaking: the six slots fill up, then the match page opens
  let mmTimers = [];
  function matchmake() {
    $('mmMap').hidden = true; const md = MODES[P.mode] || MODES.city, mk = Object.keys(MAPS); P.nextMap = P.mode === 'titan' || P.mode === 'classic' ? 'city' : mk[Math.floor(Math.random() * mk.length)]; S.save(); $('mmTitle').textContent = md.n.toUpperCase() + ' · ' + MAPS[P.nextMap]; $('mmText').textContent = 'מחפש שחקנים… 1/6';
    const box = $('mmSlots'); box.innerHTML = ''; const order = [P.hero].concat(CHAR_IDS.filter(h => h !== P.hero)), slots = [];
    for (let i = 0; i < 6; i++) { const d = document.createElement('div'); d.className = 'slot'; d.textContent = '?'; box.appendChild(d); slots.push(d); if (i === 2) { const vs = document.createElement('div'); vs.className = 'g'; vs.style.cssText = 'align-self:center;font-size:1.4rem;color:#ffd21f'; vs.textContent = 'VS'; box.appendChild(vs); } }
    const fillSlot = (i) => { const d = slots[i], id = i < 3 ? order[i] : CHAR_IDS[i - 3]; d.className = 'slot in' + (i >= 3 ? ' foe' : ''); d.innerHTML = '<img alt="">'; d.firstChild.src = portraits[id]; $('mmText').textContent = (i < 5 ? 'מחפש שחקנים… ' : 'נמצאו שחקנים! ') + (i + 1) + '/6'; blip(500 + i * 60, .1); };
    fillSlot(0); open('mmModal'); mmTimers.forEach(clearTimeout); mmTimers = [];
    [1, 3, 4, 2, 5].forEach((i, k) => mmTimers.push(setTimeout(() => fillSlot(i), 350 + k * 280 + Math.random() * 120)));
    mmTimers.push(setTimeout(() => { $('mmText').textContent = 'יוצאים לקרב!'; const mm = $('mmMap'); mm.hidden = false; mm.innerHTML = 'המפה<b></b>'; mm.querySelector('b').textContent = P.mode === 'classic' ? 'העיר הגדולה' : MAPS[P.nextMap]; blip(880, .3); }, 2100)); mmTimers.push(setTimeout(() => S.go(md.page), 3300));
  }
  $('mmCancel').onclick = () => { mmTimers.forEach(clearTimeout); mmTimers = []; close('mmModal'); };
  // rewards from the match we just came back from
  function showReward(r) {
    $('rwTitle').textContent = r.draw ? 'תיקו' : r.win ? 'ניצחון!' : 'הפסד'; $('rwTitle').style.color = r.draw ? '#fff' : r.win ? '#7dff8e' : '#ff7a6e';
    $('rwRow').innerHTML = '<span>' + S.ICON.xp + '+' + r.xp + ' XP</span><span>' + S.ICON.trophy + (r.tr >= 0 ? '+' : '') + r.tr + '</span><span>' + S.ICON.coin + '+' + r.coins + '</span>';
    $('rwUpWrap').innerHTML = r.up ? '<div id="rwUp">רמה ' + r.level + '!</div>' : ''; open('rwModal'); if (r.up) setTimeout(() => blip(990, .4), 400);
  }
  $('rwOk').onclick = () => { close('rwModal'); emote(); };

  // ---------- go ----------
  showHero(P.hero, false); hud();
  try { renderer.compile(scene, camera); } catch (e) { }
  const wait = Math.max(0, 900 - (performance.now() - t0)); S.progress(1, 'READY');
  setTimeout(() => { S.hideSplash(); const r = S.takeLast(); if (r) setTimeout(() => showReward(r), 450); }, wait + 200);
  const clock = new THREE.Clock();
  (function loop() {
    requestAnimationFrame(loop); const dt = Math.min(.05, clock.getDelta()); NOW += dt;
    if (drag.id === null) { yaw += vel; vel *= .93; idleT += dt; if (idleT > 4 && Math.abs(vel) < .002) { const tgt = Math.round((yaw - .35) / (Math.PI * 2)) * Math.PI * 2 + .35; yaw += (tgt - yaw) * Math.min(1, dt * 1.5); } }
    if (cur) { cur.holder.rotation.y = yaw; if (emoteT > 0 && (emoteT -= dt) <= 0) idle(cur); if (popT > 0) { popT = Math.max(0, popT - dt); const k = 1 - popT / .35; cur.holder.scale.setScalar(.6 + .4 * (1 + Math.sin(k * Math.PI) * .12) * Math.min(1, k * 1.6) + (k >= 1 ? 0 : 0)); } else cur.holder.scale.setScalar(1); cur.mixer.update(dt); }
    for (const s of sparks) { const u = s.userData; u.y += u.v * dt; u.a += dt * .3; if (u.y > 2.8) { u.y = 0; u.a = Math.random() * 6.28; } s.position.set(Math.cos(u.a) * u.r, u.y, Math.sin(u.a) * u.r * .6 - .2); s.material.opacity = Math.sin(u.y / 2.8 * Math.PI) * .8; }
    if (toastT > 0 && (toastT -= dt) <= 0) $('toast').hidden = true;
    renderer.render(scene, camera);
  })();
}
boot().catch(e => { console.error(e); S.splashError('שגיאה: ' + (e && e.message)); });
})();
