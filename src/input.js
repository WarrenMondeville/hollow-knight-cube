/* ============================================================
   模块 5/12：input.js
   键盘 / 触屏 / 手柄输入汇总 + 摄像机跟随与震屏 + 暂停
   ------------------------------------------------------------
   三种输入在这里汇总成同一套语义：held（持续按住）/ buffer（按下瞬间，
   带输入宽容）。手柄的具体轮询在 gamepad.js，这里只负责合并。
   ============================================================ */
(function (HK) {
'use strict';
const { CFG, S, rnd, lerp, clamp, $, au } = HK;

/* ---------------- 输入状态 ---------------- */
const held = { left: false, right: false, jump: false, dash: false, attack: false, focus: false, down: false, up: false };
const buffer = { jump: 0, dash: 0, attack: 0 };
const touchHeld = { left: false, right: false, jump: false, dash: false, attack: false };
const keyMap = {
  KeyA: 'left', KeyD: 'right',
  Space: 'jump', KeyZ: 'jump', KeyK: 'jump',
  KeyW: 'jumpup', ArrowUp: 'jumpup',
  KeyX: 'attack', KeyJ: 'attack',
  KeyC: 'dash', ShiftLeft: 'dash', ShiftRight: 'dash', KeyL: 'dash',
  KeyF: 'focus', KeyH: 'focus',
  KeyS: 'down', ArrowDown: 'down',
  KeyE: 'interact'
};
const keys = new Set();

addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  /* 编辑模式：按键交给编辑器处理 */
  if (S.editor) {
    if (e.code === 'Backquote' || e.code === 'F2') HK.toggleEditor();
    return;
  }
  const a = keyMap[e.code];
  if (a === 'jump' || a === 'jumpup') buffer.jump = .13;
  if (a === 'dash') buffer.dash = .12;
  if (a === 'attack') buffer.attack = .12;
  if (a === 'interact') HK.tryBench();
  if (e.code === 'KeyP' || e.code === 'Escape') { if (S.charmOpen) HK.toggleCharmMenu(); else togglePause(); }
  if (e.code === 'Tab' || e.code === 'KeyI') HK.toggleCharmMenu();
  if (e.code === 'Backquote' || e.code === 'F2') HK.toggleEditor();
  if (e.code === 'KeyM') { S.soundOn = !S.soundOn; HK.showHint(S.soundOn ? '音效 开' : '音效 关', 1); }
  if (e.code === 'Enter') {
    const a2 = HK.au(); if (a2 && a2.state === 'suspended') a2.resume();
    if (S.state === 'title' || S.state === 'win') HK.startGame();
  }
});
addEventListener('keyup', e => keys.delete(e.code));

function pollInput() {
  /* 手柄先轮询（Gamepad API 只能靠每帧轮询），再和键鼠一起合并成 held */
  if (HK.gpPoll) HK.gpPoll();
  const gp = HK.gp || {};
  held.left = keys.has('KeyA') || touchHeld.left || !!gp.left;
  held.right = keys.has('KeyD') || touchHeld.right || !!gp.right;
  held.jump = keys.has('Space') || keys.has('KeyZ') || keys.has('KeyK') || keys.has('KeyW') || touchHeld.jump || !!gp.jump;
  held.attack = keys.has('KeyX') || keys.has('KeyJ') || touchHeld.attack || !!gp.attack;
  held.dash = keys.has('KeyC') || keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('KeyL') || touchHeld.dash || !!gp.dash;
  held.focus = keys.has('KeyF') || keys.has('KeyH') || !!gp.focus;
  held.down = keys.has('KeyS') || keys.has('ArrowDown') || !!gp.down;
  held.up = keys.has('KeyW') || keys.has('ArrowUp') || !!gp.up;
  /* 世界没在步进时（暂停 / 护符菜单 / 编辑器 / 死亡界面）清空输入缓冲，
     否则「菜单里按了跳」会一直留着，关闭菜单的瞬间凭空起跳 */
  if (S.paused || S.charmOpen || S.editor || S.state !== 'play') {
    buffer.jump = buffer.dash = buffer.attack = 0;
  }
}

/* ---------------- 触屏按钮 ---------------- */
if ('ontouchstart' in window) document.body.classList.add('touch');
document.querySelectorAll('#touch button').forEach(b => {
  const k = b.dataset.k;
  const on = e => {
    e.preventDefault(); touchHeld[k] = true; b.classList.add('active');
    if (k === 'jump') buffer.jump = .13;
    if (k === 'dash') buffer.dash = .12;
    if (k === 'attack') buffer.attack = .12;
    const a = HK.au(); if (a && a.state === 'suspended') a.resume();
  };
  const off = e => { e.preventDefault(); touchHeld[k] = false; b.classList.remove('active'); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointerleave', off);
});

/* ---------------- 摄像机 / 震屏 ---------------- */
function shake(t = .3, a = .3) {
  S.shakeT = Math.max(S.shakeT, t);
  S.shakeA = Math.max(S.shakeA, a);
  /* 手柄同步震动：震屏本来就是「有冲击」的统一入口（受伤 / 砸地 / 咆哮），
     所以挂在这里就能覆盖全部打击感，不用去改战斗逻辑 */
  if (HK.gpRumble) {
    HK.gpRumble(Math.min(1, a * 2.2), Math.min(1, a * 1.2), Math.round(Math.min(t, .4) * 1000));
  }
}
function updCamera(dt) {
  const player = HK.player, camera = HK.camera;
  /* 正交：可见尺寸来自相机视口（含 zoom），不是 fov 与距离 */
  const v = HK.viewSize();
  const halfW = v.w / 2, halfH = v.h / 2;
  const lo = Math.min(halfW, S.levelW / 2), hi = Math.max(lo, S.levelW - halfW);
  const tx = clamp(player.x + player.facing * 1.6, lo, hi);
  /* 玩家低于屏幕中线时镜头抬起一点，避免角色贴底 */
  const ty = Math.max(player.y + 2.4, halfH - 2.5);
  camera.position.x = lerp(camera.position.x, tx, 1 - Math.pow(.0008, dt));
  camera.position.y = lerp(camera.position.y, ty, 1 - Math.pow(.002, dt));
  if (S.shakeT > 0) {
    S.shakeT -= dt;
    camera.position.x += rnd(-1, 1) * S.shakeA;
    camera.position.y += rnd(-1, 1) * S.shakeA;
    if (S.shakeT <= 0) S.shakeA = 0;
  }
}

/* ---------------- 暂停 ---------------- */
function togglePause() {
  if (S.state !== 'play') return;
  S.paused = !S.paused;
  $('pauseov').classList.toggle('hidden', !S.paused);
}

Object.assign(HK, { held, buffer, touchHeld, keys, pollInput, shake, updCamera, togglePause });

})(window.HK);
