/**
 * analyze-music-files.ts - IMS/ROL 파일 비교 분석 도구
 *
 * CUTE-LV2.IMS와 CUTE-LV2.ROL을 분석하여 볼륨 차이를 정량화
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { parseIMS, readPagedByte } from '../app/lib/ims/ims-parser';
import { parseROL } from '../app/lib/rol/rol-parser';

interface NoteEvent {
  channel: number;
  note: number;
  volume: number;
  tick: number;
}

interface ChannelStats {
  noteCount: number;
  totalVolume: number;
  avgVolume: number;
  minVolume: number;
  maxVolume: number;
  volumeSum: number;
}

interface FileAnalysis {
  fileName: string;
  noteEvents: NoteEvent[];
  channelStats: Map<number, ChannelStats>;
  overallStats: {
    totalNotes: number;
    avgVolume: number;
    minVolume: number;
    maxVolume: number;
  };
}

/**
 * IMS 파일 분석
 */
function analyzeIMS(filePath: string): FileAnalysis {
  const buffer = readFileSync(filePath).buffer;
  const imsData = parseIMS(buffer);

  const noteEvents: NoteEvent[] = [];
  const channelVolumes = new Array(11).fill(0);  // 각 채널의 현재 볼륨 (IMS 플레이어와 동일하게 0으로 초기화)
  const channelStats = new Map<number, ChannelStats>();

  // 채널별 통계 초기화
  for (let ch = 0; ch < imsData.chNum; ch++) {
    channelStats.set(ch, {
      noteCount: 0,
      totalVolume: 0,
      avgVolume: 0,
      minVolume: 127,
      maxVolume: 0,
      volumeSum: 0,
    });
  }

  let curByte = 0;
  let runningStatus = 0;
  let currentTick = 0;

  // 이벤트 스트림 순회 (IMS 플레이어와 동일한 로직)
  while (curByte < imsData.byteSize) {
    // Status byte 읽기
    let idcode = readPagedByte(imsData.musicData, curByte);

    // 루프 마커 체크
    if (idcode === 0xfc) {
      break;
    }

    // Running status 처리
    if (idcode < 0x80) {
      idcode = runningStatus;
    } else {
      curByte++;
      runningStatus = idcode;
    }

    const ch = idcode & 0x0f;
    const eventType = idcode & 0xf0;

    // Note on 이벤트 - pitch와 volume 2바이트 읽음
    if (eventType === 0x90 || eventType === 0x80) {
      const note = readPagedByte(imsData.musicData, curByte++);
      const volume = readPagedByte(imsData.musicData, curByte++);

      // 0x80: 항상 재생, 0x90: 볼륨이 0이 아닐 때만 재생
      const shouldPlay = (eventType === 0x80) || (eventType === 0x90 && volume > 0);

      if (shouldPlay && note > 0) {
        noteEvents.push({ channel: ch, note, volume, tick: currentTick });

        const stats = channelStats.get(ch)!;
        stats.noteCount++;
        stats.volumeSum += volume;
        stats.minVolume = Math.min(stats.minVolume, volume);
        stats.maxVolume = Math.max(stats.maxVolume, volume);
      }

      // curVol 업데이트 (플레이어와 동일)
      channelVolumes[ch] = volume;
    }
    // 볼륨 변경 이벤트 - volume 1바이트만 읽음
    else if (eventType === 0xa0) {
      const volume = readPagedByte(imsData.musicData, curByte++);
      channelVolumes[ch] = volume;
    }
    // 악기 변경 이벤트
    else if (eventType === 0xc0) {
      curByte++;  // 악기 인덱스 스킵
    }
    // 피치 벤드 이벤트
    else if (eventType === 0xe0) {
      curByte += 2;  // 피치 값 스킵
    }
    // 템포 변경 이벤트
    else if (eventType === 0xf0 && idcode !== 0xf8 && idcode !== 0xfc) {
      curByte++;  // 템포 값 스킵
    }

    // Delta time 읽기
    let delay = 0;
    while (true) {
      const timeByte = readPagedByte(imsData.musicData, curByte++);
      if (timeByte === 0xf8) {
        delay += 240;
      } else {
        delay += timeByte;
        break;
      }
    }
    currentTick += delay;
  }

  // 채널별 평균 계산
  for (const stats of channelStats.values()) {
    if (stats.noteCount > 0) {
      stats.avgVolume = stats.volumeSum / stats.noteCount;
      stats.totalVolume = stats.volumeSum;
    }
  }

  // 전체 통계 계산
  let totalNotes = 0;
  let totalVolumeSum = 0;
  let globalMin = 127;
  let globalMax = 0;

  for (const stats of channelStats.values()) {
    if (stats.noteCount > 0) {
      totalNotes += stats.noteCount;
      totalVolumeSum += stats.volumeSum;
      globalMin = Math.min(globalMin, stats.minVolume);
      globalMax = Math.max(globalMax, stats.maxVolume);
    }
  }

  return {
    fileName: filePath,
    noteEvents,
    channelStats,
    overallStats: {
      totalNotes,
      avgVolume: totalNotes > 0 ? totalVolumeSum / totalNotes : 0,
      minVolume: globalMin === 127 ? 0 : globalMin,
      maxVolume: globalMax,
    },
  };
}

