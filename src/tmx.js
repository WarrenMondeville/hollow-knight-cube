/* ============================================================
   模块 12/13：tmx.js
   Tiled (.tmx) 导入 / 导出
   ------------------------------------------------------------
   坐标换算（本工程 ty 向上为正，Tiled 行号向下为正）：
       tx = ox + tiledX
       ty = oyTop - tiledY
     导出时把 ox / oyTop 写进 <map><properties>（hk_origin_x / hk_top_y），
     因此「导出 → 在 Tiled 里编辑 → 再导入」可以无损往返。
   ------------------------------------------------------------
   瓦片类型映射：
     导出：每个 <tile id="n" type="solid"> 带上类型名（Tiled 1.9+ 会读 type，
           第三方加载器 / Unity 导入器同样读 type）
     导入：依次尝试 tile 的 type / class / properties / name，
           再尝试中文名与常见英文别名（ground→solid、start→spawn…），
           最后回退到「tileset 内第 n 个瓦片 = 第 n 种类型」
   ------------------------------------------------------------
   支持：CSV / base64(zlib|gzip|未压缩) / XML <tile> 三种数据编码、
         无限地图 <chunk>、多图层合并、对象层（矩形→砖块，点→出生点）。
   ============================================================ */
(function (HK) {
'use strict';

const TW = 32, TH = 32;                        // tmx 内的像素瓦片尺寸（只影响在 Tiled 里的显示比例）
const TS_NAME = 'hollow-knight-cube';
const TS_IMG = 'hollow_knight_tiles.png';
const GID_MASK = 0x0FFFFFFF;                   // 抹掉翻转标志位

/* ---------------- 类型名解析 ---------------- */
const ALIAS = {
  ground: 'solid', floor: 'solid', wall: 'solid', block: 'solid', brick: 'solid',
  platform: 'solid', terrain: 'solid', rock: 'solid',
  hazard: 'spike', spikes: 'spike', thorn: 'spike', trap: 'spike',
  checkpoint: 'bench', save: 'bench', seat: 'bench', rest: 'bench',
  start: 'spawn', player: 'spawn', spawnpoint: 'spawn', spawn_point: 'spawn', entry: 'spawn',
  bug: 'crawler', walker: 'crawler', crawlid: 'crawler',
  flying: 'fly', bat: 'fly', vengefly: 'fly',
  soldier: 'husk', guard: 'husk', enemy: 'husk', husk_sentry: 'husk',
  knight: 'boss', falseknight: 'boss', false_knight: 'boss'
};
function order() { return Object.keys(HK.TILE_INFO); }
/* 可识别的名字 → 类型码（含中文名、英文别名、大小写不敏感） */
function nameIndex() {
  const ix = {};
  for (const c of order()) { ix[c.toLowerCase()] = c; ix[HK.TILE_INFO[c].name] = c; }
  for (const k in ALIAS) if (!ix[k]) ix[k] = ALIAS[k];
  return ix;
}
function normCode(v) {
  if (v == null) return null;
  const s = String(v).trim(); if (!s) return null;
  const ix = nameIndex();
  return ix[s.toLowerCase()] || ix[s] || null;
}

/* ---------------- 导出 ---------------- */
function bounds(tiles) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const k in tiles) {
    const i = k.indexOf(',');
    const x = +k.slice(0, i), y = +k.slice(i + 1);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (!Number.isFinite(x0)) return { x0: 0, x1: 0, y0: 0, y1: 0, empty: true };
  return { x0, x1, y0, y1, empty: false };
}

function mapToTMX(map) {
  const tiles = map || HK.tiles;
  const ord = order();
  const b = bounds(tiles);
  const ox = b.x0, oyTop = b.y1;
  const w = Math.max(1, b.x1 - ox + 1);
  const h = Math.max(1, oyTop - b.y0 + 1);
  const gidOf = c => { const i = ord.indexOf(c); return i < 0 ? 0 : i + 1; };

  const rows = [];
  for (let r = 0; r < h; r++) {
    const ty = oyTop - r;
    const row = new Array(w);
    for (let i = 0; i < w; i++) {
      const c = tiles[(ox + i) + ',' + ty];
      row[i] = c ? gidOf(c) : 0;
    }
    /* 注意：CSV 行必须顶格写（不加缩进），与 Tiled 自身输出一致，
       否则部分第三方解析器会把行首空白当成数据。 */
    rows.push(row.join(',') + ',');
  }

  const ts = [` <tileset firstgid="1" name="${TS_NAME}" tilewidth="${TW}" tileheight="${TH}" spacing="0" margin="0" tilecount="${ord.length}" columns="${ord.length}">`,
  `  <image source="${TS_IMG}" width="${TW * ord.length}" height="${TH}"/>`];
  ord.forEach((c, i) => ts.push(`  <tile id="${i}" type="${c}"/>`));
  ts.push(' </tileset>');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<map version="1.10" tiledversion="1.10.2" orientation="orthogonal" renderorder="right-down" ` +
    `width="${w}" height="${h}" tilewidth="${TW}" tileheight="${TH}" infinite="0" ` +
    `nextlayerid="2" nextobjectid="1">`,
    ' <properties>',
    `  <property name="hk_origin_x" type="int" value="${ox}"/>`,
    `  <property name="hk_top_y" type="int" value="${oyTop}"/>`,
    `  <property name="hk_level_width" type="int" value="${HK.S.levelW}"/>`,
    ' </properties>',
    ...ts,
    ` <layer id="1" name="tiles" width="${w}" height="${h}">`,
    '  <data encoding="csv">',
    ...rows,
    '  </data>',
    ' </layer>',
    '</map>',
    ''
  ].join('\n');
}

/* ---------------- 导入 ---------------- */
const at = (el, n, d) => { const v = el.getAttribute(n); return v == null ? d : v; };
const kids = (el, tag) => { const o = []; for (const c of el.children) if (c.tagName === tag) o.push(c); return o; };

async function inflate(bytes, comp) {
  const fmt = comp === 'gzip' ? 'gzip' : comp === 'zlib' ? 'deflate' : null;
  if (!fmt) throw new Error(`暂不支持 compression="${comp}"，请改用 zlib / gzip 或不压缩`);
  if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持 DecompressionStream，无法解压');
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(fmt));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

async function decodeData(el, enc, comp) {
  if (enc === 'csv') {
    const out = [];
    for (const s of el.textContent.split(/[\s,]+/)) if (s) out.push(+s || 0);
    return out;
  }
  if (enc === 'base64') {
    let bin;
    try { bin = atob(el.textContent.replace(/\s+/g, '')); }
    catch (_) { throw new Error('base64 数据损坏'); }
    let bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (comp && comp !== 'none') bytes = await inflate(bytes, comp);
    const n = bytes.length >>> 2;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = dv.getUint32(i * 4, true);
    return out;
  }
  /* 无 encoding：<tile gid="n"/> */
  const out = [];
  for (const t of kids(el, 'tile')) out.push(+at(t, 'gid', 0) || 0);
  return out;
}

async function parseTMX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const perr = doc.getElementsByTagName('parsererror')[0];
  if (perr) throw new Error('XML 解析失败：' + (perr.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100));
  const root = doc.documentElement;
  const mapEl = root && root.tagName === 'map' ? root : doc.getElementsByTagName('map')[0];
  if (!mapEl) throw new Error('不是有效的 TMX：找不到 <map> 根节点');

  const warnings = [];
  const tw = (+at(mapEl, 'tilewidth', 32)) || 32;
  const th = (+at(mapEl, 'tileheight', 32)) || 32;
  const mapW = (+at(mapEl, 'width', 0)) || 0;
  const mapH = (+at(mapEl, 'height', 0)) || 0;
  const orient = at(mapEl, 'orientation', 'orthogonal');
  if (orient !== 'orthogonal') warnings.push(`orientation="${orient}" 不是正交，已按正交近似导入`);
  const enc = at(mapEl, 'encoding', ''); if (enc) warnings.push(`地图使用 ${enc} 编码（本工程按 UTF-8 读取）`);

  /* 地图属性：hk_origin_x / hk_top_y 用于还原坐标原点 */
  let ox = 0, oyTop = Math.max(0, mapH - 1), hasOrigin = false;
  for (const props of kids(mapEl, 'properties')) {
    for (const p of kids(props, 'property')) {
      const n = p.getAttribute('name');
      if (n === 'hk_origin_x') { ox = (+at(p, 'value', 0)) || 0; hasOrigin = true; }
      else if (n === 'hk_top_y') { oyTop = (+at(p, 'value', 0)) || 0; hasOrigin = true; }
    }
  }

  /* tileset（内嵌的读 <tile>，外部的只能按顺序映射） */
  const sets = [];
  for (const ch of kids(mapEl, 'tileset')) {
    const fg = (+at(ch, 'firstgid', 1)) || 1;
    if (ch.getAttribute('source')) {
      warnings.push(`外部 tileset「${ch.getAttribute('source')}」在浏览器里读不到，改用顺序映射`);
      sets.push({ firstgid: fg, byId: {} });
      continue;
    }
    const byId = {};
    for (const t of kids(ch, 'tile')) byId[+at(t, 'id', 0) || 0] = t;
    sets.push({ firstgid: fg, byId });
  }
  sets.sort((a, b) => b.firstgid - a.firstgid);

  const ord = order();
  function codeOfTileEl(t) {
    let c = normCode(at(t, 'type', null)) || normCode(at(t, 'class', null));
    if (!c) {
      for (const props of kids(t, 'properties'))
        for (const p of kids(props, 'property')) {
          const n = (p.getAttribute('name') || '').toLowerCase();
          if (n === 'type' || n === 'code' || n === 'hk' || n === 'kind' || n === 'tile_type') {
            c = normCode(p.getAttribute('value'));
            if (c) break;
          }
        }
    }
    return c || normCode(at(t, 'name', null));
  }
  function gidToCode(g) {
    const id = g & GID_MASK;
    if (!id) return null;
    let ts = null;
    for (const s of sets) if (s.firstgid <= id && (!ts || s.firstgid > ts.firstgid)) ts = s;
    if (ts) {
      const local = id - ts.firstgid;
      const el = ts.byId[local];
      if (el) { const c = codeOfTileEl(el); if (c) return c; }
      return local >= 0 && local < ord.length ? ord[local] : null;
    }
    return id - 1 < ord.length ? ord[id - 1] : null;
  }

  /* 图层数据 */
  async function readLayer(layerEl) {
    const dataEl = kids(layerEl, 'data')[0];
    if (!dataEl) return [];
    const denc = dataEl.getAttribute('encoding');
    const dcomp = dataEl.getAttribute('compression');
    const out = [];
    const chunks = kids(dataEl, 'chunk');
    if (chunks.length) {
      for (const ck of chunks) {
        const cx = Math.floor((+at(ck, 'x', 0) || 0) / tw), cy = Math.floor((+at(ck, 'y', 0) || 0) / th);
        const cw = (+at(ck, 'width', 0)) || 1;
        const vals = await decodeData(ck, denc, dcomp);
        for (let i = 0; i < vals.length; i++) if (vals[i]) out.push({ x: cx + (i % cw), y: cy + Math.floor(i / cw), gid: vals[i] });
      }
      return out;
    }
    const lw = Math.max(1, (+at(layerEl, 'width', 0)) || mapW || 1);
    const vals = await decodeData(dataEl, denc, dcomp);
    for (let i = 0; i < vals.length; i++) if (vals[i]) out.push({ x: i % lw, y: Math.floor(i / lw), gid: vals[i] });
    return out;
  }

  const out = {};
  const put = (tx, ty, code) => { out[tx + ',' + ty] = code; };
  let nLayers = 0, nCells = 0, nObjects = 0;

  for (const ch of mapEl.children) {
    if (at(ch, 'visible', '1') === '0') continue;

    if (ch.tagName === 'layer') {
      nLayers++;
      for (const c of await readLayer(ch)) {
        const code = gidToCode(c.gid);
        if (!code) continue;
        put(ox + c.x, oyTop - c.y, code); nCells++;
      }
      continue;
    }

    if (ch.tagName === 'objectgroup') {
      const offx = (+at(ch, 'offsetx', 0)) || 0, offy = (+at(ch, 'offsety', 0)) || 0;
      for (const o of kids(ch, 'object')) {
        const code = normCode(at(o, 'type', null)) || normCode(at(o, 'class', null)) || normCode(at(o, 'name', null));
        const px = ((+at(o, 'x', 0)) || 0) + offx;
        const py = ((+at(o, 'y', 0)) || 0) + offy;
        const ow = (+at(o, 'width', 0)) || 0;
        const oh = (+at(o, 'height', 0)) || 0;
        const gidAttr = o.getAttribute('gid');

        if (gidAttr) {
          const c2 = gidToCode(+gidAttr);
          if (!c2) continue;
          put(ox + Math.floor(px / tw), oyTop - Math.floor((py - 1e-6) / th), c2); nCells++; nObjects++;
        } else if (ow <= 0 || oh <= 0) {
          if (!code) continue;                       /* 没写类型名的点对象跳过 */
          put(ox + Math.floor(px / tw), oyTop - Math.floor(py / th), code); nCells++; nObjects++;
        } else {
          /* TMX 正交对象以「左下角」为锚点（见官方 tmx-map-format 文档） */
          const c2 = code || 'solid';
          const x0 = Math.floor(px / tw), x1 = Math.floor((px + ow - 1e-6) / tw);
          const y0 = Math.floor((py - oh) / th), y1 = Math.floor((py - 1e-6) / th);
          for (let X = x0; X <= x1; X++) for (let Y = y0; Y <= y1; Y++) { put(ox + X, oyTop - Y, c2); nCells++; }
          nObjects++;
        }
      }
    }
  }

  if (!nCells) warnings.push('没有解析到任何瓦片，请检查图层数据与 tileset 映射');
  if (!Object.values(out).includes('spawn')) warnings.push('地图里没有出生点瓦片，玩家将出生在默认位置');

  return {
    tiles: out,
    meta: {
      width: mapW, height: mapH, tileW: tw, tileH: th,
      layers: nLayers, cells: nCells, objects: nObjects,
      originX: ox, topY: oyTop, hasOrigin, warnings
    }
  };
}

/* ---------------- tileset 图集（给 Tiled 看的 8 格 PNG） ---------------- */
function makeTilesetPNG() {
  const ord = order();
  const c = document.createElement('canvas');
  c.width = TW * ord.length; c.height = TH;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  ord.forEach((code, i) => {
    const col = HK.TILE_INFO[code].color;
    x.save();
    x.translate(i * TW, 0);
    x.fillStyle = 'rgba(8,17,32,.94)'; x.fillRect(1, 1, TW - 2, TH - 2);
    x.strokeStyle = col; x.lineWidth = 2; x.strokeRect(1, 1, TW - 2, TH - 2);
    x.fillStyle = col;
    if (code === 'spike') {
      x.beginPath(); x.moveTo(TW / 2, 5); x.lineTo(TW - 5, TH - 5); x.lineTo(5, TH - 5); x.closePath(); x.fill();
    } else if (code === 'bench') {
      x.fillRect(5, 17, TW - 10, 4); x.fillRect(6, 21, 3, 6); x.fillRect(TW - 9, 21, 3, 6); x.fillRect(9, 11, TW - 18, 4);
    } else if (code === 'fly') {
      x.beginPath(); x.arc(TW / 2, TH / 2, 9, 0, 6.2832); x.fill();
    } else if (code === 'spawn') {
      x.beginPath(); x.arc(TW / 2, TH / 2, 7, 0, 6.2832); x.fill();
      x.fillRect(TW / 2 - 1.5, 6, 3, TH - 12);
    } else {
      x.fillRect(6, 6, TW - 12, TH - 12);
    }
    x.restore();
  });
  return c;
}

/* ---------------- 下载 ---------------- */
function downloadURL(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); if (/^blob:/.test(url)) URL.revokeObjectURL(url); }, 0);
}
function downloadText(text, name, mime) {
  downloadURL(URL.createObjectURL(new Blob([text], { type: mime || 'text/plain;charset=utf-8' })), name);
}
function downloadTileset() {
  downloadURL(makeTilesetPNG().toDataURL('image/png'), TS_IMG);
}

Object.assign(HK, {
  tmx: {
    TW, TH, TS_IMG, order, normCode, mapToTMX, parseTMX,
    makeTilesetPNG, downloadURL, downloadText, downloadTileset
  }
});

})(window.HK);
