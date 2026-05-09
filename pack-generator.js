const MODEL_UNITS_PER_BLOCK = 16;
const COORD_PRECISION = 3;
const BLOCK_ALIGNMENT_OFFSET = 0.5;

function cleanNumber(value) {
  const rounded = parseFloat(value.toFixed(COORD_PRECISION));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatMolangNumber(value) {
  return String(cleanNumber(value));
}

function getBoxBounds(box) {
  const sx = Math.abs(box.sx);
  const sy = Math.abs(box.sy);
  const sz = Math.abs(box.sz);

  const minX = box.px - sx / 2 + BLOCK_ALIGNMENT_OFFSET;
  const maxX = box.px + sx / 2 + BLOCK_ALIGNMENT_OFFSET;
  const minY = Math.min(box.py, box.py + box.sy);
  const maxY = Math.max(box.py, box.py + box.sy);
  const minZ = box.pz - sz / 2 + BLOCK_ALIGNMENT_OFFSET;
  const maxZ = box.pz + sz / 2 + BLOCK_ALIGNMENT_OFFSET;

  return { minX, maxX, minY, maxY, minZ, maxZ, sx, sy, sz };
}

function computeGeometryAnchor(boxes) {
  if (!boxes.length) {
    return { x: 0, y: 0, z: 0 };
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const box of boxes) {
    const bounds = getBoxBounds(box);
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    minZ = Math.min(minZ, bounds.minZ);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
    maxZ = Math.max(maxZ, bounds.maxZ);
  }

  return {
    x: cleanNumber((minX + maxX) / 2),
    y: cleanNumber((minY + maxY) / 2),
    z: cleanNumber((minZ + maxZ) / 2)
  };
}

function generateAnimation(anchor) {
  const anchorX = formatMolangNumber(anchor.x);
  const anchorY = formatMolangNumber(anchor.y);
  const anchorZ = formatMolangNumber(anchor.z);
  const entityXFromAnchor = `(query.position(0) - (${anchorX}))`;
  const entityZFromAnchor = `(query.position(2) - (${anchorZ}))`;

  const animation = {
    format_version: "1.8.0",
    animations: {
      "animation.bounding_boxes": {
        loop: true,
        bones: {
          root: {
            scale: MODEL_UNITS_PER_BLOCK,
            rotation: [
              0,
              "-query.body_y_rotation",
              0
            ],
            position: [
              `(-(${entityXFromAnchor} * math.cos(query.body_y_rotation)) - (${entityZFromAnchor} * math.sin(query.body_y_rotation))) * ${MODEL_UNITS_PER_BLOCK}`,
              `((${anchorY}) - query.position(1)) * ${MODEL_UNITS_PER_BLOCK}`,
              `((${entityZFromAnchor} * math.cos(query.body_y_rotation)) - (${entityXFromAnchor} * math.sin(query.body_y_rotation))) * ${MODEL_UNITS_PER_BLOCK}`
            ]
          }
        }
      }
    }
  };

  return JSON.stringify(animation);
}

function generateSeeThroughMaterial() {
  const material = {
    materials: {
      version: "1.0.0",
      "bounding_boxes_see_through:entity_alphatest": {
        "+states": [
          "DisableDepthTest",
          "DisableDepthWrite",
          "DisableCulling"
        ]
      }
    }
  };

  return JSON.stringify(material);
}

async function fetchTemplate(filePath) {
  const res = await fetch(filePath);

  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${filePath}: ${res.status} ${res.statusText}`
    );
  }

  return res;
}

async function generateArmorStandEntity(seeThrough) {
  const res = await fetchTemplate("template/entity/armor_stand.entity.json");
  const entity = await res.json();
  const description = entity["minecraft:client_entity"].description;

  description.materials.bounding_boxes = seeThrough
    ? "bounding_boxes_see_through"
    : "entity_alphatest";

  return JSON.stringify(entity);
}

function generateGeometry(boxes, anchor) {
  const cubes = boxes.map(box => {
    const bounds = getBoxBounds(box);

    return {
      origin: [
        cleanNumber(bounds.minX - anchor.x),
        cleanNumber(bounds.minY - anchor.y),
        cleanNumber(anchor.z - bounds.maxZ)
      ],
      size: [
        cleanNumber(bounds.sx),
        cleanNumber(bounds.sy),
        cleanNumber(bounds.sz)
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

async function generateResourcePack(hssBoxes, name, options = {}) {
  const description =
    `Resource pack for visualizing fortress HSS boxes using armor stands.\n` +
    `Place an armor stand anywhere near you and give it a blaze rod to show the HSS boxes.`;
  const seeThrough = options.seeThrough === true;

  const anchor = computeGeometryAnchor(hssBoxes);
  const zip = new JSZip();
  zip.file("manifest.json", generateManifest(name, description));
  zip.file(
    "models/entity/bounding_boxes.geo.json",
    generateGeometry(hssBoxes, anchor)
  );
  zip.file(
    "animations/bounding_boxes.animation.json",
    generateAnimation(anchor)
  );
  zip.file(
    "entity/armor_stand.entity.json",
    await generateArmorStandEntity(seeThrough)
  );
  if (seeThrough) {
    zip.file("materials/entity.material", generateSeeThroughMaterial());
  }

  const templateFiles = [
    "template/models/entity/armor_stand.larger_render.geo.json",
    "template/render_controllers/bounding_box.render.json",
    "template/textures/bounding_box.png"
  ];

  await Promise.all(
    templateFiles.map(async (filePath) => {
      const res = await fetchTemplate(filePath);
      const content = await res.blob();

      zip.file(
        filePath.replace("template/", ""),
        content
      );
    })
  );

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/octet-stream"
  });

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.mcpack`;
  a.click();

  URL.revokeObjectURL(url);
}
