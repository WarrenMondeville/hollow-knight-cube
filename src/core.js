/* ============================================================
   空洞骑士 · CUBE 横版复刻  (three.js)
   ---- 模块 1/13：core.js  基础工具 / 常量 / 音效 / 共享状态 ----
   ------------------------------------------------------------
   **纯 2D**：正交相机 + 平面网格 + 无光照材质，背景视差是手动模拟的
   （正交下没有真实视差），详见 scene.js。
   ------------------------------------------------------------
   该项目使用经典 <script> 拆分模块：所有模块通过全局命名空间
   window.HK 通信（不引入构建步骤，file:// 双击即可运行）。
   模块加载顺序见 index.html（core → music → scene → world → entities
   → input → gamepad → hud → charms → combat → main → tmx → editor）。
   ------------------------------------------------------------
   注意：用 Object.assign(HK, {...}) 暴露 getter/setter 会被拍平成
   静态数据属性（快照）。需要实时读写的字段请用
   Object.defineProperty(HK, 'x', { get, set })（见 world.js 的 tiles）。
   ============================================================ */
window.HK = window.HK || {};
(function (HK) {
'use strict';

/* ---------------- 常量 ---------------- */
const CFG = {
  STEP: 1 / 60,
  GRAV: 62, MAXFALL: 26,
  RUN: 10.5, JUMPV: 19.5, JUMP2V: 17,
  DASHV: 26, DASHT: 0.16, DASHCD: 0.45,
  LEVELW: 276,
  VIEWH: 14,          // 可视高度（世界单位）—— 纯 2D 正交相机
  CAMZ: 30            // 相机 z（正交下只影响裁剪范围，不影响缩放）
};

/* ---------------- 共享可变状态（跨模块读写） ---------------- */
const S = {
  state: 'title',      // title | play | dead | win
  paused: false,
  charmOpen: false,    // 护符菜单是否打开（打开时暂停世界）
  editor: false,       // 关卡编辑器是否打开（打开时世界冻结）
  levelDirty: false,   // 瓦片被修改、待重建地形
  levelW: 276,         // 关卡实际宽度（随瓦片地图自适应，导入 .tmx 后会变）
  freeze: 0,           // 命中定格
  playT: 0,            // 游戏内计时
  deaths: 0, kills: 0,
  bossActive: false,
  hintT: 0,
  shakeT: 0, shakeA: 0,
  timerAcc: 0,
  soundOn: true,       // 音效开关（M）
  musicOn: true        // BGM 开关（N）—— 见 music.js
};

/* ---------------- 纯工具 ---------------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const $ = id => document.getElementById(id);

/* ---------------- 音效（WebAudio 合成，无外部资源） ---------------- */
let actx = null;
function au() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} }
  return actx;
}
function tone(f, d, type = 'square', f2 = 80, vol = .04, delay = 0) {
  const a = au(); if (!S.soundOn || !a || a.state !== 'running') return;
  try {
    const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + d);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + d);
  } catch (_) {}
}
function noise(d, vol = .05, hp = 900, delay = 0) {
  const a = au(); if (!S.soundOn || !a || a.state !== 'running') return;
  try {
    const t = a.currentTime + delay, n = Math.floor(a.sampleRate * d);
    const buf = a.createBuffer(1, n, a.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = a.createBufferSource(); s.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    const g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    s.connect(f); f.connect(g); g.connect(a.destination); s.start(t);
  } catch (_) {}
}
const SFX = {
  jump: () => tone(300, .12, 'square', 620, .03),
  jump2: () => tone(380, .12, 'square', 760, .03),
  dash: () => noise(.14, .06, 1400),
  slash: () => { noise(.09, .05, 2400); tone(900, .06, 'sawtooth', 300, .02); },
  hit: () => { tone(220, .08, 'square', 60, .05); noise(.06, .04, 600); },
  kill: () => { noise(.2, .06, 300); tone(160, .2, 'sawtooth', 40, .04); },
  hurt: () => { tone(180, .3, 'sawtooth', 40, .06); noise(.18, .05, 300); },
  land: () => tone(120, .06, 'square', 60, .025),
  geo: () => { tone(1150, .07, 'sine', 1500, .035); tone(1720, .09, 'sine', 1720, .02, .05); },
  heal: () => { tone(520, .25, 'sine', 1040, .04); tone(780, .3, 'sine', 1560, .03, .1); },
  bench: () => { tone(440, .15, 'sine', 880, .035); tone(660, .2, 'sine', 1320, .03, .12); },
  focus: () => tone(240, .5, 'sine', 480, .02),
  roar: () => { tone(90, .7, 'sawtooth', 35, .08); noise(.5, .06, 150); },
  slam: () => { tone(70, .4, 'square', 30, .09); noise(.3, .08, 120); },
  win: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, .3, 'sine', f, .05, i * .13)); }
};

Object.assign(HK, { CFG, S, clamp, lerp, rnd, $, SFX, au, tone, noise });

})(window.HK);
