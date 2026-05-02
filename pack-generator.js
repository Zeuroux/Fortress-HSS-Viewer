function generateGeometry(boxes) {
  const cubes = boxes.map(box => {
    const ox = Math.min(box.px, box.px + box.sx);
    const oy = Math.min(box.py, box.py + box.sy);
    const oz = -Math.max(box.pz, box.pz + box.sz);

    const sx = Math.abs(box.sx);
    const sy = Math.abs(box.sy);
    const sz = Math.abs(box.sz);

    return {
      origin: [
        parseFloat(ox.toFixed(1)), 
        parseFloat(oy.toFixed(1)), 
        parseFloat(oz.toFixed(1))
      ],
      size: [
        parseFloat(sx.toFixed(1)), 
        parseFloat(sy.toFixed(1)), 
        parseFloat(sz.toFixed(1))
      ],
      uv: {
        north: { uv: [0, 0],  uv_size: [16, 16] },
        west:  { uv: [0, 0],  uv_size: [16, 16] },
        up:    { uv: [0, 16], uv_size: [16, 16] },
        down:  { uv: [0, 16], uv_size: [16, 16] },
        south: { uv: [16, 32], uv_size: [-16, 16] },
        east:  { uv: [0, 32], uv_size: [16, 16] }
      }
    };
  });

  const geometry = {
    format_version: "1.12.0",
    "minecraft:geometry": [
      {
        description: {
          identifier: "geometry.bounding_boxes",
          texture_width: 16,
          texture_height: 48,
          visible_bounds_width: 5120,
          visible_bounds_height: 5120,
          visible_bounds_offset: [0, 0.5, 0]
        },
        bones: [
          {
            name: "root",
            pivot: [0, 0, 0],
            cubes: cubes
          }
        ]
      }
    ]
  };

  return JSON.stringify(geometry);
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

  return JSON.stringify(manifest);
}

async function generateResourcePack(hssBoxes, name) {
  const description =
    `Resource pack for visualizing fortress HSS boxes using armor stands.\n` +
    `Place an armor stand anywhere near you and give it a blaze rod to show the HSS boxes.`;

  const zip = new JSZip();
  zip.file("manifest.json", generateManifest(name, description));
  zip.file(
    "models/entity/bounding_boxes.geo.json",
    generateGeometry(hssBoxes)
  );

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