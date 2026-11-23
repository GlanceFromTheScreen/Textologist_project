"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import FilePicker from '@/components/FilePicker';
import { apiErrorMessage } from '@/lib/errors';
import { useRouter } from 'next/navigation';

interface Text {
  id: number;
  title: string;
  source_type: string;
  created_at: string;
}

export default function TextsPage() {
  const [texts, setTexts] = useState<Text[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Upload state
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState('');

  const router = useRouter();

  const fetchTexts = async () => {
    try {
      const res = await api.get('/texts/');
      setTexts(res.data);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTexts();
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title.trim() || file.name.replace(/\.[^.]+$/, ''));

    setUploading(true);
    try {
      await api.post('/texts/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      // Reset form and reload list
      setFile(null);
      setTitle('');
      setUploading(false);
      fetchTexts();
    } catch (err) {
      console.error(err);
      alert('Не удалось загрузить файл');
      setUploading(false);
    }
  };

  const handleRename = async (event: React.FormEvent, id: number) => {
    event.preventDefault();
    if (!editTitle.trim() || renaming) return;
    setRenaming(true);
    setRenameError('');
    try {
      const response = await api.patch(`/texts/${id}`, { title: editTitle.trim() });
      setTexts(current => current.map(text => text.id === id ? { ...text, ...response.data } : text));
      setEditingId(null);
    } catch (error) {
      setRenameError(apiErrorMessage(error, 'Не удалось переименовать текст. Попробуйте ещё раз.'));
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async (id: number) => {
      if(!confirm("Вы уверены, что хотите удалить этот объект?")) return;
      try {
          await api.delete(`/texts/${id}`);
          fetchTexts();
      } catch (e) {
          console.error(e);
          alert('Не удалось удалить');
      }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans text-slate-900">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
            <div>
                <h1 className="text-3xl font-bold text-slate-900">Мои тексты</h1>
                <p className="text-slate-500 mt-1">Управление корпусом текстов</p>
            </div>
            <button 
                onClick={() => router.push('/dashboard')} 
                className="text-slate-500 hover:text-indigo-600 transition-colors flex items-center gap-2"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                На главную
            </button>
        </div>

        {renameError && <p role="alert" className="mb-4 text-red-600">{renameError}</p>}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Upload Card */}
            <div className="lg:col-span-1">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 sticky top-24">
                    <h2 className="font-bold text-lg mb-4 text-slate-800 flex items-center gap-2">
                        <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                        Загрузить новый текст
                    </h2>
                    <form onSubmit={handleUpload} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Название (необязательно)</label>
                            <input 
                                type="text" 
                                className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 bg-slate-50 text-sm"
                                placeholder="Например, первая редакция"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Файл (.txt или .docx)</label>
                            <FilePicker accept=".txt,.docx" file={file} onChange={setFile} disabled={uploading} />
                        </div>
                        <button 
                            type="submit" 
                            disabled={!file || uploading}
                            className="w-full bg-indigo-600 text-white py-2.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-sm font-medium flex justify-center items-center"
                        >
                            {uploading ? (
                                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : 'Загрузить текст'}
                        </button>
                    </form>
                </div>
            </div>

            {/* List */}
            <div className="lg:col-span-2">
                 <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                        <h2 className="font-bold text-lg text-slate-800">Библиотека</h2>
                        <span className="text-xs font-medium bg-slate-100 text-slate-600 px-2 py-1 rounded-full">Текстов: {texts.length}</span>
                    </div>
                    
                    {loading ? (
                        <div className="p-8 text-center text-slate-400">Загрузка…</div>
                    ) : texts.length === 0 ? (
                        <div className="p-12 text-center text-slate-400">
                            <svg className="w-12 h-12 mx-auto mb-3 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            <p>Текстов пока нет. Загрузите первый документ.</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {texts.map(text => (
                                <div key={text.id} className="p-4 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 group">
                                    <div className="flex items-center gap-4 flex-1 min-w-0">
                                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${text.source_type === 'docx' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-600'}`}>
                                            <span className="text-xs font-bold uppercase">{text.source_type}</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            {editingId === text.id ? (
                                              <form onSubmit={event => handleRename(event, text.id)} className="flex flex-wrap gap-2 mb-2">
                                                <label className="sr-only" htmlFor={`text-title-${text.id}`}>Название текста</label>
                                                <input
                                                  id={`text-title-${text.id}`}
                                                  value={editTitle}
                                                  onChange={event => setEditTitle(event.target.value)}
                                                  onKeyDown={event => {
                                                    if (event.key === 'Escape' && !renaming) setEditingId(null);
                                                  }}
                                                  autoFocus required maxLength={200} disabled={renaming}
                                                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                                                />
                                                <button type="submit" disabled={renaming || !editTitle.trim()} className="bg-indigo-600 text-white px-3 py-2 rounded text-sm disabled:opacity-50">
                                                  {renaming ? 'Сохранение…' : 'Сохранить'}
                                                </button>
                                                <button type="button" disabled={renaming} onClick={() => setEditingId(null)} className="border px-3 py-2 rounded text-sm">Отмена</button>
                                              </form>
                                            ) : <h3 className="font-medium text-slate-900 group-hover:text-indigo-600 transition-colors break-words">{text.title}</h3>}
                                            <p className="text-xs text-slate-500">
                                                Добавлено: {new Date(text.created_at).toLocaleDateString('ru-RU')} • № {text.id}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        {editingId !== text.id && (
                                          <button
                                            disabled={renaming}
                                            onClick={() => {
                                              setEditingId(text.id);
                                              setEditTitle(text.title);
                                              setRenameError('');
                                            }}
                                            className="text-indigo-600 hover:bg-indigo-50 px-3 py-2 rounded text-sm disabled:opacity-50"
                                          >Переименовать</button>
                                        )}
                                        <button 
                                            onClick={() => handleDelete(text.id)}
                                            disabled={renaming}
                                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                            title="Удалить текст"
                                            aria-label={`Удалить ${text.title}`}
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
        </div>
      </div>
    </div>
  );
}
