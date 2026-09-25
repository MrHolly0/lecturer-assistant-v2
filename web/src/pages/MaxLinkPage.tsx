import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link2, RefreshCw } from "lucide-react";
import { createMaxLinkCode, type MaxLinkCode } from "../app/api/max-identity-api";
import { buildMaxLinkUrl } from "../app/max/deepLink";
import { LocalQrCode } from "../widgets/LocalQrCode";
import { Button } from "../shared/ui/button";

export function MaxLinkPage() {
  const [linkCode, setLinkCode] = useState<MaxLinkCode | null>(null);
  const [now, setNow] = useState(Date.now());
  const createCode = useMutation({
    mutationFn: createMaxLinkCode,
    onSuccess: (created) => {
      setLinkCode(created);
      setNow(Date.now());
    }
  });
  const expiresAt = linkCode ? Date.parse(linkCode.expiresAt) : 0;
  const remainingSeconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const expired = Boolean(linkCode && remainingSeconds === 0);
  const maxUrl = useMemo(() => buildMaxLinkUrl(linkCode?.code ?? ""), [linkCode?.code]);

  useEffect(() => {
    if (!linkCode || expired) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expired, linkCode]);

  return (
    <div className="page max-link-page">
      <div className="page-header">
        <div>
          <span className="muted">Аккаунт преподавателя</span>
          <h1>Подключить MAX</h1>
        </div>
      </div>

      <section className="max-link-panel">
        <div className="max-link-copy">
          <h2 className="max-link-copy__heading">
            <Link2 size={22} aria-hidden="true" />
            Откройте кабинет преподавателя в MAX
          </h2>
          <p className="muted">
            Получите одноразовый код, затем откройте ссылку или отсканируйте QR. Код действует 5
            минут.
          </p>
          {!linkCode && (
            <Button
              type="button"
              disabled={createCode.isPending}
              onClick={() => createCode.mutate()}
            >
              Получить код
            </Button>
          )}
        </div>

        {linkCode && (
          <div className={`max-link-result ${expired ? "max-link-result--expired" : ""}`}>
            <div className="max-link-code" aria-label={`Код привязки ${linkCode.code}`}>
              {linkCode.code}
            </div>
            <p className="max-link-timer" role="timer">
              {expired ? "Срок действия кода истёк" : `Осталось ${formatTime(remainingSeconds)}`}
            </p>
            {maxUrl ? (
              <>
                <LocalQrCode value={maxUrl} label="Открыть привязку в MAX" />
                <a className="session-join-link" href={maxUrl} target="_blank" rel="noreferrer">
                  {maxUrl}
                </a>
              </>
            ) : (
              <p className="form-warning">
                Имя MAX-бота не настроено. Код можно ввести в мини-приложении вручную.
              </p>
            )}
            <Button
              variant="outline"
              type="button"
              disabled={createCode.isPending}
              onClick={() => createCode.mutate()}
            >
              <RefreshCw size={16} />
              Обновить код
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
