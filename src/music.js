/* ============================================================
   模块 2/13：music.js
   程序化 BGM —— 「泪水之城」风格（WebAudio 合成，零外部资源）
   ------------------------------------------------------------
   为什么是程序化：整个项目不引任何外部资源（贴图是 Canvas 画的、
   音效是振荡器合成的），BGM 同理 —— 乐谱直接写在源码里，现场合成。
   ------------------------------------------------------------
   曲子（**原创**，只是气质贴近「雨中废墟」，不是原曲旋律）：
     · 调性  D 自然小调，62 BPM（很慢），4 小节循环 ≈ 15.5s
     · 和声  Dm → Bb → F → C
     · 织体  ①雨声底噪（循环噪声 + 带通 + 极慢 LFO 摇音量）
             ②低音持续音（每小节一个根音）
             ③慢起慢落的三角波和声垫（三层微失谐叠厚度）
             ④钟琴式琶音（一小节 8 个八分音，主织体）
             ⑤稀疏的高音旋律（带揉弦）
   ------------------------------------------------------------
   调度用 WebAudio 的 lookahead 模式：setInterval(25ms) 只负责把
   未来 LOOKAHEAD 秒内的音符排进 AudioContext 的**绝对时间轴**，
   所以不受 requestAnimationFrame 抖动影响（音符不会挤在一起）。
   ============================================================ */
