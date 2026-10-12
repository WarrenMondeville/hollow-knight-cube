/* ============================================================
   模块 9/13：charms.js
   护符系统（参考 护符系统.md）
   护符数据 / 派生数值 / 召唤物与特效实体 / 菜单 / 每帧更新
   ============================================================ */
(function (HK) {
'use strict';
const { CFG, S, rnd, lerp, scene, GLOW, spawnP, burst, updHUD, showHint, SFX, tone, lam, solids, hitRect, overlap, $ } = HK;
const { RUN, STEP } = CFG;

/* ---------------- 护符数据 ---------------- */
const NOTCHES = 5;
const equipped = new Set();
const ch = id => equipped.has(id);
const CHARMS = [
  { id: 'compass', name: '任性的指南针', cost: 1, desc: '右上角小地图显示位置' },
  { id: 'swarm', name: '蜂群集结', cost: 2, desc: '吉欧自动飞向你（无需触碰）' },
  { id: 'stalwart', name: '坚硬外壳', cost: 2, desc: '受击无敌 1.2s → 2.0s' },
  { id: 'catcher', name: '灵魂捕手', cost: 3, desc: '命中回魂 11 → 14' },
  { id: 'eater', name: '噬魂者', cost: 4, desc: '命中回魂 11 → 19（与捕手叠加 22）' },
  { id: 'dashmaster', name: '冲刺大师', cost: 2, desc: '冲刺冷却 0.45 → 0.34；空中 S+冲刺下冲' },
  { id: 'quickslash', name: '快速劈砍', cost: 3, desc: '攻击间隔 0.36 → 0.26' },
  { id: 'longnail', name: '修长之钉', cost: 2, desc: '骨钉攻击距离 +1' },
  { id: 'pride', name: '骄傲象征', cost: 3, desc: '骨钉攻击距离 +2' },
  { id: 'strength', name: '坚固力量', cost: 2, desc: '骨钉伤害 ×1.5' },
  { id: 'fury', name: '亡者之怒', cost: 2, desc: '仅剩 1 面具时伤害 ×1.75' },
  { id: 'heart', name: '坚固心脏', cost: 2, desc: '面具上限 +2' },
  { id: 'greed', name: '坚固贪婪', cost: 2, desc: '吉欧掉落 ×1.6' },
  { id: 'grubsong', name: '幼虫之歌', cost: 2, desc: '受伤回复 15 点灵魂' },
  { id: 'elegy', name: '蜕变挽歌', cost: 3, desc: '满血时横劈射出剑气' },
  { id: 'thorns', name: '苦痛荆棘', cost: 2, desc: '受击时荆棘光环反伤' },
  { id: 'baldur', name: '巴德尔之壳', cost: 2, desc: '凝聚时格挡伤害（4 次，座椅修复）' },
  { id: 'crest', name: '防御者纹章', cost: 1, desc: '臭气光环持续伤害近身敌人' },
  { id: 'quickfocus', name: '快速聚集', cost: 3, desc: '凝聚 0.9s → 0.72s' },
  { id: 'deepfocus', name: '深度聚集', cost: 4, desc: '凝聚回复 2 面具，耗时 1.44s（与快速叠加为 1s/2 面具）' },
  { id: 'lbheart', name: '生命血之心', cost: 2, desc: '座椅休息时 +2 生命血' },
  { id: 'lbcore', name: '生命血核心', cost: 3, desc: '座椅休息时 +4 生命血' },
  { id: 'hiveblood', name: '蜂巢之血', cost: 4, desc: '10 秒未受伤自动回复 1 面具' },
  { id: 'spore', name: '蘑菇孢子', cost: 2, desc: '凝聚完成时释放孢子云' },
  { id: 'sharpshadow', name: '锋利之影', cost: 2, desc: '冲刺时对穿过的敌人造成骨钉伤害' },
  { id: 'shape', name: '乌恩之形', cost: 3, desc: '凝聚时可缓慢移动' },
  { id: 'weaver', name: '编织者之歌', cost: 2, desc: '三只编织者幼体伴随攻击' },
  { id: 'shield', name: '梦之盾', cost: 3, desc: '环绕的梦之盾可抵伤并反伤' },
  { id: 'twister', name: '法术扭曲者', cost: 2, desc: '凝聚耗魂 33 → 24' },
  { id: 'steady', name: '稳定之体', cost: 1, desc: '横劈不再有后坐力' },
  { id: 'heavyblow', name: '沉重之击', cost: 2, desc: '敌人被击退距离 ×1.6' },
  { id: 'sprint', name: '飞毛腿', cost: 1, desc: '移动速度 ×1.25' },
  { id: 'kingsoul', name: '国王之魂', cost: 3, desc: '每 2 秒回复 2 点灵魂' },
  /* 依赖未实装系统 */
  { id: 'shaman', name: '萨满之石', cost: 3, desc: '需要法术系统', lock: true },
  { id: 'glowingwomb', name: '发光子宫', cost: 2, desc: '需要法术系统', lock: true },
  { id: 'grimmchild', name: '格林之子', cost: 2, desc: '需要召唤系统', lock: true },
  { id: 'dreamwielder', name: '舞梦人', cost: 1, desc: '需要梦之钉', lock: true },
  { id: 'nailmaster', name: '骨钉大师的荣耀', cost: 3, desc: '需要剑技系统', lock: true },
  { id: 'joni', name: '乔尼祝福', cost: 4, desc: '需要生命血转化系统', lock: true }
];
const charmById = id => CHARMS.find(c => c.id === id);

/* ---------------- 派生数值 ---------------- */
function soulPerHit() { return ch('catcher') && ch('eater') ? 22 : ch('eater') ? 19 : ch('catcher') ? 14 : 11; }
function nailDmg() {
  let m = 1;
  if (ch('strength')) m *= 1.5;
  if (ch('fury') && HK.player.masks + HK.player.lb === 1) m *= 1.75;
  return Math.ceil(2 * m);
}
function kbMult() { return ch('heavyblow') ? 1.6 : 1; }
function geoMult() { return ch('greed') ? 1.6 : 1; }
function atkCDv() { return ch('quickslash') ? .26 : .36; }
function dashCDv() { return ch('dashmaster') ? .34 : .45; }
function runV() { return RUN * (ch('sprint') ? 1.25 : 1); }
function invulnV() { return ch('stalwart') ? 2 : 1.2; }
function focusTimeV() { return ch('quickfocus') && ch('deepfocus') ? 1 : ch('quickfocus') ? .72 : ch('deepfocus') ? 1.44 : .9; }
function focusHealV() { return ch('deepfocus') ? 2 : 1; }
function focusCostV() { return ch('twister') ? 24 : 33; }
function magnetRv() { return ch('swarm') ? 9 : 0; }   /* 0 = 没有磁吸，金币必须碰到才捡 */
function lbMaxV() { return (ch('lbheart') ? 2 : 0) + (ch('lbcore') ? 4 : 0); }
function isFullHP() {
  const p = HK.player;
  return p.masks === p.maxMasks && p.lb === p.lbMax;
}
function notchesUsed() {
  let n = 0; for (const id of equipped) n += charmById(id).cost; return n;
}

/* ---------------- 剑气（蜕变挽歌） ---------------- */
const beams = [];
function spawnBeam(dir) {
  const p = HK.player;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.9, .6),
    new THREE.MeshBasicMaterial({ color: 0xeaf7ff, transparent: true, opacity: .95, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  m.position.set(p.x + dir * 1.4, p.y + .9, 1.2);
  scene.add(m);
  beams.push({ m, dir, ttl: .55 });
  tone(1200, .15, 'sawtooth', 300, .03);
}
/* ---------------- 孢子云（蘑菇孢子） ---------------- */
const sporeClouds = [];
/* ---------------- 编织者幼体（编织者之歌） ---------------- */
const weavers = [];
for (let i = 0; i < 3; i++) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.PlaneGeometry(.42, .32), lam(0x2a3048));
  g.add(b);
  const eye = new THREE.Mesh(new THREE.PlaneGeometry(.1, .12), new THREE.MeshBasicMaterial({ color: 0xeaf7ff, side: THREE.DoubleSide }));
  eye.position.set(0, .02, .02); g.add(eye);
  g.visible = false; scene.add(g);
  weavers.push({ g, x: 0, y: 0, cd: 0, base: i / 3 * 6.28 });
}
/* ---------------- 梦之盾 ---------------- */
const shield = { angle: 0, hideT: 0 };
{
  const m = new THREE.Mesh(new THREE.CircleGeometry(.55, 6),
    new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: .9, side: THREE.DoubleSide }));
  m.visible = false; scene.add(m); shield.mesh = m;
  const ring = new THREE.Mesh(new THREE.RingGeometry(.4, .55, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.add(ring);
}
/* ---------------- 巴德尔之壳视觉 ---------------- */
const baldurSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xd8c890, transparent: true, opacity: 0, depthWrite: false }));
baldurSprite.scale.set(3.4, 3.4, 1); scene.add(baldurSprite);

