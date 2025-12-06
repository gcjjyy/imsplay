/**
 * ims-player.ts - IMS 재생 엔진
 *
 * IMS (Interactive Music System) 이벤트 기반 재생 엔진
 * 원본: /Users/gcjjyy/oscc/adlib/ims/IMS.C
 */

import { OPLEngine } from "../rol/opl-engine";
import { loadInstruments } from "../rol/bnk-parser";
import { readPagedByte } from "./ims-parser";
import type { IMSData, IMSEventType, IMSPlaybackState } from "./ims-types";

/**
 * IMS 플레이어 클래스
 */
export class IMSPlayer {
  private imsData: IMSData;
  private bnkData: Map<number, number[]>;  // 인덱스 → 악기 파라미터
  private oplEngine: OPLEngine;

  // 재생 상태
  private curByte: number = 0;
  private runningStatus: number = 0;  // Running status byte (MIDI-like)
  private curVol: number[] = new Array(11).fill(0);
  private displayVolumes: number[] = new Array(11).fill(0);  // 디스플레이용 볼륨 (decay 효과)
  private currentTempo: number;
  private currentTick: number = 0;  // ISS 가사 동기화용 틱 카운터
  private channelInstruments: string[] = new Array(11).fill("");

  // 제어 변수
  private VOL_C: number = 127;  // 전체 볼륨 (0-127)
  private SPEED: number = 100;  // 템포 배속 (100 = 1x)

  private isPlaying: boolean = false;
  private loopEnabled: boolean = false;
  private totalTicks: number = 0;  // 전체 틱 수 (계산됨)

  constructor(imsData: IMSData, bnkBuffer: ArrayBuffer, oplEngine: OPLEngine) {
    this.imsData = imsData;
    this.oplEngine = oplEngine;
    this.currentTempo = imsData.basicTempo;

    // BNK 파일에서 악기 로드
    this.bnkData = new Map();
    const instruments = loadInstruments(bnkBuffer, imsData.insNames);

    // 악기 데이터를 인덱스별로 매핑
    for (let i = 0; i < imsData.insNum; i++) {
      const insName = imsData.insNames[i];
      const params = instruments.get(insName);
      if (params) {
        this.bnkData.set(i, params);
      }
    }

    // 전체 틱 수 계산 (한 번만)
    this.totalTicks = this.calculateTotalTicks();
  }

  /**
   * 재생 초기화 (play_ims 포팅, IMS.C:176-184)
   */
  async initialize(sampleRate: number): Promise<void> {
    await this.oplEngine.init(sampleRate);
    this.oplEngine.setMode(this.imsData.dMode);

    // 모든 채널 초기화
    for (let i = 0; i < this.imsData.chNum; i++) {
      this.curVol[i] = 0;
      this.displayVolumes[i] = 0;
      this.channelInstruments[i] = "";
      this.oplEngine.noteOff(i);
      this.oplEngine.setVoiceVolume(i, 0);
    }

    this.curByte = 0;
    this.runningStatus = 0;
  }

  /**
   * 한 틱 진행 (TimeOut 포팅, IMS.C:213-239)
   *
   * @returns 다음 틱까지의 지연 시간 (틱 단위)
   */
  tick(): number {
    if (!this.isPlaying) {
      return 1;  // 0이 아닌 값을 반환하여 do-while 루프 종료
    }

    // 디스플레이 볼륨 decay
    for (let i = 0; i < this.imsData.chNum; i++) {
      if (this.displayVolumes[i] > 0) {
        this.displayVolumes[i] = Math.max(0, this.displayVolumes[i] - 8);  // 빠른 decay
      }
    }

    // 파일 끝 체크 (루프 처리)
    if (this.curByte >= this.imsData.byteSize) {
      if (this.loopEnabled) {
        this.rewind();
      } else {
        this.isPlaying = false;
        return 1;  // 0이 아닌 값을 반환하여 do-while 루프 종료
      }
    }

    // 이벤트 처리
    this.processEvent();

    // 델타 타임 읽기
    const delay = this.readDeltaTime();

    // 현재 틱 누적 (ISS 가사 동기화용)
    this.currentTick += delay;

    return delay;
  }

