"""
CyberParent AI — Desktop Screen Monitor Agent
Captures screenshots, sends them to the Cloudflare Worker for analysis,
and takes protective action if a threat is detected.
"""

import base64
import json
import logging
import os
import sys
import threading
import time
from io import BytesIO
from pathlib import Path
from typing import Optional

import pyautogui
import requests
from PIL import Image, ImageDraw, ImageFont

# ─── Config ──────────────────────────────────────────────────────────────────

CONFIG_PATH = Path(__file__).parent / "config.json"

DEFAULT_CONFIG = {
    "worker_url": "https://cyberparent.workers.dev",
    "device_id": "child-pc-1",
    "interval_seconds": 1.5,
    "jpeg_quality": 70,
    "cache_ttl_seconds": 5,
    "log_file": "monitor.log",
    "hotkey_stop": "ctrl+shift+q",
}


def load_config() -> dict:
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
        return {**DEFAULT_CONFIG, **cfg}
    return DEFAULT_CONFIG.copy()


# ─── Logging ─────────────────────────────────────────────────────────────────

def setup_logging(log_file: str) -> logging.Logger:
    logger = logging.getLogger("cyberparent")
    logger.setLevel(logging.INFO)

    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%Y-%m-%d %H:%M:%S")

    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    logger.addHandler(sh)

    return logger


# ─── Screenshot helpers ───────────────────────────────────────────────────────

def capture_screenshot(quality: int = 70) -> str:
    """Capture screen, compress to JPEG, return base64 string (with data URI prefix)."""
    img = pyautogui.screenshot()
    # Resize to max 1280px wide to reduce payload
    max_width = 1280
    if img.width > max_width:
        ratio = max_width / img.width
        img = img.resize((max_width, int(img.height * ratio)), Image.LANCZOS)

    buf = BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality, optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/jpeg;base64,{b64}"


# ─── UI feedback (cross-platform, minimal) ───────────────────────────────────

