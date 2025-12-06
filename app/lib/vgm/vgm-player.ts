/**
 * vgm-player.ts - VGM playback engine
 *
 * VGM plays directly by writing to OPL2 registers.
 * Unlike IMS/ROL which use tick-based events, VGM is sample-based.
 */

import { OPLEngine } from "../rol/opl-engine";
import type { VGMData, VGMPlaybackState } from "./vgm-types";
import { VGM_SAMPLE_RATE } from "./vgm-parser";

// OPL2 슬롯 → 채널 매핑 (melodic mode)
const SLOT_TO_CHANNEL: number[] = [
  0, 1, 2, 0, 1, 2, -1, -1, -1,  // 0x00-0x08 → 채널 0,1,2
  3, 4, 5, 3, 4, 5, -1, -1, -1,  // 0x09-0x11 → 채널 3,4,5
  6, 7, 8, 6, 7, 8               // 0x12-0x17 → 채널 6,7,8
];

// 슬롯 오프셋 테이블 (레지스터 주소에서 슬롯 번호 계산용)
const SLOT_OFFSETS = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 21];

export class VGMPlayer {
  private vgmData: VGMData;
  private oplEngine: OPLEngine;

  // Playback state
  private commandIndex: number = 0;
  private currentSample: number = 0;
  private isPlaying: boolean = false;
  private loopEnabled: boolean = false;

  // Volume
  private masterVolume: number = 127;

  // Sample rate conversion
  private actualSampleRate: number = 44100;
  private sampleRateRatio: number = 1.0; // VGM_SAMPLE_RATE / actualSampleRate

  // Channel tracking (for visualization)
  private channelKeyOn: boolean[] = new Array(9).fill(false);
  private channelVolumes: number[] = new Array(9).fill(0);      // 실제 볼륨
  private displayVolumes: number[] = new Array(9).fill(0);      // 디스플레이용 볼륨 (decay 효과)
  private channelNotes: number[] = new Array(9).fill(0);
  private slotLevels: number[] = new Array(18).fill(63); // Total Level (0=loud, 63=silent)
  private channelFNum: number[] = new Array(9).fill(0);
  private channelBlock: number[] = new Array(9).fill(0);

  // Decay 처리용
  private lastDecayTime: number = 0;
  private readonly DECAY_INTERVAL_MS = 30;   // 30ms마다 decay
  private readonly DECAY_AMOUNT = 8;          // 매 interval마다 감소량

  constructor(vgmData: VGMData, oplEngine: OPLEngine) {
    this.vgmData = vgmData;
    this.oplEngine = oplEngine;
  }

  /**
   * Initialize player
   */
  async initialize(sampleRate: number): Promise<void> {
    await this.oplEngine.init(sampleRate);
    this.oplEngine.setMode(0); // Melodic mode

    // VGM은 44100Hz 기준, 실제 샘플레이트와 비율 계산
    this.actualSampleRate = sampleRate;
    this.sampleRateRatio = VGM_SAMPLE_RATE / sampleRate;

    this.commandIndex = 0;
    this.currentSample = 0;
    this.isPlaying = false;
  }

  /**
   * Start playback
   */
  play(): void {
    this.isPlaying = true;
  }

  /**
   * Pause playback
   */
  pause(): void {
    this.isPlaying = false;
  }

  /**
   * Stop and reset
   */
  stop(): void {
    this.isPlaying = false;
    this.rewind();
  }

  /**
   * Rewind to beginning
   */
  rewind(): void {
    this.commandIndex = 0;
    this.currentSample = 0;

    // Reset OPL
    for (let i = 0; i < 9; i++) {
      this.oplEngine.noteOff(i);
    }
  }

  /**
   * Set loop enabled
   */
  setLoopEnabled(enabled: boolean): void {
    this.loopEnabled = enabled;
  }