  /**
   * 이벤트 처리 (TimeOut의 switch 부분)
   */
  private processEvent(): void {
    // Status byte 읽기
    let idcode = this.readByte();

    // 루프 마커 체크 - 이벤트 처리 전에 먼저 확인
    if (idcode === 0xfc) {
      if (this.loopEnabled) {
        this.curByte = 0;
        this.runningStatus = 0;
      } else {
        this.isPlaying = false;
      }
      return;  // 루프마커에서 즉시 종료
    }

    // Running status 처리
    if (idcode < 0x80) {
      // Running status: 이전 status byte 재사용
      idcode = this.runningStatus;
      // curByte는 이미 데이터를 가리키고 있음 (status byte를 읽지 않았으므로)
    } else {
      // 새로운 status byte
      this.curByte++;
      this.runningStatus = idcode;
    }

    // 채널 추출 (하위 4비트)
    const ch = idcode & 0x0f;

    // 이벤트 타입 추출 (상위 4비트)
    const eventType = (idcode & 0xf0) as IMSEventType;

    // 이벤트 처리
    switch (eventType) {
      case 0xc0:  // Instrument Change
        this.handleInstrumentChange(ch);
        break;
      case 0xa0:  // Volume Change
        this.handleVolumeChange(ch);
        break;
      case 0xe0:  // Pitch Bend
        this.handlePitchBend(ch);
        break;
      case 0xf0:  // Tempo Change
        this.handleTempoChange();
        break;
      case 0x80:  // Note On (Always)
        this.handleNoteOn1(ch);
        break;
      case 0x90:  // Note On (Conditional)
        this.handleNoteOn2(ch);
        break;
    }
  }

  /**
   * 델타 타임 읽기 (TimeOut의 time_size 부분)
   *
   * 델타 타임 인코딩:
   * - 0x01-0xF7: 직접 딜레이 값
   * - 0xF8: 240틱 추가 + 계속 읽기
   * - 0xFC: 루프 마커 (처음으로 되감기)
   * - 0x00: 딜레이 없음
   */
  private readDeltaTime(): number {
    let tDelay = 0;
    let loopCount = 0;

    while (true) {
      loopCount++;

      // 원본: ch=readmem(cur_byte++);
      const ch = this.readByte();

      // 루프마커 체크
      if (ch === 0xfc) {
        if (this.loopEnabled) {
          this.curByte = 0;
          this.runningStatus = 0;
        } else {
          this.isPlaying = false;
        }
        return 1;
      }

      this.curByte++;

      // 원본: if ( ch==0xf8 ) { t_delay+=240; goto time_size; }
      if (ch === 0xf8) {
        tDelay += 240;
        continue;  // goto time_size
      }

      // 원본: if ( ch ) t_delay+=ch;
      if (ch) {
        tDelay += ch;
      }

      // 긴 딜레이 감지 - 10000틱 이상이면 곡 종료로 처리
      if (tDelay >= 10000) {
        this.isPlaying = false;
        return 1;
      }

      // 원본: return (t_delay);
      return tDelay;
    }
  }

  /**
   * 악기 변경 (ins_rt 포팅, IMS.C:118-122)
   */
  private handleInstrumentChange(ch: number): void {
    const insIndex = this.readByte();
    this.curByte++;

    const params = this.bnkData.get(insIndex);
    if (insIndex < this.imsData.insNames.length) {
      const insName = this.imsData.insNames[insIndex];
      if (params) {
        this.oplEngine.setVoiceTimbre(ch, params);
        // 악기명 업데이트 (화면 표시용)
        this.channelInstruments[ch] = insName;
      } else {
        // 뱅크에서 악기를 찾을 수 없는 경우
        this.channelInstruments[ch] = "!" + insName;
        // 채널을 끄고 볼륨을 0으로 설정 (이상한 소리 방지)
        this.oplEngine.noteOff(ch);
        this.oplEngine.setVoiceVolume(ch, 0);
        this.curVol[ch] = 0;
      }
    }
  }

  /**
   * 볼륨 변경 (vol_rt 포팅, IMS.C:123-126)
   */
  private handleVolumeChange(ch: number): void {
    this.curVol[ch] = this.readByte();
    this.curByte++;
    this.oplEngine.setVoiceVolume(ch, this.curVol[ch]);
  }

