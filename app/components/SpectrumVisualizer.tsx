/**
 * SpectrumVisualizer.tsx - 실시간 주파수 스펙트럼 시각화 컴포넌트
 *
 * Web Audio API AnalyserNode를 사용하여 FFT 데이터를 DOS 스타일 LED 바로 시각화
 * 각 바는 CSS inset div + Canvas 세그먼트로 구성
 * Peak hold 기능: 피크 블럭이 상단에 잠시 유지된 후 천천히 떨어짐
 */

import { useEffect, useRef } from "react";
import DosPanel from "~/components/dos-ui/DosPanel";

interface SpectrumVisualizerProps {
  analyserNode: AnalyserNode | null;
  barCount?: number;
  segmentCount?: number;
}

interface BarData {
  value: number;
  peak: number;
  peakHoldTime: number;
  peakFallSpeed: number;
}

const TARGET_FPS = 30;
const FRAME_INTERVAL = 1000 / TARGET_FPS;
const PEAK_HOLD_FRAMES = 15;
const PEAK_FALL_ACCELERATION = 0.3;
const VALUE_FALL_SPEED = 4;

function getCSSColor(element: HTMLElement, varName: string): string {
  const style = getComputedStyle(element);
  return style.getPropertyValue(varName).trim() || "#808080";
}

export default function SpectrumVisualizer({
  analyserNode,
  barCount = 16,
  segmentCount = 40,
}: SpectrumVisualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const barDataRef = useRef<BarData[]>(
    new Array(barCount).fill(null).map(() => ({ value: 0, peak: 0, peakHoldTime: 0, peakFallSpeed: 0 }))
  );
  const lastFrameTimeRef = useRef<number>(0);
  const colorsRef = useRef<{
    inactive: string;
    low: string;
    mid: string;
    high: string;
    peak: string;
    barBg: string;
  }>({
    inactive: "#808080", low: "#4a5568", mid: "#6b7a8f", high: "#8fa0b8", peak: "#00FF00",
    barBg: "#1e1e2a"
  });

  const updateColors = () => {
    if (!containerRef.current) return;
    colorsRef.current = {
      inactive: getCSSColor(containerRef.current, "--segment-inactive"),
      low: getCSSColor(containerRef.current, "--meter-low"),
      mid: getCSSColor(containerRef.current, "--meter-mid"),
      high: getCSSColor(containerRef.current, "--meter-high"),
      peak: getCSSColor(containerRef.current, "--meter-peak"),
      barBg: getCSSColor(containerRef.current, "--spectrum-bar-bg"),
    };
  };

  const resizeCanvases = () => {
    const dpr = window.devicePixelRatio || 1;
    canvasRefs.current.forEach((canvas) => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
    });
  };

  const drawBar = (barIndex: number) => {
    const canvas = canvasRefs.current[barIndex];
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const segmentGap = 1;
    const segmentHeight = (height - segmentGap * (segmentCount - 1)) / segmentCount;

    const colors = colorsRef.current;
    const bar = barDataRef.current[barIndex];

    // 배경
    ctx.fillStyle = colors.barBg;
    ctx.fillRect(0, 0, width, height);

    // 피크 세그먼트 위치
    const peakSegIndex = Math.min(
      Math.floor((bar.peak * segmentCount) / 100),
      segmentCount - 1
    );

    for (let segIndex = 0; segIndex < segmentCount; segIndex++) {
      const threshold = ((segIndex + 1) / segmentCount) * 100;
      const isActive = bar.value >= threshold;
      const isPeak = segIndex === peakSegIndex;

      let color = colors.inactive;
      if (isPeak) {
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

      const segY = (segmentCount - 1 - segIndex) * (segmentHeight + segmentGap);
      ctx.fillStyle = color;
      ctx.fillRect(0, segY, width, segmentHeight);
    }
  };

  const drawSpectrum = () => {
    for (let i = 0; i < barCount; i++) {
      drawBar(i);
    }
  };

  useEffect(() => {
    updateColors();
    resizeCanvases();

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleThemeChange = () => {
      updateColors();
      drawSpectrum();
    };
    mediaQuery.addEventListener("change", handleThemeChange);

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvases();
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
      barDataRef.current = new Array(barCount).fill(null).map(() => ({
        value: 0, peak: 0, peakHoldTime: 0, peakFallSpeed: 0
      }));
      drawSpectrum();
      return;
    }

    analyserNode.smoothingTimeConstant = 0;
    const bufferLength = analyserNode.frequencyBinCount;
    dataArrayRef.current = new Uint8Array(bufferLength);

    const updateSpectrum = (timestamp: number) => {
      if (!analyserNode || !dataArrayRef.current) return;

      const elapsed = timestamp - lastFrameTimeRef.current;
      if (elapsed < FRAME_INTERVAL) {
        animationFrameRef.current = requestAnimationFrame(updateSpectrum);
        return;
      }
      lastFrameTimeRef.current = timestamp;

      analyserNode.getByteFrequencyData(dataArrayRef.current as Uint8Array<ArrayBuffer>);

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

        let value: number;
        if (rawValue >= prev.value) {
          value = rawValue;
        } else {
          value = Math.max(rawValue, prev.value - VALUE_FALL_SPEED);
        }

        let peak = prev.peak;
        let peakHoldTime = prev.peakHoldTime;
        let peakFallSpeed = prev.peakFallSpeed;

        if (value >= peak) {
          peak = value;
          peakHoldTime = PEAK_HOLD_FRAMES;
          peakFallSpeed = 0;
        } else if (peakHoldTime > 0) {
          peakHoldTime--;
        } else {
          peakFallSpeed += PEAK_FALL_ACCELERATION;
          peak = Math.max(0, peak - peakFallSpeed);
        }

        prevData[i] = { value, peak, peakHoldTime, peakFallSpeed };
      }

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
          display: "flex",
          gap: "2px",
          height: "100%",
        }}
      >
        {Array.from({ length: barCount }).map((_, index) => (
          <div
            key={index}
            className="inset"
            style={{
              flex: 1,
              overflow: "hidden",
            }}
          >
            <canvas
              ref={(el) => { canvasRefs.current[index] = el; }}
              style={{
                display: "block",
                width: "100%",
                height: "100%",
              }}
            />
          </div>
        ))}
      </div>
    </DosPanel>
  );
}
