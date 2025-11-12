/**
 * bnk-parser.ts - BNK (Instrument Bank) 파일 파서
 *
 * EPLAYROL.C의 LoadBank() 함수 포팅
 * 원본: /Users/gcjjyy/oscc/adlib/erol/EPLAYROL.C:79-138
 */

import { BinaryReader } from "./binary-reader";
import type { BNKData, BNKHeader } from "./types";

/**
 * BNK 파일 파싱
 *
 * @param buffer BNK 파일의 ArrayBuffer
 * @returns 파싱된 BNK 데이터
 */
export function parseBNK(buffer: ArrayBuffer): BNKData {
  const reader = new BinaryReader(buffer);

  // 헤더 파싱
  const header = parseBNKHeader(reader);

  // 악기 데이터는 빈 Map으로 초기화
  const instruments = new Map<string, number[]>();

  return {
    header,
    instruments,
  };
}

/**
 * BNK 헤더 파싱
 */
function parseBNKHeader(reader: BinaryReader): BNKHeader {
  // 오프셋 0: version (2바이트)
  reader.seek(0);
  const version = reader.readUint16();

  // 오프셋 2: signature (6바이트) - "ADLIB-"
  const signature = reader.readString(6, true);

  // 오프셋 8: 악기 개수 (2바이트)
  reader.seek(8);
  const insMaxNum = reader.readUint16();

  // 오프셋 10: padding (2바이트)
  reader.skip(2);

  // 오프셋 12: 악기 리스트 오프셋 (4바이트 long)
  const insListOff = reader.readUint32();

  // 오프셋 16: 악기 데이터 오프셋 (4바이트 long)
  const insDataOff = reader.readUint32();

  return {
    version,
    signature,
    insMaxNum,
    insListOff,
    insDataOff,
  };
}

/**
 * BNK 파일에서 전체 악기 맵 생성
 *
 * @param buffer BNK 파일의 ArrayBuffer
 * @returns 악기 이름(소문자) → 파라미터 배열 (28바이트) 맵
 */
function loadAllInstruments(buffer: ArrayBuffer): Map<string, number[]> {
  const reader = new BinaryReader(buffer);
  const header = parseBNKHeader(reader);
  const allInstruments = new Map<string, number[]>();

  console.log(`[loadAllInstruments] BNK 파일 악기 총 개수: ${header.insMaxNum}`);

  // 전체 악기 리스트 순회하여 Map 생성
  for (let i = 0; i < header.insMaxNum; i++) {
    // 악기 리스트에서 이름과 인덱스 읽기
    reader.seek(header.insListOff + i * 12);
    const insIndex = reader.readUint16();
    reader.skip(1); // flag
    const name = reader.readString(9, true);

    // 악기 데이터 읽기 (30바이트: percussion(1) + voiceNumber(1) + params(28))
    reader.seek(header.insDataOff + insIndex * 30 + 2);
    const params: number[] = [];
    for (let j = 0; j < 28; j++) {
      params.push(reader.readUint8());
    }

    // 소문자로 정규화하여 저장
    allInstruments.set(name.toLowerCase(), params);
  }

  console.log(`[loadAllInstruments] 총 ${allInstruments.size}개 악기 로드 완료`);
  return allInstruments;
}

/**
 * 특정 악기들을 BNK 파일에서 로드
 *
 * @param buffer BNK 파일의 ArrayBuffer
 * @param instrumentNames 로드할 악기 이름 배열
 * @returns 악기 이름 → 파라미터 배열 (28바이트) 맵
 */
export function loadInstruments(
  buffer: ArrayBuffer,
  instrumentNames: string[]
): Map<string, number[]> {
  // 전체 악기 맵 생성
  const allInstruments = loadAllInstruments(buffer);
  const instruments = new Map<string, number[]>();

  // 요청된 악기들만 추출
  for (const insName of instrumentNames) {
    const params = allInstruments.get(insName.toLowerCase());
    if (params) {
      instruments.set(insName, params);
    } else {
      console.warn(`[loadInstruments] 악기 "${insName}" 를 BNK 파일에서 찾을 수 없음`);
    }
  }

  return instruments;
}

