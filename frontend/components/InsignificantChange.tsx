"use client";

import { useState } from 'react';
import ChangePopover from './ChangePopover';
import { TranspositionPreview } from './TranspositionToken';
import { ClassifiedWord, WordClass } from './WordClassSidebar';

export interface PreviewWord extends ClassifiedWord {
  char_ops?: { op_type: string; from_str: string; to_str: string; class_id: number | null }[];
}

/** The original change presentation, deliberately composed only of noninteractive spans. */
export function ReadOnlyChange({ word, classes, pairNumber }: { word: PreviewWord; classes: WordClass[]; pairNumber?: number }) {
  if (word.op_type === "transpose") return <TranspositionPreview word={word} number={pairNumber} />;
  return <span className="comparison-content inline-flex flex-col items-center align-bottom max-w-full" data-change-preview>
    {word.op_type === 'replace' && <span className="flex flex-wrap justify-center gap-1 mb-1">
      {(word.char_ops || []).map((char, index) => {
        const cls = classes.find(item => item.kind === 'char' && item.id === char.class_id);
        return <span key={index} title={cls?.display_name || 'Без класса'}
          className="char-op-badge rounded border border-black/10 px-1.5 text-xs text-slate-900"
          style={{ backgroundColor: cls?.color_hex || '#e0e7ff' }}>
          {char.from_str || '∅'} → {char.to_str || '∅'}
        </span>;
      })}
    </span>}
    <span className={`whitespace-pre-wrap px-1.5 py-0.5 rounded break-words max-w-full ${word.op_type === 'replace' ? 'bg-amber-50 text-slate-900' : word.op_type === 'insert' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600 line-through decoration-rose-300'}`}>
      {word.op_type === 'insert' ? word.other_token : word.base_token}
      {word.op_type === 'replace' && <span className="text-slate-400 ml-2">[{word.other_token}]</span>}
    </span>
  </span>;
}

export default function InsignificantReplacement({ word, index, classes, onSelect, pairNumber }: {
  pairNumber?: number; word: PreviewWord; index: number; classes: WordClass[]; onSelect: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const label = word.op_type === "transpose" ? "Скрытая перестановка" : "Скрытая замена";
  return <span className="mr-1.5 inline-flex flex-col items-center align-bottom justify-end h-[3.5rem]">
    <button type="button" aria-label={`${label}: ${word.base_token} → ${word.other_token}`} aria-haspopup="dialog" aria-expanded={!!anchor}
      className="pdf-exclude w-4 h-4 mb-1 rounded-full border border-slate-400 text-slate-600 text-[10px] font-sans leading-none hover:bg-slate-100"
      onClick={e => setAnchor(anchor ? null : e.currentTarget)}>i</button>
    <button type="button" data-word-index={index} data-flow-index={index} onClick={onSelect}
      aria-label={`Словесное изменение: ${word.base_token} → ${word.other_token}`} title="Несущественные изменения"
      className="whitespace-pre-wrap leading-normal px-0 py-0.5 border-b-2 border-transparent text-black bg-transparent focus-visible:outline-indigo-600">{word.base_token}</button>
    {anchor && <ChangePopover anchor={anchor} title={label} onClose={() => setAnchor(null)}>
      <div className="py-3 text-center"><ReadOnlyChange word={word} classes={classes} pairNumber={pairNumber} /></div>
      <p className="text-xs text-slate-500 mt-3">Для изменения разметки выберите другой словесный класс, нажав на чёрное слово в тексте.</p>
    </ChangePopover>}
  </span>;
}
