/**
 * useVGMPlayer.ts - VGM 플레이어 React 훅
 *
 * Web Audio API와 VGMPlayer를 연결하는 React 훅
 * VGM은 샘플 기반 처리 (IMS/ROL의 틱 기반과 다름)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { RefObject } from "react";
import { VGMPlayer } from "../vgm/vgm-player";
import { OPLEngine } from "../rol/opl-engine";
import { parseVGM, VGM_SAMPLE_RATE } from "../vgm/vgm-parser";
import type { VGMPlaybackState } from "../vgm/vgm-types";

// VGM state를 IMS/ROL과 호환되는 형태로 변환
interface CompatiblePlaybackState {
  isPlaying: boolean;
  isPaused: boolean;
  currentByte: number;    // VGM에서는 currentSample 사용
  totalSize: number;      // VGM에서는 totalSamples 사용
  tempo: number;
  volume: number;
  currentTempo: number;
  currentTick: number;    // VGM에서는 사용 안 함 (0 고정)
  currentVolumes: number[];
  instrumentNames: string[];
  channelMuted: boolean[];
  fileName?: string;
  songName?: string;
  activeNotes?: Array<{ channel: number; note: number }>;
}

interface UseVGMPlayerOptions {
  vgmFile: File | null;
  fileLoadKey?: number;
  forceReloadRef?: RefObject<boolean>;
  onTrackEnd?: () => void;
  sharedAudioContextRef?: RefObject<AudioContext | null>;
}

interface UseVGMPlayerReturn {
  state: CompatiblePlaybackState | null;
  isLoading: boolean;
  error: string | null;
  isPlayerReady: boolean;

  play: () => void;
  pause: () => void;
  stop: () => void;

  setVolume: (volume: number) => void;
  setTempo: (tempo: number) => void;
  setMasterVolume: (volume: number) => void;
  setLoopEnabled: (enabled: boolean) => void;
  toggleChannel: (ch: number) => void;

  checkPlayerReady: () => boolean;
}

/**
 * VGM 플레이어 React 훅
 */
