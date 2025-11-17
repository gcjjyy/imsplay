/**
 * opl-engine.ts - OPL2 엔진 (ADLIB.C 포팅)
 *
 * DBOPL (alib.js)을 래핑하여 ADLIB.C의 인터페이스 제공
 * 원본: /Users/gcjjyy/oscc/adlib/erol/ADLIB.C
 */

import * as constants from "./constants";

// DBOPL 타입 정의 (alib.js)
declare global {
  interface Window {
    DBOPL: {
      OPL: new (sampleRate: number, channels: number) => OPL;
    };
  }
}

interface OPL {
  write(register: number, value: number): void;
  generate(samples: number): Int16Array;
}

/**
 * OPL 엔진 클래스
 */
export class OPLEngine {
  private opl: OPL | null = null;
  private pitchRange: number = 1;        // 피치 벤드 범위 (half-tones)
  private modeWaveSel: number = 0x20;    // Wave select 활성화
  private percussion: number = 0;        // 0=melodic, 1=percussive
  private modeVoices: number = 9;        // 9 or 11
  private percBits: number = 0;          // 타악기 제어 비트

  // 각 채널의 상태
  private voiceNote: number[] = new Array(9).fill(0);
  private voiceKeyOn: number[] = new Array(9).fill(0);
  private vPitchBend: number[] = new Array(9).fill(constants.MID_PITCH);
  private bxRegister: number[] = new Array(9).fill(0);
  private lVoiceVolume: number[] = new Array(11).fill(constants.MAX_VOLUME);

  // 슬롯 파라미터 (18 슬롯 × 14 파라미터)
  private paramSlot: number[][] = Array.from({ length: 18 }, () =>
    new Array(constants.nbLocParam).fill(0)
  );

  // 전역 파라미터
  private amDepth: number = 0;
  private vibDepth: number = 0;
  private noteSel: number = 0;

  /**
   * OPL 초기화
   * @param sampleRate 샘플레이트 (기본값: 49716 Hz)
   */
  async init(sampleRate: number = 49716): Promise<void> {
    // DBOPL (alib.js) 초기화 - 2채널 스테레오
    if (typeof window !== 'undefined' && window.DBOPL) {
      this.opl = new window.DBOPL.OPL(sampleRate, 2);
    } else {
      throw new Error('DBOPL (alib.js) not loaded. Make sure alib.js is included in the page.');
    }

    // 초기화 (SoundWarmInit 포팅)
    this.soundWarmInit();
  }

  /**
   * SoundWarmInit() 포팅 (ADLIB.C:276-297)
   */
  private soundWarmInit(): void {
    if (!this.opl) return;

    // 모든 레지스터 초기화
    for (let i = 1; i <= 0xf5; i++) {
      this.opl.write(i, 0);
    }
    this.opl.write(0x04, 0x06); // mask T1 & T2

    // 피치 벤드 초기화
    for (let i = 0; i < 9; i++) {
      this.vPitchBend[i] = constants.MID_PITCH;
      this.voiceKeyOn[i] = 0;
      this.voiceNote[i] = 0;
    }

    // 볼륨 초기화
    for (let i = 0; i < 11; i++) {
      this.lVoiceVolume[i] = constants.MAX_VOLUME;
    }

    this.setMode(0);           // melodic mode
    this.setGParam(0, 0, 0);   // init global parameters
    this.setPitchRange(1);     // default pitch range
    this.setWaveSel(1);        // enable wave select
  }

  /**
   * SetMode() 포팅 (ADLIB.C:312-332)
   */
  setMode(mode: number): void {
    if (mode) {
      // Percussive mode
      this.voiceNote[constants.TOM] = constants.TOM_PITCH;
      this.vPitchBend[constants.TOM] = constants.MID_PITCH;
      this.updateFNums(constants.TOM);

      this.voiceNote[constants.SD] = constants.SD_PITCH;
      this.vPitchBend[constants.SD] = constants.MID_PITCH;
      this.updateFNums(constants.SD);
    }
    this.percussion = mode;
    this.modeVoices = mode ? 11 : 9;
    this.percBits = 0;

    this.initSlotParams();
    this.sndSAmVibRhythm();
  }

  /**
   * SetWaveSel() 포팅 (ADLIB.C:345-353)
   */
  private setWaveSel(state: number): void {
    if (!this.opl) return;

    this.modeWaveSel = state ? 0x20 : 0;
    for (let i = 0; i < 18; i++) {
      this.opl.write(0xe0 + constants.offsetSlot[i], 0);
    }
    this.opl.write(0x01, this.modeWaveSel);
  }

  /**
   * SetPitchRange() 포팅 (ADLIB.C:368-376)
   */
  setPitchRange(pR: number): void {
    if (pR > 12) pR = 12;
    if (pR < 1) pR = 1;
    this.pitchRange = pR;
  }

