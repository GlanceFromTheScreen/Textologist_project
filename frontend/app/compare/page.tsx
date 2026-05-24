"use client";

import { useEffect, useState } from 'react';
import api, { API_URL } from '@/lib/api';
import { useRouter } from 'next/navigation';

interface Text {
  id: number;
  title: string;
}

interface Preset {
  id: number;
  name: string;
}

interface Font {
  id: number;
  name: string;
}

export default function CompareSetupPage() {
  const [texts, setTexts] = useState<Text[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [fonts, setFonts] = useState<Font[]>([]);
  
  const [baseId, setBaseId] = useState<string>('');
  const [otherId, setOtherId] = useState<string>('');
  const [presetId, setPresetId] = useState<string>('');
  const [fontId, setFontId] = useState<string>('');
  const [algorithm, setAlgorithm] = useState<string>('levenshtein');
  
  // Weights state
  const [wReplace, setWReplace] = useState(1.0);
  const [wDelete, setWDelete] = useState(1.0);
  const [wInsert, setWInsert] = useState(1.0);
  const [wCharReplace, setWCharReplace] = useState(1.0);
  const [wCharDelete, setWCharDelete] = useState(1.0);
  const [wCharInsert, setWCharInsert] = useState(1.0);
  
  const [loading, setLoading] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(1);
  const router = useRouter();

  useEffect(() => {
    // Load texts, presets, and fonts
    Promise.all([
        api.get('/texts/'),
        api.get('/presets/'),
        api.get('/fonts/')
    ]).then(([textRes, presetRes, fontRes]) => {
        setTexts(textRes.data);
        setPresets(presetRes.data);
        setFonts(fontRes.data);
    }).catch(err => console.error(err));
  }, []);

  const applyProgressEvent = (phase: string, algo: string, current: number, total: number) => {
    setProgressCurrent(current);
    setProgressTotal(Math.max(1, total));
    if (phase === 'tokenize') {
      setProgressLabel('Токенизация текстов');
    } else if (phase === 'alignment') {
      setProgressLabel(`Выполняется алгоритм: ${algo}`);
    } else if (phase === 'persist') {
      setProgressLabel(`Сохранение результатов (${algo})`);
    } else {
      setProgressLabel(algo || 'Обработка');
    }
  };

  type StreamMsg = {
    type: string;
    phase?: string;
    algorithm?: string;
    current?: number;
    total?: number;
    id?: number;
    detail?: string;
  };

  const consumeStreamBlock = (
    block: string,
    onProgress: typeof applyProgressEvent,
  ): { compId?: number; error?: Error } => {
    const line = block.trim();
    if (!line.startsWith('data:')) return {};
    const jsonStr = line.replace(/^data:\s*/, '');
    let msg: StreamMsg;
    try {
      msg = JSON.parse(jsonStr);
    } catch {
      return {};
    }
    if (msg.type === 'progress' && msg.phase != null && msg.current != null && msg.total != null) {
      onProgress(msg.phase, msg.algorithm || '', msg.current, msg.total);
      return {};
    }
    if (msg.type === 'done' && msg.id != null) return { compId: msg.id };
    if (msg.type === 'error') {
      return { error: new Error(typeof msg.detail === 'string' ? msg.detail : 'Comparison failed') };
    }
    return {};
  };

  const handleCompare = async () => {
    if (!baseId || !otherId) return;
    if (baseId === otherId) {
        alert("Please select different texts");
        return;
    }

    setLoading(true);
    setProgressLabel('Подключение…');
    setProgressCurrent(0);
    setProgressTotal(1);
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const body = JSON.stringify({
      base_text_id: parseInt(baseId),
      other_text_id: parseInt(otherId),
      preset_id: presetId ? parseInt(presetId) : null,
      font_id: fontId ? parseInt(fontId) : null,
      algorithm: algorithm,
      weights: {
        replace: wReplace,
        delete: wDelete,
        insert: wInsert,
        char_replace: wCharReplace,
        char_delete: wCharDelete,
        char_insert: wCharInsert,
      },
    });

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetch(`${API_URL}/comparisons/run-stream`, {
        method: 'POST',
        headers,
        body,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let compId: number | null = null;

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          const r = consumeStreamBlock(block, applyProgressEvent);
          if (r.error) throw r.error;
          if (r.compId != null) compId = r.compId;
        }
        if (done) break;
      }

      if (buffer.trim()) {
        for (const block of buffer.split('\n\n')) {
          const r = consumeStreamBlock(block, applyProgressEvent);
          if (r.error) throw r.error;
          if (r.compId != null) compId = r.compId;
        }
      }

      if (compId == null) throw new Error('Сервер не вернул id сравнения');
      router.push(`/compare/${compId}`);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Comparison failed');
      setLoading(false);
      setProgressLabel('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-900">
      <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-100 max-w-lg w-full">
        <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-slate-900">New Comparison</h1>
            <p className="text-slate-500 mt-1">Select two texts to analyze differences</p>
        </div>
        
        <div className="space-y-6">
            <div className="space-y-4">
                <div className="relative">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Base Text (Original)</label>
                    <select 
                        className="block w-full rounded-lg border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 py-2.5 px-3 bg-slate-50 text-slate-800 text-sm appearance-none"
                        value={baseId}
                        onChange={e => setBaseId(e.target.value)}
                    >
                        <option value="">Select text...</option>
                        {texts.map(t => (
                            <option key={t.id} value={t.id}>{t.title}</option>
                        ))}
                    </select>
                </div>

                <div className="flex justify-center items-center">
                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
                    </div>
                </div>

                <div className="relative">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Comparison Text (New)</label>
                    <select 
                        className="block w-full rounded-lg border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 py-2.5 px-3 bg-slate-50 text-slate-800 text-sm appearance-none"
                        value={otherId}
                        onChange={e => setOtherId(e.target.value)}
                    >
                        <option value="">Select text...</option>
                        {texts.map(t => (
                            <option key={t.id} value={t.id}>{t.title}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="border-t border-slate-100 pt-6 space-y-4">
                 <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Algorithm</label>
                    <div className="flex flex-wrap gap-4 mb-4">
                         <label className="flex items-center gap-2 cursor-pointer">
                             <input 
                                 type="radio" 
                                 name="algorithm" 
                                 value="levenshtein" 
                                 checked={algorithm === 'levenshtein'}
                                 onChange={e => setAlgorithm(e.target.value)}
                                 className="text-indigo-600 focus:ring-indigo-500"
                             />
                             <span className="text-sm text-slate-700">Levenshtein</span>
                         </label>
                         <label className="flex items-center gap-2 cursor-pointer">
                             <input 
                                 type="radio" 
                                 name="algorithm" 
                                 value="levenshtein_nested" 
                                 checked={algorithm === 'levenshtein_nested'}
                                 onChange={e => setAlgorithm(e.target.value)}
                                 className="text-indigo-600 focus:ring-indigo-500"
                             />
                             <span className="text-sm text-slate-700">Levenshtein Nested</span>
                         </label>
                         <label className="flex items-center gap-2 cursor-pointer">
                             <input 
                                 type="radio" 
                                 name="algorithm" 
                                 value="levenshtein_v2" 
                                 checked={algorithm === 'levenshtein_v2'}
                                 onChange={e => setAlgorithm(e.target.value)}
                                 className="text-indigo-600 focus:ring-indigo-500"
                             />
                             <span className="text-sm text-slate-700">Levenshtein 2.0</span>
                         </label>
                         <label className="flex items-center gap-2 cursor-pointer">
                             <input 
                                 type="radio" 
                                 name="algorithm" 
                                 value="myers" 
                                 checked={algorithm === 'myers'}
                                 onChange={e => setAlgorithm(e.target.value)}
                                 className="text-indigo-600 focus:ring-indigo-500"
                             />
                             <span className="text-sm text-slate-700">Myers (Fast)</span>
                         </label>
                    </div>
                    
                    {(algorithm === 'levenshtein' || algorithm === 'levenshtein_nested') && (
                        <div className="grid grid-cols-3 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-100">
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Replace</label>
                                <input 
                                    type="number" step="0.1" min="0"
                                    className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-1.5"
                                    value={wReplace}
                                    onChange={e => setWReplace(parseFloat(e.target.value))}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Delete</label>
                                <input 
                                    type="number" step="0.1" min="0"
                                    className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-1.5"
                                    value={wDelete}
                                    onChange={e => setWDelete(parseFloat(e.target.value))}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Insert</label>
                                <input 
                                    type="number" step="0.1" min="0"
                                    className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-1.5"
                                    value={wInsert}
                                    onChange={e => setWInsert(parseFloat(e.target.value))}
                                />
                            </div>
                        </div>
                    )}
                    {algorithm === 'levenshtein_v2' && (
                        <div className="space-y-3 bg-slate-50 p-3 rounded-lg border border-slate-100">
                            <p className="text-xs text-slate-500">
                                Word costs scale token length (delete/insert) or the inner char edit distance (replace). Character weights apply only inside word replace.
                            </p>
                            <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Word-level</p>
                                <div className="grid grid-cols-3 gap-2">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 mb-1">Replace</label>
                                        <input 
                                            type="number" step="0.1" min="0"
                                            className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-1.5 bg-white"
                                            value={wReplace}
                                            onChange={e => setWReplace(parseFloat(e.target.value))}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 mb-1">Delete</label>
                                        <input 
                                            type="number" step="0.1" min="0"
                                            className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-1.5 bg-white"
                                            value={wDelete}
                                            onChange={e => setWDelete(parseFloat(e.target.value))}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 mb-1">Insert</label>
                                        <input 
                                            type="number" step="0.1" min="0"
                                            className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-1.5 bg-white"
                                            value={wInsert}
                                            onChange={e => setWInsert(parseFloat(e.target.value))}
                                        />
                                    </div>
                                </div>
                            </div>
                            <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Character-level (inside replace)</p>
                                <div className="grid grid-cols-3 gap-2">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 mb-1">Char replace</label>
                                        <input 
                                            type="number" step="0.1" min="0"
                                            className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-1.5 bg-white"
                                            value={wCharReplace}
                                            onChange={e => setWCharReplace(parseFloat(e.target.value))}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 mb-1">Char delete</label>
                                        <input 
                                            type="number" step="0.1" min="0"
                                            className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-1.5 bg-white"
                                            value={wCharDelete}
                                            onChange={e => setWCharDelete(parseFloat(e.target.value))}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 mb-1">Char insert</label>
                                        <input 
                                            type="number" step="0.1" min="0"
                                            className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-1.5 bg-white"
                                            value={wCharInsert}
                                            onChange={e => setWCharInsert(parseFloat(e.target.value))}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Preset (Optional)</label>
                    <select 
                        className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 py-2 px-3 bg-slate-50 text-sm"
                        value={presetId}
                        onChange={e => setPresetId(e.target.value)}
                    >
                        <option value="">None (Use default classifier)</option>
                        {presets.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                    <p className="text-xs text-slate-400 mt-1">Apply saved rules for character classification.</p>
                </div>
                
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Display Font (Optional)</label>
                    <select 
                        className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 py-2 px-3 bg-slate-50 text-sm"
                        value={fontId}
                        onChange={e => setFontId(e.target.value)}
                    >
                        <option value="">Default System Font</option>
                        {fonts.map(f => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                    </select>
                     <p className="text-xs text-slate-400 mt-1">Select a custom font for rendering the texts.</p>
                </div>
            </div>

            <div className="pt-2 space-y-3">
                {loading && progressLabel && (
                    <div className="rounded-lg border border-indigo-100 bg-indigo-50/80 px-4 py-3">
                        <p className="text-sm font-medium text-slate-800 mb-2">{progressLabel}</p>
                        <div className="h-2 w-full rounded-full bg-indigo-100 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-indigo-600 transition-[width] duration-150 ease-out"
                                style={{
                                    width: `${Math.min(100, Math.round((100 * progressCurrent) / progressTotal))}%`,
                                }}
                            />
                        </div>
                        <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
                            {progressCurrent} / {progressTotal}
                        </p>
                    </div>
                )}
                <button
                    onClick={handleCompare}
                    disabled={!baseId || !otherId || loading}
                    className="w-full bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-semibold shadow-sm transition-all active:scale-[0.98] flex justify-center items-center"
                >
                    {loading ? (
                        <>
                            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Выполняется сравнение…
                        </>
                    ) : 'Run Comparison'}
                </button>
            </div>
             <div className="text-center">
                <button onClick={() => router.push('/dashboard')} className="text-sm text-slate-500 hover:text-slate-800 transition-colors">Cancel</button>
            </div>
        </div>
      </div>
    </div>
  );
}
