"use client";

import { RefObject, useEffect, useState } from 'react';
import { apiErrorMessage } from '@/lib/errors';
import { isInsignificant, resolveWordClass, WordClass, wordChangeLabel } from './WordClassSidebar';
import ChangePopover from './ChangePopover';
import { PreviewWord, ReadOnlyChange } from './InsignificantChange';

type Line = { top: number; indices: number[]; hidden: number[] };

function HiddenChange({ word, index, previous, next, classes, onAssign }: {
  word: PreviewWord; index: number; previous?: PreviewWord; next?: PreviewWord;
  classes: WordClass[]; onAssign: (index: number, classId: number | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const assign = async (value: string) => {
    setBusy(true); setError('');
    try { await onAssign(index, value ? Number(value) : null); }
    catch (e) { setError(apiErrorMessage(e, 'Не удалось изменить класс.')); }
    finally { setBusy(false); }
  };
  return <li className="rounded-lg border border-slate-200 p-3 space-y-3">
    <div className="text-xs text-slate-500">{word.op_type === 'insert' ? 'Скрытая вставка' : 'Скрытое удаление'}</div>
    <div className="comparison-content flex flex-wrap gap-2 items-end" aria-label="Контекст скрытого изменения">
      <span className="text-slate-500">{previous ? previous.base_token || previous.other_token : 'Начало абзаца'}</span>
      <ReadOnlyChange word={word} classes={classes} />
      <span className="text-slate-500">{next ? next.base_token || next.other_token : 'Конец абзаца'}</span>
    </div>
    <label className="block text-xs text-slate-600" htmlFor={`hidden-class-${index}`}>Класс скрытого изменения</label>
    <select id={`hidden-class-${index}`} value={word.class_id ?? ''} disabled={busy} onChange={e => assign(e.target.value)}
      className="w-full border border-slate-300 rounded-lg p-2 bg-white text-sm disabled:opacity-50">
      <option value="">Без класса</option>
      {classes.filter(cls => cls.kind === 'word' && (!cls.hidden || cls.id === word.class_id)).map(cls => <option key={cls.id} value={cls.id}>{cls.display_name}</option>)}
    </select>
    {busy && <p role="status" className="text-xs text-slate-500">Сохранение…</p>}
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </li>;
}

/** Zero-width anchors retain the position of hidden insertions/deletions without reserving word space. */
export default function WordClassAnnotations({ contentRef, words, classes, layoutKey, onSelect, onAssign }: {
  contentRef: RefObject<HTMLDivElement>;
  words: (PreviewWord & { base_paragraph_index?: number | null })[];
  classes: WordClass[];
  layoutKey: string;
  onSelect: (index: number) => void;
  onAssign: (index: number, classId: number | null) => Promise<void>;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [active, setActive] = useState<{ key: string; anchor: HTMLElement; hidden: boolean } | null>(null);
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    let frame = 0; let disposed = false;
    const measure = () => {
      const bounds = root.getBoundingClientRect();
      const measured: Line[] = [];
      root.querySelectorAll<HTMLElement>('[data-word-index], [data-hidden-index]').forEach(token => {
        const hidden = token.dataset.hiddenIndex !== undefined;
        const index = Number(hidden ? token.dataset.hiddenIndex : token.dataset.wordIndex);
        const word = words[index];
        if (!word || (!hidden && (!resolveWordClass(word, classes) || isInsignificant(word, classes)))) return;
        const top = token.getBoundingClientRect().bottom - bounds.top - 14;
        let line = measured.find(item => Math.abs(item.top - top) < 3);
        if (!line) { line = { top, indices: [], hidden: [] }; measured.push(line); }
        (hidden ? line.hidden : line.indices).push(index);
      });
      measured.sort((a, b) => a.top - b.top);
      setLines(old => JSON.stringify(old) === JSON.stringify(measured) ? old : measured);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule); observer.observe(root);
    window.addEventListener('resize', schedule); document.fonts.addEventListener('loadingdone', schedule);
    document.fonts.ready.then(() => { if (!disposed) schedule(); }); schedule();
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('resize', schedule); document.fonts.removeEventListener('loadingdone', schedule); };
  }, [contentRef, words, classes, layoutKey]);

  const keyFor = (line: Line, hidden: boolean) => `${hidden ? 'hidden' : 'class'}:${(hidden ? line.hidden : line.indices).join(',')}`;
  const activeLine = active && lines.find(line => keyFor(line, active.hidden) === active.key);
  // Follow the same paragraph boundaries as the comparison renderer; never borrow context from another paragraph.
  let paragraph = 0; let lastPara: number | null = null;
  const groups = words.map(word => {
    const para = word.base_paragraph_index ?? lastPara;
    if (lastPara !== null && para !== null && para !== lastPara) paragraph++;
    if (para !== null) lastPara = para;
    return paragraph;
  });
  return <>
    {lines.flatMap((line, index) => [false, true].map(hidden => {
      const indices = hidden ? line.hidden : line.indices;
      if (!indices.length) return null;
      const key = keyFor(line, hidden);
      return <button key={key} type="button" data-line-words={!hidden ? indices.join(',') : undefined} data-hidden-words={hidden ? indices.join(',') : undefined}
        aria-label={`${hidden ? 'Скрытые изменения' : 'Классы изменений'} строки ${index + 1}: ${indices.length}`} aria-haspopup="dialog" aria-expanded={active?.key === key}
        onClick={event => setActive(active?.key === key ? null : { key, hidden, anchor: event.currentTarget })}
        title={hidden ? 'Скрытые вставки и удаления' : 'Классы словесных изменений'}
        className={`pdf-exclude absolute w-5 h-5 -translate-y-1/2 rounded-full border text-xs font-sans font-semibold leading-none focus-visible:outline-indigo-600 ${hidden ? 'border-slate-400 text-slate-600 bg-slate-50 hover:bg-slate-100' : 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'}`}
        style={{ top: line.top, left: hidden && line.indices.length ? 24 : 0 }}>i</button>;
    }))}
    {active && activeLine && <ChangePopover anchor={active.anchor} title={active.hidden ? 'Скрытые вставки и удаления' : 'Классы изменений в строке'} onClose={() => setActive(null)}>
      {active.hidden ? <><p className="text-xs text-slate-500 mb-3">Выберите другой класс или «Без класса», чтобы вернуть изменение в строку.</p>
        <ul className="space-y-3">{activeLine.hidden.map(index => <HiddenChange key={index} word={words[index]} index={index} classes={classes}
          previous={groups[index - 1] === groups[index] ? words[index - 1] : undefined}
          next={groups[index + 1] === groups[index] ? words[index + 1] : undefined} onAssign={onAssign} />)}</ul></>
        : <ul className="space-y-2">{activeLine.indices.map(index => {
          const word = words[index]; const cls = resolveWordClass(word, classes);
          return <li key={index}><button type="button" onClick={() => { setActive(null); onSelect(index); }}
            className="text-left w-full rounded-lg bg-slate-50 p-3 hover:bg-slate-100 border-l-[3px]" style={{ borderColor: cls?.color_hex }}>
            <span className="comparison-content block break-words">{wordChangeLabel(word)}</span>
            <span className="block mt-1 text-xs text-slate-600 break-words">{cls?.display_name}</span>
          </button></li>;
        })}</ul>}
    </ChangePopover>}
  </>;
}