  /**
   * SetGParam() 포팅 (ADLIB.C:387-396)
   */
  setGParam(amD: number, vibD: number, nSel: number): void {
    this.amDepth = amD;
    this.vibDepth = vibD;
    this.noteSel = nSel;

    this.sndSAmVibRhythm();
    this.sndSNoteSel();
  }

  /**
   * SetVoiceTimbre() 포팅 (ADLIB.C:431-454)
   */
  setVoiceTimbre(voice: number, paramArray: number[]): void {
    if (voice >= this.modeVoices) {
      return;
    }

    const wave0 = paramArray[2 * (constants.nbLocParam - 1)];
    const wave1 = paramArray[2 * (constants.nbLocParam - 1) + 1];

    const slots = this.percussion
      ? constants.slotPVoice[voice]
      : constants.slotMVoice[voice];

    this.setSlotParam(slots[0], paramArray.slice(0, constants.nbLocParam - 1), wave0);

    if (slots[1] !== 255) {
      this.setSlotParam(
        slots[1],
        paramArray.slice(constants.nbLocParam - 1, 2 * (constants.nbLocParam - 1)),
        wave1
      );
    }
  }

  /**
   * SetVoiceVolume() 포팅 (ADLIB.C:469-486)
   */
  setVoiceVolume(voice: number, volume: number): void {
    if (voice >= this.modeVoices) return;
    if (volume > constants.MAX_VOLUME) volume = constants.MAX_VOLUME;

    this.lVoiceVolume[voice] = volume;

    const slots = this.percussion
      ? constants.slotPVoice[voice]
      : constants.slotMVoice[voice];

    this.sndSKslLevel(slots[0]);
    if (slots[1] !== 255) {
      this.sndSKslLevel(slots[1]);
    }
  }

  /**
   * SetVoicePitch() 포팅 (ADLIB.C:506-517)
   */
  setVoicePitch(voice: number, pitchBend: number): void {
    if ((!this.percussion && voice < 9) || voice <= constants.BD) {
      if (pitchBend > constants.MAX_PITCH) {
        pitchBend = constants.MAX_PITCH;
      }
      this.vPitchBend[voice] = pitchBend;

      // voiceNote가 0이면 UpdateFNums를 호출하지 않음
      // (pitch=0일 때 octave=-1이 되어 잘못된 주파수가 설정되는 문제 방지)
      // noteOn이 호출될 때 저장된 pitchBend 값으로 올바른 주파수가 설정됨
      if (this.voiceNote[voice] !== 0) {
        this.updateFNums(voice);
      }
    }
  }

  /**
   * NoteOn() 포팅 (ADLIB.C:530-563)
   */
  noteOn(voice: number, pitch: number): void {
    pitch -= constants.MID_C - constants.CHIP_MID_C;
    if (pitch < 0) pitch = 0;

    if ((!this.percussion && voice < 9) || voice < constants.BD) {
      // Melodic voice
      this.voiceNote[voice] = pitch;
      this.voiceKeyOn[voice] = 0x20;
      this.updateFNums(voice);
    } else if (this.percussion && voice <= constants.HIHAT) {
      // Percussive voice
      if (voice === constants.BD) {
        this.voiceNote[constants.BD] = pitch;
        this.updateFNums(voice);
      } else if (voice === constants.TOM) {
        if (this.voiceNote[constants.TOM] !== pitch) {
          this.voiceNote[constants.TOM] = pitch;
          this.voiceNote[constants.SD] = pitch + constants.TOM_TO_SD;
          this.updateFNums(constants.TOM);
          this.updateFNums(constants.SD);
        }
      }
      this.percBits |= constants.percMasks[voice - constants.BD];
      this.sndSAmVibRhythm();
    }
  }

  /**
   * NoteOff() 포팅 (ADLIB.C:572-584)
   */
  noteOff(voice: number): void {
    if (!this.opl) return;

    if ((!this.percussion && voice < 9) || voice < constants.BD) {
      this.voiceKeyOn[voice] = 0;
      this.bxRegister[voice] &= ~0x20;
      this.opl.write(0xb0 + voice, this.bxRegister[voice]);
    } else if (this.percussion && voice <= constants.HIHAT) {
      this.percBits &= ~constants.percMasks[voice - constants.BD];
      this.sndSAmVibRhythm();
    }
  }

