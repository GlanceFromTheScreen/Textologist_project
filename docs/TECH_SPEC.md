# TECH_SPEC.md — Техническое задание (MVP) для веб-приложения “Текстолог: разночтения”

Дата: 2026-01-17  
Статус: MVP (локальный запуск), архитектура готова к деплою на сервер.

---

## 0. Цель и контекст

Нужно веб-приложение для текстолога, которое автоматизирует получение разночтений между двумя текстами и работу с посимвольными заменами (классификацией), а также строит статистику и матрицу близости.

Ключевой принцип:  
- **Разночтения ищем по словам (токенам)** (word-level diff).  
- **Классы назначаются только посимвольным изменениям** внутри словесных замен (char-level ops).

---

## 1. MVP-состав (что реализуем)

### MVP: обязательно
1) Регистрация/логин (username+password), роли `admin` и `textologist`
2) Загрузка текстов `.docx` и `.txt`, сохранение структуры абзацев
3) Загрузка шрифтов `.ttf/.otf/.woff`, выбор шрифта для сравнения
4) Сравнение пары текстов (алгоритм: Levenshtein с весами)
5) Визуализация:
   - показываем **только базовый текст**
   - **insert** — зелёным (вставка токена из второго текста в поток базового)
   - **delete** — красным (токен базового, отсутствующий во втором)
   - **replace** — базовый токен как “замена”, и сразу после него показываем `[newToken]`
6) Для каждой word-replace:
   - строим список **посимвольных atomic-изменений** (`a→б`, `∅→x`, `x→∅`)
   - эти изменения показываем **над словом** и называем **бейджами**
   - бейдж окрашивается цветом класса и кликабелен
7) Редактирование класса:
   - клик по бейджу открывает правую боковую панель (sidebar)
   - можно назначить/сменить класс для конкретного char-op
8) Sidebar также показывает список всех мест **в текущем сравнении**, где есть та же посимвольная замена (по ключу `op_type, from, to`)
   - в списке видно: `oldWord [newWord]`, класс, номер абзаца (paragraph index)
   - есть “Применить ко всем” (массовое назначение класса на все совпадения)
9) Статистика по сравнению (на лету + кэш):
   - totals: word-replace/word-insert/word-delete
   - топ словесных замен A→B по частоте
   - топ посимвольных замен from→to (в т.ч. пустые строки) по частоте
   - распределение по классам (сколько char-ops каждого класса)
10) Пресеты:
   - CRUD пресетов и их правил
   - выбор одного пресета при сравнении
   - пресет содержит **посимвольные правила** (atomic), каждое правило отдельной строкой
   - применение пресета при сравнении: override класса (пресет выше базового классификатора)
   - кнопка “Сохранить пресет как новый” из текущего сравнения (сохранить ВСЕ char-ops как правила)
11) Матрица близости (до N=20):
   - выбираем тексты
   - задаём веса (один набор на все пары)
   - считаем NxN (без нормализации), матрица не кликабельна

### Не делаем в MVP (позже)
- транзитивные пресеты (T1→T3 из T1→T2 и T2→T3)
- экспорт PDF/DOCX/HTML отчётов
- редактирование типов операций word-level (insert/delete/replace)
- контекстные правила по символам (regex-подобные контексты) — отключено

---

## 2. Технологический стек

### Backend
- Python 3.11+, django
- FastAPI
- SQLAlchemy 2.x, Alembic
- PostgreSQL (университетский сервер)
- Файлы (docx/txt/fonts) храним на диске (локально), в БД — метаданные и path

### Frontend
- Next.js + React + TypeScript
- UI библиотека — на выбор (рекомендация: shadcn/ui + Tailwind)

### Auth
- JWT access/refresh в HttpOnly cookies (или session-based — допускается; выбрать самое простое типовое решение, но зафиксировать в коде)
- Роли: `admin`, `textologist`

### Docker
- Не нужен в MVP.

---

## 3. Ключевые определения и правила

### 3.1 Тексты и абзацы
- Для `.docx` извлекаем **только абзацы** (plain paragraphs, форматирование не сохраняем).
- Для `.txt` читаем текст и разбиваем на абзацы по `\n` (или по пустым строкам — выбрать единообразно, предпочтительно по `\n`).
- Для сравнения склеиваем абзацы в один поток токенов, но сохраняем mapping “токен → номер абзаца”.

Номер абзаца для UI: **показываем пользователю с 1** (1-based).

