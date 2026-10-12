/* ============================================================
   模块 12/12：editor.js
   瓦片地图关卡编辑器
   ------------------------------------------------------------
   进入/退出：` 或 F2（标题界面也可用）
   绘制：左键涂、右键擦、拖拽连续、Shift+左键矩形填充
   视角：WASD/方向键 平移、滚轮缩放、中键拖拽平移
   工具：1-8 瓦片、9 擦除、G 网格、Ctrl+S 保存、Ctrl+Z 撤销
   ============================================================ */
(function (HK) {
'use strict';
const { S, CFG, $, scene, camera, clamp, showHint } = HK;


const TILE_ORDER = Object.keys(HK.TILE_INFO);   // 与 world.js 的 TILE_INFO 保持同一顺序（单一数据源）
let tool = 'solid';
let on = false;
let dirty = false, dirtyAt = 0;
let hover = null;
let rectAnchor = null;          // Shift 矩形填充起点
const undoStack = [];
const panKeys = { l: false, r: false, u: false, d: false };
let panDrag = null;             // 中键拖拽
let painting = 0;               // 0 无 / 1 涂 / 2 擦
const PAN_SPEED = 22;

/* ---------------- 面板构建 ---------------- */
function buildPalette() {
  const box = $('ed-palette');
  box.innerHTML = '';
  TILE_ORDER.forEach((code, i) => {
    const info = HK.TILE_INFO[code];
    const b = document.createElement('button');
    b.className = 'ed-tile' + (tool === code ? ' on' : '');
    b.title = `${info.name}（${i + 1}）`;
    b.innerHTML = `<span class="sw" style="background:${info.color}"></span>${info.name}<em>${i + 1}</em>`;
    b.addEventListener('click', () => { tool = code; buildPalette(); });
    box.appendChild(b);
  });
  const e = document.createElement('button');
  e.className = 'ed-tile' + (tool === '' ? ' on' : '');
  e.title = '擦除（9）';
  e.innerHTML = `<span class="sw" style="background:#3a4a63"></span>擦除<em>9</em>`;
  e.addEventListener('click', () => { tool = ''; buildPalette(); });
  box.appendChild(e);
}
function updStats() {
  const n = Object.keys(HK.tiles).length;
  $('ed-stats').textContent = `瓦片 ${n} · 砖块 ${HK.solids.length} · 刷怪 ${HK.spawnList.length} · 当前工具 ${tool ? HK.TILE_INFO[tool].name : '擦除'}`;
}

/* ---------------- 瓦片读写 ---------------- */
function setTile(tx, ty, code) {
  const k = tx + ',' + ty;
  const has = Object.prototype.hasOwnProperty.call(HK.tiles, k);
  if (!code) { if (!has) return false; delete HK.tiles[k]; }
  else { if (HK.tiles[k] === code) return false; HK.tiles[k] = code; }
  dirty = true; dirtyAt = performance.now();
  return true;
}
function pushUndo() {
  undoStack.push(JSON.stringify(HK.tiles));
  if (undoStack.length > 40) undoStack.shift();
}
function undo() {
  if (!undoStack.length) { showHint('没有可撤销的操作', 1); return; }
  HK.tiles = JSON.parse(undoStack.pop());
  rebuild(true);
}
/* 重建地形（限频，避免拖拽绘制时卡顿） */
function rebuild(force) {
  if (!dirty && !force) return;
  HK.buildLevel(HK.tiles);
  Markers();
  dirty = false;
  updStats();
}
function Markers() {
  HK.markerGroup.visible = on;
  HK.gridGroup().visible = on && gridOn;
  HK.hoverMesh.visible = on;
}
let gridOn = true;

/* ---------------- 屏幕 → 瓦片 ---------------- */
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const hitPoint = new THREE.Vector3();
function toTile(clientX, clientY) {
  const r = HK.renderer.domElement.getBoundingClientRect();
  const nx = ((clientX - r.left) / r.width) * 2 - 1;
  const ny = -((clientY - r.top) / r.height) * 2 + 1;
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  if (!ray.ray.intersectPlane(plane, hitPoint)) return null;
  return { tx: Math.floor(hitPoint.x), ty: Math.floor(hitPoint.y), wx: hitPoint.x, wy: hitPoint.y };
}

/* ---------------- 鼠标 ---------------- */
function initMouse() {
  const el = HK.renderer.domElement;
  el.addEventListener('contextmenu', e => { if (on) e.preventDefault(); });
  el.addEventListener('pointerdown', e => {
    if (!on) return;
    const t = toTile(e.clientX, e.clientY); if (!t) return;
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    if (e.button === 1) { panDrag = { x: e.clientX, y: e.clientY }; return; }
    if (e.button === 2) { painting = 2; pushUndo(); setTile(t.tx, t.ty, ''); return; }
    if (e.button === 0) {
      if (e.shiftKey) { rectAnchor = t; return; }
      painting = 1; pushUndo(); setTile(t.tx, t.ty, tool);
    }
  });
  el.addEventListener('pointermove', e => {
    if (!on) return;
    const t = toTile(e.clientX, e.clientY); if (!t) return;
    hover = t;
    HK.hoverMesh.position.set(t.tx + .5, t.ty + .5, .5);
    if (panDrag) {
      const k = 1 / camera.zoom;   /* 正交：缩放用 camera.zoom */
      camera.position.x -= (e.clientX - panDrag.x) * .055 * k;
      camera.position.y += (e.clientY - panDrag.y) * .055 * k;
      panDrag = { x: e.clientX, y: e.clientY };
      return;
    }
    if (painting === 1) setTile(t.tx, t.ty, tool);
    else if (painting === 2) setTile(t.tx, t.ty, '');
  });
  const end = e => {
    if (!on) return;
    if (rectAnchor && hover) {
      pushUndo();
      const x0 = Math.min(rectAnchor.tx, hover.tx), x1 = Math.max(rectAnchor.tx, hover.tx);
      const y0 = Math.min(rectAnchor.ty, hover.ty), y1 = Math.max(rectAnchor.ty, hover.ty);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) setTile(x, y, tool);
      rectAnchor = null; rebuild(true);
    }
    painting = 0; panDrag = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', e => {
    if (!on) return;
    e.preventDefault();
    HK.setZoom(camera.zoom * (1 - Math.sign(e.deltaY) * .12));
  }, { passive: false });
}

