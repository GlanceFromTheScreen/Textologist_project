# Textologist: Разночтения

Web-приложение для сравнения и анализа текстов (разночтения).

## Структура проекта

| Папка | Описание |
|-------|----------|
| `backend/` | FastAPI, PostgreSQL, Alembic-миграции |
| `frontend/` | Next.js + React + TypeScript |
| `algo/` | Модуль алгоритмов (токенизация, diff и т.д.) |
| `docs/` | Техническая документация |

## Быстрый старт (Docker Compose) — рекомендуется

### Требования

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (или Docker Engine + Compose plugin)
- Git

### 1. Клонирование и настройка

```bash
git clone <repository-url>
cd Textologist_project
cp .env.example .env
```

Отредактируйте `.env`:

| Переменная | Назначение |
|------------|------------|
| `POSTGRES_PASSWORD` | Пароль PostgreSQL (не оставляйте дефолт на сервере) |
| `SECRET_KEY` | Ключ JWT (`openssl rand -hex 32`) |
| `NEXT_PUBLIC_API_URL` | URL backend **с точки зрения браузера** |
| `CORS_ORIGINS` | URL frontend **с точки зрения браузера** (см. раздел про порты) |
| `FRONTEND_PORT` / `BACKEND_PORT` | Порты на хосте (по умолчанию 3000 и 8000) |

### 2. Запуск

```bash
docker compose build
docker compose up -d
docker compose ps
```

- Frontend: http://localhost:3000 (или ваш `FRONTEND_PORT`)
- Backend API / Swagger: http://localhost:8000/docs

Логи:

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

### 3. Пользователи по умолчанию

При запуске backend создаёт отсутствующие стартовые аккаунты, только если для них заданы пароли в окружении:

| Логин | Переменная окружения с паролем | Роль |
|---|---|---|
| `admin` | `BOOTSTRAP_ADMIN_PASSWORD` | `admin` |
| `user1` | `BOOTSTRAP_USER1_PASSWORD` | `user` |
| `user2` | `BOOTSTRAP_USER2_PASSWORD` | `user` |

Задайте собственные пароли в локальном `.env` перед первым запуском. В `.env.example` эти поля пустые; общих паролей по умолчанию нет. Если переменная отсутствует или пуста, соответствующий аккаунт не создаётся. Docker Compose передаёт значения только backend. При прямом запуске Uvicorn задайте эти переменные в окружении процесса.

Пароли используются только при первом создании. После изменения аккаунта через админку новый логин и пароль сохраняются при перезапуске. Стартовые аккаунты отслеживаются по постоянному ключу, поэтому переименование не создаёт дубликаты. В базе хранятся хеши паролей. Локальный `.env` исключён из Git и Docker-контекста сборки. После создания аккаунтов стартовые пароли можно удалить из окружения.

Регистрация через UI **отключена**. Дополнительных пользователей можно добавить через скрипт:

```bash
docker compose exec backend python backend/create_user.py admin your_password admin
```

Роли: `admin` или `user`. Если пользователь уже существует — скрипт обновит пароль и роль.

### 4. Остановка

```bash
# Остановить контейнеры, данные в volumes сохраняются
docker compose down

# ОПАСНО: удалить контейнеры И все данные (БД, uploads)
docker compose down -v
```

---

## Где находится база данных

При запуске через Docker Compose:

| Что | Где |
|-----|-----|
| СУБД | Контейнер `postgres` (образ `postgres:16-alpine`) |
| Имя БД | `textologist_db` |
| Схема с таблицами | `collations` (не `public`) |
| Физическое хранение | Docker volume **`pgdata`** (не в папке проекта) |
| Загруженные файлы | Docker volume **`uploads`** → `/app/uploads/` в backend |

Таблицы: `users`, `texts`, `fonts`, `comparisons`, `presets`, `class_catalog` и др. — все в схеме `collations`.

Enum-типы (`userrole`, `comparisonalgorithm` и т.д.) лежат в схеме `public` — это особенность текущих миграций.

### Подключиться к БД

Порт PostgreSQL **не проброшен** наружу по умолчанию. Доступ через контейнер:

```bash
docker compose exec postgres psql -U postgres -d textologist_db
```

Примеры запросов:

```sql
\dt collations.*
SELECT id, username, role FROM collations.users;
```

### Обновление схемы БД (миграции)

Миграции Alembic применяются **автоматически** при каждом старте backend (`alembic upgrade head` в entrypoint).

После `git pull` с новыми миграциями:

```bash
docker compose up -d --build backend
docker compose logs backend   # убедиться, что миграции прошли без ошибок
```

Ручной запуск миграций (если нужно):

```bash
docker compose exec backend sh -c "cd backend && alembic upgrade head"
```

---

## Порты и CORS — важно

### Смена портов

В `.env`:

