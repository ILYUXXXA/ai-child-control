"""
CyberParent AI — Telegram Notification Bot
Receives threat alerts (called from the Cloudflare Worker via HTTP)
and provides a parent control interface.
"""

import asyncio
import json
import logging
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading
import signal

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    CallbackQueryHandler,
)
from telegram.constants import ParseMode

# Фикс для Windows — используем правильный event loop policy
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# ─── Logging ─────────────────────────────────────────────────────────────────

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
    handlers=[
        logging.FileHandler("bot.log", encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("cyberparent_bot")

# ─── Config ──────────────────────────────────────────────────────────────────

CONFIG_PATH = Path(__file__).parent.parent / "agent" / "config.json"

def load_config() -> dict:
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            return json.load(f)
    return {}

cfg = load_config()
BOT_TOKEN: str = cfg.get("telegram_bot_token", "")
WEBHOOK_SECRET: str = cfg.get("webhook_secret", "changeme")
WEBHOOK_PORT: int = int(cfg.get("webhook_port", 8080))

# ─── Database ─────────────────────────────────────────────────────────────────

DB_PATH = Path(__file__).parent / "database.db"


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                chat_id INTEGER PRIMARY KEY,
                threshold_warn INTEGER NOT NULL DEFAULT 30,
                threshold_block INTEGER NOT NULL DEFAULT 70,
                is_paused INTEGER NOT NULL DEFAULT 0,
                pause_until TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS threat_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                risk INTEGER NOT NULL,
                threat_type TEXT NOT NULL,
                reason TEXT NOT NULL,
                action TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        conn.commit()


def get_settings(chat_id: int) -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM settings WHERE chat_id = ?", (chat_id,)).fetchone()
        if row:
            return dict(row)
    return {"chat_id": chat_id, "threshold_warn": 30, "threshold_block": 70, "is_paused": 0, "pause_until": None}


def upsert_settings(chat_id: int, **kwargs):
    s = get_settings(chat_id)
    s.update(kwargs)
    with get_db() as conn:
        conn.execute("""
            INSERT INTO settings (chat_id, threshold_warn, threshold_block, is_paused, pause_until)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(chat_id) DO UPDATE SET
                threshold_warn = excluded.threshold_warn,
                threshold_block = excluded.threshold_block,
                is_paused = excluded.is_paused,
                pause_until = excluded.pause_until
        """, (s["chat_id"], s["threshold_warn"], s["threshold_block"], s["is_paused"], s["pause_until"]))
        conn.commit()


def log_threat(chat_id: int, risk: int, threat_type: str, reason: str, action: str):
    with get_db() as conn:
        conn.execute("""
            INSERT INTO threat_log (chat_id, risk, threat_type, reason, action)
            VALUES (?, ?, ?, ?, ?)
        """, (chat_id, risk, threat_type, reason, action))
        conn.commit()


def is_paused(chat_id: int) -> bool:
    s = get_settings(chat_id)
    if not s["is_paused"]:
        return False
    if s["pause_until"]:
        resume_at = datetime.fromisoformat(s["pause_until"])
        if datetime.now(timezone.utc) >= resume_at:
            upsert_settings(chat_id, is_paused=0, pause_until=None)
            return False
    return True


# ─── Alert sender ─────────────────────────────────────────────────────────────

def build_risk_bar(risk: int) -> str:
    filled = round(risk / 10)
    return "[" + "█" * filled + "░" * (10 - filled) + f"] {risk}%"


async def send_threat_alert(
    app: Application,
    chat_id: int,
    risk: int,
    threat_type: str,
    reason: str,
    location: str,
    action: str,
    timestamp: int,
):
    if is_paused(chat_id):
        log.info("Monitoring paused for chat %d, skipping alert.", chat_id)
        return

    s = get_settings(chat_id)
    if risk < s["threshold_warn"]:
        return

    log_threat(chat_id, risk, threat_type, reason, action)

    time_str = datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%H:%M:%S UTC")
    emoji = "🚨" if risk >= s["threshold_block"] else "⚠️"
    action_label = "ЗАБЛОКИРОВАНО" if action == "block" else "ПРЕДУПРЕЖДЕНИЕ"

    text = (
        f"{emoji} <b>CyberParent AI — {action_label}</b>\n\n"
        f"<code>{build_risk_bar(risk)}</code>\n"
        f"<b>Риск:</b> {risk}%\n"
        f"<b>Тип:</b> {threat_type}\n"
        f"<b>Причина:</b> {reason}\n"
        f"<b>Место:</b> {location}\n"
        f"<b>Время:</b> {time_str}"
    )

    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("🚫 Заблокировать", callback_data=f"block_{risk}"),
            InlineKeyboardButton("✅ Игнорировать", callback_data="ignore"),
        ]
    ])

    try:
        await app.bot.send_message(chat_id=chat_id, text=text, parse_mode=ParseMode.HTML, reply_markup=keyboard)
    except Exception as e:
        log.error(f"Failed to send message to {chat_id}: {e}")


