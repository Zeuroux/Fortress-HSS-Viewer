function generateGeometry(armorStand, boxes) {
  const kUnitsPerBlock = 16.0;
  const kArmorStandBlockOffset = 8.0;
  const kWireframeThickness = 1.0;

  function worldXToLocal(asX, worldX) {
    return (worldX - asX) * kUnitsPerBlock - kArmorStandBlockOffset;
  }
  function worldYToLocal(asY, worldY) {
    return (worldY - asY) * kUnitsPerBlock;
  }
  function worldZToLocal(asZ, worldZ) {
    return (asZ - worldZ) * kUnitsPerBlock - kArmorStandBlockOffset;
  }

  function toLocalBounds(as, box) {
    const wx0 = box.px, wx1 = box.px + box.sx;
    const wy0 = box.py, wy1 = box.py + box.sy;
    const wz0 = box.pz - 1, wz1 = box.pz + box.sz - 1;

    const lx1 = worldXToLocal(as.x, wx0), lx2 = worldXToLocal(as.x, wx1);
    const ly1 = worldYToLocal(as.y, wy0), ly2 = worldYToLocal(as.y, wy1);
    const lz1 = worldZToLocal(as.z, wz0), lz2 = worldZToLocal(as.z, wz1);

    return {
      westX: Math.min(lx1, lx2), eastX: Math.max(lx1, lx2),
      bottomY: Math.min(ly1, ly2), topY: Math.max(ly1, ly2),
      southZ: Math.min(lz1, lz2), northZ: Math.max(lz1, lz2)
    };
  }

  function buildWireframeCubes(as, boxes) {
    const cubes = [];
    const t = kWireframeThickness;
    const ht = t * 0.5;

    for (const box of boxes) {
      const b = toLocalBounds(as, box);
      const w = b.eastX - b.westX;
      const h = b.topY - b.bottomY;
      const d = b.northZ - b.southZ;
      const rw = Math.max(w - t, 0.001);
      const rd = Math.max(d - t, 0.001);

      cubes.push({ ox: b.westX - ht, oy: b.bottomY - ht, oz: b.northZ - ht, sx: t, sy: h + t, sz: t, u: 1, v: 0 });
      cubes.push({ ox: b.eastX - ht, oy: b.bottomY - ht, oz: b.northZ - ht, sx: t, sy: h + t, sz: t, u: 0, v: 0 });
      cubes.push({ ox: b.westX - ht, oy: b.bottomY - ht, oz: b.southZ - ht, sx: t, sy: h + t, sz: t, u: 0, v: 0 });
      cubes.push({ ox: b.eastX - ht, oy: b.bottomY - ht, oz: b.southZ - ht, sx: t, sy: h + t, sz: t, u: 0, v: 0 });

      cubes.push({ ox: b.westX + ht, oy: b.bottomY - ht, oz: b.northZ - ht, sx: rw, sy: t, sz: t, u: 0, v: 0 });
      cubes.push({ ox: b.westX + ht, oy: b.bottomY - ht, oz: b.southZ - ht, sx: rw, sy: t, sz: t, u: 0, v: 0 });
      cubes.push({ ox: b.westX - ht, oy: b.bottomY - ht, oz: b.southZ + ht, sx: t, sy: t, sz: rd, u: 0, v: 0 });
      cubes.push({ ox: b.eastX - ht, oy: b.bottomY - ht, oz: b.southZ + ht, sx: t, sy: t, sz: rd, u: 0, v: 0 });

      cubes.push({ ox: b.westX + ht, oy: b.topY - ht, oz: b.northZ - ht, sx: rw, sy: t, sz: t, u: 0, v: 0 });
      cubes.push({ ox: b.westX + ht, oy: b.topY - ht, oz: b.southZ - ht, sx: rw, sy: t, sz: t, u: 0, v: 0 });
      cubes.push({ ox: b.westX - ht, oy: b.topY - ht, oz: b.southZ + ht, sx: t, sy: t, sz: rd, u: 0, v: 0 });
      cubes.push({ ox: b.eastX - ht, oy: b.topY - ht, oz: b.southZ + ht, sx: t, sy: t, sz: rd, u: 0, v: 0 });
    }
    return cubes;
  }

  const cubes = buildWireframeCubes(armorStand, boxes);

  let cubesStr = cubes.map((c, i) => {
    const prefix = i > 0 ? "," : "";
    return `${prefix}\n            { `
      + `"origin": [${c.ox.toFixed(4)}, ${c.oy.toFixed(4)}, ${c.oz.toFixed(4)}], `
      + `"size": [${c.sx.toFixed(4)}, ${c.sy.toFixed(4)}, ${c.sz.toFixed(4)}], `
      + `"uv": { `
      + `"north": {"uv": [${c.u}, ${c.v}], "uv_size": [1, 1]}, `
      + `"east":  {"uv": [${c.u}, ${c.v}], "uv_size": [1, 1]}, `
      + `"south": {"uv": [${c.u}, ${c.v}], "uv_size": [1, 1]}, `
      + `"west":  {"uv": [${c.u}, ${c.v}], "uv_size": [1, 1]}, `
      + `"up":    {"uv": [${c.u}, ${c.v}], "uv_size": [1, 1]}, `
      + `"down":  {"uv": [${c.u}, ${c.v}], "uv_size": [1, 1]} `
      + `} }`;
  }).join("");

  return `{
  "format_version": "1.12.0",
  "minecraft:geometry": [
    {
      "description": {
        "identifier": "geometry.bounding_boxes",
        "texture_width": 2,
        "texture_height": 1,
        "visible_bounds_width": 5120,
        "visible_bounds_height": 5120,
        "visible_bounds_offset": [0, 0.5, 0]
      },
      "bones": [
        {
          "name": "root",
          "pivot": [0, 0, 0],
          "cubes": [${cubesStr}
          ]
        }
      ]
    }
  ]
}`;
}

