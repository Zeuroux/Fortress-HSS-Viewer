#include "finders.h"
#include "generator.h"

#include <string>
#include <unordered_map>
#include <vector>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>

#include <emscripten/bind.h>

struct Point3D {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;
};

struct BoundingBox {
    Point3D position;
    Point3D size;
};

struct RawResult {
    std::uint32_t ptr = 0;
    int count = 0;
};

static const std::unordered_map<std::string_view, MCVersion> mcVersionTable = {
    { "1.0.0",   MC_1_0_0  }, { "1.1.0",   MC_1_1_0  }, { "1.2.0",   MC_1_2_0  },
    { "1.4.0",   MC_1_4_0  }, { "1.5.0",   MC_1_5_0  }, { "1.6.0",   MC_1_6_0  },
    { "1.7.0",   MC_1_7_0  }, { "1.8.0",   MC_1_8_0  }, { "1.9.0",   MC_1_9_0  },
    { "1.10.0",  MC_1_10_0 }, { "1.11.0",  MC_1_11_0 }, { "1.12.0",  MC_1_12_0 },
    { "1.13.0",  MC_1_13_0 }, { "1.14.0",  MC_1_14_0 },
    { "1.16.0",  MC_1_16_0 }, { "1.17.0",  MC_1_17_0 }, { "1.17.30", MC_1_17_30 },
    { "1.18.0",  MC_1_18_0 }, { "1.19.0",  MC_1_19_0 }, { "1.20.0",  MC_1_20_0 },
    { "1.21.0",  MC_1_21_0 }, { "1.21.50", MC_1_21_50 }, { "1.21.60", MC_1_21_60 },
    { "26.20",   MC_26_20  },
};

inline MCVersion parseMCVersion(std::string_view version) {
    auto it = mcVersionTable.find(version);
    return (it != mcVersionTable.end()) ? it->second : MC_UNDEF;
}

inline int blockToRegion(int coord, int regionSizeInBlocks) {
    return coord < 0
        ? (coord - regionSizeInBlocks + 1) / regionSizeInBlocks
        : coord / regionSizeInBlocks;
}

inline std::vector<float> piecesToHSSFlat(const Piece* pieces, int count) {
    std::vector<float> boxes;
    boxes.reserve(static_cast<size_t>(count) * 24);

    auto floorDiv = [](int a, int b) {
        return (a >= 0) ? (a / b) : ((a - b + 1) / b);
    };

    for (int i = 0; i < count; ++i) {
        const Piece& p = pieces[i];
        int startX = p.bb0.x, endX = p.bb1.x + 1;
        int startY = p.bb0.y, endY = p.bb1.y + 1;
        int startZ = p.bb0.z, endZ = p.bb1.z + 1;

        int chunkX0 = floorDiv(startX, 16), chunkX1 = floorDiv(endX - 1, 16);
        int chunkZ0 = floorDiv(startZ, 16), chunkZ1 = floorDiv(endZ - 1, 16);

        float height = static_cast<float>(endY - startY);

        for (int cx = chunkX0; cx <= chunkX1; ++cx) {
            int sliceX0 = std::max(startX, cx * 16);
            int sliceX1 = std::min(endX, (cx + 1) * 16);

            for (int cz = chunkZ0; cz <= chunkZ1; ++cz) {
                int sliceZ0 = std::max(startZ, cz * 16);
                int sliceZ1 = std::min(endZ, (cz + 1) * 16);

                int sizeX = sliceX1 - sliceX0;
                int sizeZ = sliceZ1 - sliceZ0;

                float centerX = static_cast<float>(sliceX0 + sizeX / 2);
                float centerZ = static_cast<float>(sliceZ0 + sizeZ / 2);
                float offsetX = centerX + ((centerX != std::floor(centerX)) ? 0.5f : 0.0f);
                float offsetZ = centerZ + ((centerZ != std::floor(centerZ)) ? 0.5f : 0.0f);

                boxes.push_back(offsetX);
                boxes.push_back(static_cast<float>(startY));
                boxes.push_back(offsetZ);
                boxes.push_back(1.0f);
                boxes.push_back(height);
                boxes.push_back(1.0f);
            }
        }
    }
    return boxes;
}

