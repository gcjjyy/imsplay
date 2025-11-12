/**
 * useIMSPlayer.ts - IMS 플레이어 React 훅
 *
 * Web Audio API와 IMSPlayer를 연결하는 React 훅
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { IMSPlayer } from "../ims/ims-player";
import { OPLEngine } from "../rol/opl-engine";
import { parseIMS } from "../ims/ims-parser";
import type { IMSPlaybackState } from "../ims/ims-types";

interface UseIMSPlayerOptions {
  imsFile: File | null;
  bnkFile: File | null;
}

interface UseIMSPlayerReturn {
  // 상태
  state: IMSPlaybackState | null;
  isLoading: boolean;
  error: string | null;

  // 재생 제어
  play: () => void;
  pause: () => void;
  stop: () => void;

  // 설정 제어
  setVolume: (volume: number) => void;
  setTempo: (tempo: number) => void;
  setLoopEnabled: (enabled: boolean) => void;
  toggleChannel: (ch: number) => void;
}

/**
 * IMS 플레이어 React 훅
 */
export function useIMSPlayer({
  imsFile,
  bnkFile,
}: UseIMSPlayerOptions): UseIMSPlayerReturn {
  const [state, setState] = useState<IMSPlaybackState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 채널 뮤트 상태 (재생 전에도 설정 가능)
  const [channelMuted, setChannelMuted] = useState<boolean[]>(new Array(11).fill(false));

  const playerRef = useRef<IMSPlayer | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const uiUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fileNameRef = useRef<string>("");

  // 생성해야 할 샘플 수 (예제와 같은 방식)
  const lenGenRef = useRef<number>(0);

  /**
   * IMS/BNK 파일 로드 및 플레이어 초기화
   */
  useEffect(() => {
    console.log("[useIMSPlayer useEffect] 실행 - imsFile:", imsFile?.name, "bnkFile:", bnkFile?.name);

    if (!imsFile || !bnkFile) {
      console.log("[useIMSPlayer useEffect] 파일 없음, 종료");
      return;
    }

    let cancelled = false;

    const initializePlayer = async () => {
      try {
        console.log("[initializePlayer] 시작");
        console.log("[initializePlayer] setState(null) 호출 - 이전 상태 제거");
        setState(null); // 이전 플레이어 상태 제거
        console.log("[initializePlayer] setState(null) 호출 완료");
        setIsLoading(true);
        setError(null);

        // 파일 읽기
        console.log("[initializePlayer] 파일 읽기 시작...");
        const imsBuffer = await imsFile.arrayBuffer();
        console.log("[initializePlayer] IMS 파일 읽기 완료, 크기:", imsBuffer.byteLength);
        const bnkBuffer = await bnkFile.arrayBuffer();
        console.log("[initializePlayer] BNK 파일 읽기 완료, 크기:", bnkBuffer.byteLength);

        if (cancelled) {
          console.log("[initializePlayer] cancelled=true, 종료");
          return;
        }

        // IMS 파일 파싱
        console.log("[initializePlayer] IMS 파싱 시작...");
        const imsData = parseIMS(imsBuffer);
        console.log("[initializePlayer] IMS 파싱 완료");

        // 디버깅: IMS 파일 정보 출력
        console.log("=== IMS File Info ===");
        console.log("Song Name:", imsData.songName);
        console.log("Basic Tempo:", imsData.basicTempo);
        console.log("D_Mode:", imsData.dMode);
        console.log("Channel Num:", imsData.chNum);
        console.log("Byte Size:", imsData.byteSize);
        console.log("Instrument Num:", imsData.insNum);

        // OPL 엔진 생성
        console.log("[initializePlayer] OPL 엔진 생성 시작...");
        const oplEngine = new OPLEngine();
        console.log("[initializePlayer] OPL 엔진 생성 완료");

        // Web Audio API 초기화
        console.log("[initializePlayer] AudioContext 생성 시작...");
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        console.log("[initializePlayer] AudioContext 생성 완료");

        // IMS 플레이어 생성 및 초기화
        console.log("[initializePlayer] IMSPlayer 생성 시작...");
        const player = new IMSPlayer(imsData, bnkBuffer, oplEngine);
        console.log("[initializePlayer] IMSPlayer 생성 완료, initialize 호출 시작...");
        await player.initialize(audioContext.sampleRate);
        console.log("[initializePlayer] IMSPlayer initialize 완료");

        // 채널 뮤트 상태 적용
        for (let i = 0; i < channelMuted.length; i++) {
          if (channelMuted[i]) {
            player.toggleChannel(i);
          }
        }

        if (cancelled) {
          console.log("[initializePlayer] cancelled=true (after initialize), 종료");
          return;
        }

        playerRef.current = player;

        // 디버깅: 타이밍 정보 출력
        const tickDelay = player.getTickDelay();
        console.log("=== Timing Info ===");
        console.log("AudioContext Sample Rate:", audioContext.sampleRate);
        console.log("Tick Delay (ms):", tickDelay);
        console.log("Ticks per second:", 1000 / tickDelay);

        // 오디오 프로세서 초기화
        console.log("[initializePlayer] 오디오 프로세서 초기화 시작...");
        initializeAudioProcessor(audioContext);
        console.log("[initializePlayer] 오디오 프로세서 초기화 완료");

        // 샘플 생성 카운터 초기화 (이전 재생의 잔여 값 제거)
        lenGenRef.current = 0;
        console.log("[initializePlayer] lenGenRef 초기화 완료");

        // 초기 상태 설정
        console.log("[initializePlayer] 상태 설정 중...");
        fileNameRef.current = imsFile.name; // fileNameRef 업데이트
        setState({
          ...player.getState(),
          fileName: imsFile.name,
          channelMuted: channelMuted.slice(0, imsData.chNum),
        });
        setIsLoading(false);
        console.log("[initializePlayer] 완료! fileName:", imsFile.name);
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
  }, [imsFile, bnkFile]);

  /**
   * 오디오 프로세서 초기화 (alib.js 예제 방식)
   */
  const initializeAudioProcessor = useCallback((audioContext: AudioContext) => {
    console.log("[initializeAudioProcessor] 시작");
    const bufferSize = 2048;
    const processor = audioContext.createScriptProcessor(bufferSize, 0, 2);

    let callbackCount = 0;

    processor.onaudioprocess = (e) => {
      callbackCount++;
      if (callbackCount === 1) {
        console.log("[onaudioprocess] 첫 번째 콜백 실행");
      }

      if (!playerRef.current) {
        if (callbackCount <= 3) {
          console.log("[onaudioprocess] playerRef.current가 없음");
        }
        return;
      }

      const player = playerRef.current;
      const state = player.getState();

      // 재생 중이 아니면 무음 출력
      if (!state.isPlaying) {
        if (callbackCount <= 3) {
          console.log("[onaudioprocess] 재생 중이 아님, 무음 출력");
        }
        return;
      }
      const outputBuffer = e.outputBuffer;
      const outputL = outputBuffer.getChannelData(0);
      const outputR = outputBuffer.getChannelData(1);
      const lenFill = outputBuffer.length;
      let posFill = 0;

      // 틱당 생성할 샘플 수 계산
      const tickDelay = player.getTickDelay(); // ms
      const samplesPerTick = (audioContext.sampleRate * tickDelay) / 1000;

      let loopCount = 0;
      while (posFill < lenFill) {
        loopCount++;
        if (callbackCount === 1 && loopCount === 1) {
          console.log("[onaudioprocess] 메인 루프 시작, lenGenRef.current:", lenGenRef.current, "posFill:", posFill, "lenFill:", lenFill);
        }

        if (loopCount > 10000) {
          console.error("[onaudioprocess] 무한 루프 감지! posFill:", posFill, "lenFill:", lenFill);
          break;
        }

        // 남은 샘플이 있으면 먼저 생성
        let innerLoopCount = 0;
        while (lenGenRef.current > 0) {
          innerLoopCount++;
          if (callbackCount === 1 && innerLoopCount === 1) {
            console.log("[onaudioprocess] 내부 샘플 생성 루프 시작, lenGenRef.current:", lenGenRef.current);
          }

          if (innerLoopCount > 10000) {
            console.error("[onaudioprocess] 내부 루프 무한 감지! lenGenRef.current:", lenGenRef.current);
            break;
          }

          if (lenFill - posFill < 2) {
            if (callbackCount === 1) {
              console.log("[onaudioprocess] 버퍼 공간 부족, 종료");
            }
            return;
          }

          const lenNow = Math.max(2, Math.min(512, Math.floor(lenGenRef.current), lenFill - posFill));
          if (callbackCount === 1 && innerLoopCount === 1) {
            console.log("[onaudioprocess] generateSamples 호출 전, lenNow:", lenNow);
          }

          const samples = player.generateSamples(lenNow);

          if (callbackCount === 1 && innerLoopCount === 1) {
            console.log("[onaudioprocess] generateSamples 완료");
          }

          for (let i = 0; i < lenNow; i++) {
            outputL[posFill] = samples[i * 2] / 32768.0;
            outputR[posFill] = samples[i * 2 + 1] / 32768.0;
            posFill++;
          }

          lenGenRef.current -= lenNow;
        }

        if (callbackCount === 1 && loopCount === 1) {
          console.log("[onaudioprocess] tick() 호출 전");
        }

        // 다음 이벤트 처리 (IMS는 tick()이 delay 반환)
        let delay;
        let tickLoopCount = 0;
        do {
          tickLoopCount++;
          if (tickLoopCount > 10000) {
            console.error("[onaudioprocess] tick() do-while 무한 루프 감지!");
            delay = 1; // 강제 종료
            break;
          }
          if (callbackCount === 1 && tickLoopCount === 1) {
            console.log("[onaudioprocess] player.tick() 호출 중...");
          }
          delay = player.tick();
          if (callbackCount === 1 && tickLoopCount === 1) {
            console.log("[onaudioprocess] player.tick() 반환값:", delay);
          }
        } while (!delay); // delay가 0이면 다음 이벤트 계속 처리

        if (callbackCount === 1 && loopCount === 1) {
          console.log("[onaudioprocess] delay:", delay, "samplesPerTick:", samplesPerTick);
        }

        lenGenRef.current += delay * samplesPerTick;

        if (callbackCount === 1 && loopCount === 1) {
          console.log("[onaudioprocess] lenGenRef.current 업데이트됨:", lenGenRef.current);
        }
      }
    };

    processor.connect(audioContext.destination);
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
    console.log("[useIMSPlayer.play] 시작");
    console.log("[useIMSPlayer.play] playerRef:", playerRef.current);
    console.log("[useIMSPlayer.play] audioContextRef:", audioContextRef.current);

    if (!playerRef.current || !audioContextRef.current) {
      console.log("[useIMSPlayer.play] playerRef 또는 audioContextRef가 없음!");
      return;
    }

    // AudioContext resume (브라우저 정책)
    console.log("[useIMSPlayer.play] AudioContext 상태:", audioContextRef.current.state);
    if (audioContextRef.current.state === "suspended") {
      console.log("[useIMSPlayer.play] AudioContext resume 중...");
      audioContextRef.current.resume();
    }

    console.log("[useIMSPlayer.play] playerRef.current.play() 호출 전");
    playerRef.current.play();
    console.log("[useIMSPlayer.play] playerRef.current.play() 호출 후");

    lenGenRef.current = 0;

    // UI는 30fps로 업데이트
    console.log("[useIMSPlayer.play] UI 업데이트 타이머 설정");
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
    console.log("[useIMSPlayer.play] 완료");
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
   * 루프 활성화/비활성화
   */
  const setLoopEnabled = useCallback((enabled: boolean) => {
    if (!playerRef.current) return;
    playerRef.current.setLoopEnabled(enabled);
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
            currentTempo: 0,
            currentVolumes: Array(11).fill(0),
            instrumentNames: [],
            channelMuted: newChannelMuted,
            fileName: "",
            songName: "",
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
    setLoopEnabled,
    toggleChannel,
  };
}