/* ---------------- 护符每帧更新 ---------------- */
let crestT = 0, kingT = 0;
function charmUpdate(dt) {
  const player = HK.player, enemies = HK.enemies;
  if (player.dead) return;
  player.sinceHurt += dt;
  /* 国王之魂 */
  if (ch('kingsoul')) {
    kingT += dt;
    if (kingT >= 2) {
      kingT = 0;
      player.soul = Math.min(99, player.soul + 2); updHUD();
      spawnP(player.x, player.y + 1.6, { vy: 1.5, g: 0, tl: .5, size: .6, color: 0xffffff });
    }
  }
  /* 蜂巢之血 */
  if (ch('hiveblood') && player.sinceHurt >= 10 && player.masks < player.maxMasks) {
    player.sinceHurt = 0; player.masks++; updHUD();
    SFX.heal(); burst(player.x, player.y + .9, 8, { color: 0xffc86a, v1: 3, g: -2, tl: .7 });
  }
  /* 防御者纹章 */
  if (ch('crest')) {
    crestT += dt;
    if (Math.random() < .3) spawnP(player.x + rnd(-1, 1), player.y + .6 + rnd(0, .8), { vx: rnd(-.5, .5), vy: .8, g: 0, tl: .6, size: .45, color: 0x7aff9a, fade: .5 });
    if (crestT >= .4) {
      crestT = 0;
      for (const e of enemies) {
        if (!e.alive) continue;
        const cy = e.type === 'fly' ? e.y : e.y + e.h / 2;
        if (Math.hypot(e.x - player.x, cy - (player.y + .8)) < 2.3) HK.damageEnemy(e, Math.random() < .5 ? 1 : 2, 0, false, false);
      }
    }
  }
  /* 剑气 */
  for (let i = beams.length - 1; i >= 0; i--) {
    const b = beams[i]; b.ttl -= dt;
    b.m.position.x += b.dir * 18 * dt;
    if (Math.random() < .7) spawnP(b.m.position.x, b.m.position.y + rnd(-.2, .2), { vx: -b.dir * 2, vy: rnd(-1, 1), g: 0, tl: .25, size: .5, color: 0xbfe6ff });
    let hit = b.ttl <= 0;
    for (const p of solids) {
      const r = hitRect(p);
      if (b.m.position.x > r.l && b.m.position.x < r.r && b.m.position.y > r.b && b.m.position.y < r.t) { hit = true; break; }
    }
    if (!hit) for (const e of enemies) {
      if (!e.alive) continue;
      const cy = e.type === 'fly' ? e.y : e.y + e.h / 2;
      if (overlap(b.m.position.x, b.m.position.y, 1.8, .7, e.x, cy, e.w, e.type === 'fly' ? .7 : e.h)) {
        HK.damageEnemy(e, nailDmg(), b.dir); hit = true; break;
      }
    }
    if (hit) { burst(b.m.position.x, b.m.position.y, 6, { color: 0xbfe6ff, v1: 5, tl: .3 }); scene.remove(b.m); beams.splice(i, 1); }
  }
  /* 孢子云 */
  for (let i = sporeClouds.length - 1; i >= 0; i--) {
    const s = sporeClouds[i]; s.ttl -= dt; s.tick -= dt;
    if (Math.random() < .4) {
      const a = rnd(0, 6.28), r = rnd(0, s.r);
      spawnP(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r * .7, { vx: rnd(-.4, .4), vy: rnd(.2, 1), g: 0, tl: .8, size: .6, color: 0x9fe87a, fade: .6 });
    }
    if (s.tick <= 0) {
      s.tick = .09;
      for (const e of enemies) {
        if (!e.alive) continue;
        const cy = e.type === 'fly' ? e.y : e.y + e.h / 2;
        if (Math.hypot(e.x - s.x, cy - s.y) < s.r) HK.damageEnemy(e, 1, 0, false, false);
      }
    }
    if (s.ttl <= 0) sporeClouds.splice(i, 1);
  }
  /* 编织者幼体 */
  const weaverOn = ch('weaver');
  weavers.forEach(w => {
    w.g.visible = weaverOn;
    if (!weaverOn) return;
    w.cd -= dt;
    const hx = player.x + Math.cos(w.base + S.playT * 1.3) * 1.7;
    const hy = player.y + .9 + Math.sin(w.base + S.playT * 1.3) * 1.4;
    let tgt = null, td = 6;
    if (w.cd <= 0) for (const e of enemies) {
      if (!e.alive) continue;
      const cy = e.type === 'fly' ? e.y : e.y + e.h / 2;
      const d = Math.hypot(e.x - player.x, cy - (player.y + .9));
      if (d < td) { td = d; tgt = e; }
    }
    if (tgt) {
      const cy = tgt.type === 'fly' ? tgt.y : tgt.y + tgt.h / 2;
      const d = Math.hypot(tgt.x - w.x, cy - w.y) || 1;
      w.x += (tgt.x - w.x) / d * 15 * dt; w.y += (cy - w.y) / d * 15 * dt;
      w.g.scale.x = Math.sign(tgt.x - w.x) || 1;
      if (d < .75) {
        HK.damageEnemy(tgt, 1, Math.sign(tgt.x - player.x) || 1, false);
        if (ch('grubsong')) { player.soul = Math.min(99, player.soul + 3); updHUD(); }
        w.cd = .75;
      }
    } else {
      w.x = lerp(w.x, hx, 5 * dt); w.y = lerp(w.y, hy, 5 * dt);
      w.g.scale.x = player.facing;
    }
    w.g.position.set(w.x, w.y, .8);
  });
  /* 梦之盾 */
  const shOn = ch('shield');
  shield.mesh.visible = shOn && shield.hideT <= 0 && !player.dead;
  if (shOn) {
    shield.hideT -= dt; shield.angle += 2 * dt;
    shield.mesh.position.set(player.x + Math.cos(shield.angle) * 2.4, player.y + .9 + Math.sin(shield.angle) * 2.4, .6);
    shield.mesh.rotation.z = shield.angle;
    if (shield.hideT <= 0) for (const e of enemies) {
      if (!e.alive) continue;
      const cy = e.type === 'fly' ? e.y : e.y + e.h / 2;
      if (Math.hypot(e.x - shield.mesh.position.x, cy - shield.mesh.position.y) < 1.0) {
        HK.damageEnemy(e, nailDmg(), Math.sign(e.x - player.x) || 1, false);
        shield.hideT = 3; break;
      }
    }
  }
}
/* 凝聚完成回调 */
function onFocusComplete() {
  const player = HK.player;
  player.soul -= focusCostV();
  player.masks = Math.min(player.maxMasks, player.masks + focusHealV());
  updHUD(); HK.flashFX('heal'); SFX.heal();
  burst(player.x, player.y + .8, 12, { color: 0xffffff, v1: 4, g: -2, tl: .6 });
  /* 蘑菇孢子 */
  if (ch('spore')) {
    const r = 3 + (ch('deepfocus') ? 1.5 : 0);
    sporeClouds.push({ x: player.x, y: player.y + .8, r, ttl: 2.4, tick: 0 });
    burst(player.x, player.y + .8, 16, { color: 0x9fe87a, v1: 5, g: -1, tl: .9 });
  }
}

