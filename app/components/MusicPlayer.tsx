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
import PianoRoll from "./PianoRoll";
import { X, Repeat1, Repeat } from "lucide-react";

type MusicFormat = "ROL" | "IMS" | null;

// 샘플 음악 목록
interface MusicSample {
  musicFile: string;
  format: "ROL" | "IMS";
}

const MUSIC_SAMPLES: MusicSample[] = [
  // IMS 샘플
  { musicFile: "/4JSTAMNT.IMS", format: "IMS" },
  { musicFile: "/CUTE-LV2.IMS", format: "IMS" },
  { musicFile: "/DQUEST4A.IMS", format: "IMS" },
  { musicFile: "/FF5-LOGO.IMS", format: "IMS" },
  { musicFile: "/KNIGHT-!.IMS", format: "IMS" },
  { musicFile: "/NAUCIKA2.IMS", format: "IMS" },
  { musicFile: "/SIDE-END.IMS", format: "IMS" },
  { musicFile: "/MYSTERY-.IMS", format: "IMS"},
  { musicFile: "/NI-ORANX.IMS", format: "IMS"},
  { musicFile: "/JAM-MEZO.IMS", format: "IMS"},
  { musicFile: "/AMG0002.IMS", format: "IMS" },
  { musicFile: "/AMG0008.IMS", format: "IMS" },
  { musicFile: "/AMG0011.IMS", format: "IMS" },
  { musicFile: "/AMG0014.IMS", format: "IMS" },
  { musicFile: "/AMG0015.IMS", format: "IMS" },
  { musicFile: "/AMG0018.IMS", format: "IMS" },
  { musicFile: "/AMG0024.IMS", format: "IMS" },
  { musicFile: "/FF6-GW02.IMS", format: "IMS" },
  { musicFile: "/GRAD1-1.IMS", format: "IMS" },
  { musicFile: "/GRAD2-1.IMS", format: "IMS" },
  { musicFile: "/GRAD2-2.IMS", format: "IMS" },
  { musicFile: "/GRAD2-3.IMS", format: "IMS" },
  { musicFile: "/GRAD2-4.IMS", format: "IMS" },
  { musicFile: "/GRAD3-2.IMS", format: "IMS" },
  { musicFile: "/JAM-FIVE.IMS", format: "IMS" },
  { musicFile: "/JAM-NADI.IMS", format: "IMS" },
  { musicFile: "/MACROS!!.IMS", format: "IMS" },
  { musicFile: "/MACROS2.IMS", format: "IMS" },
  { musicFile: "/P_013.IMS", format: "IMS" },
  { musicFile: "/SPI0082.IMS", format: "IMS" },

  // ROL 샘플
  { musicFile: "/4JSTAMNT.ROL", format: "ROL" },
  { musicFile: "/CUTE-LV2.ROL", format: "ROL" },
  { musicFile: "/FF5-LOGO.ROL", format: "ROL" },
  { musicFile: "/NAUCIKA2.ROL", format: "ROL" },
  { musicFile: "/SIDE-END.ROL", format: "ROL" },
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

/**
 * 음악 파일에 대응하는 BNK 파일 경로를 찾습니다.
 * 동일한 이름의 BNK 파일이 있으면 그것을 사용하고, 없으면 STANDARD.BNK를 사용합니다.
 */
async function findMatchingBnkFile(musicFilePath: string): Promise<string> {
  // 확장자를 제거하고 .BNK로 변경
  const basePath = musicFilePath.substring(0, musicFilePath.lastIndexOf('.'));
  const matchingBnkPath = `${basePath}.BNK`;

  // 파일 존재 확인 (HEAD 요청)
  try {
    const response = await fetch(matchingBnkPath, { method: 'HEAD' });
    if (response.ok) {
      return matchingBnkPath;
    }
  } catch (error) {
    // 파일이 없으면 에러 발생, STANDARD.BNK 사용
  }

  return BNK_FILE;
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
  const [masterVolume, setMasterVolumeState] = useState<number>(50); // 마스터 볼륨 상태

  // 반복 모드
  type RepeatMode = 'none' | 'single' | 'all';
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('all');
  const [currentPlaylistIndex, setCurrentPlaylistIndex] = useState<number>(0);

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
  const { state, isLoading, error, play, pause, stop, setVolume, setTempo, setMasterVolume } = player;

  /**
   * 샘플 음악 로드
   */
  const loadSample = async (samplePath: string) => {
    setIsLoadingSample(true);
    try {
      const filename = samplePath.split("/").pop() || "sample";

      // BNK 파일 경로 결정 (동일 이름 BNK 있으면 사용, 없으면 STANDARD.BNK)
      const bnkPath = await findMatchingBnkFile(samplePath);
      const bnkFilename = bnkPath.split("/").pop() || "STANDARD.BNK";

      const [musicFileObj, bnkFileObj] = await Promise.all([
        loadFileFromURL(samplePath, filename),
        loadFileFromURL(bnkPath, bnkFilename),
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

    // 플레이리스트 인덱스 업데이트
    const index = MUSIC_SAMPLES.findIndex(s => s.musicFile === samplePath);
    if (index !== -1) {
      setCurrentPlaylistIndex(index);
    }

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

    console.log('[autoPlay useEffect]', {
      autoPlay,
      hasState: !!state,
      hasPlay: !!play,
      format,
      expectedFormat,
      hasMusicFile: !!musicFile,
      autoPlayFileName,
      currentFileName,
      stateFileName,
      fileNameMatch: autoPlayFileName === currentFileName,
      stateFileNameMatch: stateFileName === currentFileName
    });

    if (
      autoPlay &&
      state &&
      play &&
      format === expectedFormat &&
      musicFile &&
      autoPlayFileName === currentFileName && // 파일명 일치 확인
      stateFileName === currentFileName // state의 fileName이 현재 파일과 일치하는지 확인!
    ) {
      console.log('[autoPlay useEffect] 조건 만족, play() 호출');
      play();
      setAutoPlay(null); // 플래그 리셋
    }
  }, [autoPlay, state, play, format, selectedSample, musicFile]);

  /**
   * 플레이어 초기화 시 마스터 볼륨 설정
   */
  useEffect(() => {
    if (state && setMasterVolume) {
      setMasterVolume(masterVolume);
    }
  }, [state, musicFile]);

  /**
   * 반복 모드에 따라 플레이어의 loopEnabled 설정 동기화
   * - 사용자 업로드 파일: 'single' 또는 'all' 모두 루프 활성화 (1곡만 있으므로)
   * - 샘플 파일: 'single'만 루프 활성화 ('all'은 다음 곡으로)
   */
  useEffect(() => {
    // 플레이어가 초기화되지 않았으면 무시
    if (!state || !musicFile) return;

    const isUserFile = !!userMusicFile;
    const shouldLoop = repeatMode === 'single' || (repeatMode === 'all' && isUserFile);

    console.log('[Loop Sync]', {
      repeatMode,
      isUserFile,
      shouldLoop,
      format,
      hasState: true
    });

    if (format === 'IMS') {
      imsPlayer.setLoopEnabled(shouldLoop);
    } else if (format === 'ROL') {
      rolPlayer.setLoopEnabled(shouldLoop);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeatMode, format, userMusicFile, musicFile]);

  /**
   * 플레이어 초기화 직후 loopEnabled 설정
   */
  useEffect(() => {
    if (!state || !musicFile) return;

    const isUserFile = !!userMusicFile;
    const shouldLoop = repeatMode === 'single' || (repeatMode === 'all' && isUserFile);

    console.log('[Loop Sync on Player Init]', {
      repeatMode,
      isUserFile,
      shouldLoop,
      format
    });

    if (format === 'IMS') {
      imsPlayer.setLoopEnabled(shouldLoop);
    } else if (format === 'ROL') {
      rolPlayer.setLoopEnabled(shouldLoop);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.isPlaying]); // isPlaying이 변경될 때만 (초기화 직후)

  /**
   * 다음 곡 재생
   */
  const playNextTrack = () => {
    const nextIndex = (currentPlaylistIndex + 1) % MUSIC_SAMPLES.length;
    setCurrentPlaylistIndex(nextIndex);
    loadAndPlaySample(MUSIC_SAMPLES[nextIndex].musicFile);
  };

  /**
   * 트랙 종료 감지 및 처리
   * - 샘플 파일 + 'all' 모드: 다음 곡 재생
   * - 사용자 파일 + 'all' 모드: loopEnabled가 처리 (위 useEffect에서 true로 설정)
   */
  useEffect(() => {
    // 재생 중이 아니고, 파일이 로드되어 있고, 트랙이 끝까지 진행된 경우
    const isAtEnd = state && !state.isPlaying && state.currentByte >= state.totalSize - 100;
    const isSampleFile = !!sampleMusicFile;

    // 파일명 검증: state의 fileName과 현재 musicFile.name이 일치해야 함
    const stateFileName = state?.fileName;
    const currentFileName = musicFile?.name;
    const isCorrectFile = stateFileName === currentFileName;

    if (isAtEnd && musicFile && !isLoadingSample && isCorrectFile) {
      console.log('[Track End Detection] 트랙 종료 감지!', {
        isSampleFile,
        repeatMode,
        currentFile: musicFile.name,
        stateFileName,
        isCorrectFile
      });

      // 'all' 모드이고 샘플 파일인 경우만 다음 곡 재생
      // 사용자 파일은 loopEnabled=true로 자동 반복됨
      if (repeatMode === 'all' && isSampleFile) {
        console.log('[Track End Detection] 다음 곡 재생 시작');
        // 약간의 딜레이 후 다음 곡 재생 (UI 업데이트 시간 확보)
        const timeoutId = setTimeout(() => {
          playNextTrack();
        }, 500);

        // cleanup: 컴포넌트가 언마운트되거나 dependency가 변경되면 타이머 취소
        return () => clearTimeout(timeoutId);
      }
      // 'none', 'single', 또는 사용자 파일의 경우는 loopEnabled가 처리
    }
  }, [state?.isPlaying, state?.currentByte, state?.totalSize, repeatMode, sampleMusicFile, musicFile, isLoadingSample]);

  // progress bar (currentByte/totalSize 기반)
  const progress = state ? (state.currentByte / state.totalSize) * 100 : 0;

  // 재생 시간 계산 (currentByte 기반, totalDuration 초과 방지)
  const totalDuration = state?.totalDuration || 0;
  const elapsedSeconds = state && totalDuration > 0
    ? Math.min(Math.floor((state.currentByte / state.totalSize) * totalDuration), Math.floor(totalDuration))
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
        {" "}IMS/ROL 웹플레이어 v1.18
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
                {userMusicFile ? userMusicFile.name : 'IMS/ROL 선택'}
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

          {/* 일시정지/정지 버튼 및 반복 모드 */}
          <DosPanel>
            <div className="flex gap-8">
              <DosButton onClick={pause} disabled={!state || !state.isPlaying} variant="pause" style={{ flex: 1, padding: '2px 8px' }}>
                일시정지
              </DosButton>
              <DosButton onClick={stop} disabled={!state} variant="stop" style={{ flex: 1, padding: '2px 8px' }}>
                정지
              </DosButton>

              {/* 반복 모드 (DOS 스타일 정사각형 버튼) */}
              <div className="flex" style={{ gap: '2px', margin: 0 }}>
                <DosButton
                  onClick={() => setRepeatMode('none')}
                  active={repeatMode === 'none'}
                  style={{
                    width: '26px',
                    height: '26px',
                    padding: '2px',
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderTop: repeatMode === 'none' ? '2px solid black' : '2px solid white',
                    borderLeft: repeatMode === 'none' ? '2px solid black' : '2px solid white',
                    borderBottom: repeatMode === 'none' ? '2px solid white' : '2px solid black',
                    borderRight: repeatMode === 'none' ? '2px solid white' : '2px solid black',
                    backgroundColor: repeatMode === 'none' ? 'teal' : '#C0C0C0',
                    color: 'black'
                  }}
                >
                  <X size={12} />
                </DosButton>
                <DosButton
                  onClick={() => setRepeatMode('all')}
                  active={repeatMode === 'all'}
                  style={{
                    width: '26px',
                    height: '26px',
                    padding: '2px',
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderTop: repeatMode === 'all' ? '2px solid black' : '2px solid white',
                    borderLeft: repeatMode === 'all' ? '2px solid black' : '2px solid white',
                    borderBottom: repeatMode === 'all' ? '2px solid white' : '2px solid black',
                    borderRight: repeatMode === 'all' ? '2px solid white' : '2px solid black',
                    backgroundColor: repeatMode === 'all' ? 'teal' : '#C0C0C0',
                    color: 'black'
                  }}
                >
                  <Repeat size={12} />
                </DosButton>
                <DosButton
                  onClick={() => setRepeatMode('single')}
                  active={repeatMode === 'single'}
                  style={{
                    width: '26px',
                    height: '26px',
                    padding: '2px',
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderTop: repeatMode === 'single' ? '2px solid black' : '2px solid white',
                    borderLeft: repeatMode === 'single' ? '2px solid black' : '2px solid white',
                    borderBottom: repeatMode === 'single' ? '2px solid white' : '2px solid black',
                    borderRight: repeatMode === 'single' ? '2px solid white' : '2px solid black',
                    backgroundColor: repeatMode === 'single' ? 'teal' : '#C0C0C0',
                    color: 'black'
                  }}
                >
                  <Repeat1 size={12} />
                </DosButton>
              </div>
            </div>
          </DosPanel>

          {/* 샘플 선택 */}
          <DosPanel title="샘플 음악" className="flex-1">
            <DosList
              items={sampleListItems}
              selectedKey={selectedSample}
            />
          </DosPanel>

          {/* 재생 컨트롤 */}
          <DosPanel style={{ height: '140px', flexShrink: 0 }}>
            {/* 진행률 */}
            <div className="mb-16">
              <div className="dos-progress-bar">
                <div className="dos-progress-fill" style={{ width: `${progress}%` }} />
                <div className="dos-progress-text">
                  {state?.isPlaying
                    ? `${formatTime(elapsedSeconds)} / ${totalDuration > 0 ? formatTime(Math.floor(totalDuration)) : '--:--'}`
                    : '--:-- / --:--'
                  }
                </div>
              </div>
            </div>

            {/* 볼륨, 템포, 마스터볼륨 */}
            <div>
              <DosSlider
                label="OPL 볼륨"
                value={state?.volume ?? 100}
                min={0}
                max={127}
                onChange={setVolume}
              />
              <DosSlider
                label="템포"
                value={state?.tempo ?? 100}
                min={25}
                max={400}
                onChange={setTempo}
                unit="%"
              />
              <DosSlider
                label="마스터 볼륨"
                value={masterVolume}
                min={0}
                max={100}
                onChange={(vol) => {
                  setMasterVolumeState(vol);
                  setMasterVolume(vol);
                }}
                unit="%"
              />
            </div>
          </DosPanel>

          {/* 에러 메시지 */}
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

      {/* 피아노 건반 시각화 */}
      <PianoRoll activeNotes={state?.activeNotes} />

      {/* 스테이터스 바 */}
      <div className="dos-status-bar">
        <div className="dos-status-item">
          상태: {state ? (
            state.isPlaying
              ? `재생중 (${musicFile?.name || '?'}${bnkFile ? ', ' + bnkFile.name : ''})`
              : state.isPaused
                ? "일시정지"
                : "정지"
          ) : "대기"}
        </div>
        <div className="dos-status-item">
          BPM: {state?.currentTempo ? Math.floor(state.currentTempo) : '--'}
        </div>
      </div>
    </div>
  );
}