# ─── Command handlers ─────────────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    upsert_settings(chat_id)
    text = (
        "👋 <b>CyberParent AI</b>\n\n"
        "Я буду сообщать вам об угрозах на устройстве ребёнка.\n\n"
        "<b>Команды:</b>\n"
        "/status — текущий статус мониторинга\n"
        "/threshold 70 — изменить порог блокировки\n"
        "/pause — приостановить на 1 час\n"
        "/resume — возобновить мониторинг\n"
        "/history — последние 10 угроз\n\n"
        f"<b>Ваш Chat ID:</b> <code>{chat_id}</code>\n"
        "Скопируйте его в <code>config.json</code> агента."
    )
    await update.message.reply_text(text, parse_mode=ParseMode.HTML)


async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    s = get_settings(chat_id)
    paused = is_paused(chat_id)
    status_icon = "⏸" if paused else "✅"
    pause_info = ""
    if paused and s["pause_until"]:
        pause_info = f"\nВозобновление: {s['pause_until']}"

    with get_db() as conn:
        total = conn.execute("SELECT COUNT(*) FROM threat_log WHERE chat_id = ?", (chat_id,)).fetchone()[0]
        today = conn.execute(
            "SELECT COUNT(*) FROM threat_log WHERE chat_id = ? AND date(created_at) = date('now')", (chat_id,)
        ).fetchone()[0]

    text = (
        f"{status_icon} <b>Статус мониторинга</b>\n\n"
        f"Состояние: {'Пауза' if paused else 'Активен'}{pause_info}\n"
        f"Порог предупреждения: {s['threshold_warn']}%\n"
        f"Порог блокировки: {s['threshold_block']}%\n"
        f"Угроз сегодня: {today}\n"
        f"Угроз всего: {total}"
    )
    await update.message.reply_text(text, parse_mode=ParseMode.HTML)


