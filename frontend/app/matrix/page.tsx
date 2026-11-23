"use client";

import { useEffect, useState } from 'react';
import SeparatorPicker from '@/components/SeparatorPicker';
import api from '@/lib/api';
import { useRouter } from 'next/navigation';

interface Text {
  id: number;
  title: string;
}

export default function MatrixPage() {
  const [separators, setSeparators] = useState<string[]>([' ']);
  const [texts, setTexts] = useState<Text[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  
  // Weights & Algorithm
  const [wTranspose, setWTranspose] = useState(1.0);
  const [wReplace, setWReplace] = useState(1.0);
  const [wDelete, setWDelete] = useState(1.0);
  const [wInsert, setWInsert] = useState(1.0);
  const [wCharReplace, setWCharReplace] = useState(1.0);
  const [wCharDelete, setWCharDelete] = useState(1.0);
  const [wCharInsert, setWCharInsert] = useState(1.0);
  const [algorithm, setAlgorithm] = useState('levenshtein');
  
  const [matrixData, setMatrixData] = useState<{labels: string[], matrix: number[][]}>({ labels: [], matrix: [] });
  const [loading, setLoading] = useState(false);
  
  const router = useRouter();

  useEffect(() => {
    api.get('/texts/')
      .then(res => setTexts(res.data))
      .catch(err => console.error(err));
  }, []);

  const toggleText = (id: number) => {
      setSelectedIds(prev => {
          if (prev.includes(id)) return prev.filter(x => x !== id);
          if (prev.length >= 20) {
              alert("Можно выбрать не более 20 текстов");
              return prev;
          }
          return [...prev, id];
      });
  };

  const handleCalculate = async () => {
    if (!separators.length) return;
      if (selectedIds.length < 2) {
          alert("Выберите хотя бы два текста");
          return;
      }
      
      setLoading(true);
      try {
          const res = await api.post('/distance-matrix/run', {
              text_ids: selectedIds,
              separators,
      weights: {
                  replace: wReplace,
        transpose: wTranspose,
                  delete: wDelete,
                  insert: wInsert,
                  char_replace: wCharReplace,
                  char_delete: wCharDelete,
                  char_insert: wCharInsert,
              },
              algorithm: algorithm
          });
          setMatrixData(res.data);
      } catch (err) {
          console.error(err);
          alert('Не удалось выполнить расчёт');
      } finally {
          setLoading(false);
      }
  };

  // Helper to calculate background color intensity based on distance
  const getCellColor = (val: number, maxVal: number) => {
      if (val === 0) return 'bg-white';
      // Normalize 0..1
      const ratio = Math.min(val / (maxVal || 1), 1);
      // Indigo-50 to Indigo-200 range approximately
      // We'll use inline styles for precise opacity/color mixing if needed, 
      // or just standard tailwind classes logic. 
      // Let's use RGBA for smooth gradient.
      // Base color: Indigo 600 (79, 70, 229)
      const opacity = ratio * 0.4; // max 40% opacity
      return `rgba(79, 70, 229, ${opacity})`;
  };
  
  const maxDistance = matrixData.matrix.flat().reduce((a, b) => Math.max(a, b), 0);

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans text-slate-900">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
            <div>
                <h1 className="text-3xl font-bold text-slate-900">Матрица расстояний</h1>
                <p className="text-slate-500 mt-1">Сравнение нескольких текстов одновременно</p>
            </div>
            <button 
                onClick={() => router.push('/dashboard')} 
                className="text-slate-500 hover:text-indigo-600 transition-colors flex items-center gap-2"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                На главную
            </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Sidebar: Selection & Config */}
            <div className="lg:col-span-1 space-y-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                    <h2 className="font-bold text-lg mb-4 text-slate-800 flex items-center gap-2">
                        <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                        Настройки
                    </h2>
                    
                    <div className="mb-6">
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-sm font-semibold text-slate-700">Выберите тексты</label>
                            <span className="text-xs text-slate-400">{selectedIds.length}/20</span>
                        </div>
                        <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg p-2 bg-slate-50 space-y-1 custom-scrollbar">
                            {texts.map(text => (
                                <label key={text.id} className="flex items-center space-x-3 cursor-pointer p-2 hover:bg-white hover:shadow-sm rounded-md transition-all">
                                    <input 
                                        type="checkbox" 
                                        checked={selectedIds.includes(text.id)}
                                        onChange={() => toggleText(text.id)}
                                        className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span className="text-sm text-slate-700 truncate select-none">{text.title}</span>
                                </label>
                            ))}
                            {texts.length === 0 && <div className="text-xs text-slate-400 text-center py-4">Тексты ещё не загружены</div>}
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="mb-4">
                            <SeparatorPicker value={separators} onChange={setSeparators} disabled={loading} />
                <label className="block text-sm font-semibold text-slate-700 mb-2">Алгоритм</label>
                            <select 
                                value={algorithm} 
                                onChange={(e) => setAlgorithm(e.target.value)}
                                className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-2 bg-slate-50"
                            >
                                <option value="levenshtein">Левенштейн</option>
                                <option value="levenshtein_nested">Левенштейн (вложенный)</option>
                                <option value="levenshtein_v2">Левенштейн 2.0</option>
                                <option value="myers">Майерс</option>
                            </select>
                        </div>

                        <h3 className="text-sm font-semibold text-slate-700 border-b border-slate-100 pb-2">Веса операций алгоритма</h3>
                        {algorithm !== 'myers' && <div className="mb-3">
                          <label htmlFor="transpose-weight" className="block text-xs font-medium text-slate-500 mb-1">Перестановка соседних слов (Tr)</label>
                          <input id="transpose-weight" type="number" min="0" step="0.1" value={wTranspose} onChange={e => setWTranspose(Number(e.target.value))} className="w-full border border-slate-200 rounded-md p-2 text-sm" />
                          <p className="mt-1 text-xs text-slate-500">Только точное совпадение слов. Во вложенном алгоритме стоимость масштабируется по различию слов.</p>
                        </div>}
                        {(algorithm === 'levenshtein' || algorithm === 'levenshtein_nested') && (
                        <div className="grid grid-cols-3 gap-2">
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Замена</label>
                                <input 
                                    type="number" step="0.1" min="0"
                                    className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-2 bg-slate-50"
                                    value={wReplace}
                                    onChange={e => setWReplace(parseFloat(e.target.value))}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Удаление</label>
                                <input 
                                    type="number" step="0.1" min="0"
                                    className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-2 bg-slate-50"
                                    value={wDelete}
                                    onChange={e => setWDelete(parseFloat(e.target.value))}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Вставка</label>
                                <input 
                                    type="number" step="0.1" min="0"
                                    className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-2 bg-slate-50"
                                    value={wInsert}
                                    onChange={e => setWInsert(parseFloat(e.target.value))}
                                />
                            </div>
                        </div>
                        )}
                        {algorithm === 'levenshtein_v2' && (
                        <div className="space-y-3 text-xs">
                            <p className="text-slate-500">Веса по умолчанию равны 1. Словесные веса задают стоимость замены, удаления и вставки; посимвольные применяются внутри замены.</p>
                            <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Словесные операции</p>
                                <div className="grid grid-cols-3 gap-2">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 mb-1">Замена</label>
                                        <input 
                                            type="number" step="0.1" min="0"
                                            className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-2 bg-slate-50"
                                            value={wReplace}
                                            onChange={e => setWReplace(parseFloat(e.target.value))}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 mb-1">Удаление</label>
                                        <input 
                                            type="number" step="0.1" min="0"
                                            className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-2 bg-slate-50"
                                            value={wDelete}
                                            onChange={e => setWDelete(parseFloat(e.target.value))}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 mb-1">Вставка</label>
                                        <input 
                                            type="number" step="0.1" min="0"
                                            className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-2 bg-slate-50"
                                            value={wInsert}
                                            onChange={e => setWInsert(parseFloat(e.target.value))}
                                        />
                                    </div>
                                </div>
                            </div>
                            <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Посимвольные операции</p>
                                <div className="grid grid-cols-3 gap-2">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 mb-1">Замена символа</label>
                                        <input 
                                            type="number" step="0.1" min="0"
                                            className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-2 bg-slate-50"
                                            value={wCharReplace}
                                            onChange={e => setWCharReplace(parseFloat(e.target.value))}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 mb-1">Удаление символа</label>
                                        <input 
                                            type="number" step="0.1" min="0"
                                            className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-2 bg-slate-50"
                                            value={wCharDelete}
                                            onChange={e => setWCharDelete(parseFloat(e.target.value))}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 mb-1">Вставка символа</label>
                                        <input 
                                            type="number" step="0.1" min="0"
                                            className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-2 bg-slate-50"
                                            value={wCharInsert}
                                            onChange={e => setWCharInsert(parseFloat(e.target.value))}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                        )}
                    </div>

                    <button 
                        onClick={handleCalculate}
                        disabled={loading || selectedIds.length < 2 || !separators.length}
                        className="w-full mt-6 bg-indigo-600 text-white py-2.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-sm transition-all active:scale-[0.98] flex justify-center items-center gap-2"
                    >
                        {loading ? (
                            <>
                                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Выполняется расчёт…
                            </>
                        ) : 'Рассчитать матрицу'}
                    </button>
                </div>
            </div>

            {/* Main: Matrix Display */}
            <div className="lg:col-span-3">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 overflow-hidden min-h-[400px]">
                    {matrixData.matrix.length > 0 ? (
                        <div className="overflow-x-auto">
                            <h2 className="font-bold text-lg mb-6 text-slate-800">Результаты</h2>
                            <table className="border-collapse w-full">
                                <thead>
                                    <tr>
                                        <th className="p-3 bg-slate-50 border-b border-slate-200 min-w-[150px]"></th>
                                        {matrixData.labels.map((label, idx) => (
                                            <th key={idx} className="p-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase tracking-wider min-w-[80px]">
                                                {label.substring(0, 10)}{label.length > 10 ? '...' : ''}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {matrixData.matrix.map((row, rIdx) => (
                                        <tr key={rIdx} className="hover:bg-slate-50 transition-colors">
                                            <td className="p-3 border-b border-r border-slate-100 bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap" title={matrixData.labels[rIdx]}>
                                                {matrixData.labels[rIdx]}
                                            </td>
                                            {row.map((val, cIdx) => (
                                                <td 
                                                    key={cIdx} 
                                                    className="p-3 border-b border-slate-100 text-center text-sm transition-all hover:ring-2 hover:ring-indigo-400 hover:z-10 relative cursor-default"
                                                    style={{
                                                        backgroundColor: rIdx === cIdx ? '#f8fafc' : getCellColor(val, maxDistance),
                                                        color: rIdx === cIdx ? '#cbd5e1' : '#1e293b'
                                                    }}
                                                >
                                                    {rIdx === cIdx ? '—' : val.toFixed(1)}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400 py-20">
                            <svg className="w-16 h-16 mb-4 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                            <p className="text-lg font-medium text-slate-500">Результатов пока нет</p>
                            <p className="text-sm">Выберите тексты и запустите расчёт матрицы расстояний.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}