inline std::vector<float> piecesToFlatBoxes(const Piece* pieces, int count) {
    std::vector<float> boxes;
    boxes.reserve(static_cast<size_t>(count) * 6);

    for (int i = 0; i < count; ++i) {
        const Piece& piece = pieces[i];
        boxes.push_back((piece.bb0.x + piece.bb1.x + 1) * 0.5f);
        boxes.push_back((piece.bb0.y + piece.bb1.y + 1) * 0.5f);
        boxes.push_back((piece.bb0.z + piece.bb1.z + 1) * 0.5f);
        boxes.push_back(static_cast<float>(piece.bb1.x - piece.bb0.x + 1));
        boxes.push_back(static_cast<float>(piece.bb1.y - piece.bb0.y + 1));
        boxes.push_back(static_cast<float>(piece.bb1.z - piece.bb0.z + 1));
    }
    return boxes;
}

static RawResult makeRawResult(std::vector<float>&& buffer) {
    if (buffer.empty()) {
        return {0, 0};
    }

    const std::size_t floatCount = buffer.size();
    float* data = static_cast<float*>(std::malloc(floatCount * sizeof(float)));
    if (!data) {
        return {0, 0};
    }

    std::memcpy(data, buffer.data(), floatCount * sizeof(float));
    return {static_cast<std::uint32_t>(reinterpret_cast<std::uintptr_t>(data)), static_cast<int>(floatCount / 6)};
}

inline void freeBuffer(std::uint32_t ptr) {
    if (ptr) {
        std::free(reinterpret_cast<void*>(static_cast<std::uintptr_t>(ptr)));
    }
}


RawResult findFortressHSSRaw(
    std::string version,
    int64_t     rawSeed,
    int         targetX,
    int         targetZ)
{
    const MCVersion mc   = parseMCVersion(version);
    const uint64_t  seed = static_cast<uint64_t>(rawSeed);

    if (mc == MC_UNDEF) {
        return {0, 0};
    }

    Generator g;
    setupGenerator(&g, mc, 0);
    applySeed(&g, DIM_NETHER, seed);

    StructureConfig sconf;
    if (!getStructureConfig(Fortress, mc, &sconf)) {
        return {0, 0};
    }

    const int chunkRadius      = 10;
    const int regionSizeChunks = sconf.regionSize;
    const int regionBlocks     = regionSizeChunks * 16;
    const int centerChunkX     = targetX >> 4;
    const int centerChunkZ     = targetZ >> 4;
    const int minRegX = blockToRegion((centerChunkX - chunkRadius) * 16, regionBlocks);
    const int maxRegX = blockToRegion((centerChunkX + chunkRadius) * 16, regionBlocks);
    const int minRegZ = blockToRegion((centerChunkZ - chunkRadius) * 16, regionBlocks);
    const int maxRegZ = blockToRegion((centerChunkZ + chunkRadius) * 16, regionBlocks);

    Piece* pieces = static_cast<Piece*>(std::calloc(static_cast<size_t>(2048), sizeof(Piece)));
    if (!pieces) {
        return {0, 0};
    }

    std::vector<float> boxes;

    for (int rz = minRegZ; rz <= maxRegZ; ++rz) {
        for (int rx = minRegX; rx <= maxRegX; ++rx) {
            Pos p;
            if (!getStructurePos(Fortress, mc, seed, rx, rz, &p))
                continue;
            if (!isViableStructurePos(Fortress, &g, p.x, p.z, 0))
                continue;

            const int fortChunkX = p.x >> 4;
            const int fortChunkZ = p.z >> 4;
            if (std::abs(fortChunkX - centerChunkX) > chunkRadius ||
                std::abs(fortChunkZ - centerChunkZ) > chunkRadius)
                continue;

            const int count = getFortressPieces(pieces, 2048, mc, seed, fortChunkX, fortChunkZ);
            if (count <= 0)
                continue;

            auto hss = piecesToHSSFlat(pieces, count);
            boxes.insert(boxes.end(), hss.begin(), hss.end());
        }
    }

    std::free(pieces);
    return makeRawResult(std::move(boxes));
}

