/* ============================================================
   模块 4/12：entities.js
   玩家（状态 + 方块建模）/ 敌人（四类 + 布阵）/ 吉欧掉落
   ============================================================ */
(function (HK) {
'use strict';
const { CFG, S, rnd, lerp, clamp, scene, spawnP, burst, slashTex, SFX } = HK;


/* ---------------- 材质工厂（纯 2D：不吃光、双面） ---------------- */
/* 用 MeshBasicMaterial：正交 2D 里没有光照可言，颜色就是最终颜色。
   side=DoubleSide 是必须的 —— 角色靠 scale.x=-1 镜像朝向，
   单面材质在镜像后会被背面剔除而整只消失。
   第二参数（旧 emissive）保留只为兼容调用点，2D 下不使用。 */
function lam(c) { return new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }); }

/* ---------------- 玩家 ---------------- */
const player = {
  x: 3, y: 0, vx: 0, vy: 0, w: .8, h: 1.55, facing: 1,
  grounded: false, coyote: 0, jbuf: 0, canDouble: true,
  dashT: 0, dashCD: 0, dashDir: 1, dashMode: 'side',
  atkT: 0, atkCD: 0, atkDir: 'side', atkHit: null, atkRecoil: false, dashHits: new Set(),
  lock: 0, invuln: 0,
  masks: 5, maxMasks: 5, soul: 0, geo: 0, lb: 0, lbMax: 0, baldurCharges: 0, sinceHurt: 0,
  focusT: 0, focusing: false,
  runPh: 0, squash: 0, dead: false,
  lastSafe: { x: 3, y: 0 }
};
/* 全部是平面四边形，靠 z 微偏移决定遮挡顺序（不是厚度） */
const pGroup = new THREE.Group(); scene.add(pGroup);
const pMats = {};
{
  const head = new THREE.Mesh(new THREE.PlaneGeometry(.95, .75), lam(0xe8f0f5));
  head.position.set(0, 1.15, 0); pGroup.add(head);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.PlaneGeometry(.2, .3), lam(0xe8f0f5));
    ear.position.set(s * .3, 1.62, -.005); pGroup.add(ear);
    const eye = new THREE.Mesh(new THREE.PlaneGeometry(.15, .2), new THREE.MeshBasicMaterial({ color: 0x0c0f16, side: THREE.DoubleSide }));
    eye.position.set(s * .2, 1.18, .01); pGroup.add(eye);
    const arm = new THREE.Mesh(new THREE.PlaneGeometry(.12, .36), lam(0x1c2230));
    arm.position.set(s * .4, .5, -.02); pGroup.add(arm);
    const leg = new THREE.Mesh(new THREE.PlaneGeometry(.17, .28), lam(0x1c2230));
    leg.position.set(s * .18, .14, -.03); pGroup.add(leg);
  }
  const body = new THREE.Mesh(new THREE.PlaneGeometry(.6, .55), lam(0x1c2230));
  body.position.set(0, .42, -.01); pGroup.add(body);
  pGroup.traverse(o => { if (o.isMesh) pMats[o.uuid] = o.material; });
}

/* 冲刺残影 */
function ghost() {
  spawnP(player.x, player.y + .8, { vx: 0, vy: 0, g: 0, tl: .28, size: 1.7, color: 0xcfe8ff, fade: .35 });
}

