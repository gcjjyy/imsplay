/**
 * rol-parser.ts - ROL (AdLib Visual Composer) 파일 파서
 *
 * EPLAYROL.C의 LoadRol() 함수 포팅
 * 원본: /Users/gcjjyy/oscc/adlib/erol/EPLAYROL.C:140-299
 */

import { BinaryReader } from "./binary-reader";
import type { ROLData, ROLChannelData } from "./types";

/**
 * ROL 파일 파싱
 *
 * @param buffer ROL 파일의 ArrayBuffer
 * @returns 파싱된 ROL 데이터
 */
export function parseROL(buffer: ArrayBuffer): ROLData {
  const reader = new BinaryReader(buffer);

  // 오프셋 44: TPB (Ticks Per Beat) - 2바이트 int
  reader.seek(44);
  const tpb = reader.readUint16();

  // 오프셋 53: Drum mode - 1바이트
  // EPLAYROL.C:163-165에서 D_MODE = !D_MODE로 논리 반전함
  // 파일에 0 저장 = 퍼커션 모드(11채널), 1 저장 = 멜로디 모드(9채널)
  reader.seek(53);
  const rawDMode = reader.readUint8();
  const dMode = rawDMode === 0 ? 1 : 0; // 논리 반전
  const channelNum = 9 + 2 * dMode; // 9 or 11

  // 오프셋 197: Basic tempo - 4바이트 float
  reader.seek(197);
  const basicTempo = reader.readFloat32();

  // 오프셋 201: Tempo change count - 2바이트 int
  const tempoCount = reader.readUint16();

  // 템포 데이터 로드 (6바이트씩: time(2) + value(4 float))
  const tempoData: number[] = [];
  for (let i = 0; i < tempoCount; i++) {
    const time = reader.readUint16();
    const value = reader.readFloat32();
    tempoData.push(time);
    tempoData.push(Math.floor(value * basicTempo)); // float를 int로 변환
  }

  // 채널 데이터 로드
  const channels: ROLChannelData[] = [];
  let totalSize = 0;

  for (let ch = 0; ch < channelNum; ch++) {
    const channelData = parseChannel(reader, ch);
    channels.push(channelData);
    if (channelData.size > totalSize) {
      totalSize = channelData.size;
    }
  }

  // 악기 이름 중복 제거 및 인덱싱
  const { insNum, insName } = deduplicateInstruments(channels, channelNum);

  // INS_LIST 업데이트 (악기 이름 → 인덱스)
  updateInstrumentIndices(channels, channelNum, insName);

  return {
    tpb,
    dMode,
    basicTempo,
    tempoData,
    tempoCount,
    channels,
    channelNum,
    insNum,
    insName,
    totalSize,
  };
}

/**
 * 단일 채널 데이터 파싱
 *
 * EPLAYROL.C:183-255
 */
function parseChannel(reader: BinaryReader, ch: number): ROLChannelData {
  // 15바이트 헤더 건너뛰기
  reader.skip(15);

  // 채널 크기 (2바이트 int)
  const size = reader.readUint16();
  const curFile = reader.tell();

  // 틱 데이터 개수 세기 (2-pass)
  let ticksCount = 0;
  let fullsize = 0;
  while (size > fullsize) {
    const time = reader.readUint16();
    const eventSize = reader.readUint16();
    ticksCount++;
    fullsize += eventSize;
  }

  // 틱 데이터 로드
  const ticksData: number[] = [];
  if (size > 0) {
    reader.seek(curFile);
    let offset = 0;
    for (let i = 0; i < ticksCount; i++) {
      const time = reader.readUint16();
      const eventSize = reader.readUint16();
      ticksData.push(time);
      ticksData.push(offset); // 누적 오프셋 저장
      offset += eventSize;
    }
  }

  // 악기 블록
  reader.skip(15); // 헤더
  const insCount = reader.readUint16();

  const insTime: number[] = [];
  const insNames: string[] = [];

  for (let i = 0; i < insCount; i++) {
    const time = reader.readUint16();
    const name = reader.readString(9, true);
    reader.skip(3); // padding
    insTime.push(time);
    insNames.push(name);
  }

  // 일단 insList는 0xfff로 초기화 (나중에 업데이트)
  const insList: number[] = new Array(insCount).fill(0xfff);

  // 볼륨 블록
  reader.skip(15); // 헤더
  const volCount = reader.readUint16();

  const volData: number[] = [];
  for (let i = 0; i < volCount; i++) {
    const time = reader.readUint16();
    const value = reader.readFloat32();
    volData.push(time);
    volData.push(Math.floor(value * 127)); // float (0.0-1.0) → int (0-127)
  }

  // 피치 벤드 블록
  reader.skip(15); // 헤더
  const pitCount = reader.readUint16();

  const pitData: number[] = [];
  for (let i = 0; i < pitCount; i++) {
    const time = reader.readUint16();
    const value = reader.readFloat32();
    pitData.push(time);
    pitData.push(Math.floor(value * 0x2000)); // float → int (0x0-0x4000)
  }

  return {
    size,
    ticksData,
    ticksCount,
    insTime,
    insList,
    insCount,
    volData,
    volCount,
    pitData,
    pitCount,
    // 임시로 insNames를 저장 (나중에 중복 제거에 사용)
    _insNames: insNames,
  };
}

/**
 * 악기 이름 중복 제거 및 인덱싱
 *
 * EPLAYROL.C:258-277
 */
function deduplicateInstruments(
  channels: ROLChannelData[],
  channelNum: number
): { insNum: number; insName: string[] } {
  let insNum = 0;
  const insName: string[] = [];

  for (let ch = 0; ch < channelNum; ch++) {
    const channel = channels[ch];
    const insNames = (channel as any)._insNames as string[];

    for (let i = 0; i < channel.insCount; i++) {
      if (channel.insList[i] === 0xfff) {
        // 새 악기 발견
        channel.insList[i] = insNum;
        const currentInsName = insNames[i];
        insName.push(currentInsName);
        insNum++;

        // 다른 채널에서 같은 이름의 악기 찾아서 인덱스 할당
        for (let ch2 = ch; ch2 < channelNum; ch2++) {
          const channel2 = channels[ch2];
          const insNames2 = (channel2 as any)._insNames as string[];

          for (let j = 0; j < channel2.insCount; j++) {
            if (
              insNames2[j].toLowerCase() === currentInsName.toLowerCase() &&
              channel2.insList[j] === 0xfff
            ) {
              channel2.insList[j] = channel.insList[i];
            }
          }
        }
      }
    }
  }

  // 임시 _insNames 제거
  for (const channel of channels) {
    delete (channel as any)._insNames;
  }

  return { insNum, insName };
}

/**
 * 악기 인덱스 업데이트 (이미 deduplicateInstruments에서 처리됨)
 */
function updateInstrumentIndices(
  channels: ROLChannelData[],
  channelNum: number,
  insName: string[]
): void {
  // 이미 deduplicateInstruments에서 처리되었으므로 추가 작업 불필요
}
