/* ============================================================
   模块 4/13：world.js
   瓦片地图（tilemap）/ 地形构建 / 粒子系统 / 积木文字 / 碰撞工具
   ------------------------------------------------------------
   关卡以瓦片地图为唯一数据源：
     HK.tiles = { "tx,ty": code }   格边长 TILE=1 世界单位
   修改瓦片后调用 HongKong.buildLevel(tiles) 重建地形与刷怪表。
   ============================================================ */
(function (HK) {
'use strict';
const { CFG, S, rnd, clamp, scene, GLOW, glowTex } = HK;
const { LEVELW } = CFG;

/* ---------------- 瓦片定义 ---------------- */
const TILE = 1;
const TILE_INFO = {
  solid:   { name: '砖块',   color: '#dff2ff', key: '1' },
  spike:   { name: '尖刺',   color: '#ffd9a0', key: '2' },
  bench:   { name: '座椅',   color: '#9fc8e8', key: '3' },
  spawn:   { name: '出生点', color: '#ffd45a', key: '4' },
  crawler: { name: '爬行虫', color: '#c86a52', key: '5' },
  fly:     { name: '复仇蝇', color: '#8fa8ff', key: '6' },
  husk:    { name: '躯壳兵', color: '#e0dcc8', key: '7' },
  boss:    { name: '假骑士', color: '#c81f2e', key: '8' }
};
const GRID_MINY = -8, GRID_MAXY = 32;
const STORE_KEY = 'hkcube.level.v1';

/* 地图数据（跨模块共享） */
let tiles = {};
const spawnPoint = { x: 3, y: 0 };
const bossSpawn = { x: 244, y: 0 };

/* ---------------- 由旧版硬编码数据生成默认关卡 ---------------- */
function defaultTiles() {
  const t = {};
  const put = (x, y, c) => { t[x + ',' + y] = c; };
  const fill = (x, y, w, h, c) => {
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) put(x + i, y + j, c);
  };
  /* 地面 */
  [[0, -5, 40, 5], [46, -5, 36, 5], [88, -5, 52, 5], [146, -5, 44, 5], [190, -5, 90, 5]]
    .forEach(g => fill(g[0], g[1], g[2], g[3], 'solid'));
  /* 浮空平台 */
  [[14, 3.2, 8], [26, 6.0, 7], [38, 3.4, 5], [50, 4.0, 7], [60, 7.5, 6], [70, 4.5, 6],
   [84, 3.2, 6], [96, 4.5, 8], [108, 7.8, 7], [120, 4.5, 7], [131, 8.0, 5], [138, 3.6, 5],
   [152, 4.6, 8], [164, 7.6, 6], [176, 4.8, 7], [196, 3.4, 6], [216, 2.2, 5], [248, 2.2, 5]]
    .forEach(p => fill(p[0], Math.round(p[1]), p[2], 1, 'solid'));
  /* 尖刺 */
  [[30, 0, 4], [56, 0, 3], [100, 0, 4], [126, 0, 3], [158, 0, 4], [172, 0, 3],
   [40, -5, 6], [82, -5, 6], [140, -5, 6]].forEach(s => fill(s[0], s[1], s[2], 1, 'spike'));
  /* 座椅 */
  put(8, 0, 'bench'); put(148, 0, 'bench');
  /* 出生点 / Boss */
  put(3, 0, 'spawn'); put(244, 0, 'boss');
  /* 敌人 */
  [[18, 0], [24, 0], [53, 4], [66, 0], [98, 0], [111, 8], [124, 0], [154, 0], [166, 8], [178, 0]]
    .forEach(p => put(p[0], p[1], 'crawler'));
  [[34, 4], [58, 9], [86, 5], [104, 6], [134, 10], [160, 9], [182, 6]]
    .forEach(p => put(p[0], p[1], 'fly'));
  [[70, 0], [118, 0], [176, 0]].forEach(p => put(p[0], p[1], 'husk'));
  return t;
}

/* ---------------- 地形数组（就地改写，保证其它模块的引用有效） ---------------- */
const grounds = [], plats = [], solids = [], spikes = [], benches = [];

/* ---------------- 场景分组 ---------------- */
const terrainGroup = new THREE.Group(); scene.add(terrainGroup);
const markerGroup = new THREE.Group(); markerGroup.visible = false; scene.add(markerGroup);
const hoverMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .28, side: THREE.DoubleSide, depthWrite: false }));
hoverMesh.visible = false; scene.add(hoverMesh);

