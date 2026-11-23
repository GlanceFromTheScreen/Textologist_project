"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { apiErrorMessage } from '@/lib/errors';
import { WordClass } from '@/components/WordClassSidebar';

interface ClassItem extends WordClass { is_global: boolean }

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'word' | 'char'>('word');
  const [color, setColor] = useState('#8b5cf6');

  useEffect(() => {
    api.get('/classes/').then(res => setClasses(res.data))
      .catch(e => setError(apiErrorMessage(e, 'Не удалось загрузить классы.')))
      .finally(() => setLoading(false));
  }, []);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true); setError('');
    try {
      const res = await api.post('/classes/', { display_name: name.trim(), color_hex: color, kind });
      setClasses(current => [...current, res.data]); setName('');
    } catch (e) { setError(apiErrorMessage(e, 'Не удалось создать класс.')); }
    finally { setCreating(false); }
  };

  return <main className="min-h-screen bg-slate-50 px-6 py-8 text-slate-900">
    <div className="max-w-5xl mx-auto space-y-8">
      <div><h1 className="text-3xl font-bold">Классы изменений</h1>
        <p className="mt-2 text-slate-500">Словесные классы отмечают замены, вставки и удаления слов. Посимвольные — изменения внутри слов.</p></div>
      <section className="bg-white border border-slate-200 p-6 rounded-xl">
        <h2 className="text-lg font-semibold mb-4">Новый класс</h2>
        <form onSubmit={create} className="flex items-end flex-wrap gap-4">
          <div><label htmlFor="class-kind" className="block text-sm mb-1">Тип класса</label>
            <select id="class-kind" value={kind} onChange={e => setKind(e.target.value as 'word' | 'char')} className="border rounded-lg p-2.5 bg-white">
              <option value="word">Словесный</option><option value="char">Посимвольный</option>
            </select></div>
          <div className="flex-1 min-w-[200px]"><label htmlFor="class-name" className="block text-sm mb-1">Название класса</label>
            <input id="class-name" required maxLength={200} value={name} onChange={e => setName(e.target.value)} className="w-full border rounded-lg p-2.5" placeholder="Например, лексическая замена" /></div>
          <div><label htmlFor="class-color" className="block text-sm mb-1">Цвет</label>
            <input id="class-color" type="color" value={color} onInput={e => setColor(e.currentTarget.value)} onChange={e => setColor(e.target.value)} className="h-11 w-16 border rounded-lg cursor-pointer" /></div>
          <button disabled={creating || !name.trim()} className="bg-indigo-600 text-white rounded-lg px-5 py-2.5 disabled:opacity-50">{creating ? 'Создание…' : 'Создать класс'}</button>
        </form>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      </section>
      {(['word', 'char'] as const).map(sectionKind => <section key={sectionKind} aria-label={sectionKind === 'word' ? 'Словесные классы' : 'Посимвольные классы'} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100"><h2 className="text-xl font-semibold">{sectionKind === 'word' ? 'Словесные классы' : 'Посимвольные классы'}</h2>
          <p className="text-sm text-slate-500 mt-1">Без класса — начальное состояние. {sectionKind === 'word' ? 'Подчёркивание получает цвет после назначения класса.' : 'Эти классы используются для посимвольных изменений.'}</p></div>
        {loading ? <p className="p-6 text-slate-500" role="status">Загрузка…</p> : <ul className="divide-y divide-slate-100">
          {classes.filter(cls => cls.kind === sectionKind).map(cls => <li key={cls.id} className="px-6 py-4 flex gap-4 items-center">
            <span className="w-6 h-6 shrink-0 rounded border border-black/10" style={{ backgroundColor: cls.color_hex }} />
            <span className="font-medium break-words flex-1 min-w-0">{cls.display_name}</span>
            <span className="text-xs text-slate-500">{cls.system_key ? 'Предустановленный' : cls.is_global ? 'Общий' : 'Личный'}</span>
          </li>)}
          {!classes.some(cls => cls.kind === sectionKind) && <li className="px-6 py-5 text-sm text-slate-500">Пока нет классов. Добавьте первый выше{sectionKind === 'word' ? ' или в сравнении при клике на слово' : ''}.</li>}
        </ul>}
      </section>)}
    </div>
  </main>;
}
