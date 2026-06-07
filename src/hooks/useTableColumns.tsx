import { useState, useRef, useCallback, type CSSProperties } from 'react';

export interface UseTableColumnsResult<K extends string> {
  order: K[];
  widths: Record<string, number>;
  ordered: <T extends { key: K }>(all: readonly T[], isVisible?: (k: K) => boolean) => T[];
  widthStyle: (key: K) => CSSProperties | undefined;
  thProps: (key: K) => {
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
  resizeHandleProps: (key: K) => {
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onMouseDown: (e: React.MouseEvent) => void;
    onDoubleClick: () => void;
  };
  dragKey: K | null;
  dragOverKey: K | null;
  isResizing: boolean;
  reset: () => void;
}

export function useTableColumns<K extends string>(
  storageKey: string,
  allKeys: readonly K[],
): UseTableColumnsResult<K> {
  const widthsKey = `${storageKey}_widths`;
  const orderKey = `${storageKey}_order`;

  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try { const s = localStorage.getItem(widthsKey); if (s) return JSON.parse(s); } catch { /* ignore */ }
    return {};
  });

  const [order, setOrder] = useState<K[]>(() => {
    try {
      const s = localStorage.getItem(orderKey);
      if (s) {
        const saved = (JSON.parse(s) as K[]).filter(k => allKeys.includes(k));
        const missing = allKeys.filter(k => !saved.includes(k));
        return [...saved, ...missing];
      }
    } catch { /* ignore */ }
    return [...allKeys];
  });

  const [dragKey, setDragKey] = useState<K | null>(null);
  const [dragOverKey, setDragOverKey] = useState<K | null>(null);
  const resizingRef = useRef<{ key: K; startX: number; startW: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const persistWidths = useCallback((w: Record<string, number>) => {
    try { localStorage.setItem(widthsKey, JSON.stringify(w)); } catch { /* ignore */ }
  }, [widthsKey]);
  const persistOrder = useCallback((o: K[]) => {
    try { localStorage.setItem(orderKey, JSON.stringify(o)); } catch { /* ignore */ }
  }, [orderKey]);

  const ordered = useCallback(<T extends { key: K }>(all: readonly T[], isVisible?: (k: K) => boolean): T[] => {
    return order
      .map(k => all.find(c => c.key === k))
      .filter((c): c is T => !!c && (!isVisible || isVisible(c.key)));
  }, [order]);

  const widthStyle = useCallback((key: K): CSSProperties | undefined => {
    const w = widths[key];
    return w ? { width: w, minWidth: w, maxWidth: w } : undefined;
  }, [widths]);

  const startResize = useCallback((e: React.MouseEvent, key: K, currentW: number) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { key, startX: e.clientX, startW: currentW };
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      const r = resizingRef.current;
      if (!r) return;
      const w = Math.max(50, Math.round(r.startW + (ev.clientX - r.startX)));
      setWidths(prev => ({ ...prev, [r.key]: w }));
    };
    const onUp = () => {
      resizingRef.current = null;
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setWidths(prev => { persistWidths(prev); return prev; });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [persistWidths]);

  const resetWidth = useCallback((key: K) => {
    setWidths(prev => { const n = { ...prev }; delete n[key]; persistWidths(n); return n; });
  }, [persistWidths]);

  const doReorder = useCallback((targetKey: K) => {
    setDragKey(dk => {
      if (!dk || dk === targetKey) return null;
      setOrder(prev => {
        const next = [...prev];
        const from = next.indexOf(dk);
        const to = next.indexOf(targetKey);
        if (from === -1 || to === -1) return prev;
        next.splice(from, 1);
        next.splice(to, 0, dk);
        persistOrder(next);
        return next;
      });
      return null;
    });
    setDragOverKey(null);
  }, [persistOrder]);

  const thProps = useCallback((key: K) => ({
    draggable: !isResizing,
    onDragStart: (e: React.DragEvent) => { setDragKey(key); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', key); } catch { /* ignore */ } },
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverKey(prev => prev === key ? prev : key); },
    onDragLeave: () => { setDragOverKey(prev => prev === key ? null : prev); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); doReorder(key); },
    onDragEnd: () => { setDragKey(null); setDragOverKey(null); },
  }), [isResizing, doReorder]);

  const resizeHandleProps = useCallback((key: K) => ({
    draggable: false,
    onDragStart: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); },
    onMouseDown: (e: React.MouseEvent) => {
      const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement | null;
      startResize(e, key, widths[key] || th?.offsetWidth || 120);
    },
    onDoubleClick: () => resetWidth(key),
  }), [startResize, resetWidth, widths]);

  const reset = useCallback(() => {
    setOrder([...allKeys]);
    setWidths({});
    persistOrder([...allKeys]);
    try { localStorage.removeItem(widthsKey); } catch { /* ignore */ }
  }, [allKeys, persistOrder, widthsKey]);

  return { order, widths, ordered, widthStyle, thProps, resizeHandleProps, dragKey, dragOverKey, isResizing, reset };
}