/**
 * ROL 파일 분석
 */
function analyzeROL(filePath: string): FileAnalysis {
  const buffer = readFileSync(filePath).buffer;
  const rolData = parseROL(buffer);

  const noteEvents: NoteEvent[] = [];
  const channelStats = new Map<number, ChannelStats>();

  // 각 채널별로 이벤트 순회
  for (let ch = 0; ch < rolData.channelNum; ch++) {
    const channel = rolData.channels[ch];
    const stats: ChannelStats = {
      noteCount: 0,
      totalVolume: 0,
      avgVolume: 0,
      minVolume: 127,
      maxVolume: 0,
      volumeSum: 0,
    };

    // 볼륨 이벤트를 시간순으로 매핑
    const volumeByTick = new Map<number, number>();
    for (let i = 0; i < channel.volCount * 2; i += 2) {
      const tick = channel.volData[i];
      const volume = channel.volData[i + 1];
      volumeByTick.set(tick, volume);
    }

    let currentVolume = 127; // ROL 기본 볼륨

    // 노트 이벤트 순회
    for (let i = 0; i < channel.size; i += 2) {
      const note = channel.ticksData[i];
      const tick = channel.ticksData[i + 1];

      // 해당 틱의 볼륨 업데이트
      if (volumeByTick.has(tick)) {
        currentVolume = volumeByTick.get(tick)!;
      }

      if (note > 0) {
        noteEvents.push({
          channel: ch,
          note,
          volume: currentVolume,
          tick,
        });

        stats.noteCount++;
        stats.volumeSum += currentVolume;
        stats.minVolume = Math.min(stats.minVolume, currentVolume);
        stats.maxVolume = Math.max(stats.maxVolume, currentVolume);
      }
    }

    if (stats.noteCount > 0) {
      stats.avgVolume = stats.volumeSum / stats.noteCount;
      stats.totalVolume = stats.volumeSum;
      channelStats.set(ch, stats);
    }
  }

  // 전체 통계 계산
  let totalNotes = 0;
  let totalVolumeSum = 0;
  let globalMin = 127;
  let globalMax = 0;

  for (const stats of channelStats.values()) {
    totalNotes += stats.noteCount;
    totalVolumeSum += stats.volumeSum;
    globalMin = Math.min(globalMin, stats.minVolume);
    globalMax = Math.max(globalMax, stats.maxVolume);
  }

  return {
    fileName: filePath,
    noteEvents,
    channelStats,
    overallStats: {
      totalNotes,
      avgVolume: totalNotes > 0 ? totalVolumeSum / totalNotes : 0,
      minVolume: globalMin,
      maxVolume: globalMax,
    },
  };
}

/**
 * 비교 리포트 출력
 */
