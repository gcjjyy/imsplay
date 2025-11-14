/**
 * PianoRoll.tsx - 88건반 피아노 시각화 컴포넌트
 *
 * 현재 재생 중인 노트를 채널별 색상으로 표시
 */

import React from "react";

interface PianoRollProps {
  /** 현재 재생 중인 노트 정보 */
  activeNotes?: Array<{ channel: number; note: number }>;
}

// 건반 색상
const BLACK_KEY_COLOR = '#2A2A2A'; // 아주 짙은 회색
const ACTIVE_WHITE_KEY_COLOR = '#C0C0C0'; // 회색 (VGA Silver)
const ACTIVE_BLACK_KEY_COLOR = '#808080'; // 짙은 회색 (VGA Gray)

// 피아노 건반 정보
const PIANO_START_NOTE = 21; // A0
const PIANO_END_NOTE = 108;   // C8
const TOTAL_KEYS = PIANO_END_NOTE - PIANO_START_NOTE + 1; // 88

// 검은 건반 패턴 (0=흰건반, 1=검은건반)
// C, C#, D, D#, E, F, F#, G, G#, A, A#, B
const BLACK_KEY_PATTERN = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

/**
 * MIDI 노트 번호가 검은 건반인지 확인
 */
function isBlackKey(note: number): boolean {
  return BLACK_KEY_PATTERN[note % 12] === 1;
}

/**
 * 노트에 해당하는 건반 인덱스 계산 (0-87)
 */
function getKeyIndex(note: number): number {
  return note - PIANO_START_NOTE;
}

export default function PianoRoll({ activeNotes = [] }: PianoRollProps) {
  // 활성 노트를 Set으로 관리
  const activeNoteSet = new Set<number>();
  activeNotes.forEach(({ note }) => {
    // MIDI 범위 내의 노트만 표시
    if (note >= PIANO_START_NOTE && note <= PIANO_END_NOTE) {
      activeNoteSet.add(note);
    }
  });

  // 흰 건반과 검은 건반 렌더링
  const whiteKeys: React.JSX.Element[] = [];
  const blackKeys: React.JSX.Element[] = [];

  let whiteKeyIndex = 0;

  for (let i = 0; i < TOTAL_KEYS; i++) {
    const note = PIANO_START_NOTE + i;
    const isBlack = isBlackKey(note);
    const isActive = activeNoteSet.has(note);

    if (isBlack) {
      // 검은 건반
      blackKeys.push(
        <div
          key={`black-${i}`}
          className="piano-key-black"
          style={{
            left: `${whiteKeyIndex * (100 / 52)}%`, // 52개의 흰 건반 기준
            backgroundColor: isActive ? ACTIVE_BLACK_KEY_COLOR : BLACK_KEY_COLOR,
            ...(isActive && {
              borderTopColor: '#A0A0A0',
              borderLeftColor: '#A0A0A0',
              borderRightColor: '#404040',
              borderBottomColor: '#404040',
            })
          }}
        />
      );
    } else {
      // 흰 건반
      whiteKeys.push(
        <div
          key={`white-${i}`}
          className="piano-key-white"
          style={{
            backgroundColor: isActive ? ACTIVE_WHITE_KEY_COLOR : '#FFFFFF',
            ...(isActive && {
              borderLeftColor: '#FFFFFF',
              borderBottomColor: '#808080',
            })
          }}
        />
      );
      whiteKeyIndex++;
    }
  }

  return (
    <div className="piano-roll">
      <div className="piano-keys">
        {whiteKeys}
      </div>
      <div className="piano-keys-black">
        {blackKeys}
      </div>
    </div>
  );
}
