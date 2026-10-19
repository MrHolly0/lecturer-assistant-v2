import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Link2, Monitor, Play, RefreshCw, Shield, Square, Unplug } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../app/AuthContext";
import { getLiveSession } from "../app/api/live-api";
import {
  createProjectionPairing,
  getProjectionSettings,
  revokeProjectionDevice,
  saveProjectionPolicy,
  sendProjectionCommand,
  type ProjectionCommand,
  type ProjectionCommandRequest,
  type ProjectionDevice,
  type ProjectionPairing,
  type ProjectionPolicyUpdate
} from "../app/api/projection-api";
import { ApiError, userErrorMessage } from "../app/api/errors";
import { Button } from "../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";

const platformLabels: Record<ProjectionDevice["platform"], string> = {
  WINDOWS_X64: "Windows · x64",
  WINDOWS_ARM64: "Windows · ARM64",
  MACOS_X64: "macOS · Intel",
  MACOS_ARM64: "macOS · Apple Silicon"
};
const statusLabels: Record<ProjectionDevice["status"], string> = {
  IDLE: "Готов к команде",
  TESTING: "На экране проверочный код",
  SHOWING: "Идёт показ",
  PAUSED: "Показ на паузе",
  ERROR: "Нужна повторная проверка"
};
const versionPattern = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
const testCodePattern = /^[A-HJ-NP-Z2-9]{6}$/;

type HelperContext = { courseId: string; sessionId: string; active: boolean };

