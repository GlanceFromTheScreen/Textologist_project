"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { apiErrorMessage } from '@/lib/errors';
import { useRouter } from 'next/navigation';

interface PresetRule {
  id: number;
  kind: 'char' | 'word';
  op_type: string;
  from_str: string;
  to_str: string;
  base_word: string | null;
  other_word: string | null;
  class_id: number | null;
  is_deleted: boolean;
}
interface Preset {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  rules: PresetRule[];
}
interface ClassItem { id: number; display_name: string; color_hex: string; }
const operationNames: Record<string, string> = {
  change: 'Замена символов', replace: 'Замена слов', insert: 'Добавление / удаление',
  delete: 'Удаление / добавление', transpose: 'Перестановка (Tr)',
};

export default function PresetsPage() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [classes, setClasses] = useState<Record<number, ClassItem>>({});
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [busyRule, setBusyRule] = useState<number | null>(null);
  const [error, setError] = useState('');
  const router = useRouter();

  const fetchData = async () => {
    try {
      const [presetsRes, classesRes] = await Promise.all([api.get('/presets/'), api.get('/classes/')]);
      setPresets(presetsRes.data);
      setClasses(Object.fromEntries(classesRes.data.map((c: ClassItem) => [c.id, c])));
    } catch (err) { setError(apiErrorMessage(err, 'Не удалось загрузить пресеты.')); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchData(); }, []);

  const handleDelete = async (id: number) => {
    if (!confirm('Удалить пресет целиком?')) return;
    try { await api.delete(`/presets/${id}`); await fetchData(); }
    catch (err) { setError(apiErrorMessage(err, 'Не удалось удалить пресет.')); }
  };

  const changeRule = async (presetId: number, rule: PresetRule) => {
    if (busyRule !== null) return;
    setBusyRule(rule.id); setError('');
    try {
      const url = `/presets/${presetId}/rules/${rule.id}`;
      const response = rule.is_deleted ? await api.post(`${url}/restore`) : await api.delete(url);
      setPresets(items => items.map(preset => preset.id === presetId ? {
        ...preset, rules: preset.rules.map(item => item.id === rule.id ? response.data : item),
      } : preset));
    } catch (err) { setError(apiErrorMessage(err, 'Не удалось изменить правило.')); }
    finally { setBusyRule(null); }
  };

  const renderRules = (preset: Preset, rules: PresetRule[]) => <div className="overflow-x-auto rounded-lg border border-slate-200">
    <table className="min-w-full text-sm text-left">
      <thead className="bg-slate-50 text-slate-500"><tr>
        <th className="p-3">Изменение ↔</th><th className="p-3">Контекст слов</th>
        <th className="p-3">Класс</th><th className="p-3"><span className="sr-only">Действия</span></th>
      </tr></thead>
      <tbody>{rules.map(rule => {
        const cls = rule.class_id ? classes[rule.class_id] : null;
        const legacy = rule.kind === 'char' && (!rule.base_word || !rule.other_word);
        return <tr key={rule.id} className={`border-t border-slate-100 ${rule.is_deleted ? 'bg-slate-50 text-slate-500' : ''}`}>
          <td className="p-3"><div className="font-medium break-words">{rule.from_str || '∅'} ↔ {rule.to_str || '∅'}</div>
            <div className="text-xs text-slate-500 mt-1">{operationNames[rule.op_type] || rule.op_type}</div></td>
          <td className="p-3">{rule.kind === 'word' ? <span className="text-slate-500">Точная пара слов</span> : legacy ?
            <span className="text-amber-700">Без контекста — не применяется</span> : <>{rule.base_word} ↔ {rule.other_word}<div className="text-xs text-slate-500 mt-1">Достаточно совпадения одного слова</div></>}</td>
          <td className="p-3">{cls ? <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-full shrink-0 border" style={{backgroundColor: cls.color_hex}} />{cls.display_name}</span> : <span className="text-slate-400">Без класса</span>}</td>
          <td className="p-3 text-right"><button type="button" disabled={busyRule !== null}
            aria-label={`${rule.is_deleted ? 'Восстановить' : 'Удалить'} правило ${rule.from_str || '∅'} ↔ ${rule.to_str || '∅'}${rule.kind === 'char' ? ` (${rule.base_word || 'без контекста'} ↔ ${rule.other_word || 'без контекста'})` : ''}`}
            onClick={() => changeRule(preset.id, rule)} className={`${rule.is_deleted ? 'text-indigo-600' : 'text-red-600'} hover:underline disabled:opacity-50`}>
            {busyRule === rule.id ? 'Сохранение…' : rule.is_deleted ? 'Восстановить' : 'Удалить правило'}
          </button></td>
        </tr>;
      })}</tbody>
    </table>
    {!rules.length && <p className="p-4 text-sm text-slate-500">Правил нет.</p>}
  </div>;

  return <div className="min-h-screen bg-slate-50 p-8 text-slate-900"><div className="max-w-6xl mx-auto">
    <div className="flex justify-between items-center mb-3"><h1 className="text-3xl font-bold">Пресеты</h1>
      <button onClick={() => router.push('/dashboard')} className="text-indigo-600 hover:underline">На главную</button></div>
    <p className="text-slate-600 mb-6">Посимвольные классы применяются в контексте слов, словесные — к точной паре слов. Все правила работают в обе стороны.</p>
    {error && <p role="alert" className="mb-4 text-red-700">{error}</p>}
    {loading && <p>Загрузка…</p>}
    {!loading && !presets.length && <p className="bg-white border rounded-xl p-6">Пресетов пока нет. Сохраните пресет из размеченного сравнения.</p>}
    <div className="space-y-4">{presets.map(preset => {
      const active = preset.rules.filter(rule => !rule.is_deleted);
      const charRules = active.filter(rule => rule.kind === 'char');
      const wordRules = active.filter(rule => rule.kind === 'word');
      const deleted = preset.rules.filter(rule => rule.is_deleted);
      const legacy = charRules.some(rule => !rule.base_word || !rule.other_word);
      return <section key={preset.id} aria-label={preset.name} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex justify-between items-start gap-4 flex-wrap"><div>
          <h2 className="font-semibold text-xl">{preset.name}</h2>
          {preset.description && <p className="text-sm text-slate-500 mt-1">{preset.description}</p>}
          <p className="text-sm text-slate-500 mt-2">Посимвольные: {charRules.length} · Словесные: {wordRules.length} · {new Date(preset.created_at).toLocaleDateString('ru-RU')}</p>
        </div><div className="flex gap-4 text-sm">
          <button onClick={() => setExpandedId(expandedId === preset.id ? null : preset.id)} aria-expanded={expandedId === preset.id} className="text-indigo-600 hover:underline">{expandedId === preset.id ? 'Свернуть' : 'Редактировать'}</button>
          <button onClick={() => handleDelete(preset.id)} className="text-red-600 hover:underline">Удалить пресет</button>
        </div></div>
        {expandedId === preset.id && <div className="mt-5 space-y-4">
          <p className="text-sm text-slate-500">Удаление сохраняется сразу и влияет на новые сравнения. Удалённое правило можно восстановить.</p>
          {legacy && <p className="text-sm bg-amber-50 border border-amber-100 text-amber-800 rounded-lg p-3">В этом пресете есть старые правила без контекста. Они больше не применяются. Чтобы добавить контекст, заново сохраните пресет из исходного размеченного сравнения.</p>}
          <h3 className="font-semibold">Посимвольные изменения</h3>{renderRules(preset, charRules)}
          <h3 className="font-semibold">Словесные изменения</h3>{renderRules(preset, wordRules)}
          {!!deleted.length && <details><summary className="cursor-pointer text-sm text-slate-500 mb-3">Удалённые правила ({deleted.length})</summary>{renderRules(preset, deleted)}</details>}
        </div>}
      </section>;
    })}</div>
  </div></div>;
}
