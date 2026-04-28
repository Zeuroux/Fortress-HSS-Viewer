const html = document.documentElement;
const themeBtn = document.getElementById('theme-toggle');
const verEl = document.getElementById('ver');
const seedEl = document.getElementById('seed');
const txEl = document.getElementById('tx');
const tzEl = document.getElementById('tz');
const status = document.getElementById('status');
const coords = document.getElementById('coords');

function applyTheme(t) {
  html.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  themeBtn.textContent = t === 'dark' ? '☽' : '☀';
  if (typeof draw === 'function' && typeof ctx !== 'undefined') {
    requestDraw();
  }
}

themeBtn.addEventListener('click', () => {
  applyTheme(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

function cssVar(name) {
  return getComputedStyle(html).getPropertyValue(name).trim();
}

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

let autoBoxes = [];
let hssBoxes = [];

const MIN_SCALE = 0.5;
const MAX_SCALE = 64;
const MAX_CHUNK_RADIUS = 512;

let panX = 0, panZ = 0, scale = 1;
let dragging = false, dragStartX = 0, dragStartZ = 0, dragOriginX = 0, dragOriginZ = 0;

let fetchTimeout = null;
let isFetching = false;

let rafPending = false;
function requestDraw() {
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; draw(); });
  }
}

let lastFetchedBounds = null;
function invalidateFetchBounds() { lastFetchedBounds = null; }

