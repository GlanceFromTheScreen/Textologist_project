"use client";

import { useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import { apiErrorMessage } from '@/lib/errors';

export interface WordClass {
  id: number;
  code: string;
  display_name: string;
  color_hex: string;
  kind: 'word' | 'char';
  hidden?: boolean;
  system_key?: 'insignificant' | null;
}
export interface ClassifiedWord {
  transpose_parts?: { base_token: string | null; other_token: string | null }[] | null;
  op_type: 'equal' | 'insert' | 'delete' | 'replace' | 'transpose';
  base_token: string | null;
  other_token: string | null;
  class_id?: number | null;
  word_class?: { code: string; display_name: string; color_hex: string; system_key?: 'insignificant' | null } | null;
}
export function wordChangeLabel(op: ClassifiedWord) {
  return `${op.base_token || '∅'} → ${op.other_token || '∅'}`;
}
export function resolveWordClass(op: ClassifiedWord, classes: WordClass[]) {
  if (!op.class_id) return null;
  return classes.find(cls => cls.kind === 'word' && cls.id === op.class_id) || op.word_class || null;
}

export function isInsignificant(op: ClassifiedWord, classes: WordClass[]) {
  return resolveWordClass(op, classes)?.system_key === 'insignificant';
}

export default function WordClassSidebar({ word, classes, unsaved, onAssign, onCreate, onClose }: {
  word: ClassifiedWord;
  classes: WordClass[];
  unsaved: boolean;
  onAssign: (classId: number | null, createdClass?: WordClass) => Promise<void>;
  onCreate: (cls: WordClass) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#8b5cf6');
  const selectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => { selectRef.current?.focus(); }, []);

  const assign = async (id: number | null) => {
    setBusy(true); setError('');
    try { await onAssign(id); }
    catch (e) { setError(apiErrorMessage(e, 'Не удалось сохранить класс. Попробуйте ещё раз.')); }
    finally { setBusy(false); }
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const response = await api.post('/classes/', { display_name: name.trim(), color_hex: color, kind: 'word' });
      onCreate(response.data);
      setCreating(false); setName('');
      await onAssign(response.data.id, response.data);
    } catch (e) { setError(apiErrorMessage(e, 'Не удалось создать или назначить класс.')); }
    finally { setBusy(false); }
  };
  const selected = resolveWordClass(word, classes);
  return <section className="flex flex-col h-full" aria-label="Класс словесного изменения">
    <div className="p-6 border-b border-slate-100 flex justify-between items-start gap-3">
      <h2 className="text-lg font-bold">Словесное изменение</h2>
      <button type="button" onClick={onClose} aria-label="Закрыть класс словесного изменения" className="text-slate-500 text-xl px-1">×</button>
    </div>
    <div className="p-6 space-y-6 overflow-y-auto">
      <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 break-words">
        <div className="text-xs text-slate-500 mb-2">{word.op_type === 'transpose' ? 'Перестановка соседних слов' : word.op_type === 'replace' ? 'Замена' : word.op_type === 'insert' ? 'Вставка' : 'Удаление'}</div>
        <div className="comparison-content text-xl">{wordChangeLabel(word)}</div>
      </div>
      <div>
        <label htmlFor="word-class" className="block text-sm font-medium mb-2">Класс изменения</label>
        <select ref={selectRef} id="word-class" value={word.class_id ?? ''} disabled={busy}
          onChange={event => assign(event.target.value ? Number(event.target.value) : null)}
          className="w-full border border-slate-300 rounded-lg p-2.5 bg-white disabled:opacity-50">
          <option value="">Без класса</option>
          {classes.filter(cls => cls.kind === 'word' && (!cls.hidden || cls.id === word.class_id)).map(cls =>
            <option key={cls.id} value={cls.id}>{cls.display_name}</option>)}
        </select>
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-600" role="status">
          {selected && <span className="w-4 h-1 rounded" style={{ backgroundColor: selected.color_hex }} />}
          {busy ? 'Сохранение…' : selected?.display_name || 'Без класса'}
        </p>
        {selected?.system_key === 'insignificant' && <p className="mt-3 text-sm text-slate-600">Разметка скрыта в сноске i. Выберите другой класс или «Без класса», чтобы вернуть полный вид.</p>}
        <p className="text-xs text-slate-500 mt-2">{unsaved ? 'Есть изменения операций. Нажмите «Сохранить в историю», чтобы сохранить их вместе с классами.' : 'Выбор сохраняется автоматически.'}</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {creating ? <form onSubmit={create} className="border-t border-slate-200 pt-5 space-y-4">
        <h3 className="font-semibold">Новый словесный класс</h3>
        <div><label htmlFor="new-word-class-name" className="block text-sm mb-1">Название класса</label>
          <input autoFocus id="new-word-class-name" required maxLength={200} value={name} onChange={e => setName(e.target.value)} className="w-full border rounded-lg p-2" /></div>
        <div><label htmlFor="new-word-class-color" className="block text-sm mb-1">Цвет подчёркивания</label>
          <input id="new-word-class-color" type="color" value={color} onInput={e => setColor(e.currentTarget.value)} onChange={e => setColor(e.target.value)} className="h-10 w-16 border rounded cursor-pointer" /></div>
        <div className="flex flex-wrap gap-3">
          <button disabled={busy || !name.trim()} className="bg-indigo-600 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-50">Создать и назначить</button>
          <button type="button" disabled={busy} onClick={() => setCreating(false)} className="text-sm text-slate-600">Отмена</button>
        </div>
      </form> : <button type="button" disabled={busy} onClick={() => setCreating(true)} className="text-indigo-600 text-sm font-medium hover:underline">+ Создать словесный класс</button>}
    </div>
  </section>;
}
