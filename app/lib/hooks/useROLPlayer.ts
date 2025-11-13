/**
 * useROLPlayer.ts - ROL 플레이어 React 훅
 *
 * Web Audio API와 ROLPlayer를 연결하는 React 훅
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { ROLPlayer } from "../rol/rol-player";
import { OPLEngine } from "../rol/opl-engine";
import { parseROL } from "../rol/rol-parser";
import type { PlaybackState } from "../rol/types";

interface UseROLPlayerOptions {
  rolFile: File | null;
  bnkFile: File | null;
}

interface UseROLPlayerReturn {
  // 상태
  state: PlaybackState | null;
  isLoading: boolean;
  error: string | null;

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
  toggleChannel: (ch: number) => void;
}

/**
 * ROL 플레이어 React 훅
 */
export function useROLPlayer({
  rolFile,
  bnkFile,
}: UseROLPlayerOptions): UseROLPlayerReturn {
  const [state, setState] = useState<PlaybackState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 채널 뮤트 상태 (재생 전에도 설정 가능)
  const [channelMuted, setChannelMuted] = useState<boolean[]>(new Array(11).fill(false));

  const playerRef = useRef<ROLPlayer | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const uiUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fileNameRef = useRef<string>("");

  // 생성해야 할 샘플 수 (예제와 같은 방식)
  const lenGenRef = useRef<number>(0);
  const lastTickTimeRef = useRef<number>(0);

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

        // Web Audio API 초기화 (먼저 AudioContext 생성하여 샘플레이트 확보)
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;

        // ROL 플레이어 생성 및 초기화 (AudioContext 샘플레이트 전달)
        const player = new ROLPlayer(rolData, bnkBuffer, oplEngine);
        await player.initialize(audioContext.sampleRate);

        // 채널 뮤트 상태 적용
        for (let i = 0; i < channelMuted.length; i++) {
          if (channelMuted[i]) {
            player.toggleChannel(i);
          }
        }

        if (cancelled) {
          return;
        }

        playerRef.current = player;

        // 오디오 프로세서 초기화
        initializeAudioProcessor(audioContext);

        // 초기 상태 설정
        fileNameRef.current = rolFile.name; // fileNameRef 업데이트
        setState({
          ...player.getState(),
          fileName: rolFile.name,
          channelMuted: channelMuted.slice(0, rolData.channelNum),
        });
        setIsLoading(false);
      } catch (err) {
        if (!cancelled) {
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
  }, [rolFile, bnkFile]);

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
  }, []);

  /**
   * 정리 함수
   */
  const cleanup = useCallback(() => {
    // UI 업데이트 타이머 정리
    if (uiUpdateIntervalRef.current) {
      clearInterval(uiUpdateIntervalRef.current);
      uiUpdateIntervalRef.current = null;
    }

    // 오디오 컨텍스트 정리
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    lenGenRef.current = 0;
    playerRef.current = null;
  }, []);


  /**
   * 재생 시작
   */
  const play = useCallback(() => {
    if (!playerRef.current || !audioContextRef.current) {
      return;
    }

    // AudioContext resume (브라우저 정책)
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }

    playerRef.current.play();

    lenGenRef.current = 0;

    // UI는 30fps로 업데이트
    uiUpdateIntervalRef.current = setInterval(() => {
      if (playerRef.current) {
        setState({
      ...playerRef.current.getState(),
      fileName: fileNameRef.current,
    });
      }
    }, 33);

    setState({
      ...playerRef.current.getState(),
      fileName: fileNameRef.current,
    });
  }, []);

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

    setState({
      ...playerRef.current.getState(),
      fileName: fileNameRef.current,
    });
  }, []);

  /**
   * 정지
   */
  const stop = useCallback(() => {
    if (!playerRef.current) return;

    playerRef.current.stop();
    lenGenRef.current = 0;

    if (uiUpdateIntervalRef.current) {
      clearInterval(uiUpdateIntervalRef.current);
      uiUpdateIntervalRef.current = null;
    }

    setState({
      ...playerRef.current.getState(),
      fileName: fileNameRef.current,
    });
  }, []);

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

  const toggleChannel = useCallback((ch: number) => {
    // Hook의 뮤트 상태 업데이트
    setChannelMuted(prev => {
      const newMuted = [...prev];
      newMuted[ch] = !newMuted[ch];
      return newMuted;
    });

    // 플레이어가 있으면 플레이어에도 적용
    if (playerRef.current) {
      playerRef.current.toggleChannel(ch);
      setState({
        ...playerRef.current.getState(),
        fileName: fileNameRef.current,
      });
    } else {
      // 플레이어가 없어도 state 업데이트 (UI 반영용)
      setState(prev => {
        const newChannelMuted = [...(prev?.channelMuted || new Array(11).fill(false))];
        newChannelMuted[ch] = !newChannelMuted[ch];

        // state가 없으면 기본 state 생성
        if (!prev) {
          return {
            isPlaying: false,
            isPaused: false,
            currentByte: 0,
            totalSize: 0,
            tempo: 100,
            volume: 100,
            keyTranspose: 0,
            channelVolumes: Array(11).fill(127),
            currentTempo: 0,
            currentVolumes: Array(11).fill(0),
            instrumentNames: [],
            channelMuted: newChannelMuted,
            fileName: "",
          };
        }

        return {
          ...prev,
          channelMuted: newChannelMuted,
        };
      });
    }
  }, []);

  return {
    state,
    isLoading,
    error,
    play,
    pause,
    stop,
    setVolume,
    setTempo,
    setMasterVolume,
    setKeyTranspose,
    setChannelVolume,
    setLoopEnabled,
    toggleChannel,
  };
}
