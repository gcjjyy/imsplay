/**
 * useROLPlayer.ts - ROL 플레이어 React 훅
 *
 * Web Audio API와 ROLPlayer를 연결하는 React 훅
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { RefObject } from "react";
import { ROLPlayer } from "../rol/rol-player";
import { OPLEngine } from "../rol/opl-engine";
import { parseROL } from "../rol/rol-parser";
import type { PlaybackState } from "../rol/types";

interface UseROLPlayerOptions {
  rolFile: File | null;
  bnkFile: File | null;
  fileLoadKey?: number;
  forceReloadRef?: RefObject<boolean>;
  onTrackEnd?: () => void;
  // 공유 AudioContext (IMS/ROL 플레이어 간 공유 - Safari autoplay 정책 준수)
  sharedAudioContextRef?: RefObject<AudioContext | null>;
  // ═══════════════════════════════════════════════════════════════
  // [MEDIA SESSION API - 비활성화됨]
  // 나중에 재활성화하려면 이 섹션의 주석을 제거하세요
  // ═══════════════════════════════════════════════════════════════
  // silentAudioRef?: RefObject<HTMLAudioElement | null>;
  // ═══════════════════════════════════════════════════════════════
}

interface UseROLPlayerReturn {
  // 상태
  state: PlaybackState | null;
  isLoading: boolean;
  error: string | null;
  isPlayerReady: boolean;

  // 재생 제어
  play: () => void;
  pause: () => void;
  stop: () => void;

  // 설정 제어
  setVolume: (volume: number) => void;
  setTempo: (tempo: number) => void;
  setMasterVolume: (volume: number) => void;
  setKeyTranspose: (key: number) => void;
  setChannelVolume: (channel: number, volume: number) => void;
  setLoopEnabled: (enabled: boolean) => void;

  // playerRef 직접 확인 (stale state 회피)
  checkPlayerReady: () => boolean;
}

/**
 * ROL 플레이어 React 훅
 */
