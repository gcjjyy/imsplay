/**
 * rol-player.ts - ROL 재생 엔진 (EPLAYROL.C 포팅)
 *
 * 원본: /Users/gcjjyy/oscc/adlib/erol/EPLAYROL.C
 */

import { OPLEngine } from "./opl-engine";
import type { ROLData, BNKData, PlaybackState } from "./types";
import { loadInstruments } from "./bnk-parser";

/**
 * ROL 플레이어 클래스
 */
export class ROLPlayer {
  private rolData: ROLData;
  private bnkData: Map<string, number[]>;
  private oplEngine: OPLEngine;

  // 재생 상태 (EPLAYROL.C의 전역 변수들)
  private CH_VOL: number[] = new Array(11).fill(5);
  private TICH: number[] = new Array(11).fill(0);
  private ICH: number[] = new Array(11).fill(0);
  private VCH: number[] = new Array(11).fill(0);
  private PCH: number[] = new Array(11).fill(0);
  private TMCH: number = 0;

  private CUR_BYTE: number = 0;
  private TOTAL_SIZE: number = 0;

  private VOL_C: number = 127;         // 전체 볼륨 (0-127)
  private C_TEMPO: number = 0;         // 현재 템포
  private SPEED: number = 100;         // 템포 배속 (100 = 1x)
  private KEY: number = 0;             // 키 조옮김 (-13 ~ +13)

  private CUR_VOL: number[] = new Array(11).fill(127);
  private displayVolumes: number[] = new Array(11).fill(0);  // 디스플레이용 볼륨 (decay 효과)
  private channelInstruments: string[] = new Array(11).fill("");  // 채널별 현재 악기명 (화면 표시용)
  private INS_DATA: Map<number, number[]> = new Map();
  private channelMuted: boolean[] = new Array(11).fill(false);  // 채널 뮤트 상태 (디버깅용)

  private isPlaying: boolean = false;
  private loopEnabled: boolean = true;

  constructor(rolData: ROLData, bnkBuffer: ArrayBuffer, oplEngine: OPLEngine) {
    this.rolData = rolData;
    this.oplEngine = oplEngine;

    console.log(`[ROLPlayer.constructor] ROL 파일 정보:`, {
      channelNum: rolData.channelNum,
      insNum: rolData.insNum,
      dMode: rolData.dMode,
      tpb: rolData.tpb,
      basicTempo: rolData.basicTempo,
    });

    // BNK 파일에서 악기 로드
    this.bnkData = loadInstruments(bnkBuffer, rolData.insName);

    // 악기 데이터를 인덱스별로 매핑
    console.log(`[ROLPlayer.constructor] 악기 인덱스 매핑 시작 (총 ${rolData.insNum}개)`);
    let mappedCount = 0;
    let notMappedCount = 0;
    for (let i = 0; i < rolData.insNum; i++) {
      const insName = rolData.insName[i];
      const params = this.bnkData.get(insName);
      if (params) {
        this.INS_DATA.set(i, params);
        mappedCount++;
        console.log(`[ROLPlayer.constructor] ✅ 인덱스 ${i} → "${insName}" (params: ${params.length}바이트)`);
      } else {
        notMappedCount++;
        console.warn(`[ROLPlayer.constructor] ❌ 인덱스 ${i} → "${insName}" (BNK에서 찾을 수 없음)`);
      }
    }
    console.log(`[ROLPlayer.constructor] 매핑 결과: 성공 ${mappedCount}개 / 실패 ${notMappedCount}개`);

    // 채널별 악기 이벤트 정보 출력
    console.log(`[ROLPlayer.constructor] 채널별 악기 이벤트 정보:`);
    for (let ch = 0; ch < rolData.channelNum; ch++) {
      const channel = rolData.channels[ch];
      if (channel.insCount > 0) {
        console.log(`  ch:${ch} 악기 이벤트 ${channel.insCount}개:`,
          channel.insTime.map((time, idx) => {
            const insIndex = channel.insList[idx];
            const insName = rolData.insName[insIndex] || `?${insIndex}`;
            return `tick:${time}→"${insName}"`;
          }).join(', ')
        );
      } else {
        console.log(`  ch:${ch} 악기 이벤트 없음`);
      }
    }

    this.TOTAL_SIZE = rolData.totalSize;
  }