/* ---------------- 挥砍特效 ---------------- */
const slashes = [];
function spawnSlash(dir) {
  const s = new THREE.Mesh(new THREE.PlaneGeometry(3, 3),
    new THREE.MeshBasicMaterial({ map: slashTex(), transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  /* 上下劈是**正上 / 正下**的竖直弧，不带斜角。
     贴图本身是「）」形的弧（凸向 +x），绕 z 转 ∓90° 后凸向就变成正上 / 正下；
     横向偏移 ox 也必须是 0（以前上劈 .2、横劈 1.7，会把弧推到斜前方）。 */
  let ox = 1.7, oy = .9, rot = 0;
  if (dir === 'up') { ox = 0; oy = 1.9; rot = Math.PI / 2; }
  if (dir === 'down') { ox = 0; oy = -.5; rot = -Math.PI / 2; }
  s.position.set(player.x + player.facing * ox, player.y + oy, 1.2);
  s.rotation.z = rot;
  /* 只有横劈需要按朝向镜像；上下劈左右对称，镜像了反而会看着偏 */
  if (player.facing < 0 && dir === 'side') s.rotation.y = Math.PI;
  scene.add(s);
  slashes.push({ m: s, t: 0, tl: .16 });
}
function updateSlashes(dt) {
  for (let i = slashes.length - 1; i >= 0; i--) {
    const s = slashes[i]; s.t += dt;
    const k = s.t / s.tl;
    s.m.material.opacity = 1 - k;
    const sc = .7 + k * .8; s.m.scale.set(sc, sc, 1);
    if (s.t >= s.tl) { scene.remove(s.m); slashes.splice(i, 1); }
  }
}

/* ---------------- 敌人 ---------------- */
const enemies = [];
/* 纯 2D 用 MeshBasicMaterial，没有 emissive —— 受击闪白/前摇变色
   只能改 color，所以这里先把每只敌人的原始颜色记下来，方便还原。 */
function pushEnemy(o) {
  o.base = o.mats.map(m => m.color.getHex());
  enemies.push(o);
  return o;
}
function addEyes(grp, y, z, gap, col) {
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.PlaneGeometry(.16, .22), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
    e.position.set(s * gap, y, z); grp.add(e);
  }
}
function makeCrawler(x, y) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.PlaneGeometry(1.25, .9), lam(0x9c5040));
  b.position.set(0, .45, -.01); g.add(b);
  addEyes(g, .5, .02, .28, 0x141018);
  for (const s of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(.14, .22), lam(0x5e2f26));
    l.position.set(s * .4, .1, -.02); g.add(l);
  }
  g.position.set(x, y, 0); scene.add(g);
  pushEnemy({
    type: 'crawler', g, x, y, vx: 2.2, dir: 1, w: 1.25, h: .9, hp: 2, maxhp: 2,
    flash: 0, kb: 0, alive: true, mats: [b.material], baseY: y
  });
}
function makeFly(x, y) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.PlaneGeometry(.8, .7), lam(0x50597a));
  g.add(b);
  addEyes(g, .08, .02, .2, 0xffd45a);
  const wings = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(.6, .3),
      new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: .6, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    w.position.set(s * .5, .35, -.01); g.add(w); wings.push(w);
  }
  g.position.set(x, y, 0); scene.add(g);
  pushEnemy({
    type: 'fly', g, x, y, ph: rnd(0, 6.28), w: .8, h: .7, hp: 1, maxhp: 1,
    flash: 0, alive: true, aggro: false, wings, baseY: y, baseX: x, mats: [b.material]
  });
}
function makeHusk(x, y) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.9), lam(0xc9c4b0));
  b.position.set(0, .95, -.01); g.add(b);
  const helm = new THREE.Mesh(new THREE.PlaneGeometry(1.6, .4), lam(0x8d8a7a));
  helm.position.set(0, 1.75, 0); g.add(helm);
  addEyes(g, 1.15, .02, .32, 0xff7a3c);
  g.position.set(x, y, 0); scene.add(g);
  pushEnemy({
    type: 'husk', g, x, y, vx: 0, dir: 1, w: 1.5, h: 1.9, hp: 3, maxhp: 3,
    flash: 0, kb: 0, alive: true, state: 'walk', t: 0, mats: [b.material, helm.material]
  });
}
function makeBoss(x, y) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.2), lam(0x8a3038));
  b.position.set(0, 1.6, -.01); g.add(b);
  const helm = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 1.0), lam(0xcdd8e2));
  helm.position.set(0, 3.3, 0); g.add(helm);
  const horn = new THREE.Mesh(new THREE.PlaneGeometry(.5, .9), lam(0xcdd8e2));
  horn.position.set(1.0, 4.1, -.005); g.add(horn);
  const horn2 = horn.clone(); horn2.position.x = -1.0; g.add(horn2);
  addEyes(g, 2.2, .02, .62, 0xffd45a);
  for (const s of [-1, 1]) {
    const a = new THREE.Mesh(new THREE.PlaneGeometry(.6, 1.6), lam(0x5e2228));
    a.position.set(s * 1.9, 1.4, -.02); g.add(a);
  }
  g.position.set(x, y, 0); scene.add(g);
  pushEnemy({
    type: 'boss', g, x, y, w: 3, h: 4.4, hp: 26, maxhp: 26, flash: 0, alive: true,
    state: 'sleep', t: 0, vx: 0, vy: 0, mats: [b.material, helm.material, horn.material], active: false
  });
}
/* 敌人由瓦片地图刷出：spawnList 由 world.buildLevel() 填充 */
const spawnList = [];

