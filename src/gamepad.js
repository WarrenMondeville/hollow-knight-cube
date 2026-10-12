/* ============================================================
   模块 6/12：gamepad.js
   游戏手柄输入（Gamepad API · 标准布局）
   ------------------------------------------------------------
   为什么值得单独一个模块：
     浏览器对手柄**没有按键事件**（只有连接/断开事件），必须每帧轮询
     navigator.getGamepads()。这里把手柄翻译成和键鼠完全同一套语义
     （HK.held / HK.buffer + 菜单动作），所以 entities.js / combat.js
     一行都不用改 —— 换输入设备对游戏逻辑完全透明。

   两个刻意的设计：
     1. **连接状态也靠轮询判断**（手柄签名变化即视为换了一把），不依赖
        gamepadconnected 事件 —— 这样无头测试里注入假手柄也能跑通全链路。
     2. **菜单导航不改 charms.js**：给 DOM 节点加 .sel 类 + 直接派发 click。
   ============================================================ */
(function (HK) {
'use strict';
const { S, clamp, $ } = HK;

/* ---------------- 标准手柄按键编号 ---------------- */
const BTN = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, GUIDE: 16,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15
};
/* 一个动作可以绑多个物理键（索引即 BTN 的值） */
const ACT = {
  jump:    [BTN.A, BTN.UP],                 /* 与键盘 W 一致：上 = 跳 + 上劈瞄准 */
  attack:  [BTN.X, BTN.LB],
  dash:    [BTN.B, BTN.RB, BTN.RT],
  focus:   [BTN.Y, BTN.LT],                 /* 长按凝聚回血 */
  left:    [BTN.LEFT],
  right:   [BTN.RIGHT],
  up:      [BTN.UP],
  down:    [BTN.DOWN],
  confirm: [BTN.A],
  back:    [BTN.B],
  menu:    [BTN.BACK],
  pause:   [BTN.START]
};
const DZ = .3;            /* 摇杆死区：超过才当方向键用 */

/* ---------------- 手柄虚拟状态 ---------------- */
const KEYS = ['left', 'right', 'up', 'down', 'jump', 'attack', 'dash',
  'focus', 'confirm', 'back', 'menu', 'pause'];
function blank() {
  const o = { lx: 0, ly: 0, rx: 0, ry: 0 };
  for (const k of KEYS) o[k] = false;
  return o;
}
const gp = Object.assign(blank(), {
  connected: false, id: '', index: -1, mapping: '', rumbleOK: false, sig: ''
});
let padRef = null;
let cur = blank();        /* 本帧状态 */
let last = blank();       /* 上一帧状态（用于边沿检测） */
const badgeEl = $('gpbadge');
let badgeUntil = 0;

/* ---------------- 读取一把手柄 ---------------- */
function snapshot(pad) {
  const s = blank();
  if (!pad) return s;
  const bs = pad.buttons || [], ax = pad.axes || [];
  const b = [];
  for (let i = 0; i < bs.length; i++) {
    const x = bs[i];
    b[i] = !!x && (x.pressed === true || (typeof x.value === 'number' && x.value > .5));
  }
  const num = i => (typeof ax[i] === 'number' ? ax[i] : 0);
  for (const act of KEYS) {
    const list = ACT[act]; if (!list) continue;
    for (let i = 0; i < list.length; i++) if (b[list[i]]) { s[act] = true; break; }
  }
  /* 左摇杆（模拟量 → 方向，死区外才生效） */
  s.lx = num(0); s.ly = num(1); s.rx = num(2); s.ry = num(3);
  if (s.lx > DZ) s.right = true; else if (s.lx < -DZ) s.left = true;
  if (s.ly > DZ) s.down = true; else if (s.ly < -DZ) s.up = true;
  /* 摇杆上 = 跳（和十字键上、键盘 W 行为一致） */
  if (s.up && !b[BTN.UP]) s.jump = true;
  return s;
}

/* 浏览器要求音频必须由用户手势解锁；手柄按键不一定算手势，
   但试一下无害（没解锁时 au() 会返回 suspended，tone() 自己会跳过） */
function resumeAudio() {
  const a = HK.au();
  if (a && a.state === 'suspended') { try { a.resume(); } catch (_) {} }
}

/* ---------------- 连接 / 断开 ---------------- */
function showBadge(text, secs = 4) {
  if (!badgeEl) return;
  badgeEl.textContent = text;
  badgeEl.classList.add('on');
  badgeUntil = performance.now() + secs * 1000;
}
function onConnect() {
  HK.showHint(`手柄已连接 · ${gp.id.slice(0, 26)}`, 2);
  showBadge('◆ 手柄已连接');
}
function onDisconnect() {
  HK.showHint('手柄已断开', 1.6);
  showBadge('◇ 手柄已断开', 2.5);
}

/* ---------------- 震动（有就震，没有就静默） ---------------- */
function gpRumble(strong = .6, weak = .3, ms = 160) {
  const pad = padRef;
  if (!pad) return false;
  const va = pad.vibrationActuator;
  if (va && typeof va.playEffect === 'function') {
    try {
      va.playEffect('dual-rumble', {
        duration: Math.max(0, ms),
        strongMagnitude: clamp(strong, 0, 1),
        weakMagnitude: clamp(weak, 0, 1)
      });
      return true;
    } catch (_) { /* 有些实现会抛，忽略 */ }
  }
  if (typeof pad.vibrate === 'function') { try { pad.vibrate(ms); return true; } catch (_) {} }
  return false;
}

/* ---------------- 护符菜单导航 ---------------- */
let charmSel = 0, wasCharmOpen = false;
function charmCards() {
  return [].slice.call(document.querySelectorAll('#charmgrid .charm:not(.lock)'));
}
function charmApply() {
  const cards = charmCards();
  if (!cards.length) return;
  charmSel = clamp(charmSel, 0, cards.length - 1);
  cards.forEach((c, i) => c.classList.toggle('sel', i === charmSel));
  if (cards[charmSel].scrollIntoView) cards[charmSel].scrollIntoView({ block: 'nearest' });
}
function charmMove(dx, dy) {
  const cards = charmCards();
  if (!cards.length) return;
  /* 网格列数：和第一张同 offsetTop 的张数 */
  let cols = 1;
  for (let i = 1; i < cards.length; i++) { if (cards[i].offsetTop !== cards[0].offsetTop) break; cols++; }
  charmSel = clamp(charmSel + dx + dy * cols, 0, cards.length - 1);
  charmApply();
}
function charmActivate() {
  const cards = charmCards();
  if (!cards[charmSel]) return;
  cards[charmSel].click();     /* 点击会重建列表，所以下面要重新贴回选中态 */
  charmApply();
}

/* ---------------- 每帧轮询（由 input.js pollInput 调用） ---------------- */
function gpPoll() {
  /* 1. 找一把可用手柄（第一个即可） */
  const pads = (navigator.getGamepads && navigator.getGamepads()) || [];
  let pad = null;
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (p && p.connected !== false) { pad = p; break; }
  }
  const sig = pad ? `${pad.index}|${pad.id || ''}` : '';
  if (sig !== gp.sig) {
    const had = gp.connected;
    gp.sig = sig;
    gp.connected = !!pad;
    gp.index = pad ? pad.index : -1;
    gp.id = pad ? (pad.id || '游戏手柄') : '';
    gp.mapping = pad ? (pad.mapping || '') : '';
    gp.rumbleOK = !!(pad && pad.vibrationActuator && pad.vibrationActuator.playEffect);
    padRef = pad;
    if (gp.connected) onConnect(); else if (had) onDisconnect();
  } else {
    padRef = pad;
  }

  /* 2. 采集 + 刷新徽标 */
  cur = snapshot(padRef);
  for (const k of KEYS) gp[k] = cur[k];
  gp.lx = cur.lx; gp.ly = cur.ly; gp.rx = cur.rx; gp.ry = cur.ry;
  if (badgeEl && badgeEl.classList.contains('on') && performance.now() > badgeUntil) {
    badgeEl.classList.remove('on');
  }

  const hit = k => cur[k] && !last[k];      /* 本帧刚按下 */
  const menuOpen = S.charmOpen;

  /* 3. 护符菜单：方向键选择 + A 确认（菜单打开时不喂游戏输入） */
  if (menuOpen && !wasCharmOpen) { charmSel = 0; charmApply(); }
  wasCharmOpen = menuOpen;

  if (!S.editor) {
    const playing = S.state === 'play' && !S.paused && !menuOpen;

    if (menuOpen) {
      if (hit('left')) charmMove(-1, 0);
      if (hit('right')) charmMove(1, 0);
      if (hit('up')) charmMove(0, -1);
      if (hit('down')) charmMove(0, 1);
    } else if (playing) {
      /* 与键盘一致：按下瞬间写入输入缓冲（含土狼时间/输入宽容） */
      if (hit('jump')) { HK.buffer.jump = .13; resumeAudio(); }
      if (hit('dash')) HK.buffer.dash = .12;
      if (hit('attack')) HK.buffer.attack = .12;
    }

    if (hit('confirm')) {
      resumeAudio();
      if (S.state === 'title' || S.state === 'win') HK.startGame();
      else if (menuOpen) charmActivate();
      else if (S.paused) HK.togglePause();
      else if (S.state === 'play') HK.tryBench();     /* A = 互动（座椅） */
    }
    if (hit('menu')) {                                /* Back/Select = 护符 */
      if (menuOpen) HK.toggleCharmMenu();
      else if (S.state === 'play' && !S.paused) HK.toggleCharmMenu();
    }
    if (hit('pause')) {                               /* Start = 暂停 */
      if (menuOpen) HK.toggleCharmMenu();
      else if (S.paused) HK.togglePause();
      else if (S.state === 'play') HK.togglePause();
    }
    if (hit('back')) {                                /* B = 返回 */
      if (menuOpen) HK.toggleCharmMenu();
      else if (S.paused) HK.togglePause();
    }
  }

  last = cur;
}

HK.gp = gp;
Object.assign(HK, { gpPoll, gpRumble, gpBTN: BTN, gpACT: ACT, gpDZ: DZ });

})(window.HK);