  /**
   * 피치 벤드 (pit_rt 포팅, IMS.C:294-301)
   */
  private handlePitchBend(ch: number): void {
    // Little-endian 2바이트 읽기
    let data1 = this.readByte();
    const byte1 = data1;
    this.curByte++;

    data1 = this.readByte();
    const byte2 = data1;
    this.curByte++;

    // 16비트 값 조합
    data1 = (byte2 << 8) + byte1;

    // 1비트 오른쪽 시프트 (0x0000-0x3FFF 범위로)
    data1 = data1 >> 1;

    this.oplEngine.setVoicePitch(ch, data1);
  }

  /**
   * 템포 변경 (tem_rt 포팅, IMS.C:136-148)
   */
  private handleTempoChange(): void {
    // 2바이트 건너뛰기
    this.curByte += 2;

    // 템포 값 읽기
    const data1 = this.readByte();
    this.curByte++;

    const data2 = this.readByte();
    this.curByte++;

    // 템포 계산
    // ttem = basic_tempo * data2 / 128 + basic_tempo * data1
    let ttem = this.imsData.basicTempo;
    ttem = Math.floor((ttem * data2) / 128 + this.imsData.basicTempo * data1);

    this.currentTempo = ttem;

    // 1바이트 더 건너뛰기
    this.curByte++;
  }

  /**
   * 노트 온 (항상) (note1_rt 포팅, IMS.C:149-159)
   */
  private handleNoteOn1(ch: number): void {
    const pitch = this.readByte();
    this.curByte++;

    const volume = this.readByte();
    this.curByte++;

    this.oplEngine.noteOff(ch);

    if (this.curVol[ch] !== volume) {
      this.curVol[ch] = volume;
      this.oplEngine.setVoiceVolume(ch, volume);
    }

    // 디스플레이 볼륨 설정 (note on 시 최대로)
    this.displayVolumes[ch] = volume;

    // IMS 파일은 이미 칩 기준(CHIP_MID_C=48)으로 저장되어 있으므로
    // noteOn의 MID_C-CHIP_MID_C 변환(-12)을 상쇄하기 위해 +12 필요
    this.oplEngine.noteOn(ch, pitch + 12);
  }

  /**
   * 노트 온 (조건부) (note2_rt 포팅, IMS.C:161-173)
   */
  private handleNoteOn2(ch: number): void {
    const pitch = this.readByte();
    this.curByte++;

    const volume = this.readByte();
    this.curByte++;

    this.oplEngine.noteOff(ch);

    // 볼륨이 0이 아닐 때만 노트 온
    if (volume) {
      if (this.curVol[ch] !== volume) {
        this.curVol[ch] = volume;
        this.oplEngine.setVoiceVolume(ch, volume);
      }
      // 디스플레이 볼륨 설정 (note on 시 최대로)
      this.displayVolumes[ch] = volume;

      // IMS 파일은 이미 칩 기준(CHIP_MID_C=48)으로 저장되어 있으므로
      // noteOn의 MID_C-CHIP_MID_C 변환(-12)을 상쇄하기 위해 +12 필요
      this.oplEngine.noteOn(ch, pitch + 12);
    }
  }

  /**
   * 페이지 메모리에서 바이트 읽기
   */
  private readByte(): number {
    return readPagedByte(this.imsData.musicData, this.curByte);
  }

  /**
   * 오디오 샘플 생성 (Int16Array로 반환)
   */
  generateSamples(numSamples: number): Int16Array {
    return this.oplEngine.generate(numSamples);
  }

  /**
   * 전체 볼륨 조절
   */
  controlVolume(v: number): void {
    this.VOL_C = v;

    // ROL 플레이어와 유사하게 각 채널에 볼륨 적용
    for (let i = 0; i < this.imsData.chNum; i++) {
      const vol = this.curVol[i];
      if (Math.floor((this.curVol[i] * this.VOL_C) / 100)) {
        this.curVol[i] = Math.floor((this.curVol[i] * this.VOL_C) / 100);
      } else {
        this.curVol[i] = 0;
      }
      this.oplEngine.setVoiceVolume(i, this.curVol[i]);
      this.curVol[i] = vol;  // 원래 값 복원
    }
  }

  /**
   * 템포 조절
   */
  controlTempo(s: number): void {
    this.SPEED = s;
  }