/* ---------------- 键盘 ---------------- */
function initKeys() {
  addEventListener('keydown', e => {
    if (!on) return;
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3' || e.code === 'Digit4' ||
      e.code === 'Digit5' || e.code === 'Digit6' || e.code === 'Digit7' || e.code === 'Digit8') {
      tool = TILE_ORDER[+e.code.slice(5) - 1]; buildPalette(); return;
    }
    if (e.code === 'Digit9') { tool = ''; buildPalette(); return; }
    if (e.code === 'KeyG') { gridOn = !gridOn; HK.gridGroup().visible = gridOn; showHint(gridOn ? '网格 开' : '网格 关', 1); return; }
    if (e.code === 'Escape') { e.preventDefault(); exitEditor(false); return; }
    if (e.code === 'Delete' || e.code === 'Backspace') { pushUndo(); clearAt(); return; }
    if (e.ctrlKey && e.code === 'KeyS') { e.preventDefault(); HK.saveMap(); showHint('已保存到浏览器本地（localStorage）', 2); return; }
    if (e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); undo(); return; }
  });
  addEventListener('keyup', () => { });
}
function clearAt() {
  if (!hover) return;
  setTile(hover.tx, hover.ty, '');
}

/* ---------------- 编辑器开关 ---------------- */
let prevState = 'title';
let prevZoom = 1;
function enterEditor() {
  if (on) return;
  on = true;
  prevState = S.state;
  prevZoom = camera.zoom;
  S.editor = true; S.paused = false;
  S.charmOpen = false; $('charmov').classList.add('hidden');
  HK.markerGroup.visible = true;
  HK.gridGroup().visible = gridOn;
  HK.hoverMesh.visible = true;
  HK.pGroup.visible = false;
  for (const e of HK.enemies) e.g.visible = false;
  for (const b of HK.blockCubes) b.visible = false;
  $('editorUI').classList.remove('hidden');
  /* 进入编辑时收起所有全屏覆盖层，否则它们会挡住面板上的点击 */
  $('titleov').classList.add('hidden');
  $('winov').classList.add('hidden');
  $('deadov').classList.add('hidden');
  $('pauseov').classList.add('hidden');
  $('jsonov').classList.add('hidden');
  document.body.classList.add('editing');
  /* 镜头拉远到适合铺瓦片的高度 */
  HK.setZoom(prevZoom * .55);          /* 正交下用 zoom 拉远，不是移动 z */
  buildPalette(); updStats();
  showHint('编辑模式：左键涂 / 右键擦 / Shift 框选 / WASD 平移 / 滚轮缩放 / ` 退出', 4);
}
/* runGame=true：立刻用当前瓦片地图重开一局；否则退回进入前的界面 */
function exitEditor(runGame) {
  if (!on) return;
  on = false; S.editor = false;
  HK.markerGroup.visible = false;
  HK.gridGroup().visible = false;
  HK.hoverMesh.visible = false;
  $('editorUI').classList.add('hidden');
  $('jsonov').classList.add('hidden');
  document.body.classList.remove('editing');
  for (const b of HK.blockCubes) b.visible = true;
  HK.pGroup.visible = true;
  for (const e of HK.enemies) e.g.visible = true;
  HK.setZoom(prevZoom);
  rectAnchor = null; hover = null; painting = 0; panDrag = null;
  rebuild(true);                       /* 把当前瓦片编译成地形 */
  if (runGame) {
    HK.applyLevelAndRestart(HK.tiles);
  } else {
    S.state = prevState;
    $('titleov').classList.toggle('hidden', prevState !== 'title');
    $('winov').classList.add('hidden');
    $('deadov').classList.add('hidden');
    HK.resetLevel(true);
    HK.updHUD();
  }
}
function toggleEditor() {
  if (on) exitEditor(false); else enterEditor();
}