function resize() {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.floor(cw * dpr));
  canvas.height = Math.max(1, Math.floor(ch * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  invalidateFetchBounds();
  requestDraw();
  scheduleFetch();
}

function worldToCanvas(wx, wz) {
  return {
    cx: canvas.clientWidth / 2 + (wx - panX) * scale,
    cy: canvas.clientHeight / 2 + (wz - panZ) * scale,
  };
}

function canvasToWorld(cx, cy) {
  return {
    wx: (cx - canvas.clientWidth / 2) / scale + panX,
    wz: (cy - canvas.clientHeight / 2) / scale + panZ,
  };
}

function draw() {
  if (!ctx) return;
  const W = canvas.clientWidth, H = canvas.clientHeight;

  const colCanvasBg    = cssVar('--canvas-bg');
  const colGridChunk   = cssVar('--grid-chunk');
  const colGridRegion  = cssVar('--grid-region');
  const colAxis        = cssVar('--axis');
  const colBgStatus    = cssVar('--bg-status');
  const colBorderInput = cssVar('--border-input');
  const colTextOverlay = cssVar('--text-overlay');

  ctx.fillStyle = colCanvasBg;
  ctx.fillRect(0, 0, W, H);

  const CHUNK = 16;
  const OFF = -0.5;
  const tl = canvasToWorld(0, 0);
  const br = canvasToWorld(W, H);
  const cx0 = Math.floor((tl.wx - OFF) / CHUNK) * CHUNK + OFF;
  const cz0 = Math.floor((tl.wz - OFF) / CHUNK) * CHUNK + OFF;

  ctx.strokeStyle = colGridChunk;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gx = cx0; gx <= br.wx; gx += CHUNK) {
    if ((gx - OFF) % 256 === 0) continue;
    const { cx } = worldToCanvas(gx, 0);
    ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
  }
  for (let gz = cz0; gz <= br.wz; gz += CHUNK) {
    if ((gz - OFF) % 256 === 0) continue;
    const { cy } = worldToCanvas(0, gz);
    ctx.moveTo(0, cy); ctx.lineTo(W, cy);
  }
  ctx.stroke();

  ctx.strokeStyle = colGridRegion;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let gx = cx0; gx <= br.wx; gx += CHUNK) {
    if ((gx - OFF) % 256 !== 0) continue;
    const { cx } = worldToCanvas(gx, 0);
    ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
  }
  for (let gz = cz0; gz <= br.wz; gz += CHUNK) {
    if ((gz - OFF) % 256 !== 0) continue;
    const { cy } = worldToCanvas(0, gz);
    ctx.moveTo(0, cy); ctx.lineTo(W, cy);
  }
  ctx.stroke();

  const origin = worldToCanvas(0, 0);
  ctx.strokeStyle = colAxis; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(origin.cx, 0); ctx.lineTo(origin.cx, H);
  ctx.moveTo(0, origin.cy); ctx.lineTo(W, origin.cy);
  ctx.stroke();

  if (autoBoxes.length > 0) {
    ctx.fillStyle = 'rgba(220, 50, 50, 0.3)';
    ctx.beginPath();
    for (const b of autoBoxes) {
      const { cx, cy } = worldToCanvas(b.px - .5 - b.sx / 2, b.pz - .5 - b.sz / 2);
      const pw = b.sx * scale, ph = b.sz * scale;
      if (cx + pw < 0 || cx > W || cy + ph < 0 || cy > H) continue;
      ctx.rect(cx, cy, pw, ph);
    }
    ctx.fill();
    ctx.strokeStyle = '#dc3232';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const b of autoBoxes) {
      const { cx, cy } = worldToCanvas(b.px - .5 - b.sx / 2, b.pz - .5 - b.sz / 2);
      const pw = b.sx * scale, ph = b.sz * scale;
      if (cx + pw < 0 || cx > W || cy + ph < 0 || cy > H) continue;
      ctx.rect(cx, cy, pw, ph);
    }
    ctx.stroke();
  }

  if (hssBoxes.length > 0) {
    ctx.fillStyle = 'rgba(58,107,138,0.25)';
    ctx.beginPath();
    for (const b of hssBoxes) {
      const { cx, cy } = worldToCanvas(b.px - b.sx / 2, b.pz - b.sz / 2);
      const pw = b.sx * scale, ph = b.sz * scale;
      if (cx + pw < 0 || cx > W || cy + ph < 0 || cy > H) continue;
      ctx.rect(cx, cy, pw, ph);
    }
    ctx.fill();
    ctx.strokeStyle = '#3a6b8a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const b of hssBoxes) {
      const { cx, cy } = worldToCanvas(b.px - b.sx / 2, b.pz - b.sz / 2);
      const pw = b.sx * scale, ph = b.sz * scale;
      if (cx + pw < 0 || cx > W || cy + ph < 0 || cy > H) continue;
      ctx.rect(cx, cy, pw, ph);
    }
    ctx.stroke();
  }

  const RULER_SIZE = 24;
  const minTickPixels = 50;
  const tickStep = Math.max(1, Math.min(256, Math.floor(minTickPixels / scale)));
  const labelStep = tickStep <= 16 ? 16 : tickStep;
  const rulerCx0 = Math.floor((tl.wx - OFF) / tickStep) * tickStep + OFF;
  const rulerCz0 = Math.floor((tl.wz - OFF) / tickStep) * tickStep + OFF;

  ctx.fillStyle = colBgStatus;
  ctx.fillRect(0, 0, W, RULER_SIZE);
  ctx.fillRect(0, 0, RULER_SIZE, H);
  ctx.strokeStyle = colBorderInput;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(RULER_SIZE, RULER_SIZE - 0.5); ctx.lineTo(W, RULER_SIZE - 0.5);
  ctx.moveTo(RULER_SIZE - 0.5, RULER_SIZE); ctx.lineTo(RULER_SIZE - 0.5, H);
  ctx.stroke();

  ctx.fillStyle = colTextOverlay;
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  ctx.beginPath();
  for (let gx = rulerCx0; gx <= br.wx; gx += tickStep) {
    const { cx } = worldToCanvas(gx, 0);
    if (cx < RULER_SIZE || cx > W) continue;
    const tickHeight = (Math.round(gx + 0.5) % 256 === 0) ? 10 : 6;
    ctx.moveTo(cx, RULER_SIZE - tickHeight);
    ctx.lineTo(cx, RULER_SIZE);
  }
  ctx.stroke();
  for (let gx = rulerCx0; gx <= br.wx; gx += tickStep) {
    const { cx } = worldToCanvas(gx, 0);
    if (cx < RULER_SIZE || cx > W) continue;
    const worldX = Math.round(gx + 0.5);
    if (worldX % labelStep === 0) ctx.fillText(`${worldX}`, cx, 2);
  }

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.beginPath();
  for (let gz = rulerCz0; gz <= br.wz; gz += tickStep) {
    const { cy } = worldToCanvas(0, gz);
    if (cy < RULER_SIZE || cy > H) continue;
    const tickWidth = (Math.round(gz + 0.5) % 256 === 0) ? 10 : 6;
    ctx.moveTo(RULER_SIZE - tickWidth, cy);
    ctx.lineTo(RULER_SIZE, cy);
  }
  ctx.stroke();
  for (let gz = rulerCz0; gz <= br.wz; gz += tickStep) {
    const { cy } = worldToCanvas(0, gz);
    if (cy < RULER_SIZE || cy > H) continue;
    const worldZ = Math.round(gz + 0.5);
    if (worldZ % labelStep === 0) ctx.fillText(`${worldZ}`, RULER_SIZE - 4, cy);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('X', W - 18, 2);
  ctx.fillText('Z', 2, RULER_SIZE + 2);
}

