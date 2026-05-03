const html = document.documentElement;
const themeBtn = document.getElementById('theme-toggle');
const verEl = document.getElementById('ver');
const seedEl = document.getElementById('seed');
const status = document.getElementById('status');
const coords = document.getElementById('coords');
const biomeToggle = document.getElementById('biome-toggle');
const clearSelectionBtn = document.getElementById('clear-selection');

const CSS_PROPS = [
  '--canvas-bg','--grid-chunk','--grid-region','--axis',
  '--bg-status','--border-input','--text-overlay','--select','--ruler-size'
];

let _tv = {};
function refreshCssVars() {
  const s = getComputedStyle(html);
  for (const p of CSS_PROPS) _tv[p] = s.getPropertyValue(p).trim();
  _tv.rulerSize = parseInt(_tv['--ruler-size']) || 24;
}

function applyTheme(t) {
  html.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  themeBtn.textContent = t === 'dark' ? '☽' : '☀';
  refreshCssVars();
  requestDraw();
}

themeBtn.addEventListener('click', () => {
  applyTheme(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

function cssVar(name) {
  return _tv[name] || getComputedStyle(html).getPropertyValue(name).trim();
}


const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

let autoBoxes = [];
let fortresses = [];
let hssBoxes = [];
let biomeChunks = new Map();
let selectedFortresses = new Map();
let hoveredFortressId = null;
let biomeOverlayEnabled = true;

const MIN_SCALE = 0.3;
const MAX_SCALE = 64;
const MAX_CHUNK_RADIUS = 512;
const FORTRESS_RECORD_STRIDE = 9;
const BIOME_CHUNK_CELLS = 128;
const BLOCK_SIZE = 1;
const CHUNK_SIZE = 16;
const REGION_SIZE = 256;
const GRID_OFFSET = -0.5;

const BIOME_STYLE = {
  8:   { name: 'nether_wastes',    color: '#572526' },
  170: { name: 'soul_sand_valley', color: '#4d3a2e' },
  171: { name: 'crimson_forest',   color: '#981a11' },
  172: { name: 'warped_forest',    color: '#49907b' },
  173: { name: 'basalt_deltas',    color: '#645f63' },
  187: { name: 'sulfur_caves',     color: '#c8d232' },
};

let panX = 0, panZ = 0, scale = 1;

let fetchTimeout = null;
let biomeFetchTimeout = null;
let isFetching = false;
let lastBiomeFetchKey = null;
let biomeCacheBaseKey = null;
let biomeWorker = null;
let biomeRequestId = 0;
let lastBiomeFetchTime = 0;
const BIOME_FETCH_INTERVAL = 150;

let rafPending = false;
function requestDraw() {
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; draw(); });
  }
}

function rgba(hex, alpha) {
  const c = hex.replace('#', '');
  return `rgba(${parseInt(c.slice(0,2),16)},${parseInt(c.slice(2,4),16)},${parseInt(c.slice(4,6),16)},${alpha})`;
}

function biomeName(id) {
  return BIOME_STYLE[id]?.name || `biome ${id}`;
}

function updateSelectionInfo() {
  const count = selectedFortresses.size;
  clearSelectionBtn.title = count > 0 ? `Clear Selection (${count})` : 'Clear Selection';
  clearSelectionBtn.disabled = count === 0;
}

let lastFetchedBounds = null;
function invalidateFetchBounds() { lastFetchedBounds = null; }

function invalidateBiomeFetch(clearCache = false) {
  lastBiomeFetchKey = null;
  lastBiomeLookupKey = '';
  lastBiomeLookupResult = null;
  if (clearCache) {
    biomeChunks.clear();
    biomeCacheBaseKey = null;
    cancelBiomeWorkerJobs();
  }
}

function refreshAll(clearCache = false, immediate = false) {
  invalidateFetchBounds();
  invalidateBiomeFetch(clearCache);
  requestDraw();
  if (immediate) {
    fetchVisibleBoxes();
    fetchVisibleBiomes();
  } else {
    scheduleFetch();
    scheduleBiomeFetch();
  }
}

function worldToCanvas(wx, wz) {
  return {
    cx: canvas.clientWidth  / 2 + (wx - panX) * scale,
    cy: canvas.clientHeight / 2 + (wz - panZ) * scale,
  };
}

function canvasToWorld(cx, cy) {
  return {
    wx: (cx - canvas.clientWidth  / 2) / scale + panX,
    wz: (cy - canvas.clientHeight / 2) / scale + panZ,
  };
}

function resize() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width  = Math.max(1, Math.floor(canvas.clientWidth  * dpr));
  canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  refreshCssVars();
  refreshAll();
}

function getFortressScreenHitBox(fortress) {
  const hw = canvas.clientWidth / 2, hh = canvas.clientHeight / 2;
  const ax = hw + (fortress.minX - 0.5 - panX) * scale;
  const ay = hh + (fortress.minZ - 0.5 - panZ) * scale;
  const bx = hw + (fortress.maxX - 0.5 - panX) * scale;
  const by = hh + (fortress.maxZ - 0.5 - panZ) * scale;
  let x = Math.min(ax, bx), y = Math.min(ay, by);
  let w = Math.abs(bx - ax), h = Math.abs(by - ay);
  const minSize = 28;
  if (w < minSize) { x -= (minSize - w) / 2; w = minSize; }
  if (h < minSize) { y -= (minSize - h) / 2; h = minSize; }
  return { x, y, w, h };
}

