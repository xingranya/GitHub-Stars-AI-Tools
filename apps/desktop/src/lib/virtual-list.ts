export type VirtualWindowOptions<T> = {
  items: T[];
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  overscan: number;
  stickyHeaderHeight?: number;
};

export type VirtualWindow<T> = {
  startIndex: number;
  endIndex: number;
  items: T[];
  totalHeight: number;
  offsetY: number;
};

export function computeVirtualWindow<T>(options: VirtualWindowOptions<T>): VirtualWindow<T> {
  const rowHeight = Math.max(1, Math.floor(options.rowHeight));
  const viewportHeight = Math.max(1, Math.floor(options.viewportHeight));
  const overscan = Math.max(0, Math.floor(options.overscan));
  const contentScrollTop = Math.max(0, options.scrollTop - (options.stickyHeaderHeight ?? 0));
  const startIndex = Math.max(0, Math.floor(contentScrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const endIndex = Math.min(options.items.length, startIndex + visibleCount);

  return {
    startIndex,
    endIndex,
    items: options.items.slice(startIndex, endIndex),
    totalHeight: options.items.length * rowHeight,
    offsetY: startIndex * rowHeight,
  };
}
