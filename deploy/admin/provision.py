#!/usr/bin/env python3
"""Create the first administrator through the loopback-only core port."""

import getpass
import json
import os
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]


def env_file_value(name: str) -> str:
    path = ROOT / ".env"
    if not path.exists():
        return ""
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith(f"{name}="):
            return line.partition("=")[2].strip().strip('"\'')
    return ""


def setting(name: str, default: str = "") -> str:
    return os.environ.get(name) or env_file_value(name) or default


def main() -> int:
    token = setting("ADMIN_SETUP_TOKEN")
    if len(token) < 32:
        print("Сначала задайте случайный ADMIN_SETUP_TOKEN в .env (например, openssl rand -hex 32).", file=sys.stderr)
        return 1

    name = input("Имя администратора: ").strip()
    email = input("Email администратора: ").strip()
    password = getpass.getpass("Пароль (не менее 8 символов): ")
    repeat = getpass.getpass("Повторите пароль: ")
    if len(name) < 2 or "@" not in email or len(password) < 8 or password != repeat:
        print("Проверьте имя, email и совпадение паролей.", file=sys.stderr)
        return 1

    port = setting("CORE_PORT", "8080")
    if not port.isdecimal() or not 1 <= int(port) <= 65535:
        print("Некорректный CORE_PORT.", file=sys.stderr)
        return 1
    url = f"http://127.0.0.1:{port}/api/v1/auth/bootstrap-admin"
    payload = json.dumps({"displayName": name, "email": email, "password": password}).encode("utf-8")
    request = Request(
        url,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "X-Admin-Setup-Token": token},
    )
    try:
        with urlopen(request, timeout=10) as response:
            if response.status != 200:
                print(f"Неожиданный ответ: {response.status}", file=sys.stderr)
                return 1
    except HTTPError as error:
        if error.code == 404:
            print("Core не получил установочный секрет. Проверьте .env и пересоздайте контейнер core.", file=sys.stderr)
        elif error.code == 409:
            print("В этой установке уже есть администратор.", file=sys.stderr)
        else:
            print(f"Создать администратора не удалось: HTTP {error.code}.", file=sys.stderr)
        return 1
    except URLError as error:
        print(f"Нет связи с локальным core: {error.reason}.", file=sys.stderr)
        return 1

    print(f"Администратор {email} создан. Удалите ADMIN_SETUP_TOKEN из .env и пересоздайте core.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
