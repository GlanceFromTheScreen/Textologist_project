import { isAxiosError } from 'axios';

const messages: Record<string, string> = {
  'Incorrect username or password': 'Неверный логин или пароль.',
  'Could not validate credentials': 'Сессия истекла. Войдите заново.',
  'Not authenticated': 'Войдите в аккаунт.',
  'Not enough permissions': 'Недостаточно прав для этого действия.',
  'Comparison not found': 'Сравнение не найдено.',
  'Text not found': 'Текст не найден.', 'One or both texts not found': 'Один из текстов не найден.',
  'Font not found': 'Шрифт не найден.', 'Preset not found': 'Пресет не найден.',
  'Preset rule not found': 'Правило пресета не найдено.',
  'Only .txt and .docx files are allowed': 'Выберите файл .txt или .docx.',
  'Only .ttf, .otf, .woff files are allowed': 'Выберите файл .ttf, .otf или .woff.',
  'JSON file must be no larger than 10 MB': 'Размер JSON-файла не должен превышать 10 МБ.',
  'The file must contain valid UTF-8 JSON': 'Файл должен содержать корректный JSON в кодировке UTF-8.',
  'Expected a non-empty array of comparison operations (Export JSON format)': 'Ожидается непустой список операций или файл экспорта сравнения.',
  'A comparison can contain at most 50,000 operations': 'В сравнении может быть не более 50 000 операций.',
  'Built-in classes cannot be hidden or modified': 'Предустановленные классы нельзя скрывать или изменять.',
};

export function errorDetailMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') {
    if (messages[detail]) return messages[detail];
    if (detail.startsWith('Invalid comparison operation')) return 'В JSON найдена некорректная операция сравнения.';
    if (/^[А-Яа-яЁё]/.test(detail)) return detail;
  }
  if (Array.isArray(detail) && detail.length) {
    if (detail.some(item => item?.loc?.includes('separators'))) return 'Выберите хотя бы один разделитель. Каждый разделитель должен быть одним символом.';
    return 'Проверьте заполнение полей: обязательные значения, формат и длину.';
  }
  return fallback;
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    if (!error.response) return 'Не удалось связаться с сервером. Проверьте подключение и повторите попытку.';
    return errorDetailMessage(error.response.data?.detail, fallback);
  }
  if (error instanceof Error) return errorDetailMessage(error.message, fallback);
  return fallback;
}
