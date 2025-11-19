/**
 * types.ts - ROL/BNK 파일 구조와 재생 상태 타입 정의
 */

/**
 * BNK 파일 헤더
 */
export interface BNKHeader {
  version: number;          // uint16_t
  signature: string;        // char[6] - "ADLIB-"
  insMaxNum: number;        // uint16_t - 악기 개수
  insListOff: number;       // uint32_t - 악기 이름 리스트 오프셋
  insDataOff: number;       // uint32_t - 악기 데이터 오프셋
}

/**
 * BNK 악기 리스트 항목
 */
export interface BNKInstrumentListEntry {
  index: number;            // uint16_t
  flag: number;             // uint8_t
  name: string;             // char[9]
}

/**
 * BNK 악기 데이터 (30바이트)
 */
export interface BNKInstrumentData {
  percussion: number;       // uint8_t
  voiceNumber: number;      // uint8_t
  params: number[];         // uint8_t[28] - OPL 파라미터
}

/**
 * BNK 파일 전체 데이터
 */
export interface BNKData {
  header: BNKHeader;
  instruments: Map<string, number[]>;  // 악기 이름 → 파라미터 배열 (28바이트)
}

/**
 * ROL 템포 이벤트
 */
export interface ROLTempoEvent {
  time: number;             // uint16_t - 틱 위치
  value: number;            // float32 → int로 변환된 템포 값
}

/**
 * ROL 틱 이벤트 (노트)
 */
export interface ROLTickEvent {
  time: number;             // uint16_t - 틱 위치
  offset: number;           // uint16_t - 누적 오프셋 (파싱 시 계산)
  note: number;             // uint16_t - MIDI 노트 번호 (실제 데이터, 별도 저장)
}

/**
 * ROL 악기 변경 이벤트
 */
export interface ROLInstrumentEvent {
  time: number;             // uint16_t - 틱 위치
  name: string;             // char[9] - 악기 이름
  insIndex: number;         // 악기 인덱스 (파싱 후 할당)
}

/**
 * ROL 볼륨 이벤트
 */
export interface ROLVolumeEvent {
  time: number;             // uint16_t - 틱 위치
  value: number;            // float32 → int (0-127)
}

/**
 * ROL 피치 벤드 이벤트
 */
export interface ROLPitchEvent {
  time: number;             // uint16_t - 틱 위치
  value: number;            // float32 → int (0x0-0x4000)
}

/**
 * ROL 채널 데이터
 */
export interface ROLChannelData {
  size: number;             // uint16_t - 채널 크기

  // 틱 데이터 (노트 타이밍)
  ticksData: number[];      // int[] - [time, offset, time, offset, ...]
  ticksCount: number;       // 틱 이벤트 개수

  // 악기 데이터
  insTime: number[];        // int[] - 악기 변경 시간
  insList: number[];        // int[] - 악기 인덱스
  insCount: number;         // 악기 변경 이벤트 개수

  // 볼륨 데이터
  volData: number[];        // int[] - [time, value, time, value, ...]
  volCount: number;         // 볼륨 이벤트 개수

  // 피치 벤드 데이터
  pitData: number[];        // int[] - [time, value, time, value, ...]
  pitCount: number;         // 피치 벤드 이벤트 개수

  // 임시 데이터 (중복 제거 전)
  _insNames?: string[];     // 임시 악기 이름 목록
}

/**
 * ROL 파일 전체 데이터
 */
export interface ROLData {
  // 헤더 정보
  tpb: number;              // uint16_t - Ticks Per Beat
  dMode: number;            // uint8_t - 드럼 모드 (0=멜로디, 1=드럼)
  basicTempo: number;       // float32 - 기본 템포

  // 템포 데이터
  tempoData: number[];      // int[] - [time, value, time, value, ...]
  tempoCount: number;       // 템포 변화 이벤트 개수

  // 채널 데이터 (9 또는 11채널)
  channels: ROLChannelData[];
  channelNum: number;       // 채널 수 (9 or 11)

  // 악기 정보
  insNum: number;           // 총 악기 개수 (중복 제거 후)
  insName: string[];        // 악기 이름 배열

  // 총 크기
  totalSize: number;        // 가장 긴 채널의 크기
}

/**
 * 재생 상태
 */
export interface PlaybackState {
  fileName?: string;        // 로드된 파일명 (옵셔널, 훅에서 추가)
  isPlaying: boolean;
  isPaused: boolean;
  currentByte: number;      // 현재 재생 위치 (틱)
  totalSize: number;        // 총 길이 (틱)
  totalDuration?: number;   // 전체 재생 시간 (초)

  // 제어 변수
  volume: number;           // 전체 볼륨 (0-127)
  tempo: number;            // 템포 배속 (100 = 1x)
  keyTranspose: number;     // 키 조옮김 (-13 ~ +13)
  channelVolumes: number[]; // 채널별 볼륨 (0-127)

  // 현재 상태
  currentTempo: number;     // 현재 템포 값 (BPM)
  currentTick: number;      // 현재 틱 위치 (ISS 가사 동기화용, ROL은 사용 안 함)
  currentVolumes: number[]; // 각 채널의 현재 볼륨
  instrumentNames?: string[]; // 각 채널의 악기명
  channelMuted?: boolean[]; // 각 채널의 뮤트 상태 (디버깅용)
  activeNotes?: Array<{ channel: number; note: number }>; // 현재 재생 중인 노트 정보
}

/**
 * ROL 플레이어 옵션
 */
export interface ROLPlayerOptions {
  rolData: ROLData;
  bnkData: BNKData;
  sampleRate?: number;      // 기본값: 44100
  loopEnabled?: boolean;    // 기본값: true
}

/**
 * OPL 엔진 옵션
 */
export interface OPLEngineOptions {
  sampleRate?: number;      // 기본값: 44100
}