function HelperDeviceControls({
  device,
  context,
  allowed,
  fresh,
  onSent
}: {
  device: ProjectionDevice;
  context: HelperContext | null;
  allowed: boolean;
  fresh: boolean;
  onSent: () => void;
}) {
  const targetId = useId();
  const [target, setTarget] = useState("");
  const [test, setTest] = useState<{
    command: ProjectionCommand;
    screenId: string;
    topology: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const topology = JSON.stringify(
    [...device.screens].sort((left, right) => left.id.localeCompare(right.id))
  );
  const selected = device.screens.find((screen) => screen.id === target);
  const testCurrent = test?.screenId === target && test.topology === topology;
  const unavailable = !fresh || !device.connected || device.revoked;
  const canTest =
    !unavailable &&
    allowed &&
    !device.updateRequired &&
    context?.active &&
    selected &&
    !selected.isPrimary;
  const command = useMutation({
    mutationFn: (
      request: Omit<ProjectionCommandRequest, "deviceId" | "requestId" | "displayConfirmed"> & {
        displayConfirmed?: boolean;
      }
    ) => {
      if (!context) throw new Error("Сначала откройте настройку из занятия");
      return sendProjectionCommand(context.courseId, context.sessionId, {
        ...request,
        displayConfirmed: request.displayConfirmed ?? false,
        deviceId: device.id,
        requestId: crypto.randomUUID()
      });
    },
    onSuccess: (result) => {
      if (result.type === "TEST_TARGET") {
        setTest({ command: result, screenId: target, topology });
        setCode("");
        setConfirmed(false);
        setNotice("Команда проверки отправлена. Дождитесь кода на физическом проекторе.");
      } else if (result.type === "START_PUBLIC_PROJECTION") {
        setNotice("Команда показа отправлена. Статус обновится после ответа компонента.");
      } else if (result.type === "STOP_PROJECTION") {
        setTest(null);
        setCode("");
        setConfirmed(false);
        setNotice(
          "Команда остановки отправлена. Занятие продолжится; режим экранов сам не переключится."
        );
      } else {
        setNotice("Запрос обновлений отправлен. Во время показа компонент не будет перезапущен.");
      }
      onSent();
    }
  });
  const changeTarget = (value: string) => {
    setTarget(value);
    setTest(null);
    setCode("");
    setConfirmed(false);
    setNotice("");
    command.reset();
  };
  if (device.revoked) return null;
  return (
    <div className="projector-helper-controls">
      {!context ? (
        <p>Для проверки и показа откройте «Настройку проектора» из инструментов идущего занятия.</p>
      ) : (
        <>
          {!context.active && (
            <p>Занятие сейчас не идёт. Новый показ начнётся после его запуска.</p>
          )}
          <div className="projector-helper-target">
            <label htmlFor={targetId}>Экран для аудитории</label>
            <Select
              value={target || "__select_screen__"}
              onValueChange={(value) => changeTarget(value === "__select_screen__" ? "" : value)}
              disabled={command.isPending}
            >
              <SelectTrigger id={targetId} aria-describedby={`${targetId}-hint`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__select_screen__">Выберите экран явно</SelectItem>
                {device.screens.map((screen) => (
                  <SelectItem key={screen.id} value={screen.id}>
                    {screen.label || "Экран"} · {screen.width} × {screen.height}
                    {screen.isPrimary ? " · основной рабочий экран" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <small id={`${targetId}-hint`}>
              {device.screens.length === 0
                ? "Компонент ещё не сообщил о доступных экранах."
                : selected?.isPrimary
                  ? "Для автоматического показа нужен отдельный экран. Включите «Расширить» по инструкции выше."
                  : "Название экрана не определяет проектор. Перед материалом покажем нейтральный код."}
            </small>
          </div>
          <div className="projector-helper-actions">
            <Button
              variant="outline"
              disabled={!canTest || command.isPending}
              onClick={() => command.mutate({ type: "TEST_TARGET", targetScreenId: target })}
            >
              <Monitor size={18} aria-hidden="true" />
              {command.isPending && command.variables?.type === "TEST_TARGET"
                ? "Отправляем…"
                : "Проверить этот экран"}
            </Button>
          </div>
          {test && !testCurrent && (
            <p role="status">Состав экранов изменился. Выберите экран и повторите проверку.</p>
          )}
          {testCurrent && (
            <form
              className="projector-helper-physical-test"
              onSubmit={(event) => {
                event.preventDefault();
                if (!canTest || !confirmed || !testCodePattern.test(code)) return;
                command.mutate({
                  type: "START_PUBLIC_PROJECTION",
                  targetScreenId: target,
                  displayConfirmed: true,
                  testCode: code
                });
              }}
            >
              <label>
                <span>Код на физическом проекторе</span>
                <input
                  aria-label="Код на физическом проекторе"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={6}
                  placeholder="6 символов"
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase().replace(/\s/g, ""))}
                  disabled={command.isPending}
                />
              </label>
              <label className="projector-helper-confirm-target">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={command.isPending}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>Код виден на проекторе, служебных окон на нём нет</span>
              </label>
              <Button
                type="submit"
                disabled={
                  !canTest || !confirmed || !testCodePattern.test(code) || command.isPending
                }
              >
                <Play size={18} aria-hidden="true" />
                {command.isPending && command.variables?.type === "START_PUBLIC_PROJECTION"
                  ? "Отправляем…"
                  : "Показать материал"}
              </Button>
              <small>Если код не появился или окно открылось не там, повторите выбор экрана.</small>
            </form>
          )}
          <div className="projector-helper-actions">
            <Button
              variant="outline"
              disabled={device.revoked || command.isPending || !fresh}
              onClick={() => command.mutate({ type: "STOP_PROJECTION" })}
            >
              <Square size={18} aria-hidden="true" />
              Остановить показ на компьютере
            </Button>
            <Button
              variant="ghost"
              disabled={unavailable || command.isPending}
              onClick={() => command.mutate({ type: "CHECK_UPDATE" })}
            >
              <RefreshCw size={18} aria-hidden="true" />
              Проверить обновления
            </Button>
          </div>
        </>
      )}
      {device.updateRequired && (
        <p className="projector-helper-warning">
          Перед новым показом обновите компонент. Уже идущий показ продолжится до остановки.
        </p>
      )}
      {!device.connected && (
        <p>Нет связи с компонентом. Откройте его на компьютере или продолжайте без установки.</p>
      )}
      {device.status === "ERROR" && (
        <p role="alert">
          Компонент сообщил об ошибке. Повторите проверку экрана или воспользуйтесь настройкой без
          установки.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {command.isError && (
        <p role="alert">
          {userErrorMessage(command.error, "Не удалось отправить команду. Повторите попытку.")}
        </p>
      )}
    </div>
  );
}

export function ProjectorHelperSettings() {
  const { user } = useAuth();
  const [query] = useSearchParams();
  const courseId = query.get("courseId");
  const sessionId = query.get("sessionId");
  const client = useQueryClient();
  const queryKey = ["projection-settings", user?.id];
  const settings = useQuery({
    queryKey,
    queryFn: getProjectionSettings,
    staleTime: 2000,
    refetchInterval: 3000
  });
  const session = useQuery({
    queryKey: ["projector-session", user?.id, courseId, sessionId],
    queryFn: () => getLiveSession(courseId!, sessionId!),
    enabled: Boolean(courseId && sessionId),
    refetchInterval: 5000
  });
  const context: HelperContext | null =
    courseId && sessionId
      ? {
          courseId,
          sessionId,
          active: session.data?.status === "LIVE" || session.data?.status === "PAUSED"
        }
      : null;
  const [draft, setDraft] = useState<ProjectionPolicyUpdate | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pair, setPair] = useState<ProjectionPairing | null>(null);
  const [now, setNow] = useState(Date.now());
  const data = settings.data;
  useEffect(() => {
    if (!pair) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pair]);
  const save = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("Настройки не загружены");
      return saveProjectionPolicy({ ...draft, minimumVersion: draft.minimumVersion.trim() });
    },
    onSuccess: (updated) => {
      client.setQueryData(queryKey, updated);
      setDraft(null);
      setConfirm(false);
      toast.success("Настройки проектора сохранены.");
    },
    onError: (error) => {
      toast.error(userErrorMessage(error, "Не удалось сохранить. Черновик остался в форме."));
      void settings.refetch();
    }
  });
  const pairing = useMutation({
    mutationFn: createProjectionPairing,
    onSuccess: (created) => {
      setNow(Date.now());
      setPair(created);
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось получить код подключения."))
  });
  const revoke = useMutation({
    mutationFn: revokeProjectionDevice,
    onSuccess: () => void client.invalidateQueries({ queryKey }),
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось отключить компонент."))
  });
  if (settings.isLoading)
    return (
      <section className="projector-helper">
        <h2>Автоматическая настройка</h2>
        <p role="status">Загружаем настройки учреждения…</p>
      </section>
    );
  if (!data)
    return (
      <section className="projector-helper">
        <h2>Автоматическая настройка</h2>
        <p role="alert">Не удалось получить настройки. Мастер без установки доступен.</p>
        <Button variant="outline" onClick={() => void settings.refetch()}>
          Повторить
        </Button>
      </section>
    );
  const value: ProjectionPolicyUpdate = draft ?? {
    agentAllowed: data.agentAllowed,
    minimumVersion: data.minimumVersion,
    expectedRevision: data.revision
  };
  const staleDraft = draft !== null && draft.expectedRevision !== data.revision;
  const pairExpired = pair && Date.parse(pair.expiresAt) <= now;
  return (
    <section className="projector-helper" aria-labelledby="projector-helper-heading">
      <div className="projector-helper-heading">
        <div>
          <h2 id="projector-helper-heading">Автоматическая настройка</h2>
          <p>
            Необязательный компонент для этого компьютера. Инструкция без установки доступна всегда.
          </p>
        </div>
        <Shield aria-hidden="true" size={24} />
      </div>
      {settings.isError && (
        <p role="alert">
          Сведения о компонентах не обновляются. Проверьте связь с сервером; мастер без установки
          доступен.
        </p>
      )}
      {user?.role === "ADMIN" && (
        <form
          className="projector-policy"
          onSubmit={(event) => {
            event.preventDefault();
            if (staleDraft) return;
            if (!value.agentAllowed && data.agentAllowed) setConfirm(true);
            else save.mutate();
          }}
        >
          <label className="projector-policy-toggle">
            <input
              type="checkbox"
              checked={value.agentAllowed}
              disabled={save.isPending}
              onChange={(event) => setDraft({ ...value, agentAllowed: event.target.checked })}
            />
            <span>
              <strong>Разрешить использование компонента</strong>
              <small>
                Для сотрудников этой установки. Системные ограничения компьютера сохраняются.
              </small>
            </span>
          </label>
          <label className="projector-version-field">
            <span>Минимальная версия</span>
            <input
              value={value.minimumVersion}
              placeholder="0.1.0"
              pattern="[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}"
              disabled={save.isPending}
              onChange={(event) => setDraft({ ...value, minimumVersion: event.target.value })}
            />
            <small>Более старый компонент должен обновиться перед новым показом.</small>
          </label>
          <div className="projector-helper-actions">
            <Button
              type="submit"
              disabled={
                save.isPending ||
                !draft ||
                staleDraft ||
                !versionPattern.test(value.minimumVersion.trim())
              }
            >
              {save.isPending ? "Сохраняем…" : "Сохранить"}
            </Button>
            {draft && (
              <Button
                type="button"
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  setDraft(null);
                  save.reset();
                }}
              >
                Отменить изменения
              </Button>
            )}
          </div>
          {staleDraft && (
            <div className="projector-policy-conflict" role="alert">
              <p>
                Настройка изменилась на сервере. Сейчас компонент{" "}
                {data.agentAllowed ? "разрешён" : "отключён"}, минимальная версия{" "}
                {data.minimumVersion}. Ваш черновик сохранён.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDraft({ ...value, expectedRevision: data.revision });
                  save.reset();
                }}
              >
                Проверил, сохранить мой вариант
              </Button>
            </div>
          )}
          {save.isError && !staleDraft && (
            <p role="alert">
              Изменения не применены. Черновик остался в форме.
              {save.error instanceof ApiError && save.error.status === 409
                ? " Обновляем актуальную настройку."
                : " Повторите сохранение."}
            </p>
          )}
        </form>
      )}
      {!data.agentAllowed ? (
        <p className="projector-helper-note">
          Учреждение отключило компонент. Продолжайте настройку по инструкции выше.
        </p>
      ) : (
        <>
          {data.installers.length === 0 ? (
            <p className="projector-helper-note">
              Установочные пакеты пока не опубликованы. Используйте настройку без установки.
            </p>
          ) : (
            <div className="projector-helper-actions projector-installer-options">
              {data.installers.map((installer) => (
                <Button
                  asChild
                  variant="outline"
                  className="projector-installer-download"
                  key={`${installer.platform}:${installer.version}`}
                >
                  <a href={installer.url} rel="noreferrer">
                    <Download size={18} aria-hidden="true" />
                    Установить · {platformLabels[installer.platform]} · ОС от{" "}
                    {installer.minimumOsVersion}
                  </a>
                </Button>
              ))}
            </div>
          )}
          <Button
            variant="outline"
            disabled={pairing.isPending || settings.isError}
            onClick={() => pairing.mutate()}
          >
            <Link2 size={18} aria-hidden="true" />
            {pairing.isPending ? "Получаем код…" : "Подключить компонент"}
          </Button>
          {pair && (
            <div className="projector-pairing" role="status">
              {pairExpired ? (
                <>
                  <p>Код подключения истёк.</p>
                  <Button
                    variant="outline"
                    onClick={() => pairing.mutate()}
                    disabled={pairing.isPending}
                  >
                    Получить новый код
                  </Button>
                </>
              ) : (
                <>
                  <p>Введите код в компоненте на этом компьютере:</p>
                  <strong>{pair.pairingCode}</strong>
                  <p>
                    Действует до{" "}
                    {new Date(pair.expiresAt).toLocaleTimeString("ru-RU", {
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                    . Не передавайте его другим людям.
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
      {data.devices.length > 0 && (
        <div className="projector-device-list">
          <h3>Ваши компьютеры</h3>
          {data.devices.map((device) => (
            <article className="projector-helper-device" key={device.id}>
              <div className="projector-device">
                <span>
                  <strong>{device.name}</strong>
                  <small>
                    {platformLabels[device.platform]} · {device.osVersion} · версия {device.version}
                  </small>
                  <small>
                    {device.lastSeenAt
                      ? `Последняя связь: ${new Date(device.lastSeenAt).toLocaleString("ru-RU")}`
                      : "Ещё не подключался"}
                  </small>
                </span>
                <div className="projector-helper-device-actions">
                  <span
                    className="projector-helper-device-state"
                    data-connected={device.connected && !device.revoked}
                  >
                    {device.revoked
                      ? "Отключён"
                      : !device.connected
                        ? "Нет связи"
                        : statusLabels[device.status]}
                  </span>
                  <Button
                    variant="outline"
                    disabled={revoke.isPending || device.revoked}
                    onClick={() => revoke.mutate(device.id)}
                  >
                    <Unplug size={16} aria-hidden="true" />
                    {device.revoked ? "Подключение отозвано" : "Отключить"}
                  </Button>
                </div>
              </div>
              <HelperDeviceControls
                key={`${device.id}:${context?.sessionId ?? "settings"}`}
                device={device}
                context={context}
                allowed={data.agentAllowed}
                fresh={!settings.isError}
                onSent={() => void client.invalidateQueries({ queryKey })}
              />
            </article>
          ))}
        </div>
      )}
      <Dialog open={confirm} onOpenChange={(open) => !save.isPending && setConfirm(open)}>
        <DialogContent className="projector-policy-confirm">
          <DialogHeader>
            <DialogTitle>Отключить автоматическую настройку?</DialogTitle>
            <DialogDescription>
              Установленные компоненты потеряют разрешение на показ. Активный показ перейдёт на
              нейтральный экран; занятие продолжится. Режим экранов не переключится сам. Инструкция
              без установки останется доступна.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={save.isPending} onClick={() => setConfirm(false)}>
              Отмена
            </Button>
            <Button disabled={save.isPending || staleDraft} onClick={() => save.mutate()}>
              {save.isPending ? "Сохраняем…" : "Отключить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
