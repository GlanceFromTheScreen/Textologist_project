"use client";

import { ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Read-only DOM positioning; shared by above-word and margin annotations. */
export default function ChangePopover({ anchor, title, onClose, children }: {
  anchor: HTMLElement; title: string; onClose: () => void; children: ReactNode;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useEffect(() => {
    const positionPopup = () => {
      if (!anchor.isConnected) { closeRef.current(); return; }
      const rect = anchor.getBoundingClientRect();
      const height = popupRef.current?.offsetHeight || 200;
      const width = popupRef.current?.offsetWidth || 360;
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - height - 12)) });
    };
    const outside = (e: PointerEvent) => {
      if (!popupRef.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) closeRef.current();
    };
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeRef.current(); anchor.focus({ preventScroll: true }); }
    };
    positionPopup(); popupRef.current?.focus({ preventScroll: true });
    const observer = new ResizeObserver(positionPopup);
    if (popupRef.current) observer.observe(popupRef.current);
    window.addEventListener('scroll', positionPopup, true);
    window.addEventListener('resize', positionPopup);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keyboard);
    return () => {
      observer.disconnect(); window.removeEventListener('scroll', positionPopup, true);
      window.removeEventListener('resize', positionPopup);
      document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard);
    };
  }, [anchor]);
  return createPortal(<div ref={popupRef} role="dialog" aria-label={title} tabIndex={-1}
    className="fixed z-[60] w-[380px] max-w-[calc(100vw-24px)] max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl p-4 font-sans text-slate-900 outline-none" style={position}>
    <div className="flex items-start justify-between gap-3 mb-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <button type="button" aria-label="Закрыть сноску" onClick={() => { onClose(); anchor.focus({ preventScroll: true }); }} className="text-slate-500 px-1">×</button>
    </div>
    {children}
  </div>, document.body);
}