export function useROLPlayer({
  rolFile,
  bnkFile,
  fileLoadKey,
  forceReloadRef,
  onTrackEnd,
  sharedAudioContextRef,
  // ═══════════════════════════════════════════════════════════════
  // [MEDIA SESSION API - 비활성화됨]
  // 나중에 재활성화하려면 이 섹션의 주석을 제거하세요
  // ═══════════════════════════════════════════════════════════════
  // silentAudioRef,
  // ═══════════════════════════════════════════════════════════════
}: UseROLPlayerOptions): UseROLPlayerReturn {
  const [state, setState] = useState<PlaybackState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlayerReady, setIsPlayerReady] = useState(false);

  const playerRef = useRef<ROLPlayer | null>(null);
  const localAudioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // AudioContext 접근 헬퍼 (공유 ref 우선, 없으면 로컬 ref 사용)
  const getAudioContext = useCallback(() => {
    return sharedAudioContextRef?.current ?? localAudioContextRef.current;
  }, [sharedAudioContextRef]);

  const setAudioContext = useCallback((ctx: AudioContext | null) => {
    if (sharedAudioContextRef) {
      (sharedAudioContextRef as React.MutableRefObject<AudioContext | null>).current = ctx;
    } else {
      localAudioContextRef.current = ctx;
    }
  }, [sharedAudioContextRef]);
  const gainNodeRef = useRef<GainNode | null>(null);
  const uiUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fileNameRef = useRef<string>("");

  // 생성해야 할 샘플 수 (예제와 같은 방식)
  const lenGenRef = useRef<number>(0);
  const lastTickTimeRef = useRef<number>(0);

  // 백그라운드 진입 전 재생 상태 저장
  const wasPlayingBeforeBackgroundRef = useRef<boolean>(false);

  // 백그라운드 복귀 플래그
  const needsAudioRecoveryRef = useRef<boolean>(false);

  // 트랙 종료 콜백 중복 호출 방지
  const trackEndCallbackFiredRef = useRef<boolean>(false);

  // 1곡 반복 모드 상태 (ref로 관리하여 onaudioprocess에서 최신 값 접근)
  const loopEnabledRef = useRef<boolean>(false);

  /**
   * ROL/BNK 파일 로드 및 플레이어 초기화
   */
  useEffect(() => {
    if (!rolFile || !bnkFile) {
      return;
    }

    let cancelled = false;

    const initializePlayer = async () => {
      try {
        // 플레이어 준비 상태 리셋 (playerRef 정리 전에!)
        setIsPlayerReady(false);

        // playerRef를 먼저 null로 설정 (cleanup에서 제거)
        playerRef.current = null;

        setIsLoading(true);
        setError(null);
        setState(null); // 이전 플레이어 상태 제거

        // 파일 읽기
        const rolBuffer = await rolFile.arrayBuffer();
        const bnkBuffer = await bnkFile.arrayBuffer();

        if (cancelled) {
          return;
        }

        // ROL 파일 파싱
        const rolData = parseROL(rolBuffer);

        // OPL 엔진 생성
        const oplEngine = new OPLEngine();

        // 강제 재로드 처리 (트랙 재생 버튼 클릭 시)
        if (forceReloadRef?.current) {
          forceReloadRef.current = false;

          // 기존 AudioContext 강제 종료
          const existingContext = getAudioContext();
          if (existingContext && existingContext.state !== 'closed') {
            await existingContext.close();
          }
          setAudioContext(null);
        }

        // Web Audio API 초기화 (기존 AudioContext 재사용 - Safari autoplay 정책)
        let audioContext = getAudioContext();
        if (!audioContext || audioContext.state === 'closed') {
          audioContext = new AudioContext();
          setAudioContext(audioContext);
        }

        // ROL 플레이어 생성 및 초기화 (AudioContext 샘플레이트 전달)
        const player = new ROLPlayer(rolData, bnkBuffer, oplEngine);
        await player.initialize(audioContext.sampleRate);

        if (cancelled) {
          return;
        }

        playerRef.current = player;

        // 오디오 프로세서 초기화 (기존 프로세서가 있으면 정리 후 재생성)
        if (processorRef.current) {
          processorRef.current.disconnect();
          processorRef.current = null;
        }
        initializeAudioProcessor(audioContext);

        // 샘플 생성 카운터 초기화 (이전 재생의 잔여 값 제거)
        lenGenRef.current = 0;

        // 트랙 종료 콜백 플래그 리셋
        trackEndCallbackFiredRef.current = false;

        // 초기 상태 설정
        fileNameRef.current = rolFile.name; // fileNameRef 업데이트

        // setState를 먼저 호출하여 state.fileName이 업데이트된 후 isPlayerReady가 true가 되도록 함
        // (IMS→ROL 전환 시 autoPlay race condition 방지)
        setState({
          ...player.getState(),
          fileName: rolFile.name,
        });
        setIsPlayerReady(true);
        setIsLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error('[useROLPlayer initializePlayer] 에러:', err);
          setError(err instanceof Error ? err.message : "Unknown error");
          setIsLoading(false);
        }
      }
    };

    initializePlayer();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [rolFile, bnkFile, fileLoadKey]);

  /**
   * 오디오 프로세서 초기화 (alib.js 예제 방식)
   */
  const initializeAudioProcessor = useCallback((audioContext: AudioContext) => {
    const bufferSize = 2048;
    const processor = audioContext.createScriptProcessor(bufferSize, 0, 2);

    processor.onaudioprocess = (e) => {
      if (!playerRef.current) {
        return;
      }

      const player = playerRef.current;
      const state = player.getState();

      // 트랙 종료 감지 (백그라운드에서도 작동)
      if (!state.isPlaying && state.currentByte >= state.totalSize - 100) {
        // 1곡 반복 모드: 플레이어 재시작
        if (loopEnabledRef.current) {
          player.stop();
          player.play();
          trackEndCallbackFiredRef.current = false; // 다음 루프를 위해 리셋
        } else if (!trackEndCallbackFiredRef.current && onTrackEnd) {
          trackEndCallbackFiredRef.current = true;
          // 다음 이벤트 루프에서 콜백 호출 (React 상태 업데이트 허용)
          setTimeout(() => {
            onTrackEnd();
          }, 0);
        }
      }

      // 재생 중이 아니면 무음 출력
      if (!state.isPlaying) {
        return;
      }
      const outputBuffer = e.outputBuffer;
      const outputL = outputBuffer.getChannelData(0);
      const outputR = outputBuffer.getChannelData(1);
      const lenFill = outputBuffer.length;
      let posFill = 0;

      // 틱당 생성할 샘플 수 계산 (정수로 반올림하여 누적 오차 방지)
      const tickDelay = player.getTickDelay(); // ms
      const samplesPerTick = Math.round((audioContext.sampleRate * tickDelay) / 1000);

      let loopCount = 0;
      while (posFill < lenFill) {
        loopCount++;
        if (loopCount > 10000) {
          console.error("[onaudioprocess] 무한 루프 감지! posFill:", posFill, "lenFill:", lenFill);
          break;
        }
        // 남은 샘플이 있으면 먼저 생성
        while (lenGenRef.current > 0) {
          if (lenFill - posFill < 2) {
            // 버퍼 공간 부족
            return;
          }

          const lenNow = Math.max(2, Math.min(512, Math.floor(lenGenRef.current), lenFill - posFill));
          const samples = player.generateSamples(lenNow);

          for (let i = 0; i < lenNow; i++) {
            outputL[posFill] = samples[i * 2] / 32768.0;
            outputR[posFill] = samples[i * 2 + 1] / 32768.0;
            posFill++;
          }

          lenGenRef.current -= lenNow;
        }

        // 다음 틱 처리
        player.tick();
        lenGenRef.current += samplesPerTick;
      }
    };

    // GainNode 생성 및 연결 (마스터 볼륨용)
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.5; // 기본값 50%
    gainNodeRef.current = gainNode;

    // processor → gainNode → destination
    processor.connect(gainNode);
    gainNode.connect(audioContext.destination);
    processorRef.current = processor;
  }, [onTrackEnd]);

  /**
   * 정리 함수 (AudioContext는 재사용을 위해 유지)
   */
  const cleanup = useCallback(() => {
    // UI 업데이트 타이머 정리
    if (uiUpdateIntervalRef.current) {
      clearInterval(uiUpdateIntervalRef.current);
      uiUpdateIntervalRef.current = null;
    }

    // 오디오 프로세서만 정리 (AudioContext는 유지하여 Safari autoplay 정책 준수)
    // AudioContext는 initializePlayer에서 재사용됨
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    lenGenRef.current = 0;
    // playerRef는 initializePlayer 시작 시 null로 설정됨
  }, []);

  /**
   * AudioContext가 'running' 상태인지 확인하고 복구
   * @returns AudioContext가 준비되었는지 여부
   */
  const ensureAudioContextReady = useCallback(async (): Promise<boolean> => {
    const currentContext = getAudioContext();
    if (!currentContext) {
      console.error('[useROLPlayer.ensureAudioContextReady] AudioContext가 없습니다.');
      return false;
    }

    console.log('[useROLPlayer.ensureAudioContextReady] 현재 AudioContext 상태:', currentContext.state);

    // Closed 상태: 재생성 필요
    if (currentContext.state === 'closed') {
      console.log('[useROLPlayer.ensureAudioContextReady] AudioContext가 closed 상태입니다. 재생성 중...');
      try {
        const newAudioContext = new AudioContext();
        setAudioContext(newAudioContext);

        // ScriptProcessorNode 재생성
        if (processorRef.current) {
          processorRef.current.disconnect();
          processorRef.current = null;
        }
        initializeAudioProcessor(newAudioContext);

        // Resume 필요 시 처리
        if (newAudioContext.state === 'suspended') {
          const resumed = await attemptResume(newAudioContext);
          if (!resumed) {
            console.error('[useROLPlayer.ensureAudioContextReady] 재생성 후 resume 실패');
            return false;
          }
        }

        console.log('[useROLPlayer.ensureAudioContextReady] AudioContext 재생성 완료');
        return true;
      } catch (error) {
        console.error('[useROLPlayer.ensureAudioContextReady] AudioContext 재생성 실패:', error);
        return false;
      }
    }

    // Suspended 상태: Resume 시도 (최대 3회)
    if (currentContext.state === 'suspended') {
      const resumed = await attemptResume(currentContext);
      if (!resumed) {
        // Resume 실패 시 재생성 시도
        console.log('[useROLPlayer.ensureAudioContextReady] Resume 실패, AudioContext 재생성 시도...');
        try {
          const newAudioContext = new AudioContext();
          setAudioContext(newAudioContext);

          // ScriptProcessorNode 재생성
          if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
          }
          initializeAudioProcessor(newAudioContext);

          // 새 Context도 suspended일 수 있으므로 다시 시도
          if (newAudioContext.state === 'suspended') {
            const resumed = await attemptResume(newAudioContext);
            if (!resumed) {
              console.error('[useROLPlayer.ensureAudioContextReady] 재생성 후에도 resume 실패');
              return false;
            }
          }

          console.log('[useROLPlayer.ensureAudioContextReady] AudioContext 재생성 완료');
          return true;
        } catch (error) {
          console.error('[useROLPlayer.ensureAudioContextReady] AudioContext 재생성 실패:', error);
          return false;
        }
      }
    }

    // Running 상태: 정상
    console.log('[useROLPlayer.ensureAudioContextReady] AudioContext 준비 완료 (state:', currentContext.state + ')');
    return true;
  }, [getAudioContext, setAudioContext, initializeAudioProcessor]);

  /**
   * AudioContext resume 시도 (최대 3회, 타임아웃 5초)
   */
  const attemptResume = async (audioContext: AudioContext): Promise<boolean> => {
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(`[useROLPlayer.attemptResume] Resume 시도 ${i + 1}/${maxRetries}...`);

        const resumePromise = audioContext.resume();
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('AudioContext resume timeout')), 5000)
        );

        await Promise.race([resumePromise, timeoutPromise]);

        // 상태 재확인
        if (audioContext.state === 'running') {
          console.log('[useROLPlayer.attemptResume] Resume 성공');
          return true;
        } else {
          console.warn(`[useROLPlayer.attemptResume] Resume 후에도 상태가 ${audioContext.state}입니다.`);
          // 짧은 대기 후 재시도
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`[useROLPlayer.attemptResume] Resume 시도 ${i + 1} 실패:`, error);
        if (i < maxRetries - 1) {
          // 재시도 전 대기
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    }

    console.error('[useROLPlayer.attemptResume] 모든 resume 시도 실패');
    return false;
  };

  /**
   * Page Visibility API: 백그라운드/포그라운드 전환 처리
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!playerRef.current) {
        return;
      }

      const player = playerRef.current;

      if (document.hidden) {
        // 백그라운드 진입: 재생 상태 저장 및 UI 타이머 일시정지
        wasPlayingBeforeBackgroundRef.current = player.getState().isPlaying;

        // UI 업데이트 타이머 일시정지 (배터리 절약)
        if (uiUpdateIntervalRef.current) {
          clearInterval(uiUpdateIntervalRef.current);
          uiUpdateIntervalRef.current = null;
        }
      } else {
        // 포그라운드 복귀: AudioContext 복구 플래그 설정
        console.log('[useROLPlayer] Returning from background');
        needsAudioRecoveryRef.current = true;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []); // dependency 없음 - ref를 통해 최신 값 접근

  /**
   * 백그라운드 복귀 시 AudioContext 복구 처리
   */
  useEffect(() => {
    if (!needsAudioRecoveryRef.current) {
      return;
    }

    const recoverAudio = async () => {
      needsAudioRecoveryRef.current = false;

      if (!playerRef.current || !getAudioContext()) {
        return;
      }

      console.log('[useROLPlayer] Starting audio recovery...');

      // AudioContext 복구
      const recovered = await ensureAudioContextReady();
      if (!recovered) {
        console.error('[useROLPlayer] AudioContext 복구 실패');
        setError('AudioContext 복구에 실패했습니다. 다시 재생 버튼을 눌러주세요.');
        return;
      }

      const player = playerRef.current;

      // 이전에 재생 중이었다면 자동 재개
      if (wasPlayingBeforeBackgroundRef.current && !player.getState().isPlaying) {
        // ═══════════════════════════════════════════════════════════════
        // [MEDIA SESSION API - 비활성화됨]
        // 나중에 재활성화하려면 이 섹션의 주석을 제거하세요
        // ═══════════════════════════════════════════════════════════════
        // // 무음 오디오 재시작 (Media Session 활성화)
        // if (silentAudioRef?.current && silentAudioRef.current.paused) {
        //   try {
        //     await silentAudioRef.current.play();
        //   } catch (error) {
        //     console.warn('[useROLPlayer] 포그라운드 복귀 시 무음 오디오 재생 실패:', error);
        //   }
        // }
        // ═══════════════════════════════════════════════════════════════

        // 플레이어 재생 재개
        player.play();
        lenGenRef.current = 0;

        // UI 타이머 재시작
        if (uiUpdateIntervalRef.current) {
          clearInterval(uiUpdateIntervalRef.current);
        }
        uiUpdateIntervalRef.current = setInterval(() => {
          if (playerRef.current) {
            setState({
              ...playerRef.current.getState(),
              fileName: fileNameRef.current,
            });
          }
        }, 100);

        // 즉시 상태 업데이트
        setState({
          ...player.getState(),
          fileName: fileNameRef.current,
        });

        console.log('[useROLPlayer] Audio recovery and playback resumed successfully');
      } else if (player.getState().isPlaying) {
        // 이미 재생 중이지만 UI 타이머가 꺼져있다면 재시작
        if (!uiUpdateIntervalRef.current) {
          uiUpdateIntervalRef.current = setInterval(() => {
            if (playerRef.current) {
              setState({
                ...playerRef.current.getState(),
                fileName: fileNameRef.current,
              });
            }
          }, 100);
        }
        console.log('[useROLPlayer] Audio recovery completed (already playing)');
      } else {
        console.log('[useROLPlayer] Audio recovery completed (not playing)');
      }
    };

    recoverAudio();
  }, [needsAudioRecoveryRef.current, ensureAudioContextReady]);


  /**
   * 재생 시작
   */
  const play = useCallback(async () => {
    if (!playerRef.current || !getAudioContext()) {
      return;
    }

    console.log('[useROLPlayer.play] Play 시작, AudioContext 상태 확인 중...');

    // AudioContext 상태 확인 및 복구
    const isReady = await ensureAudioContextReady();
    if (!isReady) {
      console.error('[useROLPlayer.play] AudioContext 준비 실패');
      setError('오디오 시스템 초기화에 실패했습니다. 다시 시도해주세요.');
      return;
    }

    console.log('[useROLPlayer.play] AudioContext 준비 완료, 재생 시작');
    setError(null); // 에러 상태 클리어

    // ═══════════════════════════════════════════════════════════════
    // [MEDIA SESSION API - 비활성화됨]
    // 나중에 재활성화하려면 이 섹션의 주석을 제거하세요
    // ═══════════════════════════════════════════════════════════════
    // // Media Session 활성화를 위한 무음 오디오 시작
    // if (silentAudioRef?.current) {
    //   try {
    //     await silentAudioRef.current.play();
    //   } catch (error) {
    //     console.warn('[useROLPlayer.play] 무음 오디오 재생 실패:', error);
    //   }
    // }
    // ═══════════════════════════════════════════════════════════════

    playerRef.current.play();

    lenGenRef.current = 0;

    // UI는 10fps로 업데이트 (배터리 절약)
    uiUpdateIntervalRef.current = setInterval(() => {
      if (playerRef.current) {
        setState({
      ...playerRef.current.getState(),
      fileName: fileNameRef.current,
    });
      }
    }, 100);

    setState({
      ...playerRef.current.getState(),
      fileName: fileNameRef.current,
    });
  }, [
    ensureAudioContextReady,
    // ═══════════════════════════════════════════════════════════════
    // [MEDIA SESSION API - 비활성화됨]
    // 나중에 재활성화하려면 이 섹션의 주석을 제거하세요
    // ═══════════════════════════════════════════════════════════════
    // silentAudioRef
    // ═══════════════════════════════════════════════════════════════
  ]);

  /**
   * 일시정지
   */
  const pause = useCallback(() => {
    if (!playerRef.current) return;

    playerRef.current.pause();

    // ═══════════════════════════════════════════════════════════════
    // [MEDIA SESSION API - 비활성화됨]
    // 나중에 재활성화하려면 이 섹션의 주석을 제거하세요
    // ═══════════════════════════════════════════════════════════════
    // // 무음 오디오도 일시정지
    // if (silentAudioRef?.current && !silentAudioRef.current.paused) {
    //   silentAudioRef.current.pause();
    //
    //   // Safari 워크어라운드: pause 후 reload로 play 버튼 수정
    //   const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    //   if (isSafari) {
    //     silentAudioRef.current.load();
    //   }
    // }
    // ═══════════════════════════════════════════════════════════════

    if (uiUpdateIntervalRef.current) {
      clearInterval(uiUpdateIntervalRef.current);
      uiUpdateIntervalRef.current = null;
    }

    setState({
      ...playerRef.current.getState(),
      fileName: fileNameRef.current,
    });
  }, [
    // ═══════════════════════════════════════════════════════════════
    // [MEDIA SESSION API - 비활성화됨]
    // 나중에 재활성화하려면 이 섹션의 주석을 제거하세요
    // ═══════════════════════════════════════════════════════════════
    // silentAudioRef
    // ═══════════════════════════════════════════════════════════════
  ]);

  /**
   * 정지
   */
  const stop = useCallback(() => {
    if (!playerRef.current) return;

    playerRef.current.stop();
    lenGenRef.current = 0;

    // ═══════════════════════════════════════════════════════════════
    // [MEDIA SESSION API - 비활성화됨]
    // 나중에 재활성화하려면 이 섹션의 주석을 제거하세요
    // ═══════════════════════════════════════════════════════════════
    // // 무음 오디오 정지 및 리셋
    // if (silentAudioRef?.current) {
    //   silentAudioRef.current.pause();
    //   silentAudioRef.current.currentTime = 0;
    // }
    // ═══════════════════════════════════════════════════════════════

    if (uiUpdateIntervalRef.current) {
      clearInterval(uiUpdateIntervalRef.current);
      uiUpdateIntervalRef.current = null;
    }

    setState({
      ...playerRef.current.getState(),
      fileName: fileNameRef.current,
    });
  }, [
    // ═══════════════════════════════════════════════════════════════
    // [MEDIA SESSION API - 비활성화됨]
    // 나중에 재활성화하려면 이 섹션의 주석을 제거하세요
    // ═══════════════════════════════════════════════════════════════
    // silentAudioRef
    // ═══════════════════════════════════════════════════════════════
  ]);

  /**
   * 볼륨 설정 (0-127)
   */
  const setVolume = useCallback((volume: number) => {
    if (!playerRef.current) return;
    playerRef.current.controlVolume(volume);
    setState({
      ...playerRef.current.getState(),
      fileName: fileNameRef.current,
    });
  }, []);

  /**
   * 템포 설정 (0-400%)
   */
  const setTempo = useCallback((tempo: number) => {
    if (!playerRef.current) return;
    playerRef.current.controlTempo(tempo);
    setState({
      ...playerRef.current.getState(),
      fileName: fileNameRef.current,
    });
  }, []);

  /**
   * 키 조옮김 설정 (-13 ~ +13)
   */
  const setKeyTranspose = useCallback((key: number) => {
    if (!playerRef.current) return;
    playerRef.current.setKeyTranspose(key);
    setState({
      ...playerRef.current.getState(),
      fileName: fileNameRef.current,
    });
  }, []);

  /**
   * 채널 볼륨 설정 (channel: 0-10, volume: 0-15)
   */
  const setChannelVolume = useCallback((channel: number, volume: number) => {
    if (!playerRef.current) return;
    playerRef.current.setChannelVolume(channel, volume);
    setState({
      ...playerRef.current.getState(),
      fileName: fileNameRef.current,
    });
  }, []);

  /**
   * 루프 활성화/비활성화
   */
  const setLoopEnabled = useCallback((enabled: boolean) => {
    loopEnabledRef.current = enabled;
    if (!playerRef.current) return;
    playerRef.current.setLoopEnabled(enabled);
  }, []);

  /**
   * 마스터 볼륨 설정 (0-100)
   */
  const setMasterVolume = useCallback((volume: number) => {
    if (gainNodeRef.current) {
      // 0-100 범위를 0.0-1.0으로 변환
      gainNodeRef.current.gain.value = volume / 100;
    }
  }, []);

  /**
   * Page Visibility API - 탭이 다시 활성화될 때 즉시 상태 업데이트
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && playerRef.current) {
        // 탭이 다시 활성화되면 즉시 상태 업데이트
        setState({
          ...playerRef.current.getState(),
          fileName: fileNameRef.current,
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  /**
   * playerRef 직접 확인 (stale state 회피)
   */
  const checkPlayerReady = useCallback(() => {
    return !!(playerRef.current && getAudioContext());
  }, [getAudioContext]);

  return {
    state,
    isLoading,
    error,
    isPlayerReady,
    play,
    pause,
    stop,
    setVolume,
    setTempo,
    setMasterVolume,
    setKeyTranspose,
    setChannelVolume,
    setLoopEnabled,
    checkPlayerReady,
  };
}