let lastFetch = 0;
function fetchVisibleBoxes() {
  if (!moduleReady || isFetching) return;
  const version = verEl.value;
  const seedInput = seedEl.value;
  if (!version || !seedInput) return;

  const W = canvas.clientWidth, H = canvas.clientHeight;
  const tl = canvasToWorld(0, 0);
  const br = canvasToWorld(W, H);

  const centerX = Math.round((tl.wx + br.wx) / 2);
  const centerZ = Math.round((tl.wz + br.wz) / 2);

  const viewWidthChunks  = Math.ceil(Math.abs(br.wx - tl.wx) / 16) / 2;
  const viewHeightChunks = Math.ceil(Math.abs(br.wz - tl.wz) / 16) / 2;
  const chunkRadius = Math.min(Math.max(viewWidthChunks, viewHeightChunks) + 20, MAX_CHUNK_RADIUS);

  if (lastFetchedBounds) {
    const pad = 8 * 16;
    if (tl.wx >= lastFetchedBounds.minX + pad &&
        br.wx <= lastFetchedBounds.maxX - pad &&
        tl.wz >= lastFetchedBounds.minZ + pad &&
        br.wz <= lastFetchedBounds.maxZ - pad) {
      return;
    }
  }

  const rawSeed = BigInt(seedInput);
  isFetching = true;
  status.textContent = `loading… (r=${chunkRadius})`;

  try {
    const result = Module.findFortressBoxesRaw(version, rawSeed, centerX, centerZ, chunkRadius);
    autoBoxes = parseRawBoxes(result);

    const fetchedBlocks = chunkRadius * 16;
    lastFetchedBounds = {
      minX: centerX - fetchedBlocks,
      maxX: centerX + fetchedBlocks,
      minZ: centerZ - fetchedBlocks,
      maxZ: centerZ + fetchedBlocks,
    };

    if (hssBoxes.length === 0) {
      setStatus(autoBoxes.length === 0 ? '' : 'ok', `${autoBoxes.length} piece${autoBoxes.length === 1 ? '' : 's'}`);
    } else {
      setStatus('ok', `${hssBoxes.length} HSS`);
    }
  } catch (e) {
    if (hssBoxes.length === 0) {
      setStatus('err', 'fetch error: ' + e.message);
    }
  }

  isFetching = false;
  requestDraw();
}

function parseRawBoxes(raw) {
  if (!raw.ptr || raw.count <= 0) return [];
  const ptr = Number(raw.ptr);
  const count = Number(raw.count);
  if (!Number.isFinite(ptr) || ptr % 4 !== 0 || count <= 0) return [];
  const floatCount = count * 6;
  const data = new Float32Array(Module.HEAPF32.buffer, ptr, floatCount);
  const boxes = new Array(count);
  for (let i = 0, j = 0; i < count; ++i, j += 6) {
    boxes[i] = {
      px: data[j], py: data[j + 1], pz: data[j + 2],
      sx: data[j + 3], sy: data[j + 4], sz: data[j + 5]
    };
  }
  Module.freeBuffer(ptr);
  return boxes;
}

