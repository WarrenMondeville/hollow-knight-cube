/* ============================================================
   模块 10/13：combat.js
   攻击判定（四向骨钉 + 统一伤害入口）/ 敌人 AI / 玩家控制与更新
   ============================================================ */
(function (HK) {
'use strict';
const {
  CFG, S, rnd, lerp, clamp, $, SFX, scene,
  spawnP, burst, blockText, dropGeo, spawnSlash, ghost, hitRect, overlap, moveAndCollide,
  held, buffer, shake, updHUD, showHint,
  ch, nailDmg, kbMult, geoMult, atkCDv, dashCDv, runV, soulPerHit, isFullHP, spawnBeam, onFocusComplete
} = HK;
const { GRAV, MAXFALL, RUN, JUMPV, JUMP2V, DASHV, DASHT } = CFG;   // 关卡宽度用 S.levelW（可随 .tmx 变化）

/* ---------------- 攻击判定 ---------------- */
/* 骨钉后坐力：**命中敌人**时才把整个人往反方向推一下（空挥没有反馈）。
   空中明显（滞空久、衰减慢），地面只是「顿一下」。
   稳定之体护符（steady）把它彻底取消。
   数值是按位移调的：地面 ≈0.45 世界单位，空中 ≈1.9 世界单位。 */
const RECOIL_GROUND = 5.5, RECOIL_AIR = 8.5;

function doAttack() {
  const player = HK.player;
  player.atkCD = atkCDv(); player.atkT = .13;
  player.atkDir = held.up ? 'up' : (held.down && !player.grounded ? 'down' : 'side');
  player.atkHit = new Set();
  player.atkRecoil = false;          /* 这一次挥砍是否已经给过后坐力 */
  spawnSlash(player.atkDir);
  SFX.slash();
  /* 蜕变挽歌：满血横劈射出剑气 */
  if (player.atkDir === 'side' && ch('elegy') && isFullHP()) spawnBeam(player.facing);
}
function slashRect() {
  const player = HK.player;
  const ext = (ch('longnail') ? 1 : 0) + (ch('pride') ? 2 : 0);
  /* 上劈 / 下劈只打**正上 / 正下**：判定盒收成一根竖直的柱子（宽度只比骑士略宽），
     不像以前那样是个正方形、连带扫到斜上 / 斜下方。纵向可及范围没动。 */
  if (player.atkDir === 'up') return { x: player.x, y: player.y + 2.2, w: 1.8 + ext * .8, h: 2.4 + ext * .5 };
  if (player.atkDir === 'down') return { x: player.x, y: player.y - 1.2, w: 1.8 + ext * .5, h: 2.4 + ext };
  return { x: player.x + player.facing * (1.7 + ext * .5), y: player.y + .9, w: 2.9 + ext, h: 2.3 };
}
/* 统一伤害入口（骨钉 / 剑气 / 荆棘 / 臭气 / 孢子 / 召唤物共用） */
function damageEnemy(e, dmg, kbDir, giveSoul = true, fx = true) {
  if (!e.alive) return;
  const player = HK.player;
  e.hp -= dmg; e.flash = .12;
  if (e.type === 'crawler' || e.type === 'husk') e.kb = (kbDir || 0) * 7 * kbMult();
  if (e.type === 'fly') e.x += (kbDir || 0) * .4;
  if (giveSoul) { player.soul = Math.min(99, player.soul + soulPerHit()); updHUD(); }
  if (fx) {
    S.freeze = Math.max(S.freeze, .045);
    SFX.hit();
    burst(e.x, e.y + e.h / 2, 7, { color: 0xffffff, v1: 8, tl: .35 });
  }
  if (e.hp <= 0) killEnemy(e);
}
function killEnemy(e) {
  e.alive = false; S.kills++;
  scene.remove(e.g);
  const col = e.type === 'crawler' ? 0xff8a6a : e.type === 'fly' ? 0x9fb2ff : e.type === 'husk' ? 0xf0e8c8 : 0xffb0a0;
  burst(e.x, e.y + e.h / 2, e.type === 'boss' ? 40 : 16, { color: col, v1: e.type === 'boss' ? 14 : 9, tl: .7 });
  if (e.type !== 'boss') dropGeo(e.x, e.y + .5, Math.round(Math.min(2 + e.maxhp, 8) * geoMult()));
  SFX.kill();
  if (e.type === 'boss') bossDead(e);
}
function bossDead(e) {
  e.deadOnce = true;
  shake(.7, .5); S.freeze = .25;
  $('bossbar').style.display = 'none'; $('bossname').style.display = 'none';
  blockText('K.O.!', HK.player.x + 2, HK.player.y + 6);
  dropGeo(e.x, e.y + 1.5, 18);
  SFX.win();
  setTimeout(() => {
    if (S.state !== 'play') return;
    S.state = 'win';
    if (HK.music) HK.music.stop();       /* BGM 淡出，让胜利结算是安静的 */
    const m = Math.floor(S.playT / 60), s = Math.floor(S.playT % 60);
    $('stats').innerHTML = `用时 <b>${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}</b> · 死亡 <b>${S.deaths}</b> · 击杀 <b>${S.kills}</b> · 吉欧 <b>${HK.player.geo}</b>`;
    $('winov').classList.remove('hidden');
  }, 1500);
}

/* ---------------- 敌人 AI ---------------- */
function updEnemy(e, dt) {
  const player = HK.player;
  if (!e.alive) return;
  if (e.flash > 0) {
    e.flash -= dt; const on = e.flash > 0;
    e.mats.forEach((m, i) => m.color.setHex(on ? 0xffffff : e.base[i]));
  }
  const px = player.x, py = player.y;
  switch (e.type) {
    case 'crawler': {
      e.kb *= Math.pow(.001, dt);
      e.vx = e.dir * 2.2 + e.kb;
      /* 前方无地面 → 掉头 */
      let onEdge = true;
      for (const p of HK.solids) {
        const r = hitRect(p);
        const fx = e.x + e.dir * (e.w / 2 + .25), fy = e.y - .3;
        if (fx > r.l && fx < r.r && fy > r.b - .4 && fy < r.t + .4) { onEdge = false; break; }
      }
      if (onEdge) e.dir *= -1;
      e.x += e.vx * dt;
      e.x = clamp(e.x, 1, S.levelW - 1.5);
      e.g.position.set(e.x, e.y, 0);
      e.g.scale.x = e.dir;
      e.g.children.forEach((c, i) => {
        if (c.geometry && c.geometry.type === 'PlaneGeometry' && c.position.y < .3) c.rotation.z = Math.sin(S.playT * 14 + i) * .3;
      });
      break;
    }
    case 'fly': {
      e.ph += dt * 2;
      const d = Math.hypot(px - e.x, py + .8 - e.y);
      if (!e.aggro && d < 8) e.aggro = true;
      if (e.aggro) {
        const sp = 6.2;
        e.x += ((px - e.x) / d) * sp * dt * 1.1;
        e.y += ((py + .9 - e.y) / d) * sp * dt * 1.1;
      } else {
        e.x = e.baseX + Math.sin(e.ph) * 1.2;
        e.y = e.baseY + Math.sin(e.ph * 1.7) * .8;
      }
      if (d > 16) e.aggro = false;
      e.wings.forEach((w, i) => w.rotation.z = Math.sin(S.playT * 26 + i * 3.14) * .7);
      e.g.position.set(e.x, e.y, 0);
      break;
    }
    case 'husk': {
      e.t += dt;
      const dx = px - e.x, see = Math.abs(dx) < 8 && Math.abs(py - e.y) < 2.5;
      if (e.state === 'walk') {
        e.dir = see ? Math.sign(dx) || 1 : e.dir;
        e.vx = e.dir * (see ? 3.2 : 1.4) + e.kb;
        if (see && Math.abs(dx) < 3.4 && e.t > .8) { e.state = 'windup'; e.t = 0; e.vx = 0; }
      } else if (e.state === 'windup') {
        e.vx = 0;
        e.mats[0].color.setHex(Math.sin(e.t * 40) > 0 ? 0xff5533 : e.base[0]);
        if (e.t > .45) { e.state = 'lunge'; e.t = 0; e.vx = e.dir * 12; }
      } else if (e.state === 'lunge') {
        e.vx = e.dir * 12 * (1 - e.t * 1.8) + e.kb;
        if (e.t > .4) { e.state = 'walk'; e.t = 0; }
      }
      e.kb *= Math.pow(.001, dt);
      /* 重力贴地（简化：找脚下的地面） */
      let bestY = 0;
      for (const p of HK.solids) {
        const r = hitRect(p);
        if (e.x > r.l && e.x < r.r && r.t <= e.y + .1 && r.t > bestY - 0.01 && e.y - r.t < 1) bestY = r.t;
      }
      e.y = bestY;
      e.x += e.vx * dt;
      e.x = clamp(e.x, 1.5, S.levelW - 2);
      e.g.position.set(e.x, e.y, 0);
      e.g.scale.x = e.dir;
      break;
    }
    case 'boss': {
      if (!e.active) {
        if (px > 214 && S.state === 'play') {
          e.active = true; S.bossActive = true; e.state = 'walk'; e.t = 0;
          SFX.roar(); shake(.6, .4);
          $('bossbar').style.display = 'block'; $('bossname').style.display = 'block';
          showHint('假 · 骑士  挡住了去路', 2.5);
        }
        break;
      }
      e.t += dt;
      const dx = px - e.x;
      if (e.state === 'walk') {
        e.vx = Math.sign(dx) * 3.2;
        if (e.t > 1.4) {
          if (Math.abs(dx) < 4.2) { e.state = 'windup'; e.t = 0; }
          else { e.state = 'jump'; e.t = 0; e.vy = 17; e.vx = clamp(dx / .8, -14, 14); SFX.jump(); }
        }
      } else if (e.state === 'windup') {
        e.vx = 0;
        e.mats[0].color.setHex(Math.sin(e.t * 44) > 0 ? 0xff4433 : e.base[0]);
        if (e.t > .42) { e.state = 'swing'; e.t = 0; e.g.rotation.z = -e.g.scale.x * .35; }
      } else if (e.state === 'swing') {
        if (e.t < .2 && player.invuln <= 0 &&
          overlap(e.x + Math.sign(dx) * 2.6, e.y + 1.5, 3.4, 3, player.x, player.y + player.h / 2, player.w, player.h))
          HK.hurtPlayer(e.x);
        if (e.t > .3) { e.state = 'walk'; e.t = 0; e.g.rotation.z = 0; }
      } else if (e.state === 'jump') {
        e.vy -= GRAV * .75 * dt;
        e.x += e.vx * dt; e.y += e.vy * dt;
        if (e.y <= 0 && e.vy < 0) {
          e.y = 0; e.vy = 0; e.vx = 0;
          e.state = 'walk'; e.t = -.5;
          SFX.slam(); shake(.4, .45);
          for (let i = 0; i < 14; i++) spawnP(e.x + rnd(-3, 3), 0.3, { vx: rnd(-3, 3), vy: rnd(2, 7), tl: .5, size: .9, color: 0xbfe6ff });
          if (player.grounded && Math.abs(player.x - e.x) < 6.5 && player.invuln <= 0) HK.hurtPlayer(e.x);
        }
      }
      e.x = clamp(e.x, 210, 268);
      e.g.position.set(e.x, e.y, 0);
      e.g.scale.x = Math.sign(dx) || 1;
      $('bossfill').style.width = (e.hp / e.maxhp * 100) + '%';
      break;
    }
  }
  /* 接触伤害 */
  if (e.alive && player.invuln <= 0 && !player.dead) {
    const eh = e.type === 'fly' ? .6 : e.h;
    const ey = e.type === 'fly' ? e.y : e.y + eh / 2;
    if (overlap(e.x, ey, e.w, eh, player.x, player.y + player.h / 2, player.w, player.h)) HK.hurtPlayer(e.x);
  }
}

/* ---------------- 玩家更新 ---------------- */
function updPlayer(dt) {
  const player = HK.player, enemies = HK.enemies, pGroup = HK.pGroup, spikes = HK.spikes;
  if (player.dead) return;
  player.invuln = Math.max(0, player.invuln - dt);
  player.lock = Math.max(0, player.lock - dt);
  player.dashCD = Math.max(0, player.dashCD - dt);
  player.atkCD = Math.max(0, player.atkCD - dt);
  buffer.jump = Math.max(0, buffer.jump - dt);
  buffer.dash = Math.max(0, buffer.dash - dt);
  buffer.attack = Math.max(0, buffer.attack - dt);
  player.coyote = player.grounded ? .1 : Math.max(0, player.coyote - dt);
  if (player.grounded) { player.canDouble = true; player.lastSafe = { x: player.x, y: player.y }; }

  /* 凝聚回血 */
  const fTime = HK.focusTimeV(), fCost = HK.focusCostV();
  const wantFocus = held.focus && player.grounded && player.lock <= 0;
  if (wantFocus && player.soul >= fCost && player.masks < player.maxMasks) {
    if (!player.focusing) { player.focusing = true; player.focusT = 0; SFX.focus(); }
    player.focusT += dt;
    if (Math.random() < .4) {
      const a = rnd(0, 6.28), r = rnd(1.2, 2);
      spawnP(player.x + Math.cos(a) * r, player.y + .8 + Math.sin(a) * r, { vx: -Math.cos(a) * 4, vy: -Math.sin(a) * 4, g: 0, tl: .4, size: .5, color: 0xffffff });
    }
    if (player.focusT >= fTime) {
      player.focusing = false; player.focusT = 0;
      onFocusComplete();
    }
  } else player.focusing = false;
  /* 乌恩之形：凝聚时可缓慢移动 */
  const moveOK = player.lock <= 0 && (!player.focusing || ch('shape'));
  const ctrl = player.lock <= 0 && !player.focusing;

  /* 冲刺 */
  if (player.dashT > 0) {
    player.dashT -= dt;
    if (player.dashMode === 'down') { player.vx = 0; player.vy = -30; }
    else { player.vx = player.dashDir * DASHV; player.vy = 0; }
    if (Math.random() < .8) ghost();
    /* 锋利之影 */
    if (ch('sharpshadow')) for (const e of enemies) {
      if (!e.alive || player.dashHits.has(e)) continue;
      const cy = e.type === 'fly' ? e.y : e.y + e.h / 2;
      if (overlap(player.x, player.y + player.h / 2, player.w, player.h, e.x, cy, e.w, e.type === 'fly' ? .7 : e.h)) {
        player.dashHits.add(e);
        damageEnemy(e, nailDmg(), player.dashDir);
      }
    }
    if (player.dashT <= 0 && player.dashMode !== 'down') player.vx = player.dashDir * RUN * .5;
    if (player.dashMode === 'down' && player.grounded) {
      player.dashT = 0;
      burst(player.x, player.y, 8, { color: 0xbfe6ff, v1: 4, tl: .3 });
    }
  } else if (ctrl) {
    /* 移动 */
    let mx = 0;
    if (held.left && moveOK) mx -= 1;
    if (held.right && moveOK) mx += 1;
    if (mx !== 0) player.facing = mx;
    const spd = player.focusing ? runV() * .55 : runV();
    const target = mx * spd;
    player.vx = lerp(player.vx, target, 1 - Math.pow(player.grounded ? .000001 : .01, dt));
    /* 跳跃 */
    if (buffer.jump > 0) {
      if (player.coyote > 0) {
        player.vy = JUMPV; player.grounded = false; player.coyote = 0; buffer.jump = 0;
        SFX.jump(); burst(player.x, player.y, 5, { color: 0x9fd8ff, v1: 3, up: 2, g: 10, tl: .3 });
      } else if (player.canDouble) {
        player.vy = JUMP2V; player.canDouble = false; buffer.jump = 0;
        SFX.jump2();
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * 6.28;
          spawnP(player.x + Math.cos(a) * .5, player.y + .2, { vx: Math.cos(a) * 2, vy: 1, g: 4, tl: .3, size: .45, color: 0xcfe8ff });
        }
      }
    }
    if (!held.jump && player.vy > 6) player.vy = lerp(player.vy, 6, 14 * dt);
    /* 冲刺启动 */
    if (buffer.dash > 0 && player.dashCD <= 0) {
      buffer.dash = 0; player.dashCD = dashCDv();
      player.dashHits = new Set();
      if (held.down && !player.grounded && ch('dashmaster')) {
        player.dashMode = 'down'; player.dashT = .2; player.vx = 0;
      } else {
        player.dashMode = 'side'; player.dashT = DASHT; player.dashDir = player.facing;
        player.vy = 0;
      }
      SFX.dash();
    }
    /* 攻击 */
    if (buffer.attack > 0 && player.atkCD <= 0) { buffer.attack = 0; doAttack(); }
  }

  /* 重力 */
  if (player.dashT <= 0) {
    player.vy -= GRAV * dt;
    player.vy = Math.max(player.vy, -MAXFALL);
  }

  moveAndCollide(player, dt);

  /* 攻击命中 */
  if (player.atkT > 0) {
    player.atkT -= dt;
    const r = slashRect();
    for (const e of enemies) {
      if (!e.alive || player.atkHit.has(e)) continue;
      const eh = e.type === 'fly' ? .7 : e.h, ey = e.type === 'fly' ? e.y : e.y + eh / 2;
      if (overlap(r.x, r.y, r.w, r.h, e.x, ey, e.w, eh)) {
        player.atkHit.add(e);
        damageEnemy(e, nailDmg(), player.facing);
        if (player.atkDir === 'down') { player.vy = 16.5; player.canDouble = true; player.dashCD = Math.min(player.dashCD, .1); }
        /* 后坐力：命中才给，且一次挥砍只给一次（一刀扫到两只怪也只推一下）。
           上下劈没有横向后坐，下劈的反弹力在上一行单独给。 */
        else if (player.atkDir === 'side' && !player.atkRecoil && !ch('steady')) {
          player.atkRecoil = true;
          player.vx -= player.facing * (player.grounded ? RECOIL_GROUND : RECOIL_AIR);
        }
      }
    }
    /* 下劈尖刺弹跳 */
    if (player.atkDir === 'down') {
      for (const s of spikes) {
        if (overlap(r.x, r.y, r.w, r.h, s.x, s.y + s.h / 2, s.w, s.h)) {
          player.vy = 16.5; player.canDouble = true;
          player.atkHit.add(s); burst(player.x, player.y - 1, 5, { color: 0xffd9a0, v1: 5, tl: .3 });
          SFX.hit(); break;
        }
      }
    }
  }

  /* 尖刺 */
  if (player.invuln <= 0 && !player.dead) {
    for (const s of spikes) {
      if (overlap(player.x, player.y + player.h / 2, player.w, player.h, s.x, s.y + s.h / 2, s.w, s.h)) {
        HK.hurtPlayer(player.x + (player.vx >= 0 ? 1 : -1));
        if (!player.dead) { player.x = player.lastSafe.x; player.y = player.lastSafe.y + .1; player.vx = 0; player.vy = 0; }
        break;
      }
    }
  }
  /* 坠落 */
  if (player.y < -9 && !player.dead) {
    HK.hurtPlayer(player.x);
    if (!player.dead) { player.x = player.lastSafe.x; player.y = player.lastSafe.y + .1; player.vx = 0; player.vy = 0; player.invuln = 1.2; }
  }
  /* Boss 战左侧隐形墙 */
  if (S.bossActive) player.x = Math.max(player.x, 209.5);
  player.x = clamp(player.x, .5, S.levelW - 1);

  /* 落地音 + 压扁 */
  if (player.grounded && player.wasAir) {
    SFX.land(); player.squash = .18;
    burst(player.x, player.y, 3, { color: 0x7e95b5, v1: 2, tl: .25, size: .4 });
  }
  player.wasAir = !player.grounded;
  player.squash = Math.max(0, player.squash - dt);

  /* 渲染 */
  pGroup.position.set(player.x, player.y, 0);
  const run = player.grounded && Math.abs(player.vx) > 1;
  player.runPh += dt * Math.abs(player.vx) * 1.6;
  const bob = run ? Math.abs(Math.sin(player.runPh)) * .08 : 0;
  let sx = 1, sy = 1;
  if (player.squash > 0) { sy = .78 + .22 * (1 - player.squash / .18); sx = 2 - sy; }
  else if (!player.grounded) { sy = 1.06; sx = .94; }
  pGroup.scale.y = lerp(pGroup.scale.y || 1, sy, .4);
  pGroup.scale.x = player.facing * sx;
  pGroup.position.y += bob;
  /* 腿部摆动 */
  let li = 0;
  pGroup.children.forEach(c => {
    if (c.geometry && c.geometry.parameters && c.geometry.parameters.height === .28) {
      c.rotation.z = run ? Math.sin(player.runPh * 2 + (li++ % 2 ? 3.14 : 0)) * .5 : 0;
    }
  });
  /* 无敌闪烁 */
  pGroup.visible = player.invuln > 0 ? (Math.floor(S.playT * 14) % 2 === 0) : true;
}

Object.assign(HK, { doAttack, slashRect, damageEnemy, killEnemy, bossDead, updEnemy, updPlayer });

})(window.HK);