  /**
   * 재생 초기화 (PlayRol 포팅, EPLAYROL.C:408-423)
   * @param sampleRate AudioContext 샘플레이트
   */
  async initialize(sampleRate: number): Promise<void> {
    await this.oplEngine.init(sampleRate);
    this.oplEngine.setMode(this.rolData.dMode);

    for (let i = 0; i < this.rolData.channelNum; i++) {
      this.oplEngine.setVoiceVolume(i, 0);
      this.oplEngine.noteOff(i);
      this.TICH[i] = 0;
      this.ICH[i] = 0;
      this.VCH[i] = 0;
      this.PCH[i] = 0;
    }

    // DBOPL 내부 버퍼를 비우기 위해 더미 샘플 생성
    for (let i = 0; i < 10; i++) {
      this.oplEngine.generate(512);
    }

    this.CUR_BYTE = 0;
    this.rewind();
  }

  /**
   * 한 틱 진행 (TimeOut 포팅, EPLAYROL.C:444-484)
   */
  tick(): void {
    if (!this.isPlaying) return;

    // 디스플레이 볼륨 decay
    for (let i = 0; i < this.rolData.channelNum; i++) {
      if (this.displayVolumes[i] > 0) {
        this.displayVolumes[i] = Math.max(0, this.displayVolumes[i] - 8);  // 빠른 decay
      }
    }

    // 템포 변경 처리
    if (this.rolData.tempoCount * 2 > this.TMCH) {
      this.rol_tem_rt();
    }

    // 각 채널 처리
    for (let ch = 0; ch < this.rolData.channelNum; ch++) {
      const channel = this.rolData.channels[ch];

      // 악기 변경
      if (channel.insCount > this.ICH[ch]) {
        this.rol_ins_rt(ch);
      }

      // 피치 벤드
      if (channel.pitCount * 2 > this.PCH[ch]) {
        this.rol_pit_rt(ch);
      }

      // 볼륨 변경
      if (channel.volCount * 2 > this.VCH[ch]) {
        this.rol_vol_rt(ch);
      }

      // 노트 재생
      if (channel.size > this.CUR_BYTE) {
        this.rol_note_rt(ch);
      } else {
        this.oplEngine.noteOff(ch);
      }
    }

    // 시간 진행
    this.CUR_BYTE++;

    // 루프 처리
    if (this.CUR_BYTE >= this.TOTAL_SIZE) {
      if (this.loopEnabled) {
        this.rewind();
      } else {
        this.isPlaying = false;
      }
    }
  }

  /**
   * 템포 변경 처리 (rol_tem_rt 포팅, EPLAYROL.C:301-317)
   */
  private rol_tem_rt(): void {
    const i = this.rolData.tempoData[this.TMCH];
    if (i === this.CUR_BYTE) {
      this.TMCH++;
      const ttem = this.rolData.tempoData[this.TMCH];
      this.C_TEMPO = ttem;
      this.TMCH++;
    }
  }

  /**
   * 노트 재생 처리 (rol_note_rt 포팅, EPLAYROL.C:319-348)
   */
  private rol_note_rt(ch: number): void {
    const channel = this.rolData.channels[ch];
    const i = channel.ticksData[this.TICH[ch] + 1];

    if (i === this.CUR_BYTE) {
      // 채널이 뮤트되어 있으면 스킵
      if (this.channelMuted[ch]) {
        this.TICH[ch] += 2;
        return;
      }

      this.oplEngine.noteOff(ch);
      const note = channel.ticksData[this.TICH[ch]];
      const vol = this.CUR_VOL[ch];

      this.CUR_VOL[ch] = Math.floor(
        (this.CUR_VOL[ch] * (this.VOL_C + this.CH_VOL[ch])) / 100
      );
      this.oplEngine.setVoiceVolume(ch, this.CUR_VOL[ch]);
      this.CUR_VOL[ch] = vol;

      if (note) {
        // ROL 파일의 노트는 MIDI 표준보다 1옥타브(12) 낮게 저장되어 있음
        this.oplEngine.noteOn(ch, note + this.KEY + 12);
        // 디스플레이 볼륨 설정 (스케일링 전 원본 볼륨 사용, IMS와 동일)
        this.displayVolumes[ch] = vol;
      }

      this.TICH[ch] += 2;
    }
  }

