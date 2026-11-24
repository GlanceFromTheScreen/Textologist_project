"use client";

export type StatsFilter = 'all' | 'insignificant' | 'significant';
type Totals = { replace: number; insert: number; delete: number; transpose: number };
type ClassCount = { class_id: number | null; display_name: string; color_hex: string; count: number };
export interface ComparisonStats {
  totals: Totals;
  totals_by_significance: Record<StatsFilter, Totals>;
  word_class_distribution: ClassCount[];
  class_distribution: ClassCount[];
  top_char_ops: { op_type: string; from_str: string; to_str: string; count: number; unique_contexts: number; frequency: number }[];
  char_ops_page: number; char_ops_pages: number; char_ops_total: number; char_ops_page_size: number;
}

function ClassHistogram({ title, values }: { title: string; values: ClassCount[] }) {
  const sorted = [...values].sort((a, b) => b.count - a.count || (a.class_id ?? -1) - (b.class_id ?? -1));
  const maximum = Math.max(1, ...sorted.map(item => item.count));
  const total = sorted.reduce((sum, item) => sum + item.count, 0);
  return <section aria-label={title}>
    <h3 className="text-sm font-semibold text-slate-800 mb-1">{title}</h3>
    <p className="text-xs text-slate-500 mb-4">Количество изменений · всего {total}</p>
    {!sorted.length ? <p className="text-sm text-slate-500">В выбранной категории изменений нет.</p> :
      <ul className="space-y-3">{sorted.map(item => <li key={item.class_id ?? 'none'}>
        <div className="flex items-start justify-between gap-3 mb-1 text-xs">
          <span className="min-w-0 text-slate-700 [overflow-wrap:anywhere]">{item.display_name}</span>
          <span className="shrink-0 font-semibold text-slate-800">{item.count} <span className="font-normal text-slate-400">({(item.count / total * 100).toFixed(1)}%)</span></span>
        </div>
        <div aria-hidden="true" className="h-4 rounded bg-slate-100 overflow-hidden">
          <div className="h-full rounded border border-black/10" style={{ width: `${item.count / maximum * 100}%`, backgroundColor: item.color_hex }} />
        </div>
      </li>)}</ul>}
  </section>;
}