### 3.2 Токенизация (важно)
Требования:
- при нахождении разночтений: токен=слово
- пунктуация — отдельные токены (пример: `слово,` -> `слово` и `,`)
- чувствительно к регистру
- Unicode normalization не делаем
- `ё` и `е` считаем разными

### 3.3 Сравнение word-level
Параметры сравнения:
- base_text_id
- other_text_id
- direction (кто базовый)
- веса: replace/delete/insert
- алгоритм: Levenshtein (единственный в MVP)
- preset_id (0/1)
- font_id (0/1)

Отображение:
- only base stream
- inserts (из other) вставляются как зелёные токены между base токенами
- deletes (base токены отсутствующие во втором) — красным
- replaces — base токен + `[other токен]`

### 3.4 Посимвольные atomic-изменения (char ops)
Для каждой word-replace строим список atomic char ops:
- change: `from_char → to_char` (пример `a→б`)
- insert: `∅→x`
- delete: `x→∅`

**Бейдж** = визуальный элемент atomic char op (например `a→б`), окрашенный цветом класса.

Класс назначается только char-op, не слову.

### 3.5 “Та же замена” для sidebar
В рамках текущего сравнения “та же замена” определяется ключом:
- `(op_type, from_str, to_str)`

---

## 4. Права доступа

- Пользователь видит только свои тексты, шрифты, сравнения, пресеты.
- Классы:
  - Есть глобальные базовые классы (создаёт/редактирует admin).
  - Пользователь может:
    - добавлять свои классы (видны только ему)
    - делать overrides глобальных классов для себя (переименование/цвет/скрытие)

---

## 5. Модель данных (PostgreSQL)

### 5.1 users
- id (pk)
- username (unique)
- password_hash
- role enum('admin','textologist')
- created_at

### 5.2 texts
- id (pk)
- owner_user_id (fk users)
- title
- source_type enum('txt','docx')
- file_path
- extracted_paragraphs_json (JSONB) — массив строк абзацев
- created_at

### 5.3 fonts
- id (pk)
- owner_user_id
- name
- file_path
- format enum('ttf','otf','woff')
- created_at

### 5.4 class_catalog (базовые + пользовательские)
- id (pk)
- owner_user_id nullable (null => глобальный базовый класс)
- code (string identifier)
- display_name
- color_hex
- created_at

### 5.5 class_overrides
- id (pk)
- user_id
- base_class_id (fk class_catalog)
- custom_display_name nullable
- custom_color_hex nullable
- hidden bool default false

### 5.6 presets
- id (pk)
- owner_user_id
- name
- description nullable
- created_from_text_a_id nullable (fk texts)
- created_from_text_b_id nullable
- created_at

### 5.7 preset_rules (atomic char rules)
- id (pk)
- preset_id (fk presets)
- op_type enum('insert','delete','change')
- from_str (text, может быть '')
- to_str (text, может быть '')
- class_id nullable (fk class_catalog)
- created_at

### 5.8 comparisons
- id (pk)
- owner_user_id
- base_text_id
- other_text_id
- created_at (timestamp)
- weight_replace float
- weight_delete float
- weight_insert float
- algorithm enum('levenshtein')
- selected_font_id nullable
- selected_preset_id nullable
- saved bool default false
- dirty_for_preset bool default false

### 5.9 comparison_word_ops
Хранит готовые операции, чтобы UI не пересчитывал diff.
- id (pk)
- comparison_id (fk comparisons)
- op_type enum('equal','delete','insert','replace')
- base_index int nullable
- other_index int nullable
- base_token text nullable
- other_token text nullable
- base_paragraph_index int nullable  (1-based для UI можно преобразовать на выдаче)
- created_at

### 5.10 comparison_char_ops
- id (pk)
- comparison_id (fk comparisons)
- word_op_id (fk comparison_word_ops)  (только для replace)
- op_type enum('insert','delete','change')
- from_str text
- to_str text
- pos_info_json nullable
- class_id nullable
- source enum('classifier','preset','manual')
- created_at
- updated_at

Индексы:
- owner_user_id на основных сущностях
- comparison_id на *_ops
- (comparison_id, op_type, from_str, to_str) индекс на comparison_char_ops для быстрых группировок sidebar

---

## 6. Алгоритмический модуль (отдельный Python-пакет)

