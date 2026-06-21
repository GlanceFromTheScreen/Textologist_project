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
cd nir_2026_v2
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

### 3. Первый пользователь

Регистрация через UI **отключена**. Пользователей добавляют через скрипт:

```bash
docker compose exec backend python backend/create_user.py admin your_password admin
```

Роли: `admin` или `textologist`. Если пользователь уже существует — скрипт обновит пароль и роль.

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
export DB_SCHEMA="collations"
export SECRET_KEY="dev-secret"

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
