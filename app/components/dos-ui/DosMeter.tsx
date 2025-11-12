/**
 * DosMeter - 가로 LED 세그먼트 스타일 채널 미터
 */

import { useState, useEffect, useRef } from "react";

interface DosMeterProps {
  label: string;
  value: number; // 0-127
  maxValue?: number;
  isMuted?: boolean;
  onToggle?: () => void;
}

export default function DosMeter({ label, value, maxValue = 127, isMuted = false, onToggle }: DosMeterProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    // 값이 증가하면 즉시 반영
    if (value > displayValue) {
      setDisplayValue(value);
      return;
    }

    // 값이 감소하면 부드럽게 감소 (decay)
    if (value < displayValue) {
      const animate = () => {
        setDisplayValue((prev) => {
          const diff = prev - value;
          if (diff < 0.5) {
            return value;
          }
          // 천천히 감소 (이전 값의 95%로 감소)
          return prev * 0.95;
        });

        animationFrameRef.current = requestAnimationFrame(animate);
      };

      animationFrameRef.current = requestAnimationFrame(animate);

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }
  }, [value, displayValue]);

  const percentage = Math.min(100, (displayValue / maxValue) * 100);
  const totalSegments = 32;
  const filledSegments = Math.round((percentage / 100) * totalSegments);

  // 뱅크에 없는 악기 체크 ("!"로 시작)
  const isMissing = label.startsWith("!");
  const displayLabel = isMissing ? label.substring(1) : label;
  let labelClass = "dos-meter-label-left";
  if (isMissing) {
    labelClass += " dos-meter-label-missing";
  }
  // Mute 상태에서도 악기 이름은 명확하게 표시

  return (
    <div className={`dos-meter-horizontal ${isMuted ? 'dos-meter-muted' : ''}`}>
      {onToggle && (
        <button
          className={`dos-checkbox ${isMuted ? 'dos-checkbox-muted' : ''}`}
          onClick={onToggle}
          aria-label={isMuted ? "채널 켜기" : "채널 끄기"}
        >
          M
        </button>
      )}
      <div className={labelClass}>{displayLabel}</div>
      <div className="dos-meter-segments">
        {Array.from({ length: totalSegments }).map((_, index) => {
          const isFilled = index < filledSegments;
          let segmentClass = 'dos-meter-segment';

          if (isFilled) {
            // 색상 결정: 낮음(초록), 중간(노랑), 높음(빨강)
            if (index >= totalSegments * 0.75) {
              segmentClass += ' dos-meter-segment-high';
            } else if (index >= totalSegments * 0.5) {
              segmentClass += ' dos-meter-segment-mid';
            } else {
              segmentClass += ' dos-meter-segment-low';
            }
          }

          return <div key={index} className={segmentClass} />;
        })}
      </div>
    </div>
  );
}