Алгоритмический модуль — это изолированный слой “математики и лингвистической логики”, который:
- не зависит от FastAPI/БД/файловой системы,
- получает на вход только строки/токены,
- возвращает строго структурированные результаты (операции diff, посимвольные изменения, расстояния),
- используется backend-ом как “чёрный ящик”.

Цель: чтобы можно было менять/улучшать алгоритмы (токенизация, diff, классификация) независимо от веб-части.

### 6.1. Общие требования к модулю
- Папка/пакет: `algo/`
- Никаких импортов из web/backend слоёв
- Никакой работы с БД/файлами (всё уже подготовлено выше)
- Набор простых unit-тестов на ключевые функции (минимум на токенизацию и char-diff)

---

### 6.2. Основные функции и их смысл

#### 6.2.1 `tokenize_paragraphs(paragraphs: list[str]) -> TokenizationResult`

**Зачем нужна:**  
Приложение хранит тексты абзацами (paragraphs). Для сравнения мы должны получить “плоский поток токенов”, но при этом сохранить информацию, из какого абзаца пришёл каждый токен, чтобы:
- корректно показывать “номер абзаца” в sidebar,
- при необходимости восстанавливать границы абзацев в отображении.

**Что делает функция:**
1) Принимает список абзацев (строк).
2) Для каждого абзаца выполняет токенизацию по правилу MVP:
   - слова — токены
   - пунктуация — **отдельные токены**
   - пробелы не являются токенами
3) Склеивает токены всех абзацев в один список.
4) Возвращает:
   - `tokens`: плоский список токенов
   - `token_paragraph_index`: массив той же длины, где для каждого токена указан индекс абзаца, из которого он взят (0-based внутри алгоритма; в UI показываем +1).

**Смысл результата:**  
Backend может для любого токена (по его индексу в базовом тексте) определить номер абзаца.

---

#### 6.2.2 `compare_tokens(base_tokens: list[str], other_tokens: list[str], weights: Weights) -> list[WordOp]`

**Зачем нужна:**  
Это ядро поиска разночтений по словам. На входе два списка токенов (базовый и сравниваемый), на выходе — последовательность word-level операций, достаточная для:
- визуального отображения diff,
- сохранения в БД (таблица `comparison_word_ops`),
- последующего расчёта статистики.

**Что делает функция:**
1) Принимает два массива токенов: `base_tokens` и `other_tokens`.
2) Выполняет выравнивание (alignment) с использованием Levenshtein-подобного алгоритма, учитывая веса операций:
   - `weights.replace`
   - `weights.delete`
   - `weights.insert`
3) Возвращает список операций `WordOp` в том порядке, в котором их нужно отображать в базовом тексте.

**Формат операций (`WordOp`) — смысл:**
- `equal`: токен совпал (часто можно не хранить/не отображать отдельно, но для цельного потока удобно)
- `delete`: токен есть в base, но отсутствует в other
- `insert`: токен отсутствует в base, но присутствует в other (его нужно “вставить” в поток отображения base)
- `replace`: токен в base заменён на токен в other

Каждая операция должна содержать достаточно данных для UI:
- `op_type`
- `base_index` и/или `other_index` (индексы в соответствующих списках токенов)
- `base_token` и/или `other_token` (строковые значения)

**Смысл результата:**  
UI сможет:
- показывать только базовый текст,
- удалённые токены красным (delete),
- вставленные токены зелёным (insert),
- заменённые токены как `oldToken [newToken]` (replace).

---

#### 6.2.3 `char_diff(old_word: str, new_word: str) -> list[CharOp]`

**Зачем нужна:**  
Когда word-level diff определил замену слова на слово, нужно разложить эту замену на набор atomic посимвольных изменений, потому что:
- именно они отображаются над словом в виде бейджей (`a→б`, `∅→x`, `x→∅`),
- именно им назначаются классы,
- именно по ним строится статистика и пресеты.

**Что делает функция:**
1) Принимает две строки: `old_word` и `new_word`.
2) Строит посимвольное выравнивание (char-level alignment).
3) Возвращает список atomic операций `CharOp`.

**Формат `CharOp` — смысл:**
- `op_type`: `'insert'|'delete'|'change'`
- `from_str`: строка-источник (для insert — пустая строка `''`)
- `to_str`: строка-назначение (для delete — пустая строка `''`)
- `pos_info` (опционально): если нужно знать позицию в слове для отладки/будущего функционала

