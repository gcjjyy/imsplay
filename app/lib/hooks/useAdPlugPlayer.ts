/**
 * useAdPlugPlayer.ts - AdPlug 통합 플레이어 React 훅
 *
 * @ain1084/audio-worklet-stream 라이브러리를 사용하여
 * Web Audio API와 AdPlug WASM을 연결하는 React 훅
 * IMS, ROL, VGM 및 모든 AdPlug 지원 포맷을 재생
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { RefObject } from "react";
import { AdPlugPlayer } from "../adplug/adplug";

// @ain1084/audio-worklet-stream 타입 (SSR 빌드 호환성을 위해 any 사용)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StreamNodeFactory = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OutputStreamNode = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FrameBufferWriter = any;

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
  hardReset: () => Promise<void>;
}

const SAMPLE_RATE = 49716; // AdLib 네이티브 샘플레이트
const BUFFER_FRAME_COUNT = 131072; // 링 버퍼 크기 (~3초 at 44100Hz, 백그라운드 탭 throttle 대응)

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

  // AdPlug 플레이어
  const playerRef = useRef<AdPlugPlayer | null>(null);

  // AudioContext 관련
  const localAudioContextRef = useRef<AudioContext | null>(null);

  // audio-worklet-stream 관련
  const streamFactoryRef = useRef<StreamNodeFactory | null>(null);
  const streamFactoryContextRef = useRef<AudioContext | null>(null); // factory가 생성된 context 추적
  const outputNodeRef = useRef<OutputStreamNode | null>(null);
  const bufferWriterRef = useRef<FrameBufferWriter | null>(null);

  // 오디오 노드
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const mediaStreamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  // 초기화 상태
  const initializingRef = useRef<boolean>(false);

  // 재생 상태
  const isPlayingRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);

  // 루프 모드
  const loopEnabledRef = useRef<boolean>(false);

  // 트랙 종료 콜백 중복 호출 방지
  const trackEndCallbackFiredRef = useRef<boolean>(false);

  // 버퍼 채우기 인터벌
  const fillIntervalRef = useRef<number | null>(null);

  // ISS 동기화용
  const refreshRateRef = useRef<number>(70.0);
  const totalSamplesSentRef = useRef<number>(0);

  // 임시 샘플 버퍼 (생성된 샘플 중 아직 쓰지 못한 부분 저장)
  const pendingSamplesRef = useRef<Int16Array | null>(null);
  const pendingOffsetRef = useRef<number>(0);

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
   * 버퍼 채우기 (샘플 생성 및 링 버퍼에 쓰기)
   */
  const fillBuffer = useCallback(() => {
    if (!playerRef.current || !bufferWriterRef.current || !isPlayingRef.current) {
      return;
    }

    const player = playerRef.current;
    const writer = bufferWriterRef.current;

    if (!player.isFileLoaded()) {
      return;
    }

    const scale = 1 / 32768.0;
    let trackFinished = false;

    // 버퍼에 쓸 수 있는 공간이 있는 동안 샘플 채우기
    writer.write((segment: any) => {
      let framesWritten = 0;

      while (framesWritten < segment.frameCount) {
        // 남은 샘플이 없으면 새로 생성
        if (!pendingSamplesRef.current || pendingOffsetRef.current >= pendingSamplesRef.current.length) {
          const { samples, finished } = player.generateSamples();

          if (samples.length === 0) {
            break;
          }

          pendingSamplesRef.current = samples;
          pendingOffsetRef.current = 0;

          if (finished) {
            trackFinished = true;
          }
        }

        // 현재 세그먼트에 쓸 수 있는 프레임 수 계산
        const pendingSamples = pendingSamplesRef.current!;
        const remainingPendingFrames = (pendingSamples.length - pendingOffsetRef.current) / 2;
        const remainingSegmentFrames = segment.frameCount - framesWritten;
        const framesToCopy = Math.min(remainingPendingFrames, remainingSegmentFrames);

        // 샘플 복사 (Int16 -> Float32)
        for (let i = 0; i < framesToCopy; i++) {
          const srcIdx = pendingOffsetRef.current + i * 2;
          const dstFrame = framesWritten + i;
          segment.set(dstFrame, 0, pendingSamples[srcIdx] * scale);     // Left
          segment.set(dstFrame, 1, pendingSamples[srcIdx + 1] * scale); // Right
        }

        framesWritten += framesToCopy;
        pendingOffsetRef.current += framesToCopy * 2;
        totalSamplesSentRef.current += framesToCopy;
      }

      return framesWritten;
    });

    // 트랙 종료 처리
    if (trackFinished) {
      if (loopEnabledRef.current) {
        player.rewind();
        totalSamplesSentRef.current = 0;
        pendingSamplesRef.current = null;
        pendingOffsetRef.current = 0;
        trackEndCallbackFiredRef.current = false;
      } else {
        const node = outputNodeRef.current;
        if (node && !trackEndCallbackFiredRef.current) {
          trackEndCallbackFiredRef.current = true;
          node.stop(writer.totalFrames).then(() => {
            isPlayingRef.current = false;
            if (onTrackEnd) {
              setTimeout(() => onTrackEnd(), 0);
            }
          });
        }
      }
    }
  }, [onTrackEnd]);

  /**
   * 버퍼 채우기 인터벌 시작
   */
  const startFillInterval = useCallback(() => {
    if (fillIntervalRef.current !== null) {
      return;
    }
    // 10ms마다 버퍼 채우기 (더 자주 채워서 언더런 방지)
    fillIntervalRef.current = window.setInterval(() => {
      fillBuffer();
    }, 10);
  }, [fillBuffer]);

  /**
   * 버퍼 채우기 인터벌 중지
   */
  const stopFillInterval = useCallback(() => {
    if (fillIntervalRef.current !== null) {
      clearInterval(fillIntervalRef.current);
      fillIntervalRef.current = null;
    }
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
      if (initializingRef.current) {
        return;
      }
      initializingRef.current = true;

      try {
        setIsPlayerReady(false);
        playerRef.current = null;
        setState(prev => prev ? {
          ...prev,
          isPlaying: false,
          isPaused: false,
          currentByte: 0,
          currentTick: 0,
        } : null);
        setIsLoading(true);
        setError(null);

        // 파일 읽기
        const musicBuffer = await musicFile.arrayBuffer();
        if (cancelled) {
          initializingRef.current = false;
          return;
        }
        const musicData = new Uint8Array(musicBuffer);

        // 강제 재로드 처리
        if (forceReloadRef?.current) {
          forceReloadRef.current = false;
          const existingContext = getAudioContext();
          if (existingContext && existingContext.state !== 'closed') {
            await existingContext.close();
          }
          if (cancelled) {
            initializingRef.current = false;
            return;
          }
          setAudioContext(null);
          streamFactoryRef.current = null;
        }

        // Web Audio API 초기화
        let audioContext = getAudioContext();
        if (!audioContext || audioContext.state === 'closed') {
          audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
          setAudioContext(audioContext);
          // 새 AudioContext가 생성되면 StreamFactory도 리셋해야 함
          streamFactoryRef.current = null;

          // AudioContext 상태 변경 리스너 (Bluetooth 장치 변경 등 대응)
          const ctx = audioContext;
          ctx.onstatechange = () => {
            if (ctx.state === 'suspended' && isPlayingRef.current) {
              // 재생 중 suspended 되면 자동 resume 시도
              ctx.resume().catch(() => {});
            }
          };
        }

        if (cancelled) {
          initializingRef.current = false;
          return;
        }

        // StreamNodeFactory 생성 (처음 또는 AudioContext가 변경된 경우)
        if (!streamFactoryRef.current || streamFactoryContextRef.current !== audioContext) {
          // .client.ts 모듈 사용으로 SSR 빌드에서 완전히 제외
          const { createStreamNodeFactory } = await import("./audio-worklet-loader.client");
          streamFactoryRef.current = await createStreamNodeFactory(audioContext);
          streamFactoryContextRef.current = audioContext;
        }

        if (cancelled) {
          initializingRef.current = false;
          return;
        }

        // AdPlug 플레이어 생성 및 초기화
        const player = new AdPlugPlayer();
        await player.init(audioContext.sampleRate);

        if (cancelled) {
          player.destroy();
          initializingRef.current = false;
          return;
        }

        // BNK 파일 추가 (있는 경우)
        if (bnkFile) {
          const bnkBuffer = await bnkFile.arrayBuffer();
          if (cancelled) {
            player.destroy();
            initializingRef.current = false;
            return;
          }
          const bnkData = new Uint8Array(bnkBuffer);
          player.addFile(bnkFile.name, bnkData);
        }

        // 음악 파일 로드
        const loaded = player.load(musicFile.name, musicData);
        if (!loaded) {
          player.destroy();
          initializingRef.current = false;
          throw new Error("Failed to load music file. Format may not be supported.");
        }

        if (cancelled) {
          player.destroy();
          initializingRef.current = false;
          return;
        }

        playerRef.current = player;
        isPlayingRef.current = false;
        isPausedRef.current = false;

        // Refresh rate 저장
        refreshRateRef.current = player.getRefreshRate();
        totalSamplesSentRef.current = 0;
        trackEndCallbackFiredRef.current = false;

        // OutputStreamNode 생성
        const [outputNode, writer] = await streamFactoryRef.current.createManualBufferNode({
          channelCount: 2,
          frameCount: BUFFER_FRAME_COUNT,
        });

        if (cancelled) {
          player.destroy();
          initializingRef.current = false;
          return;
        }

        outputNodeRef.current = outputNode;
        bufferWriterRef.current = writer;

        // GainNode 생성
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 1.0;
        gainNodeRef.current = gainNode;

        // AnalyserNode 생성
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        analyserNodeRef.current = analyser;
        setAnalyserNode(analyser);

        // 노드 연결: OutputStreamNode -> GainNode -> Analyser
        outputNode.connect(gainNode);
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

        // 초기 상태 설정
        const playerState = player.getState();

        setState({
          isPlaying: false,
          isPaused: false,
          currentByte: 0,
          totalSize: playerState.maxPosition || 1,
          currentTick: 0,
          volume: 100,
          tempo: 100,
          currentTempo: 120,
          fileName: musicFile.name,
        });

        setIsPlayerReady(true);
        setIsLoading(false);
        initializingRef.current = false;
      } catch (err) {
        initializingRef.current = false;
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
   * 정리 함수
   */
  const cleanup = useCallback(() => {
    isPlayingRef.current = false;
    isPausedRef.current = false;
    stopFillInterval();
    totalSamplesSentRef.current = 0;

    // 버퍼 정리 (플레이어 전환 시 스터터링 방지)
    pendingSamplesRef.current = null;
    pendingOffsetRef.current = 0;

    // OutputStreamNode 정리
    if (outputNodeRef.current) {
      try {
        outputNodeRef.current.stop().catch(() => {});
        outputNodeRef.current.disconnect();
      } catch (e) {}
      outputNodeRef.current = null;
    }
    bufferWriterRef.current = null;

    // GainNode 정리
    if (gainNodeRef.current) {
      try {
        gainNodeRef.current.disconnect();
      } catch (e) {}
      gainNodeRef.current = null;
    }

    // AnalyserNode 정리
    if (analyserNodeRef.current) {
      try {
        analyserNodeRef.current.disconnect();
      } catch (e) {}
      analyserNodeRef.current = null;
      setAnalyserNode(null);
    }

    // MediaStreamDestination 정리
    if (mediaStreamDestRef.current) {
      mediaStreamDestRef.current = null;
    }

    // 플레이어 정리
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }

    initializingRef.current = false;
  }, [stopFillInterval]);

  /**
   * 실제 재생된 틱 계산
   */
  const getPlayedTick = useCallback(() => {
    if (!isPlayingRef.current || !playerRef.current || !outputNodeRef.current) return 0;

    const wasmTick = playerRef.current.getCurrentTick();
    const totalRead = Number(outputNodeRef.current.totalReadFrames);
    const totalWritten = totalSamplesSentRef.current;

    const samplesInBuffer = Math.max(0, totalWritten - totalRead);
    const samplesPerTick = SAMPLE_RATE / refreshRateRef.current;
    const ticksInBuffer = Math.floor(samplesInBuffer / samplesPerTick);

    return Math.max(0, wasmTick - ticksInBuffer);
  }, []);

  /**
   * 재생된 시간 계산 (ms)
   */
  const getPlayedPositionMs = useCallback(() => {
    if (!isPlayingRef.current || !outputNodeRef.current) {
      return 0;
    }
    const framesOutput = Number(outputNodeRef.current.totalReadFrames);
    return Math.floor((framesOutput / SAMPLE_RATE) * 1000);
  }, []);

  /**
   * 상태 갱신
   */
  const refreshState = useCallback(() => {
    if (playerRef.current) {
      const playerState = playerRef.current.getState();
      const currentTick = getPlayedTick();
      const currentPosition = getPlayedPositionMs();

      setState(prev => prev ? {
        ...prev,
        isPlaying: isPlayingRef.current,
        isPaused: isPausedRef.current,
        currentByte: currentPosition,
        totalSize: playerState.maxPosition || prev.totalSize,
        currentTick: currentTick,
      } : null);
    }
  }, [getPlayedTick, getPlayedPositionMs]);

  /**
   * 완전 리셋
   */
  const hardReset = useCallback(async () => {
    isPlayingRef.current = false;
    isPausedRef.current = false;
    stopFillInterval();
    totalSamplesSentRef.current = 0;
    trackEndCallbackFiredRef.current = false;

    setState(prev => prev ? {
      ...prev,
      isPlaying: false,
      isPaused: false,
      currentByte: 0,
      currentTick: 0,
    } : null);
  }, [stopFillInterval]);

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

    if (currentContext.state === 'suspended') {
      return await attemptResume(currentContext);
    }

    return currentContext.state === 'running';
  }, [getAudioContext]);

  /**
   * 재생 시작
   */
  const play = useCallback(async () => {
    if (!playerRef.current || !getAudioContext() || !outputNodeRef.current || !bufferWriterRef.current) {
      console.warn('[useAdPlugPlayer] play() 호출됨 - 플레이어 준비 안됨');
      return;
    }
    if (!playerRef.current.isFileLoaded()) {
      console.warn('[useAdPlugPlayer] play() 호출됨 - 파일 로드 안됨');
      return;
    }

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

    // 일시정지에서 재개하는 경우가 아니면 리셋
    if (!isPausedRef.current) {
      totalSamplesSentRef.current = 0;
      trackEndCallbackFiredRef.current = false;
      pendingSamplesRef.current = null;
      pendingOffsetRef.current = 0;
      playerRef.current.rewind();

      setState(prev => prev ? {
        ...prev,
        currentByte: 0,
        currentTick: 0,
      } : null);

      // 초기 버퍼 채우기 (여러 번 호출해서 충분히 채움)
      isPlayingRef.current = true;
      playerRef.current.setIsPlaying(true);
      for (let i = 0; i < 5; i++) {
        fillBuffer();
      }
    } else {
      isPlayingRef.current = true;
      playerRef.current.setIsPlaying(true);
    }

    isPausedRef.current = false;

    // 재생 시작
    outputNodeRef.current.start();

    // 버퍼 채우기 인터벌 시작
    startFillInterval();

    setState(prev => prev ? {
      ...prev,
      isPlaying: true,
      isPaused: false,
    } : null);
  }, [ensureAudioContextReady, audioElementRef, getAudioContext, fillBuffer, startFillInterval]);

  /**
   * 일시정지
   */
  const pause = useCallback(() => {
    if (!playerRef.current) return;

    isPlayingRef.current = false;
    isPausedRef.current = true;
    stopFillInterval();

    if (audioElementRef?.current && !audioElementRef.current.paused) {
      audioElementRef.current.pause();
    }

    setState(prev => prev ? {
      ...prev,
      isPlaying: false,
      isPaused: true,
    } : null);
  }, [audioElementRef, stopFillInterval]);

  /**
   * 정지
   */
  const stop = useCallback(() => {
    if (!playerRef.current) return;

    isPlayingRef.current = false;
    isPausedRef.current = false;
    stopFillInterval();
    playerRef.current.rewind();

    // OutputStreamNode 정지
    if (outputNodeRef.current) {
      outputNodeRef.current.stop().catch(() => {});
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
  }, [audioElementRef, stopFillInterval]);

  /**
   * 볼륨 설정 (호환성용)
   */
  const setVolume = useCallback((volume: number) => {
    setState(prev => prev ? { ...prev, volume } : null);
  }, []);

  /**
   * 템포 설정 (호환성용)
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
    if (playerRef.current) {
      playerRef.current.setLoopEnabled(enabled);
    }
  }, []);

  /**
   * 플레이어 준비 상태 확인
   */
  const checkPlayerReady = useCallback(() => {
    return !!(playerRef.current && getAudioContext());
  }, [getAudioContext]);

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
    hardReset,
    refreshState,
  };
}
