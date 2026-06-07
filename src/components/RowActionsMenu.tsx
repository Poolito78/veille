import { useState, useRef, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Settings } from 'lucide-react';

export interface RowAction {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
}

export default function RowActionsMenu({ actions, title = 'Actions' }: { actions: RowAction[]; title?: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const visible = actions.filter(a => !a.hidden);

  const compute = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 200;
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) });
  };
  useLayoutEffect(() => { if (open) compute(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        title={title}
        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      >
        <Settings className="w-4 h-4" />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: 200 }}
          className="z-[70] bg-card border border-border rounded-xl shadow-xl py-1"
          onClick={e => e.stopPropagation()}
        >
          {visible.map((a, i) => (
            <button
              key={i}
              onClick={e => { e.stopPropagation(); setOpen(false); a.onClick(); }}
              className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm hover:bg-muted/60 ${a.danger ? 'text-destructive' : 'text-foreground'}`}
            >
              <span className={`shrink-0 ${a.danger ? '' : 'text-muted-foreground'}`}>{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