> MVP допускает, что `from_str` и `to_str` могут быть строками длины 1.  
> Если текущая реализация умеет группировать последовательности — можно оставить, но UI всё равно должен отображать как `from→to`.

**Смысл результата:**  
Каждый элемент списка — это будущий “бейдж” в UI и будущая строка в `comparison_char_ops` и/или `preset_rules`.

---

#### 6.2.4 `classify_graphic(char_op: CharOp, old_word: str, new_word: str) -> Optional[str|int]`

**Зачем нужна:**  
В MVP есть базовая автоматическая классификация (как минимум для графических замен), которая:
- проставляет класс некоторым char-op автоматически,
- затем может быть переопределена пресетом или ручной правкой.

**Что делает функция:**
1) Принимает один atomic char-op и (при необходимости) контекст слов.
2) Возвращает идентификатор класса (например `code` или `class_id` — на выбор интеграции), либо `None`, если классификатор не уверен.

**Смысл результата:**  
Backend использует эту функцию при создании `comparison_char_ops`, чтобы заполнить `class_id` и `source='classifier'` до применения пресета.

---

#### 6.2.5 `distance(base_tokens: list[str], other_tokens: list[str], weights: Weights) -> float|int`

**Зачем нужна:**  
Для матрицы близости N×N нужно для каждой пары текстов получить численную метрику расстояния/близости. В MVP мы используем существующую функцию расстояния из твоего алгоритмического кода.

**Что делает функция:**
- Принимает токены двух текстов и веса.
- Возвращает число (distance), которое используется для заполнения матрицы.

**Смысл результата:**  
Backend строит матрицу N×N и отдаёт фронтенду только числа.

---

### 6.3. Рекомендации по типам и структурам (не обязательно, но желательно)
- Определить dataclasses / pydantic-compatible структуры для:
  - `Weights`
  - `TokenizationResult`
  - `WordOp`
  - `CharOp`
- Это уменьшит количество ошибок интеграции и упростит тестирование.

---

## 7. Применение пресетов и конфликты (заглушка)

### 7.1 Применение пресета при сравнении
При создании comparison_char_ops:
- сначала выставляется class из базового классификатора (если есть)
- затем применяется пресет (если выбран):
  - если найдено правило по ключу (op_type, from_str, to_str) — class_id берётся из пресета (override)

### 7.2 Конфликт правил в пресете (временная логика)
Если несколько правил подходят:
- если есть правило с class_id != null и правило с class_id == null → взять class_id != null
- если несколько с class_id != null → выбрать по лексикографическому порядку имени класса (display_name)
- если все null → null

(Пометить в коде TODO: заменить на нормальную стратегию.)

---

## 8. API (Backend, FastAPI)

### 8.1 Auth
- POST /auth/register {username,password}
- POST /auth/login {username,password}
- POST /auth/logout
- GET  /auth/me

### 8.2 Texts
- POST /texts/upload (multipart: file, title?)
- GET  /texts
- GET  /texts/{id}
- DELETE /texts/{id}

### 8.3 Fonts
- POST /fonts/upload (multipart)
- GET  /fonts
- GET  /fonts/{id}/file
- DELETE /fonts/{id}

### 8.4 Classes
- GET /classes  (как “видит пользователь”: глобальные с overrides + пользовательские)
- (admin) POST /admin/classes
- (admin) PATCH /admin/classes/{id}
- (admin) DELETE /admin/classes/{id}
- (user) POST /classes (создать свой)
- (user) PATCH /class-overrides/{base_class_id} (set hidden/name/color)

### 8.5 Comparisons
- POST /comparisons/run
  - body: {base_text_id, other_text_id, direction, weights, preset_id?, font_id?}
  - resp: {comparison_id}
- GET /comparisons/{id}
  - возвращает: параметры + word_ops + char_ops
- POST /comparisons/{id}/save
  - saved=true
- GET /comparisons (список сохранённых/всех — по UI решению)
- DELETE /comparisons/{id} (опционально)

### 8.6 Char-op редактирование и sidebar-группы
- PATCH /comparison-char-ops/{id}
  - body: {class_id}
  - effect: set class_id, source='manual', comparisons.dirty_for_preset=true

- GET /comparisons/{comparison_id}/char-op-group?op_type=...&from=...&to=...
  - resp:
    - groupKey
    - items: [{char_op_id, old_word, new_word, paragraph_index(1-based), class{...}}]