function hitTestFortress(offsetX, offsetY) {
  let best = null, bestDist = Infinity;
  for (const fortress of fortresses) {
    const box = getFortressScreenHitBox(fortress);
    if (offsetX < box.x || offsetX > box.x + box.w ||
        offsetY < box.y || offsetY > box.y + box.h) continue;
    const hw = canvas.clientWidth / 2, hh = canvas.clientHeight / 2;
    const cx = hw + (fortress.x - panX) * scale;
    const cy = hh + (fortress.z - panZ) * scale;
    const d = Math.hypot(offsetX - cx, offsetY - cy);
    if (d < bestDist) { best = fortress; bestDist = d; }
  }
  return best;
}

function setHoveredFortress(fortress) {
  const nextId = fortress?.id || null;
  if (hoveredFortressId === nextId) return;
  hoveredFortressId = nextId;
  vp.style.cursor = nextId ? 'pointer' : 'crosshair';
  requestDraw();
}

function gridStart(worldCoord, step) {
  return Math.floor((worldCoord - GRID_OFFSET) / step) * step + GRID_OFFSET;
}

function isGridMultiple(worldCoord, step) {
  return Math.round(worldCoord - GRID_OFFSET) % step === 0;
}

function chooseGridStep(minPixels) {
  let step = CHUNK_SIZE;
  while (step * scale < minPixels) step *= 2;
  return step;
}

function drawGridPass(tl, br, W, H, step, strokeStyle, lineWidth, skipStep = 0) {
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (let gx = gridStart(tl.wx, step); gx <= br.wx; gx += step) {
    if (skipStep && isGridMultiple(gx, skipStep)) continue;
    const cx = W / 2 + (gx - panX) * scale;
    ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
  }
  for (let gz = gridStart(tl.wz, step); gz <= br.wz; gz += step) {
    if (skipStep && isGridMultiple(gz, skipStep)) continue;
    const cy = H / 2 + (gz - panZ) * scale;
    ctx.moveTo(0, cy); ctx.lineTo(W, cy);
  }
  ctx.stroke();
}

function drawAdaptiveGrid(tl, br, W, H, colGridChunk, colGridRegion) {
  const mainStep = chooseGridStep(28);
  let majorStep = REGION_SIZE;
  while (majorStep <= mainStep || majorStep * scale < 90) majorStep *= 2;
  if (scale >= 8) {
    const blockAlpha = Math.min(0.28, 0.06 + (scale - 8) / 160);
    drawGridPass(tl, br, W, H, BLOCK_SIZE, rgba(colGridChunk, blockAlpha), 1, CHUNK_SIZE);
  }
  drawGridPass(tl, br, W, H, mainStep, colGridChunk, 1, majorStep);
  drawGridPass(tl, br, W, H, majorStep, colGridRegion, 1.5);
}

function drawBiomeOverlay(W, H) {
  if (!biomeOverlayEnabled || !biomeChunks.size) return;
  const hw = W / 2, hh = H / 2;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const chunk of biomeChunks.values()) {
    const cx = hw + (chunk.originX - 0.5 - panX) * scale;
    const cy = hh + (chunk.originZ - 0.5 - panZ) * scale;
    const w = chunk.columns * chunk.step * scale;
    const h = chunk.rows * chunk.step * scale;
    if (cx + w < 0 || cx > W || cy + h < 0 || cy > H) continue;
    ctx.drawImage(chunk.canvas, cx, cy, w, h);
  }
  ctx.restore();
}

function drawFortressHitBoxes(W, H) {
  if (!fortresses.length) return;
  const colSelect = _tv['--select'];
  ctx.save();
  for (const fortress of fortresses) {
    const box = getFortressScreenHitBox(fortress);
    if (box.x + box.w < 0 || box.x > W || box.y + box.h < 0 || box.y > H) continue;
    const selected = selectedFortresses.has(fortress.id);
    const hovered  = hoveredFortressId === fortress.id;
    if (selected || hovered) {
      ctx.fillStyle = selected ? rgba(colSelect, 0.16) : 'rgba(240,178,74,0.08)';
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    ctx.strokeStyle = selected ? colSelect : (hovered ? 'rgba(240,178,74,0.8)' : 'rgba(220,50,50,0.5)');
    ctx.lineWidth   = selected ? 3 : (hovered ? 2 : 1);
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, Math.max(0, box.w - 1), Math.max(0, box.h - 1));
  }
  ctx.restore();
}

function drawBoxLayer(boxes, pxOffset, fillStyle, strokeStyle) {
  if (!boxes.length) return;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const hw = W / 2, hh = H / 2;
  const rects = [];
  for (const b of boxes) {
    const wx = b.px + pxOffset - b.sx / 2;
    const wz = b.pz + pxOffset - b.sz / 2;
    const cx = hw + (wx - panX) * scale;
    const cy = hh + (wz - panZ) * scale;
    const pw = b.sx * scale, ph = b.sz * scale;
    if (cx + pw >= 0 && cx <= W && cy + ph >= 0 && cy <= H) rects.push(cx, cy, pw, ph);
  }
  if (!rects.length) return;
  ctx.fillStyle = fillStyle;
  ctx.beginPath();
  for (let i = 0; i < rects.length; i += 4) ctx.rect(rects[i], rects[i+1], rects[i+2], rects[i+3]);
  ctx.fill();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < rects.length; i += 4) ctx.rect(rects[i], rects[i+1], rects[i+2], rects[i+3]);
  ctx.stroke();
}

