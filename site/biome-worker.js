const BIOME_COLORS = {
  8:   [0x57, 0x25, 0x26],
  170: [0x4d, 0x3a, 0x2e],
  171: [0x98, 0x1a, 0x11],
  172: [0x49, 0x90, 0x7b],
  173: [0x64, 0x5f, 0x63],
  187: [0xc8, 0xd2, 0x32],
};

let modulePromise = null;
let Module = null;
let currentRequestId = 0;
let queue = [];
let processing = false;

function colorForBiome(id) {
  return BIOME_COLORS[id] || [0x3f, 0x3f, 0x3f];
}

function loadModule() {
  if (modulePromise) return modulePromise;

  importScripts('fortress.js');
  const factory = self.FortressModule || self.Module || self.fortress_module;
  if (!factory) {
    modulePromise = Promise.reject(new Error('FortressModule factory not found'));
  } else {
    modulePromise = factory().then(m => {
      Module = m;
      return m;
    });
  }

  return modulePromise;
}

function rawBiomesToPixels(raw, expectedCount) {
  if (!raw.ptr || raw.count !== expectedCount) {
    if (raw.ptr) Module.freeBuffer(raw.ptr);
    throw new Error(`Unexpected biome result count: ${raw.count}`);
  }

  const ids = new Float32Array(Module.HEAPF32.buffer, Number(raw.ptr), expectedCount);
  const pixels = new Uint8ClampedArray(expectedCount * 4);

  for (let i = 0, p = 0; i < expectedCount; ++i, p += 4) {
    const [r, g, b] = colorForBiome(Math.round(ids[i]));
    pixels[p] = r;
    pixels[p + 1] = g;
    pixels[p + 2] = b;
    pixels[p + 3] = 255;
  }

  Module.freeBuffer(raw.ptr);
  return pixels;
}

function delayFrame() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function processQueue() {
  if (processing) return;
  processing = true;

  try {
    await loadModule();

    while (queue.length > 0) {
      const job = queue.shift();
      if (job.requestId !== currentRequestId) continue;

      const raw = Module.findNetherBiomeTilesRaw(
        job.version,
        BigInt(job.seed),
        job.originX,
        job.originZ,
        job.columns,
        job.rows,
        job.step
      );

      if (job.requestId !== currentRequestId) {
        if (raw.ptr) Module.freeBuffer(raw.ptr);
        continue;
      }

      const pixels = rawBiomesToPixels(raw, job.columns * job.rows);
      self.postMessage({
        type: 'chunk',
        requestId: job.requestId,
        chunkKey: job.chunkKey,
        originX: job.originX,
        originZ: job.originZ,
        columns: job.columns,
        rows: job.rows,
        step: job.step,
        pixels: pixels.buffer,
      }, [pixels.buffer]);

      await delayFrame();
    }
  } catch (e) {
    self.postMessage({
      type: 'error',
      requestId: currentRequestId,
      message: e.message || String(e),
    });
  } finally {
    processing = false;
    if (queue.length > 0) processQueue();
  }
}

self.onmessage = e => {
  const data = e.data;

  if (data.type === 'cancel') {
    currentRequestId = data.requestId;
    queue = [];
    return;
  }

  if (data.type !== 'request') return;

  currentRequestId = data.requestId;
  queue = data.chunks.map(chunk => ({
    ...chunk,
    requestId: data.requestId,
    version: data.version,
    seed: data.seed,
  }));

  processQueue();
};