/* 网格 */
let gridGroup = null;
let gridW = -1;
function buildGrid() {
  if (gridGroup) { scene.remove(gridGroup); gridGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  const pts = [];
  const x0 = 0, x1 = S.levelW, y0 = GRID_MINY, y1 = GRID_MAXY;
  for (let x = x0; x <= x1; x++) pts.push(x, y0, -0.2, x, y1, -0.2);
  for (let y = y0; y <= y1; y += 1) pts.push(x0, y, -0.2, x1, y, -0.2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  gridGroup = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x3d86c4, transparent: true, opacity: .26 }));
  gridGroup.visible = false;
  scene.add(gridGroup);
  gridW = S.levelW;
}

/* ---------------- 地形网格构建（全部是平面 = 纯 2D） ---------------- */
const platFill = new THREE.MeshBasicMaterial({ color: 0x0e1e31 });
const edgeMat = new THREE.LineBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: .95 });
const spikeEdgeMat = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: .95 });

function addBox(rect, edgeMaterial) {
  /* PlaneGeometry 的 EdgesGeometry 恰好是那 4 条外框边，所以描边效果不变 */
  const geo = new THREE.PlaneGeometry(rect.w, rect.h);
  const m = new THREE.Mesh(geo, platFill);
  m.position.set(rect.x + rect.w / 2, rect.y + rect.h / 2, 0);
  terrainGroup.add(m);
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMaterial || edgeMat);
  e.position.copy(m.position); terrainGroup.add(e);
}
function addGroundTopLine(x, w, y) {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x, y, .02), new THREE.Vector3(x + w, y, .02)]);
  terrainGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .9 })));
}
function addSpikeStrip(s) {
  const n = Math.max(1, Math.round(s.w / TILE));
  for (let i = 0; i < n; i++) {
    const g = new THREE.PlaneGeometry(.55, .55);
    const m = new THREE.Mesh(g, platFill);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), spikeEdgeMat);
    m.position.set(s.x + (i + .5) * s.w / n, s.y + .3, 0); e.position.copy(m.position);
    m.rotation.z = Math.PI / 4; e.rotation.z = Math.PI / 4;
    terrainGroup.add(m); terrainGroup.add(e);
  }
}
function addBench(b) {
  const seat = new THREE.Mesh(new THREE.PlaneGeometry(2.6, .18), new THREE.MeshBasicMaterial({ color: 0xdff2ff, side: THREE.DoubleSide }));
  seat.position.set(b.x, b.y + .62, 0); terrainGroup.add(seat);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(2.6, .5), new THREE.MeshBasicMaterial({ color: 0x9fc8e8, side: THREE.DoubleSide }));
  back.position.set(b.x, b.y + 1.0, -.05); terrainGroup.add(back);
  for (const lx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.PlaneGeometry(.16, .55), new THREE.MeshBasicMaterial({ color: 0x9fc8e8, side: THREE.DoubleSide }));
    leg.position.set(b.x + lx * 1.0, b.y + .28, -.02); terrainGroup.add(leg);
  }
}
/* 座椅柔光（主循环里呼吸） */
const benchGlows = [];
function refreshBenchGlows() {
  for (const g of benchGlows) scene.remove(g);
  benchGlows.length = 0;
  for (const b of benches) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0x8fd0ff, transparent: true, opacity: .35, depthWrite: false }));
    sp.scale.set(5, 5, 1); sp.position.set(b.x, b.y + 1, 0); scene.add(sp);
    benchGlows.push(sp);
  }
}
/* 编辑器标记（仅编辑模式可见） */
function addMarker(tx, ty, code) {
  const info = TILE_INFO[code]; if (!info) return;
  const col = new THREE.Color(info.color);
  const box = new THREE.Mesh(new THREE.PlaneGeometry(.9, .9),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .18, depthWrite: false, side: THREE.DoubleSide }));
  box.position.set(tx + .5, ty + .5, .3); markerGroup.add(box);
  const ed = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
    new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: .95 }));
  ed.position.copy(box.position); markerGroup.add(ed);
}