export function useVGMPlayer({
  vgmFile,
  fileLoadKey,
  forceReloadRef,
  onTrackEnd,
  sharedAudioContextRef,
}: UseVGMPlayerOptions): UseVGMPlayerReturn {
  const [state, setState] = useState<CompatiblePlaybackState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlayerReady, setIsPlayerReady] = useState(false);

  const playerRef = useRef<VGMPlayer | null>(null);
  const localAudioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const uiUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fileNameRef = useRef<string>("");

  // 백그라운드 처리
  const wasPlayingBeforeBackgroundRef = useRef<boolean>(false);
  const trackEndCallbackFiredRef = useRef<boolean>(false);

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
   * VGM PlaybackState를 호환 형태로 변환
   */
  const convertState = useCallback((vgmState: VGMPlaybackState, fileName: string): CompatiblePlaybackState => {
    // 9채널 볼륨을 11채널로 확장 (마지막 2개는 퍼커션용, 0으로 설정)
    const channelVolumes = [...vgmState.channelVolumes, 0, 0];

    return {
      isPlaying: vgmState.isPlaying,
      isPaused: vgmState.isPaused,
      currentByte: vgmState.currentSample,
      totalSize: vgmState.totalSamples,
      tempo: 100,
      volume: vgmState.volume,
      currentTempo: 120, // VGM은 고정 템포 (표시용)
      currentTick: 0,    // VGM은 틱 사용 안 함
      currentVolumes: channelVolumes,
      instrumentNames: new Array(11).fill('VGM'), // VGM은 악기명 없음
      channelMuted: new Array(11).fill(false),
      fileName,
      songName: fileName.replace(/\.(vgm|vgz)$/i, ''),
      activeNotes: vgmState.activeNotes,
    };
  }, []);

  /**
   * VGM 파일 로드 및 플레이어 초기화
   */
  useEffect(() => {
    if (!vgmFile) {
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
        const vgmBuffer = await vgmFile.arrayBuffer();

        if (cancelled) return;

        // VGM 파일 파싱
        const vgmData = parseVGM(vgmBuffer);

        // OPL 엔진 생성
        const oplEngine = new OPLEngine();

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
          audioContext = new AudioContext();
          setAudioContext(audioContext);
        }

        // VGM 플레이어 생성 및 초기화
        const player = new VGMPlayer(vgmData, oplEngine);
        await player.initialize(audioContext.sampleRate);

        if (cancelled) return;

        playerRef.current = player;

        // 오디오 프로세서 초기화
        if (processorRef.current) {
          processorRef.current.disconnect();
          processorRef.current = null;
        }
        initializeAudioProcessor(audioContext);

        // 트랙 종료 콜백 플래그 리셋
        trackEndCallbackFiredRef.current = false;

        // 초기 상태 설정
        fileNameRef.current = vgmFile.name;
        setState(convertState(player.getState(), vgmFile.name));
        setIsPlayerReady(true);
        setIsLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error('[useVGMPlayer initializePlayer] 에러:', err);
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
  }, [vgmFile, fileLoadKey]);

  /**
   * 오디오 프로세서 초기화
   * VGM은 샘플 기반이므로 틱 처리 없이 직접 샘플 생성
   */
  const initializeAudioProcessor = useCallback((audioContext: AudioContext) => {
    const bufferSize = 2048;
    const processor = audioContext.createScriptProcessor(bufferSize, 0, 2);

    processor.onaudioprocess = (e) => {
      if (!playerRef.current) return;

      const player = playerRef.current;
      const vgmState = player.getState();

      // 트랙 종료 감지
      if (player.hasEnded()) {
        if (!trackEndCallbackFiredRef.current && onTrackEnd) {
          trackEndCallbackFiredRef.current = true;
          setTimeout(() => onTrackEnd(), 0);
        }
      }

      // 재생 중이 아니면 무음
      if (!vgmState.isPlaying) return;

      const outputBuffer = e.outputBuffer;
      const outputL = outputBuffer.getChannelData(0);
      const outputR = outputBuffer.getChannelData(1);
      const lenFill = outputBuffer.length;

      // VGM은 샘플 기반이므로 직접 생성
      const samples = player.generateSamples(lenFill);

      for (let i = 0; i < lenFill; i++) {
        outputL[i] = samples[i * 2] / 32768.0;
        outputR[i] = samples[i * 2 + 1] / 32768.0;
      }
    };

    // GainNode 생성
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.5;
    gainNodeRef.current = gainNode;

    processor.connect(gainNode);
    gainNode.connect(audioContext.destination);
    processorRef.current = processor;
  }, [onTrackEnd]);

  /**
   * 정리 함수
   */
  const cleanup = useCallback(() => {
    if (uiUpdateIntervalRef.current) {
      clearInterval(uiUpdateIntervalRef.current);
      uiUpdateIntervalRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
  }, []);

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
      } catch {
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    }
    return false;
  };

  /**
   * AudioContext 상태 확인 및 복구
   */
  const ensureAudioContextReady = useCallback(async (): Promise<boolean> => {
    const currentContext = getAudioContext();
    if (!currentContext) return false;

    if (currentContext.state === 'closed') {
      try {
        const newAudioContext = new AudioContext();
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
      } catch {
        return false;
      }
    }

    if (currentContext.state === 'suspended') {
      return await attemptResume(currentContext);
    }

    return true;
  }, [getAudioContext, setAudioContext, initializeAudioProcessor]);

  /**
   * Page Visibility API 처리
   */
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (!playerRef.current) return;

      const player = playerRef.current;

      if (document.hidden) {
        // 백그라운드 진입: 재생 상태 저장, UI 타이머 중지
        wasPlayingBeforeBackgroundRef.current = player.getState().isPlaying;

        if (uiUpdateIntervalRef.current) {
          clearInterval(uiUpdateIntervalRef.current);
          uiUpdateIntervalRef.current = null;
        }
      } else {
        // 포그라운드 복귀: AudioContext 복구 및 UI 타이머 재시작
        const currentContext = getAudioContext();
        if (currentContext && currentContext.state === 'suspended') {
          try {
            await currentContext.resume();
          } catch (e) {
            console.warn('[useVGMPlayer] AudioContext resume failed:', e);
          }
        }

        // UI 타이머 재시작 (재생 중인 경우)
        if (player.getState().isPlaying && !uiUpdateIntervalRef.current) {
          uiUpdateIntervalRef.current = setInterval(() => {
            if (playerRef.current) {
              setState(convertState(playerRef.current.getState(), fileNameRef.current));
            }
          }, 100);
        }

        // 즉시 상태 업데이트
        setState(convertState(player.getState(), fileNameRef.current));
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [getAudioContext, convertState]);

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
    playerRef.current.play();

    uiUpdateIntervalRef.current = setInterval(() => {
      if (playerRef.current) {
        setState(convertState(playerRef.current.getState(), fileNameRef.current));
      }
    }, 100);

    setState(convertState(playerRef.current.getState(), fileNameRef.current));
  }, [ensureAudioContextReady, convertState, getAudioContext]);

  /**
   * 일시정지
   */
  const pause = useCallback(() => {
    if (!playerRef.current) return;

    playerRef.current.pause();

    if (uiUpdateIntervalRef.current) {
      clearInterval(uiUpdateIntervalRef.current);
      uiUpdateIntervalRef.current = null;
    }

    setState(convertState(playerRef.current.getState(), fileNameRef.current));
  }, [convertState]);

  /**
   * 정지
   */
  const stop = useCallback(() => {
    if (!playerRef.current) return;

    playerRef.current.stop();

    if (uiUpdateIntervalRef.current) {
      clearInterval(uiUpdateIntervalRef.current);
      uiUpdateIntervalRef.current = null;
    }

    setState(convertState(playerRef.current.getState(), fileNameRef.current));
  }, [convertState]);

  /**
   * 볼륨 설정 (0-127)
   */
  const setVolume = useCallback((volume: number) => {
    if (!playerRef.current) return;
    playerRef.current.setVolume(volume);
    setState(convertState(playerRef.current.getState(), fileNameRef.current));
  }, [convertState]);

  /**
   * 템포 설정 (VGM은 템포 변경 불가 - 무시)
   */
  const setTempo = useCallback((_tempo: number) => {
    // VGM은 샘플 기반이라 템포 변경 불가
  }, []);

  /**
   * 루프 설정
   */
  const setLoopEnabled = useCallback((enabled: boolean) => {
    if (!playerRef.current) return;
    playerRef.current.setLoopEnabled(enabled);
  }, []);

  /**
   * 채널 토글 (VGM은 채널 제어 불가 - 무시)
   */
  const toggleChannel = useCallback((_ch: number) => {
    // VGM은 레지스터 직접 쓰기라 채널 뮤트 불가
  }, []);

  /**
   * 마스터 볼륨
   */
  const setMasterVolume = useCallback((volume: number) => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume / 100;
    }
  }, []);

  /**
   * playerRef 직접 확인
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
    setLoopEnabled,
    toggleChannel,
    checkPlayerReady,
  };
}