function draw() {
  if (!ctx) return;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const colCanvasBg    = _tv['--canvas-bg'];
  const colGridChunk   = _tv['--grid-chunk'];
  const colGridRegion  = _tv['--grid-region'];
  const colAxis        = _tv['--axis'];
  const colBgStatus    = _tv['--bg-status'];
  const colBorderInput = _tv['--border-input'];
  const colTextOverlay = _tv['--text-overlay'];
  const RULER          = _tv.rulerSize;

  ctx.fillStyle = colCanvasBg;
  ctx.fillRect(0, 0, W, H);
  drawBiomeOverlay(W, H);

  const tl = canvasToWorld(0, 0);
  const br = canvasToWorld(W, H);
  drawAdaptiveGrid(tl, br, W, H, colGridChunk, colGridRegion);

  const ox = W / 2 - panX * scale;
  const oz = H / 2 - panZ * scale;
  ctx.strokeStyle = colAxis; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox, 0); ctx.lineTo(ox, H);
  ctx.moveTo(0, oz); ctx.lineTo(W, oz);
  ctx.stroke();

  drawBoxLayer(autoBoxes, -0.5, 'rgba(220,50,50,0.3)',    '#dc3232');
  drawBoxLayer(hssBoxes,   0,   'rgba(58,107,138,0.25)', '#3a6b8a');
  drawFortressHitBoxes(W, H);

  const tickStep  = Math.max(1, Math.min(256, Math.floor(50 / scale)));
  const labelStep = scale >= 8 ? Math.max(1, Math.ceil(36 / scale)) : (tickStep <= 16 ? 16 : tickStep);
  const rulerCx0  = gridStart(tl.wx, tickStep);
  const rulerCz0  = gridStart(tl.wz, tickStep);
  const fontSize = Math.max(9, RULER - 14);
  ctx.font = `${fontSize}px monospace`;
  const zCandidates = [
    Math.round(tl.wz + 0.5),
    Math.round(br.wz + 0.5),
  ];
  const longestZStr = zCandidates.reduce(
    (best, z) => String(z).length >= String(best).length ? z : best
  );
  const zLabelPx = ctx.measureText(String(longestZStr)).width;
  const zRulerW = Math.max(RULER, Math.ceil(zLabelPx) + 12);
  ctx.fillStyle = colBgStatus;
  ctx.fillRect(0, 0, W, RULER);
  ctx.fillRect(0, 0, zRulerW, H);

  ctx.strokeStyle = colBorderInput; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(zRulerW, RULER - 0.5); ctx.lineTo(W, RULER - 0.5);
  ctx.moveTo(zRulerW - 0.5, RULER); ctx.lineTo(zRulerW - 0.5, H);
  ctx.stroke();

  ctx.fillStyle = colTextOverlay;
  ctx.font = `${fontSize}px monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';

  ctx.beginPath();
  for (let gx = rulerCx0; gx <= br.wx; gx += tickStep) {
    const cx = W / 2 + (gx - panX) * scale;
    if (cx < zRulerW || cx > W) continue;
    const worldX = Math.round(gx + 0.5);
    ctx.moveTo(cx, RULER - (worldX % 256 === 0 ? 10 : 6));
    ctx.lineTo(cx, RULER);
  }
  ctx.stroke();

  for (let gx = rulerCx0; gx <= br.wx; gx += tickStep) {
    const cx = W / 2 + (gx - panX) * scale;
    if (cx < zRulerW + 10 || cx > W) continue;
    const worldX = Math.round(gx + 0.5);
    if (worldX % labelStep === 0) ctx.fillText(`${worldX}`, cx, 2);
  }

  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';

  ctx.beginPath();
  for (let gz = rulerCz0; gz <= br.wz; gz += tickStep) {
    const cy = H / 2 + (gz - panZ) * scale;
    if (cy < RULER || cy > H) continue;
    const worldZ = Math.round(gz + 0.5);
    ctx.moveTo(zRulerW - (worldZ % 256 === 0 ? 10 : 6), cy);
    ctx.lineTo(zRulerW, cy);
  }
  ctx.stroke();

  for (let gz = rulerCz0; gz <= br.wz; gz += tickStep) {
    const cy = H / 2 + (gz - panZ) * scale;
    if (cy < RULER + 5 || cy > H) continue;
    const worldZ = Math.round(gz + 0.5);
    if (worldZ % labelStep === 0) ctx.fillText(`${worldZ}`, zRulerW - 4, cy);
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('X', zRulerW - fontSize - 2, 2);
  ctx.fillText('Z', 2, RULER - fontSize - 2);
}
function fetchVisibleBoxes() {
  if (!moduleReady || isFetching) return;
  const version   = verEl.value;
  const seedInput = seedEl.value;
  if (!version || !seedInput) return;

  const W  = canvas.clientWidth, H = canvas.clientHeight;
  const tl = canvasToWorld(0, 0);
  const br = canvasToWorld(W, H);

  const centerX = Math.round((tl.wx + br.wx) / 2);
  const centerZ = Math.round((tl.wz + br.wz) / 2);
  const chunkRadius = Math.min(
    Math.max(Math.ceil(Math.abs(br.wx - tl.wx) / 16) / 2,
             Math.ceil(Math.abs(br.wz - tl.wz) / 16) / 2) + 20,
    MAX_CHUNK_RADIUS
  );

  if (lastFetchedBounds) {
    const pad = 8 * 16;
    if (tl.wx >= lastFetchedBounds.minX + pad &&
        br.wx <= lastFetchedBounds.maxX - pad &&
        tl.wz >= lastFetchedBounds.minZ + pad &&
        br.wz <= lastFetchedBounds.maxZ - pad) return;
  }

  const rawSeed = BigInt(seedInput);
  isFetching = true;
  status.textContent = `loading… (r=${chunkRadius})`;

  try {
    autoBoxes  = parseRawBoxes(Module.findFortressBoxesRaw(version, rawSeed, centerX, centerZ, chunkRadius));
    fortresses = parseRawFortresses(Module.findFortressesRaw(version, rawSeed, centerX, centerZ, chunkRadius));
    refreshSelectedFortressRecords();
    const fetchedBlocks = chunkRadius * 16;
    lastFetchedBounds = {
      minX: centerX - fetchedBlocks, maxX: centerX + fetchedBlocks,
      minZ: centerZ - fetchedBlocks, maxZ: centerZ + fetchedBlocks,
    };
    setStatusForCurrentData();
  } catch (e) {
    if (!hssBoxes.length) setStatus('err', 'fetch error: ' + e.message);
  }

  isFetching = false;
  requestDraw();
  scheduleBiomeFetch();
  scheduleUrlUpdate();
}

function parseRawBoxes(raw) {
  if (!raw.ptr || raw.count <= 0) return [];
  const ptr   = Number(raw.ptr);
  const count = Number(raw.count);
  if (!Number.isFinite(ptr) || ptr % 4 !== 0 || count <= 0) return [];
  const data  = new Float32Array(Module.HEAPF32.buffer, ptr, count * 6);
  const boxes = new Array(count);
  for (let i = 0, j = 0; i < count; ++i, j += 6) {
    boxes[i] = { px: data[j], py: data[j+1], pz: data[j+2], sx: data[j+3], sy: data[j+4], sz: data[j+5] };
  }
  Module.freeBuffer(ptr);
  return boxes;
}

function parseRawFortresses(raw) {
  if (!raw.ptr || raw.count <= 0) return [];
  const ptr   = Number(raw.ptr);
  const count = Number(raw.count);
  if (!Number.isFinite(ptr) || ptr % 4 !== 0 || count <= 0) return [];
  const data    = new Float32Array(Module.HEAPF32.buffer, ptr, count * FORTRESS_RECORD_STRIDE);
  const records = new Array(count);
  for (let i = 0, j = 0; i < count; ++i, j += FORTRESS_RECORD_STRIDE) {
    const chunkX = Math.round(data[j+2]);
    const chunkZ = Math.round(data[j+3]);
    records[i] = {
      id: `${chunkX},${chunkZ}`,
      x: data[j], z: data[j+1],
      chunkX, chunkZ,
      minX: data[j+4], minZ: data[j+5],
      maxX: data[j+6], maxZ: data[j+7],
      biomeId: Math.round(data[j+8]),
    };
  }
  Module.freeBuffer(ptr);
  return records;
}

function refreshSelectedFortressRecords() {
  for (const fortress of fortresses) {
    if (selectedFortresses.has(fortress.id)) selectedFortresses.set(fortress.id, fortress);
  }
  updateSelectionInfo();
}

function setStatusForCurrentData() {
  if (selectedFortresses.size > 0) {
    setStatus(hssBoxes.length === 0 ? '' : 'ok',
      `${selectedFortresses.size} selected · ${hssBoxes.length} HSS box${hssBoxes.length === 1 ? '' : 'es'}`);
    return;
  }
  setStatus(autoBoxes.length === 0 ? '' : 'ok',
    `${fortresses.length} fortress${fortresses.length === 1 ? '' : 'es'} · ${autoBoxes.length} piece${autoBoxes.length === 1 ? '' : 's'}`);
}

function chooseBiomeStep() {
  return scale >= 2 ? 1 : scale >= 1 ? 2 : 4;
}

function getBiomeFetchSpec() {
  const W    = canvas.clientWidth, H = canvas.clientHeight;
  const tl   = canvasToWorld(0, 0);
  const br   = canvasToWorld(W, H);
  const step = chooseBiomeStep();
  const chunkWorldSize = BIOME_CHUNK_CELLS * step;
  const originX   = Math.floor(Math.floor(tl.wx) / chunkWorldSize) * chunkWorldSize;
  const originZ   = Math.floor(Math.floor(tl.wz) / chunkWorldSize) * chunkWorldSize;
  const columns   = Math.ceil((Math.ceil(br.wx) - originX + 1) / step);
  const rows      = Math.ceil((Math.ceil(br.wz) - originZ + 1) / step);
  const chunkCols = Math.ceil(columns / BIOME_CHUNK_CELLS);
  const chunkRows = Math.ceil(rows    / BIOME_CHUNK_CELLS);
  const seedInput = seedEl.value || '0';
  const baseKey   = `${verEl.value}|${seedInput}|${step}`;
  const key       = `${baseKey}|${originX}|${originZ}|${chunkCols}|${chunkRows}`;
  return { originX, originZ, columns, rows, chunkCols, chunkRows, step, baseKey, key };
}

function buildBiomeChunkJobs(spec) {
  const jobs = [];
  for (let chunkZ = 0; chunkZ < spec.chunkRows; ++chunkZ) {
    for (let chunkX = 0; chunkX < spec.chunkCols; ++chunkX) {
      const col      = chunkX * BIOME_CHUNK_CELLS;
      const row      = chunkZ * BIOME_CHUNK_CELLS;
      const columns  = Math.min(BIOME_CHUNK_CELLS, spec.columns - col);
      const rows     = Math.min(BIOME_CHUNK_CELLS, spec.rows    - row);
      const originX  = spec.originX + col * spec.step;
      const originZ  = spec.originZ + row * spec.step;
      const chunkKey = `${spec.baseKey}|${originX}|${originZ}|${columns}|${rows}`;
      if (columns > 0 && rows > 0 && !biomeChunks.has(chunkKey)) {
        jobs.push({ chunkKey, originX, originZ, columns, rows, step: spec.step });
      }
    }
  }
  return jobs;
}

function pruneBiomeChunks(spec) {
  const margin = BIOME_CHUNK_CELLS * spec.step;
  const minX = spec.originX - margin;
  const minZ = spec.originZ - margin;
  const maxX = spec.originX + spec.columns * spec.step + margin;
  const maxZ = spec.originZ + spec.rows    * spec.step + margin;
  for (const [key, chunk] of biomeChunks) {
    if (chunk.originX + chunk.columns * chunk.step < minX || chunk.originX > maxX ||
        chunk.originZ + chunk.rows    * chunk.step < minZ || chunk.originZ > maxZ) {
      biomeChunks.delete(key);
    }
  }
}

function ensureBiomeWorker() {
  if (biomeWorker || !window.Worker) return biomeWorker;
  try {
    biomeWorker = new Worker('biome-worker.js');
    biomeWorker.onmessage = handleBiomeWorkerMessage;
    biomeWorker.onerror   = e => setStatus('err', `biome worker error: ${e.message}`);
  } catch (e) {
    setStatus('err', `biome worker unavailable: ${e.message}`);
  }
  return biomeWorker;
}

function cancelBiomeWorkerJobs() {
  biomeRequestId += 1;
  if (biomeWorker) biomeWorker.postMessage({ type: 'cancel', requestId: biomeRequestId });
}

function createBiomeChunk(data) {
  const chunkCanvas = document.createElement('canvas');
  chunkCanvas.width  = data.columns;
  chunkCanvas.height = data.rows;
  chunkCanvas.getContext('2d').putImageData(
    new ImageData(new Uint8ClampedArray(data.pixels), data.columns, data.rows), 0, 0);
  return { canvas: chunkCanvas, originX: data.originX, originZ: data.originZ,
           columns: data.columns, rows: data.rows, step: data.step };
}

function handleBiomeWorkerMessage(e) {
  const data = e.data;
  if (data.requestId !== biomeRequestId) return;
  if (data.type === 'chunk') {
    biomeChunks.set(data.chunkKey, createBiomeChunk(data));
    requestDraw();
  } else if (data.type === 'error') {
    setStatus('err', `biome worker error: ${data.message}`);
  }
}

function scheduleBiomeFetch() {
  if (biomeFetchTimeout) clearTimeout(biomeFetchTimeout);
  const elapsed = performance.now() - lastBiomeFetchTime;
  if (elapsed >= BIOME_FETCH_INTERVAL) {
    lastBiomeFetchTime = performance.now();
    fetchVisibleBiomes();
  } else {
    biomeFetchTimeout = setTimeout(() => {
      lastBiomeFetchTime = performance.now();
      fetchVisibleBiomes();
    }, BIOME_FETCH_INTERVAL - elapsed);
  }
}

function fetchVisibleBiomes() {
  if (!moduleReady || !biomeOverlayEnabled) return;
  const spec   = getBiomeFetchSpec();
  const worker = ensureBiomeWorker();
  if (!worker) return;
  if (spec.baseKey !== biomeCacheBaseKey) {
    biomeChunks.clear();
    biomeCacheBaseKey = spec.baseKey;
  }
  pruneBiomeChunks(spec);
  const chunks = buildBiomeChunkJobs(spec);
  if (spec.key === lastBiomeFetchKey && !chunks.length) return;
  lastBiomeFetchKey = spec.key;
  if (!chunks.length) { requestDraw(); return; }
  biomeRequestId += 1;
  worker.postMessage({ type: 'request', requestId: biomeRequestId,
                       version: verEl.value, seed: seedEl.value || '0', chunks });
}

function scheduleFetch() {
  if (fetchTimeout) clearTimeout(fetchTimeout);
  fetchTimeout = setTimeout(fetchVisibleBoxes, 400);
}

const CLICK_THRESHOLD = 5;
const pointerState = {
  pointers: new Map(),
  dragging: false, moved: false,
  dragStartX: 0, dragStartY: 0,
  dragOriginX: 0, dragOriginZ: 0,
  pinchStartDist: 0, pinchStartScale: scale,
};

const vp = document.getElementById('viewport');
const getPointerOffset = e => {
  const rect = vp.getBoundingClientRect();
  return { offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
};

let lastBiomeLookupKey = '';
let lastBiomeLookupResult = null;

function getBiomeAtCoord(blockX, blockZ) {
  const key = `${blockX},${blockZ}`;
  if (key === lastBiomeLookupKey) return lastBiomeLookupResult;
  lastBiomeLookupKey = key;
  if (!moduleReady) { lastBiomeLookupResult = null; return null; }
  try {
    const result = Module.findNetherBiomeTilesRaw(verEl.value, BigInt(seedEl.value || '0'), blockX, blockZ, 1, 1, 1);
    if (result.ptr && result.count > 0) {
      const biomeId = Math.round(new Float32Array(Module.HEAPF32.buffer, Number(result.ptr), 1)[0]);
      Module.freeBuffer(result.ptr);
      lastBiomeLookupResult = biomeId;
      return biomeId;
    }
  } catch {}
  lastBiomeLookupResult = null;
  return null;
}

function updateCoordsFromEvent(e) {
  const { offsetX, offsetY } = getPointerOffset(e);
  const { wx, wz } = canvasToWorld(offsetX, offsetY);
  const blockX = Math.round(wx), blockZ = Math.round(wz);
  const biomeId = getBiomeAtCoord(blockX, blockZ);
  coords.textContent = `X ${blockX}  Z ${blockZ}${biomeId != null ? `  ${biomeName(biomeId)}` : ''}`;
}

function setPointerDrag(e) {
  pointerState.dragging    = true;
  pointerState.moved       = false;
  pointerState.dragStartX  = e.clientX;
  pointerState.dragStartY  = e.clientY;
  pointerState.dragOriginX = panX;
  pointerState.dragOriginZ = panZ;
}

function getDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

vp.addEventListener('pointerdown', e => {
  e.preventDefault();
  vp.setPointerCapture(e.pointerId);
  pointerState.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const { offsetX, offsetY } = getPointerOffset(e);
  setHoveredFortress(hitTestFortress(offsetX, offsetY));
  if (pointerState.pointers.size === 1) {
    setPointerDrag(e);
  } else if (pointerState.pointers.size === 2) {
    pointerState.dragging = false;
    pointerState.moved    = true;
    const pts = Array.from(pointerState.pointers.values());
    pointerState.pinchStartDist  = getDistance(pts[0], pts[1]);
    pointerState.pinchStartScale = scale;
  }
  updateCoordsFromEvent(e);
});

vp.addEventListener('pointermove', e => {
  if (!pointerState.pointers.has(e.pointerId)) {
    updateCoordsFromEvent(e);
    const { offsetX, offsetY } = getPointerOffset(e);
    setHoveredFortress(hitTestFortress(offsetX, offsetY));
    return;
  }
  pointerState.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  updateCoordsFromEvent(e);

  if (pointerState.pointers.size === 1 && pointerState.dragging) {
    const dx = e.clientX - pointerState.dragStartX;
    const dy = e.clientY - pointerState.dragStartY;
    if (Math.abs(dx) > CLICK_THRESHOLD || Math.abs(dy) > CLICK_THRESHOLD) pointerState.moved = true;
    panX = pointerState.dragOriginX - dx / scale;
    panZ = pointerState.dragOriginZ - dy / scale;
    requestDraw();
    if (pointerState.moved) {
      setHoveredFortress(null);
      fetchVisibleBoxes();
      scheduleBiomeFetch();
    } else {
      const { offsetX, offsetY } = getPointerOffset(e);
      setHoveredFortress(hitTestFortress(offsetX, offsetY));
    }
  } else if (pointerState.pointers.size === 2) {
    setHoveredFortress(null);
    const pts     = Array.from(pointerState.pointers.values());
    const newDist = getDistance(pts[0], pts[1]);
    if (pointerState.pinchStartDist > 0) {
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE,
        pointerState.pinchStartScale * (newDist / pointerState.pinchStartDist)));
      if (newScale !== scale) {
        pointerState.moved = true;
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        const rect = vp.getBoundingClientRect();
        const worldMid = canvasToWorld(midX - rect.left, midY - rect.top);
        scale = newScale;
        panX  = worldMid.wx - ((midX - rect.left) - canvas.clientWidth  / 2) / scale;
        panZ  = worldMid.wz - ((midY - rect.top)  - canvas.clientHeight / 2) / scale;
        requestDraw();
        scheduleBiomeFetch();
      }
    }
  }
});

function cleanupPointer(e) {
  pointerState.pointers.delete(e.pointerId);
  if (pointerState.pointers.size === 0) {
    if (pointerState.dragging && !pointerState.moved) {
      const { offsetX, offsetY } = getPointerOffset(e);
      const fortress = hitTestFortress(offsetX, offsetY);
      if (fortress) toggleFortressSelection(fortress);
      requestDraw();
    }
    pointerState.dragging = false;
    pointerState.moved    = false;
    pointerState.pinchStartDist = 0;
  } else if (pointerState.pointers.size === 1) {
    const remaining = pointerState.pointers.values().next().value;
    if (remaining) {
      pointerState.dragging    = true;
      pointerState.moved       = true;
      pointerState.dragStartX  = remaining.x;
      pointerState.dragStartY  = remaining.y;
      pointerState.dragOriginX = panX;
      pointerState.dragOriginZ = panZ;
    }
  }
}

vp.addEventListener('pointerup',     cleanupPointer);
vp.addEventListener('pointercancel', cleanupPointer);

vp.addEventListener('wheel', e => {
  e.preventDefault();
  const rect    = vp.getBoundingClientRect();
  const offsetX = e.clientX - rect.left;
  const offsetY = e.clientY - rect.top;
  const { wx, wz } = canvasToWorld(offsetX, offsetY);
  const newScale = scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15);
  if (newScale < MIN_SCALE || newScale > MAX_SCALE) { requestDraw(); return; }
  scale = newScale;
  panX  = wx - (offsetX - canvas.clientWidth  / 2) / scale;
  panZ  = wz - (offsetY - canvas.clientHeight / 2) / scale;
  requestDraw();
  fetchVisibleBoxes();
  scheduleBiomeFetch();
}, { passive: false });

vp.addEventListener('pointerleave', () => {
  if (!pointerState.pointers.size) setHoveredFortress(null);
});

function getSelectedFortressPayload() {
  return Array.from(selectedFortresses.values()).map(f => ({
    id: f.id, x: Math.round(f.x), z: Math.round(f.z), chunkX: f.chunkX, chunkZ: f.chunkZ,
  }));
}

function toggleFortressSelection(fortress) {
  if (selectedFortresses.has(fortress.id)) selectedFortresses.delete(fortress.id);
  else selectedFortresses.set(fortress.id, fortress);
  updateSelectionInfo();
  runSelectedHSS();
}

function clearSelection() {
  selectedFortresses.clear();
  hssBoxes = [];
  updateSelectionInfo();
  setStatusForCurrentData();
  requestDraw();
}

function runSelectedHSS() {
  if (!moduleReady) { setStatus('err', 'wasm not ready yet'); return; }
  const selected = getSelectedFortressPayload();
  if (!selected.length) {
    hssBoxes = [];
    setStatusForCurrentData();
    requestDraw();
    return;
  }
  const rawSeed = BigInt(seedEl.value || '0');
  setStatus('', `calculating HSS… ${selected.length} selected`);
  try {
    hssBoxes = parseRawBoxes(Module.findFortressHSSSelectedRaw(verEl.value, rawSeed, selected));
    setStatus(hssBoxes.length === 0 ? 'err' : 'ok',
      hssBoxes.length === 0
        ? 'no HSS boxes for selected fortress set'
        : `${selected.length} selected · ${hssBoxes.length} HSS box${hssBoxes.length === 1 ? '' : 'es'}`);
  } catch (e) {
    setStatus('err', 'error: ' + e.message);
  }
  requestDraw();
}

let Module = null, moduleReady = false;

const script = document.createElement('script');
script.src = 'fortress.js';
script.onload = () => {
  status.textContent = 'loading wasm…';
  const factory = window.Module ?? window.FortressModule ?? window.fortress_module;
  if (!factory) { setStatus('err', 'Module factory not found'); return; }
  factory().then(m => {
    Module = m;
    moduleReady = true;
    setStatus('ok', 'wasm ready');
    scheduleFetch();
    scheduleBiomeFetch();
  }).catch(err => setStatus('err', 'wasm init failed: ' + err));
};
script.onerror = () => setStatus('err', 'fortress.js not found');
document.head.appendChild(script);

function resetWorldData() {
  autoBoxes = []; fortresses = []; hssBoxes = [];
  selectedFortresses.clear();
  hoveredFortressId = null;
  updateSelectionInfo();
  refreshAll(true);
}

seedEl.addEventListener('input', () => { resetWorldData(); scheduleUrlUpdate(); });
verEl.addEventListener('change', resetWorldData);

document.getElementById('download').addEventListener('click', () => {
  generateResourcePack(hssBoxes, document.getElementById('pack-name').value.trim() || 'Fortress HSS');
});

biomeToggle.addEventListener('click', () => {
  biomeOverlayEnabled = !biomeOverlayEnabled;
  biomeToggle.setAttribute('aria-checked', String(biomeOverlayEnabled));
  biomeToggle.textContent = biomeOverlayEnabled ? '▩' : '⬚';
  biomeToggle.style.color = biomeOverlayEnabled ? 'var(--toggle-on)' : 'var(--btn-text)';
  biomeToggle.style.borderColor = biomeOverlayEnabled ? 'var(--toggle-on)' : 'var(--btn-border)';
  if (biomeOverlayEnabled) scheduleBiomeFetch(); else cancelBiomeWorkerJobs();
  requestDraw();
});

clearSelectionBtn.addEventListener('click', clearSelection);

function setStatus(cls, msg) {
  status.textContent = msg;
  status.className   = cls;
}

let urlUpdateTimer = null;
function scheduleUrlUpdate() {
  clearTimeout(urlUpdateTimer);
  urlUpdateTimer = setTimeout(() => {
    history.replaceState(null, '', `#seed=${encodeURIComponent(seedEl.value.trim())}&x=${Math.round(panX)}&z=${Math.round(panZ)}`);
  }, 600);
}

