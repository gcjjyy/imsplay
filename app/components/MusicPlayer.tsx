/**
 * MusicPlayer.tsx - 통합 음악 플레이어 UI 컴포넌트
 *
 * Impulse Tracker 스타일 DOS UI
 */

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useFetcher } from "react-router";
import { useAdPlugPlayer } from "~/lib/hooks/useAdPlugPlayer";
import { useLibOpenMPTPlayer } from "~/lib/hooks/useLibOpenMPTPlayer";
import { getPlayerType, getAllSupportedExtensions, type PlayerType } from "~/lib/format-detection";
// ═══════════════════════════════════════════════════════════════
// [MEDIA SESSION API - 비활성화됨]
// 나중에 재활성화하려면 이 섹션의 주석을 제거하세요
// ═══════════════════════════════════════════════════════════════
// import { generateSilentAudioDataURL } from "~/lib/utils/silent-audio";
// ═══════════════════════════════════════════════════════════════
import SpectrumVisualizer from "./SpectrumVisualizer";
import DosPanel from "~/components/dos-ui/DosPanel";
import DosButton from "~/components/dos-ui/DosButton";
import DosList from "~/components/dos-ui/DosList";
import DosSlider from "~/components/dos-ui/DosSlider";
import LyricsDisplay from "./LyricsDisplay";
import type { ISSData } from "~/routes/api/parse-iss";
import { Repeat1, Repeat, Play, Square, SkipBack, SkipForward, Shuffle, HelpCircle, X } from "lucide-react";
import { version } from "../../package.json";

type MusicFormat = string | null;
type RepeatMode = 'all' | 'one' | 'shuffle';

// 샘플 음악 목록
export interface MusicSample {
  musicFile: string;
  format: string;
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
  { musicFile: "/Beat of The Terror.vgm", format: "VGM" },
  { musicFile: "/Feena.vgm", format: "VGM" },
  { musicFile: "/Final Battle.vgm", format: "VGM" },
  { musicFile: "/First Step Toward Wars.vgm", format: "VGM" },
  { musicFile: "/Fountain of Love.vgm", format: "VGM" },
  { musicFile: "/Game Over.vgm", format: "VGM" },
  { musicFile: "/Gomenne, Iikoja Irarenai.vgm", format: "VGM" },
  { musicFile: "/Holders of Power.vgm", format: "VGM" },
  { musicFile: "/Palace of Destruction.vgm", format: "VGM" },
  { musicFile: "/Palace.vgm", format: "VGM" },
  { musicFile: "/Rest In Peace.vgm", format: "VGM" },
  { musicFile: "/Tears of Sylph.vgm", format: "VGM" },
  { musicFile: "/The Last Moment of the Dark.vgm", format: "VGM" },
  { musicFile: "/The Morning Grow.vgm", format: "VGM" },
  { musicFile: "/The Syonin.vgm", format: "VGM" },
  { musicFile: "/Tower of the Shadow of Death.vgm", format: "VGM" },
  { musicFile: "/Treasure Box.vgm", format: "VGM" },
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

  // Tracker 샘플 - Demoscene Classics (libopenmpt)
  { musicFile: "/skyrider.s3m", format: "S3M", title: "Purple Motion - Skyrider" },
  { musicFile: "/satellite_one.s3m", format: "S3M", title: "Purple Motion - Satellite One" },
  { musicFile: "/unreal2.s3m", format: "S3M", title: "Purple Motion - Unreal II (Second Reality)" },
  { musicFile: "/celestial_fantasia.s3m", format: "S3M", title: "BeaT / Osmosys - Celestial Fantasia" },
  { musicFile: "/dead_lock.xm", format: "XM", title: "Elwood - Dead Lock" },
  { musicFile: "/space_debris.mod", format: "MOD", title: "Captain / Image - Space Debris" },
  { musicFile: "/unreal_superhero3.xm", format: "XM", title: "Rez & Kenet - Unreal Superhero 3" },
  { musicFile: "/point_of_departure.s3m", format: "S3M", title: "Necros - Point of Departure" },
  { musicFile: "/astraying_voyages.s3m", format: "S3M", title: "Purple Motion - Astraying Voyages" },
  { musicFile: "/crystal_dream.s3m", format: "S3M", title: "Triton - Crystal Dream II" },
  { musicFile: "/axel_f.mod", format: "MOD", title: "Audiomonster - Axel F (Remix)" },
  { musicFile: "/path_to_nowhere.xm", format: "XM", title: "Anvil - Path to Nowhere" },
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
      // 먼저 파일 존재 여부 확인 (404 콘솔 로그 방지)
      const relativePath = issFile.replace(/^\/+/, '');
      if (!(await checkFileExists(relativePath))) {
        return null;
      }

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
      return null;
    }

    const data = await response.json();
    return data as ISSData;
  } catch {
    return null;
  }
}