- PATCH /comparisons/{comparison_id}/char-op-group
  - body: {op_type, from, to, class_id}
  - effect: массово обновить все совпадения в сравнении, source='manual', dirty_for_preset=true

### 8.7 Presets
- POST /presets {name, description?} (создать пустой)
- GET  /presets
- GET  /presets/{id}
- PATCH /presets/{id} (rename/description)
- DELETE /presets/{id}

Rules:
- GET /presets/{id}/rules (с фильтрами)
- POST /presets/{id}/rules {op_type, from_str, to_str, class_id?}
- DELETE /preset-rules/{rule_id}

Save-as-new from comparison:
- POST /comparisons/{id}/save-as-preset
  - body: {name, description?}
  - behavior:
    - создать preset
    - взять ВСЕ comparison_char_ops, создать preset_rules по (op_type, from_str, to_str, class_id)
    - dirty_for_preset=false

### 8.8 Stats
- GET /comparisons/{id}/stats
  - resp:
    - totals: {replace, insert, delete}
    - top_word_replacements: [{from,to,count}]
    - top_char_ops: [{op_type,from,to,count}]
    - class_distribution: [{class_id, display_name, color_hex, count}]

### 8.9 Distance matrix
- POST /distance-matrix/run
  - body: {text_ids: [..<=20], weights}
  - resp: {labels: [...], matrix: [[...]]}

---

## 9. Frontend (страницы и поведение)

### 9.1 Страницы
- /login, /register
- /texts (upload/list/view)
- /fonts (upload/list)
- /compare
- /presets
- /matrix
- /profile (минимально)

### 9.2 Страница /compare (основная)
Форма:
- select Text A, Text B
- direction (кто базовый)
- веса replace/delete/insert
- preset (0/1)
- font (0/1)
- кнопка Compare

Результат:
- базовый текст отрисован токенами
- delete красным
- insert зелёным
- replace: `oldToken [newToken]` (oldToken стилизован как replace)
- над каждым replace: список бейджей `a→б` / `∅→x` / `x→∅`
  - цвет бейджа = цвет класса (если нет класса — серый)
  - клик по бейджу → открывается sidebar

Sidebar:
- детали выбранного бейджа
- dropdown класса
- список совпадений (в этом comparison) с тем же (op_type, from, to)
  - каждая строка: `oldWord [newWord]`, класс (dropdown), paragraph index (1-based)
  - checkbox “apply to all”
  - если apply-to-all включен: смена класса в sidebar применяет массово

Кнопки:
- “Save comparison” (saved=true)
- “Save preset as new” (создаёт новый пресет из ВСЕХ char-ops)
- индикатор: “unsaved changes for preset” если dirty_for_preset=true

Режимы:
- “Edit classes” (включает кликабельность бейджей/сайдбар)
- “Stats” (открывает панель статистики; можно как отдельный режим/табы)

### 9.3 /presets
- список пресетов
- внутри пресета: таблица правил, поиск/фильтр, добавление правила, удаление правила
- rename/delete preset

### 9.4 /matrix
- мультиселект текстов (<=20)
- веса
- кнопка посчитать
- таблица NxN

---

## 10. Нефункциональные требования
- Размер: 5–20 тыс. слов на текст
- Можно считать синхронно; UI должен показывать loading
- Логи backend: время сравнения, ошибки парсинга
- Безопасность:
  - строго проверять owner_user_id на всех ресурсах
  - хеширование паролей (bcrypt/argon2)
  - защита cookie (HttpOnly, SameSite)

---

## 11. Модульный план реализации (порядок)

M1 Инфраструктура (без Docker)  
M2 БД + Alembic миграции  
M3 Auth (register/login/me, роли)  
M4 Texts (upload + извлечение абзацев + просмотр)  
M5 Fonts (upload + отдача + применение в UI)  
M6 Algo module (tokenize+mapping, compare_tokens, char_diff, distance)  
M7 Comparisons (run → сохранить word_ops+char_ops → UI рендер)  
M8 Class editing (sidebar + PATCH + dirty flag)  
M9 Presets (CRUD + apply + save-as-new)  
M10 Stats  
M11 Matrix  
M12 Classes (admin глобальные + user overrides)

Критерий готовности каждого модуля: модуль должен быть проверяем с UI (или отдельными тестами для algo).

---

## 12. Примечания по UI-символам
- Для пустой строки использовать символ `∅` в отображении insert/delete.
- Paragraph index показывать пользователю как 1-based.

---
