/**
 * SpectrumVisualizer.tsx - 실시간 주파수 스펙트럼 시각화 컴포넌트
 *
 * Web Audio API AnalyserNode를 사용하여 FFT 데이터를 DOS 스타일 LED 바로 시각화
 * Canvas 기반으로 구현하여 성능 최적화
 * Peak hold 기능: 피크 블럭이 상단에 잠시 유지된 후 천천히 떨어짐
 */

import { useEffect, useRef } from "react";
import DosPanel from "~/components/dos-ui/DosPanel";

interface SpectrumVisualizerProps {
  analyserNode: AnalyserNode | null;
  barCount?: number; // 표시할 바 개수 (기본값: 16)
  segmentCount?: number; // 세그먼트 개수 (기본값: 40)
}

interface BarData {
  value: number;
  peak: number;
  peakHoldTime: number;
}

const TARGET_FPS = 30;
const FRAME_INTERVAL = 1000 / TARGET_FPS;
const PEAK_HOLD_FRAMES = 15;
const PEAK_FALL_SPEED = 1;
const VALUE_FALL_SPEED = 4;

// CSS 변수에서 색상 값 읽기
function getCSSColor(element: HTMLElement, varName: string): string {
  const style = getComputedStyle(element);
  return style.getPropertyValue(varName).trim() || "#808080";
}

export default function SpectrumVisualizer({
  analyserNode,
  barCount = 16,
  segmentCount = 40,
}: SpectrumVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const barDataRef = useRef<BarData[]>(
    new Array(barCount).fill(null).map(() => ({ value: 0, peak: 0, peakHoldTime: 0 }))
  );
  const lastFrameTimeRef = useRef<number>(0);
  const colorsRef = useRef<{
    inactive: string;
    low: string;
    mid: string;
    high: string;
    peak: string;
  }>({ inactive: "#808080", low: "#707080", mid: "#505060", high: "#303040", peak: "#00FF00" });

  // 색상 업데이트
  const updateColors = () => {
    if (!containerRef.current) return;
    colorsRef.current = {
      inactive: getCSSColor(containerRef.current, "--segment-inactive"),
      low: getCSSColor(containerRef.current, "--meter-low"),
      mid: getCSSColor(containerRef.current, "--meter-mid"),
      high: getCSSColor(containerRef.current, "--meter-high"),
      peak: getCSSColor(containerRef.current, "--meter-peak"),
    };
  };

  // Canvas 크기 조정
  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
    }
  };

  // 스펙트럼 그리기
  const drawSpectrum = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // 캔버스 초기화
    ctx.clearRect(0, 0, width, height);

    const padding = 8;
    const gap = 3;
    const segmentGap = 1;

    const availableWidth = width - padding * 2;
    const availableHeight = height - padding * 2;

    const barWidth = (availableWidth - gap * (barCount - 1)) / barCount;
    const segmentHeight = (availableHeight - segmentGap * (segmentCount - 1)) / segmentCount;

    const colors = colorsRef.current;
    const barData = barDataRef.current;

    for (let i = 0; i < barCount; i++) {
      const bar = barData[i];
      const x = padding + i * (barWidth + gap);

      for (let segIndex = 0; segIndex < segmentCount; segIndex++) {
        const threshold = ((segIndex + 1) / segmentCount) * 100;
        const isActive = bar.value >= threshold;
        const isPeak = !isActive && bar.peak >= threshold && bar.peak < threshold + (100 / segmentCount);

        // 색상 결정
        let color = colors.inactive;
        if (isPeak) {
          // 피크는 항상 밝은 LED 색상
          color = colors.peak;
        } else if (isActive) {
          const ratio = segIndex / segmentCount;
          if (ratio >= 0.8) {
            color = colors.high;
          } else if (ratio >= 0.6) {
            color = colors.mid;
          } else {
            color = colors.low;
          }
        }

        // 세그먼트 그리기 (아래에서 위로)
        const y = padding + (segmentCount - 1 - segIndex) * (segmentHeight + segmentGap);

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, segmentHeight, 1);
        ctx.fill();
      }
    }
  };

  useEffect(() => {
    updateColors();
    resizeCanvas();

    // 테마 변경 감지
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleThemeChange = () => {
      updateColors();
      drawSpectrum();
    };
    mediaQuery.addEventListener("change", handleThemeChange);

    // 리사이즈 감지
    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
      drawSpectrum();
    });
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      mediaQuery.removeEventListener("change", handleThemeChange);
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!analyserNode) {
      // 리셋
      barDataRef.current = new Array(barCount).fill(null).map(() => ({
        value: 0, peak: 0, peakHoldTime: 0
      }));
      drawSpectrum();
      return;
    }

    analyserNode.smoothingTimeConstant = 0;
    const bufferLength = analyserNode.frequencyBinCount;
    dataArrayRef.current = new Uint8Array(bufferLength);

    const updateSpectrum = (timestamp: number) => {
      if (!analyserNode || !dataArrayRef.current) return;

      // 프레임 레이트 제한
      const elapsed = timestamp - lastFrameTimeRef.current;
      if (elapsed < FRAME_INTERVAL) {
        animationFrameRef.current = requestAnimationFrame(updateSpectrum);
        return;
      }
      lastFrameTimeRef.current = timestamp;

      // 주파수 데이터 가져오기
      analyserNode.getByteFrequencyData(dataArrayRef.current as Uint8Array<ArrayBuffer>);

      // 바 데이터 업데이트
      const binsPerBar = Math.floor(bufferLength / barCount);
      const prevData = barDataRef.current;

      for (let i = 0; i < barCount; i++) {
        const startBin = i * binsPerBar;
        const endBin = Math.min(startBin + binsPerBar, bufferLength);
        let sum = 0;
        for (let j = startBin; j < endBin; j++) {
          sum += dataArrayRef.current[j];
        }
        const avg = sum / (endBin - startBin);
        const rawValue = Math.round((avg / 255) * 100);

        const prev = prevData[i];

        // 바 값 계산
        let value: number;
        if (rawValue >= prev.value) {
          value = rawValue;
        } else {
          value = Math.max(rawValue, prev.value - VALUE_FALL_SPEED);
        }

        // 피크 계산
        let peak = prev.peak;
        let peakHoldTime = prev.peakHoldTime;

        if (value >= peak) {
          peak = value;
          peakHoldTime = PEAK_HOLD_FRAMES;
        } else if (peakHoldTime > 0) {
          peakHoldTime--;
        } else {
          peak = Math.max(0, peak - PEAK_FALL_SPEED);
        }

        prevData[i] = { value, peak, peakHoldTime };
      }

      // Canvas에 그리기
      drawSpectrum();

      animationFrameRef.current = requestAnimationFrame(updateSpectrum);
    };

    animationFrameRef.current = requestAnimationFrame(updateSpectrum);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [analyserNode, barCount, segmentCount]);

  return (
    <DosPanel className="flex-1">
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
          }}
        />
      </div>
    </DosPanel>
  );
}
