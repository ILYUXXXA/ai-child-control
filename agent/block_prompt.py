"""
Модуль запроса разрешения перед блокировкой.
Этот файл можно удалить — тогда блокировка будет происходить автоматически.
"""

import tkinter as tk
from tkinter import messagebox

def request_block_permission(reason: str, threat_type: str) -> bool:
    """
    Запрашивает у пользователя разрешение на блокировку.
    Возвращает:
    - True: пользователь ОТКАЗАЛСЯ от блокировки (действие НЕ выполнять)
    - False: пользователь РАЗРЕШИЛ блокировку (можно блокировать)
    """
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    
    answer = messagebox.askyesno(
        "CyberParent AI — Запрос блокировки",
        f"⚠️ Обнаружена угроза!\n\n"
        f"Тип: {threat_type}\n"
        f"Причина: {reason}\n\n"
        f"Заблокировать?",
        icon='warning'
    )
    
    root.destroy()
    return not answer  # True = отказ, False = разрешить


# Если файл удалён — автоматическая блокировка
def __getattr__(name):
    if name == 'request_block_permission':
        return lambda reason, threat_type: False  # Автоматическая блокировка
    raise AttributeError(name)