def show_block_overlay():
    """Show a full-screen red warning and close the active window."""
    try:
        # Close active window (Windows + Linux)
        if sys.platform == "win32":
            import ctypes
            hwnd = ctypes.windll.user32.GetForegroundWindow()
            ctypes.windll.user32.PostMessageW(hwnd, 0x0010, 0, 0)  # WM_CLOSE
        else:
            pyautogui.hotkey("alt", "F4")
    except Exception:
        pass

    # Show a temporary overlay image
    try:
        screen_w, screen_h = pyautogui.size()
        overlay = Image.new("RGB", (screen_w, screen_h), color=(220, 30, 30))
        draw = ImageDraw.Draw(overlay)
        msg = "ДОСТУП ЗАБЛОКИРОВАН\nCyberParent AI обнаружил угрозу"
        try:
            font = ImageFont.truetype("arial.ttf", 48)
        except Exception:
            font = ImageFont.load_default()
        draw.text((screen_w // 2 - 300, screen_h // 2 - 60), msg, fill="white", font=font)
        overlay.show()
    except Exception:
        pass


def show_toast(message: str):
    """Show a desktop notification toast."""
    try:
        if sys.platform == "win32":
            # Windows: use pyautogui's alert or ctypes balloon
            from ctypes import windll
            windll.user32.MessageBoxW(None, message, "CyberParent AI — Предупреждение", 0x40 | 0x1000)
        elif sys.platform == "darwin":
            os.system(f'osascript -e \'display notification "{message}" with title "CyberParent AI"\'')
        else:
            os.system(f'notify-send "CyberParent AI" "{message}" --urgency=critical 2>/dev/null || true')
    except Exception:
        pass


# ─── Worker API client ────────────────────────────────────────────────────────

class WorkerClient:
    def __init__(self, worker_url: str, device_id: str, timeout: int = 10):
        self.url = worker_url.rstrip("/") + "/analyze-screenshot"
        self.device_id = device_id
        self.timeout = timeout

    def analyze(self, screenshot_b64: str) -> Optional[dict]:
        payload = {
            "screenshot_base64": screenshot_b64,
            "timestamp": int(time.time()),
            "device_id": self.device_id,
        }
        resp = requests.post(self.url, json=payload, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()


# ─── Cache ───────────────────────────────────────────────────────────────────

class ResultCache:
    def __init__(self, ttl: float):
        self._ttl = ttl
        self._value: Optional[dict] = None
        self._expires: float = 0.0
        self._lock = threading.Lock()

    def get(self) -> Optional[dict]:
        with self._lock:
            if self._value and time.monotonic() < self._expires:
                return self._value
        return None

    def set(self, value: dict):
        with self._lock:
            self._value = value
            self._expires = time.monotonic() + self._ttl


# ─── Monitor loop ─────────────────────────────────────────────────────────────

class ScreenMonitor:
    def __init__(self, config: dict, logger: logging.Logger):
        self.cfg = config
        self.log = logger
        self.client = WorkerClient(config["worker_url"], config["device_id"])
        self.cache = ResultCache(config["cache_ttl_seconds"])
        self._stop_event = threading.Event()

    def stop(self):
        self.log.info("Stop signal received. Shutting down.")
        self._stop_event.set()

    def _handle_action(self, result: dict):
        action = result.get("action", "allow")
        risk = result.get("risk", 0)
        reason = result.get("reason", "")
        threat_type = result.get("threat_type", "safe")
        
        if action == "block":
            # Проверяем, не является ли угроза ложной (например, сам агент)
            if "CyberParent" in reason or "монитор" in reason or "агент" in reason:
                self.log.info("Skipping false-positive block: agent self-detection")
                return
                
            # Запрос разрешения перед блокировкой
            self.log.warning("BLOCK requested — risk=%d type=%s reason=%s", risk, threat_type, reason)
            
            # Показываем диалог запроса разрешения
            if self._request_permission(reason, threat_type):
                self.log.info("User denied block action")
                return
            
            # Если пользователь разрешил блокировку
            show_block_overlay()
            
        elif action == "warn":
            self.log.warning("WARN — risk=%d type=%s reason=%s", risk, threat_type, reason)
            msg = f"Подозрительная активность ({risk}%): {reason}"
            # Показываем предупреждение без блокировки
            show_toast(msg)
        else:
            self.log.debug("ALLOW — risk=%d", risk)

    def _request_permission(self, reason: str, threat_type: str) -> bool:
        """Запрашивает у пользователя разрешение на блокировку.
        Возвращает True, если блокировать НЕ нужно (пользователь отклонил),
        False — если блокировать можно."""
        import tkinter as tk
        from tkinter import messagebox
        
        # Создаём временное окно
        root = tk.Tk()
        root.withdraw()  # Скрываем главное окно
        root.attributes('-topmost', True)  # Поверх всех окон
        
        # Диалог с вопросом
        answer = messagebox.askyesno(
            "CyberParent AI — Запрос блокировки",
            f"⚠️ Обнаружена потенциальная угроза!\n\n"
            f"Тип: {threat_type}\n"
            f"Описание: {reason}\n\n"
            f"Заблокировать это действие?",
            icon='warning'
        )
        
        root.destroy()
        
        # Возвращаем True, если пользователь сказал "НЕТ" (не блокировать)
        return not answer

    def run(self):
        self.log.info("CyberParent AI monitor started. Device: %s", self.cfg["device_id"])
        self.log.info("Worker: %s", self.cfg["worker_url"])
        self.log.info("Press %s to stop.", self.cfg["hotkey_stop"])

        # Register global hotkey for stopping
        try:
            import keyboard
            keyboard.add_hotkey(self.cfg["hotkey_stop"], self.stop)
            self.log.info("Hotkey registered: %s", self.cfg["hotkey_stop"])
        except Exception as e:
            self.log.warning("Could not register hotkey (%s). Use Ctrl+C to stop.", e)

        interval = self.cfg["interval_seconds"]
        quality = self.cfg["jpeg_quality"]

        consecutive_errors = 0

        while not self._stop_event.is_set():
            loop_start = time.monotonic()

            # Check cache first
            cached = self.cache.get()
            if cached:
                self.log.debug("Using cached result (risk=%d)", cached.get("risk", 0))
                time.sleep(max(0, interval - (time.monotonic() - loop_start)))
                continue

            try:
                screenshot_b64 = capture_screenshot(quality)
                result = self.client.analyze(screenshot_b64)

                if result and "risk" in result:
                    self.cache.set(result)
                    self._handle_action(result)
                    consecutive_errors = 0
                else:
                    self.log.warning("Unexpected response from worker: %s", result)

            except requests.exceptions.ConnectionError:
                consecutive_errors += 1
                if consecutive_errors <= 3 or consecutive_errors % 30 == 0:
                    self.log.error("No internet connection (attempt %d)", consecutive_errors)
            except requests.exceptions.Timeout:
                consecutive_errors += 1
                self.log.error("Worker request timed out (attempt %d)", consecutive_errors)
            except requests.exceptions.HTTPError as e:
                consecutive_errors += 1
                self.log.error("Worker HTTP error: %s (attempt %d)", e, consecutive_errors)
            except Exception as e:
                consecutive_errors += 1
                self.log.exception("Unexpected error (attempt %d): %s", consecutive_errors, e)

            # Back-off on repeated errors (max 30s)
            if consecutive_errors > 0:
                sleep_time = min(30.0, interval * consecutive_errors)
            else:
                sleep_time = interval

            elapsed = time.monotonic() - loop_start
            time.sleep(max(0, sleep_time - elapsed))

        self.log.info("Monitor stopped.")


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    cfg = load_config()
    logger = setup_logging(cfg["log_file"])
    monitor = ScreenMonitor(cfg, logger)
    try:
        monitor.run()
    except KeyboardInterrupt:
        monitor.stop()