/* ---------------- 存 / 读 / 导入导出 ---------------- */
let fileMode = 'json';                 // 'json' | 'tmx'
const FILE_UI = {
  json: {
    title: '关卡 JSON', sub: '复制文本框内容即可保存为 .json',
    ext: '.json', mime: 'application/json;charset=utf-8',
    ph: '{"v":1,"tile":1,"tiles":{"0,0":"solid"}}'
  },
  tmx: {
    title: '关卡 TMX（Tiled）', sub: '导出后可在 Tiled 里继续编辑，改完再导入回来',
    ext: '.tmx', mime: 'application/xml;charset=utf-8',
    ph: '<?xml version="1.0" encoding="UTF-8"?>\n<map orientation="orthogonal" ...>'
  }
};
/* 打开文件面板：text 为空则当作「导入」用，直接弹文件选择框 */
function openFilePanel(mode, text, pick) {
  fileMode = mode;
  const ui = FILE_UI[mode];
  $('file-title').firstChild.nodeValue = ui.title;
  $('file-sub').textContent = ui.sub;
  const ta = $('jsonarea');
  ta.placeholder = ui.ph;
  ta.value = text || '';
  ta.readOnly = false;
  $('filedl').textContent = '下载 ' + ui.ext;
  $('dlpng').classList.toggle('hidden', mode !== 'tmx');
  $('jsonov').classList.remove('hidden');
  if (pick) $('tmxfile').click();
}
function setFileTip(s) { $('file-tip').textContent = s || ''; }

