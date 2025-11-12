/**
 * MusicPlayer.tsx - 통합 음악 플레이어 UI 컴포넌트
 *
 * Impulse Tracker 스타일 DOS UI
 */

import { useState, useMemo, useEffect } from "react";
import { useROLPlayer } from "~/lib/hooks/useROLPlayer";
import { useIMSPlayer } from "~/lib/hooks/useIMSPlayer";
import ChannelVisualizer from "./ChannelVisualizer";
import DosPanel from "~/components/dos-ui/DosPanel";
import DosButton from "~/components/dos-ui/DosButton";
import DosList from "~/components/dos-ui/DosList";
import DosSlider from "~/components/dos-ui/DosSlider";

type MusicFormat = "ROL" | "IMS" | null;

// 샘플 음악 목록
interface MusicSample {
  musicFile: string;
  format: "ROL" | "IMS";
}

const MUSIC_SAMPLES: MusicSample[] = [
  // IMS 샘플
  // { musicFile: "/4JSTAMNT.IMS", format: "IMS" },
  { musicFile: "/CUTE-LV2.IMS", format: "IMS" },
  // { musicFile: "/DBBP^LEE.IMS", format: "IMS" },
  // { musicFile: "/DBBP^LIM.IMS", format: "IMS" },
  { musicFile: "/DQUEST4A.IMS", format: "IMS" },
  { musicFile: "/FF5-LOGO.IMS", format: "IMS" },
  // { musicFile: "/KNIGHT-!.IMS", format: "IMS" },
  { musicFile: "/NAUCIKA2.IMS", format: "IMS" },
  { musicFile: "/SIDE-END.IMS", format: "IMS" },
  { musicFile: "/AMG0018.IMS", format: "IMS" },

  // ROL 샘플
  // { musicFile: "/4JSTAMNT.ROL", format: "ROL" },
  // { musicFile: "/CUTE-LV2.ROL", format: "ROL" },
  // { musicFile: "/FF5-LOGO.ROL", format: "ROL" },
  // { musicFile: "/NAUCIKA2.ROL", format: "ROL" },
  // { musicFile: "/SIDE-END.ROL", format: "ROL" },
];

const BNK_FILE = "/STANDARD.BNK";

/**
 * URL에서 파일을 로드하여 File 객체로 변환
 */
async function loadFileFromURL(url: string, filename: string): Promise<File> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type });
}

