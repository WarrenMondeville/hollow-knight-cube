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
/* 背景贴图是一次性烘焙的（画进 canvas 当贴图用），所以用本地固定种子的 PRNG：
   同一份代码每次打开长得一模一样 —— 改背景时能直接前后对比截图。
   用 Math.random 的话每次刷新树的位置都变，没法比。 */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* 天空底：一条竖直渐变。地平线那一带的辉光放在 y = 61.25%（见 SKY.h 的注释） */
function skyTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 512;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.000, '#03070e');   // 天顶
  g.addColorStop(.300, '#071829');
  g.addColorStop(.450, '#0d2740');
  g.addColorStop(.580, '#15496f');
  g.addColorStop(.613, '#1d5b86');    // ← 地平线辉光
  g.addColorStop(.660, '#123a58');
  g.addColorStop(1.000, '#061321');
  x.fillStyle = g; x.fillRect(0, 0, 64, 512);
  return new THREE.CanvasTexture(c);
}
/* 远景 · 云：实心椭圆 + canvas 模糊 = 软边云团（纯径向渐变会糊成一片雾）。
   每个云团都在 x±W 各画一遍 → 左右无缝。 */
function cloudTex() {
  const W = 1024, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const R = prng(20261012);
  const clouds = [];
  for (let i = 0; i < 6; i++) {
    clouds.push({ cx: R() * W, cy: H * (.10 + R() * .46), s: .55 + R() * .55, a: .13 + R() * .15, ph: R() * 6.28 });
  }
  for (const cl of clouds) {
    for (const dx of [-W, 0, W]) {
      x.save();
      x.filter = 'blur(14px)';                      /* 一次烘焙，性能无所谓 */
      x.fillStyle = `rgba(190,216,240,${cl.a})`;
      const n = 6;
      for (let j = 0; j < n; j++) {
        const t = j / (n - 1);
        const r = (34 + Math.sin(t * Math.PI) * 34) * cl.s;
        x.beginPath();
        x.ellipse(cl.cx + dx + (t - .5) * 150 * cl.s,
                  cl.cy + Math.cos(t * Math.PI * 1.7 + cl.ph) * 11 * cl.s,
                  r, r * .56, 0, 0, 6.2832);
        x.fill();
      }
      x.restore();
    }
  }
  return new THREE.CanvasTexture(c);
}
/* 中景 · 山：两道山脊。高度用**整数频率**的正弦叠加 → 天然左右无缝 */
function ridgeH(t, w, f, p) {
  let h = 0;
  for (let i = 0; i < w.length; i++) h += w[i] * Math.sin(t * f[i] + p[i]);
  h += Math.abs(Math.sin(t * f[f.length - 1] + p[p.length - 1])) * w[w.length - 1];
  return h;
}
function mountainTex() {
  const W = 1024, H = 512, TAU = Math.PI * 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const baseY = H * .66;                       // 山脚（自下算 f = .34）
  const R = prng(7788);
  const bands = [
    { col: 'rgba(26,62,94,.92)', amp: 150, y0: 14, w: [.55, .3, .15], f: [1, 3, 7], p: [R() * 6, R() * 6, R() * 6, R() * 6], pow: 1.5 },
    { col: 'rgba(12,36,58,1)',   amp: 116, y0: 0,  w: [.5, .34, .16], f: [2, 5, 11], p: [R() * 6, R() * 6, R() * 6, R() * 6], pow: 1.7 }
  ];
  for (const b of bands) {
    x.fillStyle = b.col;
    x.beginPath();
    x.moveTo(0, H);
    const N = 256;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const h = Math.pow(Math.max(0, ridgeH(u * TAU, b.w, b.f, b.p) * .62 + .5), b.pow);
      x.lineTo(u * W, baseY - b.y0 - h * b.amp);
    }
    x.lineTo(W, H); x.closePath(); x.fill();
  }
  return new THREE.CanvasTexture(c);
}
/* 近景 · 树：两排针叶 / 圆冠剪影，前排高一点、深一点。同样左右无缝 */
function treeTex() {
  const W = 1024, H = 1024;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const baseY = H * .72;                       // 树脚（自下算 f = .28）
  const R = prng(4242);
  const rows = [
    { n: 8, col: 'rgba(20,52,79,.95)', h: [200, 280], w: [44, 62] },   // 后排：矮、亮一点
    { n: 6, col: 'rgba(7,24,39,1)',    h: [280, 386], w: [56, 80] }    // 前排：高、深
  ];
  for (const row of rows) {
    const gap = W / row.n;
    for (let i = 0; i < row.n; i++) {
      const cx = gap * (i + .5) + (R() - .5) * gap * .45;
      const th = row.h[0] + R() * (row.h[1] - row.h[0]);
      const tw = row.w[0] + R() * (row.w[1] - row.w[0]);
      const pine = R() < .62;
      for (const dx of [-W, 0, W]) {
        const bx = cx + dx;
        x.fillStyle = row.col;
        /* 树干：一定要够高，让树冠和树干**重叠**（否则树冠会浮在半空） */
        x.fillRect(bx - tw * .07, baseY - th * .48, tw * .14, th * .50);
        if (pine) {
          /* 针叶：三层三角，底边接住树干顶端 */
          for (let k = 0; k < 3; k++) {
            const kt = k / 3, t2 = (k + 1) / 3;
            const hw = tw * (.5 - kt * .22), y1 = baseY - th * (.38 + kt * .30), y2 = baseY - th * (.30 + t2 * .52);
            x.beginPath(); x.moveTo(bx - hw, y1); x.lineTo(bx + hw, y1); x.lineTo(bx, y2); x.closePath(); x.fill();
          }
        } else {
          /* 圆冠：一团重叠的椭圆，中心压在树干上 */
          const cy = baseY - th * .55, rr = tw * .52;
          for (let k = 0; k < 5; k++) {
            x.beginPath();
            x.ellipse(bx + (k - 2) * rr * .42, cy + (k % 2 ? -rr * .30 : rr * .16), rr * (.85 - k * .07), rr * (.72 - k * .05), 0, 0, 6.2832);
            x.fill();
          }
        }
      }
    }
  }
  return new THREE.CanvasTexture(c);
}
const GLOW = glowTex();

