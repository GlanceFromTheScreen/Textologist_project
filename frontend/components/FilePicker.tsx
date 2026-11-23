"use client";
import { useRef } from 'react';

export default function FilePicker({accept, file, onChange, disabled = false}: {
  accept: string; file: File | null; onChange: (file: File | null) => void; disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="space-y-2">
    <input ref={input} type="file" accept={accept} className="hidden" tabIndex={-1} disabled={disabled} onChange={event => {onChange(event.target.files?.[0] || null); event.target.value = '';}} />
    <button type="button" disabled={disabled} onClick={() => input.current?.click()} className="rounded-full bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">Выбрать файл</button>
    <p className="text-sm text-slate-500 break-all" role="status">{file?.name || 'Файл не выбран'}</p>
  </div>;
}