```env
FRONTEND_PORT=3001
BACKEND_PORT=8001
```

После изменения портов **обязательно** обновите связанные переменные:

```env
NEXT_PUBLIC_API_URL=http://localhost:8001
CORS_ORIGINS=http://localhost:3001
```

`NEXT_PUBLIC_API_URL` вшивается в frontend **на этапе сборки**. После его изменения:

```bash
docker compose build frontend
docker compose up -d
```

Backend подхватывает `CORS_ORIGINS` при перезапуске:

```bash
docker compose up -d backend
```

### Типичная ошибка: «не могу залогиниться»

Backend принимает логин/пароль, но браузер блокирует запрос из-за CORS, если:

- frontend открыт на `http://localhost:3000`, а в `.env` указано `CORS_ORIGINS=http://localhost:3001` (или наоборот).

**Правило:** `CORS_ORIGINS` должен **точно совпадать** с origin в адресной строке браузера (протокол + хост + порт).

### Конфликт портов

Не запускайте одновременно Docker и локальный dev-сервер на одних портах:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

Остановите локальный `npm run dev` / `uvicorn`, либо смените порты в `.env`.

---

## Обновление на сервере / после git pull

```bash
git pull
docker compose up -d --build
docker compose ps
```

Если менялся только backend (без frontend env):

```bash
docker compose up -d --build backend
```

Файл `.env` **не коммитится** — на каждой машине/сервере создаётся локально из `.env.example`.

---

## Локальная разработка без Docker

### Backend

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt

export DATABASE_URL="postgresql://postgres:postgres@localhost/textologist_db"
export SECRET_KEY="$(openssl rand -hex 32)"
export DB_SCHEMA="collations"

cd backend && alembic upgrade head
cd ..
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

> Docker-база и локальный PostgreSQL — **разные** хранилища. Данные не синхронизируются автоматически.

---

## Переменные окружения (.env)

Полный шаблон — в [`.env.example`](.env.example). Файл `.env` добавлен в `.gitignore` и не попадает в репозиторий.

---

## API

Swagger UI (при запущенном backend): http://localhost:8000/docs

## Реализованный функционал

- Auth (Login; регистрация отключена, пользователи через скрипт)
- Загрузка текстов (.docx / .txt)
- Загрузка шрифтов (.ttf / .otf / .woff)
- Сравнения (word-level diff + char-level atomic ops)
- Статистика, пресеты, матрица расстояний, классы

---

## Дополнительная документация

- [`docs/TECH_SPEC.md`](docs/TECH_SPEC.md) — техническое задание
- [`docs/database_schema_description.txt`](docs/database_schema_description.txt) — описание схемы БД

## Импорт и названия сравнений

На Dashboard рядом с New и Saved доступна кнопка **Import JSON**. Она принимает
массив операций в формате существующего Export JSON (до 10 МБ и 50 000 операций).
Сравнение сразу сохраняется в History и открывается без повторного расчёта.
Название по умолчанию берётся из имени файла.

Экспорт содержит операции, но не исходные документы, их названия или настройки
расчёта. При импорте из операций восстанавливаются два текста: `<имя файла> — Base text`
и `<имя файла> — Other text`. Они появляются в Texts и доступны для новых сравнений.
Слова сохраняются в порядке операций, включая повторы и Unicode; между ними
вставляется один пробел. Абзацы первого текста восстанавливаются по доступной
разметке, второго — приблизительно по разметке первого. Исходные пробелы и пустые
абзацы формат JSON не хранит. Содержимое восстановленных текстов хранится в БД.
Идентификаторы операций выдаются заново. Для каждого указанного в файле `class_id` создаётся отдельный
личный класс `Imported class #<id>`: название класса в этом формате отсутствует,
а числовые ID из другой базы нельзя связывать с местными классами. Все назначения
классов, порядок операций, Unicode-текст и индексы абзацев сохраняются.

В **History** кнопка **Rename** позволяет изменить название сравнения (1–200
символов). **Save** или Enter сохраняют его, **Cancel** или Escape отменяют ввод.
Названия исходных текстов при этом не меняются.

После обновления выполните `docker compose up -d --build`: миграция для названий
и импортированных сравнений применяется автоматически. Откат этой миграции
возможен только при отсутствии сравнений без исходных документов.

Проверки импорта и переименования на локальной базе (данные тестов откатываются):

```bash
docker compose exec backend python -m unittest discover -s backend/tests -v
```

## Шрифт сравнения и названия текстов

На странице результата **Display font** позволяет выбрать загруженный шрифт или
**Default font**. Выбор сохраняется для сравнения и действует после перезагрузки.
Он не меняет операции, классы и несохранённые правки. **Manage fonts** открывает
загрузку шрифтов.