(function (HK) {
'use strict';
const { S } = HK;

/* ---------------- 乐谱 ---------------- */
const BPM = 62;
const BEAT = 60 / BPM;          /* 一拍 ≈ .968s */
const EIGHTH = BEAT / 2;        /* 一个八分音 */
const LOOKAHEAD = .25;          /* 提前排程窗口（秒） */
const MASTER = .5;              /* 音乐总线总音量 —— 给音效留足余量 */

/* 4 小节循环：Dm – Bb – F – C
     pad  = 和声垫的 3 个音（MIDI，声部进行平滑）
     bass = 低音根音（MIDI）
     arp  = 琶音可用的 4 个和弦音：根 / 五 / 三 / 高八度根
     mel  = [音高, 起始拍, 时长拍]，全部取本小节的和弦音 */
const PROG = [
  { pad: [50, 53, 57], bass: 38, arp: [62, 69, 65, 74], mel: [[69, 0, 1.6], [65, 2, 1.4]] },
  { pad: [46, 50, 53], bass: 34, arp: [58, 65, 62, 70], mel: [[70, 0, 1.8], [74, 2.2, 1.2]] },
  { pad: [48, 53, 57], bass: 41, arp: [65, 72, 69, 77], mel: [[69, 0, 1.6], [72, 2, 1.4]] },
  { pad: [48, 52, 55], bass: 36, arp: [60, 67, 64, 72], mel: [[67, 0, 2.6]] }
];
/* 一小节 8 个八分音，每个取 arp 里的第几个音 —— 先上行再回落，像钟声 */
const ARP_PAT = [0, 1, 2, 3, 1, 2, 3, 2];

const hz = m => 440 * Math.pow(2, (m - 69) / 12);

/* ---------------- 音频图（懒建） ---------------- */
let graph = null;
function au() { return HK.au(); }

function build(a) {
  /* 音乐总线：gain 从 0 开始，由 update() 平滑推到目标音量（淡入淡出全靠它） */
  const bus = a.createGain(); bus.gain.value = 0;
  /* 一层低通把整体推"远"一点 —— 废墟的空旷感，也让合成声不那么刺 */
  const tone = a.createBiquadFilter();
  tone.type = 'lowpass'; tone.frequency.value = 3200; tone.Q.value = .4;
  tone.connect(bus); bus.connect(a.destination);

  /* ① 雨声：4 秒循环噪声 → 带通，叠一个极慢的正弦 LFO 摇音量做"雨势" */
  const len = Math.floor(a.sampleRate * 4);
  const buf = a.createBuffer(1, len, a.sampleRate), ch = buf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    lp = lp * .86 + w * .14;                       /* 掺一点低频加权 → 更像雨，不像嘶嘶声 */
    ch[i] = (w * .35 + lp * 1.6) * .5;
  }
  const rain = a.createBufferSource(); rain.buffer = buf; rain.loop = true;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = .55;
  const rg = a.createGain(); rg.gain.value = .055;
  const lfo = a.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = .07;
  const lfoG = a.createGain(); lfoG.gain.value = .02;
  lfo.connect(lfoG); lfoG.connect(rg.gain);
  rain.connect(bp); bp.connect(rg); rg.connect(tone);
  rain.start(); lfo.start();

  return { ctx: a, bus, tone, rg };
}
function ensure() {
  const a = au(); if (!a) return null;
  if (!graph) graph = build(a);
  return graph;
}

/* ---------------- 音色（全部现场合成） ---------------- */

/* 钟琴：基音 + 两个泛音，极快起音 + 长衰减 —— 琶音用 */
function bell(t, midi, vol, dur) {
  const a = graph.ctx, f = hz(midi);
  const g = a.createGain();
  g.gain.setValueAtTime(.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + .012);              /* 敲击感 */
  g.gain.exponentialRampToValueAtTime(vol * .3, t + .3);      /* 先掉一半 */
  g.gain.exponentialRampToValueAtTime(.0001, t + dur);        /* 再长尾衰减 */
  g.connect(graph.tone);
  const parts = [[1, 0, 1], [2.01, 0, .22], [3.03, 0, .07]];  /* [倍频, detune, 音量] */
  for (const [mul, det, v] of parts) {
    const o = a.createOscillator(); o.type = 'sine';
    o.frequency.value = f * mul; o.detune.value = det;
    const pg = a.createGain(); pg.gain.value = v;
    o.connect(pg); pg.connect(g);
    o.start(t); o.stop(t + dur + .05);
  }
}
/* 和声垫：慢起慢落，每个音三层微失谐三角波叠出厚度 */
function pad(t, midis, dur, vol) {
  const a = graph.ctx;
  const layers = [[1, 0, 1], [1, 3.5, .6], [.5, -2, .35]];
  for (const m of midis) {
    for (const [mul, det, v] of layers) {
      const o = a.createOscillator(); o.type = 'triangle';
      o.frequency.value = hz(m) * mul; o.detune.value = det;
      const g = a.createGain();
      g.gain.setValueAtTime(.0001, t);
      g.gain.linearRampToValueAtTime(vol * v, t + dur * .28);   /* 慢起 */
      g.gain.setValueAtTime(vol * v, t + dur * .62);
      g.gain.linearRampToValueAtTime(.0001, t + dur);           /* 慢落 */
      o.connect(g); g.connect(graph.tone);
      o.start(t); o.stop(t + dur + .05);
    }
  }
}
/* 低音：正弦 + 微失谐三角波泛音，几乎整小节铺满 */
function bass(t, midi, dur, vol) {
  const a = graph.ctx, f = hz(midi);
  const o = a.createOscillator(); o.type = 'sine'; o.frequency.value = f;
  const o2 = a.createOscillator(); o2.type = 'triangle';
  o2.frequency.value = f * 2; o2.detune.value = -6;
  const g = a.createGain();
  g.gain.setValueAtTime(.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + .35);
  g.gain.setValueAtTime(vol, t + dur * .6);
  g.gain.linearRampToValueAtTime(.0001, t + dur);
  const g2 = a.createGain(); g2.gain.value = .25;
  o.connect(g); o2.connect(g2); g2.connect(g);
  g.connect(graph.tone);
  o.start(t); o2.start(t); o.stop(t + dur + .05); o2.stop(t + dur + .05);
}
/* 旋律：带揉弦的软正弦，像远处拉长的弦/人声 */
function lead(t, midi, dur, vol) {
  const a = graph.ctx, f = hz(midi);
  const o = a.createOscillator(); o.type = 'sine'; o.frequency.value = f;
  const vib = a.createOscillator(); vib.type = 'sine'; vib.frequency.value = 4.6;
  const vg = a.createGain(); vg.gain.value = f * .006;          /* 揉弦深度 */
  vib.connect(vg); vg.connect(o.frequency);
  const g = a.createGain();
  g.gain.setValueAtTime(.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + Math.min(.5, dur * .35));
  g.gain.setValueAtTime(vol, t + dur * .7);
  g.gain.linearRampToValueAtTime(.0001, t + dur);
  o.connect(g); g.connect(graph.tone);
  o.start(t); vib.start(t); o.stop(t + dur + .05); vib.stop(t + dur + .05);
}

/* ---------------- 时间轴（**纯函数**，不碰音频） ---------------- */
/* 第 i 个八分音的绝对时间 = t0 + i × EIGHTH（t0 = 第 0 个八分音的绝对时间）。
   把 [iFrom, iTo) 区间内该响的音符全部算出来。
   刻意做成纯计算：排程逻辑可以脱离音频单独验证（见 test-music.js 用假时钟驱动）。 */
function events(iFrom, iTo, t0) {
  const out = [];
  for (let i = iFrom; i < iTo; i++) {
    const t = t0 + i * EIGHTH;
    const bar = Math.floor(i / 8) % PROG.length, p = i % 8, c = PROG[bar];
    if (p === 0) {                                  /* 每小节头：换和弦 → 垫 + 低音 + 旋律 */
      out.push({ t: t + .02, kind: 'pad', midis: c.pad, dur: EIGHTH * 8 * 1.1, vol: .08 });
      out.push({ t, kind: 'bass', midi: c.bass, dur: EIGHTH * 8 * .95, vol: .16 });
      for (const m of c.mel)
        out.push({ t: t + m[1] * BEAT, kind: 'lead', midi: m[0], dur: Math.max(.9, m[2] * BEAT * 1.25), vol: .075 });
    }
    out.push({ t, kind: 'bell', midi: c.arp[ARP_PAT[p]], dur: 1.5, vol: p % 4 === 0 ? .1 : .062 });
  }
  return out.sort((a, b) => a.t - b.t);          /* 按时间排好，调用方直接顺序播放 */
}
/* 把事件丢给对应的合成音色 */
function voice(e) {
  if (e.kind === 'pad') pad(e.t, e.midis, e.dur, e.vol);
  else if (e.kind === 'bass') bass(e.t, e.midi, e.dur, e.vol);
  else if (e.kind === 'lead') lead(e.t, e.midi, e.dur, e.vol);
  else bell(e.t, e.midi, e.vol, e.dur);
}

/* ---------------- 排程 ---------------- */
let t0 = 0;           /* idx = 0 那一刻的绝对音频时间（重开时重设） */
let idx = 0;          /* 全局八分音计数（idx/8 = 小节号） */
let playing = false;
let schedCount = 0;   /* 累计排出的音符数（调试 / 测试用） */

/* 常驻调度器：只有 playing 且 ctx 在跑时才真正排音符 */
function tick() {
  if (!playing || !graph) return;
  const a = graph.ctx;
  if (a.state !== 'running') return;
  const now = a.currentTime;
  /* 切标签页回来时音频时钟会突然前进一大截 —— 别把欠账一次性补上（会"炸"一下），
     直接把时间轴对齐到眼前，接着往下走 */
  if (t0 + idx * EIGHTH < now - .25) t0 = now + .05 - idx * EIGHTH;
  const iTo = Math.ceil((now + LOOKAHEAD - t0) / EIGHTH);
  if (iTo <= idx) return;
  for (const e of events(idx, iTo, t0)) voice(e);
  schedCount += iTo - idx;
  idx = iTo;
}

/* ---------------- 音量 ---------------- */
function targetVol() {
  if (!playing) return 0;
  if (!S.soundOn || !S.musicOn) return 0;
  if (S.editor) return .35;          /* 编辑器里压低，留点氛围就行 */
  if (S.paused || S.state === 'dead') return .5;
  return 1;
}
let nextResume = 0;
function update() {
  if (!graph) return;
  const a = graph.ctx;
  /* 长时间切走页面后 AudioContext 会被浏览器挂起，回来时补一次 resume */
  if (playing && a.state === 'suspended' && performance.now() > nextResume) {
    nextResume = performance.now() + 1500;
    a.resume().catch(() => {});
  }
  /* 淡入淡出 / 状态压低全靠这条平滑增益 */
  graph.bus.gain.setTargetAtTime(targetVol() * MASTER, a.currentTime, .35);
}

/* ---------------- 对外接口 ---------------- */
HK.music = {
  score: { BPM, BEAT, EIGHTH, PROG, ARP_PAT, MASTER, LOOKAHEAD },
  noteHz: hz,
  events,                       /* 纯时间轴（测试可脱离音频直接查） */
  start() {
    const a = au(); if (!a) return false;
    ensure();
    if (a.state === 'suspended') a.resume().catch(() => {});
    if (!playing) { playing = true; idx = 0; schedCount = 0; t0 = a.currentTime + .12; tick(); }
    update();
    return true;
  },
  stop() { playing = false; update(); },
  toggle() { S.musicOn = !S.musicOn; update(); return S.musicOn; },
  isPlaying: () => playing,
  update,
  /* 调试 / 测试钩子 */
  debug: () => ({
    playing, idx, sched: schedCount,
    t0: Number(t0.toFixed(4)),
    next: Number((t0 + idx * EIGHTH).toFixed(4)),
    ctxState: graph ? graph.ctx.state : 'none',
    gain: graph ? Number(graph.bus.gain.value.toFixed(4)) : -1,
    note: graph ? targetVol() * MASTER : 0
  })
};

setInterval(tick, 25);

})(window.HK);
