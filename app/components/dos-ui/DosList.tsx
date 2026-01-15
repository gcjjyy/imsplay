/**
 * DosList - DOS 스타일 리스트 컴포넌트 (가상 스크롤링)
 */

import { useState, useRef, useEffect } from 'react';

interface DosListItem {
  key: string;
  content: React.ReactNode;
  onClick?: () => void;
}

interface DosListProps {
  items: DosListItem[];
  selectedKey?: string;
  scrollToIndex?: number;
  autoScroll?: boolean; // true일 때만 scrollToIndex로 자동 스크롤
  className?: string;
  onSelect?: (key: string, index: number) => void;
}

const ITEM_HEIGHT = 28; // 각 아이템의 고정 높이 (px)
const BUFFER_SIZE = 10; // 위아래 버퍼 아이템 개수

export default function DosList({ items, selectedKey, scrollToIndex, autoScroll = false, className = "", onSelect }: DosListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // 컨테이너 높이 측정
  useEffect(() => {
    if (containerRef.current) {
      setContainerHeight(containerRef.current.clientHeight);
    }
  }, []);

  // 전체 높이 계산
  const totalHeight = items.length * ITEM_HEIGHT;

  // 자동 스크롤 (autoScroll이 true일 때만)
  useEffect(() => {
    if (autoScroll && scrollToIndex !== undefined && containerRef.current && containerHeight > 0) {
      // 선택된 아이템이 중앙에 오도록 스크롤 위치 계산
      const targetScrollTop = scrollToIndex * ITEM_HEIGHT - containerHeight / 2 + ITEM_HEIGHT / 2;
      // 경계값 처리 (맨 위/맨 아래)
      const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, totalHeight - containerHeight));
      containerRef.current.scrollTop = clampedScrollTop;
    }
  }, [autoScroll, scrollToIndex, containerHeight, totalHeight]);

  // 스크롤 이벤트 핸들러
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  // 보이는 범위 계산
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_SIZE);
  const visibleCount = Math.ceil(containerHeight / ITEM_HEIGHT) + BUFFER_SIZE * 2;
  const endIndex = Math.min(items.length, startIndex + visibleCount);

  // 렌더링할 아이템
  const visibleItems = items.slice(startIndex, endIndex);

  // 오프셋
  const offsetY = startIndex * ITEM_HEIGHT;

  return (
    <div className={`dos-list ${className}`}>
      <div
        className="dos-list-scroll"
        ref={containerRef}
        onScroll={handleScroll}
      >
        <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
          <div style={{ transform: `translateY(${offsetY}px)` }}>
            {visibleItems.map((item, visibleIndex) => {
              const actualIndex = startIndex + visibleIndex;
              return (
                <div
                  key={item.key}
                  className={`dos-list-item ${
                    selectedKey === item.key ? 'dos-list-item-selected' : ''
                  }`}
                  onClick={() => {
                    item.onClick?.();
                    onSelect?.(item.key, actualIndex);
                  }}
                  style={{ height: `${ITEM_HEIGHT}px` }}
                >
                  {item.content}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
