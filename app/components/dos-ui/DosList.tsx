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
  className?: string;
}

const ITEM_HEIGHT = 32; // 각 아이템의 고정 높이 (px)
const BUFFER_SIZE = 10; // 위아래 버퍼 아이템 개수

export default function DosList({ items, selectedKey, className = "" }: DosListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // 컨테이너 높이 측정
  useEffect(() => {
    if (containerRef.current) {
      setContainerHeight(containerRef.current.clientHeight);
    }
  }, []);

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

  // 전체 높이 및 오프셋
  const totalHeight = items.length * ITEM_HEIGHT;
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
            {visibleItems.map((item) => (
              <div
                key={item.key}
                className={`dos-list-item ${
                  selectedKey === item.key ? 'dos-list-item-selected' : ''
                }`}
                onClick={item.onClick}
                style={{ height: `${ITEM_HEIGHT}px` }}
              >
                {item.content}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
