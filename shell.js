/* ARENA shell: player profile (name, level, xp, trophies, coins), progress-aware asset loader, splash screen, navigation.
   Shared by the lobby (index.html) and the two game pages (titan.html, city.html). */
(function () {
  'use strict';
  const KEY = 'arena5.';
  const get = k => { try { const v = localStorage.getItem(KEY + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) { } };
  const HEROES = ['brownhair_kid', 'purplegirl', 'ginger_kid'];
  const prof = Object.assign({ name: 'שחקן ' + (1000 + Math.floor(Math.random() * 9000)), level: 1, xp: 0, trophies: 0, coins: 120, gems: 10, hero: 'brownhair_kid', mode: 'city', nextMap: '', games: 0, wins: 0, kills: 0, best: {} }, get('profile') || {});
  if (HEROES.indexOf(prof.hero) < 0) prof.hero = HEROES[0];
  const save = () => set('profile', prof);
  const need = l => 100 + 35 * (l - 1);
  function addXp(n) { prof.xp += n; let up = 0; while (prof.xp >= need(prof.level)) { prof.xp -= need(prof.level); prof.level++; up++; prof.coins += 50; } return up; }
  let reported = false;
  /* called by a game when a match ends: {mode, win, draw, kills, dmg} */
  function result(o) {
    if (reported) return null; reported = true;
    const kills = o.kills || 0, xp = (o.win ? 45 : o.draw ? 28 : 20) + 6 * kills, tr = o.win ? 8 : o.draw ? 0 : -4, coins = (o.win ? 30 : 12) + 2 * kills;
    const lvl0 = prof.level; prof.games++; if (o.win) prof.wins++; prof.kills += kills; prof.trophies = Math.max(0, prof.trophies + tr); prof.coins += coins;
    const hb = prof.best[o.hero || prof.hero] = prof.best[o.hero || prof.hero] || 0; prof.best[o.hero || prof.hero] = Math.max(hb, kills);
    const up = addXp(xp); save();
    const r = { mode: o.mode, win: !!o.win, draw: !!o.draw, kills, xp, tr, coins, up, from: lvl0, level: prof.level, t: Date.now() }; set('last', r); return r;
  }
  function again() { reported = false; }
  function takeLast() { const r = get('last'); set('last', null); return r && Date.now() - r.t < 30 * 60e3 ? r : null; }

  /* splash: the cover art with a LOADING bar at the bottom */
  let sp = null;
  function splash(title) {
    if (sp) return sp;
    const st = document.createElement('style');
    st.textContent = '#arSplash{position:fixed;inset:0;z-index:50;background:#0d1220 url(splash_tiny.jpg) center/cover;overflow:hidden;transition:opacity .45s;font-family:"Lilita One","Rubik",Arial,sans-serif;direction:ltr}' +
      '#arSplash .img{position:absolute;inset:0;background:url(splash.jpg) center 30%/cover no-repeat}' +
      '#arSplash .shade{position:absolute;inset:auto 0 0 0;height:42%;background:linear-gradient(180deg,transparent,rgba(5,8,18,.88) 70%)}' +
      '#arSplash .logo{position:absolute;top:max(14px,env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);font-size:clamp(26px,6vw,58px);color:#ffd21f;letter-spacing:.03em;white-space:nowrap;text-shadow:0 4px 0 #000,0 0 18px rgba(0,0,0,.6);-webkit-text-stroke:2px #1a1205}' +
      '#arSplash .bot{position:absolute;left:max(18px,env(safe-area-inset-left,0px));right:max(18px,env(safe-area-inset-right,0px));bottom:max(16px,env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:8px;align-items:center}' +
      '#arSplash .tip{font-family:Rubik,Arial,sans-serif;font-weight:500;font-size:13px;color:#dfe6f3;direction:rtl;text-align:center;text-shadow:0 2px 0 #000;max-width:640px;min-height:1.3em}' +
      '#arSplash .row{display:flex;align-items:center;gap:12px;width:min(720px,100%)}' +
      '#arSplash .lbl{font-size:22px;color:#fff;text-shadow:0 3px 0 #000;-webkit-text-stroke:1px #000;min-width:7.2em}' +
      '#arSplash .bar{flex:1;height:22px;border-radius:12px;background:#0a0d16;border:3px solid #000;box-shadow:0 3px 0 rgba(0,0,0,.6),inset 0 2px 4px rgba(0,0,0,.6);overflow:hidden;position:relative}' +
      '#arSplash .bar i{position:absolute;inset:0 auto 0 0;width:0;border-radius:8px;background:linear-gradient(180deg,#fff27a,#ffd21f 45%,#f0a400);box-shadow:inset 0 -3px 0 rgba(0,0,0,.18);transition:width .2s}' +
      '#arSplash .bar i::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(115deg,rgba(255,255,255,.28) 0 10px,transparent 10px 22px);animation:arSlide 1s linear infinite}' +
      '@keyframes arSlide{from{background-position:0 0}to{background-position:44px 0}}' +
      '#arSplash .pct{font-size:22px;color:#ffd21f;text-shadow:0 3px 0 #000;-webkit-text-stroke:1px #000;min-width:3.2em;text-align:right}' +
      '#arSplash.err .lbl{color:#ff6a5e}#arSplash.gone{opacity:0;pointer-events:none}';
    document.head.appendChild(st);
    sp = document.createElement('div'); sp.id = 'arSplash';
    sp.innerHTML = '<div class="img"></div><div class="shade"></div><div class="logo"></div><div class="bot"><div class="tip"></div><div class="row"><div class="lbl">LOADING</div><div class="bar"><i></i></div><div class="pct">0%</div></div></div>';
    sp.querySelector('.logo').textContent = title || 'ARENA KIDS';
    const tips = ['טיפ: נגיעה קצרה בג׳ויסטיק הימני יורה אוטומטית על האויב הקרוב', 'טיפ: הסופר נטען כשפוגעים — שמרו אותו לרגע הנכון', 'טיפ: מחזיק הסוללה איטי — הגנו עליו!', 'טיפ: בעמוד שיש בו שחקנים משתי הקבוצות, אף אחד לא כובש', 'טיפ: בבסיס החיים חוזרים מהר', 'טיפ: Girl יכולה לעוף מעל קירות עם הג׳טפק'];
    sp.querySelector('.tip').textContent = tips[Math.floor(Math.random() * tips.length)];
    document.body.appendChild(sp); return sp;
  }
  let shown = 0;
  function progress(k, label) { splash(); k = Math.max(0, Math.min(1, k)); shown = Math.max(shown, k); sp.querySelector('.bar i').style.width = (shown * 100).toFixed(1) + '%'; sp.querySelector('.pct').textContent = Math.floor(shown * 100) + '%'; if (label) sp.querySelector('.lbl').textContent = label; }
  function hideSplash() { if (!sp) return; sp.classList.add('gone'); setTimeout(() => { if (sp && sp.parentNode) sp.parentNode.removeChild(sp); sp = null; }, 500); }
  function splashError(msg) { splash(); sp.classList.add('err'); sp.querySelector('.lbl').textContent = 'ERROR'; sp.querySelector('.tip').textContent = msg; }

  /* load scripts one after another with a real byte progress (sizes are known at build time) */
  const tag = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('לא נטען: ' + src)); document.body.appendChild(s); });
  async function load(list, onp) {
    const total = list.reduce((s, f) => s + (f.size || 1), 0); let got = 0;
    for (const f of list) {
      let text = null;
      try {
        const r = await fetch(f.src); if (!r.ok) throw new Error('http ' + r.status);
        if (r.body && r.body.getReader) { const rd = r.body.getReader(), parts = []; let n = 0; for (;;) { const c = await rd.read(); if (c.done) break; parts.push(c.value); n += c.value.length; onp((got + Math.min(n, f.size)) / total); } text = await new Blob(parts).text(); }
        else text = await r.text();
      } catch (e) { text = null; }
      let ok = false;
      if (text) { const flag = '__ar_' + f.src.replace(/\W/g, '_'); try { const s = document.createElement('script'); s.textContent = text + '\n;window.' + flag + '=1;'; document.body.appendChild(s); ok = !!window[flag]; } catch (e) { ok = false; } }
      if (!ok) await tag(f.src);
      got += f.size || 1; onp(got / total);
    }
  }
  function go(page) { try { document.body.style.transition = 'opacity .25s'; document.body.style.opacity = '0'; } catch (e) { } setTimeout(() => { location.href = page; }, 220); }

  const ICON = { xp: '<svg viewBox="0 0 32 32" width="22" height="22"><path d="M16 3l4 8.5 9 1.2-6.6 6.3 1.7 9L16 23.6 7.9 28l1.7-9L3 12.7l9-1.2z" fill="#38b6ff" stroke="#000" stroke-width="2.2" stroke-linejoin="round"/></svg>',
    trophy: '<svg viewBox="0 0 32 32" width="22" height="22"><path d="M9 4h14v6a7 7 0 0 1-14 0z" fill="#ffd21f" stroke="#000" stroke-width="2"/><path d="M9 6H4c0 5 3 7 6 7M23 6h5c0 5-3 7-6 7" fill="none" stroke="#000" stroke-width="2"/><path d="M14 17h4v5h3v4H11v-4h3z" fill="#f0a400" stroke="#000" stroke-width="2"/></svg>',
    coin: '<svg viewBox="0 0 32 32" width="22" height="22"><circle cx="16" cy="16" r="12" fill="#ffc21f" stroke="#000" stroke-width="2.5"/><circle cx="16" cy="16" r="7.5" fill="none" stroke="#c98a00" stroke-width="2"/><path d="M16 11v10" stroke="#c98a00" stroke-width="2.5"/></svg>' };

  /* landscape only: on a phone held upright, ask to turn it */
  (function () { const st = document.createElement('style'); st.textContent = '#arRotate{position:fixed;inset:0;z-index:60;display:none;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#0b1020;color:#fff;font-family:"Lilita One",Rubik,Arial,sans-serif;text-align:center;padding:24px}#arRotate svg{width:96px;height:96px;animation:arRot 1.6s ease-in-out infinite}#arRotate b{font-size:26px;color:#ffd21f;text-shadow:0 3px 0 #000}#arRotate span{font-family:Rubik,Arial,sans-serif;font-size:15px;color:#c9d4ea;direction:rtl}@keyframes arRot{0%,20%{transform:rotate(0)}60%,100%{transform:rotate(-90deg)}}@media (orientation:portrait) and (pointer:coarse){#arRotate{display:flex}}';
    document.head.appendChild(st); const d = document.createElement('div'); d.id = 'arRotate'; d.innerHTML = '<svg viewBox="0 0 64 64"><rect x="18" y="6" width="28" height="52" rx="5" fill="none" stroke="#ffd21f" stroke-width="4"/><circle cx="32" cy="50" r="2.5" fill="#ffd21f"/></svg><b>ROTATE</b><span>סובבו את הטלפון לרוחב כדי לשחק</span><button type="button" id="arRotGo" style="margin-top:6px;font:inherit;font-size:14px;color:#c9d4ea;background:none;border:1px solid #3b4a74;border-radius:10px;padding:6px 14px">להמשיך בכל זאת</button>'; d.querySelector('#arRotGo').onclick = () => { d.remove(); try { sessionStorage.setItem('arRotSkip', '1'); } catch (e) { } };
    try { if (sessionStorage.getItem('arRotSkip')) return; } catch (e) { }
    const add = () => document.body.appendChild(d); if (document.body) add(); else document.addEventListener('DOMContentLoaded', add); })();
  /* own website (not inside claude.ai): offline cache + true full screen */
  const own = !/claude\.ai|claudeusercontent|anthropic/.test(location.host) && location.protocol === 'https:';
  if (own && 'serviceWorker' in navigator) { try { navigator.serviceWorker.register('sw.js'); } catch (e) { } }
  if (own) document.addEventListener('pointerdown', function fsOnce() { document.removeEventListener('pointerdown', fsOnce, true); const standalone = (window.matchMedia && matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches) || navigator.standalone; if (standalone) return;
    try { const el = document.documentElement, f = el.requestFullscreen || el.webkitRequestFullscreen; if (f) { const r = f.call(el); const lock = () => { try { const o = screen.orientation; if (o && o.lock) o.lock('landscape').catch(() => { }); } catch (e) { } }; if (r && r.then) r.then(lock).catch(() => { }); else lock(); } } catch (e) { } }, true);
  window.ARENA_SHELL = { ICON, prof, save, need, addXp, result, again, takeLast, HEROES, splash, progress, hideSplash, splashError, load, tag, go };
})();
