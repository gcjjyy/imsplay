# AdPlug WASM Build

## Prerequisites

Before building, clone the required dependencies:

```bash
# Clone AdPlug 2.4
git clone --depth 1 --branch adplug-2.4 https://github.com/adplug/adplug.git src

# Clone libbinio
git clone --depth 1 https://github.com/adplug/libbinio.git libbinio
```

## Build

```bash
./build.sh
```

Output files will be in `dist/` directory.