RawResult findFortressBoxesRaw(
    std::string version,
    int64_t     rawSeed,
    int         centerX,
    int         centerZ,
    int         chunkRadius)
{
    const MCVersion mc   = parseMCVersion(version);
    const uint64_t  seed = static_cast<uint64_t>(rawSeed);

    if (mc == MC_UNDEF) {
        return {0, 0};
    }

    Generator g;
    setupGenerator(&g, mc, 0);
    applySeed(&g, DIM_NETHER, seed);

    StructureConfig sconf;
    if (!getStructureConfig(Fortress, mc, &sconf)) {
        return {0, 0};
    }

    const int regionSizeChunks = sconf.regionSize;
    const int regionBlocks     = regionSizeChunks * 16;
    const int centerChunkX = centerX >> 4;
    const int centerChunkZ = centerZ >> 4;
    const int minChunkX    = centerChunkX - chunkRadius;
    const int maxChunkX    = centerChunkX + chunkRadius;
    const int minChunkZ    = centerChunkZ - chunkRadius;
    const int maxChunkZ    = centerChunkZ + chunkRadius;
    const int minRegX = blockToRegion(minChunkX * 16, regionBlocks);
    const int maxRegX = blockToRegion(maxChunkX * 16, regionBlocks);
    const int minRegZ = blockToRegion(minChunkZ * 16, regionBlocks);
    const int maxRegZ = blockToRegion(maxChunkZ * 16, regionBlocks);

    std::vector<float> boxes;
    boxes.reserve(static_cast<size_t>(2048) * 6);

    Piece* pieces = static_cast<Piece*>(std::calloc(static_cast<size_t>(2048), sizeof(Piece)));
    if (!pieces) {
        return {0, 0};
    }

    for (int rz = minRegZ; rz <= maxRegZ; ++rz) {
        for (int rx = minRegX; rx <= maxRegX; ++rx) {
            Pos p;
            if (!getStructurePos(Fortress, mc, seed, rx, rz, &p))
                continue;
            if (!isViableStructurePos(Fortress, &g, p.x, p.z, 0))
                continue;

            const int fortChunkX = p.x >> 4;
            const int fortChunkZ = p.z >> 4;
            if (std::abs(fortChunkX - centerChunkX) > chunkRadius ||
                std::abs(fortChunkZ - centerChunkZ) > chunkRadius)
                continue;

            const int count = getFortressPieces(pieces, 2048, mc, seed, fortChunkX, fortChunkZ);
            if (count <= 0)
                continue;

            auto pieceBoxes = piecesToFlatBoxes(pieces, count);
            boxes.insert(boxes.end(), pieceBoxes.begin(), pieceBoxes.end());
        }
    }

    std::free(pieces);
    return makeRawResult(std::move(boxes));
}



using namespace emscripten;

EMSCRIPTEN_BINDINGS(fortress_module) {

    value_object<Point3D>("Point3D")
        .field("x", &Point3D::x)
        .field("y", &Point3D::y)
        .field("z", &Point3D::z);

    value_object<BoundingBox>("BoundingBox")
        .field("position", &BoundingBox::position)
        .field("size",     &BoundingBox::size);

    value_object<RawResult>("RawResult")
        .field("ptr", &RawResult::ptr)
        .field("count", &RawResult::count);

    function("findFortressHSSRaw", &findFortressHSSRaw);
    function("findFortressBoxesRaw", &findFortressBoxesRaw);
    function("freeBuffer", &freeBuffer);
}