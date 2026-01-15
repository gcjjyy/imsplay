/**
 * useAdPlugPlayer.ts - AdPlug 통합 플레이어 React 훅
 *
 * Web Audio API (AudioWorklet)와 AdPlug WASM을 연결하는 React 훅
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
  refreshState: () => void;
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
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const mediaStreamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
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
   * 샘플 생성 및 워크렛으로 전송
   */
  const generateAndSendSamples = useCallback(() => {
    if (!playerRef.current || !workletNodeRef.current || !isPlayingRef.current) {
      return;
    }

    const player = playerRef.current;
    const { samples, finished } = player.generateSamples();

    if (samples.length > 0) {
      // Int16 -> Float32 변환
      const floatSamples = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        floatSamples[i] = samples[i] / 32768.0;
      }

      // 워크렛으로 전송
      workletNodeRef.current.port.postMessage({
        type: 'samples',
        samples: floatSamples
      }, [floatSamples.buffer]);
    }

    // 트랙 종료 처리
    if (finished) {
      if (loopEnabledRef.current) {
        player.rewind();
        trackEndCallbackFiredRef.current = false;
      } else {
        isPlayingRef.current = false;
        if (!trackEndCallbackFiredRef.current && onTrackEnd) {
          trackEndCallbackFiredRef.current = true;
          setTimeout(() => onTrackEnd(), 0);
        }
      }
    }
  }, [onTrackEnd]);

  /**
   * 샘플 생성 루프 시작
   */
  const startSampleGeneration = useCallback(() => {
    // 초기 버퍼 채우기 (2번만 - 약 330ms 분량)
    generateAndSendSamples();
    generateAndSendSamples();
  }, [generateAndSendSamples]);

  /**
   * 샘플 생성 루프 중지 (더 이상 사용 안 함)
   */
  const stopSampleGeneration = useCallback(() => {
    // 워크렛 요청 기반으로 변경되어 별도 중지 불필요
  }, []);

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

        // AudioWorklet 모듈 로드
        try {
          await audioContext.audioWorklet.addModule('/audio-worklet-processor.js');
        } catch (e) {
          // 이미 로드된 경우 무시
        }

        // AdPlug 플레이어 생성 및 초기화 (실제 샘플레이트 사용)
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
        if (workletNodeRef.current) {
          workletNodeRef.current.disconnect();
          workletNodeRef.current = null;
        }
        await initializeAudioProcessor(audioContext);

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
   * 오디오 프로세서 초기화 (AudioWorklet)
   */
  const initializeAudioProcessor = useCallback(async (audioContext: AudioContext) => {
    // AudioWorkletNode 생성
    const workletNode = new AudioWorkletNode(audioContext, 'adplug-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    // 워크렛에서 샘플 요청 시 생성
    workletNode.port.onmessage = (event) => {
      if (event.data.type === 'needSamples' && isPlayingRef.current) {
        generateAndSendSamples();
      }
    };

    // GainNode 생성 (VGM은 1.5배 볼륨)
    const gainNode = audioContext.createGain();
    const baseGain = isVgmFileRef.current ? 1.5 : 1.0;
    gainNode.gain.value = baseGain;
    gainNodeRef.current = gainNode;

    // AnalyserNode 생성 (스펙트럼 시각화용)
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    analyserNodeRef.current = analyser;
    setAnalyserNode(analyser);

    workletNode.connect(gainNode);
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

    workletNodeRef.current = workletNode;
  }, [audioElementRef, generateAndSendSamples]);

  /**
   * 상태 갱신 (외부에서 호출)
   */
  const refreshState = useCallback(() => {
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
  }, []);

  /**
   * 정리 함수
   */
  const cleanup = useCallback(() => {
    stopSampleGeneration();

    if (mediaStreamDestRef.current) {
      mediaStreamDestRef.current.disconnect();
      mediaStreamDestRef.current = null;
    }

    if (analyserNodeRef.current) {
      analyserNodeRef.current.disconnect();
      analyserNodeRef.current = null;
      setAnalyserNode(null);
    }

    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }
  }, [stopSampleGeneration]);

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

      if (workletNodeRef.current) {
        workletNodeRef.current.disconnect();
        workletNodeRef.current = null;
      }
      await initializeAudioProcessor(newAudioContext);

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

    // 워크렛 버퍼 클리어
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: 'clear' });
    }

    isPlayingRef.current = true;
    isPausedRef.current = false;
    playerRef.current.setIsPlaying(true);

    // 샘플 생성 시작
    startSampleGeneration();

    // 즉시 상태 업데이트
    const playerState = playerRef.current.getState();
    setState(prev => prev ? {
      ...prev,
      isPlaying: true,
      isPaused: false,
      currentByte: playerState.currentPosition,
    } : null);
  }, [ensureAudioContextReady, audioElementRef, getAudioContext, startSampleGeneration]);

  /**
   * 일시정지
   */
  const pause = useCallback(() => {
    if (!playerRef.current) return;

    isPlayingRef.current = false;
    isPausedRef.current = true;
    stopSampleGeneration();

    if (audioElementRef?.current && !audioElementRef.current.paused) {
      audioElementRef.current.pause();
    }

    setState(prev => prev ? {
      ...prev,
      isPlaying: false,
      isPaused: true,
    } : null);
  }, [audioElementRef, stopSampleGeneration]);

  /**
   * 정지
   */
  const stop = useCallback(() => {
    if (!playerRef.current) return;

    isPlayingRef.current = false;
    isPausedRef.current = false;
    stopSampleGeneration();
    playerRef.current.rewind();

    // 워크렛 버퍼 클리어
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: 'clear' });
    }

    if (audioElementRef?.current) {
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
    }

    setState(prev => prev ? {
      ...prev,
      isPlaying: false,
      isPaused: false,
      currentByte: 0,
    } : null);
  }, [audioElementRef, stopSampleGeneration]);

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
      } else {
        setNeedsAudioRecovery(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

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

      // 재생 중이었으면 상태 복구
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
        startSampleGeneration();
      }
    };

    recoverAudio();
  }, [needsAudioRecovery, ensureAudioContextReady, audioElementRef, getAudioContext, startSampleGeneration]);

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
    refreshState,
  };
}
