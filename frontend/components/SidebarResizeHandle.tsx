"use client";

import { useEffect, useRef, useState } from 'react';

function limits() {
  const viewport = window.innerWidth;
  const min = Math.min(320, viewport);
  const max = viewport < 768 ? viewport : Math.max(min, Math.min(960, viewport - 320));
  return { min, max };
}

export default function SidebarResizeHandle({ width, enabled, onWidthChange, onResizing }: {
  width: number; enabled: boolean; onWidthChange: (width: number) => void; onResizing: (active: boolean) => void;
}) {
  const [range, setRange] = useState({ min: 320, max: 960 });
  const widthRef = useRef(width);
  widthRef.current = width;
  const drag = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    const resize = () => {
      const next = limits(); setRange(next);
      onWidthChange(Math.max(next.min, Math.min(next.max, widthRef.current)));
    };
    resize(); window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [onWidthChange]);
  useEffect(() => {
    if (!enabled) { drag.current = null; onResizing(false); }
  }, [enabled, onResizing]);
  const update = (value: number) => {
    const next = limits();
    onWidthChange(Math.round(Math.max(next.min, Math.min(next.max, value))));
  };
  const end = () => { drag.current = null; onResizing(false); };
  return <div role="separator" aria-label="Ширина сайдбара" aria-orientation="vertical"
    aria-valuemin={range.min} aria-valuemax={range.max} aria-valuenow={width} aria-valuetext={`${width} пикселей`}
    aria-controls="comparison-sidebar" tabIndex={enabled ? 0 : -1}
    title="Перетащите границу. Стрелки ← / → меняют ширину, двойной щелчок сбрасывает её."
    className="absolute z-40 left-0 top-0 bottom-0 w-2 cursor-col-resize touch-none select-none hover:bg-indigo-300/60 focus-visible:bg-indigo-300/60 focus-visible:outline-none"
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, width }; onResizing(true);
    }}
    onPointerMove={event => { if (drag.current) update(drag.current.width + drag.current.x - event.clientX); }}
    onPointerUp={event => { end(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={end} onLostPointerCapture={end}
    onDoubleClick={() => update(384)}
    onKeyDown={event => {
      const values: Record<string, number> = { ArrowLeft: width + 24, ArrowRight: width - 24, Home: range.min, End: range.max };
      if (event.key in values) { event.preventDefault(); update(values[event.key]); }
    }}>
    <span aria-hidden="true" className="absolute top-1/2 left-0.5 h-10 w-1 rounded-full bg-slate-300" />
  </div>;
}
