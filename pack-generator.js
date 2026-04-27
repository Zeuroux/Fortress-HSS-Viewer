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

async function generatePackIcon(armorStand, canvas) {
  const iconSize = 720;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const ap = worldToCanvas(armorStand.x, armorStand.z);

  const srcX = ap.cx * dpr - (iconSize / 2);
  const srcY = ap.cy * dpr - (iconSize / 2);

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = iconSize;
  cropCanvas.height = iconSize;
  const cropCtx = cropCanvas.getContext('2d');

  cropCtx.drawImage(canvas, srcX, srcY, iconSize, iconSize, 0, 0, iconSize, iconSize);

  return await new Promise((resolve, reject) => {
    cropCanvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('Failed to create pack icon')); return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

async function generateResourcePack(armorStand, hssBoxes, name, canvas) {
  const description =
    `Resource pack for visualizing fortress HSS boxes using armor stands.\n` +
    `Place an armor stand at (${armorStand.x}, ${armorStand.y}, ${armorStand.z}) and give it a blaze rod to show the HSS boxes.`;

  const zip = new JSZip();
  zip.file("manifest.json", generateManifest(name, description));
  zip.file(
    "models/entity/custom_boxes.geo.json",
    generateGeometry(armorStand, hssBoxes)
  );
  zip.file("pack_icon.png", await generatePackIcon(armorStand, canvas));

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