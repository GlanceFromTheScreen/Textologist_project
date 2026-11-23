"use client";

import { useId, useState } from 'react';

const common = [
  [' ', 'Пробел'], ['\t', 'Табуляция'], ['\u00a0', 'Неразрывный пробел'],
  [',', 'Запятая (,)'], ['.', 'Точка (.)'], [';', 'Точка с запятой (;)'],
  [':', 'Двоеточие (:)'], ['-', 'Дефис (-)'],
];
export function separatorLabel(character: string): string {
  return common.find(([value]) => value === character)?.[1] || ({'\n': 'Перенос строки', '\r': 'Возврат каретки'} as Record<string, string>)[character] || `«${character}»`;
}

export default function SeparatorPicker({value, onChange, disabled = false}: {
  value: string[]; onChange: (value: string[]) => void; disabled?: boolean;
}) {
  const id = useId();
  const [custom, setCustom] = useState('');
  const toggle = (character: string) => {
    if (value.includes(character)) {
      if (value.length > 1) onChange(value.filter(item => item !== character));
    } else onChange([...value, character]);
  };
  const add = () => {
    if (!custom || disabled) return;
    onChange(Array.from(new Set([...value, ...Array.from(custom)])));
    setCustom('');
  };
  return <fieldset disabled={disabled} className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
    <legend className="px-1 text-sm font-semibold text-slate-700">Разделители текста</legend>
    <p className="text-xs text-slate-500">Выберите хотя бы один символ. Разделители не входят в сравниваемые элементы. Абзацы всегда разделяются.</p>
    <div className="flex flex-wrap gap-x-4 gap-y-2">{common.map(([character, label]) => <label key={character} className="inline-flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" checked={value.includes(character)} disabled={disabled || (value.length === 1 && value.includes(character))} onChange={() => toggle(character)} className="rounded text-indigo-600" />{label}
    </label>)}</div>
    <div><label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1">Другие символы</label><div className="flex gap-2">
      <input id={id} value={custom} onChange={event => setCustom(event.target.value)} onKeyDown={event => {if (event.key === 'Enter') {event.preventDefault(); add();}}} placeholder="Например: /|·" className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm" />
      <button type="button" disabled={disabled || !custom} onClick={add} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">Добавить</button>
    </div><p className="text-xs text-slate-500 mt-1">Каждый введённый символ добавляется отдельно.</p></div>
    <div className="flex flex-wrap gap-2" aria-label="Выбранные разделители">{value.map(character => <button key={character} type="button" disabled={disabled || value.length === 1} onClick={() => toggle(character)} aria-label={`Убрать разделитель: ${separatorLabel(character)}`} className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700 disabled:opacity-60">{separatorLabel(character)} <span aria-hidden="true">×</span></button>)}</div>
    {!value.length && <p role="alert" className="text-sm text-red-600">Выберите хотя бы один разделитель.</p>}
  </fieldset>;
}