(() => {
  const raw = location.hash.slice(1);
  if (!raw) return;
  try {
    const p = new URLSearchParams(raw);
    if (p.has('seed')) seedEl.value = p.get('seed');
    if (p.has('x'))    panX = parseInt(p.get('x'), 10) || 0;
    if (p.has('z'))    panZ = parseInt(p.get('z'), 10) || 0;
  } catch {}
})();

applyTheme(localStorage.getItem('theme') || 'dark');
updateSelectionInfo();
window.addEventListener('resize', resize);
resize();

(() => {
  const gotoBtn   = document.getElementById('goto-btn');
  const gotoPanel = document.getElementById('goto-panel');
  const gotoX     = document.getElementById('goto-x');
  const gotoZ     = document.getElementById('goto-z');
  const gotoGo    = document.getElementById('goto-go');
  const gotoPaste = document.getElementById('goto-paste');
  const gotoErr   = document.getElementById('goto-err');

  const XYZ_RE = /^\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/;

  function positionPanel() {
    const btnRect = gotoBtn.getBoundingClientRect();
    const MARGIN  = 8, vw = window.innerWidth, vh = window.innerHeight;

    if (vw <= 480) {
      gotoPanel.style.left = `${MARGIN}px`;
      gotoPanel.style.top = 'auto';
      gotoPanel.style.bottom = `${MARGIN + parseInt(getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-bottom)') || '0')}px`;
      gotoPanel.hidden = false;
      return;
    }

    const wasHidden = gotoPanel.hidden;
    gotoPanel.style.left = '-9999px';
    gotoPanel.style.top  = '-9999px';
    gotoPanel.style.bottom = '';
    gotoPanel.hidden = false;
    const panelW = gotoPanel.offsetWidth;
    const panelH = gotoPanel.offsetHeight;
    gotoPanel.hidden = wasHidden;
    let top  = btnRect.bottom + 6;
    let left = btnRect.left;
    if (top + panelH > vh - MARGIN) top = btnRect.top - panelH - 6;
    top  = Math.min(Math.max(top,  MARGIN), vh - panelH - MARGIN);
    left = Math.min(Math.max(left, MARGIN), vw - panelW - MARGIN);
    gotoPanel.style.left = left + 'px';
    gotoPanel.style.top  = top  + 'px';
  }

  function openPanel() {
    positionPanel();
    gotoPanel.hidden = false;
    gotoBtn.setAttribute('aria-expanded', 'true');
    if (!window.matchMedia('(hover: none)').matches) { gotoX.focus(); gotoX.select(); }
  }

  function closePanel() {
    gotoPanel.hidden = true;
    gotoBtn.setAttribute('aria-expanded', 'false');
    gotoErr.hidden = true;
    gotoErr.textContent = '';
  }

  function showErr(msg) { gotoErr.textContent = msg; gotoErr.hidden = false; }

  function doGo() {
    const xVal = gotoX.value.trim(), zVal = gotoZ.value.trim();
    if (!xVal || !zVal) { showErr('Enter both X and Z.'); return; }
    const x = Math.floor(parseFloat(xVal)), z = Math.floor(parseFloat(zVal));
    if (!isFinite(x) || !isFinite(z)) { showErr('Invalid coordinates.'); return; }
    gotoErr.hidden = true;
    panX = x; panZ = z;
    refreshAll(false, true);
    closePanel();
  }

  function flashBtn(cls) {
    gotoPaste.classList.remove('flash-ok', 'flash-err');
    gotoPaste.classList.add(cls);
    setTimeout(() => gotoPaste.classList.remove(cls), 900);
  }

  gotoBtn.addEventListener('click', () => gotoPanel.hidden ? openPanel() : closePanel());
  gotoGo.addEventListener('click', doGo);
  gotoX.addEventListener('keydown', e => { if (e.key === 'Enter') { gotoZ.focus(); gotoZ.select(); } });
  gotoZ.addEventListener('keydown', e => { if (e.key === 'Enter') doGo(); });

  gotoPaste.addEventListener('click', async () => {
    gotoErr.hidden = true;
    try {
      const text = await navigator.clipboard.readText();
      const m    = XYZ_RE.exec(text);
      if (!m) {
        flashBtn('flash-err');
        showErr("Clipboard doesn't match format: x y z");
        return;
      }
      gotoX.value = Math.floor(parseFloat(m[1]));
      gotoZ.value = Math.floor(parseFloat(m[3]));
      flashBtn('flash-ok');
    } catch {
      showErr('Clipboard read failed.');
      flashBtn('flash-err');
    }
  });

  document.addEventListener('pointerdown', e => {
    if (!gotoPanel.hidden && !gotoPanel.contains(e.target) && e.target !== gotoBtn) closePanel();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !gotoPanel.hidden) closePanel(); });
  window.addEventListener('resize', () => { if (!gotoPanel.hidden) positionPanel(); });
})();