"use client";

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import { apiErrorMessage } from '@/lib/errors';
import { useRouter } from 'next/navigation';

export default function Dashboard() {
  const [user, setUser] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const importInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportError('');
    if (file.size > 10 * 1024 * 1024) {
      setImportError('Размер JSON-файла не должен превышать 10 МБ.');
      return;
    }
    setImporting(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await api.post('/comparisons/import', form);
      router.push(`/compare/${response.data.id}`);
    } catch (error) {
      setImportError(apiErrorMessage(error, 'Не удалось импортировать сравнение. Попробуйте ещё раз.'));
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    // Fetch user info
    api.get('/auth/me')
      .then(res => {
        setUser(res.data);
      })
      .catch(() => {
        router.push('/login');
      });
  }, [router]);

  const handleCleanup = async () => {
      if(!confirm("Удалить все несохранённые черновики сравнений? Это действие нельзя отменить.")) return;
      try {
          const res = await api.delete('/comparisons/cleanup');
          alert(`Удалено черновиков: ${res.data.deleted}.`);
      } catch (e) {
          console.error(e);
          alert('Не удалось удалить черновики');
      }
  };

  if (!user) return <div className="p-8">Загрузка…</div>;

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Добро пожаловать, {user.username}</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {user.role === 'admin' && <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Пользователи</h2>
            <p className="text-gray-600 mb-4">Создание аккаунтов, изменение логинов и паролей.</p>
            <button onClick={() => router.push('/users')} className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700">Управление пользователями</button>
          </div>}

          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Мои тексты</h2>
            <p className="text-gray-600 mb-4">Загружайте тексты и управляйте ими.</p>
            <button 
              onClick={() => router.push('/texts')}
              className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
            >
              Открыть тексты
            </button>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Сравнения</h2>
            <p className="text-gray-600 mb-4">Создайте новое сравнение или откройте сохранённое.</p>
            <div className="flex flex-wrap gap-2">
                <button 
                  onClick={() => router.push('/compare')}
                  className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
                >
                  Новое
                </button>
                <button 
                  onClick={() => router.push('/history')}
                  className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
                >
                  Сохранённые
                </button>
                <input
                  ref={importInput}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  aria-label="Импорт сравнения из JSON"
                  onChange={handleImport}
                  disabled={importing}
                />
                <button
                  onClick={() => importInput.current?.click()}
                  disabled={importing}
                  className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 disabled:opacity-50"
                >
                  {importing ? 'Импорт…' : 'Импорт JSON'}
                </button>
            </div>
            <p className="text-sm text-gray-500 mt-3">Загрузите сравнение из JSON, чтобы открыть его и сохранить в истории.</p>
            {importError && <p role="alert" className="text-sm text-red-600 mt-3">{importError}</p>}
            {importing && <p role="status" className="text-sm text-gray-500 mt-3">Импорт сравнения…</p>}
          </div>
          
           <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Анализ и инструменты</h2>
            <p className="text-gray-600 mb-4">Матрица расстояний, пресеты и классы.</p>
            <div className="flex flex-wrap gap-2">
                <button 
                  onClick={() => router.push('/matrix')}
                  className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
                >
                  Матрица
                </button>
                <button 
                  onClick={() => router.push('/classes')}
                  className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
                >
                  Классы
                </button>
                <button 
                  onClick={() => router.push('/presets')}
                  className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
                >
                  Пресеты
                </button>
                <button 
                  onClick={() => router.push('/fonts')}
                  className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
                >
                  Шрифты
                </button>
                 <button 
                  onClick={handleCleanup}
                  className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 transition-colors"
                  title="Удалить несохранённые черновики"
                >
                  Удалить черновики
                </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
