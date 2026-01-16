/**
 * LyricsDisplay.tsx - Karaoke-style lyrics display
 *
 * ISS 파일의 가사를 카라오케 스타일로 표시합니다.
 * Based on: imsplayer_1.0_build_2_source/IssViewer.cpp
 */

import { useMemo } from 'react';
import type { ISSData } from '~/routes/api/parse-iss';

interface LyricsDisplayProps {
  issData: ISSData | null;
  currentTick: number;
  isPlaying: boolean;
}

export default function LyricsDisplay({
  issData,
  currentTick,
  isPlaying,
}: LyricsDisplayProps) {
  // ISS 파일이 없거나 재생 중이 아니면 크레딧 표시
  const showCredits = !issData || !isPlaying;

  // 현재 가사 레코드와 인덱스 찾기 (바이너리 검색)
  const { currentRecord, currentIndex } = useMemo(() => {
    if (!issData || !isPlaying) return { currentRecord: null, currentIndex: -1 };

    // ISS 파일은 tick/8로 저장됨
    const adjustedTick = Math.floor(currentTick / 8);

    // 바이너리 검색으로 현재 레코드와 인덱스 찾기
    let left = 0;
    let right = issData.records.length - 1;
    let resultIndex = -1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (issData.records[mid].kasaTick <= adjustedTick) {
        resultIndex = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return {
      currentRecord: resultIndex >= 0 ? issData.records[resultIndex] : null,
      currentIndex: resultIndex,
    };
  }, [issData, currentTick, isPlaying]);

  // 다음 가사 레코드 찾기 (다른 라인) - indexOf 제거, 캐시된 인덱스 사용
  const nextRecord = useMemo(() => {
    if (!issData || !currentRecord || currentIndex < 0) return null;

    // 캐시된 인덱스 사용 (indexOf 대신)
    if (currentIndex < issData.records.length - 1) {
      // 다음 레코드 중 라인이 다른 첫 번째 레코드 찾기
      for (let i = currentIndex + 1; i < issData.records.length; i++) {
        if (issData.records[i].line !== currentRecord.line) {
          return issData.records[i];
        }
      }
    }
    return null;
  }, [issData, currentRecord, currentIndex]);

  // 가사 라인 계산 (useMemo 순서 유지를 위해 early return 전에 선언)
  const currentLine = useMemo(() => {
    return currentRecord && issData
      ? issData.scripts[currentRecord.line] || ''
      : '';
  }, [currentRecord, issData]);

  const nextLine = useMemo(() => {
    return nextRecord && issData
      ? issData.scripts[nextRecord.line] || ''
      : '';
  }, [nextRecord, issData]);

  // 현재 라인의 하이라이트 위치 계산
  // DOS Johab 인코딩에서는 한글=2바이트, ASCII=1바이트였지만
  // UTF-8에서는 모두 1 character이므로 변환 필요
  const highlightEnd = useMemo(() => {
    if (!currentRecord || !currentLine) return 0;

    const { startX, widthX } = currentRecord;

    // 바이트 단위를 character 단위로 변환
    // Johab에서 한글은 2바이트, ASCII는 1바이트
    // UTF-8 변환 후 각 문자를 검사하여 실제 character 위치 계산
    let bytePos = 0;
    let charPos = 0;

    // startX까지 이동
    while (bytePos < startX && charPos < currentLine.length) {
      const char = currentLine[charPos];
      // 한글/한자 등 (라틴 문자가 아닌 경우) = 원래 2바이트
      if (char.charCodeAt(0) > 127) {
        bytePos += 2;
      } else {
        bytePos += 1;
      }
      charPos++;
    }

    // widthX만큼 더 이동
    bytePos = 0;
    while (bytePos < widthX && charPos < currentLine.length) {
      const char = currentLine[charPos];
      if (char.charCodeAt(0) > 127) {
        bytePos += 2;
      } else {
        bytePos += 1;
      }
      charPos++;
    }

    return charPos;
  }, [currentRecord, currentLine]);

  // 크레딧 표시
  if (showCredits) {
    return (
      <div
        style={{
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          height: '100%',
        }}
      >
        <div style={{ marginBottom: '12px', color: 'var(--color-white)' }}>
          (C) 2025 QuickBASIC (gcjjyy@gmail.com)
        </div>
        <div style={{ marginBottom: '4px', color: 'var(--color-silver)' }}>
          도움 주신 분들
        </div>
        <div style={{ marginBottom: '8px', color: 'var(--color-yellow)' }}>
          하늘소, 피시키드, 키노피오
        </div>
        <div style={{ marginTop: '8px' }}>
          <a
            href="https://cafe.naver.com/olddos"
            target="_blank"
            rel="noopener noreferrer"
            className="dos-link-credits"
          >
            도스박물관 - 도스 시대의 추억을 간직하는 곳
          </a>
        </div>
      </div>
    );
  }

  // 가사 표시 (카라오케 모드)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
      }}
    >
      {/* 현재 가사 라인 (카라오케 하이라이트) */}
      <div
        style={{
          fontSize: '16px',
          fontFamily: 'inherit',
          marginBottom: '12px',
          lineHeight: '1.6',
          minHeight: '26px',
        }}
      >
        {currentLine && (
          <>
            {/* 재생된 부분 (연두색 하이라이트) */}
            <span
              style={{
                color: 'var(--lyrics-highlight)',
              }}
            >
              {currentLine.substring(0, highlightEnd)}
            </span>
            {/* 아직 재생 안 된 부분 (회색) */}
            <span style={{ color: 'var(--lyrics-normal)' }}>
              {currentLine.substring(highlightEnd)}
            </span>
          </>
        )}
      </div>

      {/* 다음 가사 라인 (회색) */}
      {nextLine && (
        <div
          style={{
            fontSize: '16px',
            fontFamily: 'inherit',
            color: 'var(--lyrics-normal)',
            lineHeight: '1.4',
            minHeight: '24px',
          }}
        >
          {nextLine}
        </div>
      )}
    </div>
  );
}
