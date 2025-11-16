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
  toggleChannel: (ch: number) => void;

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

  // 백그라운드 진입 전 재생 상태 저장
  const wasPlayingBeforeBackgroundRef = useRef<boolean>(false);

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

        // Web Audio API 초기화 (기존 AudioContext 재사용 - Safari autoplay 정책)
        let audioContext = audioContextRef.current;
        if (!audioContext || audioContext.state === 'closed') {
          audioContext = new AudioContext();
          audioContextRef.current = audioContext;
        }

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

        // 오디오 프로세서 초기화 (기존 프로세서가 있으면 정리 후 재생성)
        if (processorRef.current) {
          processorRef.current.disconnect();
          processorRef.current = null;
        }
        initializeAudioProcessor(audioContext);

        // 샘플 생성 카운터 초기화 (이전 재생의 잔여 값 제거)
        lenGenRef.current = 0;

        // 초기 상태 설정
        fileNameRef.current = rolFile.name; // fileNameRef 업데이트

        // 플레이어 준비 완료를 먼저 설정 (playerRef가 설정된 직후)
        setIsPlayerReady(true);

        setState({
          ...player.getState(),
          fileName: rolFile.name,
          channelMuted: channelMuted.slice(0, rolData.channelNum),
        });
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
   * Page Visibility API: 백그라운드/포그라운드 전환 처리
   */
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (!playerRef.current || !audioContextRef.current) {
        return;
      }

      const audioContext = audioContextRef.current;
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
        // 포그라운드 복귀: AudioContext 상태 확인 및 복구
        console.log('[useROLPlayer] Returning from background. AudioContext state:', audioContext.state);

        if (audioContext.state === "closed") {
          // iOS Safari가 AudioContext를 완전히 종료함 → 재생성 필요
          try {
            console.log('[useROLPlayer] AudioContext is closed. Recreating...');

            // 새 AudioContext 생성
            const newAudioContext = new AudioContext();
            audioContextRef.current = newAudioContext;

            // AudioContext resume (새로 생성된 컨텍스트도 suspended일 수 있음)
            if (newAudioContext.state === "suspended") {
              const resumePromise = newAudioContext.resume();
              const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('AudioContext resume timeout')), 3000)
              );
              await Promise.race([resumePromise, timeoutPromise]);
            }

            // ScriptProcessorNode 재생성
            if (processorRef.current) {
              processorRef.current.disconnect();
              processorRef.current = null;
            }
            initializeAudioProcessor(newAudioContext);

            console.log('[useROLPlayer] AudioContext recreated successfully');
          } catch (error) {
            console.error('[useROLPlayer] Failed to recreate AudioContext:', error);
          }
        } else if (audioContext.state === "suspended") {
          // 일반적인 suspended 상태 → resume 시도
          try {
            const resumePromise = audioContext.resume();
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('AudioContext resume timeout')), 3000)
            );
            await Promise.race([resumePromise, timeoutPromise]);
            console.log('[useROLPlayer] AudioContext resumed after returning from background');
          } catch (error) {
            console.error('[useROLPlayer] Failed to resume AudioContext:', error);
            // resume 실패 시 재생성 시도
            try {
              console.log('[useROLPlayer] Attempting to recreate AudioContext after resume failure...');
              const newAudioContext = new AudioContext();
              audioContextRef.current = newAudioContext;

              if (newAudioContext.state === "suspended") {
                await newAudioContext.resume();
              }

              if (processorRef.current) {
                processorRef.current.disconnect();
                processorRef.current = null;
              }
              initializeAudioProcessor(newAudioContext);

              console.log('[useROLPlayer] AudioContext recreated after resume failure');
            } catch (recreateError) {
              console.error('[useROLPlayer] Failed to recreate AudioContext:', recreateError);
            }
          }
        }

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
          uiUpdateIntervalRef.current = setInterval(() => {
            if (playerRef.current) {
              setState({
                ...playerRef.current.getState(),
                fileName: fileNameRef.current,
              });
            }
          }, 33);

          // 즉시 상태 업데이트
          setState({
            ...player.getState(),
            fileName: fileNameRef.current,
          });
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
            }, 33);
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []); // dependency 없음 - ref를 통해 최신 값 접근


  /**
   * 재생 시작
   */
  const play = useCallback(async () => {
    if (!playerRef.current || !audioContextRef.current) {
      return;
    }

    const audioContext = audioContextRef.current;

    // AudioContext resume (Safari autoplay 정책: await 필요)
    if (audioContext.state === "suspended") {
      try {
        // Safari에서 resume()이 영원히 pending될 수 있으므로 타임아웃 추가
        const resumePromise = audioContext.resume();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('AudioContext resume timeout')), 3000)
        );

        await Promise.race([resumePromise, timeoutPromise]);

        // 재개 후에도 suspended 상태라면 경고
        if (audioContext.state === "suspended") {
          console.warn('[useROLPlayer.play] AudioContext가 여전히 suspended 상태입니다. Safari autoplay 정책으로 차단되었을 수 있습니다.');
        }
      } catch (error) {
        console.error('[useROLPlayer.play] AudioContext 재개 실패:', error);
        console.warn('[useROLPlayer.play] 재생을 계속 시도하지만 소리가 나지 않을 수 있습니다.');
      }
    }

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
  }, [
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

  /**
   * playerRef 직접 확인 (stale state 회피)
   */
  const checkPlayerReady = useCallback(() => {
    return !!(playerRef.current && audioContextRef.current);
  }, []);

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
    toggleChannel,
    checkPlayerReady,
  };
}
