#!/bin/bash
# AdPlug WASM Build Script
# Builds adplug 2.4 with NukedOPL for Emscripten/WASM

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if emcc is available
if ! command -v emcc &> /dev/null; then
    echo "Error: Emscripten (emcc) not found. Please install emsdk first."
    echo "  git clone https://github.com/emscripten-core/emsdk.git"
    echo "  cd emsdk && ./emsdk install latest && ./emsdk activate latest"
    echo "  source ./emsdk_env.sh"
    exit 1
fi

echo "=== AdPlug WASM Build ==="
echo "Using Emscripten: $(emcc --version | head -1)"

# Create build and dist directories
mkdir -p build dist

# Compiler flags
CFLAGS="-O3 -DSTDC_HEADERS=1 -Dstricmp=strcasecmp"
CXXFLAGS="-O3 -std=c++17 -DSTDC_HEADERS=1 -Dstricmp=strcasecmp"
# Note: Paths are relative to build directory
# -isystem makes binio.h findable with angle brackets
ADPLUG_INCLUDES="-I../src/src -isystem ../libbinio/src"
BINIO_INCLUDES="-isystem ../libbinio/src"

echo ""
echo "=== Building libbinio ==="
cd build
for src in binio.cpp binfile.cpp binwrap.cpp binstr.cpp; do
    echo "  Compiling $src..."
    emcc $CXXFLAGS -I../libbinio/src -c ../libbinio/src/$src -o ${src%.cpp}.o
done

echo ""
echo "=== Building adplug core ==="

# C sources
C_SOURCES="adlibemu.c debug.c depack.c fmopl.c nukedopl.c unlzh.c unlzss.c unlzw.c"
for src in $C_SOURCES; do
    echo "  Compiling $src..."
    emcc $CFLAGS $ADPLUG_INCLUDES -c ../src/src/$src -o ${src%.c}.o
done

# C++ sources (all format players)
CPP_SOURCES="
sixdepack.cpp
a2m.cpp a2m-v2.cpp adl.cpp adplug.cpp adtrack.cpp amd.cpp analopl.cpp
bam.cpp bmf.cpp cff.cpp cmf.cpp cmfmcsop.cpp coktel.cpp composer.cpp
d00.cpp database.cpp dfm.cpp diskopl.cpp dmo.cpp dro2.cpp dro.cpp dtm.cpp
emuopl.cpp flash.cpp fmc.cpp fprovide.cpp got.cpp herad.cpp hsc.cpp hsp.cpp
hybrid.cpp hyp.cpp imf.cpp jbm.cpp kemuopl.cpp ksm.cpp lds.cpp mad.cpp
mdi.cpp mid.cpp mkj.cpp msc.cpp mtk.cpp mtr.cpp mus.cpp nemuopl.cpp
pis.cpp player.cpp players.cpp plx.cpp protrack.cpp psi.cpp rad2.cpp
rat.cpp raw.cpp rix.cpp rol.cpp s3m.cpp sa2.cpp sng.cpp sop.cpp
surroundopl.cpp temuopl.cpp u6m.cpp vgm.cpp woodyopl.cpp xad.cpp xsm.cpp
"

for src in $CPP_SOURCES; do
    echo "  Compiling $src..."
    emcc $CXXFLAGS $ADPLUG_INCLUDES -c ../src/src/$src -o ${src%.cpp}.o
done

echo ""
echo "=== Building adapter ==="
emcc $CXXFLAGS $ADPLUG_INCLUDES -c ../adapter.cpp -o adapter.o

echo ""
echo "=== Linking WASM module ==="

# Collect all object files
OBJECTS="*.o"

# Link into WASM module
emcc -O3 \
    $OBJECTS \
    -s WASM=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME="AdPlugModule" \
    -s EXPORTED_FUNCTIONS="['_malloc','_free','_emu_init','_emu_teardown','_emu_add_file','_emu_load_file','_emu_compute_audio_samples','_emu_get_audio_buffer','_emu_get_audio_buffer_length','_emu_get_current_position','_emu_get_max_position','_emu_seek_position','_emu_get_track_info','_emu_get_subsong_count','_emu_set_subsong','_emu_get_sample_rate','_emu_rewind','_emu_get_current_tick','_emu_get_refresh_rate','_emu_set_loop_enabled','_emu_get_loop_enabled']" \
    -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','UTF8ToString','stringToUTF8','getValue','setValue','HEAPU8','HEAP16','HEAP32']" \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=16777216 \
    -s STACK_SIZE=1048576 \
    -s NO_EXIT_RUNTIME=1 \
    -s FILESYSTEM=0 \
    -o ../dist/adplug.js

cd ..

echo ""
echo "=== Build complete ==="
echo "Output files:"
ls -la dist/
