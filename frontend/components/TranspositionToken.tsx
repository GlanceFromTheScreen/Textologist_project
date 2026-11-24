"use client";

import { ClassifiedWord } from './WordClassSidebar';

export function TranspositionPreview({ word, number = 1, color }: { word: ClassifiedWord; number?: number; color?: string }) {
  return <span className="min-w-0 max-w-full inline-flex flex-wrap items-end gap-1.5 align-bottom comparison-content">
    {(word.transpose_parts || []).map((part, index) => <span key={index} className="min-w-0 max-w-full inline-flex flex-col items-center">
      <span className="font-sans text-[10px] text-violet-700 leading-[18px] mb-1">r{number}.{index + 1}</span>
      <span className="comparison-token-text bg-violet-100 text-slate-900 whitespace-pre-wrap leading-normal rounded-t border-b-2 px-1.5 py-0.5" style={{ borderBottomColor: color || '#ede9fe' }}>{part.base_token}</span>
    </span>)}
    <span className="font-sans text-xs text-violet-700 leading-normal pb-1">(Tr)</span>
  </span>;
}

export default function TranspositionToken({ word, index, number, color, selected, onSelect }: {
  word: ClassifiedWord; index: number; number: number; color?: string; selected: boolean; onSelect: () => void;
}) {
  return <button type="button" data-word-index={index} data-flow-index={index} data-transposition={number}
    aria-label={`Перестановка r${number}: ${word.base_token} → ${word.other_token}`} aria-pressed={selected}
    onClick={onSelect} className={`mr-1.5 inline-flex align-bottom min-h-[3.5rem] items-end rounded focus-visible:outline-indigo-600 ${selected ? 'ring-2 ring-indigo-500 ring-offset-2' : 'hover:brightness-95'}`}>
    <TranspositionPreview word={word} number={number} color={color} />
  </button>;
}
