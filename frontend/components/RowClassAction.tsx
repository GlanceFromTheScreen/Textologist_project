"use client";

import { useState } from 'react';
import { apiErrorMessage } from '@/lib/errors';
import ChangePopover from './ChangePopover';

export default function RowClassAction({ number, remaining, hasChanges, unsaved, onApply }: {
  number: number; remaining: number; hasChanges: boolean; unsaved: boolean; onApply: () => Promise<void>;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const apply = async () => {
    if (busy || !remaining) return;
    setBusy(true); setError('');
    try { await onApply(); setAnchor(null); }
    catch (e) { setError(apiErrorMessage(e, 'Не удалось назначить класс. Попробуйте ещё раз.')); }
    finally { setBusy(false); }
  };
  return <>
    <button type="button" aria-label={`Строка ${number}: действия`} aria-haspopup="dialog" aria-expanded={!!anchor}
      title="Действия со всеми изменениями строки"
      className="font-sans tabular-nums text-xs text-slate-500 rounded px-1.5 py-1 -mt-1 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-indigo-600"
      onClick={e => { setError(''); setAnchor(anchor ? null : e.currentTarget); }}>{number}</button>
    {anchor && <ChangePopover anchor={anchor} title={`Изменения строки ${number}`} onClose={() => setAnchor(null)}>
      <p className="text-sm text-slate-600 mb-4">Действие применяется ко всему фрагменту под номером {number}, включая переносы строк.</p>
      <button type="button" onClick={apply} disabled={busy || !remaining}
        className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {busy ? 'Применение…' : 'Сделать все изменения в строке несущественными'}
      </button>
      <p role="status" className="text-xs text-slate-500 mt-3">
        {!hasChanges ? 'В этой строке нет изменений.' : !remaining ? 'Все изменения уже несущественные.' : `Изменений для назначения класса: ${remaining}.`}
      </p>
      {unsaved && <p className="text-xs text-slate-500 mt-2">Есть изменения операций. После назначения класса нажмите «Сохранить в историю».</p>}
      {error && <p role="alert" className="text-sm text-red-600 mt-3">{error}</p>}
    </ChangePopover>}
  </>;
}