  /**
   * 악기 변경 처리 (rol_ins_rt 포팅, EPLAYROL.C:350-364)
   */
  private rol_ins_rt(ch: number): void {
    const channel = this.rolData.channels[ch];
    const time = channel.insTime[this.ICH[ch]];

    if (time === this.CUR_BYTE) {
      const insIndex = channel.insList[this.ICH[ch]];
      const insName = this.rolData.insName[insIndex] || `알 수 없음(${insIndex})`;
      const params = this.INS_DATA.get(insIndex);

      if (params) {
        console.log(`[rol_ins_rt] ✅ ch:${ch} tick:${this.CUR_BYTE} insIndex:${insIndex} insName:"${insName}" → setVoiceTimbre 호출`);
        this.oplEngine.setVoiceTimbre(ch, params);
        // 화면 표시용 악기명 업데이트
        this.channelInstruments[ch] = insName;
      } else {
        console.warn(`[rol_ins_rt] ❌ ch:${ch} tick:${this.CUR_BYTE} insIndex:${insIndex} insName:"${insName}" → INS_DATA에 없음!`);
        this.channelInstruments[ch] = "!" + insName;
      }
      this.ICH[ch]++;
    }
  }

  /**
   * 볼륨 변경 처리 (rol_vol_rt 포팅, EPLAYROL.C:366-380)
   */
  private rol_vol_rt(ch: number): void {
    const channel = this.rolData.channels[ch];
    const time = channel.volData[this.VCH[ch]];

    if (time === this.CUR_BYTE) {
      this.VCH[ch]++;
      const vol = channel.volData[this.VCH[ch]];
      this.CUR_VOL[ch] = vol;

      if (Math.floor((this.CUR_VOL[ch] * this.VOL_C) / 100)) {
        this.oplEngine.setVoiceVolume(
          ch,
          Math.floor((this.CUR_VOL[ch] * (this.VOL_C + this.CH_VOL[ch])) / 100)
        );
      } else {
        this.oplEngine.setVoiceVolume(ch, 0);
      }

      this.VCH[ch]++;
    }
  }

  /**
   * 피치 벤드 처리 (rol_pit_rt 포팅, EPLAYROL.C:382-392)
   */
  private rol_pit_rt(ch: number): void {
    const channel = this.rolData.channels[ch];
    const time = channel.pitData[this.PCH[ch]];

    if (time === this.CUR_BYTE) {
      this.PCH[ch]++;
      const pit = channel.pitData[this.PCH[ch]];
      this.oplEngine.setVoicePitch(ch, pit);
      this.PCH[ch]++;
    }
  }

  /**
   * 처음으로 되감기 (RewindRol 포팅, EPLAYROL.C:394-406)
   */
  rewind(): void {
    this.CUR_BYTE = 0;
    this.C_TEMPO = 0;
    this.TMCH = 0;

    for (let ch = 0; ch < this.rolData.channelNum; ch++) {
      this.TICH[ch] = 0;
      this.ICH[ch] = 0;
      this.VCH[ch] = 0;
      this.PCH[ch] = 0;
    }
  }

  /**
   * 오디오 샘플 생성 (Int16Array로 반환)
   */
  generateSamples(numSamples: number): Int16Array {
    return this.oplEngine.generate(numSamples);
  }

  /**
   * 전체 볼륨 조절 (ControlVolume 포팅, EPLAYROL.C:486-499)
   */
  controlVolume(v: number): void {
    this.VOL_C = v;

    for (let i = 0; i < this.rolData.channelNum; i++) {
      const vol = this.CUR_VOL[i];
      if (Math.floor((this.CUR_VOL[i] * this.VOL_C) / 100)) {
        this.CUR_VOL[i] = Math.floor(
          (this.CUR_VOL[i] * (this.VOL_C + this.CH_VOL[i])) / 100
        );
      } else {
        this.CUR_VOL[i] = 0;
      }
      this.oplEngine.setVoiceVolume(i, this.CUR_VOL[i]);
      this.CUR_VOL[i] = vol;
    }
  }

