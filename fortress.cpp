#include "finders.h"
#include "generator.h"

#include <algorithm>
#include <limits>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>

#include <emscripten/bind.h>
#include <emscripten/val.h>

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

constexpr int FORTRESS_RECORD_STRIDE = 9;
constexpr int BIOME_ID_STRIDE = 1;

static const std::unordered_map<std::string_view, MCVersion> mcVersionTable = {
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

inline int floorDiv(int a, int b) {
    return a < 0 ? (a - b + 1) / b : a / b;
}

inline int netherBiomeAtBlock(const Generator& g, int blockX, int blockZ) {
    return getBiomeAt(&g, 1, blockX, 0, blockZ);
}

inline std::vector<float> piecesToHSSFlat(const Piece* pieces, int count) {
    std::vector<float> boxes;
    boxes.reserve(static_cast<size_t>(count) * 24);

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

inline void appendFortressHSSBoxes(
    std::vector<float>& boxes,
    Piece*             pieces,
    int                mc,
    uint64_t           seed,
    int                fortChunkX,
    int                fortChunkZ)
{
    const int count = getFortressPieces(pieces, 2048, mc, seed, fortChunkX, fortChunkZ);
    if (count <= 0) {
        return;
    }

    auto hss = piecesToHSSFlat(pieces, count);
    boxes.insert(boxes.end(), hss.begin(), hss.end());
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

inline void appendFortressRecord(
    std::vector<float>& records,
    const Generator&   g,
    int                fortChunkX,
    int                fortChunkZ,
    const Piece*       pieces,
    int                count)
{
    if (count <= 0) {
        return;
    }

    int minX = std::numeric_limits<int>::max();
    int minZ = std::numeric_limits<int>::max();
    int maxX = std::numeric_limits<int>::min();
    int maxZ = std::numeric_limits<int>::min();

    for (int i = 0; i < count; ++i) {
        minX = std::min(minX, pieces[i].bb0.x);
        minZ = std::min(minZ, pieces[i].bb0.z);
        maxX = std::max(maxX, pieces[i].bb1.x + 1);
        maxZ = std::max(maxZ, pieces[i].bb1.z + 1);
    }

    const int blockX = fortChunkX * 16 + 8;
    const int blockZ = fortChunkZ * 16 + 8;
    const int biomeId = netherBiomeAtBlock(g, blockX, blockZ);

    records.push_back(static_cast<float>(blockX));
    records.push_back(static_cast<float>(blockZ));
    records.push_back(static_cast<float>(fortChunkX));
    records.push_back(static_cast<float>(fortChunkZ));
    records.push_back(static_cast<float>(minX));
    records.push_back(static_cast<float>(minZ));
    records.push_back(static_cast<float>(maxX));
    records.push_back(static_cast<float>(maxZ));
    records.push_back(static_cast<float>(biomeId));
}

static RawResult makeRawResult(std::vector<float>&& buffer, int stride = 6) {
    if (buffer.empty()) {
        return {0, 0};
    }

    const std::size_t floatCount = buffer.size();
    float* data = static_cast<float*>(std::malloc(floatCount * sizeof(float)));
    if (!data) {
        return {0, 0};
    }

    std::memcpy(data, buffer.data(), floatCount * sizeof(float));
    return {
        static_cast<std::uint32_t>(reinterpret_cast<std::uintptr_t>(data)),
        static_cast<int>(floatCount / static_cast<std::size_t>(stride))
    };
}

inline void freeBuffer(std::uint32_t ptr) {
    if (ptr) {
        std::free(reinterpret_cast<void*>(static_cast<std::uintptr_t>(ptr)));
    }
}


RawResult findFortressHSSSelectedRaw(
    std::string    version,
    int64_t        rawSeed,
    emscripten::val selectedFortresses)
{
    const MCVersion mc   = parseMCVersion(version);
    const uint64_t  seed = static_cast<uint64_t>(rawSeed);

    if (mc == MC_UNDEF) {
        return {0, 0};
    }

    const int length = selectedFortresses["length"].as<int>();
    if (length <= 0) {
        return {0, 0};
    }

    Piece* pieces = static_cast<Piece*>(std::calloc(static_cast<size_t>(2048), sizeof(Piece)));
    if (!pieces) {
        return {0, 0};
    }

    std::vector<float> boxes;

    for (int i = 0; i < length; ++i) {
        emscripten::val item = selectedFortresses[i];
        const int fortChunkX = item["chunkX"].as<int>();
        const int fortChunkZ = item["chunkZ"].as<int>();
        appendFortressHSSBoxes(boxes, pieces, mc, seed, fortChunkX, fortChunkZ);
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

RawResult findFortressesRaw(
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

    std::vector<float> records;

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
            appendFortressRecord(records, g, fortChunkX, fortChunkZ, pieces, count);
        }
    }

    std::free(pieces);
    return makeRawResult(std::move(records), FORTRESS_RECORD_STRIDE);
}

RawResult findNetherBiomeTilesRaw(
    std::string version,
    int64_t     rawSeed,
    int         originX,
    int         originZ,
    int         columns,
    int         rows,
    int         step)
{
    const MCVersion mc   = parseMCVersion(version);
    const uint64_t  seed = static_cast<uint64_t>(rawSeed);

    if (mc == MC_UNDEF || columns <= 0 || rows <= 0 || step <= 0) {
        return {0, 0};
    }

    Generator g;
    setupGenerator(&g, mc, 0);
    applySeed(&g, DIM_NETHER, seed);

    const long long cellCount = static_cast<long long>(columns) * static_cast<long long>(rows);
    if (cellCount > 8000000LL) {
        return {0, 0};
    }

    std::vector<float> ids;
    ids.reserve(static_cast<std::size_t>(cellCount));

    if (step == 1 || step == 4) {
        Range r = {
            step == 1 ? 1 : 4,
            step == 1 ? originX : floorDiv(originX, 4),
            step == 1 ? originZ : floorDiv(originZ, 4),
            columns,
            rows,
            0,
            1
        };
        int* cache = allocCache(&g, r);
        if (!cache) {
            return {0, 0};
        }

        const int err = genBiomes(&g, cache, r);
        if (err == 0) {
            for (long long i = 0; i < cellCount; ++i) {
                ids.push_back(static_cast<float>(cache[i]));
            }
        }

        std::free(cache);
        return makeRawResult(std::move(ids), BIOME_ID_STRIDE);
    }

    for (int row = 0; row < rows; ++row) {
        const int tileZ = originZ + row * step;
        for (int col = 0; col < columns; ++col) {
            const int tileX = originX + col * step;
            ids.push_back(static_cast<float>(netherBiomeAtBlock(g, tileX, tileZ)));
        }
    }

    return makeRawResult(std::move(ids), BIOME_ID_STRIDE);
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

    function("findFortressHSSSelectedRaw", &findFortressHSSSelectedRaw);
    function("findFortressBoxesRaw", &findFortressBoxesRaw);
    function("findFortressesRaw", &findFortressesRaw);
    function("findNetherBiomeTilesRaw", &findNetherBiomeTilesRaw);
    function("freeBuffer", &freeBuffer);
}
