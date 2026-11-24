"use client";

import { operationLabel } from '@/lib/labels';
import { separatorLabel } from '@/components/SeparatorPicker';
import { useEffect, useState, useRef, CSSProperties } from 'react';
import SidebarResizeHandle from '@/components/SidebarResizeHandle';
import ComparisonStatistics, { ComparisonStats, StatsFilter } from '@/components/ComparisonStatistics';
import api from '@/lib/api';
import WordClassSidebar, { WordClass, resolveWordClass, wordChangeLabel, isInsignificant } from '@/components/WordClassSidebar';
import WordClassAnnotations from '@/components/WordClassAnnotations';
import InsignificantReplacement from '@/components/InsignificantChange';
import RowClassAction from '@/components/RowClassAction';
import TranspositionToken from '@/components/TranspositionToken';
import { apiErrorMessage } from '@/lib/errors';
import { useRouter } from 'next/navigation';
import { 
  getAvailableActions, 
  applyAction, 
  getActionLabel, 
  WordOp as UtilsWordOp 
} from '@/app/utils/wordOpLogic';

interface ClassItem extends WordClass {
  id: number;
  display_name: string;
  color_hex: string;
  is_global: boolean;
}

interface FontItem {
  id: number;
  name: string;
}

interface CharOp {
  id: number;
  op_type: 'insert' | 'delete' | 'change';
  from_str: string;
  to_str: string;
  class_id: number | null;
}

interface WordOp {
  transpose_parts?: UtilsWordOp[] | null;
  id: number;
  op_type: 'equal' | 'insert' | 'delete' | 'replace' | 'transpose';
  base_token: string | null;
  other_token: string | null;
  base_paragraph_index: number | null;
  char_ops: CharOp[];
  class_id?: number | null;
  word_class?: { code: string; display_name: string; color_hex: string; system_key?: 'insignificant' | null } | null;
}

interface Comparison {
  separators?: string[];
  id: number;
  title?: string | null;
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

export default function ComparisonResultPage({ params }: { params: { id: string } }) {
  const [comp, setComp] = useState<Comparison | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fonts, setFonts] = useState<FontItem[]>([]);
  const [fontFamily, setFontFamily] = useState<string | null>(null);
  const [fontLoading, setFontLoading] = useState(false);
  const [fontSaving, setFontSaving] = useState(false);
  const [fontError, setFontError] = useState('');
  