  /**
   * 틱당 지연 시간 계산 (ms)
   *
   * IMS는 델타 타임을 틱 단위로 반환하므로,
   * 각 틱의 실제 시간을 계산해야 합니다.
   *
   * 원본 IMS.C의 StartTimeOut(10)은 타이머를 10ms마다 호출하도록 설정합니다.
   * 그러나 실제 틱 시간은 템포에 따라 다릅니다.
   *
   * ROL과 동일한 PIT 타이머 계산 사용:
   * tickDelay = 60000 / (240 × tempo) ms
   */
  getTickDelay(): number {
    const tempo = this.currentTempo;

    // 각 틱의 시간: 60000 / (240 × tempo)
    // 240은 IMS 델타 타임의 기본 해상도 (0xF8 = 240틱)
    const baseDelay = 60000 / (240 * tempo);

    // 템포 배속 적용
    return (baseDelay * 100) / this.SPEED;
  }

  /**
   * 재생 시작
   */
  play(): void {
    this.isPlaying = true;
  }

  /**
   * 일시정지
   */
  pause(): void {
    this.isPlaying = false;
  }

  /**
   * 정지
   */
  stop(): void {
    this.isPlaying = false;
    this.curByte = 0;
    this.runningStatus = 0;
    // 모든 채널 끄기
    for (let i = 0; i < 11; i++) {
      this.oplEngine.noteOff(i);
      this.oplEngine.setVoiceVolume(i, 0);
    }
  }

  /**
   * 되감기
   */
  rewind(): void {
    this.curByte = 0;
    this.runningStatus = 0;
    this.currentTempo = this.imsData.basicTempo;
    this.currentTick = 0;  // 틱 카운터 리셋

    // 모든 채널 끄기 (루프 시작 전 깨끗한 상태)
    for (let i = 0; i < 11; i++) {
      this.oplEngine.noteOff(i);
      this.oplEngine.setVoiceVolume(i, 0);
    }
  }

  /**
   * 전체 틱 수 계산 (파일 전체 파싱)
   */
  private calculateTotalTicks(): number {
    let totalTicks = 0;
    let bytePos = 0;
    let runStatus = 0;

    while (bytePos < this.imsData.byteSize) {
      // 이벤트 읽기
      let idcode = readPagedByte(this.imsData.musicData, bytePos);

      if (idcode < 0x80) {
        idcode = runStatus;
      } else {
        bytePos++;
        runStatus = idcode;
      }

      const eventType = idcode & 0xf0;

      // 이벤트 크기만큼 건너뛰기
      switch (eventType) {
        case 0xc0: bytePos++; break;  // Instrument Change: 1 byte
        case 0xa0: bytePos++; break;  // Volume Change: 1 byte
        case 0xe0: bytePos += 2; break;  // Pitch Bend: 2 bytes
        case 0xf0: bytePos += 5; break;  // Tempo Change: 5 bytes
        case 0x80: bytePos += 2; break;  // Note On 1: 2 bytes
        case 0x90: bytePos += 2; break;  // Note On 2: 2 bytes
      }

      // 델타 타임 읽기
      while (true) {
        const ch = readPagedByte(this.imsData.musicData, bytePos);
        bytePos++;

        if (ch === 0xfc) {
          // 루프 마커 - 종료
          return totalTicks;
        }

        if (ch === 0xf8) {
          totalTicks += 240;
          continue;
        }

        if (ch) {
          totalTicks += ch;
        }

        break;
      }
    }

    return totalTicks;
  }

  /**
   * 재생 상태 가져오기
   */
  getState(): IMSPlaybackState {
    // 전체 재생 시간 계산
    // ticks per second = 240 * tempo / 60 = 4 * tempo
    const ticksPerSecond = 4 * this.imsData.basicTempo;
    const totalDuration = this.totalTicks / ticksPerSecond;

    return {
      isPlaying: this.isPlaying,
      isPaused: !this.isPlaying && this.curByte > 0,
      currentByte: this.curByte,
      totalSize: this.imsData.byteSize,
      totalDuration: totalDuration,
      volume: this.VOL_C,
      tempo: this.SPEED,
      currentTempo: this.currentTempo,
      currentTick: this.currentTick,
      currentVolumes: this.displayVolumes.slice(0, this.imsData.chNum),
      instrumentNames: this.channelInstruments.slice(0, this.imsData.chNum),
      activeNotes: this.oplEngine.getActiveNotes(),
      lastRegisterWrites: this.oplEngine.getLastRegisterWrites().slice(0, this.imsData.chNum),
      songName: this.imsData.songName || "",
    };
  }

  /**
   * 루프 활성화/비활성화
   */
  setLoopEnabled(enabled: boolean): void {
    this.loopEnabled = enabled;
  }
}
