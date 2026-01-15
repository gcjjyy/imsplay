/**
 * useAdPlugPlayer.ts - AdPlug 통합 플레이어 React 훅
 *
 * Web Audio API와 AdPlug WASM을 연결하는 React 훅
 * IMS, ROL, VGM 및 모든 AdPlug 지원 포맷을 재생
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { RefObject } from "react";
import { AdPlugPlayer } from "../adplug/adplug";

// 기존 플레이어와 호환되는 상태 인터페이스
export interface AdPlugPlaybackState {
  isPlaying: boolean;
  isPaused: boolean;
  currentByte: number;  // 호환성을 위해 ms를 byte처럼 사용
  totalSize: number;    // 호환성을 위해 maxPosition을 size처럼 사용
  currentTick: number;
  volume: number;
  tempo: number;
  currentTempo: number;
  fileName: string;
}

interface UseAdPlugPlayerOptions {
  musicFile: File | null;
  bnkFile: File | null;
  fileLoadKey?: number;
  forceReloadRef?: RefObject<boolean>;
  onTrackEnd?: () => void;
  sharedAudioContextRef?: RefObject<AudioContext | null>;
  audioElementRef?: RefObject<HTMLAudioElement | null>;
}

interface UseAdPlugPlayerReturn {
  state: AdPlugPlaybackState | null;
  isLoading: boolean;
  error: string | null;
  isPlayerReady: boolean;
  analyserNode: AnalyserNode | null;

  play: () => void;
  pause: () => void;
  stop: () => void;

  setVolume: (volume: number) => void;
  setTempo: (tempo: number) => void;
  setMasterVolume: (volume: number) => void;
  setLoopEnabled: (enabled: boolean) => void;

  checkPlayerReady: () => boolean;
}

const SAMPLE_RATE = 49716; // OPL2 native sample rate

/**
 * AdPlug 통합 플레이어 React 훅
 */
