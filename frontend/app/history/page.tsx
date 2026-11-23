"use client";

import { FormEvent, useEffect, useState } from 'react';
import api from '@/lib/api';
import { apiErrorMessage } from '@/lib/errors';
import { useRouter } from 'next/navigation';

interface Comparison {
  id: number;
  title: string | null;
  base_text_id: number | null;
  other_text_id: number | null;
  base_text_title?: string;
  other_text_title?: string;
  created_at: string;
}

export default function HistoryPage() {
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    api.get('/comparisons/?saved_only=true')
      .then(res => setComparisons(res.data))
      .catch(err => setError(apiErrorMessage(err, 'Не удалось загрузить историю сравнений.')))
      .finally(() => setLoading(false));
  }, []);

  const handleRename = async (event: FormEvent, id: number) => {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await api.patch(`/comparisons/${id}`, { title: title.trim() });
      setComparisons(items => items.map(item => item.id === id ? { ...item, ...response.data } : item));
      setEditingId(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Не удалось переименовать сравнение. Попробуйте ещё раз.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Удалить это сохранённое сравнение?')) return;
    try {
      await api.delete(`/comparisons/${id}`);
      setComparisons(items => items.filter(item => item.id !== id));
      if (editingId === id) setEditingId(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Не удалось удалить.'));
    }
  };

  if (loading) return <div className="p-8">Загрузка истории…</div>;

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto bg-white p-8 rounded shadow">
        <div className="flex flex-wrap gap-4 justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">История сравнений</h1>
          <button onClick={() => router.push('/dashboard')} className="text-blue-500 hover:underline">На главную</button>
        </div>
        {error && <p role="alert" className="text-red-600 mb-4">{error}</p>}
        {comparisons.length === 0 ? (
          <p className="text-gray-500">Сохранённых сравнений пока нет.</p>
        ) : (
          <div className="space-y-4">
            {comparisons.map(comp => (
              <div key={comp.id} className="border p-4 rounded hover:bg-gray-50 flex flex-col sm:flex-row gap-4 justify-between sm:items-center">
                <div className="flex-1 min-w-0 w-full">
                  {editingId === comp.id ? (
                    <form onSubmit={event => handleRename(event, comp.id)} className="flex flex-wrap gap-2">
                      <label className="sr-only" htmlFor={`comparison-title-${comp.id}`}>Название сравнения</label>
                      <input
                        id={`comparison-title-${comp.id}`}
                        value={title}
                        onChange={event => setTitle(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === 'Escape' && !saving) setEditingId(null);
                        }}
                        maxLength={200}
                        required
                        autoFocus
                        disabled={saving}
                        className="border rounded px-3 py-2 w-full sm:w-auto sm:flex-1 min-w-0"
                      />
                      <button type="submit" disabled={saving || !title.trim()} className="bg-indigo-600 text-white px-3 py-2 rounded disabled:opacity-50">
                        {saving ? 'Сохранение…' : 'Сохранить'}
                      </button>
                      <button type="button" disabled={saving} onClick={() => setEditingId(null)} className="border px-3 py-2 rounded">Отмена</button>
                    </form>
                  ) : (
                    <a href={`/compare/${comp.id}`} className="font-semibold text-lg text-indigo-700 hover:underline break-words">
                      {comp.title || `Сравнение №${comp.id}`}
                    </a>
                  )}
                  {comp.base_text_id !== null && comp.other_text_id !== null ? (
                    <p className="text-sm text-gray-700 mt-1 break-words">
                      {comp.base_text_title || `Текст ${comp.base_text_id}`} <span className="text-gray-400 mx-1">и</span> {comp.other_text_title || `Текст ${comp.other_text_id}`}
                    </p>
                  ) : <p className="text-sm text-gray-500 mt-1">Импортированное сравнение</p>}
                  <p className="text-sm text-gray-500 mt-1">Создано: {new Date(comp.created_at).toLocaleString('ru-RU')}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {editingId !== comp.id && (
                    <button
                      disabled={saving}
                      onClick={() => {
                        setEditingId(comp.id);
                        setTitle(comp.title || `Сравнение №${comp.id}`);
                        setError('');
                      }}
                      className="text-indigo-600 hover:bg-indigo-50 px-3 py-2 rounded disabled:opacity-50"
                    >Переименовать</button>
                  )}
                  <button
                    onClick={() => handleDelete(comp.id)}
                    disabled={saving}
                    className="text-gray-500 hover:text-red-600 p-2 rounded hover:bg-red-50"
                    title="Удалить сравнение"
                    aria-label={`Удалить ${comp.title || `Сравнение №${comp.id}`}`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
