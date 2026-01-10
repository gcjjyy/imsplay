/**
 * MusicPlayer.tsx - 통합 음악 플레이어 UI 컴포넌트
 *
 * Impulse Tracker 스타일 DOS UI
 */

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useFetcher } from "react-router";
import { useROLPlayer } from "~/lib/hooks/useROLPlayer";
import { useIMSPlayer } from "~/lib/hooks/useIMSPlayer";
import { useVGMPlayer } from "~/lib/hooks/useVGMPlayer";
import { isYM3812VGM } from "~/lib/vgm/vgm-parser";
// ═══════════════════════════════════════════════════════════════
// [MEDIA SESSION API - 비활성화됨]
// 나중에 재활성화하려면 이 섹션의 주석을 제거하세요
// ═══════════════════════════════════════════════════════════════
// import { generateSilentAudioDataURL } from "~/lib/utils/silent-audio";
// ═══════════════════════════════════════════════════════════════
import ChannelVisualizer from "./ChannelVisualizer";
import DosPanel from "~/components/dos-ui/DosPanel";
import DosButton from "~/components/dos-ui/DosButton";
import DosList from "~/components/dos-ui/DosList";
import DosSlider from "~/components/dos-ui/DosSlider";
import PianoRoll from "./PianoRoll";
import LyricsDisplay from "./LyricsDisplay";
import type { ISSData } from "~/routes/api/parse-iss";
import { Repeat1, Repeat, Play, Square, SkipBack, SkipForward, Shuffle } from "lucide-react";
import { version } from "../../package.json";

type MusicFormat = "ROL" | "IMS" | "VGM" | null;
type RepeatMode = 'all' | 'one' | 'shuffle';

// 샘플 음악 목록
export interface MusicSample {
  musicFile: string;
  format: "ROL" | "IMS" | "VGM";
  title?: string;
}

export const MUSIC_SAMPLES: MusicSample[] = [
  // IMS 샘플
  { musicFile: "/JAM-FIVE.IMS", format: "IMS" },
  { musicFile: "/JAM-NADI.IMS", format: "IMS" },
  { musicFile: "/MYSTERY-.IMS", format: "IMS"},
  { musicFile: "/SHC.IMS", format: "IMS" },
  { musicFile: "/4JSTAMNT.IMS", format: "IMS" },
  { musicFile: "/CUTE-LV2.IMS", format: "IMS" },
  { musicFile: "/DQUEST4A.IMS", format: "IMS" },
  // { musicFile: "/COCKTAIL.IMS", format: "IMS" },
  { musicFile: "/SIM-FEEL.IMS", format: "IMS" },
  { musicFile: "/O-HA.IMS", format: "IMS" },
  { musicFile: "/EAGLE-5.IMS", format: "IMS" },
  { musicFile: "/FF5-LOGO.IMS", format: "IMS" },
  { musicFile: "/KNIGHT-!.IMS", format: "IMS" },
  { musicFile: "/GENESIS.IMS", format: "IMS" },
  { musicFile: "/NAUCIKA2.IMS", format: "IMS" },
  { musicFile: "/SIDE-END.IMS", format: "IMS" },
  { musicFile: "/S-SOME.IMS", format: "IMS"},
  { musicFile: "/NI-ORANX.IMS", format: "IMS"},
  { musicFile: "/JAM-MEZO.IMS", format: "IMS"},
  { musicFile: "/AS2OPEN-.IMS", format: "IMS" },
  { musicFile: "/YS-THEME.IMS", format: "IMS" },
  { musicFile: "/YS2END.IMS", format: "IMS" },
  { musicFile: "/YS2OVER.IMS", format: "IMS" },
  { musicFile: "/JAM-MCRS.IMS", format: "IMS" },
  { musicFile: "/PHANTASY.IMS", format: "IMS" },
  { musicFile: "/PRO-6.IMS", format: "IMS" },
  { musicFile: "/VIDEO03.IMS", format: "IMS" },
  { musicFile: "/AMG0014.IMS", format: "IMS" },
  { musicFile: "/AMG0015.IMS", format: "IMS" },
  { musicFile: "/AMG0018.IMS", format: "IMS" },
  { musicFile: "/AMG0024.IMS", format: "IMS" },
  { musicFile: "/FF6-GW02.IMS", format: "IMS" },
  { musicFile: "/MACROS!!.IMS", format: "IMS" },
  { musicFile: "/MACROS2.IMS", format: "IMS" },
  { musicFile: "/AMG0002.IMS", format: "IMS" },
  { musicFile: "/AMG0008.IMS", format: "IMS" },
  { musicFile: "/AMG0011.IMS", format: "IMS" },
  { musicFile: "/P_013.IMS", format: "IMS" },
  { musicFile: "/SPI0051.IMS", format: "IMS" },
  { musicFile: "/SONG08.IMS", format: "IMS" },
  { musicFile: "/SPI0082.IMS", format: "IMS" },
  { musicFile: "/GRAD1-1.IMS", format: "IMS" },
  { musicFile: "/GRAD2-1.IMS", format: "IMS" },
  { musicFile: "/GRAD2-2.IMS", format: "IMS" },
  { musicFile: "/GRAD2-3.IMS", format: "IMS" },
  { musicFile: "/GRAD2-4.IMS", format: "IMS" },
  { musicFile: "/GRAD3-1.IMS", format: "IMS" },
  { musicFile: "/GRAD3-2.IMS", format: "IMS" },
  { musicFile: "/TWINBEE1.IMS", format: "IMS" },
  { musicFile: "/TWINBEE2.IMS", format: "IMS" },

  // ROL 샘플
  { musicFile: "/VV.ROL", format: "ROL" },
  { musicFile: "/4JSTAMNT.ROL", format: "ROL" },
  { musicFile: "/CUTE-LV2.ROL", format: "ROL" },
  { musicFile: "/FF5-LOGO.ROL", format: "ROL" },
  { musicFile: "/NAUCIKA2.ROL", format: "ROL" },
  { musicFile: "/SIDE-END.ROL", format: "ROL" },

  // VGM 샘플
  { musicFile: "/01 Horst-Wessel-Lied.vgm", format: "VGM" },
  { musicFile: "/Wolf.vgm", format: "VGM" },
  { musicFile: "/01 Profile determination.vgm", format: "VGM" },
  { musicFile: "/03 Opening 2.vgm", format: "VGM" },
  { musicFile: "/04 Main screen (Spring).vgm", format: "VGM" },
  { musicFile: "/05 Main screen (Summer).vgm", format: "VGM" },
  { musicFile: "/06 Main screen (Autumn).vgm", format: "VGM" },
  { musicFile: "/07 Main screen (Winter).vgm", format: "VGM" },
  { musicFile: "/10 To the city.vgm", format: "VGM" },
  { musicFile: "/12 Part-time job.vgm", format: "VGM" },
  { musicFile: "/13 Training.vgm", format: "VGM" },
  { musicFile: "/16 People encounter.vgm", format: "VGM" },
  { musicFile: "/20 Rest.vgm", format: "VGM" },
  { musicFile: "/30 Ending.vgm", format: "VGM" },
  { musicFile: "/31 Credits.vgm", format: "VGM" },
  { musicFile: "/01 Shadows Don't Scare Commander Keen!!.vgm", format: "VGM" },
  { musicFile: "/01 Simpsons Theme Song.vgm", format: "VGM" },
  { musicFile: "/02 Main Theme.vgm", format: "VGM" },
  { musicFile: "/03 Buy, Sell Music.vgm", format: "VGM" },
  { musicFile: "/04 Town.vgm", format: "VGM" },
  { musicFile: "/04 Tropical Ghost Oasis.vgm", format: "VGM" },
  { musicFile: "/05 Welcome to a Kick In Yore Pants In Good Ole Hillville!.vgm", format: "VGM" },
  { musicFile: "/18 Tyrian, The Level.vgm", format: "VGM" },
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
 * ISS 파일을 서버로 전송하여 파싱 (Johab → UTF-8 변환 포함)
 */
async function parseISSFile(issFile: File | string): Promise<ISSData | null> {
  try {
    let file: File;

    // URL 문자열인 경우 File로 변환
    if (typeof issFile === 'string') {
      const response = await fetch(issFile);
      if (!response.ok) return null;
      const blob = await response.blob();
      file = new File([blob], issFile.split('/').pop() || 'file.ISS');
    } else {
      file = issFile;
    }

    // FormData로 서버에 전송
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/parse-iss', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      console.warn('ISS parsing failed:', response.statusText);
      return null;
    }

    const data = await response.json();
    return data as ISSData;
  } catch (error) {
    console.warn('ISS file not found or parsing error:', error);
    return null;
  }
}

