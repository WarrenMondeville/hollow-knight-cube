/* ============================================================
   模块 11/13：main.js
   游戏状态机（重置 / 开局 / 受伤 / 死亡 / 座椅）/ 主循环 / 启动
   ============================================================ */
(function (HK) {
'use strict';
const {
  CFG, S, rnd, clamp, $, SFX, scene,
  spawnP, burst, blockText, updHUD, showHint, flashFX, shake,
  ch, lbMaxV, invulnV, nailDmg, charmUpdate,
  updPlayer, updEnemy, updateGeos, updateParts, updateSlashes, updateBlocks,
  drawMinimap, updCamera, pollInput, togglePause
} = HK;
const { STEP, CAMZ } = CFG;

/* ---------------- 关卡重置 ---------------- */
function resetLevel(reviveBoss) {
  const enemies = HK.enemies, geos = HK.geos;
  /* 先记住 Boss 是否已被击败（用于决定要不要复活它） */
  const bossWasDead = !!enemies.find(e => e.type === 'boss' && e.deadOnce);
  /* 全部清空（含 Boss）后按当前瓦片地图重建 —— 否则每次重置都会多出一只 Boss */
  for (let i = enemies.length - 1; i >= 0; i--) { scene.remove(enemies[i].g); enemies.splice(i, 1); }
  HK.spawnList.forEach(f => f());
  /* Boss 重置 */
  const boss = enemies.find(e => e.type === 'boss');
  if (boss) {
    boss.deadOnce = bossWasDead && !reviveBoss;
    if (boss.deadOnce) {
      boss.hp = 0; boss.alive = false; boss.active = false; boss.g.visible = false;
    } else {
      boss.hp = boss.maxhp; boss.alive = true; boss.active = false; boss.state = 'sleep';
      boss.t = 0; boss.vx = 0; boss.vy = 0; boss.g.visible = true;
      boss.g.position.set(HK.bossSpawn.x, HK.bossSpawn.y, 0); boss.g.rotation.z = 0;
    }
  }
  for (let i = geos.length - 1; i >= 0; i--) { scene.remove(geos[i].m); geos.splice(i, 1); }
  S.bossActive = false;
  $('bossbar').style.display = 'none'; $('bossname').style.display = 'none';
}

/* ---------------- 重生 / 开局 ---------------- */
function respawnPlayer() {
  const player = HK.player;
  player.x = player.respawnX ?? HK.spawnPoint.x;
  player.y = player.respawnY ?? HK.spawnPoint.y;
  player.vx = 0; player.vy = 0; player.dead = false;
  player.maxMasks = 5 + (ch('heart') ? 2 : 0);
  player.masks = player.maxMasks; player.invuln = 1.5;
  player.lastSafe = { x: player.x, y: player.y };
  player.lbMax = lbMaxV(); player.lb = player.lbMax;
  player.baldurCharges = ch('baldur') ? 4 : 0; player.sinceHurt = 0;
  resetLevel(false);
  updHUD();
}
function startGame() {
  const player = HK.player;
  $('titleov').classList.add('hidden');
  $('winov').classList.add('hidden');
  $('deadov').classList.add('hidden');
  S.state = 'play'; S.paused = false; S.playT = 0; S.deaths = 0; S.kills = 0;
  player.x = HK.spawnPoint.x; player.y = HK.spawnPoint.y;
  player.vx = 0; player.vy = 0; player.dead = false;
  player.maxMasks = 5 + (ch('heart') ? 2 : 0);
  player.masks = player.maxMasks; player.soul = 0; player.geo = 0;
  player.respawnX = HK.spawnPoint.x; player.respawnY = HK.spawnPoint.y;
  player.lbMax = 0; player.lb = 0;
  player.baldurCharges = ch('baldur') ? 4 : 0; player.sinceHurt = 0;
  player.lastSafe = { x: HK.spawnPoint.x, y: HK.spawnPoint.y };
  resetLevel(true);
  for (const e of HK.enemies) e.alive = true;
  updHUD();
  blockText('GO!', 14, 6.5);
  SFX.win();
  /* 开局同时起 BGM（这里一定处于用户手势回调链上，AudioContext 能正常 resume） */
  if (HK.music) HK.music.start();
}
function die() {
  const player = HK.player;
  if (player.dead) return;
  player.dead = true; S.deaths++;
  SFX.hurt();
  burst(player.x, player.y + .8, 26, { color: 0xeaf7ff, v1: 11, tl: .8 });
  $('deadov').classList.remove('hidden');
  S.state = 'dead';
  setTimeout(() => {
    respawnPlayer();
    $('deadov').classList.add('hidden');
    S.state = 'play';
  }, 1800);
}

/* ---------------- 受伤（含护符格挡 / 反伤） ---------------- */
function hurtPlayer(srcX) {
  const player = HK.player;
  if (player.invuln > 0 || player.dead) return;
  /* 梦之盾格挡 */
  if (ch('shield') && HK.shield.hideT <= 0) {
    HK.shield.hideT = 3;
    player.invuln = invulnV(); player.focusing = false; player.focusT = 0;
    SFX.hit(); burst(player.x, player.y + .9, 8, { color: 0x9fd8ff, v1: 6, tl: .4 });
    showHint('梦之盾抵挡了伤害', 1.2);
    thornBurst();
    return;
  }
  /* 巴德尔之壳：凝聚时格挡（4 次） */
  if (player.focusing && ch('baldur') && player.baldurCharges > 0) {
    player.baldurCharges--;
    player.invuln = invulnV(); player.focusing = false; player.focusT = 0;
    SFX.hit(); burst(player.x, player.y + .9, 10, { color: 0xd8c890, v1: 7, tl: .5 });
    showHint(`巴德尔之壳抵挡了伤害（剩 ${player.baldurCharges} 次）`, 1.4);
    thornBurst();
    return;
  }
  /* 幼虫之歌：受伤回魂 */
  if (ch('grubsong')) player.soul = Math.min(99, player.soul + (ch('elegy') ? 25 : 15));
  player.sinceHurt = 0;
  /* 生命血先扣 */
  if (player.lb > 0) {
    player.lb--; updHUD();
    flashFX('hurt'); shake(.35, .35); SFX.hurt();
    S.freeze = Math.max(S.freeze, .06);
    burst(player.x, player.y + .8, 10, { color: 0x6ec6ff, v1: 7 });
    const dir = player.x < srcX ? -1 : 1;
    player.vx = dir * 9; player.vy = 8; player.lock = .3; player.invuln = invulnV();
    player.focusing = false; player.focusT = 0;
    thornBurst();
    return;
  }
  player.masks--;
  updHUD();
  flashFX('hurt'); shake(.35, .35); SFX.hurt();
  S.freeze = Math.max(S.freeze, .06);
  burst(player.x, player.y + .8, 10, { color: 0xff6b7a, v1: 7 });
  if (player.masks <= 0) { die(); return; }
  const dir = player.x < srcX ? -1 : 1;
  player.vx = dir * 9; player.vy = 8; player.lock = .3; player.invuln = invulnV();
  player.focusing = false; player.focusT = 0;
  thornBurst();
}
/* 苦痛荆棘 */
function thornBurst() {
  const player = HK.player;
  if (!ch('thorns') || player.dead) return;
  const dmg = nailDmg();
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * 6.28;
    spawnP(player.x + Math.cos(a) * .6, player.y + .8 + Math.sin(a) * .6,
      { vx: Math.cos(a) * 9, vy: Math.sin(a) * 9, g: 6, tl: .5, size: .8, color: 0xffb06a });
  }
  for (const e of HK.enemies) {
    if (!e.alive) continue;
    const cy = e.type === 'fly' ? e.y : e.y + e.h / 2;
    if (Math.hypot(e.x - player.x, cy - (player.y + .8)) < 3.2) HK.damageEnemy(e, dmg, Math.sign(e.x - player.x) || 1, false);
  }
}

/* ---------------- 座椅 ---------------- */
function tryBench() {
  const player = HK.player;
  if (S.state !== 'play') return;
  for (const b of HK.benches) {
    if (Math.abs(player.x - b.x) < 2.4 && Math.abs(player.y - b.y) < 2) {
      player.maxMasks = 5 + (ch('heart') ? 2 : 0);
      player.masks = player.maxMasks; player.soul = 99;
      player.lbMax = lbMaxV(); player.lb = player.lbMax;
      player.baldurCharges = ch('baldur') ? 4 : 0;
      player.respawnX = b.x; player.respawnY = b.y;
      updHUD(); flashFX('heal'); SFX.bench();
      showHint('已就坐 · 存档点已更新' + (player.lb > 0 ? ` · 生命血 +${player.lb}` : ''), 2.5);
      burst(player.x, player.y + 1, 14, { color: 0x9fd8ff, v1: 5, g: 4, tl: .9 });
      return;
    }
  }
}

/* ---------------- 主循环 ---------------- */
let acc = 0, last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, .1); last = now;
  const player = HK.player;
  pollInput();
  /* BGM：每秒每帧都要跑（音量随状态淡入淡出 / 必要时补 resume），与是否暂停无关 */
  if (HK.music) HK.music.update();
  if (S.editor) {
    /* 编辑模式：只跑编辑器逻辑，世界冻结 */
    if (HK.editorTick) HK.editorTick(dt);
  } else if (S.state === 'play' && !S.paused && !S.charmOpen) {
    if (S.freeze > 0) { S.freeze -= dt; }
    else {
      acc += dt;
      while (acc >= STEP) {
        S.playT += STEP;
        updPlayer(STEP);
        for (const e of HK.enemies) updEnemy(e, STEP);
        updateGeos(STEP);
        updateParts(STEP);
        updateSlashes(STEP);
        updateBlocks(STEP);
        charmUpdate(STEP);
        acc -= STEP;
      }
    }
    /* 巴德尔壳视觉 */
    HK.baldurSprite.position.set(player.x, player.y + .9, 0);
    HK.baldurSprite.material.opacity = player.focusing && player.baldurCharges > 0 ? .35 + .15 * Math.sin(S.playT * 8) : 0;
    S.hintT -= dt; if (S.hintT <= 0) $('hint').style.opacity = 0;
    S.timerAcc += dt;
    if (S.timerAcc > 1) {
      S.timerAcc = 0;
      const m = Math.floor(S.playT / 60), s = Math.floor(S.playT % 60);
      $('timer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
  }
  drawMinimap();
  /* 装饰漂浮 */
  for (const m of HK.decoMats) {
    m.position.y += Math.sin(S.playT * m.userData.s + m.userData.ph) * .003;
    m.rotation.z += m.userData.rot * dt * .4;   /* 纯 2D：绕 z 自转 */
  }
  HK.benchGlows.forEach((g, i) => { g.material.opacity = .28 + Math.sin(S.playT * 2 + i) * .1; });
  /* 编辑模式：镜头由编辑器接管（WASD 平移 / 滚轮缩放），不做跟随 */
  if (!S.editor) updCamera(S.state === 'play' && !S.paused ? dt : dt * .2);
  /* 模拟视差：把背景层贴在镜头上并按系数滚动 */
  HK.updateParallax(HK.camera);
  HK.renderer.render(scene, HK.camera);
}

/* ---------------- 启动 ---------------- */
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && S.state === 'play' && !S.paused) togglePause();
});

/* 载入关卡：本地存档优先，否则用默认地图 */
HK.buildLevel(HK.loadSavedMap() || HK.defaultTiles());
resetLevel(false);
updHUD();
/* 标题界面背景演示：待机镜头 */
HK.camera.position.set(HK.spawnPoint.x + 11, 4, CAMZ);
/* 调试钩子（控制台可用） */
window.HK = Object.assign(HK, {
  startGame, resetLevel, respawnPlayer, die, hurtPlayer, tryBench, thornBurst,
  /* 重新构建关卡并重开一局（编辑器「测试」用） */
  applyLevelAndRestart(map) {
    if (map) HK.buildLevel(map);
    $('titleov').classList.add('hidden');
    startGame();
  }
});

})(window.HK);
