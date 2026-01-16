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
  hardReset: () => Promise<void>;  // 트랙 전환 시 완전 리셋
}

const SAMPLE_RATE = 44100; // Standard audio sample rate

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

  // 틱 동기화를 위한 시간 추적
  const playbackStartTimeRef = useRef<number>(0);
  const totalSamplesSentRef = useRef<number>(0); // samplesPerTick 계산용

  // ISS 동기화를 위한 refresh rate와 워크렛 출력 샘플 추적
  const refreshRateRef = useRef<number>(70.0);  // 초당 틱수
  const workletSamplesOutputRef = useRef<number>(0);  // 워크렛이 실제 출력한 샘플 수

  // 워크렛 콜백에서 사용할 함수 ref (클로저 문제 방지)
  const generateAndSendSamplesRef = useRef<() => void>(() => {});

  // Float32Array 버퍼 재사용 (메모리 할당 최적화)
  const floatBufferRef = useRef<Float32Array | null>(null);

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

    // 플레이어가 파일을 로드하지 않았으면 무시
    if (!player.isFileLoaded()) {
      return;
    }

    const { samples, finished } = player.generateSamples();

    if (samples.length > 0) {
      // 버퍼 재사용 (크기가 다르면 재할당)
      if (!floatBufferRef.current || floatBufferRef.current.length !== samples.length) {
        floatBufferRef.current = new Float32Array(samples.length);
      }

      // Int16 -> Float32 변환 (곱셈 사용, 나눗셈보다 빠름)
      const scale = 1 / 32768.0;
      const floatSamples = floatBufferRef.current;
      for (let i = 0; i < samples.length; i++) {
        floatSamples[i] = samples[i] * scale;
      }

      // 전송된 샘플 수 추적 (스테레오이므로 /2)
      totalSamplesSentRef.current += samples.length / 2;

      // 워크렛으로 전송 (복사본 전송 - Transferable로 원본 버퍼 손실 방지)
      const transferBuffer = floatSamples.slice();
      workletNodeRef.current.port.postMessage({
        type: 'samples',
        samples: transferBuffer
      }, [transferBuffer.buffer]);
    }

    // 트랙 종료 처리 (최소 1초 이상 재생 후에만)
    // 44100Hz에서 1초 = 44100 샘플
    const minSamplesBeforeEnd = SAMPLE_RATE;
    // 버퍼에 남은 샘플 수 확인 (실제 스피커 출력까지 기다림)
    const samplesInBuffer = totalSamplesSentRef.current - workletSamplesOutputRef.current;
    const bufferThreshold = SAMPLE_RATE * 0.05; // 50ms 이하일 때만 종료
    if (finished && totalSamplesSentRef.current >= minSamplesBeforeEnd && samplesInBuffer <= bufferThreshold) {
      if (loopEnabledRef.current) {
        player.rewind();
        totalSamplesSentRef.current = 0;
        playbackStartTimeRef.current = performance.now();
        trackEndCallbackFiredRef.current = false;
      } else {
        isPlayingRef.current = false;
        // 시간 추적 리셋 (다음 트랙 전환 전 깨끗한 상태로)
        playbackStartTimeRef.current = 0;
        totalSamplesSentRef.current = 0;
        if (!trackEndCallbackFiredRef.current && onTrackEnd) {
          trackEndCallbackFiredRef.current = true;
          setTimeout(() => onTrackEnd(), 0);
        }
      }
    }
  }, [onTrackEnd]);

  // ref 업데이트 (워크렛 콜백에서 항상 최신 함수 사용)
  useEffect(() => {
    generateAndSendSamplesRef.current = generateAndSendSamples;
  }, [generateAndSendSamples]);

  /**
   * 샘플 생성 시작 (초기 버퍼 채우기)
   * 이후 샘플 생성은 워크렛의 needSamples 요청에 의해 처리됨
   */
  const startSampleGeneration = useCallback(() => {
    // 초기 버퍼 채우기 (32번 - 512샘플 * 32 = 16384 프레임, ~370ms at 44100Hz)
    for (let i = 0; i < 32; i++) {
      generateAndSendSamples();
    }
  }, [generateAndSendSamples]);

  /**
   * 샘플 생성 중지 (워크렛 요청 무시를 위해 isPlayingRef만 확인)
   */
  const stopSampleGeneration = useCallback(() => {
    // 워크렛 기반이므로 별도 정리 필요 없음
    // isPlayingRef가 false가 되면 needSamples 요청이 무시됨
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
        // 상태를 null로 설정하지 않고 현재 값 유지 (깜빡임 방지)
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
          // 워크렛도 무효화 (새 AudioContext에 연결해야 함)
          if (workletNodeRef.current) {
            workletNodeRef.current.port.onmessage = null;
            workletNodeRef.current.port.close();
            workletNodeRef.current.disconnect();
            workletNodeRef.current = null;
          }
          if (gainNodeRef.current) {
            gainNodeRef.current.disconnect();
            gainNodeRef.current = null;
          }
          if (analyserNodeRef.current) {
            analyserNodeRef.current.disconnect();
            analyserNodeRef.current = null;
            setAnalyserNode(null);
          }
          if (mediaStreamDestRef.current) {
            mediaStreamDestRef.current = null;
          }
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
        console.log('[useAdPlugPlayer] AudioContext sampleRate:', audioContext.sampleRate);
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

        // Refresh rate 저장 (ISS 틱 계산용)
        refreshRateRef.current = player.getRefreshRate();

        // 샘플/시간 추적 리셋
        totalSamplesSentRef.current = 0;
        playbackStartTimeRef.current = 0;
        workletSamplesOutputRef.current = 0;

        // 트랙 종료 콜백 플래그 리셋
        trackEndCallbackFiredRef.current = false;

        // 오디오 프로세서 초기화 (매번 새로 생성하여 클린한 상태 보장)
        if (workletNodeRef.current) {
          workletNodeRef.current.port.onmessage = null;  // 핸들러 제거
          workletNodeRef.current.port.close();  // 메시지 포트 종료
          workletNodeRef.current.disconnect();
          workletNodeRef.current = null;
        }
        if (gainNodeRef.current) {
          gainNodeRef.current.disconnect();
          gainNodeRef.current = null;
        }
        if (analyserNodeRef.current) {
          analyserNodeRef.current.disconnect();
          analyserNodeRef.current = null;
          setAnalyserNode(null);
        }
        if (mediaStreamDestRef.current) {
          mediaStreamDestRef.current = null;
        }
        await initializeAudioProcessor(audioContext);

        // 초기 상태 설정
        fileNameRef.current = musicFile.name;
        const lowerName = musicFile.name.toLowerCase();
        isVgmFileRef.current = lowerName.endsWith('.vgm') || lowerName.endsWith('.vgz');
        const playerState = player.getState();

        setState({
          isPlaying: false,
          isPaused: false,
          currentByte: 0,  // 항상 0부터 시작
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

    // 워크렛에서 메시지 수신 (ref 사용하여 항상 최신 함수 호출)
    workletNode.port.onmessage = (event) => {
      // 위치 업데이트 (주기적으로 전송됨)
      if (event.data.type === 'position') {
        if (event.data.samplesOutput !== undefined) {
          workletSamplesOutputRef.current = event.data.samplesOutput;
        }
        return;
      }

      // 샘플 요청
      if (event.data.type === 'needSamples' && isPlayingRef.current) {
        // 워크렛 출력 샘플 수 업데이트 (ISS 동기화용)
        if (event.data.samplesOutput !== undefined) {
          workletSamplesOutputRef.current = event.data.samplesOutput;
        }

        // 버퍼가 부족하면 여러 번 생성하여 빠르게 채움
        const frames = event.data.frames || 0;
        const samplesToGenerate = Math.max(1, Math.ceil((16384 - frames) / 512));
        for (let i = 0; i < samplesToGenerate; i++) {
          generateAndSendSamplesRef.current();
        }
      }
    };

    // GainNode 생성 (VGM은 1.75배 볼륨)
    const gainNode = audioContext.createGain();
    const baseGain = isVgmFileRef.current ? 1.75 : 1.0;
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
  }, [audioElementRef]);

  /**
   * 실제 재생된 틱 계산 (WASM tick - 버퍼 지연)
   */
  const getPlayedTick = useCallback(() => {
    if (!isPlayingRef.current || !playerRef.current) return 0;

    // WASM의 현재 tick (생성된 샘플까지의 tick)
    const wasmTick = playerRef.current.getCurrentTick();

    // 버퍼 지연 계산: WASM에서 보낸 샘플 - 워크렛에서 출력한 샘플
    const samplesInBuffer = totalSamplesSentRef.current - workletSamplesOutputRef.current;

    // 버퍼에 남은 샘플을 tick으로 변환
    const samplesPerTick = SAMPLE_RATE / refreshRateRef.current;
    const ticksInBuffer = Math.floor(Math.max(0, samplesInBuffer) / samplesPerTick);

    // 실제 재생된 tick = WASM tick - 버퍼에 남은 tick
    const playedTick = Math.max(0, wasmTick - ticksInBuffer);

    return playedTick;
  }, []);

  /**
   * 재생된 시간 계산 (ms) - 워크렛 출력 샘플 기반
   */
  const getPlayedPositionMs = useCallback(() => {
    if (!isPlayingRef.current) {
      return 0;
    }
    // 워크렛이 실제로 출력한 샘플 수 기준으로 시간 계산
    const samplesOutput = workletSamplesOutputRef.current;
    const playedMs = Math.floor((samplesOutput / SAMPLE_RATE) * 1000);
    return playedMs;
  }, []);

  /**
   * 상태 갱신 (외부에서 호출)
   */
  const refreshState = useCallback(() => {
    if (playerRef.current) {
      const playerState = playerRef.current.getState();
      const currentTick = getPlayedTick();
      // WASM position 대신 경과 시간 기반으로 계산
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
   * 정리 함수 (트랙 전환 시 - 오디오 노드는 유지)
   * 버퍼 클리어는 hardReset()에서 처리하므로 여기서는 하지 않음
   */
  const cleanup = useCallback(() => {
    // 재생 상태 먼저 중지 (워크렛 요청 무시하도록)
    isPlayingRef.current = false;
    isPausedRef.current = false;

    // 시간 추적 리셋 (다음 트랙에서 잘못된 시간 표시 방지)
    playbackStartTimeRef.current = 0;
    totalSamplesSentRef.current = 0;

    stopSampleGeneration();

    // 플레이어만 정리 (WASM 상태 리셋)
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }
  }, [stopSampleGeneration]);

  /**
   * 완전 리셋 (트랙 전환 시 모든 상태 초기화)
   * - 시간/틱 값 리셋
   * - UI 상태 리셋
   * 주의: 워크렛은 initializePlayer()에서 매번 새로 생성되므로 버퍼 클리어 불필요
   */
  const hardReset = useCallback(async () => {
    // 재생 상태 즉시 중지 (needSamples 요청 무시)
    isPlayingRef.current = false;
    isPausedRef.current = false;

    // 시간 추적 완전 리셋
    playbackStartTimeRef.current = 0;
    totalSamplesSentRef.current = 0;
    workletSamplesOutputRef.current = 0;

    // 트랙 종료 콜백 플래그 리셋
    trackEndCallbackFiredRef.current = false;

    stopSampleGeneration();

    // UI 상태 즉시 리셋
    setState(prev => prev ? {
      ...prev,
      isPlaying: false,
      isPaused: false,
      currentByte: 0,
      currentTick: 0,
    } : null);
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
        workletNodeRef.current.port.onmessage = null;
        workletNodeRef.current.port.close();
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
    // 플레이어가 준비되지 않았거나 파일이 로드되지 않았으면 무시
    if (!playerRef.current || !getAudioContext()) {
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
      // 시간 추적 완전 리셋
      playbackStartTimeRef.current = 0;
      totalSamplesSentRef.current = 0;
      workletSamplesOutputRef.current = 0;
      trackEndCallbackFiredRef.current = false;

      // 플레이어 되감기 (처음부터 시작)
      playerRef.current.rewind();

      // UI 상태 즉시 0으로 리셋
      setState(prev => prev ? {
        ...prev,
        currentByte: 0,
        currentTick: 0,
      } : null);
    }

    // 샘플 생성 전에 상태 설정 (needSamples 요청 방지)
    isPlayingRef.current = true;
    isPausedRef.current = false;
    playerRef.current.setIsPlaying(true);

    // 초기 버퍼링: 정확히 4배치 생성 (새 재생과 동일)
    // 이 시점에서 worklet 버퍼는 비어있음
    startSampleGeneration();

    // 버퍼링 완료 후 시간 측정 시작 (ISS 동기화의 기준점)
    playbackStartTimeRef.current = performance.now();

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
   * 마스터 볼륨 설정 (VGM은 1.75배 보정 적용)
   */
  const setMasterVolume = useCallback((volume: number) => {
    if (gainNodeRef.current) {
      const baseGain = isVgmFileRef.current ? 1.75 : 1.0;
      gainNodeRef.current.gain.value = (volume / 100) * baseGain;
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
    hardReset,
    refreshState,
  };
}
