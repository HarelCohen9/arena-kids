/* game page bootstrap: splash + byte progress while the model bundles load, then the game itself; lobby buttons; match rewards */
(async function () {
  'use strict';
  const S = window.ARENA_SHELL, CFG = window.GAME_CFG;
  S.splash(CFG.title);
  const css = document.createElement('style');
  css.textContent = '.arLobby{font-family:"Lilita One",Rubik,Arial,sans-serif!important;font-size:1.05rem!important;letter-spacing:.02em;background:#2f8bff!important;color:#fff!important;border:3px solid #000!important;border-radius:12px!important;padding:9px 22px!important;box-shadow:0 4px 0 #000!important;text-shadow:0 2px 0 #000}' +
    '#arPanelLobby{width:100%;margin-bottom:6px}' +
    '.arReward{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:6px 0;direction:rtl}' +
    '.arReward span{display:flex;align-items:center;gap:6px;font-family:"Lilita One",Rubik,Arial,sans-serif;font-size:1.15rem;background:rgba(0,0,0,.45);border:2px solid #000;border-radius:10px;padding:4px 12px;color:#fff;text-shadow:0 2px 0 #000;animation:arPop .4s cubic-bezier(.2,1.6,.4,1) both}' +
    '.arReward span:nth-child(2){animation-delay:.12s}.arReward span:nth-child(3){animation-delay:.24s}.arReward span:nth-child(4){animation-delay:.36s}' +
    '.arReward .up{background:#ffd21f;color:#231a00;text-shadow:none}' +
    '@keyframes arPop{from{transform:scale(.3);opacity:0}}' +
    '.arBtns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}';
  document.head.appendChild(css);
  try { await S.load(CFG.bundles, k => S.progress(k * .9)); S.progress(.92); await S.tag(CFG.game); }
  catch (e) { S.splashError((e && e.message) || 'שגיאה בטעינה'); return; }
  /* wait for the game to finish building its scene (it hides its own #loading) */
  const iv = setInterval(() => {
    const l = document.getElementById('loading'); if (!l) return;
    if (l.classList.contains('err')) { clearInterval(iv); S.splashError((document.getElementById('loadText') || {}).textContent || 'שגיאה'); return; }
    S.progress(Math.min(.99, .92 + (performance.now() % 4000) / 60000));
    if (l.hidden) { clearInterval(iv); S.progress(1, 'READY'); setTimeout(S.hideSplash, 300); }
  }, 120);
  /* back-to-lobby buttons: on the end screen and at the top of the debug panel */
  const lobby = () => S.go('index.html');
  const endBtn = document.getElementById('endBtn');
  if (endBtn) { const box = document.createElement('div'); box.className = 'arBtns'; endBtn.parentNode.insertBefore(box, endBtn); box.appendChild(endBtn); const b = document.createElement('button'); b.type = 'button'; b.className = 'arLobby'; b.textContent = 'ללובי'; b.onclick = lobby; box.appendChild(b); }
  const panel = document.getElementById('panel');
  if (panel) { const b = document.createElement('button'); b.type = 'button'; b.id = 'arPanelLobby'; b.className = 'arLobby'; b.textContent = 'יציאה ללובי'; b.onclick = lobby; panel.insertBefore(b, panel.firstChild); }
  window.showReward = r => {
    const end = document.getElementById('end'); if (!end) return; let box = end.querySelector('.arReward'); if (box) box.remove();
    box = document.createElement('div'); box.className = 'arReward';
    box.innerHTML = '<span>' + S.ICON.xp + '+' + r.xp + ' XP</span><span>' + S.ICON.trophy + (r.tr >= 0 ? '+' : '') + r.tr + '</span><span>' + S.ICON.coin + '+' + r.coins + '</span>' + (r.up ? '<span class="up">עלית לרמה ' + r.level + '!</span>' : '');
    const btns = end.querySelector('.arBtns'); end.insertBefore(box, btns || null);
  };
})();
