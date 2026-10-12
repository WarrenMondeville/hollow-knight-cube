/* ============================================================
   模块 7/12：hud.js
   面具 / 魂 / 吉欧 HUD · 提示条 · 全屏闪光 · 小地图
   ============================================================ */
(function (HK) {
'use strict';
const { CFG, S, $ } = HK;


/* ---------------- 面具 / 魂 / 吉欧 ---------------- */
const masksEl = $('masks');
let maskKey = '';
function rebuildMasks() {
  const player = HK.player;
  if (maskKey === `${player.maxMasks}|${player.lb}`) return;
  maskKey = `${player.maxMasks}|${player.lb}`;
  masksEl.innerHTML = '';
  const total = player.maxMasks + player.lb;
  for (let i = 0; i < total; i++) {
    const d = document.createElement('div');
    d.className = 'mask' + (i >= player.maxMasks ? ' lb' : '');
    masksEl.appendChild(d);
  }
}
function updHUD() {
  const player = HK.player;
  rebuildMasks();
  [...masksEl.children].forEach((d, i) => {
    const off = i >= player.maxMasks ? i - player.maxMasks >= player.lb : i >= player.masks;
    d.classList.toggle('off', off);
  });
  $('soulorb').style.setProperty('--p', (player.soul / 99 * 100) + '%');
  $('geo').textContent = player.geo;
}

/* ---------------- 提示 / 闪光 ---------------- */
function showHint(t, d = 2) {
  $('hint').textContent = t; $('hint').style.opacity = 1; S.hintT = d;
}
function flashFX(cls) {
  const f = $('flash');
  f.classList.remove('hurt', 'heal'); void f.offsetWidth; f.classList.add(cls);
  setTimeout(() => f.classList.remove(cls), 60);
}

/* ---------------- 小地图（任性的指南针护符） ---------------- */
const mmc = $('minimap'), mmx = mmc.getContext('2d');
function drawMinimap() {
  const show = HK.ch('compass') && S.state === 'play';
  mmc.style.display = show ? 'block' : 'none';
  if (!show) return;
  const player = HK.player, benches = HK.benches;
  const w = mmc.width, h = mmc.height;
  mmx.clearRect(0, 0, w, h);
  mmx.fillStyle = '#0a1422cc'; mmx.fillRect(0, h / 2 - 3, w, 6);
  mmx.strokeStyle = '#3a5f8a'; mmx.strokeRect(.5, h / 2 - 3.5, w - 1, 7);
  for (const b of benches) { mmx.fillStyle = '#9fc8e8'; mmx.fillRect(b.x / S.levelW * w - 1.5, h / 2 - 3, 3, 6); }
  mmx.fillStyle = '#c81f2e'; mmx.fillRect(HK.bossSpawn.x / S.levelW * w - 2, h / 2 - 3, 4, 6);
  const px = player.x / S.levelW * w;
  mmx.fillStyle = '#ffd45a';
  mmx.fillRect(px - 2, h / 2 - 5, 4, 10);
  mmx.strokeStyle = '#ffd45a'; mmx.globalAlpha = .4 + .3 * Math.sin(S.playT * 4);
  mmx.strokeRect(px - 5, h / 2 - 8, 10, 16); mmx.globalAlpha = 1;
}

Object.assign(HK, { masksEl, updHUD, showHint, flashFX, drawMinimap, mmc, mmx });

})(window.HK);