async def cmd_threshold(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    try:
        value = int(context.args[0])
        if not (1 <= value <= 99):
            raise ValueError("out of range")
        upsert_settings(chat_id, threshold_block=value)
        await update.message.reply_text(f"✅ Порог блокировки установлен: {value}%")
    except (IndexError, ValueError):
        await update.message.reply_text("Использование: /threshold 70  (1–99)")


async def cmd_pause(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    hours = 1
    if context.args:
        try:
            hours = max(1, min(24, int(context.args[0])))
        except ValueError:
            pass
    pause_until = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
    upsert_settings(chat_id, is_paused=1, pause_until=pause_until)
    await update.message.reply_text(f"⏸ Мониторинг приостановлен на {hours} ч.")


async def cmd_resume(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    upsert_settings(chat_id, is_paused=0, pause_until=None)
    await update.message.reply_text("▶️ Мониторинг возобновлён.")


async def cmd_history(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    with get_db() as conn:
        rows = conn.execute(
            "SELECT risk, threat_type, reason, action, created_at FROM threat_log "
            "WHERE chat_id = ? ORDER BY id DESC LIMIT 10",
            (chat_id,),
        ).fetchall()

    if not rows:
        await update.message.reply_text("История угроз пуста.")
        return

    lines = ["<b>Последние угрозы:</b>\n"]
    for r in rows:
        icon = "🚨" if r["action"] == "block" else "⚠️"
        lines.append(f"{icon} {r['created_at'][:16]} — {r['risk']}% {r['threat_type']}: {r['reason']}")

    await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.HTML)


async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data

    if data == "ignore":
        await query.edit_message_reply_markup(reply_markup=None)
        await query.message.reply_text("✅ Угроза проигнорирована.")
    elif data.startswith("block_"):
        risk = data.split("_")[1]
        await query.edit_message_reply_markup(reply_markup=None)
        await query.message.reply_text(f"🚫 Запрос на блокировку отправлен (риск {risk}%).")


# ─── Webhook HTTP server (receives calls from Worker) ────────────────────────

class WebhookHandler(BaseHTTPRequestHandler):
    app: Optional[Application] = None
    send_alert_callback = None  # Будет хранить асинхронную функцию

    def log_message(self, format, *args):
        log.debug("HTTP %s", format % args)

    def do_POST(self):
        if self.path != "/notify":
            self.send_response(404)
            self.end_headers()
            return

        secret = self.headers.get("X-Webhook-Secret", "")
        if secret != WEBHOOK_SECRET:
            self.send_response(403)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            data = json.loads(body)
        except Exception:
            self.send_response(400)
            self.end_headers()
            return

        chat_id = data.get("chat_id")
        if not chat_id:
            self.send_response(400)
            self.end_headers()
            return

        # Создаем новый event loop для этого запроса (работает в потоке)
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(
                send_threat_alert(
                    WebhookHandler.app,
                    int(chat_id),
                    int(data.get("risk", 0)),
                    str(data.get("threat_type", "safe")),
                    str(data.get("reason", "")),
                    str(data.get("location", "")),
                    str(data.get("action", "allow")),
                    int(data.get("timestamp", 0)),
                )
            )
            loop.close()
        except Exception as e:
            log.error(f"Webhook error: {e}")

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')


def start_webhook_server(app: Application):
    WebhookHandler.app = app
    server = HTTPServer(("0.0.0.0", WEBHOOK_PORT), WebhookHandler)
    log.info(f"Webhook server listening on port {WEBHOOK_PORT}")
    
    # Запускаем сервер в отдельном потоке
    def run_server():
        try:
            server.serve_forever()
        except Exception as e:
            log.error(f"Webhook server error: {e}")
    
    thread = threading.Thread(target=run_server, daemon=True)
    thread.start()
    return server


# ─── Main ─────────────────────────────────────────────────────────────────────

async def main():
    if not BOT_TOKEN:
        log.error("telegram_bot_token not set in config.json")
        return

    init_db()

    app = (
        Application.builder()
        .token(BOT_TOKEN)
        .build()
    )

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(CommandHandler("threshold", cmd_threshold))
    app.add_handler(CommandHandler("pause", cmd_pause))
    app.add_handler(CommandHandler("resume", cmd_resume))
    app.add_handler(CommandHandler("history", cmd_history))
    app.add_handler(CallbackQueryHandler(callback_handler))

    # Запускаем webhook сервер (в отдельном потоке)
    webhook_server = start_webhook_server(app)

    log.info("CyberParent Telegram bot started (polling).")
    
    # Обработка Ctrl+C
    stop_event = asyncio.Event()
    
    def signal_handler():
        asyncio.create_task(stop_event.set())
    
    # Настраиваем обработку сигналов
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            asyncio.get_event_loop().add_signal_handler(sig, signal_handler)
        except NotImplementedError:
            # Windows не поддерживает add_signal_handler
            pass
    
    try:
        # Запускаем polling
        await app.initialize()
        await app.start()
        await app.updater.start_polling()
        
        # Ждем сигнала остановки
        await stop_event.wait()
        
        log.info("Shutting down...")
        await app.updater.stop()
        await app.stop()
        await app.shutdown()
        webhook_server.shutdown()
    except KeyboardInterrupt:
        log.info("Received KeyboardInterrupt, shutting down...")
        webhook_server.shutdown()
    except Exception as e:
        log.error(f"Unexpected error: {e}")
        webhook_server.shutdown()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Bot stopped by user.")
    except Exception as e:
        log.error(f"Fatal error: {e}")