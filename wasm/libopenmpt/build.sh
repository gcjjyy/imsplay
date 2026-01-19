#!/bin/bash
# libopenmpt WASM Build Script
# Uses official Makefile with Emscripten support

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LIBOPENMPT_VERSION="0.8.0+release"
LIBOPENMPT_URL="https://lib.openmpt.org/files/libopenmpt/src/libopenmpt-${LIBOPENMPT_VERSION}.makefile.tar.gz"

# Check if emcc is available
if ! command -v emcc &> /dev/null; then
    echo "Error: Emscripten (emcc) not found. Please install emsdk first."
    echo "  git clone https://github.com/emscripten-core/emsdk.git"
    echo "  cd emsdk && ./emsdk install latest && ./emsdk activate latest"
    echo "  source ./emsdk_env.sh"
    exit 1
fi

echo "=== libopenmpt WASM Build ==="
echo "Using Emscripten: $(emcc --version | head -1)"

# Create directories
mkdir -p src dist

# Download libopenmpt if not exists
if [ ! -d "src/libopenmpt-${LIBOPENMPT_VERSION}" ]; then
    echo ""
    echo "=== Downloading libopenmpt ${LIBOPENMPT_VERSION} ==="
    cd src
    curl -L -o "libopenmpt.tar.gz" "$LIBOPENMPT_URL"
    tar xzf "libopenmpt.tar.gz"
    rm "libopenmpt.tar.gz"
    cd ..
fi

LIBOPENMPT_SRC="src/libopenmpt-${LIBOPENMPT_VERSION}"

echo ""
echo "=== Building libopenmpt with Emscripten ==="
cd "$LIBOPENMPT_SRC"

# Clean previous build
make CONFIG=emscripten EMSCRIPTEN_TARGET=wasm clean || true

# Build with Emscripten (WASM target with MODULARIZE for browser use)
# NO_ZLIB=1 NO_MPG123=1 NO_OGG=1 NO_VORBIS=1 NO_VORBISFILE=1 - disable optional dependencies
# Add MODULARIZE=1 for proper browser module loading
make CONFIG=emscripten EMSCRIPTEN_TARGET=wasm \
    NO_ZLIB=1 NO_MPG123=1 NO_OGG=1 NO_VORBIS=1 NO_VORBISFILE=1 NO_MINIMP3=1 \
    EXAMPLES=0 OPENMPT123=0 TEST=0 \
    LDFLAGS="-s MODULARIZE=1 -s EXPORT_NAME='libopenmpt' -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s DISABLE_EXCEPTION_CATCHING=0 -s ERROR_ON_UNDEFINED_SYMBOLS=1 -s EXPORTED_FUNCTIONS=\"['_malloc','_free']\" -s EXPORTED_RUNTIME_METHODS=\"['HEAPU8','HEAPF32','UTF8ToString','stringToUTF8','lengthBytesUTF8']\"" \
    -j$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

cd "$SCRIPT_DIR"

echo ""
echo "=== Copying WASM files ==="

# Find and copy the built files
if [ -f "$LIBOPENMPT_SRC/bin/libopenmpt.js" ]; then
    cp "$LIBOPENMPT_SRC/bin/libopenmpt.js" dist/
    echo "Copied libopenmpt.js"
fi

if [ -f "$LIBOPENMPT_SRC/bin/libopenmpt.wasm" ]; then
    cp "$LIBOPENMPT_SRC/bin/libopenmpt.wasm" dist/
    echo "Copied libopenmpt.wasm"
fi

# Alternative location
if [ -f "$LIBOPENMPT_SRC/bin/wasm/libopenmpt.js" ]; then
    cp "$LIBOPENMPT_SRC/bin/wasm/libopenmpt.js" dist/
    echo "Copied libopenmpt.js from wasm/"
fi

if [ -f "$LIBOPENMPT_SRC/bin/wasm/libopenmpt.wasm" ]; then
    cp "$LIBOPENMPT_SRC/bin/wasm/libopenmpt.wasm" dist/
    echo "Copied libopenmpt.wasm from wasm/"
fi

echo ""
echo "=== Build complete ==="
echo "Output files:"
ls -la dist/ 2>/dev/null || echo "No files in dist/"

# Show location of all .js and .wasm files in bin
echo ""
echo "Files in bin directory:"
find "$LIBOPENMPT_SRC/bin" -name "*.js" -o -name "*.wasm" 2>/dev/null || true
