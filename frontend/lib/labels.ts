export function operationLabel(value: string): string {
  return ({equal: 'Без изменений', replace: 'Замена', change: 'Замена', insert: 'Вставка', delete: 'Удаление', transpose: 'Перестановка'} as Record<string, string>)[value] || 'Операция';
}