/* ---------------- 瓦片 → 地形（矩形合并） ---------------- */
/* 锚点约定（很重要）：
   mergeRects() 产出的是**最小角**坐标（x/y = 矩形左下角，逐格累加而来），
   而 hitRect() 以及所有实体（player/enemy）都按**底部中心**锚点工作
   （l = x - w/2, r = x + w/2, b = y, t = y + h）。
   以前 solids 直接把 r.x 存进去，碰撞盒就整体左移了半个宽度 ——
   画在哪 ≠ 撞在哪。这里统一换算成底部中心，两种表示从此只有一个约定。 */
function pushTerrain(arr, r, h) {
  arr.push({ x: r.x + r.w / 2, y: r.y, w: r.w, h: h === undefined ? r.h : h });
}
/* 尖刺的可碰撞高度（视觉上是 0.55 的菱形，判定盒取 0.6） */
const SPIKE_HIT_H = .6;

function clearTerrain() {
  terrainGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  terrainGroup.clear();
  markerGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  markerGroup.clear();
}
function collect(code) {
  const out = [];
  for (const k in tiles) {
    if (tiles[k] !== code) continue;
    const p = k.split(',');
    out.push([+p[0], +p[1]]);
  }
  return out;
}
/* 贪心矩形分解：把同类型瓦片合并成尽量少的矩形 */
function mergeRects(cells) {
  const set = new Set(cells.map(c => c[0] + ',' + c[1]));
  const used = new Set();
  const rects = [];
  cells.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [x, y] of cells) {
    const key = x + ',' + y;
    if (used.has(key)) continue;
    let w = 1;
    while (set.has((x + w) + ',' + y) && !used.has((x + w) + ',' + y)) w++;
    let h = 1;
    outer: while (true) {
      for (let i = 0; i < w; i++) {
        const k2 = (x + i) + ',' + (y + h);
        if (!set.has(k2) || used.has(k2)) break outer;
      }
      h++;
    }
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) used.add((x + i) + ',' + (y + j));
    rects.push({ x, y, w, h });
  }
  return rects;
}

/* ---------------- 关卡构建入口 ---------------- */
function buildLevel(map) {
  tiles = map || tiles;
  clearTerrain();
  grounds.length = 0; plats.length = 0; solids.length = 0;
  spikes.length = 0; benches.length = 0;

  /* 关卡宽度随地图自适应（导入更大/更小的 .tmx 后镜头边界仍然正确） */
  let maxTx = 0;
  for (const k in tiles) {
    const x = parseInt(k, 10);
    if (Number.isFinite(x) && x > maxTx) maxTx = x;
  }
  const w = Math.max(LEVELW, maxTx + 1);
  if (w !== S.levelW) { S.levelW = w; buildGrid(); }

  /* 砖块 */
  for (const r of mergeRects(collect('solid'))) {
    addBox(r, edgeMat);
    pushTerrain(solids, r);
    if (r.h >= 3) { pushTerrain(grounds, r); addGroundTopLine(r.x, r.w, r.y + r.h); }
    else pushTerrain(plats, r);
  }
  /* 尖刺 */
  for (const r of mergeRects(collect('spike'))) {
    pushTerrain(spikes, r, SPIKE_HIT_H);
    addSpikeStrip({ x: r.x, y: r.y, w: r.w });
  }
  /* 座椅 */
  for (const [x, y] of collect('bench')) { benches.push({ x: x + .5, y }); addBench({ x: x + .5, y }); }
  refreshBenchGlows();

  /* 出生点 / Boss / 刷怪表 */
  const sp = collect('spawn')[0];
  if (sp) { spawnPoint.x = sp[0] + .5; spawnPoint.y = sp[1]; }
  const bs = collect('boss')[0];
  if (bs) { bossSpawn.x = bs[0] + .5; bossSpawn.y = bs[1]; } else { bossSpawn.x = -999; }

  const spawnFns = [];
  const bossAt = bs ? { x: bs[0] + .5, y: bs[1] } : null;
  if (bossAt) spawnFns.push(() => HK.makeBoss(bossAt.x, bossAt.y));
  for (const [x, y] of collect('crawler')) spawnFns.push(() => HK.makeCrawler(x + .5, y));
  for (const [x, y] of collect('fly')) spawnFns.push(() => HK.makeFly(x + .5, y));
  for (const [x, y] of collect('husk')) spawnFns.push(() => HK.makeHusk(x + .5, y));
  HK.spawnList.length = 0;
  spawnFns.forEach(f => HK.spawnList.push(f));

  /* 编辑器标记 */
  for (const k in tiles) {
    const c = tiles[k]; if (c === 'solid' || c === 'spike' || c === 'bench') continue;
    const p = k.split(',');
    addMarker(+p[0], +p[1], c);
  }
  S.levelDirty = false;
}