function scheduleFetch() {
  if (fetchTimeout) clearTimeout(fetchTimeout);
  fetchTimeout = setTimeout(fetchVisibleBoxes, 400);
}

const CLICK_THRESHOLD = 5;
const pointerState = {
  pointers: new Map(),
  dragging: false,
  moved: false,
  dragStartX: 0,
  dragStartY: 0,
  dragOriginX: 0,
  dragOriginZ: 0,
  pinchStartDist: 0,
  pinchStartScale: scale,
};

const vp = document.getElementById('viewport');
const getPointerOffset = e => {
  const rect = vp.getBoundingClientRect();
  return { offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
};

function updateCoordsFromEvent(e) {
  const { offsetX, offsetY } = getPointerOffset(e);
  const { wx, wz } = canvasToWorld(offsetX, offsetY);
  coords.textContent = `X ${Math.round(wx)}  Z ${Math.round(wz)}`;
}

function setPointerDrag(e) {
  pointerState.dragging = true;
  pointerState.moved = false;
  pointerState.dragStartX = e.clientX;
  pointerState.dragStartY = e.clientY;
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

  if (pointerState.pointers.size === 1) {
    setPointerDrag(e);
  } else if (pointerState.pointers.size === 2) {
    pointerState.dragging = false;
    pointerState.moved = true;
    const pts = Array.from(pointerState.pointers.values());
    pointerState.pinchStartDist = getDistance(pts[0], pts[1]);
    pointerState.pinchStartScale = scale;
  }
  updateCoordsFromEvent(e);
});

vp.addEventListener('pointermove', e => {
  if (!pointerState.pointers.has(e.pointerId)) return;
  pointerState.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  updateCoordsFromEvent(e);

  if (pointerState.pointers.size === 1 && pointerState.dragging) {
    const dx = e.clientX - pointerState.dragStartX;
    const dy = e.clientY - pointerState.dragStartY;
    if (Math.abs(dx) > CLICK_THRESHOLD || Math.abs(dy) > CLICK_THRESHOLD) {
      pointerState.moved = true;
    }
    panX = pointerState.dragOriginX - dx / scale;
    panZ = pointerState.dragOriginZ - dy / scale;
    requestDraw();
    if (pointerState.moved) fetchVisibleBoxes();
  } else if (pointerState.pointers.size === 2) {
    const pts = Array.from(pointerState.pointers.values());
    const newDist = getDistance(pts[0], pts[1]);
    if (pointerState.pinchStartDist > 0) {
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pointerState.pinchStartScale * (newDist / pointerState.pinchStartDist)));
      if (newScale !== scale) {
        pointerState.moved = true;
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        const rect = vp.getBoundingClientRect();
        const worldMid = canvasToWorld(midX - rect.left, midY - rect.top);
        scale = newScale;
        panX = worldMid.wx - ((midX - rect.left) - canvas.clientWidth / 2) / scale;
        panZ = worldMid.wz - ((midY - rect.top) - canvas.clientHeight / 2) / scale;
        requestDraw();
      }
    }
  }
});

function cleanupPointer(e) {
  pointerState.pointers.delete(e.pointerId);
  if (pointerState.pointers.size === 0) {
    if (pointerState.dragging && !pointerState.moved) {
      const { offsetX, offsetY } = getPointerOffset(e);
      const { wx, wz } = canvasToWorld(offsetX, offsetY);
      const rx = Math.round(wx);
      const rz = Math.round(wz);
      document.getElementById('tx').value = rx;
      document.getElementById('tz').value = rz;
      run(rx, rz);
      requestDraw();
    }
    pointerState.dragging = false;
    pointerState.moved = false;
    pointerState.pinchStartDist = 0;
  } else if (pointerState.pointers.size === 1) {
    const remaining = pointerState.pointers.values().next().value;
    if (remaining) {
      pointerState.dragging = true;
      pointerState.moved = true;
      pointerState.dragStartX = remaining.x;
      pointerState.dragStartY = remaining.y;
      pointerState.dragOriginX = panX;
      pointerState.dragOriginZ = panZ;
    }
  }
}