export function useAdPlugPlayer({
  musicFile,
  bnkFile,
  fileLoadKey,
  forceReloadRef,
  onTrackEnd,
  sharedAudioContextRef,
  audioElementRef,
}: UseAdPlugPlayerOptions): UseAdPlugPlayerReturn {
  const [state, setState] = useState<AdPlugPlaybackState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);

  const playerRef = useRef<AdPlugPlayer | null>(null);
  const localAudioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const mediaStreamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const uiUpdateFrameRef = useRef<number | null>(null);
  const lastUIUpdateTimeRef = useRef<number>(0);
  const fileNameRef = useRef<string>("");
  const isVgmFileRef = useRef<boolean>(false); // VGM 파일 여부 (볼륨 1.5배)

  // 재생 상태
  const isPlayingRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);

  // 루프 모드
  const loopEnabledRef = useRef<boolean>(false);

  // 트랙 종료 콜백 중복 호출 방지
  const trackEndCallbackFiredRef = useRef<boolean>(false);

  // 백그라운드 상태
  const wasPlayingBeforeBackgroundRef = useRef<boolean>(false);
  const [needsAudioRecovery, setNeedsAudioRecovery] = useState<boolean>(false);

  // AudioContext 접근 헬퍼
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

  /**
   * 파일 로드 및 플레이어 초기화
   */
  useEffect(() => {
    if (!musicFile) {
      return;
    }

    let cancelled = false;

    const initializePlayer = async () => {
      try {
        setIsPlayerReady(false);
        playerRef.current = null;
        setState(null);
        setIsLoading(true);
        setError(null);

        // 파일 읽기
        const musicBuffer = await musicFile.arrayBuffer();
        const musicData = new Uint8Array(musicBuffer);

        if (cancelled) return;

        // 강제 재로드 처리
        if (forceReloadRef?.current) {
          forceReloadRef.current = false;
          const existingContext = getAudioContext();
          if (existingContext && existingContext.state !== 'closed') {
            await existingContext.close();
          }
          setAudioContext(null);
        }

        // Web Audio API 초기화
        let audioContext = getAudioContext();
        if (!audioContext || audioContext.state === 'closed') {
          audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
          setAudioContext(audioContext);
        }

        // AdPlug 플레이어 생성 및 초기화
        const player = new AdPlugPlayer();
        await player.init(audioContext.sampleRate);

        if (cancelled) return;

        // BNK 파일 추가 (있는 경우)
        if (bnkFile) {
          const bnkBuffer = await bnkFile.arrayBuffer();
          const bnkData = new Uint8Array(bnkBuffer);
          player.addFile(bnkFile.name, bnkData);
        }

        // 음악 파일 로드
        const loaded = player.load(musicFile.name, musicData);
        if (!loaded) {
          throw new Error("Failed to load music file. Format may not be supported.");
        }

        if (cancelled) return;

        playerRef.current = player;
        isPlayingRef.current = false;
        isPausedRef.current = false;

        // 오디오 프로세서 초기화
        if (processorRef.current) {
          processorRef.current.disconnect();
          processorRef.current = null;
        }
        initializeAudioProcessor(audioContext);

        // 트랙 종료 콜백 플래그 리셋
        trackEndCallbackFiredRef.current = false;

        // 초기 상태 설정
        fileNameRef.current = musicFile.name;
        const lowerName = musicFile.name.toLowerCase();
        isVgmFileRef.current = lowerName.endsWith('.vgm') || lowerName.endsWith('.vgz');
        const playerState = player.getState();

        setState({
          isPlaying: false,
          isPaused: false,
          currentByte: playerState.currentPosition,
          totalSize: playerState.maxPosition || 1,
          currentTick: 0,
          volume: 100,
          tempo: 100,
          currentTempo: 120, // 기본 BPM
          fileName: musicFile.name,
        });

        setIsPlayerReady(true);
        setIsLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error('[useAdPlugPlayer] 에러:', err);
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
  }, [musicFile, bnkFile, fileLoadKey]);

  /**
   * 오디오 프로세서 초기화
   */
  const initializeAudioProcessor = useCallback((audioContext: AudioContext) => {
    const bufferSize = 4096; // 약 80ms 간격으로 처리
    const processor = audioContext.createScriptProcessor(bufferSize, 0, 2);

    processor.onaudioprocess = (e) => {
      if (!playerRef.current || !isPlayingRef.current) {
        return;
      }

      const player = playerRef.current;
      const outputBuffer = e.outputBuffer;
      const outputL = outputBuffer.getChannelData(0);
      const outputR = outputBuffer.getChannelData(1);

      // AdPlug에서 샘플 생성
      const { samples, finished } = player.generateSamples();

      if (samples.length > 0) {
        // 스테레오 샘플을 Float32로 변환
        const numFrames = Math.min(samples.length / 2, outputBuffer.length);
        for (let i = 0; i < numFrames; i++) {
          outputL[i] = samples[i * 2] / 32768.0;
          outputR[i] = samples[i * 2 + 1] / 32768.0;
        }
        // 남은 부분은 0으로 채움
        for (let i = numFrames; i < outputBuffer.length; i++) {
          outputL[i] = 0;
          outputR[i] = 0;
        }
      }

      // 트랙 종료 감지
      if (finished) {
        if (loopEnabledRef.current) {
          // 루프 모드: 처음부터 다시 재생
          player.rewind();
          trackEndCallbackFiredRef.current = false;
        } else {
          // 일반 모드: 트랙 종료 콜백
          isPlayingRef.current = false;
          if (!trackEndCallbackFiredRef.current && onTrackEnd) {
            trackEndCallbackFiredRef.current = true;
            setTimeout(() => {
              onTrackEnd();
            }, 0);
          }
        }
      }
    };

    // GainNode 생성 (VGM은 1.5배 볼륨)
    const gainNode = audioContext.createGain();
    const baseGain = isVgmFileRef.current ? 1.5 : 1.0;
    gainNode.gain.value = baseGain;
    gainNodeRef.current = gainNode;

    // AnalyserNode 생성 (스펙트럼 시각화용)
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256; // 128개의 주파수 빈
    analyser.smoothingTimeConstant = 0.8;
    analyserNodeRef.current = analyser;
    setAnalyserNode(analyser);

    processor.connect(gainNode);
    gainNode.connect(analyser);

    // MediaStreamDestination 연결
    if (audioElementRef?.current) {
      try {
        const mediaStreamDest = audioContext.createMediaStreamDestination();
        mediaStreamDestRef.current = mediaStreamDest;
        analyser.connect(mediaStreamDest);
        audioElementRef.current.pause();
        audioElementRef.current.srcObject = mediaStreamDest.stream;
      } catch (error) {
        console.warn('[useAdPlugPlayer] MediaStreamDestination 실패:', error);
        analyser.connect(audioContext.destination);
      }
    } else {
      analyser.connect(audioContext.destination);
    }

    processorRef.current = processor;
  }, [onTrackEnd, audioElementRef]);

  /**
   * UI 업데이트 루프 시작 (requestAnimationFrame 사용)
   */
  const startUIUpdateLoop = useCallback(() => {
    if (uiUpdateFrameRef.current !== null) return; // 이미 실행 중

    const updateUI = (timestamp: number) => {
      // 30fps로 제한 (~33ms 간격)
      if (timestamp - lastUIUpdateTimeRef.current >= 33) {
        lastUIUpdateTimeRef.current = timestamp;

        if (playerRef.current) {
          const playerState = playerRef.current.getState();
          const currentTick = playerRef.current.getCurrentTick();

          setState(prev => prev ? {
            ...prev,
            isPlaying: isPlayingRef.current,
            isPaused: isPausedRef.current,
            currentByte: playerState.currentPosition,
            totalSize: playerState.maxPosition || prev.totalSize,
            currentTick: currentTick,
          } : null);
        }
      }

      uiUpdateFrameRef.current = requestAnimationFrame(updateUI);
    };

    uiUpdateFrameRef.current = requestAnimationFrame(updateUI);
  }, []);

  /**
   * UI 업데이트 루프 중지
   */
  const stopUIUpdateLoop = useCallback(() => {
    if (uiUpdateFrameRef.current !== null) {
      cancelAnimationFrame(uiUpdateFrameRef.current);
      uiUpdateFrameRef.current = null;
    }
  }, []);

  /**
   * 정리 함수
   */
  const cleanup = useCallback(() => {
    stopUIUpdateLoop();

    if (mediaStreamDestRef.current) {
      mediaStreamDestRef.current.disconnect();
      mediaStreamDestRef.current = null;
    }

    if (analyserNodeRef.current) {
      analyserNodeRef.current.disconnect();
      analyserNodeRef.current = null;
      setAnalyserNode(null);
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }
  }, [stopUIUpdateLoop]);

  /**
   * AudioContext resume 시도
   */
  const attemptResume = async (audioContext: AudioContext): Promise<boolean> => {
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const resumePromise = audioContext.resume();
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('AudioContext resume timeout')), 5000)
        );
        await Promise.race([resumePromise, timeoutPromise]);

        if (audioContext.state === 'running') {
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    }
    return false;
  };

  /**
   * AudioContext 준비 확인 및 복구
   */
  const ensureAudioContextReady = useCallback(async (): Promise<boolean> => {
    const currentContext = getAudioContext();
    if (!currentContext) return false;

    if (currentContext.state === 'closed') {
      const newAudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      setAudioContext(newAudioContext);

      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
      }
      initializeAudioProcessor(newAudioContext);

      if (newAudioContext.state === 'suspended') {
        return await attemptResume(newAudioContext);
      }
      return true;
    }

    if (currentContext.state === 'suspended') {
      return await attemptResume(currentContext);
    }

    return true;
  }, [getAudioContext, setAudioContext, initializeAudioProcessor]);

  /**
   * 재생 시작
   */
  const play = useCallback(async () => {
    if (!playerRef.current || !getAudioContext()) return;

    const isReady = await ensureAudioContextReady();
    if (!isReady) {
      setError('오디오 시스템 초기화에 실패했습니다.');
      return;
    }

    setError(null);

    // Audio 요소 재생
    if (audioElementRef?.current) {
      try {
        await audioElementRef.current.play();
      } catch (error) {
        console.warn('[useAdPlugPlayer] Audio 요소 재생 실패:', error);
      }
    }

    isPlayingRef.current = true;
    isPausedRef.current = false;
    playerRef.current.setIsPlaying(true);

    // UI 업데이트 루프 시작 (requestAnimationFrame)
    startUIUpdateLoop();

    // 즉시 상태 업데이트
    const playerState = playerRef.current.getState();
    setState(prev => prev ? {
      ...prev,
      isPlaying: true,
      isPaused: false,
      currentByte: playerState.currentPosition,
    } : null);
  }, [ensureAudioContextReady, audioElementRef, getAudioContext, startUIUpdateLoop]);

  /**
   * 일시정지
   */
  const pause = useCallback(() => {
    if (!playerRef.current) return;

    isPlayingRef.current = false;
    isPausedRef.current = true;

    if (audioElementRef?.current && !audioElementRef.current.paused) {
      audioElementRef.current.pause();
    }

    stopUIUpdateLoop();

    setState(prev => prev ? {
      ...prev,
      isPlaying: false,
      isPaused: true,
    } : null);
  }, [audioElementRef, stopUIUpdateLoop]);

  /**
   * 정지
   */
  const stop = useCallback(() => {
    if (!playerRef.current) return;

    isPlayingRef.current = false;
    isPausedRef.current = false;
    playerRef.current.rewind();

    if (audioElementRef?.current) {
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
    }

    stopUIUpdateLoop();

    setState(prev => prev ? {
      ...prev,
      isPlaying: false,
      isPaused: false,
      currentByte: 0,
    } : null);
  }, [audioElementRef, stopUIUpdateLoop]);

  /**
   * 볼륨 설정 (AdPlug에서는 지원하지 않음, 호환성용)
   */
  const setVolume = useCallback((volume: number) => {
    setState(prev => prev ? { ...prev, volume } : null);
  }, []);

  /**
   * 템포 설정 (AdPlug에서는 지원하지 않음, 호환성용)
   */
  const setTempo = useCallback((tempo: number) => {
    setState(prev => prev ? { ...prev, tempo } : null);
  }, []);

  /**
   * 마스터 볼륨 설정
   */
  const setMasterVolume = useCallback((volume: number) => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume / 100;
    }
  }, []);

  /**
   * 루프 활성화/비활성화
   */
  const setLoopEnabled = useCallback((enabled: boolean) => {
    loopEnabledRef.current = enabled;
  }, []);

  /**
   * 플레이어 준비 상태 확인
   */
  const checkPlayerReady = useCallback(() => {
    return !!(playerRef.current && getAudioContext());
  }, [getAudioContext]);

  /**
   * Page Visibility API: 백그라운드/포그라운드 전환 처리
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!playerRef.current) return;

      if (document.hidden) {
        wasPlayingBeforeBackgroundRef.current = isPlayingRef.current;
        stopUIUpdateLoop();
      } else {
        setNeedsAudioRecovery(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [stopUIUpdateLoop]);

  /**
   * 백그라운드 복귀 시 오디오 복구
   */
  useEffect(() => {
    if (!needsAudioRecovery) return;

    const recoverAudio = async () => {
      setNeedsAudioRecovery(false);

      if (!playerRef.current || !getAudioContext()) return;

      const recovered = await ensureAudioContextReady();
      if (!recovered) {
        setError('AudioContext 복구에 실패했습니다.');
        return;
      }

      // 재생 중이었으면 UI 업데이트 루프 재시작
      if (wasPlayingBeforeBackgroundRef.current) {
        if (audioElementRef?.current && audioElementRef.current.paused) {
          try {
            await audioElementRef.current.play();
          } catch (error) {
            console.warn('[useAdPlugPlayer] 포그라운드 복귀 시 Audio 요소 재생 실패:', error);
          }
        }

        isPlayingRef.current = true;
        isPausedRef.current = false;

        startUIUpdateLoop();
      }
    };

    recoverAudio();
  }, [needsAudioRecovery, ensureAudioContextReady, audioElementRef, getAudioContext, startUIUpdateLoop]);

  return {
    state,
    isLoading,
    error,
    isPlayerReady,
    analyserNode,
    play,
    pause,
    stop,
    setVolume,
    setTempo,
    setMasterVolume,
    setLoopEnabled,
    checkPlayerReady,
  };
}
