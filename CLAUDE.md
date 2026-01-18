# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a web-based AdLib music player that plays IMS (Interactive Music System) and ROL (AdLib Visual Composer) music files using OPL2 FM synthesis in the browser. The project is built with React Router v7, TypeScript, and Tailwind CSS.

The codebase is a JavaScript/TypeScript port of legacy C code (EPLAYROL.C, ADLIB.C, IMS.C) that implements authentic OPL2 chip emulation and music playback.

## Commands

### Development
```bash
npm run dev          # Start development server at http://localhost:5173
npm run typecheck    # Run TypeScript type checking
```

### Production
```bash
npm run build        # Build for production
npm start            # Start production server
```

### Docker
```bash
docker build -t imsplay .
docker run -p 3000:3000 imsplay
```

## Architecture

### Core Music Engine (app/lib/)

The music playback system has three main layers:

1. **OPL Engine** (`app/lib/rol/opl-engine.ts`)
   - Wraps DBOPL (alib.js) to provide OPL2 chip emulation
   - Manages 9 melodic or 11 melodic+percussion voices
   - Handles register writes, pitch bends, and instrument timbres
   - Port of ADLIB.C from the original C implementation

2. **File Parsers**
   - `app/lib/rol/rol-parser.ts` - Parses ROL (AdLib Visual Composer) files
   - `app/lib/ims/ims-parser.ts` - Parses IMS (Interactive Music System) files
   - `app/lib/rol/bnk-parser.ts` - Parses BNK (instrument bank) files
   - All use `app/lib/rol/binary-reader.ts` for low-level byte reading

3. **Music Players**
   - `app/lib/rol/rol-player.ts` - ROL playback engine (port of EPLAYROL.C)
   - `app/lib/ims/ims-player.ts` - IMS playback engine (port of IMS.C)
   - Both implement tick-based event processing and audio generation

### React Integration (app/lib/hooks/)

- `useROLPlayer.ts` - React hook that bridges ROL player with Web Audio API
- `useIMSPlayer.ts` - React hook that bridges IMS player with Web Audio API
- Both hooks handle:
  - Web Audio API ScriptProcessorNode setup
  - Real-time sample generation and audio streaming
  - Safari autoplay policy compliance (AudioContext reuse)
  - UI state synchronization at 30fps

### Audio Architecture

The audio pipeline follows this flow:
1. Player.tick() processes music events and advances playback state
2. Player.generateSamples() requests OPL engine to generate audio
3. OPLEngine.generate() calls DBOPL to produce Int16Array samples
4. ScriptProcessorNode converts samples to Float32 and outputs to speakers
5. GainNode applies master volume control

**Important:** DBOPL can only generate max 512 samples per call, so requests must be chunked.

### Server-Side Rendering

- `app/routes/home.tsx` implements a loader that reads IMS file titles on the server
- IMS files store titles in Johab encoding (Korean charset)
- The loader uses `iconv` to convert Johab → UTF-8 before sending to client
- This avoids encoding issues in the browser

### UI Components (app/components/)

- `MusicPlayer.tsx` - Main player UI with DOS-style aesthetics
- `ChannelVisualizer.tsx` - Real-time channel volume visualization
- `PianoRoll.tsx` - Real-time piano roll display of active notes
- `dos-ui/` - Reusable DOS-themed UI components (buttons, panels, sliders, lists)

## File Format Details

### ROL Format
- Header contains TPB (ticks per beat), tempo, and drum mode
- Multiple channels with time-indexed events (notes, volumes, pitch bends, instruments)
- Uses BNK files for instrument definitions
- Note pitches stored 1 octave lower than actual (add +12 during playback)

### IMS Format
- Event-based format with running status (MIDI-like)
- 32KB paging system for large files
- Event types: 0x80/0x90 (note on), 0xA0 (volume), 0xC0 (instrument), 0xE0 (pitch), 0xF0 (tempo)
- Delta time encoding: 0xF8 = 240 ticks, 0xFC = loop marker
- Note pitches stored at chip level (add +12 to compensate for noteOn's -12 adjustment)

### BNK Format
- Contains instrument definitions (28 bytes each: operator parameters, waveforms)
- Header at offset 8 contains instrument count
- Instrument list and data offsets stored at offsets 12 and 16
- All instrument names normalized to lowercase for matching

## Important Implementation Notes

### Pitch Handling
- CHIP_MID_C = 48, MID_C = 60 (difference of 12 semitones)
- OPLEngine.noteOn() expects MIDI pitch and subtracts 12 to convert to chip pitch
- ROL files store notes 1 octave low → add +12 when calling noteOn
- IMS files store notes at chip level → add +12 to compensate for noteOn's -12

### Tempo Calculation
- ROL: tickDelay = 60000 / (TPB × tempo) ms
- IMS: tickDelay = 60000 / (240 × tempo) ms
- Based on PIT timer frequency (1.193182 MHz) and original DOS implementation

### Safari Compatibility
- Must reuse AudioContext across file loads to avoid autoplay blocking
- Always await audioContext.resume() before starting playback
- Use timeout on resume() to detect permanent suspension

### Volume Scaling
- Internal volumes: 0-127 (MIDI standard)
- Display volumes: decay from note-on value at rate of -8 per tick for UI effect
- Master volume applied via GainNode (0.0-1.0)
- Channel volumes combined multiplicatively with master volume

## Debugging Music Issues

### Wrong Instruments
1. Check BNK file loading: instrument names are case-insensitive
2. Verify instrument exists in STANDARD.BNK or custom BNK file
3. Look for "!" prefix in channel instrument names (indicates missing instrument)

### Playback Timing Issues
1. Verify samplesPerTick calculation matches getTickDelay()
2. Check for ScriptProcessorNode buffer underruns in console
3. Ensure lenGenRef properly accumulates/depletes samples

## Code Style Notes

- Original C code comments preserved in ported functions (e.g., "// EPLAYROL.C:444-484")
- Korean comments used in some files - these reference original Korean DOS software
- Binary reading offsets documented inline (e.g., "// Offset 44: TPB")
- Port fidelity: mathematical operations match original C exactly (including integer division)

## AdPlug WASM Patches

When modifying AdPlug source code (in `wasm/adplug/src/`), always keep a copy of the modified files in `wasm/adplug/patches/` folder. This ensures our customizations are preserved and can be reapplied if the upstream AdPlug source is updated.

Current patches:
- `patches/vgm.cpp` - VGM loop support: modified to properly handle loop_ofs in both data end detection and CMD_DATA_END command
