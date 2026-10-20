import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Link2, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../app/AuthContext";
import { changePassword } from "../app/api/auth-api";
import { userErrorMessage } from "../app/api/errors";
import {
  createMaxLinkCode,
  getMaxIdentityStatus,
  unlinkMaxIdentity,
  type MaxLinkCode
} from "../app/api/max-identity-api";
import { useMaxBridge } from "../app/max/context";
import { buildMaxBotUrl, buildMaxLinkUrl } from "../app/max/deepLink";
import { LocalQrCode } from "../widgets/LocalQrCode";
import { AuthPasswordField } from "../widgets/AuthPasswordField";
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
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordChanged, setPasswordChanged] = useState(false);
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
      toast.success("Код подключения создан");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось получить код подключения."))
  });
  const passwordMut = useMutation({
    mutationFn: () => changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordChanged(true);
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось изменить пароль."))
  });
  const expiresAt = linkCode ? Date.parse(linkCode.expiresAt) : 0;
  const remainingSeconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const expired = Boolean(linkCode && remainingSeconds === 0);
  const maxUrl = useMemo(() => buildMaxLinkUrl(linkCode?.code ?? ""), [linkCode?.code]);

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("Новые пароли не совпадают.");
      return;
    }
    passwordMut.mutate();
  }

  useEffect(() => {
    if (!linkCode || expired) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expired, linkCode]);

  return (
    <div className="page max-link-page redesign-auth-settings">
      <div className="page-header">
        <div>
          <h1>MAX и вход</h1>
          <p className="muted">MAX подключается к вашему аккаунту</p>
          {status.data && (
            <p className="muted">
              {status.data.connected ? "MAX подключён к этому аккаунту" : "MAX пока не подключён"}
            </p>
          )}
        </div>
      </div>

      {status.isLoading && (
        <p className="muted" role="status">
          Проверяем подключение MAX…
        </p>
      )}
      {status.isError && (
        <div className="max-link-load-error action-message" role="alert">
          <p>Не удалось проверить подключение MAX.</p>
          <Button type="button" variant="outline" onClick={() => void status.refetch()}>
            Повторить
          </Button>
        </div>
      )}

      <section className="max-link-panel">
        <div className="max-link-copy">
          <h2 className="max-link-copy__heading">
            {status.data?.connected ? "MAX подключён" : "Подключите MAX"}
          </h2>
          <p className="muted">
            Получите одноразовый код, затем откройте ссылку или отсканируйте QR. Код действует 5
            минут.
          </p>
          <div className="max-link-actions">
            {(maxUrl || buildMaxBotUrl()) && (
              <Button asChild>
                <a href={maxUrl || buildMaxBotUrl() || undefined} target="_blank" rel="noreferrer">
                  <ExternalLink size={20} aria-hidden="true" /> Открыть MAX
                </a>
              </Button>
            )}
            {!linkCode && (
              <Button
                type="button"
                variant="outline"
                disabled={createCode.isPending}
                onClick={() => createCode.mutate()}
              >
                <Link2 size={20} aria-hidden="true" />
                {createCode.isPending ? "Получаем код…" : "Получить код подключения"}
              </Button>
            )}
          </div>
        </div>

        {linkCode && (
          <div className={`max-link-result ${expired ? "max-link-result--expired" : ""}`}>
            <div className="max-link-code" aria-label={`Код привязки ${linkCode.code}`}>
              {linkCode.code}
            </div>
            <p className="max-link-timer" role="timer">
              {expired
                ? "Срок действия кода истёк. Получите новый код."
                : `Осталось ${formatTime(remainingSeconds)}`}
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

      <section className="max-password-panel" aria-labelledby="max-password-title">
        <h2 id="max-password-title">Сменить пароль</h2>
        <p className="muted">
          После смены пароля потребуется снова войти на этом устройстве и в MAX.
        </p>
        <form className="max-password-form" onSubmit={submitPassword}>
          <AuthPasswordField
            label="Текущий пароль"
            name="currentPassword"
            value={currentPassword}
            onValueChange={setCurrentPassword}
            autoComplete="current-password"
            required
          />
          <AuthPasswordField
            label="Новый пароль"
            name="newPassword"
            value={newPassword}
            onValueChange={setNewPassword}
            autoComplete="new-password"
            required
            minLength={8}
          />
          <AuthPasswordField
            label="Повторите новый пароль"
            name="confirmPassword"
            value={confirmPassword}
            onValueChange={setConfirmPassword}
            autoComplete="new-password"
            required
            minLength={8}
          />
          {confirmPassword && newPassword !== confirmPassword && (
            <p className="form-error" role="alert">
              Новые пароли не совпадают.
            </p>
          )}
          <Button
            type="submit"
            variant="outline"
            disabled={passwordMut.isPending || newPassword !== confirmPassword}
          >
            {passwordMut.isPending ? "Сохраняем…" : "Сменить пароль"}
          </Button>
        </form>
      </section>

      <AlertDialog open={passwordChanged} onOpenChange={() => undefined}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Пароль изменён</AlertDialogTitle>
            <AlertDialogDescription>
              Все активные сессии завершены. Войдите снова с новым паролем.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                void signOut().finally(() => navigate("/login", { replace: true }));
              }}
            >
              Войти снова
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
