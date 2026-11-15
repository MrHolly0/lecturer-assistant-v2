import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "../app/api/http";
import { userErrorMessage } from "../app/api/errors";
import { Button } from "../shared/ui/button";

export function MessengerSettingsPage() {
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const create = useMutation({
    mutationFn: async () =>
      (await apiFetch("/identity/link-codes", { method: "POST" })).json() as Promise<{
        code: string;
        expiresAt: string;
      }>,
    onSuccess: setCode
  });
  return (
    <div className="page messenger-entry">
      <h1>Подключить мессенджер</h1>
      <p>
        Один аккаунт для MAX, Telegram, VK и браузера: группы и история занятий сохранятся при
        переходе между ними.
      </p>
      <ol>
        <li>Получите одноразовый код здесь.</li>
        <li>Откройте мини-приложение своего учреждения в Telegram или VK.</li>
        <li>Выберите подключение аккаунта и введите код.</li>
      </ol>
      <p className="muted">
        Для Telegram и VK администратор должен включить экспериментальный вход. Передавайте код
        только в мини-приложение учреждения.
      </p>
      <Button onClick={() => create.mutate()} disabled={create.isPending}>
        {create.isPending
          ? "Готовим код…"
          : code
            ? "Получить новый код"
            : "Получить код подключения"}
      </Button>
      {code && (
        <div className="group-format-check">
          <p>
            Одноразовый код: <strong className="messenger-link-code">{code.code}</strong>
          </p>
          <p className="muted">
            Действует до{" "}
            {new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(
              new Date(code.expiresAt)
            )}
            . Не публикуйте его в чатах.
          </p>
        </div>
      )}
      {create.isError && (
        <p className="form-error" role="alert">
          {userErrorMessage(create.error, "Не удалось получить код")}
        </p>
      )}
    </div>
  );
}