/* ---------------- 存取 / 导入导出 ---------------- */
function mapToJSON(map) { return JSON.stringify({ v: 1, tile: TILE, tiles: map || tiles }); }
function jsonToMap(str) {
  const o = JSON.parse(str);
  if (!o || !o.tiles) throw new Error('缺少 tiles 字段');
  return o.tiles;
}
function saveMap() {
  try { localStorage.setItem(STORE_KEY, mapToJSON()); return true; } catch (_) { return false; }
}
function loadSavedMap() {
  try {
    const s = localStorage.getItem(STORE_KEY);
    return s ? jsonToMap(s) : null;
  } catch (_) { return null; }
}
function clearSavedMap() { try { localStorage.removeItem(STORE_KEY); } catch (_) {} }

/* ---------------- 粒子系统（池化 Sprite） ---------------- */
const P_MAX = 240, parts = [];
for (let i = 0; i < P_MAX; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.visible = false; scene.add(s);
  parts.push({ s, life: 0, tl: 1, vx: 0, vy: 0, g: 0, size: 1, fade: 1 });
}
let pIdx = 0;
function spawnP(x, y, o = {}) {
  const p = parts[pIdx = (pIdx + 1) % P_MAX];
  p.s.visible = true;
  p.s.position.set(x, y, o.z || 0);
  p.life = p.tl = o.tl || .5;
  p.vx = o.vx || 0; p.vy = o.vy || 0; p.g = o.g ?? 20;
  p.size = o.size || .5; p.fade = o.fade ?? 1;
  p.s.material.color.setHex(o.color ?? 0xbfe6ff);
  p.s.material.blending = o.normal ? THREE.NormalBlending : THREE.AdditiveBlending;
}
function burst(x, y, n, o = {}) {
  for (let i = 0; i < n; i++) {
    const a = rnd(0, 6.28), v = rnd(o.v0 ?? 2, o.v1 ?? 8);
    spawnP(x, y, { ...o, vx: Math.cos(a) * v, vy: Math.sin(a) * v + (o.up || 0) });
  }
}
function updateParts(dt) {
  for (const p of parts) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.s.visible = false; continue; }
    p.vy -= p.g * dt;
    p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt;
    const k = p.life / p.tl;
    p.s.material.opacity = k * p.fade;
    const sc = p.size * (0.6 + 0.4 * k); p.s.scale.set(sc, sc, 1);
  }
}

