import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../app/AuthContext";
import { userErrorMessage } from "../app/api/errors";
import {
  createMaxLinkCode,
  getMaxIdentityStatus,
  unlinkMaxIdentity,
  type MaxLinkCode
} from "../app/api/max-identity-api";
import { useMaxBridge } from "../app/max/context";
import { buildMaxLinkUrl } from "../app/max/deepLink";
import { LocalQrCode } from "../widgets/LocalQrCode";
import { Button } from "../shared/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "../shared/ui/alert-dialog";

export function MaxLinkPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { signOut } = useAuth();
  const { isMax } = useMaxBridge();
  const [linkCode, setLinkCode] = useState<MaxLinkCode | null>(null);
  const [now, setNow] = useState(Date.now());
  const status = useQuery({ queryKey: ["identity", "max"], queryFn: getMaxIdentityStatus });
  const unlink = useMutation({
    mutationFn: unlinkMaxIdentity,
    onSuccess: async () => {
      setLinkCode(null);
      if (isMax) {
        await signOut();
        navigate("/login", { replace: true });
      } else {
        await queryClient.invalidateQueries({ queryKey: ["identity", "max"] });
        toast.success("MAX отвязан от учётной записи.");
      }
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось отвязать MAX."))
  });
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
          <h1>MAX и вход</h1>
          {status.data && (
            <p className="muted">
              {status.data.connected ? "MAX подключён к этому аккаунту" : "MAX пока не подключён"}
            </p>
          )}
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

      {status.data?.connected && (
        <section className="max-link-unlink">
          <h2>Сменить привязку</h2>
          <p className="muted">
            После отвязки вход через MAX в этот аккаунт перестанет работать. В браузере сохраняется
            вход по email и паролю.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" disabled={unlink.isPending}>
                Отвязать MAX
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Отвязать MAX от этого аккаунта?</AlertDialogTitle>
                <AlertDialogDescription>
                  Для повторного подключения потребуется новый код из кабинета или вход по email и
                  паролю в MAX.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Оставить привязку</AlertDialogCancel>
                <AlertDialogAction onClick={() => unlink.mutate()}>Отвязать MAX</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>
      )}
    </div>
  );
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
