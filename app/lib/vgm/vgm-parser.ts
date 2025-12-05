/**
 * vgm-parser.ts - VGM file parser for YM3812/OPL2
 */

import type { VGMHeader, VGMCommand, VGMData } from './vgm-types';

// VGM Command Codes
const VGM_CMD_YM3812_WRITE = 0x5a;
const VGM_CMD_WAIT_LONG = 0x61;
const VGM_CMD_WAIT_NTSC = 0x62;
const VGM_CMD_WAIT_PAL = 0x63;
const VGM_CMD_END = 0x66;

const VGM_WAIT_NTSC_SAMPLES = 735;
const VGM_WAIT_PAL_SAMPLES = 882;

// VGM Header Offsets
const VGM_OFFSET_MAGIC = 0x00;
const VGM_OFFSET_EOF = 0x04;
const VGM_OFFSET_VERSION = 0x08;
const VGM_OFFSET_GD3 = 0x14;
const VGM_OFFSET_TOTAL_SAMPLES = 0x18;
const VGM_OFFSET_LOOP_OFFSET = 0x1c;
const VGM_OFFSET_LOOP_SAMPLES = 0x20;
const VGM_OFFSET_DATA = 0x34;
const VGM_OFFSET_YM3812_CLOCK = 0x50;

export const VGM_SAMPLE_RATE = 44100;

/**
 * Check if a VGM file uses YM3812/OPL2 chip
 * Returns true if the file is a valid VGM with YM3812 clock set
 */
export function isYM3812VGM(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 0x54) return false;

  const view = new DataView(buffer);
  const magic = String.fromCharCode(
    view.getUint8(0), view.getUint8(1),
    view.getUint8(2), view.getUint8(3)
  );
  if (magic !== 'Vgm ') return false;

  // YM3812 clock at offset 0x50
  const ym3812Clock = view.getUint32(0x50, true);
  return ym3812Clock !== 0;
}

/**
 * Parse VGM file header
 */
function parseHeader(view: DataView): VGMHeader {
  const magic = String.fromCharCode(
    view.getUint8(VGM_OFFSET_MAGIC),
    view.getUint8(VGM_OFFSET_MAGIC + 1),
    view.getUint8(VGM_OFFSET_MAGIC + 2),
    view.getUint8(VGM_OFFSET_MAGIC + 3)
  );

  if (magic !== 'Vgm ') {
    throw new Error(`Invalid VGM magic: expected "Vgm ", got "${magic}"`);
  }

  const eofOffset = view.getUint32(VGM_OFFSET_EOF, true);
  const version = view.getUint32(VGM_OFFSET_VERSION, true);
  const gd3Offset = view.getUint32(VGM_OFFSET_GD3, true);
  const totalSamples = view.getUint32(VGM_OFFSET_TOTAL_SAMPLES, true);
  const loopOffset = view.getUint32(VGM_OFFSET_LOOP_OFFSET, true);
  const loopSamples = view.getUint32(VGM_OFFSET_LOOP_SAMPLES, true);

  const dataOffsetRel = view.getUint32(VGM_OFFSET_DATA, true);
  const dataOffset = dataOffsetRel === 0 ? 0x40 : VGM_OFFSET_DATA + dataOffsetRel;

  let ym3812Clock = 0;
  if (view.byteLength > VGM_OFFSET_YM3812_CLOCK + 4) {
    ym3812Clock = view.getUint32(VGM_OFFSET_YM3812_CLOCK, true);
  }

  return {
    magic,
    eofOffset,
    version,
    gd3Offset,
    totalSamples,
    loopOffset,
    loopSamples,
    ym3812Clock,
    dataOffset,
  };
}

/**
 * Parse VGM command stream
 */
function parseCommands(view: DataView, startOffset: number): VGMCommand[] {
  const commands: VGMCommand[] = [];
  let offset = startOffset;
  let absoluteSample = 0;

  while (offset < view.byteLength) {
    const cmd = view.getUint8(offset);
    offset++;

    if (cmd === VGM_CMD_YM3812_WRITE) {
      const register = view.getUint8(offset);
      const value = view.getUint8(offset + 1);
      offset += 2;

      commands.push({
        type: 'write',
        register,
        value,
        absoluteSample,
      });
    } else if (cmd === VGM_CMD_WAIT_LONG) {
      const samples = view.getUint16(offset, true);
      offset += 2;
      absoluteSample += samples;

      commands.push({
        type: 'wait',
        samples,
        absoluteSample,
      });
    } else if (cmd === VGM_CMD_WAIT_NTSC) {
      absoluteSample += VGM_WAIT_NTSC_SAMPLES;

      commands.push({
        type: 'wait',
        samples: VGM_WAIT_NTSC_SAMPLES,
        absoluteSample,
      });
    } else if (cmd === VGM_CMD_WAIT_PAL) {
      absoluteSample += VGM_WAIT_PAL_SAMPLES;

      commands.push({
        type: 'wait',
        samples: VGM_WAIT_PAL_SAMPLES,
        absoluteSample,
      });
    } else if (cmd >= 0x70 && cmd <= 0x7f) {
      // 0x70 = 7 samples, 0x7F = 22 samples
      const samples = (cmd & 0x0f) + 7;
      absoluteSample += samples;

      commands.push({
        type: 'wait',
        samples,
        absoluteSample,
      });
    } else if (cmd === VGM_CMD_END) {
      commands.push({
        type: 'end',
        absoluteSample,
      });
      break;
    } else {
      // Skip unknown commands
      if (cmd === 0x4f || cmd === 0x50) {
        offset += 1;
      } else if (cmd >= 0x51 && cmd <= 0x5f && cmd !== VGM_CMD_YM3812_WRITE) {
        offset += 2;
      } else if (cmd === 0x67) {
        offset += 2;
        const blockSize = view.getUint32(offset, true);
        offset += 4 + blockSize;
      } else if (cmd >= 0x80 && cmd <= 0x8f) {
        const samples = cmd & 0x0f;
        absoluteSample += samples;
      } else if (cmd === 0xe0) {
        offset += 4;
      }
    }
  }

  return commands;
}

/**
 * Parse a VGM file buffer
 */
export function parseVGM(buffer: ArrayBuffer): VGMData {
  const view = new DataView(buffer);

  const header = parseHeader(view);

  if (header.ym3812Clock === 0) {
    console.warn('Warning: VGM file does not specify YM3812 clock. Assuming it contains OPL2 data.');
  }

  const commands = parseCommands(view, header.dataOffset);

  return {
    header,
    commands,
  };
}