  /**
   * 오디오 샘플 생성 (Int16Array로 반환)
   * DBOPL은 한 번에 최대 512 샘플만 생성 가능하므로 나눠서 호출
   * DBOPL은 내부 버퍼(1024×2=2048)를 항상 반환하지만, 유효한 데이터는 lenSamples*channels만큼
   */
  generate(samples: number): Int16Array {
    if (!this.opl) return new Int16Array(0);

    const maxSamplesPerCall = 512;
    const channels = 2; // 스테레오
    const result = new Int16Array(samples * channels);
    let offset = 0;

    while (offset < samples) {
      const samplesToGenerate = Math.min(maxSamplesPerCall, samples - offset);
      const buffer = this.opl.generate(samplesToGenerate);

      // 버퍼에서 유효한 부분만 복사 (samplesToGenerate * channels)
      const validData = buffer.subarray(0, samplesToGenerate * channels);
      result.set(validData, offset * channels);
      offset += samplesToGenerate;
    }

    return result;
  }

  // ==================== Private Helper Functions ====================

  /**
   * InitSlotParams() 포팅 (ADLIB.C:603-620)
   */
  private initSlotParams(): void {
    for (let i = 0; i < 18; i++) {
      if (constants.carrierSlot[i]) {
        this.setCharSlotParam(i, constants.pianoParamsOp1, 0);
      } else {
        this.setCharSlotParam(i, constants.pianoParamsOp0, 0);
      }
    }

    if (this.percussion) {
      this.setCharSlotParam(12, constants.bdOpr0, 0);
      this.setCharSlotParam(15, constants.bdOpr1, 0);
      this.setCharSlotParam(16, constants.sdOpr, 0);
      this.setCharSlotParam(14, constants.tomOpr, 0);
      this.setCharSlotParam(17, constants.cymbOpr, 0);
      this.setCharSlotParam(13, constants.hhOpr, 0);
    }
  }

  /**
   * SetSlotParam() 포팅 (ADLIB.C:649-658)
   */
  private setSlotParam(slot: number, param: number[], waveSel: number): void {
    for (let i = 0; i < constants.nbLocParam - 1; i++) {
      this.paramSlot[slot][i] = param[i];
    }
    this.paramSlot[slot][constants.nbLocParam - 1] = waveSel & 0x03;

    this.sndSetAllPrm(slot);
  }

  /**
   * SetCharSlotParam() 포팅 (ADLIB.C:660-667)
   */
  private setCharSlotParam(
    slot: number,
    cParam: readonly number[],
    waveSel: number
  ): void {
    const param: number[] = [];
    for (let i = 0; i < constants.nbLocParam - 1; i++) {
      param.push(cParam[i]);
    }
    this.setSlotParam(slot, param, waveSel);
  }

  /**
   * SndSetAllPrm() 포팅 (ADLIB.C:732-742)
   */
  private sndSetAllPrm(slot: number): void {
    this.sndSAmVibRhythm();
    this.sndSNoteSel();
    this.sndSKslLevel(slot);
    this.sndSFeedFm(slot);
    this.sndSAttDecay(slot);
    this.sndSSusRelease(slot);
    this.sndSAVEK(slot);
    this.sndWaveSelect(slot);
  }

  /**
   * SndSKslLevel() 포팅 (ADLIB.C:749-769)
   */
  private sndSKslLevel(slot: number): void {
    if (!this.opl) return;

    const vc = this.percussion
      ? constants.voicePSlot[slot]
      : constants.voiceMSlot[slot];

    let t1 = 63 - (this.paramSlot[slot][constants.prmLevel] & 63);
    const singleSlot = this.percussion && vc > constants.BD;

    if (
      constants.carrierSlot[slot] ||
      !this.paramSlot[slot][constants.prmFm] ||
      singleSlot
    ) {
      // Integer division for rounding: (MAX_VOLUME+1)/2 = 64
      t1 = ((t1 * this.lVoiceVolume[vc] + Math.floor((constants.MAX_VOLUME + 1) / 2)) >>
          constants.LOG2_VOLUME);

      // Clamp to 63 to prevent overflow when VOL_C + CH_VOL exceeds 127
      if (t1 > 63) t1 = 63;
    }

    t1 = 63 - t1;
    t1 |= this.paramSlot[slot][constants.prmKsl] << 6;
    this.opl.write(0x40 + constants.offsetSlot[slot], t1);
  }

  /**
   * SndSNoteSel() 포팅 (ADLIB.C:776-779)
   */
  private sndSNoteSel(): void {
    if (!this.opl) return;
    this.opl.write(0x08, this.noteSel ? 64 : 0);
  }

  /**
   * SndSFeedFm() 포팅 (ADLIB.C:787-796)
   */
  private sndSFeedFm(slot: number): void {
    if (!this.opl) return;
    if (constants.carrierSlot[slot]) return;

    let t1 = this.paramSlot[slot][constants.prmFeedBack] << 1;
    t1 |= this.paramSlot[slot][constants.prmFm] ? 0 : 1;
    this.opl.write(0xc0 + constants.voiceMSlot[slot], t1);
  }