function printComparisonReport(imsAnalysis: FileAnalysis, rolAnalysis: FileAnalysis): void {
  console.log('\n='.repeat(80));
  console.log('MUSIC FILE COMPARISON REPORT');
  console.log('='.repeat(80));

  console.log('\n[파일 정보]');
  console.log(`IMS: ${imsAnalysis.fileName}`);
  console.log(`ROL: ${rolAnalysis.fileName}`);

  console.log('\n[전체 통계]');
  console.log('─'.repeat(80));
  console.log(
    'Format'.padEnd(10) +
    'Total Notes'.padEnd(15) +
    'Avg Volume'.padEnd(15) +
    'Min Volume'.padEnd(15) +
    'Max Volume'.padEnd(15)
  );
  console.log('─'.repeat(80));
  console.log(
    'IMS'.padEnd(10) +
    imsAnalysis.overallStats.totalNotes.toString().padEnd(15) +
    imsAnalysis.overallStats.avgVolume.toFixed(2).padEnd(15) +
    imsAnalysis.overallStats.minVolume.toString().padEnd(15) +
    imsAnalysis.overallStats.maxVolume.toString().padEnd(15)
  );
  console.log(
    'ROL'.padEnd(10) +
    rolAnalysis.overallStats.totalNotes.toString().padEnd(15) +
    rolAnalysis.overallStats.avgVolume.toFixed(2).padEnd(15) +
    rolAnalysis.overallStats.minVolume.toString().padEnd(15) +
    rolAnalysis.overallStats.maxVolume.toString().padEnd(15)
  );

  // 차이 계산
  const volumeDiff = ((rolAnalysis.overallStats.avgVolume - imsAnalysis.overallStats.avgVolume) / imsAnalysis.overallStats.avgVolume * 100);
  console.log('─'.repeat(80));
  console.log(`ROL 평균 볼륨 차이: ${volumeDiff > 0 ? '+' : ''}${volumeDiff.toFixed(2)}%`);

  console.log('\n[채널별 통계]');
  console.log('─'.repeat(80));
  console.log(
    'Ch'.padEnd(4) +
    'IMS Notes'.padEnd(12) +
    'IMS Avg Vol'.padEnd(15) +
    'ROL Notes'.padEnd(12) +
    'ROL Avg Vol'.padEnd(15) +
    'Diff %'.padEnd(10)
  );
  console.log('─'.repeat(80));

  // 모든 채널 합집합
  const allChannels = new Set([...imsAnalysis.channelStats.keys(), ...rolAnalysis.channelStats.keys()]);

  for (const ch of Array.from(allChannels).sort((a, b) => a - b)) {
    const imsStats = imsAnalysis.channelStats.get(ch);
    const rolStats = rolAnalysis.channelStats.get(ch);

    const imsNotes = imsStats?.noteCount.toString() || '-';
    const imsAvg = imsStats?.avgVolume.toFixed(2) || '-';
    const rolNotes = rolStats?.noteCount.toString() || '-';
    const rolAvg = rolStats?.avgVolume.toFixed(2) || '-';

    let diff = '-';
    if (imsStats && rolStats && imsStats.noteCount > 0 && rolStats.noteCount > 0) {
      const diffPercent = ((rolStats.avgVolume - imsStats.avgVolume) / imsStats.avgVolume * 100);
      diff = `${diffPercent > 0 ? '+' : ''}${diffPercent.toFixed(2)}%`;
    }

    console.log(
      ch.toString().padEnd(4) +
      imsNotes.padEnd(12) +
      imsAvg.padEnd(15) +
      rolNotes.padEnd(12) +
      rolAvg.padEnd(15) +
      diff.padEnd(10)
    );
  }

  console.log('─'.repeat(80));

  // ROL 볼륨 계산식 시뮬레이션
  console.log('\n[ROL 볼륨 계산 분석]');
  console.log('─'.repeat(80));
  console.log('ROL 볼륨 계산식: finalVolume = volume * (VOL_C + CH_VOL) / 100');
  console.log(`현재 설정: VOL_C = 127, CH_VOL = 0`);
  console.log(`볼륨 배율: ${(127 + 0) / 100} = 1.27x`);
  console.log();

  // 실제 재생 시 볼륨 비교
  const imsPlaybackVolume = imsAnalysis.overallStats.avgVolume * 1.0;  // IMS는 직접 사용
  const rolPlaybackVolume = rolAnalysis.overallStats.avgVolume * 1.27;  // ROL은 1.27x 증폭
  const playbackDiff = ((rolPlaybackVolume - imsPlaybackVolume) / imsPlaybackVolume * 100);

  console.log('재생 시 실제 볼륨 비교:');
  console.log(`  IMS 실제 볼륨: ${imsAnalysis.overallStats.avgVolume.toFixed(2)} × 1.00 = ${imsPlaybackVolume.toFixed(2)}`);
  console.log(`  ROL 실제 볼륨: ${rolAnalysis.overallStats.avgVolume.toFixed(2)} × 1.27 = ${rolPlaybackVolume.toFixed(2)}`);
  console.log(`  재생 볼륨 차이: ${playbackDiff > 0 ? '+' : ''}${playbackDiff.toFixed(2)}%`);
  console.log();

  if (playbackDiff > 0) {
    console.log('분석:');
    console.log(`  파일 데이터: ROL이 IMS보다 ${Math.abs(volumeDiff).toFixed(2)}% 낮음`);
    console.log(`  볼륨 증폭: ROL에 1.27배 적용 → +27%`);
    console.log(`  최종 결과: ROL이 IMS보다 ${playbackDiff.toFixed(2)}% 큼`);
  } else {
    console.log('분석:');
    console.log(`  파일 데이터: ROL이 IMS보다 ${Math.abs(volumeDiff).toFixed(2)}% 낮음`);
    console.log(`  볼륨 증폭: ROL에 1.27배 적용 → +27%`);
    console.log(`  최종 결과: ROL이 IMS보다 ${Math.abs(playbackDiff).toFixed(2)}% 작음`);
  }

  console.log();
  console.log('권장 조치:');
  // ROL 실제 볼륨을 IMS 수준으로 맞추려면: rolVol * multiplier = imsVol
  // multiplier = imsVol / rolVol
  const targetMultiplier = imsPlaybackVolume / rolAnalysis.overallStats.avgVolume;
  const targetSetting = Math.round(targetMultiplier * 100);
  console.log(`  VOL_C를 ${targetSetting} 정도로 조정하면 IMS와 동일한 볼륨`);
  console.log(`  (현재 127에서 ${targetSetting}로 변경 → ${((targetSetting - 127) / 127 * 100).toFixed(1)}% 감소)`);

  console.log('\n='.repeat(80));
}

/**
 * 메인 실행
 */
function main() {
  const publicDir = join(process.cwd(), 'public');
  const imsPath = join(publicDir, 'CUTE-LV2.IMS');
  const rolPath = join(publicDir, 'CUTE-LV2.ROL');

  console.log('파일 분석 중...\n');

  const imsAnalysis = analyzeIMS(imsPath);
  const rolAnalysis = analyzeROL(rolPath);

  printComparisonReport(imsAnalysis, rolAnalysis);
}

main();