export default function ComparisonStatistics({ stats, loading, error, filter, onFilterChange, onPageChange, unsaved }: {
  stats: ComparisonStats | null; loading: boolean; error: string; filter: StatsFilter;
  onFilterChange: (filter: StatsFilter) => void; onPageChange: (page: number) => void; unsaved: boolean;
}) {
  return <div className="flex-1 overflow-y-auto p-6 space-y-6" aria-label="Содержимое статистики">
    {stats && <section aria-label="Общие итоги">
      <h3 className="text-sm font-semibold text-slate-800 mb-3">Общие итоги</h3>
      <div className="grid grid-cols-2 gap-3">
        {([{key: 'replace', label: 'Замены', color: 'text-slate-800'}, {key: 'insert', label: 'Добавления', color: 'text-emerald-600'},
           {key: 'delete', label: 'Удаления', color: 'text-rose-600'}, {key: 'transpose', label: 'Перестановки', color: 'text-violet-600'}] as const).map(item =>
          <div key={item.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <h4 className={`text-sm font-semibold ${item.color}`}>{item.label}</h4>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex flex-wrap justify-between items-baseline gap-1"><dt className="text-slate-500">Всего</dt><dd className={`text-xl font-bold ${item.color}`}>{stats.totals_by_significance.all[item.key]}</dd></div>
              <div className="flex flex-wrap justify-between gap-1"><dt className="text-slate-500">Несущественных</dt><dd className="font-semibold text-slate-700">{stats.totals_by_significance.insignificant[item.key]}</dd></div>
              <div className="flex flex-wrap justify-between gap-1"><dt className="text-slate-500">Существенных</dt><dd className="font-semibold text-slate-700">{stats.totals_by_significance.significant[item.key]}</dd></div>
            </dl>
          </div>)}
      </div>
    </section>}
    <fieldset>
      <legend className="text-xs font-semibold text-slate-600 mb-2">Гистограммы и таблица</legend>
      <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1 gap-1">
        {([{value: 'all', label: 'Все'}, {value: 'insignificant', label: 'Несущественные'}, {value: 'significant', label: 'Существенные'}] as const).map(option =>
          <label key={option.value} className="flex-1 min-w-0 cursor-pointer">
            <input type="radio" name="stats-significance" value={option.value} checked={filter === option.value}
              onChange={() => onFilterChange(option.value)} className="peer sr-only" />
            <span className="block rounded-md px-1 py-2 text-center text-[11px] text-slate-600 peer-checked:bg-indigo-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400">{option.label}</span>
          </label>)}
      </div>
      <p className="mt-2 text-xs text-slate-500">Фильтр применяется к гистограммам и таблице. Общие итоги всегда показывают обе категории. Несущественность определяется словесным классом.</p>
    </fieldset>
    {unsaved && <p role="status" className="text-xs text-amber-700">Есть несохранённые правки. Статистика рассчитана по последней сохранённой версии сравнения.</p>}
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : !stats ? <p role="status" className="text-sm text-slate-500">Загрузка статистики…</p> :
      <div aria-busy={loading} className={`space-y-6 ${loading ? 'opacity-50' : ''}`}>
        <ClassHistogram title="Классы словесных изменений" values={stats.word_class_distribution} />
        <ClassHistogram title="Классы посимвольных изменений" values={stats.class_distribution} />
        <section aria-label="Посимвольные изменения">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Посимвольные изменения</h3>
          <p className="text-xs text-slate-500 mb-3">По числу контекстов, от большего к меньшему. Контекст — уникальное исходное слово. Частота — относительно всего исходного текста.</p>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs" aria-label="Посимвольные изменения по контекстам">
              <thead className="bg-slate-50 text-slate-500"><tr>
                <th scope="col" className="px-2 py-2 text-left">Изменение</th>
                <th scope="col" aria-sort="descending" className="px-2 py-2 text-right">Контексты ↓</th>
                <th scope="col" className="px-2 py-2 text-right">Количество</th>
                <th scope="col" className="px-2 py-2 text-right">Частота</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {stats.top_char_ops.map((op, i) => <tr key={i}>
                  <td className="comparison-content px-2 py-2 [overflow-wrap:anywhere]">{op.from_str || '∅'} → {op.to_str || '∅'}</td>
                  <td className="px-2 py-2 text-right font-semibold text-slate-800">{op.unique_contexts}</td>
                  <td className="px-2 py-2 text-right text-slate-600">{op.count}</td>
                  <td className="px-2 py-2 text-right text-slate-600">{(op.frequency * 100).toFixed(1)}%</td>
                </tr>)}
                {!stats.top_char_ops.length && <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-500">В выбранной категории изменений нет.</td></tr>}
              </tbody>
            </table>
          </div>
          <nav aria-label="Страницы посимвольных изменений" className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button type="button" disabled={loading || stats.char_ops_page <= 1} onClick={() => onPageChange(stats.char_ops_page - 1)}
              className="rounded border border-slate-300 px-2 py-1.5 text-xs disabled:opacity-40">Назад</button>
            <span role="status" className="text-xs text-slate-600">Страница {stats.char_ops_page} из {stats.char_ops_pages}</span>
            <button type="button" disabled={loading || stats.char_ops_page >= stats.char_ops_pages} onClick={() => onPageChange(stats.char_ops_page + 1)}
              className="rounded border border-slate-300 px-2 py-1.5 text-xs disabled:opacity-40">Вперёд</button>
          </nav>
          <p className="mt-2 text-xs text-slate-500">Всего видов изменений: {stats.char_ops_total}. По 10 на странице.{loading ? ' Обновление…' : ''}</p>
        </section>
      </div>}
  </div>;
}