  const [selectedWordIndex, setSelectedWordIndex] = useState<number | null>(null);
  const [editPast, setEditPast] = useState<WordOp[][]>([]);
  const [editFuture, setEditFuture] = useState<WordOp[][]>([]);
  const [editingBusy, setEditingBusy] = useState(false);
  const [operationsDirty, setOperationsDirty] = useState(false);
  const [showPresetForm, setShowPresetForm] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetError, setPresetError] = useState('');
  const [presetSuccess, setPresetSuccess] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const [selectedOp, setSelectedOp] = useState<CharOp | null>(null);
  const [groupItems, setGroupItems] = useState<GroupItem[]>([]);
  const [applyToAll, setApplyToAll] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  
  // Stats state
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<ComparisonStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsFilter, setStatsFilter] = useState<StatsFilter>('all');
  const [statsPage, setStatsPage] = useState(1);
  const [statsError, setStatsError] = useState('');
  
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedWordIndices, setSelectedWordIndices] = useState<number[]>([]);

  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const pdfExportRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const [sidebarWidth, setSidebarWidth] = useState(384);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const sidebarOpen = selectedWordIndex !== null || !!selectedOp || showStats || (isEditMode && selectedWordIndices.length > 0);

  const router = useRouter();

  const loadData = () => {
      Promise.all([
          api.get(`/comparisons/${params.id}`),
          api.get('/classes/'),
          api.get('/fonts/', { params: { limit: 1000 } })
      ]).then(([compRes, classesRes, fontsRes]) => {
          setComp(compRes.data);
          setEditPast([]); setEditFuture([]); setOperationsDirty(false);
          setSelectedWordIndex(null); setSelectedOp(null); setSelectedWordIndices([]);
          setClasses(classesRes.data);
          setFonts(fontsRes.data);
          setLoading(false);
      }).catch(err => {
          console.error(err);
          alert('Не удалось загрузить данные');
          setLoading(false);
      });
  };

  const handleFontChange = async (value: string) => {
    if (!comp || fontSaving) return;
    setFontSaving(true);
    setFontError('');
    try {
      const response = await api.patch(`/comparisons/${params.id}/font`, {
        selected_font_id: value ? Number(value) : null,
      });
      // Keep unsaved word edits and all other local comparison state intact.
      setComp(current => current ? { ...current, selected_font_id: response.data.selected_font_id } : current);
    } catch (error) {
      setFontError(apiErrorMessage(error, 'Не удалось сохранить выбранный шрифт. Попробуйте ещё раз.'));
    } finally {
      setFontSaving(false);
    }
  };

  useEffect(() => {
    setStatsFilter('all');
    setStatsPage(1);
    setStats(null);
    loadData();
  }, [params.id]);

  useEffect(() => {
    const fontId = comp?.selected_font_id;
    setFontFamily(null);
    setFontError('');
    if (!fontId) {
      setFontLoading(false);
      return;
    }
    let cancelled = false;
    let objectUrl: string | undefined;
    let face: FontFace | undefined;
    const controller = new AbortController();
    setFontLoading(true);
    const load = async () => {
      try {
        const response = await api.get(`/fonts/${fontId}/file`, {
          responseType: 'blob', signal: controller.signal,
        });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(response.data);
        face = new FontFace(`ComparisonFont-${comp?.id}-${fontId}`, `url("${objectUrl}")`);
        await face.load();
        if (cancelled) return;
        document.fonts.add(face);
        setFontFamily(face.family);
      } catch (error) {
        if (!cancelled) setFontError(apiErrorMessage(error, 'Не удалось загрузить шрифт. Используется системный шрифт.'));
      } finally {
        if (!cancelled) setFontLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
      controller.abort();
      if (face) document.fonts.delete(face);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [comp?.id, comp?.selected_font_id]);

  useEffect(() => {
    if (!showStats) return;
    let cancelled = false;
    const controller = new AbortController();
    setStatsError('');
    setLoadingStats(true);
    api.get(`/comparisons/${params.id}/stats`, {
      params: { significance: statsFilter, page: statsPage }, signal: controller.signal,
    }).then(response => {
      if (!cancelled) setStats(response.data);
    }).catch(error => {
      if (!cancelled) setStatsError(apiErrorMessage(error, 'Не удалось загрузить статистику.'));
    }).finally(() => {
      if (!cancelled) setLoadingStats(false);
    });
    return () => { cancelled = true; controller.abort(); };
  }, [showStats, statsFilter, statsPage, params.id, comp?.word_ops]);

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

  const handleBadgeClick = (op: CharOp) => {
      setSelectedWordIndex(null);
      setSelectedOp(op);
      setShowStats(false);
      setSelectedClassId(op.class_id ? op.class_id.toString() : '');
      setApplyToAll(false);
      setGroupItems((comp?.word_ops || []).flatMap(word => word.char_ops
        .filter(c => c.op_type === op.op_type && c.from_str === op.from_str && c.to_str === op.to_str)
        .map(c => ({ char_op_id: c.id, old_word: word.base_token || '', new_word: word.other_token || '', class_id: c.class_id }))));
  };

  const handleAssignWordClassAt = async (index: number, classId: number | null, createdClass?: WordClass) => {
      if (!comp) return;
      const word = comp.word_ops[index];
      const cls = createdClass || classes.find(c => c.id === classId && c.kind === 'word');
      let updated = { ...word, class_id: classId, word_class: cls ? { code: cls.code, display_name: cls.display_name, color_hex: cls.color_hex, system_key: cls.system_key ?? null } : null };
      if (!operationsDirty) {
        const response = await api.patch(`/comparisons/word-ops/${word.id}`, { class_id: classId });
        updated = response.data;
      }
      setComp(current => current ? { ...current, word_ops: current.word_ops.map((op, i) => i === index ? updated : op) } : current);
  };

  const handleMakeRowInsignificant = async (indices: number[]) => {
      if (!comp) return;
      const cls = classes.find(item => item.system_key === 'insignificant' && item.kind === 'word');
      if (!cls) throw new Error('Предустановленный класс недоступен. Обновите страницу.');
      const targets = indices.filter(index => comp.word_ops[index].op_type !== 'equal' && !isInsignificant(comp.word_ops[index], classes));
      if (!targets.length) return;
      const targetSet = new Set(targets);
      if (operationsDirty) {
          setComp(current => current ? { ...current, word_ops: current.word_ops.map((word, index) => targetSet.has(index) ? {
              ...word, class_id: cls.id, word_class: { code: cls.code, display_name: cls.display_name, color_hex: cls.color_hex, system_key: cls.system_key },
          } : word) } : current);
      } else {
          const response = await api.patch(`/comparisons/${params.id}/word-classes`, {
              word_op_ids: targets.map(index => comp.word_ops[index].id), class_id: cls.id,
          });
          const updated = new Map<number, WordOp>(response.data.map((word: WordOp) => [word.id, word]));
          setComp(current => current ? { ...current, word_ops: current.word_ops.map(word => updated.get(word.id) || word) } : current);
      }
      setSelectedOp(null);
      setSelectedWordIndex(null);
      setSelectedWordIndices([]);
      setIsEditMode(false);
  };

  const handleSaveClass = async () => {
      if (!selectedOp) return;
      const classIdVal = selectedClassId ? parseInt(selectedClassId) : null;
      try {
          if (operationsDirty) {
              setComp(current => current ? { ...current, dirty_for_preset: true, word_ops: current.word_ops.map(word => ({ ...word,
                char_ops: word.char_ops.map(c => (c === selectedOp || (applyToAll && c.op_type === selectedOp.op_type && c.from_str === selectedOp.from_str && c.to_str === selectedOp.to_str)) ? { ...c, class_id: classIdVal } : c)
              })) } : current);
              setSelectedOp(null);
              return;
          }
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
          setSelectedOp(null);
      } catch (e) {
          console.error(e);
          alert('Не удалось сохранить класс');
      }
  };

  const handleSaveComparison = async () => {
      try {
          // Send current word_ops if any changes made
          await api.post(`/comparisons/${params.id}/save`, {
              word_ops: comp?.word_ops
          });
          const response = await api.get(`/comparisons/${params.id}`);
          setComp(response.data);
          setOperationsDirty(false);
          setSelectedOp(null);
          setSelectedWordIndex(null);
          setSelectedWordIndices([]);
          alert('Сравнение сохранено в истории!');
      } catch (e) {
          console.error(e);
          alert('Не удалось сохранить сравнение');
      }
  };

  const handleSaveAsPreset = async () => {
      const name = presetName;
      if (!name?.trim() || !comp || editingBusy) return;
      setEditingBusy(true);
      setPresetError(''); setPresetSuccess('');
      try {
          if (operationsDirty) {
              await api.post(`/comparisons/${params.id}/save`, { word_ops: comp.word_ops });
              const saved = await api.get(`/comparisons/${params.id}`);
              setComp(saved.data);
              setOperationsDirty(false);
              setSelectedOp(null);
              setSelectedWordIndex(null);
              setSelectedWordIndices([]);
          }
          await api.post(`/comparisons/${params.id}/save-as-preset`, {
              name: name.trim(),
              description: `Создано из сравнения №${params.id}`
          });
          setPresetSuccess(name.trim());
          setShowPresetForm(false); setPresetName('');
          setComp(current => current ? { ...current, dirty_for_preset: false } : current);
      } catch (e) {
          console.error(e);
          setPresetError(apiErrorMessage(e, 'Не удалось сохранить пресет.'));
      } finally { setEditingBusy(false); }
  };

  const handleExportJson = () => {
      if (!comp) return;
      const exportWord = (word: WordOp): object => {
          const cls = resolveWordClass(word, classes);
          return { ...word, class_id: word.class_id ?? null,
              word_class: cls ? { code: cls.code, display_name: cls.display_name, color_hex: cls.color_hex, system_key: cls.system_key ?? null } : null,
              transpose_parts: word.transpose_parts?.map(part => exportWord(part)) ?? null };
      };
      const wordOps = comp.word_ops.map(exportWord);
      const separators = comp.separators || [' '];
      const payload = separators.length === 1 && separators[0] === ' ' ? wordOps : {
          format: 'textologist-comparison-v2', separators, word_ops: wordOps,
      };
      const dataStr = JSON.stringify(payload, null, 2);
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
    if (!isEditMode) {
        if (op.op_type === 'equal') return;
        setSelectedWordIndex(index);
        setSelectedOp(null);
        setShowStats(false);
        return;
    }
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
    if (!comp || editingBusy) return;
    setEditingBusy(true);
    try {
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
                throw e;
            }
        }
        return op;
    }));

    setEditPast(history => [...history, comp.word_ops]);
    setEditFuture([]);
    setComp({ ...comp, word_ops: resolvedOps as any });
    setOperationsDirty(true);
    setStats(null);
    setSelectedWordIndices([]);
    } catch (error) {
      alert(apiErrorMessage(error, 'Не удалось изменить операции. Исходная разметка сохранена.'));
    } finally { setEditingBusy(false); }
  };

  const restoreEdit = (redo: boolean) => {
    if (!comp || editingBusy) return;
    const history = redo ? editFuture : editPast;
    if (!history.length) return;
    const words = history[history.length - 1];
    if (redo) { setEditPast([...editPast, comp.word_ops]); setEditFuture(history.slice(0, -1)); }
    else { setEditFuture([...editFuture, comp.word_ops]); setEditPast(history.slice(0, -1)); }
    setComp({ ...comp, word_ops: words }); setOperationsDirty(true); setStats(null);
    setSelectedOp(null); setSelectedWordIndex(null); setSelectedWordIndices([]);
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
            <p>Загрузка сравнения…</p>
          </div>
      </div>
  );
  if (!comp) return null;

  return (
    <div className="comparison-layout min-h-screen bg-slate-50 flex relative overflow-hidden font-sans text-slate-900"
      data-resizing={resizingSidebar} style={{ '--comparison-sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
       {fontFamily && (
           <style jsx global>{`
               .comparison-content {
                   font-family: '${fontFamily}', serif;
               }
               .char-op-badge {
                   font-family: '${fontFamily}', monospace;
               }
           `}</style>
       )}

       <div data-sidebar-open={sidebarOpen} className="comparison-workspace min-w-0 flex-1 p-4 sm:p-8 transition-[margin] duration-300">
          <div ref={pdfExportRef} className="w-full min-w-0 max-w-6xl mx-auto bg-white p-4 sm:p-8 rounded-xl shadow-sm min-h-[85vh] border border-slate-100 flex flex-col">
              <div className="flex flex-wrap gap-4 justify-between items-center mb-8 pb-4 border-b border-slate-100">
                 <div className="min-w-0 flex items-center gap-4 flex-wrap">
                     <div className="min-w-0 [overflow-wrap:anywhere]">
                        <h1 className="text-2xl font-bold text-slate-900 break-words">{comp.title || `Сравнение №${comp.id}`}</h1>
                        {(comp.base_text_title || comp.other_text_title) && (
                            <p className="text-sm text-slate-500 mt-1">
                                {comp.base_text_title || 'Неизвестный текст'} <span className="mx-1 text-slate-300">и</span> {comp.other_text_title || 'Неизвестный текст'}
                            </p>
                        )}
                     </div>
                     <div className="pdf-exclude flex items-center gap-2 flex-wrap">
                     {(!comp.saved || operationsDirty) && (
                         <button type="button" onClick={handleSaveComparison} className="bg-emerald-600 text-white px-3 py-1.5 text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors shadow-sm flex items-center gap-2">
                             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                             Сохранить в историю
                         </button>
                     )}
                     {comp.saved && !operationsDirty && <span className="bg-emerald-50 text-emerald-700 px-3 py-1.5 text-sm font-medium rounded-lg border border-emerald-100 flex items-center gap-1">
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                         Сохранено
                     </span>}
                     <button type="button" disabled={editingBusy} onClick={() => { setShowPresetForm(true); setPresetError(''); setPresetSuccess(''); }} className="bg-amber-500 text-white px-3 py-1.5 text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors shadow-sm flex items-center gap-2">
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                         Сохранить как пресет
                     </button>
                     <div className="relative" ref={exportMenuRef}>
                       <button
                         type="button"
                         disabled={pdfExporting}
                         onClick={() => setExportMenuOpen((o) => !o)}
                         className="bg-blue-600 text-white px-3 py-1.5 text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-2 disabled:opacity-60"
                       >
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                         Экспорт
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
                             JSON (данные сравнения)
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
                     <button type="button" onClick={() => { setIsEditMode(!isEditMode); setSelectedWordIndex(null); if(!isEditMode){ setSelectedOp(null); setShowStats(false); } else { setSelectedWordIndices([]); } }} className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors shadow-sm flex items-center gap-2 ${isEditMode ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                         {isEditMode ? 'Редактирование включено' : 'Редактировать'}
                     </button>
                     {(editPast.length > 0 || editFuture.length > 0) && <>
                       <button type="button" disabled={!editPast.length || editingBusy} onClick={() => restoreEdit(false)} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40">Отменить правку</button>
                       <button type="button" disabled={!editFuture.length || editingBusy} onClick={() => restoreEdit(true)} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40">Повторить правку</button>
                     </>}
                     <button type="button" onClick={() => { setShowStats(true); setSelectedWordIndex(null); setSelectedOp(null); setIsEditMode(false); }} className="bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm flex items-center gap-2">
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                         Статистика
                     </button>
                     </div>
                 </div>
                 <button type="button" className="pdf-exclude text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1 text-sm font-medium shrink-0" onClick={() => router.push('/dashboard')}>
                     Закрыть
                     <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
              </div>

              {showPresetForm && <form onSubmit={event => { event.preventDefault(); handleSaveAsPreset(); }} className="pdf-exclude mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                <label htmlFor="preset-name" className="block text-sm font-medium">Название пресета</label>
                <div className="flex gap-2 flex-wrap">
                  <input id="preset-name" autoFocus required maxLength={200} value={presetName} disabled={editingBusy}
                    onChange={event => setPresetName(event.target.value)} className="border rounded-lg px-3 py-2 flex-1 min-w-48" />
                  <button type="submit" disabled={editingBusy || !presetName.trim()} className="bg-amber-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">{editingBusy ? 'Сохранение…' : 'Сохранить пресет'}</button>
                  <button type="button" disabled={editingBusy} onClick={() => setShowPresetForm(false)} className="px-3 py-2 text-slate-600">Отмена</button>
                </div>
                <p className="text-sm text-slate-600">Будут сохранены словесные классы и посимвольные классы с контекстом слов, включая текущие правки.</p>
                {presetError && <p role="alert" className="text-sm text-red-700">{presetError}</p>}
              </form>}
              {presetSuccess && <p role="status" className="pdf-exclude mb-5 text-sm text-emerald-700">Пресет «{presetSuccess}» сохранён. <a href="/presets" className="underline">Перейти к пресетам</a></p>}

              <p className="pdf-exclude mb-3 text-sm text-slate-500">Разделители: {(comp.separators || [' ']).map(separatorLabel).join(', ')}</p>
              <div className="pdf-exclude mb-6 flex flex-wrap items-center gap-3">
                <label htmlFor="comparison-font" className="text-sm font-medium text-slate-700">Шрифт текста</label>
                <select
                  id="comparison-font"
                  value={comp.selected_font_id ?? ''}
                  onChange={event => handleFontChange(event.target.value)}
                  disabled={fontSaving || fontLoading}
                  className="max-w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-60"
                >
                  <option value="">Системный шрифт</option>
                  {comp.selected_font_id && !fonts.some(font => font.id === comp.selected_font_id) && (
                    <option value={comp.selected_font_id}>Недоступный шрифт №{comp.selected_font_id}</option>
                  )}
                  {fonts.map(font => <option key={font.id} value={font.id}>{font.name}</option>)}
                </select>
                <a href="/fonts" className="text-sm text-indigo-600 hover:underline">Управление шрифтами</a>
                {(fontSaving || fontLoading) && <span role="status" className="text-sm text-slate-500">{fontSaving ? 'Сохранение шрифта…' : 'Загрузка шрифта…'}</span>}
                {!fonts.length && <span className="text-sm text-slate-500">Загруженных шрифтов пока нет.</span>}
                {fontError && <p role="alert" className="w-full text-sm text-red-600">{fontError}</p>}
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

                const pairNumbers = new Map<number, number>();
                comp.word_ops.forEach((word, index) => { if (word.op_type === 'transpose') pairNumbers.set(index, pairNumbers.size + 1); });
                const renderToken = (op: WordOp, idx: number) => {
                  if (op.op_type === 'equal') return <span key={idx} data-flow-index={idx} className="comparison-token-text whitespace-pre-wrap mr-1.5 inline-block align-bottom leading-normal py-0.5 border-b-2 border-transparent">{op.base_token}</span>;
                  if (isInsignificant(op, classes)) {
                    if (op.op_type === 'replace' || op.op_type === 'transpose') return <InsignificantReplacement key={idx} word={op} index={idx} classes={classes} pairNumber={pairNumbers.get(idx)} onSelect={() => handleWordClick(idx, op as UtilsWordOp)} />;
                    return <span key={idx} data-hidden-index={idx} aria-hidden="true" className="inline-block align-bottom w-0 h-0 overflow-hidden" />;
                  }
                  const cls = resolveWordClass(op, classes);
                  const selected = isEditMode ? selectedWordIndices.includes(idx) : selectedWordIndex === idx;
                  if (op.op_type === 'transpose') return <TranspositionToken key={idx} word={op} index={idx} number={pairNumbers.get(idx)!}
                    color={cls?.color_hex} selected={selected} onSelect={() => handleWordClick(idx, op as UtilsWordOp)} />;
                  const background = op.op_type === 'replace' ? '#fffbeb' : op.op_type === 'delete' ? '#fff1f2' : '#ecfdf5';
                  const token = <button type="button" data-word-index={idx} data-flow-index={idx}
                    aria-label={`Словесное изменение: ${wordChangeLabel(op)}`}
                    title={cls?.display_name || 'Без класса'} aria-pressed={selected}
                    onClick={() => handleWordClick(idx, op as UtilsWordOp)}
                    style={{ backgroundColor: background, borderBottomColor: cls?.color_hex || background }}
                    className={`comparison-token-text whitespace-pre-wrap inline-block align-bottom leading-normal border-b-2 px-1.5 py-0.5 rounded-t cursor-pointer hover:brightness-95 focus-visible:outline-indigo-600 ${selected ? 'ring-2 ring-indigo-500 ring-offset-2' : ''} ${op.op_type === 'delete' ? 'text-rose-600 line-through decoration-rose-300 decoration-2' : op.op_type === 'insert' ? 'text-emerald-700' : 'text-slate-900'}`}>
                    {op.op_type === 'insert' ? op.other_token : op.base_token}
                    {op.op_type === 'replace' && <span className="text-slate-400 mx-1.5 text-sm comparison-content">[{op.other_token}]</span>}
                  </button>;
                  if (op.op_type !== 'replace') return <span key={idx} className="mr-1.5 inline-flex align-bottom">{token}</span>;
                  return <span key={idx} className="mr-1.5 inline-flex flex-col items-center align-bottom relative min-h-[3.5rem] justify-end">
                    <span className="comparison-char-ops flex flex-wrap justify-center gap-[2px] mb-1 min-h-[18px] max-w-full">
                      {op.char_ops.map((c, charIndex) => <button key={charIndex} type="button"
                        aria-label={`Посимвольное изменение: ${c.from_str || '∅'} → ${c.to_str || '∅'}`}
                        onClick={() => isEditMode ? handleWordClick(idx, op as UtilsWordOp) : handleBadgeClick(c)}
                        style={{ backgroundColor: getClassColor(c.class_id) }}
                        className="char-op-badge min-w-[18px] min-h-[18px] max-w-full px-1.5 flex items-center justify-center rounded text-[10px] leading-4 border border-black/10 text-slate-900 font-bold whitespace-pre-wrap [overflow-wrap:anywhere] hover:shadow-sm">
                        {c.op_type === 'change' ? `${c.from_str} → ${c.to_str}` : c.op_type === 'insert' ? `→ ${c.to_str}` : `${c.from_str} →`}
                      </button>)}
                    </span>
                    {token}
                  </span>;
                };

                return (
                  <div
                    ref={contentRef}
                    className={`relative min-w-0 w-full comparison-content text-[1.05rem] text-slate-800 flex-1 ${!fontFamily ? 'font-serif' : ''}`}
                  >
                    <WordClassAnnotations contentRef={contentRef} words={comp.word_ops} classes={classes}
                      onAssign={handleAssignWordClassAt}
                      layoutKey={`${fontFamily}-${selectedWordIndex !== null}-${!!selectedOp}-${showStats}-${isEditMode}`}
                      onSelect={index => { setIsEditMode(false); setSelectedWordIndices([]); setSelectedWordIndex(index); setSelectedOp(null); setShowStats(false); }} />
                    {paragraphs.map((items, pIdx) => (
                      <div
                        key={pIdx}
                        className={`min-w-0 flex gap-4 items-start ${pIdx === 0 ? '' : 'mt-6'}`}
                      >
                        <div className="w-16 shrink-0 text-right text-xs text-slate-400 select-none tabular-nums pt-2">
                          <RowClassAction number={pIdx + 1}
                            remaining={items.filter(({ op }) => op.op_type !== 'equal' && !isInsignificant(op, classes)).length}
                            hasChanges={items.some(({ op }) => op.op_type !== 'equal')}
                            unsaved={operationsDirty}
                            onApply={() => handleMakeRowInsignificant(items.map(item => item.idx))} />
                        </div>
                        <div className="comparison-flow flex-1 min-w-0 leading-[2.5rem]">
                          {items.map(({ idx, op }) => renderToken(op, idx))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
           </div>
       </div>

       <div id="comparison-sidebar" aria-hidden={!sidebarOpen} style={{ width: sidebarWidth }}
         className={`fixed top-16 bottom-0 right-0 max-w-full bg-white shadow-2xl border-l border-slate-100 transform transition-transform duration-300 ease-in-out z-30 flex flex-col ${sidebarOpen ? 'translate-x-0' : 'translate-x-full'}`}>
           <SidebarResizeHandle width={sidebarWidth} enabled={sidebarOpen} onWidthChange={setSidebarWidth} onResizing={setResizingSidebar} />
           {selectedWordIndex !== null && comp.word_ops[selectedWordIndex] && <WordClassSidebar
             key={selectedWordIndex} word={comp.word_ops[selectedWordIndex]} classes={classes} unsaved={operationsDirty}
             onAssign={(classId, createdClass) => handleAssignWordClassAt(selectedWordIndex, classId, createdClass)} onCreate={cls => setClasses(current => [...current, { ...cls, is_global: false }])}
             onClose={() => setSelectedWordIndex(null)} />}
           {selectedOp && (
               <>
                   <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                       <h2 className="text-lg font-bold text-slate-900">Класс посимвольного изменения</h2>
                       <button onClick={() => setSelectedOp(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                       </button>
                   </div>
                   <div className="flex-1 overflow-y-auto p-6 space-y-8">
                       <div>
                           <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Операция</label>
                           <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-center">
                               <div className="text-2xl font-mono text-slate-800 mb-1 comparison-content">
                                   {selectedOp.op_type === 'change' ? (<span className="flex items-center justify-center gap-3"><span className="bg-white px-2 py-1 rounded border shadow-sm">{selectedOp.from_str}</span><span className="text-slate-400">→</span><span className="bg-white px-2 py-1 rounded border shadow-sm">{selectedOp.to_str}</span></span>) : selectedOp.op_type === 'insert' ? <span className="text-emerald-600">→ "{selectedOp.to_str}"</span> : <span className="text-rose-600">"{selectedOp.from_str}" →</span>}
                               </div>
                               <div className="text-xs text-slate-500 mt-2 font-medium capitalize">{operationLabel(selectedOp.op_type)}</div>
                           </div>
                       </div>
                       <div>
                           <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Назначить класс</label>
                           <select className="block w-full rounded-lg border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 py-2.5 px-3 border bg-white" value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)}>
                               <option value="">Без класса</option>
                               {classes.filter(cls => cls.kind === 'char' && (!cls.hidden || String(cls.id) === selectedClassId)).map(cls => <option key={cls.id} value={cls.id}>{cls.display_name}</option>)}
                           </select>
                       </div>
                       <div>
                           <div className="flex items-center justify-between mb-3">
                               <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Похожие изменения</span>
                               <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full font-medium">Найдено: {groupItems.length}</span>
                           </div>
                           <div className="max-h-60 overflow-y-auto bg-slate-50 rounded-lg border border-slate-200 divide-y divide-slate-100 custom-scrollbar">
                               {groupItems.map((item, index) => (
                                   <div key={index} className="p-3 text-sm flex justify-between items-center hover:bg-white transition-colors">
                                       <span className="comparison-content text-slate-700">{item.old_word} <span className="text-slate-400 mx-1">→</span> {item.new_word}</span>
                                       <span className="text-xs text-slate-400 font-mono">#{item.char_op_id}</span>
                                   </div>
                               ))}
                           </div>
                           <label className="flex items-center mt-4 cursor-pointer group select-none">
                               <input type="checkbox" className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} />
                               <span className="ml-2 text-sm text-slate-700 group-hover:text-indigo-600 transition-colors font-medium">Применить ко всем изменениям: {groupItems.length}</span>
                           </label>
                       </div>
                   </div>
                   <div className="p-6 border-t border-slate-100 bg-slate-50/50">
                       <button onClick={handleSaveClass} className="w-full bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 font-semibold shadow-sm transition-all transform active:scale-[0.98]">Сохранить изменения</button>
                   </div>
               </>
           )}

           {isEditMode && selectedWordIndices.length > 0 && !selectedOp && (
               <>
                   <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                       <h2 className="text-lg font-bold text-slate-900">Редактирование операций</h2>
                       <button onClick={() => setSelectedWordIndices([])} className="text-slate-400 hover:text-slate-600 transition-colors">
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                       </button>
                   </div>
                   <div className="flex-1 overflow-y-auto p-6 space-y-6">
                       <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                           <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Выбранные элементы ({selectedWordIndices.length})</h3>
                           <div className="flex flex-wrap gap-2">
                               {[...selectedWordIndices].sort((a,b) => a-b).map(idx => {
                                   const op = comp.word_ops[idx];
                                   return (
                                       <span key={idx} className="bg-white px-2 py-1 rounded border border-slate-200 text-sm shadow-sm truncate max-w-[150px]">
                                           <span className={`text-xs font-bold mr-1 uppercase ${op.op_type === 'insert' ? 'text-emerald-600' : op.op_type === 'delete' ? 'text-rose-600' : 'text-amber-600'}`}>{operationLabel(op.op_type)}</span>
                                           <span className="font-mono font-bold text-slate-700">{op.base_token || op.other_token}</span>
                                       </span>
                                   );
                               })}
                           </div>
                       </div>
                       
                       <div>
                           <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Доступные действия</label>
                           <div className="space-y-3">
                               {(() => {
                                   const selectedOps = [...selectedWordIndices].sort((a,b) => a-b).map(idx => comp.word_ops[idx] as unknown as UtilsWordOp);
                                   const actions = getAvailableActions(selectedOps);
                                   
                                   if (actions.length === 0) {
                                       return <div className="text-sm text-slate-400 italic text-center py-4 bg-slate-50 rounded border border-dashed border-slate-200">Для выбранных элементов нет доступных действий.</div>
                                   }
                                   
                                   return actions.map(action => (
                                       <button 
                                           key={action}
                                           disabled={editingBusy}
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
                       <h2 className="text-lg font-bold text-slate-900">Статистика</h2>
                       <button aria-label="Закрыть статистику" onClick={() => setShowStats(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                       </button>
                   </div>
                   <ComparisonStatistics stats={stats} loading={loadingStats} error={statsError} filter={statsFilter}
                     onFilterChange={value => { setStatsFilter(value); setStatsPage(1); }} onPageChange={setStatsPage} unsaved={operationsDirty} />
               </>
           )}
       </div>
    </div>
  );
}
