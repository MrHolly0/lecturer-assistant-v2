import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Download, PackageOpen, RefreshCw, WifiOff } from "lucide-react";
import { toast } from "sonner";
import {
  acknowledgeInstallationUpdate,
  cancelInstallationUpdate,
  getInstallationStatus,
  requestInstallationUpdate
} from "../app/api/installation-api";
import { userErrorMessage } from "../app/api/errors";
import { PendingOperationKey } from "../app/api/operation-key";
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

const STAGES: Record<string, string> = {
  QUEUED: "В очереди",
  CLAIMED: "Подготовка",
  WAITING: "Ожидаем завершения занятий",
  BACKING_UP: "Создаём резервную копию",
  APPLYING: "Устанавливаем версию",
  VERIFYING: "Проверяем приложение",
  SUCCEEDED: "Обновлено",
  FAILED: "Остановлено",
  CANCELLED: "Отменено",
  NEEDS_ATTENTION: "Требуется проверка"
};
function time(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(value))
    : "Не было подключения";
}
export function InstallationUpdatesPage() {
  const qc = useQueryClient();
  const operation = useRef(new PendingOperationKey());
  const query = useQuery({
    queryKey: ["installation-updates"],
    queryFn: getInstallationStatus,
    refetchInterval: 5000,
    meta: { connectionSync: true }
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["installation-updates"] });
  };
  const start = useMutation({
    mutationFn: (releaseId: string) =>
      operation.current.run({ releaseId }, (key) => requestInstallationUpdate(releaseId, key)),
    onSuccess: () => {
      refresh();
      toast.success("Обновление добавлено в очередь");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось запросить обновление"))
  });
  const cancel = useMutation({
    mutationFn: cancelInstallationUpdate,
    onSuccess: refresh,
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось отменить запрос"))
  });
  const acknowledge = useMutation({
    mutationFn: acknowledgeInstallationUpdate,
    onSuccess: refresh,
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось завершить проверку"))
  });
  const [checking, setChecking] = useState(false);
  const checkStatus = async () => {
    setChecking(true);
    try {
      await query.refetch();
    } finally {
      setChecking(false);
    }
  };
  const data = query.data;
  const current = data?.jobs.find((job) =>
    ["QUEUED", "RUNNING", "NEEDS_ATTENTION"].includes(job.status)
  );
  const online = Boolean(
    data?.operatorSeenAt && Date.now() - Date.parse(data.operatorSeenAt) < 90_000
  );
  const lastSuccess = data?.jobs.find((job) => job.status === "SUCCEEDED");
  return (
    <div className="page installation-updates-page">
      <div className="page-header">
        <div>
          <h1>Обновления приложения</h1>
          <p className="muted">Версии и обслуживание установки учреждения</p>
        </div>
        <Button
          variant="outline"
          disabled={checking || query.isLoading}
          onClick={() => void checkStatus()}
        >
          <RefreshCw aria-hidden="true" />
          {checking || query.isLoading ? "Проверяем…" : "Проверить состояние"}
        </Button>
      </div>
      {query.isError && data && (
        <p className="installation-update-notice" role="status">
          Сервер временно недоступен. Показываем последнее состояние; проверка продолжится
          автоматически.
        </p>
      )}
      {query.isLoading ? (
        <section className="installation-loading" role="status">
          <span>Проверяем установку…</span>
          <div aria-hidden="true" />
          <div aria-hidden="true" />
        </section>
      ) : !data ? (
        <section className="installation-setup installation-load-error" role="alert">
          <AlertCircle className="installation-setup__icon" aria-hidden="true" />
          <div>
            <h2>Не удалось проверить установку</h2>
            <p>
              Повторите проверку. Если ошибка сохранится, обратитесь к системному администратору.
            </p>
            <Button
              variant="outline"
              disabled={checking || query.isLoading}
              onClick={() => void checkStatus()}
            >
              Повторить
            </Button>
          </div>
        </section>
      ) : !data.enabled ? (
        <section className="installation-setup" aria-labelledby="installation-setup-title">
          <PackageOpen className="installation-setup__icon" aria-hidden="true" />
          <div>
            <span className="installation-state-label">Нужна настройка</span>
            <h2 id="installation-setup-title">Подключите обновления</h2>
            <p>
              Попросите системного администратора настроить установку. После этого новые версии
              приложения можно будет устанавливать прямо здесь.
            </p>
            <details className="installation-setup__details">
              <summary>Что нужно настроить</summary>
              <p>
                Подключить службу обновлений и доверенный ключ релизов. Для новой установки
                используется единый пакет Docker с Kubernetes внутри.
              </p>
            </details>
            <p className="installation-setup__footnote muted">
              Перед обновлением система дождётся завершения занятий и создаст резервную копию.
            </p>
          </div>
        </section>
      ) : (
        <>
          <div className="installation-update-status">
            <div>
              <span className="installation-status-caption">Служба обновлений</span>
              <strong className="installation-connection">
                {online ? <CheckCircle2 aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
                {online ? "На связи" : "Нет связи"}
              </strong>
              <p className="muted">
                {data.operatorSeenAt
                  ? `Последняя связь: ${time(data.operatorSeenAt)}`
                  : "Ожидаем подключения"}
                {data.operatorKind === "kubernetes"
                  ? " · Kubernetes"
                  : data.operatorKind === "compose"
                    ? " · Docker Compose"
                    : ""}
              </p>
            </div>
            <div>
              <span className="installation-status-caption">Занятия сейчас</span>
              <strong>
                {data.activeLessons
                  ? `Идут занятия: ${data.activeLessons}`
                  : "Активных занятий нет"}
              </strong>
              <p className="muted">Установка начнётся, когда все занятия завершатся.</p>
            </div>
          </div>
          {current && (
            <section className="installation-current-job" aria-live="polite">
              <p className="muted">Обновление {current.releaseId}</p>
              <h2>
                {STAGES[current.status === "NEEDS_ATTENTION" ? current.status : current.stage] ??
                  current.stage}
              </h2>
              <p>{current.summary || "Оператор примет запрос автоматически."}</p>
              {current.maintenanceUntil && current.status === "RUNNING" && (
                <p className="muted">
                  Новые занятия временно не запускаются. Данные занятий сохраняются.
                </p>
              )}
              {(current.status === "QUEUED" || ["CLAIMED", "WAITING"].includes(current.stage)) &&
                current.status !== "NEEDS_ATTENTION" && (
                  <Button
                    variant="outline"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(current.id)}
                  >
                    Отменить ожидание
                  </Button>
                )}
              {current.status === "NEEDS_ATTENTION" && (
                <>
                  <p>
                    Автоматическое продолжение остановлено. Системному администратору нужно
                    проверить работающие версии и резервную копию. Автоматического восстановления
                    старой БД нет.
                  </p>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline">Завершить ручную проверку</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Установка проверена?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Подтвердите это после проверки сервисов системным администратором.
                          Действие снимет блокировку очереди и не изменит данные или версии
                          приложения.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Вернуться</AlertDialogCancel>
                        <AlertDialogAction
                          disabled={acknowledge.isPending}
                          onClick={() => acknowledge.mutate(current.id)}
                        >
                          Да, установка проверена
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </section>
          )}
          <section className="installation-releases">
            <h2>Доступные версии</h2>
            <p className="muted">
              До установки создаётся резервная копия. Сервисы могут кратковременно перезапуститься.
            </p>
            {data.catalogError && (
              <p className="form-error" role="alert">
                {data.catalogError}
              </p>
            )}
            {!online && data.releases.length > 0 && (
              <p className="installation-update-notice">
                Установка станет доступна, когда служба обновлений снова выйдет на связь.
              </p>
            )}
            {!data.releases.length && (
              <p className="muted">
                Проверенных релизов пока нет. Каталог обновляется оператором автоматически.
              </p>
            )}
            {data.releases.map((release) => (
              <article className="installation-release" key={release.id}>
                <div className="installation-release__content">
                  <h3>{release.version}</h3>
                  <p className="installation-release__notes">{release.notes}</p>
                  <span className="muted">
                    Версия {release.commit.slice(0, 8)}
                    {lastSuccess?.releaseId === release.id
                      ? " · Последнее успешное обновление"
                      : ""}
                  </span>
                </div>
                <div className="installation-release__action">
                  <Button
                    disabled={
                      !online ||
                      Boolean(current) ||
                      start.isPending ||
                      lastSuccess?.releaseId === release.id ||
                      data.databaseVersion < release.databaseMin ||
                      data.databaseVersion > release.databaseMax
                    }
                    onClick={() => start.mutate(release.id)}
                  >
                    {lastSuccess?.releaseId === release.id ? (
                      <CheckCircle2 aria-hidden="true" />
                    ) : (
                      <Download aria-hidden="true" />
                    )}
                    {lastSuccess?.releaseId === release.id
                      ? "Установлено"
                      : data.activeLessons
                        ? "Обновить после занятий"
                        : "Установить обновление"}
                  </Button>
                  {(data.databaseVersion < release.databaseMin ||
                    data.databaseVersion > release.databaseMax) && (
                    <span className="muted">Нужна проверка совместимости администратором</span>
                  )}
                </div>
              </article>
            ))}
          </section>
          <section className="installation-history">
            <h2>История обновлений</h2>
            {data.jobs.length ? (
              <ol>
                {data.jobs.map((job) => (
                  <li key={job.id}>
                    <div>
                      <strong>{job.releaseId}</strong>
                      <p className="muted">{time(job.createdAt)}</p>
                    </div>
                    <span className="installation-state-label">
                      {STAGES[job.status === "RUNNING" ? job.stage : job.status] ?? job.status}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">Здесь появятся запросы и результаты обновлений.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
