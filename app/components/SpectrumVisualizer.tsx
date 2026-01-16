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
  const canvasCtxRefs = useRef<(CanvasRenderingContext2D | null)[]>([]); // Canvas context 캐싱
  const canvasDimensionsRef = useRef<{ width: number; height: number }[]>([]); // 캔버스 크기 캐싱
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const barDataRef = useRef<BarData[]>(
    new Array(barCount).fill(null).map(() => ({ value: 0, peak: 0, peakHoldTime: 0, peakFallSpeed: 0 }))
  );
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
    canvasCtxRefs.current = [];
    canvasDimensionsRef.current = [];
    canvasRefs.current.forEach((canvas, index) => {
      if (!canvas) {
        canvasCtxRefs.current[index] = null;
        canvasDimensionsRef.current[index] = { width: 0, height: 0 };
        return;
      }
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
      // 캐싱
      canvasCtxRefs.current[index] = ctx;
      canvasDimensionsRef.current[index] = { width: rect.width, height: rect.height };
    });
  };

  const drawBar = (barIndex: number) => {
    // 캐싱된 context와 크기 사용
    const ctx = canvasCtxRefs.current[barIndex];
    const dims = canvasDimensionsRef.current[barIndex];
    if (!ctx || !dims) return;

    const width = dims.width;
    const height = dims.height;
    if (width === 0 || height === 0) return;

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
        if (ratio >= 2 / 3) {
          color = colors.high;
        } else if (ratio >= 1 / 3) {
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

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleThemeChange = () => {
      updateColors();
      drawSpectrum();
    };
    mediaQuery.addEventListener("change", handleThemeChange);

    const resizeObserver = new ResizeObserver(() => {
      // 레이아웃 완료 후 리사이즈 처리
      requestAnimationFrame(() => {
        resizeCanvases();
        drawSpectrum();
      });
    });
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // 초기 리사이즈도 레이아웃 완료 후 실행
    requestAnimationFrame(() => {
      resizeCanvases();
      drawSpectrum();
    });

    return () => {
      mediaQuery.removeEventListener("change", handleThemeChange);
      resizeObserver.disconnect();
    };
  }, []);

  // analyserNode 초기화
  useEffect(() => {
    if (!analyserNode) {
      barDataRef.current = new Array(barCount).fill(null).map(() => ({
        value: 0, peak: 0, peakHoldTime: 0, peakFallSpeed: 0
      }));
      drawSpectrum();
      return;
    }

    analyserNode.smoothingTimeConstant = 0;
    dataArrayRef.current = new Uint8Array(analyserNode.frequencyBinCount);
  }, [analyserNode, barCount]);

  // 자체 requestAnimationFrame 루프 (30fps 목표)
  useEffect(() => {
    if (!analyserNode || !dataArrayRef.current) return;

    let animationId: number;
    let lastTime = 0;
    const targetInterval = 1000 / 30; // 30fps

    const updateBarData = () => {
      if (!dataArrayRef.current) return;

      const bufferLength = analyserNode.frequencyBinCount;
      analyserNode.getByteFrequencyData(dataArrayRef.current as Uint8Array<ArrayBuffer>);

      // DC 오프셋(bin 0)과 초저주파를 건너뛰기 위해 첫 몇 개 빈 제외
      const skipBins = 2;
      const usableBins = bufferLength - skipBins;
      const binsPerBar = Math.floor(usableBins / barCount);
      const prevData = barDataRef.current;

      for (let i = 0; i < barCount; i++) {
        const startBin = skipBins + i * binsPerBar;
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
    };

    const animate = (timestamp: number) => {
      // 30fps로 제한
      if (timestamp - lastTime >= targetInterval) {
        updateBarData();
        drawSpectrum();
        lastTime = timestamp;
      }
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [analyserNode, barCount, segmentCount]);

  return (
    <DosPanel className="flex-1 spectrum-panel">
      <div
        ref={containerRef}
        style={{
          display: "flex",
          gap: "2px",
          height: "100%",
          paddingBottom: "6px",
        }}
      >
        {Array.from({ length: barCount }).map((_, index) => (
          <div
            key={index}
            className="inset"
            style={{
              flex: 1,
              height: "100%",
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
