"use client";

import { useEffect, useState, useRef } from 'react';
import api from '@/lib/api';
import { useRouter } from 'next/navigation';
import { 
  getAvailableActions, 
  applyAction, 
  getActionLabel, 
  WordOp as UtilsWordOp 
} from '@/app/utils/wordOpLogic';

interface ClassItem {
  id: number;
  display_name: string;
  color_hex: string;
  is_global: boolean;
}

interface CharOp {
  id: number;
  op_type: 'insert' | 'delete' | 'change';
  from_str: string;
  to_str: string;
  class_id: number | null;
}

interface WordOp {
  id: number;
  op_type: 'equal' | 'insert' | 'delete' | 'replace';
  base_token: string | null;
  other_token: string | null;
  base_paragraph_index: number | null;
  char_ops: CharOp[];
}

interface Comparison {
  id: number;
  saved: boolean;
  dirty_for_preset: boolean;
  selected_font_id: number | null;
  base_text_title?: string;
  other_text_title?: string;
  word_ops: WordOp[];
}

interface GroupItem {
    char_op_id: number;
    old_word: string;
    new_word: string;
    class_id: number | null;
}

// Stats interfaces
interface ComparisonStats {
    totals: {
        replace: number;
        insert: number;
        delete: number;
    };
    top_word_replacements: {
        from_token: string;
        to_token: string;
        count: number;
    }[];
    top_char_ops: {
        op_type: string;
        from_str: string;
        to_str: string;
        count: number;
        unique_contexts: number;
        frequency: number;
    }[];
    class_distribution: {
        class_id: number | null;
        display_name: string;
        color_hex: string;
        count: number;
    }[];
}

