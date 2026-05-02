# CyberParent AI

Система родительского контроля на основе скриншотного анализа с ИИ.
Скриншоты **никогда не сохраняются** — родитель видит только текстовое описание угрозы.

## Архитектура

```
[Компьютер ребёнка]         [Облако]                   [Родитель]
┌──────────────────┐        ┌──────────────────────┐   ┌───────────────┐
│  screen_monitor  │─JPEG──▶│  Cloudflare Worker   │──▶│ Telegram Bot  │
│  (Python agent)  │◀─JSON──│  /analyze-screenshot │   │  уведомление  │
└──────────────────┘        └──────────┬───────────┘   └───────────────┘
   скриншот 1-2с                       │
   JPEG 70% качество                   ▼
   base64 payload             ┌─────────────────┐
                              │  Groq Vision AI │
                              │  llama-3.2-90b  │
                              └────────┬────────┘
                                       │ risk, threat_type, reason
                                       ▼
                              ┌─────────────────┐
                              │  Supabase DB    │ ◀── веб-дашборд
                              │  threat_events  │
                              └─────────────────┘
```

**Логика действий:**
- `risk ≥ 70%` → блокировка окна + Telegram-уведомление
- `risk 30–70%` → только Telegram-уведомление
- `risk < 30%` → тихо разрешено

## Структура проекта

```
cyberparent-ai/
├── agent/
│   ├── screen_monitor.py    # Python агент (pyautogui)
│   ├── requirements.txt
│   └── config.json          # настройки агента
├── worker/
│   ├── index.js             # Cloudflare Worker
│   └── wrangler.toml        # конфиг деплоя
├── bot/
│   ├── telegram_bot.py      # Telegram бот
│   ├── requirements.txt
│   └── database.db          # SQLite (создаётся автоматически)
└── src/                     # React дашборд (Vite)
    ├── App.tsx
    ├── components/
    └── lib/supabase.ts
```

## Шаг 1. Бесплатные регистрации (5 минут)

| Сервис | Ссылка | Что получить |
|--------|--------|-------------|
| Groq | https://console.groq.com | API Key `gsk_...` |
| Cloudflare | https://cloudflare.com | Workers + KV |
| Telegram | @BotFather → `/newbot` | Bot Token |
| Supabase | https://supabase.com | URL + Anon Key |

## Шаг 2. Cloudflare Worker

```bash
cd worker
npm install -g wrangler
npx wrangler kv:namespace create CYBERPARENT_KV
# Вставить полученный id в wrangler.toml

npx wrangler secret put GROQ_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID

npx wrangler deploy
# Запомнить URL: https://cyberparent.workers.dev
```

## Шаг 3. Python агент (компьютер ребёнка)

```bash
cd agent
pip install -r requirements.txt

# Отредактировать config.json:
# worker_url → URL из шага 2
# device_id  → имя устройства

python screen_monitor.py
# Остановка: Ctrl+Shift+Q
```

## Шаг 4. Telegram бот (сервер родителя или VPS)

```bash
cd bot
pip install -r requirements.txt

# В agent/config.json задать:
# telegram_bot_token → токен от @BotFather
# telegram_chat_id   → ваш chat ID (/start в боте)

python telegram_bot.py
```

Команды бота:
- `/start` — приветствие
- `/status` — текущий статус
- `/threshold 70` — изменить порог блокировки
- `/pause` — пауза на 1 час
- `/resume` — возобновить
- `/history` — последние 10 угроз

## Шаг 5. Веб-дашборд

```bash
# В корне проекта
cp .env.example .env
# Заполнить VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY

npm install
npm run dev
```

## API спецификация

### POST /analyze-screenshot

**Запрос:**
```json
{
  "screenshot_base64": "data:image/jpeg;base64,...",
  "timestamp": 1714390000,
  "device_id": "child-pc-1"
}
```

**Ответ:**
```json
{
  "risk": 87,
  "threat_type": "phishing",
  "reason": "сайт запрашивает CVV код",
  "location": "центр экрана, форма оплаты",
  "action": "block"
}
```

`action`: `"block"` | `"warn"` | `"allow"`

### GET /metrics?device_id=child-pc-1

```json
{
  "total": 1440,
  "threats": 12,
  "blocked": 3,
  "lastRisk": 15,
  "lastThreatType": "safe"
}
```

## Схема данных

### Хранится (только текст):
- `risk` — числовой балл 0–100
- `threat_type` — категория угрозы
- `reason` — описание до 100 символов
- `action` — принятое действие
- `timestamp` — время события

### Никогда не хранится:
- Сами скриншоты (base64 или файлы)
- Личные данные ребёнка
- Содержимое экрана

## Оценка нагрузки

| Параметр | Значение |
|----------|---------|
| Скриншотов в день | ~57 000 (1 кадр/1.5 с) |
| Размер одного запроса | ~50–150 КБ (JPEG 70%) |
| Трафик в сутки | ~5 ГБ |
| Groq API вызовов | ~57 000/день ≈ 40/мин |
| Cloudflare Workers лимит | 100 000 req/day (бесплатно) |
| Groq Vision лимит | 30 req/min (бесплатно) |

> При частоте 1 кадр/2 с нагрузка на Groq составит 30 req/мин — точно на лимите.
> Рекомендуется интервал 2+ секунды для стабильной работы.

## Приватность

- Скриншоты передаются только в Groq для анализа и сразу удаляются из памяти Worker
- В базе данных и KV хранятся исключительно текстовые метрики
- Родитель получает только текст угрозы, без изображений