/* 把 .tmx / .json 文本解析成瓦片表（异步：base64+zlib 需要解压） */
async function parseByMode(mode, text) {
  if (mode === 'tmx') {
    const r = await HK.tmx.parseTMX(text);
    return { tiles: r.tiles, meta: r.meta };
  }
  return { tiles: HK.jsonToMap(text), meta: null };
}
/* 统一的「导入 → 应用 → 重建」入口，.tmx / JSON / 本地存档都走这里 */
async function applyText(mode, text) {
  const { tiles, meta } = await parseByMode(mode, text);
  if (!tiles || !Object.keys(tiles).length) throw new Error('没有解析到任何瓦片');
  pushUndo();
  HK.tiles = tiles;
  rebuild(true);
  if (meta) {
    const wm = meta.warnings && meta.warnings.length ? ' · ' + meta.warnings[0] : '';
    setFileTip(`已导入 ${meta.width}×${meta.height} 格 · 图层 ${meta.layers} · 瓦片 ${meta.cells}` +
      (meta.objects ? ` · 对象 ${meta.objects}` : '') + wm);
    showHint(`TMX 导入成功：${meta.cells} 个瓦片（地图 ${meta.width}×${meta.height}）`, 2.4);
  } else {
    showHint('JSON 导入成功', 1.6);
  }
  $('jsonov').classList.add('hidden');
}
function readFileAsText(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(new Error('读取文件失败'));
    fr.readAsText(file);
  });
}

function initTools() {
  document.querySelectorAll('#editorUI .ed-tools button').forEach(b => {
    b.addEventListener('click', () => {
      const cmd = b.dataset.cmd;
      if (cmd === 'save') { HK.saveMap(); showHint('已保存到浏览器本地（localStorage）', 2); }
      else if (cmd === 'load') {
        const m = HK.loadSavedMap();
        if (m) { pushUndo(); HK.tiles = m; rebuild(true); showHint('已读取本地存档', 1.5); }
        else showHint('没有本地存档', 1.5);
      }
      else if (cmd === 'export') { setFileTip(''); openFilePanel('json', HK.mapToJSON(HK.tiles), false); }
      else if (cmd === 'import') { setFileTip('粘贴 JSON 后点「应用导入」，或点「选择文件…」挑一个 .json'); openFilePanel('json', '', false); }
      else if (cmd === 'tmxexport') {
        setFileTip('把 .tmx 和 tiles.png 放到同一目录，Tiled 就能直接打开；点「下载 tiles.png」拿到图集。');
        openFilePanel('tmx', HK.tmx.mapToTMX(HK.tiles), false);
      }
      else if (cmd === 'tmximport') {
        setFileTip('选择 .tmx 文件，或把内容粘贴进来后点「应用导入」。支持 CSV / base64(zlib·gzip) / XML 数据，无限地图 chunk 与对象层也可读。');
        openFilePanel('tmx', '', true);
      }
      else if (cmd === 'reset') {
        if (confirm('恢复默认关卡？当前未保存的修改会丢失。')) {
          pushUndo(); HK.clearSavedMap();
          HK.tiles = HK.defaultTiles(); rebuild(true);
          showHint('已恢复默认关卡', 1.5);
        }
      }
      else if (cmd === 'grid') { gridOn = !gridOn; HK.gridGroup().visible = gridOn; }
      else if (cmd === 'test') exitEditor(true);
    });
  });

  $('jsonapply').addEventListener('click', async () => {
    const btn = $('jsonapply');
    btn.disabled = true; setFileTip('解析中…');
    try { await applyText(fileMode, $('jsonarea').value); }
    catch (err) { setFileTip('导入失败：' + err.message); showHint('导入失败：' + err.message, 3); }
    finally { btn.disabled = false; }
  });
  $('jsoncopy').addEventListener('click', () => {
    const ta = $('jsonarea'); ta.select();
    try { document.execCommand('copy'); showHint('已复制到剪贴板', 1.5); } catch (_) { showHint('复制失败，请手动选择', 1.5); }
  });
  $('filedl').addEventListener('click', () => {
    const ui = FILE_UI[fileMode];
    HK.tmx.downloadText($('jsonarea').value, 'hollow-knight-level' + ui.ext, ui.mime);
    showHint('已下载 hollow-knight-level' + ui.ext, 1.6);
  });
  $('dlpng').addEventListener('click', () => { HK.tmx.downloadTileset(); showHint('已下载 ' + HK.tmx.TS_IMG, 1.6); });
  $('jsonpick').addEventListener('click', () => $('tmxfile').click());
  $('jsonclose').addEventListener('click', () => $('jsonov').classList.add('hidden'));

  $('tmxfile').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const isTmx = /\.(tmx|xml)$/i.test(f.name);
    try {
      const text = await readFileAsText(f);
      if (!on) enterEditor();
      if (isTmx) {
        openFilePanel('tmx', text, false);
        await applyText('tmx', text);
      } else {
        openFilePanel('json', text, false);
        await applyText('json', text);
      }
    } catch (err) {
      showHint('读取失败：' + err.message, 3);
      setFileTip('读取失败：' + err.message);
    }
  });
}