В **Texts** кнопка **Rename** меняет название документа (1–200 символов): **Save**
или Enter сохраняют, **Cancel** или Escape отменяют. Новое название отображается
в связанных сравнениях и в истории; содержимое текста не меняется.

Для сравнений, импортированных до появления восстановления текстов, однократно
выполните после обновления backend:

```bash
docker compose exec backend python -m backend.restore_imported_texts
```

Команда добавляет оба текста только сравнениям без исходных документов; повторный
запуск не создаёт дубликаты и не перезаписывает переименованные тексты.

### Word-change classes

Click a changed word (replacement, insertion or deletion) to open its classification
sidebar. Choose **Без класса** to clear a classification, or create and assign a
word class directly in the sidebar. `/classes` separates word and character
classes; existing classes remain character classes after migration.

A classified word has an underline in its class color. The `i` marker in the left
margin opens all classified word changes on that rendered line; markers follow
line wrapping and font changes. Unclassified changes keep their underline the
same color as their background. Normal classification saves immediately. After
structural edits in Edit Mode, use **Save to History** to persist operations and
classifications together. Newly split/merged operations start unclassified.

JSON remains an array of word operations. Each word operation adds nullable
`class_id` and `word_class` (`code`, `display_name`, `color_hex`) fields. Imports
remap source IDs into private word classes, preserving names and colors; word and
character class IDs are mapped separately. Older JSON files remain supported and
start without word classes. `null` represents **Без класса**.

Migration `f2c8a6d91b40` adds the class kind and optional word class reference.
Integration checks: `python -m unittest discover -s backend/tests -v` inside the
backend container (each test rolls its database changes back).

### Insignificant word changes

The mandatory global word class **Несущественные изменения** is identified by
`system_key: "insignificant"` (not its translated name or database ID). Migration
`b7d930e5a612` installs it for all existing and future users; it cannot be hidden
or overridden. Ordinary classes with the same name have no special behavior.

* Replacements render their original word in black, with a separate `i` above.
  Its read-only popup preserves the original replacement and character badges.
  Click the black word to change its class and restore the editable full view.
* Insertions/deletions leave zero-width anchors and move into a separate margin
  `i`. The popup shows each hidden change with its preceding/following word within
  the same paragraph and a class selector to restore it. If a line also has normal
  word-class notes, both margin buttons are shown.
* Hiding changes only presentation. Word operations, character classifications,
  order, source texts and comparison statistics are retained. JSON includes the
  system key and imports map it to the local built-in class without duplication.

Click a number in the comparison's left margin to mark all changed word operations
in that numbered fragment as insignificant. Numbers identify original paragraph
blocks, including any visual line wraps. Unchanged words and character classes
are preserved. Saved operations are updated atomically in one request; after
structural editing, the action updates the pending operations and **Save to
History** persists them. Empty/already-insignificant fragments show a disabled
action with an explanation.

### Adjacent transpositions (Tr)

All three Levenshtein variants support exact adjacent word swaps using a restricted
OSA transition. A pair is one `transpose` operation with two preserved replacement
`transpose_parts`. Click either word to select/classify the entire light-violet
pair. `r1.1`/`r1.2` labels identify its members and `(Tr)` follows the pair.

In Edit Mode, select two adjacent exact crossed replacements to merge them into a
transposition, or select a transposition to split it into replacements. Character
annotations survive the round trip; changed pair classes propagate on splitting.
Undo/redo restores manual edit states during the current session. Save and JSON
preserve the parts, including their classes. Hidden insignificant pairs retain both
original words and expose a read-only preview via `i`.

The transpose weight defaults to 1 (scaled by normalized word difference in Nested).
The distance matrix uses the same costs as alignment. Statistics count one pair as
one transposition. Existing comparisons are not recomputed by the migration.
See [examples, complexity and local timing](docs/transposition-examples.md).

Validation: backend unittest discovery includes algorithm, persistence and fixture
checks. Compile `frontend/app/utils/wordOpLogic.ts` with TypeScript to
`/tmp/textologist-word-logic`, then run `node frontend/tests/transposition.test.cjs`
for the reversible editor transitions.

## Управление аккаунтами

Роли: `admin` и `user`. По умолчанию новые аккаунты получают `user`; существующие обычные аккаунты мигрируют с `textologist` на `user`. Стартовый администратор сохраняет роль `admin` и после переименования.

У администратора на главной и в навигации доступен раздел «Пользователи» (`/users`). Он может создать аккаунт с логином и паролем, изменить логин и установить новый пароль. Пустое поле нового пароля сохраняет прежний. Пароли и хеши не возвращаются в списке пользователей.

Административные API `/users/` защищены проверкой роли из базы. При изменении логина или пароля старые сессии этого аккаунта перестают действовать; остальные пользователи продолжают работать. Если администратор меняет свои данные, ему нужно войти заново. Миграция на версию токенов с ID аккаунта также требует повторного входа для старых сессий.