/**
 * 샘플 음악의 BNK 파일 경로를 찾습니다 (public 폴더 내 검색)
 */
async function findMatchingBnkFile(musicFilePath: string): Promise<string> {
  const basePath = musicFilePath.substring(0, musicFilePath.lastIndexOf('.'));
  const matchingBnkPath = `${basePath}.BNK`;

  try {
    const response = await fetch(matchingBnkPath, { method: 'HEAD' });
    if (response.ok) {
      return matchingBnkPath;
    }
  } catch (error) {
    // 파일이 없으면 STANDARD.BNK 사용
  }

  return BNK_FILE;
}

/**
 * 사용자 폴더에서 BNK 파일 찾기 (3단계 우선순위)
 * 1. 음악 파일명과 동일한 BNK
 * 2. 폴더 내 STANDARD.BNK
 * 3. public/STANDARD.BNK
 */
async function findUserBnkFile(
  musicFile: File,
  userBnkMap: Map<string, File>
): Promise<File> {
  const baseName = musicFile.name.replace(/\.(ims|rol)$/i, '').toLowerCase();

  // 1순위: 동일 이름 BNK (사용자 폴더)
  const matchingBnk = userBnkMap.get(`${baseName}.bnk`);
  if (matchingBnk) {
    return matchingBnk;
  }

  // 2순위: STANDARD.BNK (사용자 폴더)
  const standardBnk = userBnkMap.get('standard.bnk');
  if (standardBnk) {
    return standardBnk;
  }

  // 3순위: public/STANDARD.BNK (fetch)
  return loadFileFromURL(BNK_FILE, 'STANDARD.BNK');
}

interface MusicPlayerProps {
  titleMap: Record<string, string>;
}