  /**
   * 템포 조절 (ControlTempo 포팅, EPLAYROL.C:501-510)
   */
  controlTempo(s: number): void {
    this.SPEED = s;
  }

  /**
   * 키 조옮김 설정
   */
  setKeyTranspose(key: number): void {
    if (key > 13) key = 13;
    if (key < -13) key = -13;
    this.KEY = key;
  }

  /**
   * 채널 볼륨 설정 (EPLAYROL.C:615-619의 go 함수)
   */
  setChannelVolume(ch: number, vol: number): void {
    if (ch >= 0 && ch < 11) {
      this.CH_VOL[ch] = vol * 8; // 0-15 range → 0-120
    }
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
    this.rewind();
    for (let i = 0; i < this.rolData.channelNum; i++) {
      this.oplEngine.noteOff(i);
    }
  }

  /**
   * 재생 상태 가져오기
   */
  getState(): PlaybackState {
    // 전체 재생 시간 계산
    // ticks per second = tpb * basicTempo / 60
    // totalDuration = totalSize / ticks_per_second
    const ticksPerSecond = this.rolData.tpb * this.rolData.basicTempo / 60;
    const totalDuration = this.TOTAL_SIZE / ticksPerSecond;

    return {
      isPlaying: this.isPlaying,
      isPaused: !this.isPlaying && this.CUR_BYTE > 0,
      currentByte: this.CUR_BYTE,
      totalSize: this.TOTAL_SIZE,
      totalDuration: totalDuration,
      volume: this.VOL_C,
      tempo: this.SPEED,
      keyTranspose: this.KEY,
      channelVolumes: this.CH_VOL.slice(0, this.rolData.channelNum),
      currentTempo: this.C_TEMPO,
      currentVolumes: this.displayVolumes.slice(0, this.rolData.channelNum),
      instrumentNames: this.channelInstruments.slice(0, this.rolData.channelNum),
      channelMuted: this.channelMuted.slice(0, this.rolData.channelNum),
      activeNotes: this.oplEngine.getActiveNotes(),
    };
  }

  /**
   * 채널 뮤트 토글 (디버깅용)
   */
  toggleChannel(ch: number): void {
    if (ch >= 0 && ch < this.rolData.channelNum) {
      this.channelMuted[ch] = !this.channelMuted[ch];

      if (this.channelMuted[ch]) {
        // 뮤트: 현재 재생 중인 노트를 끄고 볼륨을 0으로
        this.oplEngine.noteOff(ch);
        this.oplEngine.setVoiceVolume(ch, 0);
      } else {
        // 언뮤트: 저장된 볼륨 복원
        this.oplEngine.setVoiceVolume(ch, this.CH_VOL[ch]);
      }
    }
  }

  /**
   * 틱당 지연 시간 계산 (ms)
   *
   * 원본 EROL의 타이머 계산:
   * - SetClkRate: rate = 298295 / tempo
   * - PIT 주파수: 1.193182 MHz
   * - 타이머 주기: (298295 / tempo) / 1193182 초
   * - DELAY_TIME = 240 / TPB (타이머 인터럽트 횟수)
   *
   * 따라서 한 틱의 시간:
   * tickDelay = (240 / TPB) × (298295 / tempo) / 1193182 × 1000
   *           = 60000 / (TPB × tempo) ms
   */
  getTickDelay(): number {
    // 현재 템포 (기본값: basicTempo)
    const tempo = this.C_TEMPO || this.rolData.basicTempo;

    // 정확한 계산: 60000 / (TPB × tempo)
    const baseDelay = 60000 / (this.rolData.tpb * tempo);

    // 템포 배속 적용
    return (baseDelay * 100) / this.SPEED;
  }

  /**
   * 루프 활성화/비활성화
   */
  setLoopEnabled(enabled: boolean): void {
    this.loopEnabled = enabled;
  }
}