/* ---------------- 积木文字（视频里的 GO! 效果） ---------------- */
const FONT = {
  'G': ['111', '100', '101', '101', '111'], 'O': ['111', '101', '101', '101', '111'],
  'K': ['101', '101', '110', '101', '101'], '!': ['1', '1', '1', '0', '1'],
  '.': ['0', '0', '0', '0', '1'], 'W': ['101', '101', '101', '111', '101'],
  'I': ['111', '010', '010', '010', '111'], 'N': ['101', '111', '111', '111', '101']
};
const blockCubes = [];
function blockText(str, cx, cy) {
  const cw = .42, total = str.length * (3 * cw + .5);
  let ox = cx - total / 2;
  for (const chr of str) {
    const rows = FONT[chr] || ['111', '101', '101', '101', '111'];
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] !== '1') continue;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(.34, .34),
        new THREE.MeshBasicMaterial({ color: 0xeaf7ff, transparent: true, opacity: 0, side: THREE.DoubleSide }));
      m.position.set(ox + c * cw, cy + (rows.length - 1 - r) * cw, 1.5);
      m.userData = { t: -rnd(0, .5), life: 2.6, y0: m.position.y, ph: rnd(0, 6.28) };
      scene.add(m); blockCubes.push(m);
    }
    ox += 3 * cw + .5;
  }
}
function updateBlocks(dt) {
  for (let i = blockCubes.length - 1; i >= 0; i--) {
    const m = blockCubes[i], u = m.userData;
    u.t += dt;
    if (u.t < 0) continue;
    const k = clamp(u.t * 3, 0, 1), fade = clamp(1 - (u.t - u.life + 1), 0, 1);
    m.material.opacity = k * fade;
    m.position.y = u.y0 + Math.sin(u.ph + u.t * 2) * .08;
    m.rotation.z = u.t * .8;                 /* 2D 平面里改成绕 z 自转 */
    if (u.t > u.life) { scene.remove(m); blockCubes.splice(i, 1); }
  }
}

/* ---------------- 碰撞（中心点 + 宽高） ---------------- */
function overlap(cx, cy, w, h, cx2, cy2, w2, h2) {
  return Math.abs(cx - cx2) < (w + w2) / 2 && Math.abs(cy - cy2) < (h + h2) / 2;
}
/* 以中心底部为锚点的 AABB */
function hitRect(o) { return { l: o.x - o.w / 2, r: o.x + o.w / 2, b: o.y, t: o.y + o.h }; }
function moveAndCollide(ent, dt) {
  /* 水平 */
  ent.x += ent.vx * dt;
  for (const p of solids) {
    const r = hitRect(p), e = hitRect(ent);
    if (e.r > r.l && e.l < r.r && e.t > r.b && e.b < r.t) {
      if (ent.vx > 0) ent.x = r.l - ent.w / 2; else if (ent.vx < 0) ent.x = r.r + ent.w / 2;
      ent.vx = 0;
    }
  }
  /* 垂直 */
  ent.y += ent.vy * dt;
  ent.grounded = false;
  for (const p of solids) {
    const r = hitRect(p), e = hitRect(ent);
    if (e.r > r.l && e.l < r.r && e.t > r.b && e.b < r.t) {
      if (ent.vy <= 0) {
        ent.y = r.t; ent.vy = 0; ent.grounded = true;
      } else {
        ent.y = r.b - ent.h; ent.vy = 0;
      }
    }
  }
}

buildGrid();

Object.assign(HK, {
  TILE, TILE_INFO, GRID_MINY, GRID_MAXY,
  defaultTiles, buildLevel, mapToJSON, jsonToMap, saveMap, loadSavedMap, clearSavedMap,
  terrainGroup, markerGroup, gridGroup: () => gridGroup, hoverMesh, buildGrid,
  spawnPoint, bossSpawn,
  grounds, plats, solids, spikes, benches, platFill, edgeMat, benchGlows, refreshBenchGlows,
  parts, spawnP, burst, updateParts,
  FONT, blockCubes, blockText, updateBlocks,
  overlap, hitRect, moveAndCollide
});
/* 注意：tiles 必须用 defineProperty 暴露 —— Object.assign 会把 getter/setter
   拍平成一个静态数据属性（快照），导致外部读到的永远是 {} 的旧引用。 */
Object.defineProperty(HK, 'tiles', {
  configurable: true, enumerable: true,
  get() { return tiles; },
  set(v) { tiles = v; }
});

})(window.HK);