/**
 * 서버에서 파일 존재 여부 확인 (404 콘솔 로그 방지)
 */
async function checkFileExists(filePath: string): Promise<boolean> {
  try {
    // 앞의 '/' 제거
    const cleanPath = filePath.replace(/^\/+/, '');
    const response = await fetch(`/api/check-file?path=${encodeURIComponent(cleanPath)}`);
    if (response.ok) {
      const data = await response.json();
      return data.exists === true;
    }
  } catch {
    // 무시
  }
  return false;
}

/**
 * 샘플 음악의 BNK 파일 경로를 찾습니다 (public 폴더 내 검색)
 */
async function findMatchingBnkFile(musicFilePath: string): Promise<string> {
  const basePath = musicFilePath.substring(0, musicFilePath.lastIndexOf('.'));
  const matchingBnkPath = `${basePath}.BNK`;

  // 앞의 '/' 제거하여 상대 경로로 확인
  const relativePath = matchingBnkPath.replace(/^\/+/, '');
  if (await checkFileExists(relativePath)) {
    return matchingBnkPath;
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
  const baseName = musicFile.name.replace(/\.[^.]+$/, '').toLowerCase();

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
  const [masterVolume, setMasterVolumeState] = useState<number>(100);
  const [shouldAutoScroll, setShouldAutoScroll] = useState<boolean>(false);

  // UI 갱신 애니메이션 ref (requestAnimationFrame 기반)
  const animationIdRef = useRef<number>(0);

  // 드래그 앤 드롭 상태
  const [isDragging, setIsDragging] = useState(false);

  // 지원 포맷 다이얼로그 상태
  const [isFormatDialogOpen, setIsFormatDialogOpen] = useState(false);

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
    if (!ext) return null;
    const allExtensions = getAllSupportedExtensions();
    if (allExtensions.includes(`.${ext}`)) return ext.toUpperCase();
    return null;
  }, [currentMusicFile]);

  // 플레이어 타입 결정 (libopenmpt vs AdPlug)
  const playerType: PlayerType = useMemo(() => {
    if (!currentMusicFile) return null;
    return getPlayerType(currentMusicFile.name);
  }, [currentMusicFile]);

  // 트랙 종료 콜백 (백그라운드에서도 작동)
  const handleTrackEnd = useCallback(() => {
    playNextTrackRef.current?.();
  }, []);

  // AdPlug 플레이어 (IMS, ROL, VGM 및 AdLib 전용 포맷)
  const adplugPlayer = useAdPlugPlayer({
    musicFile: playerType === 'adplug' ? currentMusicFile : null,
    bnkFile: playerType === 'adplug' ? currentBnkFile : null,
    fileLoadKey,
    forceReloadRef,
    onTrackEnd: handleTrackEnd,
    sharedAudioContextRef,
    audioElementRef,
  });

  // libopenmpt 플레이어 (MOD, XM, IT, S3M 등 트래커 포맷)
  const libopenmptPlayer = useLibOpenMPTPlayer({
    musicFile: playerType === 'libopenmpt' ? currentMusicFile : null,
    fileLoadKey,
    forceReloadRef,
    onTrackEnd: handleTrackEnd,
    sharedAudioContextRef,
    audioElementRef,
  });

  // 활성 플레이어 선택 (통합 인터페이스)
  const player = playerType === 'libopenmpt' ? libopenmptPlayer : adplugPlayer;

  const { state, error, isPlayerReady, analyserNode, play, pause, stop, setMasterVolume, checkPlayerReady, refreshState, hardReset } = player;

  // Format-aware ready state (단일 플레이어 사용으로 간소화)
  const isCurrentPlayerReady = useMemo(() => {
    if (!format || !currentMusicFile) return false;
    return isPlayerReady && state?.fileName === currentMusicFile.name;
  }, [format, currentMusicFile, isPlayerReady, state?.fileName]);

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
      // 지원 확장자 패턴 생성 (AdPlug + libopenmpt)
      const supportedExtensions = getAllSupportedExtensions();
      const supportedExtPattern = new RegExp(
        `\\.(${supportedExtensions.map(e => e.slice(1)).join('|')})$`,
        'i'
      );

      // 파일 분류 (대소문자 구별 없이)
      const musicFiles = files.filter(f => supportedExtPattern.test(f.name));
      const bnkFiles = files.filter(f => /\.bnk$/i.test(f.name));
      const issFiles = files.filter(f => /\.iss$/i.test(f.name));

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

      // 모든 음악 파일을 배치로 처리
      for (let i = 0; i < musicFiles.length; i += BATCH_SIZE) {
        const batch = musicFiles.slice(i, i + BATCH_SIZE);

        // 배치에서 IMS 파일 분리 (한글 제목 추출을 위해 API 호출 필요)
        const batchImsFiles = batch.filter(f => /\.ims$/i.test(f.name));
        const batchOtherFiles = batch.filter(f => !/\.ims$/i.test(f.name));

        // IMS 외 파일은 확장자를 제거한 파일명을 제목으로 사용
        batchOtherFiles.forEach(file => {
          const ext = file.name.lastIndexOf('.');
          const title = ext > 0 ? file.name.substring(0, ext) : file.name;
          titlesMap.set(file.name, title);
        });

        // IMS 파일이 있으면 API 호출 (한글 제목 추출)
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
    // 현재 재생 중이면 완전 리셋 (버퍼 클리어, 시간 리셋 등)
    if (state?.isPlaying) {
      await hardReset();
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
  }, [isUserFolder, userMusicFiles, userBnkFiles, musicSamples, state?.isPlaying, hardReset]);

  /**
   * titleMap을 사용하여 샘플 목록에 제목 추가
   */
  useEffect(() => {
    const trackerFormats = ['MOD', 'S3M', 'XM', 'IT'];
    const samplesWithTitles = MUSIC_SAMPLES.map((sample) => {
      const fileName = sample.musicFile.slice(1);

      if (sample.format === 'IMS') {
        // IMS: titleMap에서 Johab 변환된 제목 사용
        const title = titleMap[fileName] || fileName.replace('.IMS', '');
        return { ...sample, title };
      } else if (trackerFormats.includes(sample.format)) {
        // Tracker 포맷: 이미 제목이 있으면 사용, 없으면 titleMap에서 가져오기
        if (sample.title) {
          return sample;
        }
        const title = titleMap[fileName] || fileName;
        return { ...sample, title };
      } else {
        // VGM, ROL 등 기타 포맷
        const ext = `.${sample.format}`;
        const title = fileName.replace(new RegExp(`${ext}$`, 'i'), '');
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
    player.setLoopEnabled(shouldLoop);
  }, [repeatMode, format, currentMusicFile, player]);

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

  // Media Session API용 함수 refs (핸들러 재등록 방지)
  const playRef = useRef(play);
  const pauseRef = useRef(pause);
  const stopRef = useRef(stop);
  const playPreviousTrackRef = useRef(playPreviousTrack);
  const playNextTrackRefForMedia = useRef(playNextTrack);

  // refs 업데이트
  useEffect(() => {
    playRef.current = play;
    pauseRef.current = pause;
    stopRef.current = stop;
    playPreviousTrackRef.current = playPreviousTrack;
    playNextTrackRefForMedia.current = playNextTrack;
  }, [play, pause, stop, playPreviousTrack, playNextTrack]);

  /**
   * Media Session API - 액션 핸들러 등록
   * 재생 상태가 변경될 때마다 핸들러를 재등록하여 브라우저 세션 복원 시에도 동작하도록 함
   */
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const registerHandlers = () => {
      navigator.mediaSession.setActionHandler("play", () => playRef.current?.());
      navigator.mediaSession.setActionHandler("pause", () => pauseRef.current?.());
      navigator.mediaSession.setActionHandler("previoustrack", () => playPreviousTrackRef.current?.());
      navigator.mediaSession.setActionHandler("nexttrack", () => playNextTrackRefForMedia.current?.());
      navigator.mediaSession.setActionHandler("stop", () => stopRef.current?.());
    };

    // 핸들러 등록
    registerHandlers();

    return () => {
      if ("mediaSession" in navigator) {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("previoustrack", null);
        navigator.mediaSession.setActionHandler("nexttrack", null);
        navigator.mediaSession.setActionHandler("stop", null);
      }
    };
  }, [state?.isPlaying]); // 재생 상태 변경 시 재등록

  /**
   * Media Session API - 재생 상태 업데이트
   * 음악 파일이 로드되어 있으면 "paused" 상태로 설정하여 이전/다음 버튼 활성화
   */
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    if (state?.isPlaying) {
      navigator.mediaSession.playbackState = "playing";
    } else if (state?.isPaused || currentMusicFile) {
      // 일시정지 상태이거나 음악 파일이 로드되어 있으면 paused로 설정
      navigator.mediaSession.playbackState = "paused";
    } else {
      navigator.mediaSession.playbackState = "none";
    }
  }, [state?.isPlaying, state?.isPaused, currentMusicFile]);

  /**
   * Media Session API - 메타데이터 업데이트 (트랙 변경 시에만)
   */
  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentMusicFile) return;

    const title = isUserFolder
      ? userMusicFileTitles.get(currentMusicFile.name) || currentMusicFile.name.replace(/\.[^.]+$/, '')
      : musicSamples[playingTrackIndex]?.title || currentMusicFile.name.replace(/\.[^.]+$/, '');

    const artist = format ? `${format} Music` : "AdLib Music";
    const album = isUserFolder ? userFolderName : "Sample Music";

    navigator.mediaSession.metadata = new MediaMetadata({
      title: title,
      artist: artist,
      album: album,
    });
  }, [currentMusicFile, isUserFolder, userMusicFileTitles, musicSamples, playingTrackIndex, format, userFolderName]);

  // 위치 업데이트 throttle을 위한 ref
  const lastPositionUpdateRef = useRef<number>(0);

  /**
   * Media Session API - 위치 업데이트 (1초 throttle)
   */
  useEffect(() => {
    if (!("mediaSession" in navigator) || !state || state.totalSize <= 0) return;

    const now = Date.now();
    if (now - lastPositionUpdateRef.current < 1000) return; // 1초 throttle

    lastPositionUpdateRef.current = now;

    try {
      navigator.mediaSession.setPositionState({
        duration: state.totalSize / 1000,
        position: state.currentByte / 1000,
        playbackRate: 1.0,
      });
    } catch {
      // setPositionState not supported in some browsers
    }
  }, [state?.currentByte, state?.totalSize]);

  /**
   * UI 갱신 루프 (requestAnimationFrame 기반, ~30fps)
   * - 플레이어 상태 갱신 (재생 위치, 틱 등)
   */
  useEffect(() => {
    let lastTime = 0;
    const targetInterval = 1000 / 30; // 30fps 목표

    const animate = (timestamp: number) => {
      if (timestamp - lastTime >= targetInterval) {
        refreshState();
        lastTime = timestamp;
      }
      animationIdRef.current = requestAnimationFrame(animate);
    };

    animationIdRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationIdRef.current);
    };
  }, [refreshState]);

  // progress bar
  const progress = state ? (state.currentByte / state.totalSize) * 100 : 0;

  // 밀리초를 MM:SS 형식으로 변환
  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // 포맷 뱃지 스타일 (모든 포맷 통일)
  const getFormatBadgeClass = () => 'dos-badge-ims';

  // 음악 리스트 아이템 생성
  const listItems = useMemo(() => {
    if (isUserFolder) {
      // 사용자 폴더 모드
      return userMusicFiles.map((file, index) => {
        const ext = file.name.toLowerCase().split('.').pop();
        const format = ext?.toUpperCase() || 'OPL';
        const title = userMusicFileTitles.get(file.name) || file.name.substring(0, file.name.lastIndexOf('.'));

        return {
          key: `${index}-${file.name}`,
          content: (
            <div className="flex gap-8 align-center w-full" style={{ overflow: 'hidden' }}>
              <span className={`dos-badge ${getFormatBadgeClass()}`} style={{ flexShrink: 0 }}>
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
            <span className={`dos-badge ${getFormatBadgeClass()}`} style={{ flexShrink: 0 }}>
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
      return userMusicFileTitles.get(file.name) || file.name.replace(/\.[^.]+$/, '');
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

      {/* 지원 포맷 다이얼로그 */}
      {isFormatDialogOpen && (
        <>
          {/* 전체 화면 dimming */}
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              zIndex: 9998,
            }}
            onClick={() => setIsFormatDialogOpen(false)}
          />
          {/* 다이얼로그 (앱 컨테이너 기준 중앙) */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              pointerEvents: 'none',
            }}
          >
            <div onClick={(e: React.MouseEvent) => e.stopPropagation()} style={{ pointerEvents: 'auto' }}>
          <DosPanel
            title={
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <span>지원 포맷</span>
                <button
                  onClick={() => setIsFormatDialogOpen(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-main)',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'flex',
                  }}
                >
                  <X size={16} />
                </button>
              </span>
            }
            style={{
              width: '580px',
              maxWidth: '90vw',
              maxHeight: '60vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)',
            }}
          >
            {/* 포맷 목록 - 스크롤 영역 */}
            <div className="dos-list" style={{ flex: 1, minHeight: 0 }}>
              <div className="dos-list-scroll" style={{ lineHeight: '1.6', padding: '8px' }}>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>A2M</span> - subz3ro의 AdLib Tracker 2 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>ADL</span> - Westwood ADL 파일 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>AGD</span> - Remi Herbulot의 Herbulot AdLib Gold System (HERAD)</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>AMD</span> - Elyssis의 AMUSIC Adlib Tracker 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>BAM</span> - Bob's Adlib Music 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>BMF</span> - The Brain의 Easy AdLib 1.0 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>CFF</span> - CUD의 BoomTracker 4.0 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>CMF</span> - Creative Technology의 Creative Music 파일 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>D00</span> - Vibrants의 EdLib 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>DFM</span> - R.Verhaag의 Digital-FM 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>DMO</span> - TwinTeam의 Twin TrackPlayer 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>DRO</span> - DOSBox Raw OPL 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>DTM</span> - DeFy의 DeFy Adlib Tracker 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>GOT</span> - Adept Software Roy Davis의 God Of Thunder Music 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>HA2</span> - Remi Herbulot의 Herbulot AdLib System v2 (HERAD)</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>HSC</span> - Hannes Seifert의 HSC Adlib Composer / Electronic Rats의 HSC-Tracker</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>HSP</span> - Number Six / Aegis Corp.의 HSC Packed 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>HSQ</span> - Remi Herbulot의 Herbulot AdLib System (HERAD)</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>IMF</span> - Apogee IMF 파일 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>IMS</span> - IMPlay Song 포맷 (한국 도스 음악)</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>JBM</span> - JBM Adlib Music 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>KSM</span> - Ken Silverman의 Music 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>LAA</span> - LucasArts의 AdLib Audio 파일 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>LDS</span> - LOUDNESS Sound System 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>M</span> - Origin AdLib Music 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>MAD</span> - Mlat Adlib Tracker 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>MDI</span> - Ad Lib Inc.의 AdLib MIDIPlay 파일 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>MID</span> - MIDI 오디오 파일 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>MKJ</span> - M \ K Productions의 MKJamz 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>MSC</span> - AdLib MSCplay 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>MTK</span> - SuBZeR0의 MPU-401 Trakker 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>MUS</span> - Ad Lib Inc.의 AdLib MIDI Music 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>PLX</span> - PALLADIX Sound System 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>RAD</span> - Reality의 Reality ADlib Tracker 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>RAW</span> - RDOS의 RdosPlay RAW 파일 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>RIX</span> - Softstar RIX OPL Music 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>ROL</span> - AdLib Inc.의 AdLib Visual Composer 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>S3M</span> - Future Crew의 Screamtracker 3 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>SA2</span> - Surprise! Productions의 Surprise! Adlib Tracker 2 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>SAT</span> - Surprise! Productions의 Surprise! Adlib Tracker 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>SCI</span> - Sierra의 AdLib Audio 파일 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>SDB</span> - Remi Herbulot의 Herbulot AdLib System (HERAD)</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>SNG</span> - SNGPlay / Faust Music Creator / Adlib Tracker 1.0 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>SOP</span> - 이호범(sopepos)의 Note Sequencer 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>SQX</span> - Remi Herbulot의 Herbulot AdLib System (HERAD)</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>VGM</span> - Valley Bell의 Video Game Music 1.51 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>XAD</span> - Riven the Mage의 eXotic ADlib 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>XMS</span> - MaDoKaN/E.S.G의 XMS-Tracker 포맷</div>
                <div><span style={{ color: '#2563eb', fontWeight: 'bold' }}>XSM</span> - Davey W Taylor의 eXtra Simple Music 포맷</div>
              </div>
            </div>

            {/* 하단 여백 */}
            <div style={{ marginTop: '8px' }} />
          </DosPanel>
            </div>
          </div>
        </>
      )}

      {/* 타이틀 바 */}
      <div className="dos-title-bar">
        <a href="https://cafe.naver.com/olddos" target="_blank" rel="noopener noreferrer" className="dos-link">
          도스박물관
        </a>
        {" "}IMS Player v{version}
      </div>

      {/* 메인 그리드 */}
      <div className="dos-grid dos-grid-2col" style={{ flex: 1, minHeight: 0 }}>
        {/* 좌측: 파일 선택 및 컨트롤 */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
                    backgroundColor: repeatMode === 'all' ? 'var(--toggle-active-bg)' : 'var(--bg-main)',
                    color: repeatMode === 'all' ? 'var(--toggle-active-text)' : 'var(--text-main)'
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
                    backgroundColor: repeatMode === 'one' ? 'var(--toggle-active-bg)' : 'var(--bg-main)',
                    color: repeatMode === 'one' ? 'var(--toggle-active-text)' : 'var(--text-main)'
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
                    backgroundColor: repeatMode === 'shuffle' ? 'var(--toggle-active-bg)' : 'var(--bg-main)',
                    color: repeatMode === 'shuffle' ? 'var(--toggle-active-text)' : 'var(--text-main)'
                  }}
                >
                  <Shuffle size={12} />
                </DosButton>
              </div>
            </div>
          </DosPanel>

          {/* 스펙트럼 시각화 */}
          <SpectrumVisualizer analyserNode={analyserNode} />

          {/* 재생 진행률 및 볼륨 */}
          <DosPanel style={{ flexShrink: 0 }}>
            <div className="dos-progress-bar" style={{ marginBottom: '8px' }}>
              <div className="dos-progress-fill" style={{ width: `${progress}%` }} />
              <div className="dos-progress-text">
                {state ? `${formatTime(state.currentByte)} / ${formatTime(state.totalSize)}` : '--:-- / --:--'}
              </div>
            </div>
            <DosSlider
              label="볼륨"
              value={masterVolume}
              min={0}
              max={200}
              onChange={(vol) => {
                setMasterVolumeState(vol);
                setMasterVolume(vol);
              }}
              unit="%"
            />
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

        {/* 우측: 음악 리스트 */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <DosPanel title={
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <span>{folderTitle}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsFormatDialogOpen(true);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-cyan)',
                  cursor: 'pointer',
                  padding: '0 4px',
                  display: 'flex',
                  alignItems: 'center',
                }}
                title="지원 포맷 보기"
              >
                <HelpCircle size={14} />
              </button>
            </span>
          } className="flex-1">
            <DosList
              items={listItems}
              selectedKey={selectedKey}
              scrollToIndex={playingTrackIndex}
              autoScroll={shouldAutoScroll}
              onSelect={handleListSelect}
            />
          </DosPanel>
        </div>
      </div>

      {/* 가사 / 크레딧 */}
      <DosPanel className="dos-panel-credits" style={{ height: '140px' }}>
        <LyricsDisplay
          issData={currentIssData}
          currentTick={state?.currentTick ?? 0}
          isPlaying={state?.isPlaying ?? false}
        />
      </DosPanel>

      {/* 스테이터스 바 */}
      <div className="dos-status-bar">
        <div className="dos-status-item">
          {state ? (
            state.isPlaying
              ? format === "VGM" || format === "VGZ"
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
