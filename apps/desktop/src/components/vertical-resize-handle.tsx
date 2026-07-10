import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

type ResizeState = {
  pointerId: number;
  startX: number;
  startValue: number;
};

/** 可通过指针、键盘或双击调整相邻面板宽度的竖向分隔条。 */
export function VerticalResizeHandle(props: {
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  label: string;
  direction?: 'forward' | 'reverse';
  className?: string;
  onChange: (value: number) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const resizeStateRef = useRef<ResizeState | null>(null);

  useEffect(() => () => restoreDocumentCursor(), []);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue: props.value,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    setIsDragging(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    const directionFactor = props.direction === 'reverse' ? -1 : 1;
    props.onChange(clamp(
      resizeState.startValue + (event.clientX - resizeState.startX) * directionFactor,
      props.min,
      props.max,
    ));
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (resizeStateRef.current?.pointerId !== event.pointerId) return;
    resizeStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    restoreDocumentCursor();
    setIsDragging(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 32 : 12;
    const directionFactor = props.direction === 'reverse' ? -1 : 1;
    let nextValue: number | null = null;
    if (event.key === 'ArrowLeft') nextValue = props.value - step * directionFactor;
    if (event.key === 'ArrowRight') nextValue = props.value + step * directionFactor;
    if (event.key === 'Home') nextValue = props.direction === 'reverse' ? props.max : props.min;
    if (event.key === 'End') nextValue = props.direction === 'reverse' ? props.min : props.max;
    if (nextValue === null) return;
    event.preventDefault();
    props.onChange(clamp(nextValue, props.min, props.max));
  }

  return (
    <div
      role="separator"
      aria-label={props.label}
      aria-orientation="vertical"
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={Math.round(props.value)}
      tabIndex={0}
      className={`group relative min-h-0 cursor-col-resize items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 ${props.className ?? ''}`}
      title="拖动调整宽度，双击恢复默认宽度"
      onDoubleClick={() => props.onChange(props.defaultValue)}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <span
        className={`h-14 w-1 rounded-full transition-colors duration-150 ${isDragging ? 'bg-primary' : 'bg-outline-variant/45 group-hover:bg-primary/70'}`}
        aria-hidden="true"
      />
    </div>
  );
}

/** 在本机保存用户调整后的面板宽度。 */
export function usePersistentPanelWidth(storageKey: string, defaultValue: number) {
  const [value, setValue] = useState(() => readStoredWidth(storageKey, defaultValue));

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(Math.round(value)));
    } catch {
      // 本地存储不可用时仍保留当前会话内的宽度。
    }
  }, [storageKey, value]);

  return [value, setValue] as const;
}

/** 持续读取布局容器宽度，用于动态限制可拖拽范围。 */
export function useObservedElementWidth<T extends HTMLElement>() {
  const elementRef = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return undefined;
    const updateWidth = () => setWidth(element.getBoundingClientRect().width);
    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [elementRef, width] as const;
}

function readStoredWidth(storageKey: string, defaultValue: number) {
  try {
    const storedValue = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(storedValue) && storedValue > 0 ? storedValue : defaultValue;
  } catch {
    return defaultValue;
  }
}

function restoreDocumentCursor() {
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