export default function MusicPlayer({ titleMap }: MusicPlayerProps) {
  // React Router fetcher for API calls
  const fetcher = useFetcher<{ titleMap: Record<string, string> }>();

  // 샘플 음악 목록
  const [musicSamples, setMusicSamples] = useState<MusicSample[]>(MUSIC_SAMPLES);

  // 사용자 폴더 정보
  const [userFolderName, setUserFolderName] = useState<string>("");
  const [userMusicFiles, setUserMusicFiles] = useState<File[]>([]);
  const [userMusicFileTitles, setUserMusicFileTitles] = useState<Map<string, string>>(new Map());
  const [userBnkFiles, setUserBnkFiles] = useState<Map<string, File>>(new Map());
  const [userIssFiles, setUserIssFiles] = useState<Map<string, File>>(new Map());

  // 로딩 상태
  const [isProcessingFiles, setIsProcessingFiles] = useState<boolean>(false);
  const [currentLoadingFile, setCurrentLoadingFile] = useState<string>("");
  const [loadedFileCount, setLoadedFileCount] = useState<number>(0);
  const [totalFilesToLoad, setTotalFilesToLoad] = useState<number>(0);

  // 트랙 인덱스
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number>(0); // 리스트에서 선택된 곡
  const [playingTrackIndex, setPlayingTrackIndex] = useState<number>(0); // 실제 재생 중인 곡
  const [currentMusicFile, setCurrentMusicFile] = useState<File | null>(null);
  const [currentBnkFile, setCurrentBnkFile] = useState<File | null>(null);
  const [currentIssData, setCurrentIssData] = useState<ISSData | null>(null); // ISS 가사 데이터
  const [fileLoadKey, setFileLoadKey] = useState<number>(0);

  // 재생 상태
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('all');
  const [isLoadingTrack, setIsLoadingTrack] = useState(false);
  const [autoPlay, setAutoPlay] = useState<boolean>(false);
  const [masterVolume, setMasterVolumeState] = useState<number>(50);
  const [shouldAutoScroll, setShouldAutoScroll] = useState<boolean>(false);

  // 드래그 앤 드롭 상태
  const [isDragging, setIsDragging] = useState(false);

  // 트랙 종료 콜백 ref (정의 순서 문제 해결)
  const playNextTrackRef = useRef<(() => void) | null>(null);

  // 셔플 재생 히스토리 (이전 곡으로 돌아가기 위해)
  const shuffleHistoryRef = useRef<number[]>([]);
  const shuffleHistoryIndexRef = useRef<number>(-1);

  // 강제 재로드 플래그 (트랙 재생 버튼 클릭 시 AudioContext 완전 재생성)
  const forceReloadRef = useRef<boolean>(false);

  // 공유 AudioContext (IMS/ROL 플레이어 간 공유 - Safari autoplay 정책 준수)
  const sharedAudioContextRef = useRef<AudioContext | null>(null);

  // Media Session API용 Audio 요소 (srcObject로 MediaStream 연결)
  const audioElementRef = useRef<HTMLAudioElement>(null);

  // 로딩 표시 (파일 처리 중이거나 fetcher 실행 중)
  const isLoadingFolder = isProcessingFiles || fetcher.state === 'submitting' || fetcher.state === 'loading';

  // 파일 형식 감지
  const format: MusicFormat = useMemo(() => {
    if (!currentMusicFile) return null;
    const ext = currentMusicFile.name.toLowerCase().split(".").pop();
    if (ext === "rol") return "ROL";
    if (ext === "ims") return "IMS";
    if (ext === "vgm" || ext === "vgz") return "VGM";
    return null;
  }, [currentMusicFile]);

  // 트랙 종료 콜백 (백그라운드에서도 작동)
  const handleTrackEnd = useCallback(() => {
    playNextTrackRef.current?.();
  }, []);

  // ROL 플레이어
  const rolPlayer = useROLPlayer({
    rolFile: format === "ROL" ? currentMusicFile : null,
    bnkFile: currentBnkFile,
    fileLoadKey,
    forceReloadRef,
    onTrackEnd: handleTrackEnd,
    sharedAudioContextRef,
    audioElementRef,
  });

  // IMS 플레이어
  const imsPlayer = useIMSPlayer({
    imsFile: format === "IMS" ? currentMusicFile : null,
    bnkFile: currentBnkFile,
    fileLoadKey,
    forceReloadRef,
    onTrackEnd: handleTrackEnd,
    sharedAudioContextRef,
    audioElementRef,
  });

  // VGM 플레이어
  const vgmPlayer = useVGMPlayer({
    vgmFile: format === "VGM" ? currentMusicFile : null,
    fileLoadKey,
    forceReloadRef,
    onTrackEnd: handleTrackEnd,
    sharedAudioContextRef,
    audioElementRef,
  });

  // 현재 활성 플레이어 선택
  const player = format === "ROL" ? rolPlayer : format === "VGM" ? vgmPlayer : imsPlayer;
  const { state, error, isPlayerReady, play, pause, stop, setVolume, setTempo, setMasterVolume, checkPlayerReady } = player;

  // Format-aware ready state (IMS↔ROL↔VGM 전환 시 auto-play가 올바르게 작동하도록)
  const isCurrentPlayerReady = useMemo(() => {
    if (!format || !currentMusicFile) return false;

    const ext = currentMusicFile.name.toLowerCase().split('.').pop();
    let expectedFormat: MusicFormat = null;
    if (ext === 'rol') expectedFormat = 'ROL';
    else if (ext === 'ims') expectedFormat = 'IMS';
    else if (ext === 'vgm' || ext === 'vgz') expectedFormat = 'VGM';

    if (format !== expectedFormat) return false;

    if (format === 'ROL') return rolPlayer.isPlayerReady;
    if (format === 'VGM') return vgmPlayer.isPlayerReady;
    return imsPlayer.isPlayerReady;
  }, [format, currentMusicFile, rolPlayer.isPlayerReady, imsPlayer.isPlayerReady, vgmPlayer.isPlayerReady]);

  // 음악 리스트 결정 (사용자 폴더 or 샘플)
  const isUserFolder = userFolderName && userMusicFiles.length > 0;
  const musicList = isUserFolder ? userMusicFiles : musicSamples;
  const folderTitle = useMemo(() => {
    if (userFolderName) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <img src="/images/folder.png" alt="folder" width="16" height="16" style={{ display: 'block' }} />
          <span style={{ textTransform: 'uppercase' }}>{userFolderName}</span>
        </span>
      );
    }
    return "샘플 음악";
  }, [userFolderName]);

  /**
   * 폴더에서 파일 읽기 (재귀적)
   */
  const readDirectory = async (entry: any): Promise<File[]> => {
    const files: File[] = [];

    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file((file: File) => {
          resolve([file]);
        });
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      return new Promise((resolve) => {
        const readEntries = async () => {
          dirReader.readEntries(async (entries: any[]) => {
            if (entries.length === 0) {
              resolve(files);
              return;
            }

            for (const entry of entries) {
              const subFiles = await readDirectory(entry);
              files.push(...subFiles);
            }

            // 더 많은 항목이 있을 수 있으므로 계속 읽기
            await readEntries();
          });
        };
        readEntries();
      });
    }

    return files;
  };

  /**
   * 파일 목록 처리 (폴더 선택 or 드래그 앤 드롭 공통 로직)
   */
  const processFiles = useCallback(async (files: File[], providedFolderName?: string) => {
    // 현재 재생 중인 음악 멈추기
    if (state) {
      stop();
    }

    // 폴더명 먼저 결정
    let folderName: string = providedFolderName || "";
    if (!folderName) {
      const firstFile = files[0];
      const relativePath = (firstFile as any).webkitRelativePath || firstFile.name;
      folderName = relativePath.split('/')[0] || "사용자 폴더";
    }
    setUserFolderName(folderName); // 폴더명 먼저 설정

    setIsProcessingFiles(true); // 로딩 시작
    setCurrentLoadingFile(""); // 로딩 파일명 초기화
    setLoadedFileCount(0); // 로딩 카운트 초기화

    try {
      // 파일 분류 (대소문자 구별 없이)
      const imsRolFiles = files.filter(f => /\.(ims|rol)$/i.test(f.name));
      const vgmFiles = files.filter(f => /\.(vgm|vgz)$/i.test(f.name));
      const bnkFiles = files.filter(f => /\.bnk$/i.test(f.name));
      const issFiles = files.filter(f => /\.iss$/i.test(f.name));

      // VGM 파일 중 YM3812 칩을 사용하는 파일만 필터링
      const validVgmFiles: File[] = [];
      for (const vgmFile of vgmFiles) {
        try {
          const buffer = await vgmFile.arrayBuffer();
          if (isYM3812VGM(buffer)) {
            validVgmFiles.push(vgmFile);
          }
        } catch {
          // 파일 읽기 실패 시 무시
        }
      }

      const musicFiles = [...imsRolFiles, ...validVgmFiles];

      // BNK 파일을 Map으로 변환 (파일명 소문자 → File 객체)
      const bnkMap = new Map(bnkFiles.map(f => [f.name.toLowerCase(), f]));

      // ISS 파일을 Map으로 변환 (파일명 소문자 → File 객체)
      const issMap = new Map(issFiles.map(f => [f.name.toLowerCase(), f]));

      // 제목 Map 초기화
      const titlesMap = new Map<string, string>();

      // 전체 처리할 파일 수
      setTotalFilesToLoad(musicFiles.length);
      setLoadedFileCount(0);

      let processedCount = 0;
      const BATCH_SIZE = 10;

      // 모든 음악 파일을 배치로 처리 (ROL + IMS 함께)
      for (let i = 0; i < musicFiles.length; i += BATCH_SIZE) {
        const batch = musicFiles.slice(i, i + BATCH_SIZE);

        // 배치에서 IMS와 ROL 분리
        const batchImsFiles = batch.filter(f => /\.ims$/i.test(f.name));
        const batchRolFiles = batch.filter(f => /\.rol$/i.test(f.name));

        // ROL 파일은 즉시 처리
        batchRolFiles.forEach(file => {
          titlesMap.set(file.name, file.name.replace(/\.rol$/i, ''));
        });

        // IMS 파일이 있으면 API 호출
        if (batchImsFiles.length > 0) {
          const formData = new FormData();
          batchImsFiles.forEach((file, index) => {
            formData.append(`ims-${index}`, file);
          });

          try {
            const response = await fetch('/api/extract-titles', {
              method: 'POST',
              body: formData,
            });

            if (response.ok) {
              const data = await response.json();
              Object.entries(data.titleMap).forEach(([fileName, title]) => {
                titlesMap.set(fileName, title as string);
              });
              setUserMusicFileTitles(new Map(titlesMap));
            } else if (response.status === 413) {
              console.warn(`Batch 크기가 너무 큽니다. 배치 크기를 줄이세요.`);
              batchImsFiles.forEach(file => {
                titlesMap.set(file.name, file.name.replace(/\.ims$/i, ''));
              });
            }
          } catch (error) {
            console.error(`Batch 처리 실패:`, error);
            batchImsFiles.forEach(file => {
              titlesMap.set(file.name, file.name.replace(/\.ims$/i, ''));
            });
          }
        }

        // 진행률 업데이트 및 배치 파일명 순차 표시
        for (let j = 0; j < batch.length; j++) {
          setCurrentLoadingFile(batch[j].name);
          setLoadedFileCount(processedCount + j + 1);
          // 파일명 표시 간격
          await new Promise(resolve => setTimeout(resolve, 5));
        }

        // 배치 완료 후 최종 카운트 업데이트
        processedCount += batch.length;
        setLoadedFileCount(processedCount);
      }

      setUserMusicFiles(musicFiles);
      setUserMusicFileTitles(titlesMap);
      setUserBnkFiles(bnkMap);
      setUserIssFiles(issMap);
      setSelectedTrackIndex(0);
      setPlayingTrackIndex(0);

      // 첫 번째 곡 로드 (자동 재생 안 함)
      if (musicFiles.length > 0) {
        loadTrack(0, musicFiles, bnkMap, issMap, false);
      }
    } catch (error) {
      console.error('파일 처리 오류:', error);
    } finally {
      setIsProcessingFiles(false);
    }
  }, [fetcher, state, stop]);

  /**
   * 폴더 선택 핸들러 (input)
   */
  const handleFolderSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    await processFiles(files);
  }, [processFiles]);

  /**
   * 드래그 앤 드롭 핸들러
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;

    const allFiles: File[] = [];
    let folderName = "사용자 폴더";

    // 첫 번째 아이템이 폴더인지 확인
    const firstItem = items[0];
    if (firstItem.kind === 'file') {
      const entry = firstItem.webkitGetAsEntry();
      if (entry) {
        if (entry.isDirectory) {
          folderName = entry.name;

          // 폴더의 모든 파일 읽기
          const files = await readDirectory(entry);
          allFiles.push(...files);
        } else {
          // 파일 직접 드롭
          const file = firstItem.getAsFile();
          if (file) allFiles.push(file);
        }
      }
    }

    if (allFiles.length > 0) {
      await processFiles(allFiles, folderName);
    }
  }, [readDirectory, processFiles]);

  /**
   * 트랙 로드 (사용자 폴더 or 샘플)
   */
  const loadTrack = useCallback(async (
    index: number,
    files?: File[],
    bnkMap?: Map<string, File>,
    issMap?: Map<string, File>,
    autoPlayAfterLoad: boolean = false
  ) => {
    // 현재 재생 중이면 정지
    if (state?.isPlaying) {
      stop();
    }

    setIsLoadingTrack(true);
    setSelectedTrackIndex(index);
    setPlayingTrackIndex(index);

    try {
      if (isUserFolder || files) {
        // 사용자 폴더 모드
        const musicFiles = files || userMusicFiles;
        const userBnkMap = bnkMap || userBnkFiles;
        const userIssMap = issMap || userIssFiles;
        const musicFile = musicFiles[index];

        if (!musicFile) {
          return;
        }

        const bnkFile = await findUserBnkFile(musicFile, userBnkMap);

        setCurrentMusicFile(musicFile);
        setCurrentBnkFile(bnkFile);

        // ISS 파일 찾기 (사용자 폴더의 경우 파일명 매칭)
        if (musicFile.name.toLowerCase().endsWith('.ims')) {
          const baseName = musicFile.name.replace(/\.ims$/i, '').toLowerCase();
          const matchingIss = userIssMap.get(`${baseName}.iss`);

          if (matchingIss) {
            const issData = await parseISSFile(matchingIss);
            setCurrentIssData(issData);
          } else {
            setCurrentIssData(null);
          }
        } else {
          setCurrentIssData(null);
        }
      } else {
        // 샘플 모드
        const sample = musicSamples[index];
        if (!sample) {
          return;
        }

        const filename = sample.musicFile.split("/").pop() || "sample";
        const bnkPath = await findMatchingBnkFile(sample.musicFile);
        const bnkFilename = bnkPath.split("/").pop() || "STANDARD.BNK";

        const [musicFileObj, bnkFileObj] = await Promise.all([
          loadFileFromURL(sample.musicFile, filename),
          loadFileFromURL(bnkPath, bnkFilename),
        ]);

        setCurrentMusicFile(musicFileObj);
        setCurrentBnkFile(bnkFileObj);

        // ISS 파일 찾기 (샘플 모드의 경우 public 폴더에서 확인)
        if (sample.format === 'IMS') {
          const issPath = sample.musicFile.replace('.IMS', '.ISS');
          const issData = await parseISSFile(issPath);
          setCurrentIssData(issData);
        } else {
          setCurrentIssData(null);
        }
      }

      // fileLoadKey 증가 (플레이어 강제 재초기화)
      setFileLoadKey(prev => prev + 1);

      if (autoPlayAfterLoad) {
        setAutoPlay(true);
      }
    } catch (error) {
      console.error('[loadTrack] 에러:', error);
    } finally {
      setIsLoadingTrack(false);
    }
  }, [isUserFolder, userMusicFiles, userBnkFiles, musicSamples, state?.isPlaying, stop]);

  /**
   * titleMap을 사용하여 샘플 목록에 제목 추가
   */
  useEffect(() => {
    const samplesWithTitles = MUSIC_SAMPLES.map((sample) => {
      if (sample.format === 'IMS') {
        const fileName = sample.musicFile.slice(1);
        const title = titleMap[fileName] || fileName.replace('.IMS', '');
        return { ...sample, title };
      } else {
        const title = sample.musicFile.slice(1).replace('.ROL', '');
        return { ...sample, title };
      }
    });
    setMusicSamples(samplesWithTitles);
  }, [titleMap]);

  /**
   * fetcher에서 IMS 제목을 받아서 업데이트
   */
  useEffect(() => {
    if (fetcher.data && fetcher.data.titleMap) {
      const newTitlesMap = new Map(userMusicFileTitles);
      Object.entries(fetcher.data.titleMap).forEach(([fileName, title]) => {
        newTitlesMap.set(fileName, title as string);
      });

      setUserMusicFileTitles(newTitlesMap);
    }
  }, [fetcher.data]);

  /**
   * 플레이어 준비 완료 시 자동 재생
   */
  useEffect(() => {
    if (!autoPlay || !state || !play || !currentMusicFile || !checkPlayerReady) {
      return;
    }

    // Format-aware ready check (IMS↔ROL 전환 시 올바른 플레이어 체크)
    if (!isCurrentPlayerReady) {
      return;
    }

    // playerRef 직접 확인 (stale state 회피)
    if (!checkPlayerReady()) {
      return;
    }

    const stateFileName = state?.fileName;
    const currentFileName = currentMusicFile.name;

    if (stateFileName === currentFileName) {
      play();
      setAutoPlay(false);
    }
  }, [autoPlay, isCurrentPlayerReady, state, play, format, currentMusicFile, checkPlayerReady]);

  /**
   * 플레이어 초기화 시 마스터 볼륨 설정
   */
  useEffect(() => {
    if (state && setMasterVolume) {
      setMasterVolume(masterVolume);
    }
  }, [state, currentMusicFile, setMasterVolume, masterVolume]);

  /**
   * 반복 모드에 따라 플레이어의 loopEnabled 설정
   * - 'one': 루프 활성화 (한 곡 반복)
   * - 'all': 루프 비활성화 (다음 곡으로)
   * - 'none': 루프 비활성화 (마지막 곡 후 정지)
   */
  useEffect(() => {
    if (!currentMusicFile || !format) return;

    const shouldLoop = repeatMode === 'one';

    if (format === 'IMS') {
      imsPlayer.setLoopEnabled(shouldLoop);
    } else if (format === 'ROL') {
      rolPlayer.setLoopEnabled(shouldLoop);
    } else if (format === 'VGM') {
      vgmPlayer.setLoopEnabled(shouldLoop);
    }
  }, [repeatMode, format, currentMusicFile]);

  /**
   * 셔플 히스토리 초기화 (첫 재생 시 현재 곡 추가)
   */
  useEffect(() => {
    if (repeatMode === 'shuffle' && state?.isPlaying) {
      // 히스토리가 비어있거나 마지막 항목이 현재 곡이 아니면 추가
      const lastIndex = shuffleHistoryRef.current[shuffleHistoryRef.current.length - 1];
      if (shuffleHistoryRef.current.length === 0 || lastIndex !== playingTrackIndex) {
        // playNextTrack에서 이미 추가된 경우가 아닐 때만 추가
        if (shuffleHistoryIndexRef.current < 0 || shuffleHistoryRef.current[shuffleHistoryIndexRef.current] !== playingTrackIndex) {
          shuffleHistoryRef.current.push(playingTrackIndex);
          shuffleHistoryIndexRef.current = shuffleHistoryRef.current.length - 1;
        }
      }
    }
  }, [repeatMode, state?.isPlaying, playingTrackIndex]);

  /**
   * 셔플 모드 해제 시 히스토리 초기화
   */
  useEffect(() => {
    if (repeatMode !== 'shuffle') {
      shuffleHistoryRef.current = [];
      shuffleHistoryIndexRef.current = -1;
    }
  }, [repeatMode]);

  /**
   * 사용자 폴더 변경 시 셔플 히스토리 초기화
   */
  useEffect(() => {
    shuffleHistoryRef.current = [];
    shuffleHistoryIndexRef.current = -1;
  }, [userFolderName]);

  /**
   * 이전 곡 재생
   */
  const playPreviousTrack = useCallback(() => {
    setShouldAutoScroll(true);
    if (repeatMode === 'shuffle') {
      // 셔플 모드: 히스토리에서 이전 곡으로 이동
      if (shuffleHistoryIndexRef.current > 0) {
        shuffleHistoryIndexRef.current--;
        const prevIndex = shuffleHistoryRef.current[shuffleHistoryIndexRef.current];
        loadTrack(prevIndex, undefined, undefined, undefined, true);
      }
      // 히스토리가 없으면 아무 것도 안 함
    } else {
      // 'all' 또는 'one' 모드: 순환 재생
      const prevIndex = playingTrackIndex === 0 ? musicList.length - 1 : playingTrackIndex - 1;
      loadTrack(prevIndex, undefined, undefined, undefined, true);
    }
  }, [repeatMode, playingTrackIndex, musicList.length, loadTrack]);

  /**
   * 다음 곡 재생
   */
  const playNextTrack = useCallback(() => {
    setShouldAutoScroll(true);
    if (repeatMode === 'shuffle') {
      // 셔플 모드: 히스토리에서 다음 곡이 있으면 재생, 없으면 새 랜덤 곡 추가
      if (shuffleHistoryIndexRef.current < shuffleHistoryRef.current.length - 1) {
        // 히스토리에서 다음 곡으로 이동
        shuffleHistoryIndexRef.current++;
        const nextIndex = shuffleHistoryRef.current[shuffleHistoryIndexRef.current];
        loadTrack(nextIndex, undefined, undefined, undefined, true);
      } else {
        // 새 랜덤 곡 추가
        let randomIndex;
        if (musicList.length > 1) {
          do {
            randomIndex = Math.floor(Math.random() * musicList.length);
          } while (randomIndex === playingTrackIndex);
        } else {
          randomIndex = 0;
        }
        // 히스토리에 추가
        shuffleHistoryRef.current.push(randomIndex);
        shuffleHistoryIndexRef.current = shuffleHistoryRef.current.length - 1;
        loadTrack(randomIndex, undefined, undefined, undefined, true);
      }
    } else {
      // 'all' 또는 'one' 모드: 순환 재생
      const nextIndex = (playingTrackIndex + 1) % musicList.length;
      loadTrack(nextIndex, undefined, undefined, undefined, true);
    }
  }, [repeatMode, playingTrackIndex, musicList.length, loadTrack]);

  // playNextTrack ref 업데이트 (백그라운드 트랙 종료 콜백용)
  useEffect(() => {
    playNextTrackRef.current = playNextTrack;
  }, [playNextTrack]);

  // autoScroll 후 리셋
  useEffect(() => {
    if (shouldAutoScroll) {
      const timer = setTimeout(() => setShouldAutoScroll(false), 100);
      return () => clearTimeout(timer);
    }
  }, [shouldAutoScroll]);

  /**
   * 트랙 종료 감지 및 처리
   */
  useEffect(() => {
    const isAtEnd = state && !state.isPlaying && state.currentByte >= state.totalSize - 100;
    const stateFileName = state?.fileName;
    const currentFileName = currentMusicFile?.name;
    const isCorrectFile = stateFileName === currentFileName;

    if (isAtEnd && currentMusicFile && !isLoadingTrack && isCorrectFile && repeatMode !== 'one') {
      const timeoutId = setTimeout(() => {
        playNextTrack();
      }, 500);

      return () => clearTimeout(timeoutId);
    }
  }, [state?.isPlaying, state?.currentByte, state?.totalSize, state?.fileName, repeatMode, currentMusicFile, isLoadingTrack, playNextTrack]);

  /**
   * Media Session API 통합 (블루투스 이어폰, 잠금 화면 제어 지원)
   */
  useEffect(() => {
    if (!("mediaSession" in navigator)) {
      return;
    }

    // 재생 상태 설정
    if (state?.isPlaying) {
      navigator.mediaSession.playbackState = "playing";
    } else if (state?.isPaused) {
      navigator.mediaSession.playbackState = "paused";
    } else {
      navigator.mediaSession.playbackState = "none";
    }

    // 메타데이터 업데이트
    if (currentMusicFile) {
      const title = isUserFolder
        ? userMusicFileTitles.get(currentMusicFile.name) || currentMusicFile.name.replace(/\.(ims|rol|vgm|vgz)$/i, '')
        : musicSamples[playingTrackIndex]?.title || currentMusicFile.name.replace(/\.(ims|rol|vgm|vgz)$/i, '');

      const artist = format === "IMS" ? "IMS Music" : format === "VGM" ? "VGM Music" : "AdLib ROL Music";
      const album = isUserFolder ? userFolderName : "Sample Music";

      navigator.mediaSession.metadata = new MediaMetadata({
        title: title,
        artist: artist,
        album: album,
      });
    }

    // 액션 핸들러 설정
    navigator.mediaSession.setActionHandler("play", () => {
      console.log('[Media Session] Play');
      if (play) play();
    });

    navigator.mediaSession.setActionHandler("pause", () => {
      console.log('[Media Session] Pause');
      if (pause) pause();
    });

    navigator.mediaSession.setActionHandler("previoustrack", () => {
      console.log('[Media Session] Previous Track');
      playPreviousTrack();
    });

    navigator.mediaSession.setActionHandler("nexttrack", () => {
      console.log('[Media Session] Next Track');
      playNextTrack();
    });

    navigator.mediaSession.setActionHandler("stop", () => {
      console.log('[Media Session] Stop');
      if (stop) stop();
    });

    return () => {
      // cleanup: 핸들러 제거
      if ("mediaSession" in navigator) {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("previoustrack", null);
        navigator.mediaSession.setActionHandler("nexttrack", null);
        navigator.mediaSession.setActionHandler("stop", null);
      }
    };
  }, [state?.isPlaying, state?.isPaused, currentMusicFile, play, pause, stop, playPreviousTrack, playNextTrack, isUserFolder, userMusicFileTitles, musicSamples, playingTrackIndex, format, userFolderName]);

  // progress bar
  const progress = state ? (state.currentByte / state.totalSize) * 100 : 0;

  // 음악 리스트 아이템 생성
  const listItems = useMemo(() => {
    if (isUserFolder) {
      // 사용자 폴더 모드
      return userMusicFiles.map((file, index) => {
        const ext = file.name.toLowerCase().split('.').pop();
        const format = ext === 'rol' ? 'ROL' : (ext === 'vgm' || ext === 'vgz') ? 'VGM' : 'IMS';
        const title = userMusicFileTitles.get(file.name) || file.name.replace(/\.(ims|rol|vgm|vgz)$/i, '');

        return {
          key: `${index}-${file.name}`,
          content: (
            <div className="flex gap-8 align-center w-full" style={{ overflow: 'hidden' }}>
              <span className={`dos-badge ${format === 'ROL' ? 'dos-badge-rol' : format === 'VGM' ? 'dos-badge-vgm' : 'dos-badge-ims'}`} style={{ flexShrink: 0 }}>
                {format}
              </span>
              <span className="sample-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
            </div>
          ),
        };
      });
    } else {
      // 샘플 모드
      return musicSamples.map((sample, index) => ({
        key: sample.musicFile,
        content: (
          <div className="flex gap-8 align-center w-full" style={{ overflow: 'hidden' }}>
            <span className={`dos-badge ${sample.format === 'ROL' ? 'dos-badge-rol' : sample.format === 'VGM' ? 'dos-badge-vgm' : 'dos-badge-ims'}`} style={{ flexShrink: 0 }}>
              {sample.format}
            </span>
            <span className="sample-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sample.title || sample.musicFile.slice(1)}</span>
          </div>
        ),
      }));
    }
  }, [isUserFolder, userMusicFiles, userMusicFileTitles, musicSamples]);

  // 선택된 트랙의 키 (UI 선택 기준)
  const selectedKey = useMemo(() => {
    if (isUserFolder) {
      const file = userMusicFiles[selectedTrackIndex];
      return file ? `${selectedTrackIndex}-${file.name}` : "";
    } else {
      return musicSamples[selectedTrackIndex]?.musicFile || "";
    }
  }, [isUserFolder, userMusicFiles, musicSamples, selectedTrackIndex]);

  // 리스트 아이템 클릭 = 선택만 (재생 안 함)
  const handleListSelect = useCallback((_key: string, index: number) => {
    setSelectedTrackIndex(index);
  }, []);

  // 현재 트랙 제목 (상태바 표시용 - 재생 중인 곡 기준)
  const currentTrackTitle = useMemo(() => {
    if (isUserFolder) {
      const file = userMusicFiles[playingTrackIndex];
      if (!file) return '?';
      return userMusicFileTitles.get(file.name) || file.name.replace(/\.(ims|rol)$/i, '');
    } else {
      return musicSamples[playingTrackIndex]?.title || currentMusicFile?.name || '?';
    }
  }, [isUserFolder, userMusicFiles, userMusicFileTitles, musicSamples, playingTrackIndex, currentMusicFile]);

  return (
    <div className="dos-container">
      {/* 로딩 오버레이 */}
      {isLoadingFolder && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          backdropFilter: 'blur(4px)',
        }}>
          <DosPanel style={{
            width: '375px',
            padding: '12px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)',
          }}>
            {/* 타이틀 */}
            <div style={{
              textAlign: 'center',
              borderBottom: '1px solid var(--color-silver)',
              paddingBottom: '6px',
              marginBottom: '12px',
            }}>
              <div style={{
                color: 'var(--color-yellow)',
                fontSize: '16px',
                marginBottom: '2px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px', justifyContent: 'center' }}>
                  <img src="/images/folder.png" alt="folder" width="16" height="16" style={{ display: 'block' }} />
                  음악 파일 로딩 중
                </div>
              </div>
              <div style={{
                color: 'var(--color-white)',
                fontSize: '16px',
                textTransform: 'uppercase'
              }}>
                /{userFolderName || '폴더'}
              </div>
            </div>

            {/* 로딩 상태 */}
            <div style={{ marginBottom: '12px' }}>
              <div style={{
                color: 'var(--color-cyan)',
                fontSize: '16px',
                textAlign: 'center',
              }}>
                파일 로딩 중... {loadedFileCount} / {totalFilesToLoad}
              </div>
            </div>

            {/* 현재 로딩 중인 파일 */}
            <div style={{
              width: '100%',
              height: '26px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderTop: '2px solid var(--border-dark)',
              borderLeft: '2px solid var(--border-dark)',
              borderBottom: '2px solid var(--border-highlight)',
              borderRight: '2px solid var(--border-highlight)',
              backgroundColor: 'var(--color-gray)',
              padding: '4px 8px',
              boxSizing: 'border-box',
            }}>
              <div style={{
                color: 'var(--color-yellow)',
                textAlign: 'center',
                fontSize: '16px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                width: '100%',
              }}>
                {currentLoadingFile ? `> ${currentLoadingFile}` : ''}
              </div>
            </div>
          </DosPanel>

          {/* CSS 애니메이션 */}
          <style>{`
            @keyframes fade-in {
              0% {
                opacity: 0;
              }
              100% {
                opacity: 1;
              }
            }
          `}</style>
        </div>
      )}

      {/* 타이틀 바 */}
      <div className="dos-title-bar">
        <a href="https://cafe.naver.com/olddos" target="_blank" rel="noopener noreferrer" className="dos-link">
          도스박물관
        </a>
        {" "}IMS/ROL 웹플레이어 v{version}
      </div>

      {/* 메인 그리드 */}
      <div className="dos-grid dos-grid-2col">
        {/* 좌측: 파일 선택 및 컨트롤 */}
        <div>
          {/* 폴더 선택 및 재생 컨트롤 */}
          <DosPanel>
            <input
              ref={(ref) => {
                if (ref) (window as any).__folderInput = ref;
              }}
              type="file"
              /* @ts-ignore - webkitdirectory is not in standard types */
              webkitdirectory=""
              multiple
              onChange={handleFolderSelect}
              style={{ display: 'none' }}
            />
            {/* 폴더 드래그 영역 */}
            <div className="flex gap-8 align-center" style={{ marginBottom: '5px' }}>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => (window as any).__folderInput?.click()}
                style={{
                  flex: 1,
                  height: '28px',
                  borderTop: isDragging ? '2px solid var(--color-yellow)' : '2px solid var(--border-highlight)',
                  borderLeft: isDragging ? '2px solid var(--color-yellow)' : '2px solid var(--border-highlight)',
                  borderBottom: isDragging ? '2px solid var(--color-yellow)' : '2px solid var(--border-dark)',
                  borderRight: isDragging ? '2px solid var(--color-yellow)' : '2px solid var(--border-dark)',
                  backgroundColor: isDragging ? 'var(--bg-select)' : 'var(--bg-main)',
                  padding: '2px 8px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxSizing: 'border-box',
                }}
              >
                <span style={{
                  color: isDragging ? 'var(--color-yellow)' : 'var(--text-main)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                  justifyContent: 'center'
                }}>
                  <img src="/images/folder.png" alt="folder" width="16" height="16" style={{ display: 'block' }} />
                  {isDragging
                    ? '여기에 폴더를 놓으세요'
                    : userFolderName
                      ? <span style={{ textTransform: 'uppercase' }}>{userFolderName}</span>
                      : '폴더를 드래그하거나 클릭하여 선택'}
                </span>
              </div>
            </div>

            {/* 재생 컨트롤 */}
            <div className="flex gap-8">
              {/* 플레이 컨트롤 버튼 그룹 */}
              <div className="flex" style={{ gap: '2px', flex: 1 }}>
                {/* 이전 곡 */}
                <DosButton
                  onClick={playPreviousTrack}
                  disabled={!state?.isPlaying}
                  style={{
                    flex: 1,
                    height: '28px',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <SkipBack size={16} />
                </DosButton>

                {/* 재생 */}
                <DosButton
                  onClick={() => {
                    forceReloadRef.current = true;
                    loadTrack(selectedTrackIndex, undefined, undefined, undefined, true);
                  }}
                  disabled={isLoadingTrack || musicList.length === 0}
                  style={{
                    flex: 1,
                    height: '28px',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <Play size={16} />
                </DosButton>

                {/* 정지 */}
                <DosButton
                  onClick={stop}
                  disabled={!state?.isPlaying}
                  style={{
                    flex: 1,
                    height: '28px',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <Square size={16} />
                </DosButton>

                {/* 다음 곡 */}
                <DosButton
                  onClick={playNextTrack}
                  disabled={!state?.isPlaying}
                  style={{
                    flex: 1,
                    height: '28px',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <SkipForward size={16} />
                </DosButton>
              </div>

              {/* 반복 모드 */}
              <div className="flex" style={{ gap: '2px', margin: 0 }}>
                <DosButton
                  onClick={() => setRepeatMode('all')}
                  active={repeatMode === 'all'}
                  style={{
                    width: '28px',
                    height: '28px',
                    padding: '2px',
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderTop: repeatMode === 'all' ? '2px solid var(--border-dark)' : '2px solid var(--border-highlight)',
                    borderLeft: repeatMode === 'all' ? '2px solid var(--border-dark)' : '2px solid var(--border-highlight)',
                    borderBottom: repeatMode === 'all' ? '2px solid var(--border-highlight)' : '2px solid var(--border-dark)',
                    borderRight: repeatMode === 'all' ? '2px solid var(--border-highlight)' : '2px solid var(--border-dark)',
                    backgroundColor: repeatMode === 'all' ? 'var(--color-lime)' : 'var(--bg-main)',
                    color: repeatMode === 'all' ? 'var(--color-black)' : 'var(--text-main)'
                  }}
                >
                  <Repeat size={12} />
                </DosButton>
                <DosButton
                  onClick={() => setRepeatMode('one')}
                  active={repeatMode === 'one'}
                  style={{
                    width: '28px',
                    height: '28px',
                    padding: '2px',
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderTop: repeatMode === 'one' ? '2px solid var(--border-dark)' : '2px solid var(--border-highlight)',
                    borderLeft: repeatMode === 'one' ? '2px solid var(--border-dark)' : '2px solid var(--border-highlight)',
                    borderBottom: repeatMode === 'one' ? '2px solid var(--border-highlight)' : '2px solid var(--border-dark)',
                    borderRight: repeatMode === 'one' ? '2px solid var(--border-highlight)' : '2px solid var(--border-dark)',
                    backgroundColor: repeatMode === 'one' ? 'var(--color-lime)' : 'var(--bg-main)',
                    color: repeatMode === 'one' ? 'var(--color-black)' : 'var(--text-main)'
                  }}
                >
                  <Repeat1 size={12} />
                </DosButton>
                <DosButton
                  onClick={() => setRepeatMode('shuffle')}
                  active={repeatMode === 'shuffle'}
                  style={{
                    width: '28px',
                    height: '28px',
                    padding: '2px',
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderTop: repeatMode === 'shuffle' ? '2px solid var(--border-dark)' : '2px solid var(--border-highlight)',
                    borderLeft: repeatMode === 'shuffle' ? '2px solid var(--border-dark)' : '2px solid var(--border-highlight)',
                    borderBottom: repeatMode === 'shuffle' ? '2px solid var(--border-highlight)' : '2px solid var(--border-dark)',
                    borderRight: repeatMode === 'shuffle' ? '2px solid var(--border-highlight)' : '2px solid var(--border-dark)',
                    backgroundColor: repeatMode === 'shuffle' ? 'var(--color-lime)' : 'var(--bg-main)',
                    color: repeatMode === 'shuffle' ? 'var(--color-black)' : 'var(--text-main)'
                  }}
                >
                  <Shuffle size={12} />
                </DosButton>
              </div>
            </div>
          </DosPanel>

          {/* 음악 리스트 */}
          <DosPanel title={folderTitle} className="flex-1">
            <DosList
              items={listItems}
              selectedKey={selectedKey}
              scrollToIndex={playingTrackIndex}
              autoScroll={shouldAutoScroll}
              onSelect={handleListSelect}
            />
          </DosPanel>

          {/* 재생 설정 */}
          <DosPanel style={{ height: '140px', flexShrink: 0 }}>
            {/* 진행률 */}
            <div className="mb-16">
              <div className="dos-progress-bar">
                <div className="dos-progress-fill" style={{ width: `${progress}%` }} />
                <div className="dos-progress-text">
                  BPM: {state?.currentTempo ? Math.floor(state.currentTempo) : '--'}
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
                showReset={true}
                onReset={() => setVolume(100)}
                disabled={format === "VGM"}
              />
              <DosSlider
                label="템포"
                value={state?.tempo ?? 100}
                min={25}
                max={400}
                onChange={setTempo}
                unit="%"
                showReset={true}
                onReset={() => setTempo(100)}
                disabled={format === "VGM"}
              />
              <DosSlider
                label="마스터 볼륨"
                value={masterVolume}
                min={0}
                max={100}
                onChange={(vol) => {
                  setMasterVolumeState(vol);
                  setMasterVolume(vol / 100);
                }}
                unit="%"
                showReset={true}
                onReset={() => {
                  setMasterVolumeState(50);
                  setMasterVolume(0.5);
                }}
              />
            </div>
          </DosPanel>

          {/* 에러 메시지 */}
          {error && (
            <div className="dos-message dos-message-error">
              오류: {error}
            </div>
          )}

          {!format && currentMusicFile && (
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
          />

          {/* 가사 / 크레딧 */}
          <DosPanel className="dos-panel-credits" style={{ height: '140px', flexShrink: 0 }}>
            <LyricsDisplay
              issData={currentIssData}
              currentTick={state?.currentTick ?? 0}
              isPlaying={state?.isPlaying ?? false}
            />
          </DosPanel>
        </div>
      </div>

      {/* 피아노 건반 시각화 */}
      <PianoRoll activeNotes={state?.activeNotes} />

      {/* 스테이터스 바 */}
      <div className="dos-status-bar">
        <div className="dos-status-item">
          {state ? (
            state.isPlaying
              ? format === "VGM"
                ? `재생중 - ${currentMusicFile?.name || '?'}`
                : `재생중 - ${currentTrackTitle} (${currentMusicFile?.name || '?'}${currentBnkFile?.name ? ', ' + currentBnkFile.name : ''})`
              : state.isPaused
                ? "일시정지"
                : "정지"
          ) : "대기"}
        </div>
      </div>

      {/* Media Session API용 Audio 요소 (srcObject로 MediaStream 연결) */}
      <audio
        ref={audioElementRef}
        style={{ display: 'none' }}
        playsInline
      />
    </div>
  );
}