/* ---------------- 护符菜单 ---------------- */
function buildCharmMenu() {
  const list = $('charmgrid'); list.innerHTML = '';
  for (const c of CHARMS) {
    const d = document.createElement('div');
    d.className = 'charm' + (equipped.has(c.id) ? ' on' : '') + (c.lock ? ' lock' : '');
    d.innerHTML = `<div class="cname">${c.name}</div>
      <div class="cost">${'◆'.repeat(c.cost)}${'◇'.repeat(NOTCHES - c.cost)}</div>
      <div class="cdesc">${c.desc}</div>`;
    if (!c.lock) d.addEventListener('click', () => {
      const player = HK.player;
      if (equipped.has(c.id)) equipped.delete(c.id);
      else if (notchesUsed() + c.cost <= NOTCHES) equipped.add(c.id);
      else { showHint('护符槽位不足', 1.2); return; }
      player.maxMasks = 5 + (ch('heart') ? 2 : 0);
      player.masks = Math.min(player.masks, player.maxMasks);
      updHUD(); buildCharmMenu(); SFX.bench();
    });
    list.appendChild(d);
  }
  $('notchline').innerHTML = '护符槽 ' + '◆'.repeat(notchesUsed()) + '◇'.repeat(NOTCHES - notchesUsed());
}
function toggleCharmMenu() {
  if (S.state !== 'play') return;
  S.charmOpen = !S.charmOpen;
  $('charmov').classList.toggle('hidden', !S.charmOpen);
  if (S.charmOpen) buildCharmMenu();
}

Object.assign(HK, {
  NOTCHES, equipped, ch, CHARMS, charmById,
  soulPerHit, nailDmg, kbMult, geoMult, atkCDv, dashCDv, runV, invulnV,
  focusTimeV, focusHealV, focusCostV, magnetRv, lbMaxV, isFullHP, notchesUsed,
  beams, spawnBeam, sporeClouds, weavers, shield, baldurSprite,
  charmUpdate, onFocusComplete, buildCharmMenu, toggleCharmMenu
});

})(window.HK);
