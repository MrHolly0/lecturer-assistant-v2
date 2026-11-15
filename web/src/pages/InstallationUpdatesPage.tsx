import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
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
  const data = query.data;
  if (query.isLoading)
    return (
      <div className="page" role="status">
        Проверяем установку…
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <h1>Обновления приложения</h1>
        <p className="form-error" role="alert">
          Не удалось получить состояние установки.
        </p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Повторить
        </Button>
      </div>
    );
  const current = data.jobs.find((job) =>
    ["QUEUED", "RUNNING", "NEEDS_ATTENTION"].includes(job.status)
  );
  const online = Boolean(
    data.operatorSeenAt && Date.now() - Date.parse(data.operatorSeenAt) < 90_000
  );
  const lastSuccess = data.jobs.find((job) => job.status === "SUCCEEDED");
  return (
    <div className="page installation-updates-page">
      <div className="page-header">
        <div>
          <h1>Обновления приложения</h1>
          <p className="muted">Версии и обслуживание установки учреждения</p>
        </div>
        <Button variant="outline" onClick={() => void query.refetch()}>
          <RefreshCw aria-hidden="true" /> Проверить состояние
        </Button>
      </div>
      {query.isError && (
        <p className="installation-update-notice" role="status">
          Сервер временно недоступен. Показываем последнее состояние; проверка продолжится
          автоматически.
        </p>
      )}
      {!data.enabled ? (
        <section>
          <h2>Настройка обновлений</h2>
          <p>
            Системному администратору нужно один раз подключить оператор установки и доверенный ключ
            релизов. После этого обновления можно запускать здесь.
          </p>
          <p className="muted">
            Поддерживаются установки Docker Compose и Kubernetes. GitLab не требуется.
          </p>
        </section>
      ) : (
        <>
          <div className="installation-update-status">
            <div>
              <strong>
                {data.operatorKind === "kubernetes"
                  ? "Kubernetes"
                  : data.operatorKind === "compose"
                    ? "Docker Compose"
                    : "Оператор не подключён"}
              </strong>
              <p className="muted">
                {online ? "Оператор на связи" : `Последняя связь: ${time(data.operatorSeenAt)}`}
              </p>
            </div>
            <div>
              <strong>Текущих занятий: {data.activeLessons}</strong>
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
            {!data.releases.length && (
              <p className="muted">
                Проверенных релизов пока нет. Каталог обновляется оператором автоматически.
              </p>
            )}
            {data.releases.map((release) => (
              <article className="installation-release" key={release.id}>
                <div>
                  <h3>{release.version}</h3>
                  <p className="installation-release__notes">{release.notes}</p>
                  <span className="muted">
                    Версия {release.commit.slice(0, 8)}
                    {lastSuccess?.releaseId === release.id
                      ? " · Последнее успешное обновление"
                      : ""}
                  </span>
                </div>
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
                  <Download aria-hidden="true" />
                  {data.activeLessons ? "Обновить после занятий" : "Установить обновление"}
                </Button>
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
                    <span>
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