function generateManifest(name, description) {
  const manifest = {
    format_version: 2,
    header: {
      description,
      name,
      uuid: self.crypto.randomUUID(),
      version: [1, 0, 0],
      min_engine_version: [1, 16, 0]
    },
    modules: [
      {
        description,
        type: "resources",
        uuid: self.crypto.randomUUID(),
        version: [1, 0, 0]
      }
    ]
  };

  return JSON.stringify(manifest, null, 2);
}

function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getIconBounds(armorStand, boxes) {
  let xMin = armorStand.x;
  let xMax = armorStand.x;
  let zMin = armorStand.z;
  let zMax = armorStand.z;

  for (const box of boxes) {
    xMin = Math.min(xMin, box.px, box.px + box.sx);
    xMax = Math.max(xMax, box.px, box.px + box.sx);
    zMin = Math.min(zMin, box.pz, box.pz + box.sz);
    zMax = Math.max(zMax, box.pz, box.pz + box.sz);
  }

  return { xMin, xMax, zMin, zMax };
}

async function generatePackIcon(armorStand) {
  const iconSize = 512;
  const paddingBlocks = 12;
  const iconCanvas = document.createElement('canvas');
  iconCanvas.width = iconCanvas.height = iconSize;
  const iconCtx = iconCanvas.getContext('2d');

  iconCtx.fillStyle = getCssVar('--canvas-bg');
  iconCtx.fillRect(0, 0, iconSize, iconSize);

  const bounds = getIconBounds(armorStand, hssBoxes);
  const worldWidth = Math.max(1, bounds.xMax - bounds.xMin + paddingBlocks * 2);
  const worldHeight = Math.max(1, bounds.zMax - bounds.zMin + paddingBlocks * 2);
  const iconScale = (iconSize * 0.78) / Math.max(worldWidth, worldHeight);

  const worldToIcon = (wx, wz) => ({
    x: iconSize / 2 + (wx - armorStand.x) * iconScale,
    y: iconSize / 2 + (wz - armorStand.z) * iconScale
  });

  const CHUNK = 16;
  const OFF = -0.5;
  const halfWorld = Math.max(worldWidth, worldHeight) / 2;
  const leftWorld = armorStand.x - halfWorld;
  const topWorld = armorStand.z - halfWorld;
  const rightWorld = armorStand.x + halfWorld;
  const bottomWorld = armorStand.z + halfWorld;

  const gx0 = Math.floor((leftWorld - OFF) / CHUNK) * CHUNK + OFF;
  const gz0 = Math.floor((topWorld - OFF) / CHUNK) * CHUNK + OFF;

  for (let gx = gx0; gx <= rightWorld; gx += CHUNK) {
    const { x } = worldToIcon(gx, 0);
    const isReg = (gx - OFF) % 256 === 0;
    iconCtx.strokeStyle = getCssVar(isReg ? '--grid-region' : '--grid-chunk');
    iconCtx.lineWidth = Math.max(1, Math.min(2, iconScale * 0.08));
    iconCtx.beginPath();
    iconCtx.moveTo(x, 0);
    iconCtx.lineTo(x, iconSize);
    iconCtx.stroke();
  }

  for (let gz = gz0; gz <= bottomWorld; gz += CHUNK) {
    const { y } = worldToIcon(0, gz);
    const isReg = (gz - OFF) % 256 === 0;
    iconCtx.strokeStyle = getCssVar(isReg ? '--grid-region' : '--grid-chunk');
    iconCtx.lineWidth = Math.max(1, Math.min(2, iconScale * 0.08));
    iconCtx.beginPath();
    iconCtx.moveTo(0, y);
    iconCtx.lineTo(iconSize, y);
    iconCtx.stroke();
  }

  for (const b of autoBoxes) {
    const origin = worldToIcon(b.px - 0.5 - b.sx / 2, b.pz - 0.5 - b.sz / 2);
    iconCtx.fillStyle = 'rgba(220, 50, 50, 0.3)';
    iconCtx.strokeStyle = '#dc3232';
    iconCtx.lineWidth = 1;
    iconCtx.fillRect(origin.x, origin.y, b.sx * iconScale, b.sz * iconScale);
    iconCtx.strokeRect(origin.x, origin.y, b.sx * iconScale, b.sz * iconScale);
  }

  for (const b of hssBoxes) {
    const origin = worldToIcon(b.px - b.sx / 2, b.pz - b.sz / 2);
    iconCtx.fillStyle = 'rgba(58,107,138,0.35)';
    iconCtx.strokeStyle = '#3a6b8a';
    iconCtx.lineWidth = 1.25;
    iconCtx.fillRect(origin.x, origin.y, b.sx * iconScale, b.sz * iconScale);
    iconCtx.strokeRect(origin.x, origin.y, b.sx * iconScale, b.sz * iconScale);
  }

  const centerX = iconSize / 2;
  const centerY = iconSize / 2;
  const crossRadius = Math.max(6, iconSize * 0.015);
  iconCtx.strokeStyle = '#e05050';
  iconCtx.lineWidth = 3;
  iconCtx.beginPath();
  iconCtx.moveTo(centerX - crossRadius - 2, centerY);
  iconCtx.lineTo(centerX + crossRadius + 2, centerY);
  iconCtx.moveTo(centerX, centerY - crossRadius - 2);
  iconCtx.lineTo(centerX, centerY + crossRadius + 2);
  iconCtx.stroke();
  iconCtx.fillStyle = '#e05050';
  iconCtx.beginPath();
  iconCtx.arc(centerX, centerY, Math.max(4, iconSize * 0.008), 0, Math.PI * 2);
  iconCtx.fill();

  return await new Promise((resolve, reject) => {
    iconCanvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('Failed to create pack icon')); return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

async function generateResourcePack(armorStand, hssBoxes) {
  const name =
    document.getElementById("pack-name").value.trim() || "Fortress HSS";

  const description =
    `Resource pack for visualizing fortress HSS boxes using armor stands.\n` +
    `Place an armor stand at (${armorStand.x}, ${armorStand.y}, ${armorStand.z}) and give it a blaze rod to show the HSS boxes.`;

  const zip = new JSZip();
  zip.file("manifest.json", generateManifest(name, description));
  zip.file(
    "models/entity/custom_boxes.geo.json",
    generateGeometry(armorStand, hssBoxes)
  );
  zip.file("pack_icon.png", await generatePackIcon(armorStand));

  const templateFiles = [
    "template/animations/bounding_boxes.animation.json",
    "template/entity/armor_stand.entity.json",
    "template/models/entity/armor_stand.larger_render.geo.json",
    "template/render_controllers/bounding_box.render.json",
    "template/textures/bounding_box.png"
  ];

  await Promise.all(
    templateFiles.map(async (filePath) => {
      const res = await fetch(filePath);

      if (!res.ok) {
        throw new Error(
          `Failed to fetch ${filePath}: ${res.status} ${res.statusText}`
        );
      }

      const content = await res.blob();

      zip.file(
        filePath.replace("template/", ""),
        content
      );
    })
  );

  const blob = await zip.generateAsync({
    type: "blob"
  });

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.mcpack`;
  a.click();

  URL.revokeObjectURL(url);
}