export default function ComparisonResultPage({ params }: { params: { id: string } }) {
  const [comp, setComp] = useState<Comparison | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fontUrl, setFontUrl] = useState<string | null>(null);
  
  const [selectedOp, setSelectedOp] = useState<CharOp | null>(null);
  const [groupItems, setGroupItems] = useState<GroupItem[]>([]);
  const [applyToAll, setApplyToAll] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  
  // Stats state
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<ComparisonStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedWordIndices, setSelectedWordIndices] = useState<number[]>([]);

  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const pdfExportRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const router = useRouter();

  const loadData = () => {
      Promise.all([
          api.get(`/comparisons/${params.id}`),
          api.get('/classes/')
      ]).then(([compRes, classesRes]) => {
          setComp(compRes.data);
          setClasses(classesRes.data);
          
          // Load font if exists
          if (compRes.data.selected_font_id) {
              loadFont(compRes.data.selected_font_id);
          } else {
              setLoading(false);
          }
      }).catch(err => {
          console.error(err);
          alert('Failed to load data');
          setLoading(false);
      });
  };

  const loadFont = async (fontId: number) => {
      try {
          const res = await api.get(`/fonts/${fontId}/file`, { responseType: 'blob' });
          const url = URL.createObjectURL(res.data);
          setFontUrl(url);
      } catch (e) {
          console.error("Failed to load font", e);
      } finally {
          setLoading(false);
      }
  };

  const loadStats = async () => {
      setLoadingStats(true);
      try {
          const res = await api.get(`/comparisons/${params.id}/stats`);
          setStats(res.data);
      } catch (e) {
          console.error(e);
      } finally {
          setLoadingStats(false);
      }
  };

  useEffect(() => {
    loadData();
    // Cleanup object URL
    return () => {
        if (fontUrl) URL.revokeObjectURL(fontUrl);
    };
  }, [params.id]);

  useEffect(() => {
      if (showStats && !stats) {
          loadStats();
      }
  }, [showStats]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [exportMenuOpen]);

  const handleBadgeClick = async (op: CharOp) => {
      setSelectedOp(op);
      setShowStats(false); // Close stats if opening op detail
      setSelectedClassId(op.class_id ? op.class_id.toString() : '');
      setApplyToAll(false);
      
      try {
          const res = await api.get(`/comparisons/${params.id}/char-op-group`, {
              params: {
                  op_type: op.op_type,
                  from_str: op.from_str,
                  to_str: op.to_str
              }
          });
          setGroupItems(res.data.items);
      } catch (e) {
          console.error(e);
      }
  };

  const handleSaveClass = async () => {
      if (!selectedOp) return;
      const classIdVal = selectedClassId ? parseInt(selectedClassId) : null;
      try {
          if (applyToAll) {
              await api.patch(`/comparisons/${params.id}/char-op-group`, {
                  op_type: selectedOp.op_type,
                  from_str: selectedOp.from_str,
                  to_str: selectedOp.to_str,
                  class_id: classIdVal
              });
          } else {
              await api.patch(`/comparisons/char-ops/${selectedOp.id}`, {
                  class_id: classIdVal
              });
          }
          const compRes = await api.get(`/comparisons/${params.id}`);
          setComp(compRes.data);
          // If stats are open, reload them to reflect changes
          if (stats) loadStats();
          setSelectedOp(null);
      } catch (e) {
          console.error(e);
          alert('Failed to save class');
      }
  };

  const handleSaveComparison = async () => {
      try {
          // Send current word_ops if any changes made
          await api.post(`/comparisons/${params.id}/save`, {
              word_ops: comp?.word_ops
          });
          if (comp) setComp({ ...comp, saved: true });
          alert('Comparison saved to history!');
      } catch (e) {
          console.error(e);
          alert('Failed to save comparison');
      }
  };

  const handleSaveAsPreset = async () => {
      const name = prompt("Enter a name for the new preset:");
      if (!name) return;
      try {
          await api.post(`/comparisons/${params.id}/save-as-preset`, {
              name: name,
              description: `Created from comparison #${params.id}`
          });
          alert('Preset created successfully!');
          if (comp) setComp({ ...comp, dirty_for_preset: false });
      } catch (e) {
          console.error(e);
          alert('Failed to create preset');
      }
  };

  const handleExportJson = () => {
      if (!comp) return;
      const dataStr = JSON.stringify(comp.word_ops, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${comp.id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const handleExportPdf = async () => {
    if (!comp || !pdfExportRef.current) return;
    setPdfExporting(true);
    try {
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        await document.fonts.ready;
      }
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const el = pdfExportRef.current;
      const canvas = await html2canvas(el, {
        scale: Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 2 : 2),
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        ignoreElements: (node) =>
          node instanceof HTMLElement && node.classList.contains('pdf-exclude'),
        logging: false,
      });

      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const margin = 12;
      const pageW = pdf.internal.pageSize.getWidth() - 2 * margin;
      const pageH = pdf.internal.pageSize.getHeight() - 2 * margin;
      const imgW = pageW;
      const imgH = (canvas.height * imgW) / canvas.width;
      let offsetY = 0;
      while (offsetY < imgH - 0.02) {
        if (offsetY > 0) pdf.addPage();
        const sliceH = Math.min(pageH, imgH - offsetY);
        const srcY = (offsetY / imgH) * canvas.height;
        const srcH = (sliceH / imgH) * canvas.height;
        const tile = document.createElement('canvas');
        tile.width = canvas.width;
        tile.height = Math.max(1, Math.ceil(srcH));
        const ctx = tile.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
        pdf.addImage(tile.toDataURL('image/png'), 'PNG', margin, margin, imgW, sliceH);
        offsetY += sliceH;
      }
      pdf.save(`comparison-${comp.id}.pdf`);
    } catch (e) {
      console.error(e);
      alert('Не удалось создать PDF. Попробуйте ещё раз или используйте экспорт JSON.');
    } finally {
      setPdfExporting(false);
    }
  };

  const handleWordClick = (index: number, op: UtilsWordOp) => {
    if (!isEditMode) return;
    if (op.op_type === 'equal') return;

    if (selectedWordIndices.includes(index)) {
        setSelectedWordIndices(selectedWordIndices.filter(i => i !== index));
        return;
    }

    if (selectedWordIndices.length === 0) {
        setSelectedWordIndices([index]);
    } else if (selectedWordIndices.length === 1) {
        const firstIdx = selectedWordIndices[0];
        // Check adjacency (physically adjacent in array)
        if (Math.abs(index - firstIdx) === 1) {
            setSelectedWordIndices([...selectedWordIndices, index]);
        } else {
            setSelectedWordIndices([index]);
        }
    } else {
        setSelectedWordIndices([index]);
    }
  };

  const handleApplyEditAction = async (action: any) => {
    if (!comp) return;
    const newOps = applyAction(comp.word_ops as UtilsWordOp[], selectedWordIndices, action);
    
    // Calculate char ops for new replace operations
    const resolvedOps = await Promise.all(newOps.map(async (op) => {
        if (op.op_type === 'replace' && (!op.char_ops || op.char_ops.length === 0) && op.base_token && op.other_token) {
            try {
                const res = await api.post('/comparisons/calc-char-diff', {
                    base_token: op.base_token,
                    other_token: op.other_token
                });
                return { ...op, char_ops: res.data };
            } catch (e) {
                console.error("Failed to calc char diff", e);
                return op;
            }
        }
        return op;
    }));

    setComp({ ...comp, word_ops: resolvedOps as any });
    setSelectedWordIndices([]);
  };

  const getClassColor = (classId: number | null) => {
      if (!classId) return '#e0e7ff';
      const cls = classes.find(c => c.id === classId);
      return cls ? cls.color_hex : '#e0e7ff';
  };

  if (loading) return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="flex flex-col items-center gap-3 text-slate-500">
            <svg className="animate-spin h-8 w-8 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p>Loading comparison data...</p>
          </div>
      </div>
  );
  if (!comp) return null;

  return (
    <div className="min-h-screen bg-slate-50 flex relative overflow-hidden font-sans text-slate-900">
       {fontUrl && (
           <style jsx global>{`
               @font-face {
                   font-family: 'ComparisonFont';
                   src: url('${fontUrl}');
               }
               .comparison-content {
                   font-family: 'ComparisonFont', serif;
               }
               .char-op-badge {
                   font-family: 'ComparisonFont', monospace; 
               }
           `}</style>
       )}

       <div className={`flex-1 p-8 transition-all duration-300 ${(selectedOp || showStats || (isEditMode && selectedWordIndices.length > 0)) ? 'mr-96' : ''}`}>
          <div ref={pdfExportRef} className="max-w-6xl mx-auto bg-white p-8 rounded-xl shadow-sm min-h-[85vh] border border-slate-100 flex flex-col">
              <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-100">
                 <div className="flex items-center gap-4 flex-wrap">
                     <div>
                        <h1 className="text-2xl font-bold text-slate-900">Result #{comp.id}</h1>
                        {(comp.base_text_title || comp.other_text_title) && (
                            <p className="text-sm text-slate-500 mt-1">
                                {comp.base_text_title || 'Unknown'} <span className="mx-1 text-slate-300">vs</span> {comp.other_text_title || 'Unknown'}
                            </p>
                        )}
                     </div>
                     <div className="pdf-exclude flex items-center gap-2 flex-wrap">
                     {!comp.saved && (
                         <button type="button" onClick={handleSaveComparison} className="bg-emerald-600 text-white px-3 py-1.5 text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors shadow-sm flex items-center gap-2">
                             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                             Save to History
                         </button>
                     )}
                     {comp.saved && <span className="bg-emerald-50 text-emerald-700 px-3 py-1.5 text-sm font-medium rounded-lg border border-emerald-100 flex items-center gap-1">
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                         Saved
                     </span>}
                     <button type="button" onClick={handleSaveAsPreset} className="bg-amber-500 text-white px-3 py-1.5 text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors shadow-sm flex items-center gap-2">
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                         Save as Preset
                     </button>
                     <div className="relative" ref={exportMenuRef}>
                       <button
                         type="button"
                         disabled={pdfExporting}
                         onClick={() => setExportMenuOpen((o) => !o)}
                         className="bg-blue-600 text-white px-3 py-1.5 text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-2 disabled:opacity-60"
                       >
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                         Export
                         <svg className="w-3 h-3 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                       </button>
                       {exportMenuOpen && (
                         <div className="absolute left-0 top-full z-40 mt-1 min-w-[11rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                           <button
                             type="button"
                             className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                             onClick={() => {
                               handleExportJson();
                               setExportMenuOpen(false);
                             }}
                           >
                             JSON (word_ops)
                           </button>
                           <button
                             type="button"
                             disabled={pdfExporting}
                             className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                             onClick={async () => {
                               setExportMenuOpen(false);
                               await handleExportPdf();
                             }}
                           >
                             {pdfExporting ? 'PDF…' : 'PDF (как на экране)'}
                           </button>
                         </div>
                       )}
                     </div>
                     <button type="button" onClick={() => { setIsEditMode(!isEditMode); if(!isEditMode){ setSelectedOp(null); setShowStats(false); } else { setSelectedWordIndices([]); } }} className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors shadow-sm flex items-center gap-2 ${isEditMode ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                         {isEditMode ? 'Edit Mode On' : 'Edit Mode'}
                     </button>
                     <button type="button" onClick={() => { setShowStats(true); setSelectedOp(null); setIsEditMode(false); }} className="bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm flex items-center gap-2">
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                         Stats
                     </button>
                     </div>
                 </div>
                 <button type="button" className="pdf-exclude text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1 text-sm font-medium shrink-0" onClick={() => router.push('/dashboard')}>
                     Close
                     <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
              </div>

              {(() => {
                type ParagraphItem = { idx: number; op: WordOp };
                const paragraphs: ParagraphItem[][] = [];
                let current: ParagraphItem[] = [];
                let lastPara: number | null = null;

                for (let i = 0; i < comp.word_ops.length; i++) {
                  const op = comp.word_ops[i];
                  const para: number | null =
                    op.base_paragraph_index !== null ? op.base_paragraph_index : lastPara;
                  const isNewPara =
                    lastPara !== null && para !== null && para !== lastPara;

                  if (isNewPara && current.length > 0) {
                    paragraphs.push(current);
                    current = [];
                  }
                  current.push({ idx: i, op });
                  if (para !== null) lastPara = para;
                }
                if (current.length > 0) paragraphs.push(current);

                const renderToken = (op: WordOp, idx: number) => {
                  const isSelected = selectedWordIndices.includes(idx);
                  const isClickable = isEditMode && op.op_type !== 'equal';
                  const clickHandler = isClickable
                    ? (e: any) => {
                        e.stopPropagation();
                        handleWordClick(idx, op as unknown as UtilsWordOp);
                      }
                    : undefined;
                  const selectionClass = isSelected
                    ? 'ring-2 ring-indigo-500 ring-offset-2 rounded shadow-sm'
                    : '';
                  const hoverClass = isClickable
                    ? 'hover:brightness-95 active:scale-95 cursor-pointer select-none'
                    : '';

                  if (op.op_type === 'equal') {
                    return (
                      <span key={idx} className="mr-1.5">
                        {op.base_token}
                      </span>
                    );
                  }
                  if (op.op_type === 'delete') {
                    return (
                      <span
                        key={idx}
                        onClick={clickHandler}
                        className={`mr-1.5 text-rose-600 bg-rose-50 line-through decoration-rose-300 decoration-2 px-1 py-0.5 rounded ${selectionClass} ${hoverClass}`}
                      >
                        {op.base_token}
                      </span>
                    );
                  }
                  if (op.op_type === 'insert') {
                    return (
                      <span
                        key={idx}
                        onClick={clickHandler}
                        className={`mr-1.5 text-emerald-700 bg-emerald-50 font-medium px-1 py-0.5 rounded border border-emerald-100 ${selectionClass} ${hoverClass}`}
                      >
                        {op.other_token}
                      </span>
                    );
                  }
                  if (op.op_type === 'replace') {
                    return (
                      <span
                        key={idx}
                        onClick={clickHandler}
                        className={`mr-1.5 inline-flex flex-col items-center align-bottom relative group h-[3.5rem] justify-end ${selectionClass} ${hoverClass}`}
                      >
                        <span className="flex justify-center gap-[2px] mb-1 min-h-[18px]">
                          {op.char_ops.map((c) => (
                            <button
                              key={c.id}
                              onClick={(e) => {
                                if (!isEditMode) {
                                  e.stopPropagation();
                                  handleBadgeClick(c);
                                }
                              }}
                              style={{ backgroundColor: getClassColor(c.class_id) }}
                              className={`char-op-badge min-w-[18px] h-[18px] px-1.5 flex items-center justify-center rounded text-[10px] border border-black/10 transition-all text-slate-900 font-bold whitespace-nowrap ${!isEditMode ? 'hover:scale-110 hover:shadow-sm cursor-pointer' : 'cursor-default opacity-80'}`}
                            >
                              {c.op_type === 'change'
                                ? `${c.from_str} → ${c.to_str}`
                                : c.op_type === 'insert'
                                  ? `→ ${c.to_str}`
                                  : `${c.from_str} →`}
                            </button>
                          ))}
                        </span>
                        <span
                          className={`bg-amber-50 text-slate-900 border-b-2 border-amber-300 px-1.5 py-0.5 rounded-t cursor-default transition-colors hover:bg-amber-100 leading-normal ${isClickable ? 'pointer-events-none' : ''}`}
                        >
                          {op.base_token}
                          <span className="text-slate-400 mx-1.5 text-sm select-none comparison-content">
                            [{op.other_token}]
                          </span>
                        </span>
                      </span>
                    );
                  }
                  return null;
                };

                return (
                  <div
                    className={`comparison-content text-[1.05rem] text-slate-800 flex-1 ${!fontUrl ? 'font-serif' : ''}`}
                  >
                    {paragraphs.map((items, pIdx) => (
                      <div
                        key={pIdx}
                        className={`flex gap-4 items-start ${pIdx === 0 ? '' : 'mt-6'}`}
                      >
                        <div className="w-10 shrink-0 text-right text-xs text-slate-400 select-none tabular-nums pt-2">
                          {pIdx + 1}
                        </div>
                        <div className="flex-1 leading-[2.5rem]">
                          {items.map(({ idx, op }) => renderToken(op, idx))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
           </div>
       </div>

       <div className={`fixed top-0 right-0 h-full w-96 bg-white shadow-2xl border-l border-slate-100 transform transition-transform duration-300 ease-in-out z-30 flex flex-col ${(selectedOp || showStats || (isEditMode && selectedWordIndices.length > 0)) ? 'translate-x-0' : 'translate-x-full'}`}>
           {selectedOp && (
               <>
                   <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                       <h2 className="text-lg font-bold text-slate-900">Edit Classification</h2>
                       <button onClick={() => setSelectedOp(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                       </button>
                   </div>
                   <div className="flex-1 overflow-y-auto p-6 space-y-8">
                       <div>
                           <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Operation</label>
                           <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-center">
                               <div className="text-2xl font-mono text-slate-800 mb-1 comparison-content">
                                   {selectedOp.op_type === 'change' ? (<span className="flex items-center justify-center gap-3"><span className="bg-white px-2 py-1 rounded border shadow-sm">{selectedOp.from_str}</span><span className="text-slate-400">→</span><span className="bg-white px-2 py-1 rounded border shadow-sm">{selectedOp.to_str}</span></span>) : selectedOp.op_type === 'insert' ? <span className="text-emerald-600">→ "{selectedOp.to_str}"</span> : <span className="text-rose-600">"{selectedOp.from_str}" →</span>}
                               </div>
                               <div className="text-xs text-slate-500 mt-2 font-medium capitalize">{selectedOp.op_type}</div>
                           </div>
                       </div>
                       <div>
                           <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Assign Class</label>
                           <select className="block w-full rounded-lg border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 py-2.5 px-3 border bg-white" value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)}>
                               <option value="">Unclassified</option>
                               {classes.map(cls => <option key={cls.id} value={cls.id}>{cls.display_name}</option>)}
                           </select>
                       </div>
                       <div>
                           <div className="flex items-center justify-between mb-3">
                               <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Similar Occurrences</span>
                               <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full font-medium">{groupItems.length} found</span>
                           </div>
                           <div className="max-h-60 overflow-y-auto bg-slate-50 rounded-lg border border-slate-200 divide-y divide-slate-100 custom-scrollbar">
                               {groupItems.map(item => (
                                   <div key={item.char_op_id} className="p-3 text-sm flex justify-between items-center hover:bg-white transition-colors">
                                       <span className="comparison-content text-slate-700">{item.old_word} <span className="text-slate-400 mx-1">→</span> {item.new_word}</span>
                                       <span className="text-xs text-slate-400 font-mono">#{item.char_op_id}</span>
                                   </div>
                               ))}
                           </div>
                           <label className="flex items-center mt-4 cursor-pointer group select-none">
                               <input type="checkbox" className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} />
                               <span className="ml-2 text-sm text-slate-700 group-hover:text-indigo-600 transition-colors font-medium">Apply change to all {groupItems.length} items</span>
                           </label>
                       </div>
                   </div>
                   <div className="p-6 border-t border-slate-100 bg-slate-50/50">
                       <button onClick={handleSaveClass} className="w-full bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 font-semibold shadow-sm transition-all transform active:scale-[0.98]">Save Changes</button>
                   </div>
               </>
           )}

           {isEditMode && selectedWordIndices.length > 0 && !selectedOp && (
               <>
                   <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                       <h2 className="text-lg font-bold text-slate-900">Edit Operations</h2>
                       <button onClick={() => setSelectedWordIndices([])} className="text-slate-400 hover:text-slate-600 transition-colors">
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                       </button>
                   </div>
                   <div className="flex-1 overflow-y-auto p-6 space-y-6">
                       <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                           <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Selected Items ({selectedWordIndices.length})</h3>
                           <div className="flex flex-wrap gap-2">
                               {selectedWordIndices.sort((a,b) => a-b).map(idx => {
                                   const op = comp.word_ops[idx];
                                   return (
                                       <span key={idx} className="bg-white px-2 py-1 rounded border border-slate-200 text-sm shadow-sm truncate max-w-[150px]">
                                           <span className={`text-xs font-bold mr-1 uppercase ${op.op_type === 'insert' ? 'text-emerald-600' : op.op_type === 'delete' ? 'text-rose-600' : 'text-amber-600'}`}>{op.op_type}</span>
                                           <span className="font-mono font-bold text-slate-700">{op.base_token || op.other_token}</span>
                                       </span>
                                   );
                               })}
                           </div>
                       </div>
                       
                       <div>
                           <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Available Actions</label>
                           <div className="space-y-3">
                               {(() => {
                                   const selectedOps = selectedWordIndices.sort((a,b) => a-b).map(idx => comp.word_ops[idx] as unknown as UtilsWordOp);
                                   const actions = getAvailableActions(selectedOps);
                                   
                                   if (actions.length === 0) {
                                       return <div className="text-sm text-slate-400 italic text-center py-4 bg-slate-50 rounded border border-dashed border-slate-200">No actions available for this selection.</div>
                                   }
                                   
                                   return actions.map(action => (
                                       <button 
                                           key={action}
                                           onClick={() => handleApplyEditAction(action)}
                                           className="w-full bg-white border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50 text-slate-700 py-3 px-4 rounded-lg text-left shadow-sm transition-all flex items-center justify-between group"
                                       >
                                           <span className="font-medium group-hover:text-indigo-700 text-sm">{getActionLabel(action)}</span>
                                           <svg className="w-4 h-4 text-slate-400 group-hover:text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                                       </button>
                                   ));
                               })()}
                           </div>
                       </div>
                   </div>
               </>
           )}

           {showStats && !selectedOp && !isEditMode && (
               <>
                   <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                       <h2 className="text-lg font-bold text-slate-900">Statistics</h2>
                       <button onClick={() => setShowStats(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                       </button>
                   </div>
                   <div className="flex-1 overflow-y-auto p-6 space-y-8">
                       {loadingStats || !stats ? (
                           <div className="text-center py-10 text-slate-400">Loading statistics...</div>
                       ) : (
                           <>
                               <div>
                                   <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">General Totals</label>
                                   <div className="grid grid-cols-3 gap-3">
                                       <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-center">
                                           <div className="text-xl font-bold text-slate-800">{stats.totals.replace}</div>
                                           <div className="text-[10px] text-slate-500 uppercase">Replacements</div>
                                       </div>
                                       <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-center">
                                            <div className="text-xl font-bold text-emerald-600">{stats.totals.insert}</div>
                                           <div className="text-[10px] text-slate-500 uppercase">Inserts</div>
                                       </div>
                                       <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-center">
                                           <div className="text-xl font-bold text-rose-600">{stats.totals.delete}</div>
                                           <div className="text-[10px] text-slate-500 uppercase">Deletes</div>
                                       </div>
                                   </div>
                               </div>

                               <div>
                                   <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Top Character Operations</label>
                                   <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                       <table className="w-full text-sm">
                                           <thead className="bg-slate-50 text-xs font-medium text-slate-500 uppercase">
                                               <tr>
                                                   <th className="px-3 py-2 text-left">Op</th>
                                                   <th className="px-3 py-2 text-right">Count</th>
                                                   <th className="px-3 py-2 text-right">Contexts</th>
                                                   <th className="px-3 py-2 text-right">Freq</th>
                                               </tr>
                                           </thead>
                                           <tbody className="divide-y divide-slate-100">
                                               {stats.top_char_ops.map((op, i) => (
                                                   <tr key={i} className="hover:bg-slate-50">
                                                       <td className="px-3 py-2 font-mono text-slate-700">
                                                            {op.op_type === 'change' ? `${op.from_str}→${op.to_str}` : op.op_type === 'insert' ? `→${op.to_str}` : `${op.from_str}→`}
                                                       </td>
                                                       <td className="px-3 py-2 text-right font-medium">{op.count}</td>
                                                       <td className="px-3 py-2 text-right text-slate-500">{op.unique_contexts}</td>
                                                       <td className="px-3 py-2 text-right text-slate-500">{(op.frequency * 100).toFixed(1)}%</td>
                                                   </tr>
                                               ))}
                                           </tbody>
                                       </table>
                                   </div>
                               </div>

                               <div>
                                   <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Class Distribution</label>
                                   <div className="space-y-2">
                                       {stats.class_distribution.map((d, i) => (
                                           <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
                                               <div className="flex items-center gap-2">
                                                   <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color_hex }}></div>
                                                   <span className="text-sm font-medium text-slate-700">{d.display_name}</span>
                                               </div>
                                               <span className="text-sm font-bold text-slate-600">{d.count}</span>
                                           </div>
                                       ))}
                                   </div>
                               </div>
                           </>
                       )}
                   </div>
               </>
           )}
       </div>
    </div>
  );
}