/* ---------------- 吉欧（掉落货币） ----------------
   默认**不会自动被吸走**：金币掉在原地，必须身体碰到才收走。
   装备「蜂群集结」后才有磁吸（HK.magnetRv() 返回半径，0 = 无磁吸）。 */
const geos = [];
const GEO_R = .22;                                      /* 六边形结晶的外接半径 */
const geoGeo = new THREE.CircleGeometry(GEO_R, 6);      /* 2D：六边形结晶 */
const geoMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, side: THREE.DoubleSide });
function dropGeo(x, y, n) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geoGeo, geoMat);
    m.position.set(x, y, 0); scene.add(m);
    geos.push({ m, vx: rnd(-6, 6), vy: rnd(4, 11), t: 0, mag: false });
  }
}
/* 够到玩家才算捡到：用玩家碰撞盒 + 金币半径做 AABB，不是一个大圆圈 */
function geoHitsPlayer(g) {
  return Math.abs(g.m.position.x - player.x) < player.w / 2 + GEO_R
    && Math.abs(g.m.position.y - (player.y + player.h / 2)) < player.h / 2 + GEO_R;
}
/* 落地：贴到脚下的地形顶面。
   不能像以前那样一律停在 y=0.2 —— 现在金币会长时间留在地上，
   悬在坑里 / 穿过浮空平台都会很显眼。 */
function geoLand(g) {
  const p = g.m.position;
  let top = null;
  for (const s of HK.solids) {
    const q = HK.hitRect(s);
    if (p.x + GEO_R <= q.l || p.x - GEO_R >= q.r) continue;      /* 横向不重叠 */
    if (q.t > p.y + GEO_R) continue;                             /* 顶面在头顶上方 */
    if (q.t < p.y - GEO_R - .4) continue;                        /* 顶面在脚下太远 */
    if (top === null || q.t > top) top = q.t;
  }
  if (top !== null && p.y - GEO_R <= top) {
    p.y = top + GEO_R;
    if (g.vy < 0) g.vy *= -.42;
    g.vx *= .82;
  }
}
function updateGeos(dt) {
  const magR = HK.magnetRv();
  let got = 0;
  for (let i = geos.length - 1; i >= 0; i--) {
    const g = geos[i]; g.t += dt;
    const dx = player.x - g.m.position.x, dy = (player.y + .8) - g.m.position.y;
    const d = Math.hypot(dx, dy) || 1e-6;
    /* 磁吸只来自护符；没装备就永远不吸 */
    g.mag = magR > 0 && g.t > .35 && d < magR;
    if (g.mag) {
      /* 起步要快，不然「自动飞向你」看起来像慢慢挪 */
      const sp = 26;
      g.vx = lerp(g.vx, dx / d * sp, 16 * dt); g.vy = lerp(g.vy, dy / d * sp, 16 * dt);
    } else {
      g.vy -= 42 * dt;
    }
    g.m.position.x += g.vx * dt; g.m.position.y += g.vy * dt;
    g.m.rotation.z += 6 * dt;                            /* 2D：绕 z 自转 */
    if (!g.mag) geoLand(g);
    if (g.m.position.y < -9) { scene.remove(g.m); geos.splice(i, 1); continue; }  /* 掉进深坑就没了 */
    if (geoHitsPlayer(g) && !player.dead) {
      player.geo++; got++; SFX.geo();
      spawnP(g.m.position.x, g.m.position.y, { tl: .25, size: .7, color: 0xffe08a, g: 0 });
      scene.remove(g.m); geos.splice(i, 1);
    }
  }
  /* 拾取后刷新 HUD —— 以前漏了这一步，金币计数要等别的操作才更新 */
  if (got) HK.updHUD();
}

Object.assign(HK, {
  lam, player, pGroup, pMats, ghost,
  slashes, spawnSlash, updateSlashes,
  enemies, makeCrawler, makeFly, makeHusk, makeBoss, spawnList,
  geos, dropGeo, updateGeos
});

})(window.HK);