  /**
   * SndSAttDecay() 포팅 (ADLIB.C:802-809)
   */
  private sndSAttDecay(slot: number): void {
    if (!this.opl) return;

    let t1 = this.paramSlot[slot][constants.prmAttack] << 4;
    t1 |= this.paramSlot[slot][constants.prmDecay] & 0x0f;
    this.opl.write(0x60 + constants.offsetSlot[slot], t1);
  }

  /**
   * SndSSusRelease() 포팅 (ADLIB.C:815-822)
   */
  private sndSSusRelease(slot: number): void {
    if (!this.opl) return;

    let t1 = this.paramSlot[slot][constants.prmSustain] << 4;
    t1 |= this.paramSlot[slot][constants.prmRelease] & 0x0f;
    this.opl.write(0x80 + constants.offsetSlot[slot], t1);
  }

  /**
   * SndSAVEK() 포팅 (ADLIB.C:829-839)
   */
  private sndSAVEK(slot: number): void {
    if (!this.opl) return;

    let t1 = this.paramSlot[slot][constants.prmAm] ? 0x80 : 0;
    t1 += this.paramSlot[slot][constants.prmVib] ? 0x40 : 0;
    t1 += this.paramSlot[slot][constants.prmStaining] ? 0x20 : 0;
    t1 += this.paramSlot[slot][constants.prmKsr] ? 0x10 : 0;
    t1 += this.paramSlot[slot][constants.prmMulti] & 0x0f;
    this.opl.write(0x20 + constants.offsetSlot[slot], t1);
  }

  /**
   * SndSAmVibRhythm() 포팅 (ADLIB.C:845-853)
   */
  private sndSAmVibRhythm(): void {
    if (!this.opl) return;

    let t1 = this.amDepth ? 0x80 : 0;
    t1 |= this.vibDepth ? 0x40 : 0;
    t1 |= this.percussion ? 0x20 : 0;
    t1 |= this.percBits;
    this.opl.write(0xbd, t1);
  }

  /**
   * SndWaveSelect() 포팅 (ADLIB.C:859-868)
   */
  private sndWaveSelect(slot: number): void {
    if (!this.opl) return;

    const wave = this.modeWaveSel
      ? this.paramSlot[slot][constants.prmWaveSel] & 0x03
      : 0;
    this.opl.write(0xe0 + constants.offsetSlot[slot], wave);
  }

  /**
   * UpdateFNums() 포팅 (ADLIB.C:875-891)
   */
  private updateFNums(voice: number): void {
    this.bxRegister[voice] = this.setFreq(
      voice,
      this.voiceNote[voice],
      this.vPitchBend[voice],
      this.voiceKeyOn[voice]
    );
  }

  /**
   * SetFreq() 포팅 (ADLIB.C:938-1002)
   */
  private setFreq(
    voice: number,
    pitch: number,
    bend: number,
    keyOn: number
  ): number {
    if (!this.opl) return 0;

    let octave = Math.floor(pitch / 12) - 1;
    let effNbr = constants.freqNums[pitch % 12];

    if (bend !== 0x2000) {
      if (bend > 0x2000) {
        // Pitch up
        bend -= 0x2000;
        let n = constants.freqNums[(pitch + this.pitchRange) % 12];
        if (n < effNbr) n <<= 1;
        n = n - effNbr;
        effNbr = effNbr + ((n * bend) >> 13);

        while (effNbr > 1023) {
          effNbr >>= 1;
          octave++;
        }
      } else {
        // Pitch down
        bend = 0x2000 - bend;
        let n = constants.freqNums[(pitch - this.pitchRange + 12) % 12];
        if (n > effNbr) n >>= 1;
        n = effNbr - n;
        effNbr = effNbr - ((n * bend) >> 13);

        while (effNbr < constants.freqNums[0]) {
          effNbr <<= 1;
          octave--;
        }
      }
    }

    // Write F-Number (lower 8 bits)
    this.opl.write(0xa0 + voice, effNbr & 0xff);

    // Write Key-On, Block, F-Number (upper 2 bits)
    const t1 = keyOn | (octave << 2) | (effNbr >> 8);
    this.opl.write(0xb0 + voice, t1);

    return t1;
  }

  /**
   * 현재 재생 중인 노트 정보를 반환
   * @returns 채널과 노트 번호 배열
   */
  getActiveNotes(): Array<{ channel: number; note: number }> {
    const activeNotes: Array<{ channel: number; note: number }> = [];
    const maxVoices = 9; // melodic voice는 항상 9개

    for (let i = 0; i < maxVoices; i++) {
      if (this.voiceKeyOn[i] !== 0 && this.voiceNote[i] !== 0) {
        activeNotes.push({ channel: i, note: this.voiceNote[i] });
      }
    }

    return activeNotes;
  }
}