vp.addEventListener('pointerup', cleanupPointer);
vp.addEventListener('pointercancel', cleanupPointer);

vp.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = vp.getBoundingClientRect();
  const offsetX = e.clientX - rect.left;
  const offsetY = e.clientY - rect.top;
  const { wx, wz } = canvasToWorld(offsetX, offsetY);
  const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const newScale = scale * f;

  if (newScale < MIN_SCALE || newScale > MAX_SCALE) {
    requestDraw();
    return;
  }

  scale = newScale;
  panX = wx - (offsetX - canvas.clientWidth / 2) / scale;
  panZ = wz - (offsetY - canvas.clientHeight / 2) / scale;
  requestDraw();
  fetchVisibleBoxes();
}, { passive: false });

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
    panX = parseInt(txEl.value) || 0;
    panZ = parseInt(tzEl.value) || 0;
  }).catch(err => setStatus('err', 'wasm init failed: ' + err));
};
script.onerror = () => setStatus('err', 'fortress.js not found');
document.head.appendChild(script);

document.getElementById('seed').addEventListener('input', () => { hssBoxes = []; invalidateFetchBounds(); scheduleFetch();});
document.getElementById('ver').addEventListener('change', () => { hssBoxes = []; invalidateFetchBounds(); scheduleFetch(); });

document.getElementById('download').addEventListener('click', async () => {
  generateResourcePack(hssBoxes, document.getElementById("pack-name").value.trim() || "Fortress HSS")
});

const updateFromCoordString = (text) => {
  const matches = [...text.matchAll(/-?\d+(?:\.\d+)?/g)];
  if (matches.length < 3) return false;

  const [x, y, z] = matches.slice(0, 3).map(m => Math.floor(Number(m[0])));

  txEl.value = x;
  tzEl.value = z;

  panX = x;
  panZ = z;

  run(x, z);
  requestDraw();

  return true;
};

document.addEventListener('paste', (e) => {
  const activeTag = document.activeElement?.tagName;
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

  const text = (e.clipboardData || window.clipboardData).getData('text');
  if (updateFromCoordString(text)) {
    e.preventDefault();
  }
});

document.getElementById('paste-coords').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!updateFromCoordString(text)) {
      setStatus('err', 'Clipboard does not contain valid coordinates (need 3 numbers)');
    }
  } catch (err) {
    setStatus('err', `Failed to read clipboard: ${err.message}`);
  }
});

function run(tx, tz) {
  if (!moduleReady) { setStatus('err', 'wasm not ready yet'); return; }

  const version = verEl.value;
  const rawSeed = BigInt(seedEl.value || '0');

  setStatus('', `searching HSS… seed=${rawSeed}`);

  try {
    const result = Module.findFortressHSSRaw(version, rawSeed, tx, tz);
    hssBoxes = parseRawBoxes(result);

    panX = tx; panZ = tz;

    setStatus(hssBoxes.length === 0 ? 'err' : 'ok',
      hssBoxes.length === 0 ? 'no fortress found in range' : `${hssBoxes.length} HSS box${hssBoxes.length === 1 ? '' : 'es'}`);
  } catch (e) {
    setStatus('err', 'error: ' + e.message);
  }

  requestDraw();
  invalidateFetchBounds();
  scheduleFetch();
}

function setStatus(cls, msg) {
  status.textContent = msg;
  status.className = cls;
}

const savedTheme = localStorage.getItem('theme') || 'dark';
applyTheme(savedTheme);

window.addEventListener('resize', resize);
resize();