/* ---------------- 每帧（由主循环调用） ---------------- */
function editorTick(dt) {
  /* 平移 */
  const k = (1 / camera.zoom) * PAN_SPEED * dt;
  const keys = HK.keys;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) camera.position.x -= k;
  if (keys.has('KeyD') || keys.has('ArrowRight')) camera.position.x += k;
  if (keys.has('KeyW') || keys.has('ArrowUp')) camera.position.y += k;
  if (keys.has('KeyS') || keys.has('ArrowDown')) camera.position.y -= k;
  camera.position.x = clamp(camera.position.x, -6, S.levelW + 6);
  camera.position.y = clamp(camera.position.y, HK.GRID_MINY + 4, HK.GRID_MAXY - 4);

  /* 拖拽绘制时节流重建 */
  if (dirty && performance.now() - dirtyAt > 140) rebuild(true);

  /* 框选预览 */
  if (rectAnchor && hover) {
    const x0 = Math.min(rectAnchor.tx, hover.tx), x1 = Math.max(rectAnchor.tx, hover.tx);
    const y0 = Math.min(rectAnchor.ty, hover.ty), y1 = Math.max(rectAnchor.ty, hover.ty);
    HK.hoverMesh.position.set((x0 + x1) / 2 + .5, (y0 + y1) / 2 + .5, .5);
    HK.hoverMesh.scale.set(x1 - x0 + 1, y1 - y0 + 1, 1);
  } else {
    HK.hoverMesh.scale.set(1, 1, 1);
  }
  const info = tool ? HK.TILE_INFO[tool] : { color: '#3a4a63' };
  HK.hoverMesh.material.color.set(info.color);
  HK.hoverMesh.material.opacity = .25 + .1 * Math.sin(S.playT * 4 + performance.now() / 400);
}

initMouse(); initKeys(); initTools();
buildPalette();

Object.assign(HK, {
  toggleEditor, enterEditor, exitEditor, editorTick,
  editorTool: { get: () => tool, set: v => { tool = v; buildPalette(); } },
  editorRebuild: () => rebuild(true),
  editorUndo: undo,
  /* 供控制台 / 测试使用 */
  editorApplyText: applyText,
  editorOpenFile: (mode, text) => openFilePanel(mode, text, false)
});
/* editorOpen 用 defineProperty 暴露（Object.assign 会把 getter 拍平成静态快照） */
Object.defineProperty(HK, 'editorOpen', {
  configurable: true, enumerable: true,
  get() { return on; }
});

})(window.HK);