export default function MusicPlayer() {
  const [selectedSample, setSelectedSample] = useState<string>(MUSIC_SAMPLES[0].musicFile);

  // 사용자가 직접 업로드한 파일
  const [userMusicFile, setUserMusicFile] = useState<File | null>(null);
  const [userBnkFile, setUserBnkFile] = useState<File | null>(null);

  // 샘플 음악 파일
  const [sampleMusicFile, setSampleMusicFile] = useState<File | null>(null);
  const [sampleBnkFile, setSampleBnkFile] = useState<File | null>(null);

  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [autoPlay, setAutoPlay] = useState<string | null>(null); // 자동 재생할 파일 경로

  // 플레이어에 전달되는 파일 (사용자 파일 우선, 없으면 샘플)
  const musicFile = userMusicFile || sampleMusicFile;
  const bnkFile = userBnkFile || sampleBnkFile;

  // 파일 형식 감지
  const format: MusicFormat = useMemo(() => {
    if (!musicFile) return null;
    const ext = musicFile.name.toLowerCase().split(".").pop();
    if (ext === "rol") return "ROL";
    if (ext === "ims") return "IMS";
    return null;
  }, [musicFile]);

  // ROL 플레이어
  const rolPlayer = useROLPlayer({
    rolFile: format === "ROL" ? musicFile : null,
    bnkFile,
  });

  // IMS 플레이어
  const imsPlayer = useIMSPlayer({
    imsFile: format === "IMS" ? musicFile : null,
    bnkFile,
  });

  // 현재 활성 플레이어 선택
  const player = format === "ROL" ? rolPlayer : imsPlayer;
  const { state, isLoading, error, play, pause, stop, setVolume, setTempo } = player;

  /**
   * 샘플 음악 로드
   */
  const loadSample = async (samplePath: string) => {
    setIsLoadingSample(true);
    try {
      const filename = samplePath.split("/").pop() || "sample";

      const [musicFileObj, bnkFileObj] = await Promise.all([
        loadFileFromURL(samplePath, filename),
        loadFileFromURL(BNK_FILE, "STANDARD.BNK"),
      ]);

      // 샘플 파일은 별도 state에 저장 (사용자 업로드 GUI에 영향 없음)
      setSampleMusicFile(musicFileObj);
      setSampleBnkFile(bnkFileObj);
    } catch (error) {
      console.error("[loadSample] 오류:", error);
    } finally {
      setIsLoadingSample(false);
    }
  };

  /**
   * 샘플 로드 및 자동 재생
   */
  const loadAndPlaySample = async (samplePath: string) => {
    // 기존 플레이어 정지
    if (state?.isPlaying) {
      stop();
    }

    setSelectedSample(samplePath);

    await loadSample(samplePath);

    // 파일 로드 후 autoPlay 플래그 설정 (파일 경로 저장)
    setAutoPlay(samplePath);
  };

  /**
   * 플레이어 준비 완료 시 자동 재생
   */
  useEffect(() => {
    // autoPlay가 없으면 종료
    if (!autoPlay) {
      return;
    }

    // autoPlay 파일명 추출
    const autoPlayFileName = autoPlay.split("/").pop();
    const currentFileName = musicFile?.name;

    // selectedSample의 파일 형식 확인
    const sampleExt = selectedSample.toLowerCase().split(".").pop();
    const expectedFormat = sampleExt === "rol" ? "ROL" : sampleExt === "ims" ? "IMS" : null;

    // 올바른 플레이어가 준비되었고, autoPlay 파일이 실제로 로드되었으면 재생
    // state.fileName을 사용하여 정확히 해당 플레이어의 상태인지 확인
    const stateFileName = state?.fileName;

    if (
      autoPlay &&
      state &&
      play &&
      format === expectedFormat &&
      musicFile &&
      autoPlayFileName === currentFileName && // 파일명 일치 확인
      stateFileName === currentFileName // state의 fileName이 현재 파일과 일치하는지 확인!
    ) {
      play();
      setAutoPlay(null); // 플래그 리셋
    }
  }, [autoPlay, state, play, format, selectedSample, musicFile]);

  // IMS는 currentTick, ROL은 currentByte를 사용
  const progress = state
    ? format === "IMS" && "currentTick" in state && "totalTicks" in state
      ? (state.currentTick / state.totalTicks) * 100
      : (state.currentByte / state.totalSize) * 100
    : 0;

  // 재생 시간 계산 (tick 기반)
  const totalDuration = state?.totalDuration || 0;
  const elapsedSeconds = state && totalDuration > 0
    ? format === "IMS" && "currentTick" in state && "totalTicks" in state
      ? Math.floor((state.currentTick / state.totalTicks) * totalDuration)
      : Math.floor((state.currentByte / state.totalSize) * totalDuration)
    : 0;

  // 시간 포맷팅 함수 (초 -> mm:ss)
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 샘플 리스트 아이템 생성
  const sampleListItems = MUSIC_SAMPLES.map((sample) => ({
    key: sample.musicFile,
    content: (
      <div className="flex space-between align-center w-full">
        <div className="flex gap-8 align-center">
          <span className={`dos-badge ${sample.format === 'ROL' ? 'dos-badge-rol' : 'dos-badge-ims'}`}>
            {sample.format}
          </span>
          <span>{sample.musicFile.slice(1)}</span>
        </div>
        <DosButton
          onClick={() => {
            loadAndPlaySample(sample.musicFile);
          }}
          disabled={isLoadingSample}
        >
          재생
        </DosButton>
      </div>
    ),
    onClick: () => setSelectedSample(sample.musicFile),
  }));

  return (
    <div className="dos-container">
      {/* 타이틀 바 */}
      <div className="dos-title-bar">
        <a href="https://cafe.naver.com/olddos" target="_blank" rel="noopener noreferrer" className="dos-link">
          도스박물관
        </a>
        {" "}IMS/ROL 웹플레이어 v1.4
        {format && ` - ${format} 모드`}
      </div>

      {/* 메인 그리드 */}
      <div className="dos-grid dos-grid-2col">
        {/* 좌측: 파일 선택 및 컨트롤 */}
        <div>
          {/* 파일 업로드 */}
          <DosPanel title="파일 업로드">
            <div className="flex gap-8 align-center">
              <input
                ref={(ref) => {
                  if (ref) (window as any).__musicFileInput = ref;
                }}
                type="file"
                accept=".rol,.ims"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setUserMusicFile(file);
                }}
                style={{ display: 'none' }}
              />
              <DosButton
                onClick={() => (window as any).__musicFileInput?.click()}
                style={{ flex: 1 }}
              >
                {userMusicFile ? userMusicFile.name : 'ROL/IMS 선택'}
              </DosButton>

              <input
                ref={(ref) => {
                  if (ref) (window as any).__bnkFileInput = ref;
                }}
                type="file"
                accept=".bnk"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setUserBnkFile(file);
                }}
                style={{ display: 'none' }}
              />
              <DosButton
                onClick={() => (window as any).__bnkFileInput?.click()}
                style={{ flex: 1 }}
              >
                {userBnkFile ? userBnkFile.name : 'BNK 선택'}
              </DosButton>

              <DosButton
                onClick={play}
                disabled={!musicFile || !bnkFile || (state?.isPlaying ?? false)}
                active={state?.isPlaying}
                variant="play"
                style={{ flex: 1 }}
              >
                재생
              </DosButton>
            </div>
          </DosPanel>

          {/* 일시정지/정지 버튼 */}
          <DosPanel>
            <div className="flex gap-8">
              <DosButton onClick={pause} disabled={!state || !state.isPlaying} variant="pause" style={{ flex: 1 }}>
                일시정지
              </DosButton>
              <DosButton onClick={stop} disabled={!state} variant="stop" style={{ flex: 1 }}>
                정지
              </DosButton>
            </div>
          </DosPanel>

          {/* 샘플 선택 */}
          <DosPanel title="샘플 음악" className="flex-1">
            <DosList
              items={sampleListItems}
              selectedKey={selectedSample}
            />
            {isLoadingSample && (
              <div className="dos-message dos-message-info">
                샘플 로딩중...
              </div>
            )}
          </DosPanel>

          {/* 재생 컨트롤 */}
          <DosPanel style={{ height: '140px', flexShrink: 0 }}>
            {/* 진행률 */}
            <div className="mb-16">
              <div className="dos-text-primary mb-8 flex space-between">
                <span>
                  {state?.isPlaying
                    ? `재생시간: ${formatTime(elapsedSeconds)} / ${totalDuration > 0 ? formatTime(Math.floor(totalDuration)) : '--:--'}`
                    : '재생시간: --:-- / --:--'
                  }
                </span>
                <span>
                  BPM: {state?.currentTempo ? Math.floor(state.currentTempo) : '--'}
                </span>
              </div>
              <div className="dos-slider-bar">
                <div className="dos-slider-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>

            {/* 볼륨과 템포 */}
            <div className="flex gap-8">
              <div style={{ flex: 1 }}>
                <DosSlider
                  label="볼륨"
                  value={state?.volume ?? 100}
                  min={0}
                  max={127}
                  onChange={setVolume}
                />
              </div>
              <div style={{ flex: 1 }}>
                <DosSlider
                  label="템포"
                  value={state?.tempo ?? 100}
                  min={25}
                  max={400}
                  onChange={setTempo}
                  unit="%"
                />
              </div>
            </div>
          </DosPanel>

          {/* 로딩/에러 메시지 */}
          {isLoading && (
            <div className="dos-message dos-message-info">
              {format} 파일 로딩중...
            </div>
          )}

          {error && (
            <div className="dos-message dos-message-error">
              오류: {error}
            </div>
          )}

          {!format && musicFile && (
            <div className="dos-message dos-message-error">
              지원하지 않는 파일 형식
            </div>
          )}
        </div>

        {/* 우측: 채널 시각화 */}
        <div>
          <ChannelVisualizer
            channelVolumes={state?.currentVolumes ?? Array(11).fill(0)}
            instrumentNames={state?.instrumentNames}
            channelMuted={state?.channelMuted ?? Array(11).fill(false)}
            onToggleChannel={format === "IMS" ? imsPlayer.toggleChannel : format === "ROL" ? rolPlayer.toggleChannel : imsPlayer.toggleChannel}
          />

          {/* 크레딧 */}
          <DosPanel className="dos-panel-credits" style={{ height: '140px', flexShrink: 0 }}>
            <div style={{
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              height: '100%'
            }}>
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
                <a href="https://cafe.naver.com/olddos" target="_blank" rel="noopener noreferrer" className="dos-link-credits">
                  도스박물관 - 도스 시대의 추억을 간직하는 곳
                </a>
              </div>
            </div>
          </DosPanel>
        </div>
      </div>

      {/* 스테이터스 바 */}
      {state && (
        <div className="dos-status-bar">
          <div className="dos-status-item">
            상태: {state.isPlaying ? "재생중" : state.isPaused ? "일시정지" : "정지"}
          </div>
          <div className="dos-status-item">
            위치: {state.currentByte}/{state.totalSize}
          </div>
          <div className="dos-status-item">
            템포: {state.tempo}%
          </div>
          <div className="dos-status-item">
            볼륨: {state.volume}
          </div>
        </div>
      )}
    </div>
  );
}
