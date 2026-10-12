/* ============================================================
   模块 2/12：scene.js
   渲染器 / 正交相机 / 程序化贴图 / 模拟视差背景 / 装饰
   ------------------------------------------------------------
   本工程是**纯 2D**：没有透视错切，没有光照着色。
     - 相机用 OrthographicCamera（正交 = 无透视）。
     - 所有可见物都是平面网格（PlaneGeometry）或 Sprite，
       材质统一 MeshBasicMaterial（不吃光），所以画面是平的。
     - 说明：正交相机下不同 z 之间**没有真实视差**（平行投影下
       平移相机时各深度的位移量完全相同），所以背景视差是按
       「滚动系数 k」手动模拟的，见 updateParallax()。
   ============================================================ */
(function (HK) {
'use strict';
const { CFG, S, rnd, $ } = HK;
const { CAMZ } = CFG;

/* ---------------- three.js 渲染器与场景 ---------------- */
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x04070f);
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
/* 纯 2D 不做雾效：雾按 z 距离计算，正交下各层深度没有物理意义，
   远景层次改由每层自己的 color / opacity 表达（大气透视）。 */

/* ---------------- 正交相机（无透视） ---------------- */
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 400);
camera.position.set(8, 5, CAMZ);
/* 固定可视高度 VIEWH（世界单位），宽度按窗口宽高比扩展：
   画面等比缩放，不会有近大远小。 */
function applyViewport() {
  const a = innerWidth / innerHeight;
  const h = CFG.VIEWH / 2, w = h * a;
  camera.left = -w; camera.right = w; camera.top = h; camera.bottom = -h;
  camera.updateProjectionMatrix();
}
applyViewport();
addEventListener('resize', applyViewport);

/* 当前可见世界尺寸（zoom<1 时看得更广，编辑器缩放用） */
function viewSize() {
  const h = CFG.VIEWH / camera.zoom;
  return { w: h * (innerWidth / innerHeight), h };
}
function setZoom(z) {
  camera.zoom = Math.max(.25, Math.min(4, z));
  camera.updateProjectionMatrix();
}

/* ---------------- 程序化贴图 ---------------- */
function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.35, 'rgba(190,225,255,.55)');
  g.addColorStop(1, 'rgba(140,200,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function slashTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.translate(128, 128);
  x.shadowColor = '#bfe6ff'; x.shadowBlur = 26;
  x.fillStyle = '#ffffff';
  x.beginPath();
  x.arc(0, 0, 104, -1.15, 1.15, false);
  x.arc(14, 0, 58, 1.05, -1.05, true);
  x.closePath(); x.fill();
  return new THREE.CanvasTexture(c);
}
/* 发光蓝砖墙（视差背景用） */
function brickTex() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#081a29'; x.fillRect(0, 0, 512, 512);
  const bw = 128, bh = 64;
  for (let r = 0; r < 8; r++) {
    const off = (r % 2) * bw / 2;
    for (let col = -1; col < 5; col++) {
      const px = col * bw + off, py = r * bh;
      const v = Math.floor(rnd(-8, 10));
      x.fillStyle = `rgb(${16 + v},${38 + v},${56 + v})`;
      x.fillRect(px + 3, py + 3, bw - 6, bh - 6);
      x.fillStyle = 'rgba(0,0,0,.28)';
      x.fillRect(px + 3, py + bh - 10, bw - 6, 7);
    }
  }
  x.strokeStyle = '#39b6ff'; x.lineWidth = 3;
  x.shadowColor = '#1893ff'; x.shadowBlur = 14;
  for (let r = 0; r <= 8; r++) {
    x.beginPath(); x.moveTo(0, r * bh); x.lineTo(512, r * bh); x.stroke();
    const off = (r % 2) * bw / 2;
    for (let col = 0; col < 5; col++) {
      const px = col * bw + off;
      x.beginPath(); x.moveTo(px, r * bh); x.lineTo(px, r * bh + bh); x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const GLOW = glowTex();

/* ---------------- 模拟视差背景（三层） ----------------
   k = 滚动系数：0 = 完全跟随镜头（看起来无穷远），1 = 与世界同速。
   三层用「加色混合」叠起来：砖缝的发光线条会叠加，暗底几乎不贡献，
   于是层与层不会互相盖住，视差移动一眼就能看出来。
   远处层砖小、光弱（雾化），近处层砖大、光强 —— 形成纵深。
   背景板尺寸固定，每帧贴在相机上并滚动贴图 → 永远「走不完」。 */
const brick = brickTex();
const BW = 300, BH = 210, BG_BASE_Y = 22;
const PARALLAX = [
  { z: -34, k: .12, tile: 9, color: 0x2f6288, opacity: .40 },   // 最远：小砖、冷、暗
  { z: -22, k: .32, tile: 14, color: 0x4f92bd, opacity: .30 },  // 中景
  { z: -11, k: .62, tile: 21, color: 0x9ad4ff, opacity: .28 }   // 近景：大砖、亮、薄
];
const bgLayers = PARALLAX.map(L => {
  const map = brick.clone();
  map.needsUpdate = true;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(BW / L.tile, BH / L.tile);
  const mat = new THREE.MeshBasicMaterial({
    map, color: L.color, transparent: true, opacity: L.opacity, depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), mat);
  m.position.set(0, BG_BASE_Y, L.z);
  scene.add(m);
  return { m, mat, map, k: L.k, ky: L.k * .35, tile: L.tile };
});
/* 每帧调用（main.js）：背景贴在相机上 + 按 k 滚动贴图 → 模拟视差 */
function updateParallax(cam) {
  for (const L of bgLayers) {
    L.m.position.x = cam.position.x;
    L.m.position.y = BG_BASE_Y + cam.position.y * (1 - L.ky);
    L.map.offset.x = (L.k * cam.position.x) / L.tile;
    L.map.offset.y = (L.ky * cam.position.y) / L.tile;
  }
}

/* 漂浮碎块装饰（与世界同速，位于背景与地形之间） */
const decoMats = [];
{
  const g = new THREE.PlaneGeometry(.5, .5);
  const put = (x0, x1) => {
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x2e6ea8, transparent: true, opacity: .4, side: THREE.DoubleSide }));
      m.position.set(rnd(x0, x1), rnd(3, 16), rnd(-5.5, -3));
      m.userData = { s: rnd(.2, .7), ph: rnd(0, 6.28), rot: rnd(.2, 1) };
      scene.add(m); decoMats.push(m);
    }
  };
  put(0, 300);            // 默认关卡范围内密一些
  put(300, 1400);         // 远处零星补一些，照顾更宽的地图
}

Object.assign(HK, {
  renderer, scene, camera, GLOW, glowTex, slashTex, decoMats,
  bgLayers, updateParallax, viewSize, setZoom, applyViewport
});

})(window.HK);