  /**
   * Set master volume (0-127)
   */
  setVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(127, volume));
  }

  /**
   * Track register writes for visualization
   */
  private trackRegister(register: number, value: number): void {
    // 0x40-0x55: KSL/Total Level (슬롯별 볼륨)
    if (register >= 0x40 && register <= 0x55) {
      const offset = register - 0x40;
      const slotIndex = SLOT_OFFSETS.indexOf(offset);
      if (slotIndex >= 0 && slotIndex < 18) {
        this.slotLevels[slotIndex] = value & 0x3F; // 하위 6비트가 Total Level
      }
    }
    // 0xA0-0xA8: F-Number 하위 8비트
    else if (register >= 0xA0 && register <= 0xA8) {
      const ch = register - 0xA0;
      this.channelFNum[ch] = (this.channelFNum[ch] & 0x300) | value;
      this.updateChannelNote(ch);
    }
    // 0xB0-0xB8: Key-On, Block, F-Number 상위
    else if (register >= 0xB0 && register <= 0xB8) {
      const ch = register - 0xB0;
      const keyOn = (value & 0x20) !== 0;
      const block = (value >> 2) & 0x07;
      const fNumHigh = value & 0x03;

      this.channelKeyOn[ch] = keyOn;
      this.channelBlock[ch] = block;
      this.channelFNum[ch] = (fNumHigh << 8) | (this.channelFNum[ch] & 0xFF);
      this.updateChannelNote(ch);
      this.updateChannelVolume(ch);
    }
  }

  /**
   * Convert F-Number and Block to MIDI note
   */
  private updateChannelNote(ch: number): void {
    const fnum = this.channelFNum[ch];
    const block = this.channelBlock[ch];

    if (fnum === 0) {
      this.channelNotes[ch] = 0;
      return;
    }

    // F-Number 테이블 (C, C#, D, ..., B)
    const FNUM_TABLE = [343, 363, 385, 408, 432, 458, 485, 514, 544, 577, 611, 647];

    // 가장 가까운 노트 찾기
    let closestNote = 0;
    let minDiff = Infinity;

    for (let note = 0; note < 12; note++) {
      const diff = Math.abs(fnum - FNUM_TABLE[note]);
      if (diff < minDiff) {
        minDiff = diff;
        closestNote = note;
      }
    }

    // MIDI 노트 계산: (block + 1) * 12 + closestNote
    this.channelNotes[ch] = (block + 1) * 12 + closestNote;
  }

  /**
   * Update channel volume from slot levels
   */
  private updateChannelVolume(ch: number): void {
    if (!this.channelKeyOn[ch]) {
      this.channelVolumes[ch] = 0;
      return;
    }

    // 채널의 캐리어 슬롯 인덱스 (melodic mode에서 두 번째 슬롯이 캐리어)
    const carrierSlotIndex = ch < 3 ? ch + 3 : ch < 6 ? ch + 6 : ch + 9;

    if (carrierSlotIndex < 18) {
      // Total Level: 0=최대, 63=무음 → 127-based 볼륨으로 변환
      const totalLevel = this.slotLevels[carrierSlotIndex];
      const volume = Math.round((63 - totalLevel) * 127 / 63);
      this.channelVolumes[ch] = volume;

      // Key-On 시 displayVolume을 실제 볼륨으로 설정 (decay 시작점)
      this.displayVolumes[ch] = volume;
    }
  }

  /**
   * Process volume decay (time-based, not tick-based)
   */
  private processVolumeDecay(): void {
    const now = performance.now();
    const elapsed = now - this.lastDecayTime;

    if (elapsed >= this.DECAY_INTERVAL_MS) {
      this.lastDecayTime = now;

      for (let ch = 0; ch < 9; ch++) {
        if (this.displayVolumes[ch] > 0) {
          this.displayVolumes[ch] = Math.max(0, this.displayVolumes[ch] - this.DECAY_AMOUNT);
        }
      }
    }
  }

  /**
   * Process VGM commands until target sample
   * This is the core of VGM playback - we process all commands
   * that should have executed by the target sample time.
   */
  private processUntilSample(targetSample: number): void {
    const commands = this.vgmData.commands;

    while (this.commandIndex < commands.length) {
      const cmd = commands[this.commandIndex];

      // Stop if this command is in the future
      if (cmd.absoluteSample > targetSample) {
        break;
      }

      if (cmd.type === 'write') {
        // Track for visualization
        this.trackRegister(cmd.register!, cmd.value!);
        // Direct OPL register write
        this.oplEngine.writeRegister(cmd.register!, cmd.value!);
      } else if (cmd.type === 'end') {
        // End of track
        if (this.loopEnabled && this.vgmData.header.loopOffset > 0) {
          // Loop back to loop point
          this.seekToLoopPoint();
        } else if (this.loopEnabled) {
          // No loop point, restart from beginning
          this.rewind();
        } else {
          this.isPlaying = false;
        }
        break;
      }

      this.commandIndex++;
    }
  }

  /**
   * Seek to loop point in VGM
   */
  private seekToLoopPoint(): void {
    const loopSample = this.vgmData.header.totalSamples - this.vgmData.header.loopSamples;

    // Find command index for loop point
    const commands = this.vgmData.commands;
    for (let i = 0; i < commands.length; i++) {
      if (commands[i].absoluteSample >= loopSample) {
        this.commandIndex = i;
        this.currentSample = loopSample;
        return;
      }
    }

    // Fallback to beginning
    this.rewind();
  }

  /**
   * Generate audio samples
   *
   * This is called by the audio processor to get samples.
   * VGM commands must be processed at the exact sample timing,
   * so we interleave command processing with sample generation.
   *
   * VGM is 44100Hz based, so we need to convert sample counts
   * when running at different sample rates (e.g., 48000Hz).
   */
  generateSamples(sampleCount: number): Int16Array {
    if (!this.isPlaying) {
      return new Int16Array(sampleCount * 2); // Stereo silence
    }

    // Process volume decay (time-based)
    this.processVolumeDecay();

    const output = new Int16Array(sampleCount * 2);
    let outputPos = 0;
    let remainingSamples = sampleCount;

    // Process in small chunks to maintain accurate timing
    let loopGuard = 0;
    const maxLoops = sampleCount * 10; // Safety limit

    while (remainingSamples > 0 && this.isPlaying) {
      loopGuard++;
      if (loopGuard > maxLoops) {
        console.error('[VGMPlayer] Loop guard triggered');
        break;
      }

      // Find next command's sample position
      const commands = this.vgmData.commands;
      let samplesToGenerate = remainingSamples;

      if (this.commandIndex < commands.length) {
        const nextCmd = commands[this.commandIndex];
        // Convert VGM sample position to output sample position
        const nextCmdOutputSample = (nextCmd.absoluteSample - this.currentSample) / this.sampleRateRatio;

        if (nextCmdOutputSample <= 0) {
          // Process command immediately
          if (nextCmd.type === 'write') {
            this.trackRegister(nextCmd.register!, nextCmd.value!);
            this.oplEngine.writeRegister(nextCmd.register!, nextCmd.value!);
          } else if (nextCmd.type === 'end') {
            if (this.loopEnabled && this.vgmData.header.loopOffset > 0) {
              this.seekToLoopPoint();
            } else if (this.loopEnabled) {
              this.rewind();
            } else {
              this.isPlaying = false;
            }
            break;
          }
          this.commandIndex++;
          continue; // Check next command
        } else if (nextCmdOutputSample < samplesToGenerate) {
          samplesToGenerate = Math.max(1, Math.floor(nextCmdOutputSample));
        }
      }

      // Don't exceed remaining
      samplesToGenerate = Math.min(samplesToGenerate, remainingSamples);
      if (!Number.isFinite(samplesToGenerate) || samplesToGenerate < 1) {
        break;
      }

      // Generate samples up to next command (or end of buffer)
      const chunk = this.oplEngine.generate(samplesToGenerate);
      output.set(chunk, outputPos * 2);
      outputPos += samplesToGenerate;
      remainingSamples -= samplesToGenerate;
      this.currentSample += samplesToGenerate * this.sampleRateRatio;
    }

    // Apply master volume
    if (this.masterVolume < 127) {
      const scale = this.masterVolume / 127;
      for (let i = 0; i < output.length; i++) {
        output[i] = Math.round(output[i] * scale);
      }
    }

    return output;
  }

  /**
   * Get current playback state
   */
  getState(): VGMPlaybackState {
    const totalSamples = this.vgmData.header.totalSamples;
    const currentSample = this.currentSample;

    // Build active notes array
    const activeNotes: Array<{ channel: number; note: number }> = [];
    for (let ch = 0; ch < 9; ch++) {
      if (this.channelKeyOn[ch] && this.channelNotes[ch] > 0) {
        activeNotes.push({ channel: ch, note: this.channelNotes[ch] });
      }
    }

    return {
      isPlaying: this.isPlaying,
      isPaused: !this.isPlaying && this.currentSample > 0,
      currentSample,
      totalSamples,
      volume: this.masterVolume,
      loopEnabled: this.loopEnabled,
      progress: totalSamples > 0 ? currentSample / totalSamples : 0,
      currentTime: currentSample / VGM_SAMPLE_RATE,
      totalDuration: totalSamples / VGM_SAMPLE_RATE,
      channelVolumes: [...this.displayVolumes],  // decay 효과가 적용된 볼륨
      activeNotes,
    };
  }

  /**
   * Check if playback has ended
   */
  hasEnded(): boolean {
    return !this.isPlaying &&
           this.commandIndex >= this.vgmData.commands.length - 1;
  }

  /**
   * Get total duration in seconds
   */
  getTotalDuration(): number {
    return this.vgmData.header.totalSamples / VGM_SAMPLE_RATE;
  }

  /**
   * Get last register writes from OPL engine
   */
  getLastRegisterWrites(): Array<{reg: number, val: number}> {
    return this.oplEngine.getLastRegisterWrites();
  }
}