/* ---------------- 模拟视差背景：远景云 / 中景山 / 近景树 ----------------
   正交相机**没有真实视差**（平行投影下各深度位移完全相同），所以视差是手写的：
   每层是一块钉在镜头上的背景板，每帧把贴图回卷 k×相机位移，看起来就是深度不同的滚动。
     k = 0 完全跟随镜头（无穷远）→ k = 1 与世界同速。
   贴图必须是**左右无缝**的（canvas 里每个形状都在 x±W 各画一遍），否则接缝会跟着滚动。
   层高 h 比可视高度大：背景板竖直方向也要罩住画面（相机 y 随玩家升高，见 input.js updCamera）。
   竖直方向**不再单独回卷贴图**，只让背景板按 (1-ky) 跟随镜头 —— 两处都算等于视差算了两遍。 */
const BW = 300;                                  // 背景板宽度（够宽，贴图上永远走不完）
const SKY = { w: 420, h: 40, z: -70 };           // 天空底：一块永远跟着镜头的渐变板
const PARALLAX = [
  { tex: cloudTex,    z: -34, k: .12, tile: 26, h: 12, yOff: 1.5 },   // 远景 · 云
  { tex: mountainTex, z: -22, k: .32, tile: 30, h: 16, yOff: 0.9 },   // 中景 · 山
  { tex: treeTex,     z: -11, k: .62, tile: 24, h: 18, yOff: -0.6 }   // 近景 · 树
];
const skyMap = skyTex();
const skyMat = new THREE.MeshBasicMaterial({ map: skyMap, depthWrite: false });
const sky = new THREE.Mesh(new THREE.PlaneGeometry(SKY.w, SKY.h), skyMat);
sky.position.set(0, 0, SKY.z);
scene.add(sky);

/* 层纹理：一张 canvas 正好铺满整块背景板（repeat.y = 1），
   横向按 tile（= 一个贴图周期对应多少世界单位）平铺。 */
const bgLayers = PARALLAX.map(L => {
  const map = L.tex();
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(BW / L.tile, 1);
  const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(BW, L.h), mat);
  m.position.set(0, L.yOff, L.z);
  scene.add(m);
  /* 注意 ky 只作用于背景板的位置，不再重复作用到贴图 offset.y 上 */
  return { m, mat, map, k: L.k, ky: L.k * .35, tile: L.tile, h: L.h, yOff: L.yOff };
});
/* 每帧调用（main.js）：背景贴住镜头 + 横向按 k 回卷贴图 → 模拟视差 */
function updateParallax(cam) {
  sky.position.x = cam.position.x;
  sky.position.y = cam.position.y;               // 天空无穷远：完全跟随镜头
  for (const L of bgLayers) {
    L.m.position.x = cam.position.x;
    L.m.position.y = L.yOff + cam.position.y * (1 - L.ky);
    /* offset 是贴图坐标：滚 k×位移的世界长度，换算成贴图周期数要除以 tile */
    L.map.offset.x = (L.k * cam.position.x) / L.tile;
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
  sky, bgLayers, updateParallax, viewSize, setZoom, applyViewport
});

})(window.HK);
