/**
 * ims-types.ts - IMS 파일 형식 타입 정의
 *
 * IMS (Interactive Music System) 형식은 MIDI와 유사한 이벤트 기반 음악 포맷입니다.
 * 원본: /Users/gcjjyy/oscc/adlib/ims/IMS.C
 */

/**
 * IMS 파일 데이터 구조
 */
export interface IMSData {
  /** 곡 이름 (30바이트) */
  songName: string;

  /** 음악 데이터 전체 크기 (바이트) */
  byteSize: number;

  /** 모드 (0=멜로디 9채널, 1=퍼커션 11채널) */
  dMode: number;

  /** 기본 템포 */
  basicTempo: number;

  /** 채널 수 (9 + dMode * 2) */
  chNum: number;

  /** 음악 데이터 (32KB 페이지로 분할) */
  musicData: Uint8Array[];

  /** 악기 개수 */
  insNum: number;

  /** 악기 이름 배열 (각 9바이트, 소문자) */
  insNames: string[];
}

/**
 * IMS 이벤트 타입
 */
export enum IMSEventType {
  NOTE_ON_ALWAYS = 0x80,      // 무조건 노트 온
  NOTE_ON_CONDITIONAL = 0x90,  // 조건부 노트 온 (볼륨 0이면 오프)
  VOLUME_CHANGE = 0xa0,        // 볼륨 변경
  INSTRUMENT_CHANGE = 0xc0,    // 악기 변경
  PITCH_BEND = 0xe0,           // 피치 벤드
  TEMPO_CHANGE = 0xf0,         // 템포 변경
}

/**
 * IMS 이벤트
 */
export interface IMSEvent {
  /** 이벤트 타입 (status byte) */
  type: IMSEventType;

  /** 채널 번호 (0-10) */
  channel: number;

  /** 이벤트 데이터 */
  data: number[];

  /** 다음 이벤트까지의 딜레이 (틱) */
  delay: number;
}

/**
 * IMS 재생 상태
 */
export interface IMSPlaybackState {
  /** 로드된 파일명 (옵셔널, 훅에서 추가) */
  fileName?: string;

  /** 재생 중 여부 */
  isPlaying: boolean;

  /** 일시정지 여부 */
  isPaused: boolean;

  /** 현재 바이트 위치 */
  currentByte: number;

  /** 전체 바이트 크기 */
  totalSize: number;

  /** 전체 볼륨 (0-127) */
  volume: number;

  /** 템포 배속 (100 = 1x) */
  tempo: number;

  /** 현재 템포 값 */
  currentTempo: number;

  /** 각 채널의 현재 볼륨 */
  currentVolumes: number[];

  /** 각 채널의 악기명 */
  instrumentNames?: string[];

  /** 각 채널의 뮤트 상태 (디버깅용) */
  channelMuted?: boolean[];
}
