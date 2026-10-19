import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  ExternalLink,
  Laptop,
  Monitor,
  RefreshCw,
  ShieldCheck,
  X
} from "lucide-react";
import { browserProjection, openProjectionWindow } from "../app/projection/browserProjection";
import { canConfirmProjection } from "../app/projection/setupState";
import { screenShare } from "../app/sharing/screenShare";
import { BrandMark } from "../shared/brand/BrandMark";
import { Button, LinkButton } from "../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { ProjectorHelperSettings } from "./ProjectorHelperSettings";
import { getLiveSession } from "../app/api/live-api";
import { getProjectionSettings } from "../app/api/projection-api";
import { preferredNativeProjectionDevice } from "../app/projection/nativeProjectionPreference";

type GuideOs = "windows" | "mac-modern" | "mac-monterey" | "mac-older" | "other";
const osLabels: Record<GuideOs, string> = {
  windows: "Windows 10 / 11",
  "mac-modern": "macOS 13 и новее",
  "mac-monterey": "macOS 12 Monterey",
  "mac-older": "macOS 10.15 / 11",
  other: "Другая система"
};
function initialOs(): GuideOs {
  return /mac/i.test(navigator.platform)
    ? "mac-modern"
    : /win/i.test(navigator.platform)
      ? "windows"
      : "other";
}
function GuideSystemSelect({ os, onChange }: { os: GuideOs; onChange: (os: GuideOs) => void }) {
  const id = useId();
  return (
    <div className="projector-os-select">
      <label htmlFor={id}>Ваша система</label>
      <Select value={os} onValueChange={(value) => onChange(value as GuideOs)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(osLabels).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
function Guide({ os, reverse = false }: { os: GuideOs; reverse?: boolean }) {
  if (os === "windows")
    return (
      <>
        <div className="projector-keys" aria-label="Клавиша Windows и P">
          <kbd>⊞ Win</kbd>
          <span>+</span>
          <kbd>P</kbd>
        </div>
        {reverse ? (
          <div className="projector-guide-options">
            <div>
              <Monitor />
              <p>
                <strong>Одинаковая картинка</strong>
                <span>Выберите «Дублировать»</span>
              </p>
            </div>
            <div>
              <Laptop />
              <p>
                <strong>Только рабочий экран</strong>
                <span>Выберите «Только экран компьютера»</span>
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="projector-mode">
              <Monitor />
              <strong>Расширить</strong>
              <Check />
            </div>
            <p>
              Нажмите Win + P и выберите «Расширить». На рабочем экране останется управление, на
              проекторе появится отдельная картинка.
            </p>
          </>
        )}
        <a
          className="projector-source"
          href="https://support.microsoft.com/en-us/windows/hardware/display-graphics/how-to-use-multiple-monitors-in-windows"
          target="_blank"
          rel="noreferrer"
        >
          Инструкция Microsoft <ExternalLink size={14} />
        </a>
      </>
    );
  if (os === "other")
    return (
      <>
        <div className="projector-guide-illustration">
          <Monitor size={64} />
        </div>
        <p>
          Откройте настройки дисплеев вашей системы. Выберите независимый рабочий стол для проектора
          {reverse
            ? " или включите зеркалирование, если нужна одинаковая картинка"
            : ", без зеркалирования рабочего экрана"}
          .
        </p>
        <p className="projector-muted">Название настройки зависит от системы и её окружения.</p>
      </>
    );
  const modern = os === "mac-modern";
  const legacy = os === "mac-older";
  return (
    <>
      <div className="projector-mac-guide">
        <div className="projector-mac-guide__path">
          {modern ? "Системные настройки" : "Системные настройки (System Preferences)"}
          <ArrowRight size={16} />
          Дисплеи (Мониторы)
        </div>
        <ol>
          <li>Выберите подключённый внешний дисплей.</li>
          {legacy ? (
            <>
              <li>Откройте вкладку «Расположение».</li>
              <li>
                {reverse
                  ? "Включите «Включить видеоповтор мониторов», если нужна одинаковая картинка."
                  : "Снимите флажок «Включить видеоповтор мониторов»."}
              </li>
            </>
          ) : (
            <>
              <li>
                {modern
                  ? "Откройте «Использовать как»."
                  : "Откройте «Настройки дисплея», затем «Использовать как»."}
              </li>
              <li>
                {reverse
                  ? "Выберите видеоповтор, если нужна одинаковая картинка."
                  : "Выберите расширенный дисплей (Extended display)."}
              </li>
            </>
          )}
        </ol>
      </div>
      <p>
        {reverse
          ? "Чтобы экраны остались раздельными, сохраните расширенный рабочий стол."
          : "Затем вернитесь сюда. Приложение проверит доступные экраны."}
      </p>
      <a
        className="projector-source"
        href="https://support.apple.com/ru-ru/guide/mac-help/mchlb5f905a1/mac"
        target="_blank"
        rel="noreferrer"
      >
        Инструкция Apple и выбор версии macOS <ExternalLink size={14} />
      </a>
    </>
  );
}
function DisplayPair() {
  return (
    <div
      className="projector-display-pair"
      aria-label="Ваш экран: пульт и вопросы. Проектор: учебный материал."
    >
      <div>
        <div className="projector-screen-picture projector-screen-picture--teacher">
          <BrandMark />
          <span>Пульт</span>
          <div className="projector-mini-signals">
            <i />
            <i />
            <i />
          </div>
          <p>Вопросы и ответы</p>
        </div>
        <strong>Ваш экран</strong>
        <span>Управление занятием</span>
      </div>
      <ArrowRight aria-hidden="true" />
      <div>
        <div className="projector-screen-picture projector-screen-picture--public">
          <Monitor />
          <strong>Учебный материал</strong>
        </div>
        <strong>Проектор</strong>
        <span>Только для аудитории</span>
      </div>
    </div>
  );
}
const phaseTitles: Record<string, string> = {
  idle: "Проверим подключённые экраны",
  requesting: "Запрашиваем доступ к экранам…",
  unsupported: "Автоматический выбор экранов недоступен",
  "permission-denied": "Браузер не получил разрешение",
  error: "Проверку не удалось завершить",
  "single-screen": "Браузер видит один экран",
  choosing: "Выберите экран проектора",
  opening: "Открываем нейтральный тест…",
  testing: "Видите код на физическом проекторе?",
  "placement-failed": "Не удалось подтвердить расположение окна",
  "popup-blocked": "Браузер заблокировал окно теста",
  showing: "Проектор готов к показу",
  invalidated: "Расположение экранов изменилось",
  stopped: "Окно проектора закрыто"
};
type SetupView = "connect" | "manual" | "screens" | "helper" | "ready";

export type ProjectorLesson = { courseId: string; sessionId: string; joinCode: string };

export function ProjectorSetup({
  lesson,
  joinCode = lesson?.joinCode ?? "",
  presentation = "page",
  onClose,
  onReturnToLecture
}: {
  lesson?: ProjectorLesson;
  joinCode?: string;
  presentation?: "page" | "dialog";
  onClose?: () => void;
  onReturnToLecture?: () => void;
}) {
  const { courseId, sessionId } = lesson ?? {};
  const presenterPath =
    courseId && sessionId
      ? `/courses/${encodeURIComponent(courseId)}/sessions/${encodeURIComponent(sessionId)}/presenter`
      : null;
  const state = useSyncExternalStore(browserProjection.subscribe, browserProjection.getSnapshot);
  const [os, setOs] = useState<GuideOs>(initialOs);
  const [view, setView] = useState<SetupView | null>(joinCode ? "connect" : null);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [confirmationError, setConfirmationError] = useState(false);
  const [codeConfirmed, setCodeConfirmed] = useState(false);
  const [numbers, setNumbers] = useState<{ opened: number; total: number } | null>(null);
  const [manualResult, setManualResult] = useState<"opened" | "blocked" | null>(null);
  const [helperReady, setHelperReady] = useState(false);
  const readyHelper = useQuery({
    queryKey: ["projector-ready-settings", courseId, sessionId],
    queryFn: getProjectionSettings,
    enabled: view === "ready" && helperReady && Boolean(courseId && sessionId),
    staleTime: 0,
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
    retry: false
  });
  const readySession = useQuery({
    queryKey: ["projector-ready-session", courseId, sessionId],
    queryFn: () => getLiveSession(courseId!, sessionId!),
    enabled: view === "ready" && helperReady && Boolean(courseId && sessionId),
    staleTime: 0,
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
    retry: false
  });
  const preferredDeviceId =
    courseId && sessionId ? preferredNativeProjectionDevice(courseId, sessionId) : null;
  const readyDevices = readyHelper.data?.devices ?? [];
  const activeReadyDevices = readyDevices.filter(
    (device) =>
      device.activeSessionId === sessionId &&
      (device.status === "SHOWING" || device.status === "PAUSED")
  );
  const readyDevice = preferredDeviceId
    ? readyDevices.find((device) => device.id === preferredDeviceId)
    : activeReadyDevices.length === 1
      ? activeReadyDevices[0]
      : undefined;
  useEffect(() => {
    if (view !== "ready" || !helperReady) return;
    const sessionEnded = Boolean(
      readySession.data && !["LIVE", "PAUSED"].includes(readySession.data.status)
    );
    const helperStopped =
      readyHelper.data &&
      (!readyDevice ||
        !readyDevice.connected ||
        readyDevice.revoked ||
        readyDevice.activeSessionId !== sessionId ||
        !["SHOWING", "PAUSED"].includes(readyDevice.status));
    if (sessionEnded || helperStopped) {
      setHelperReady(false);
      setView("helper");
    }
  }, [helperReady, readyDevice, readyHelper.data, readySession.data, sessionId, view]);
  const trainingTrigger = useRef<HTMLButtonElement>(null);
  const active = state.phase === "showing";
  const busy = state.phase === "requesting" || state.phase === "opening";
  const selectedScreen = state.screens.find((screen) => screen.id === selected && !screen.current);
  const begin = () => {
    setHelperReady(false);
    setView("screens");
    setSelected("");
    setNumbers(null);
    setCodeConfirmed(false);
    setConfirmationError(false);
    void browserProjection.requestScreens();
  };
  const openPublic = () => {
    const share = screenShare.getSnapshot();
    const channel = share.scope?.joinCode === joinCode ? share.localChannelId : null;
    setManualResult(openProjectionWindow(joinCode, channel ?? undefined) ? "opened" : "blocked");
  };
  const closeSetup = () => {
    setView(null);
    onClose?.();
  };
  const backToLecture = () => {
    closeSetup();
    onReturnToLecture?.();
  };
  const confirm = () => {
    const accepted = browserProjection.confirmTest();
    setConfirmationError(!accepted);
    if (accepted) setView("ready");
  };
  return (
    <>
      {presentation === "page" && (
        <div className="page projector-setup">
          <header className="page-header projector-setup__header">
            <div>
              <h1>Проектор</h1>
              <p className="muted">
                Материал для аудитории на проекторе, вопросы и управление у вас.
              </p>
            </div>
            {presenterPath && (
              <LinkButton variant="outline" to={presenterPath}>
                <ArrowLeft size={18} />К занятию
              </LinkButton>
            )}
          </header>
          <section className="projector-setup__summary" aria-labelledby="projector-status-title">
            <p className="projector-status">
              <Monitor size={20} />
              {active ? "Проектор подключён" : "Подключение и проверка экранов"}
            </p>
            <h2 id="projector-status-title">
              {active ? "Материал показан аудитории" : "Начните с настройки проектора"}
            </h2>
            <p>
              Подключите HDMI. Выберите автоматическую настройку с помощником или инструкцию без
              установки, затем укажите экран аудитории.
            </p>
            <Button ref={trainingTrigger} onClick={() => setView(active ? "ready" : "connect")}>
              <Monitor size={18} />
              {active ? "Управлять проектором" : "Настроить проектор"}
            </Button>
            {!joinCode && (
              <p className="projector-muted">
                Откройте «Проектор» из идущего занятия, чтобы вывести его материал.
              </p>
            )}
          </section>
          {!joinCode && <ProjectorHelperSettings />}
          <Button
            className="projector-helper-link"
            variant="ghost"
            onClick={() => setReverseOpen(true)}
          >
            <CircleHelp size={18} />
            Как вернуть режим экрана?
          </Button>
        </div>
      )}
      <Dialog open={view !== null} onOpenChange={(open) => !open && closeSetup()}>
        <DialogContent
          className="projector-tour projector-setup-dialog"
          onCloseAutoFocus={(event) => {
            if (trainingTrigger.current) {
              event.preventDefault();
              trainingTrigger.current.focus({ preventScroll: true });
            }
          }}
        >
          <DialogHeader>
            <p className="projector-eyebrow">
              {view === "ready"
                ? "Подключение завершено"
                : `Подключение проектора · ${view === "screens" ? "2 из 3" : view === "helper" ? "автоматическая настройка" : "1 из 3"}`}
            </p>
            <DialogTitle>
              {view === "ready"
                ? "Проектор готов"
                : view === "helper"
                  ? "Установите или подключите помощник"
                  : view === "manual"
                    ? "Включите отдельный рабочий стол"
                    : view === "screens"
                      ? phaseTitles[state.phase]
                      : "Как подключить проектор?"}
            </DialogTitle>
            <DialogDescription>
              {view === "ready"
                ? "Публичное окно уже на выбранном экране. Вернитесь к занятию и показывайте слайды или приложение."
                : view === "connect"
                  ? "Помощник настроит экраны и откроет отдельный пульт. Без установки экраны можно настроить по инструкции."
                  : view === "helper"
                    ? "Установите компонент один раз, подключите этот компьютер и выберите экран по номеру."
                    : view === "manual"
                      ? "Аудитория увидит материал. Вопросы, заметки и ответы останутся на вашем экране."
                      : "Посмотрите номер на физическом проекторе, выберите его здесь и подтвердите проверочный код."}
            </DialogDescription>
          </DialogHeader>
          <div className="projector-tour__body">
            {view === "connect" && (
              <>
                <DisplayPair />
                <div className="projector-methods">
                  <Button onClick={() => setView("helper")}>
                    <ShieldCheck size={20} />
                    <span>
                      <strong>С помощником</strong>
                      <small>Установка, автоматическая настройка и отдельный пульт</small>
                    </span>
                    <ArrowRight size={18} />
                  </Button>
                  <Button variant="outline" onClick={() => setView("manual")}>
                    <Monitor size={20} />
                    <span>
                      <strong>Без установки</strong>
                      <small>Инструкция для вашей системы и проверка экранов</small>
                    </span>
                    <ArrowRight size={18} />
                  </Button>
                </div>
                <p className="projector-muted">
                  Подключите проектор по HDMI. Во время настройки занятие продолжается.
                </p>
              </>
            )}
            {view === "helper" && (
              <ProjectorHelperSettings
                wizard
                lesson={lesson}
                onProjectionReady={() => {
                  setHelperReady(true);
                  setView("ready");
                }}
              />
            )}
            {view === "manual" && (
              <>
                <GuideSystemSelect os={os} onChange={setOs} />
                <Guide os={os} />
                <p className="projector-muted">
                  После переключения вернитесь сюда и нажмите «Режим включён, проверить экраны».
                </p>
              </>
            )}
            {view === "screens" && (
              <>
                <div className="projector-check-result" role="status" aria-live="polite">
                  {state.phase === "requesting" && (
                    <p>Подтвердите запрос «Управление окнами» в браузере.</p>
                  )}
                  {state.phase === "unsupported" && (
                    <>
                      <p>
                        Safari и этот браузер не разрешают сайту перечислять и размещать экраны
                        автоматически.
                      </p>
                      <p>
                        Помощник работает независимо от браузера. Можно установить его здесь или
                        открыть материал вручную и перенести окно на проектор.
                      </p>
                      <Button onClick={() => setView("helper")}>
                        <ShieldCheck size={18} />
                        Подключить помощник
                      </Button>
                    </>
                  )}
                  {state.phase === "permission-denied" && (
                    <p>Разрешите «Управление окнами» в настройках сайта и повторите проверку.</p>
                  )}
                  {state.phase === "single-screen" && (
                    <p>
                      Доступен один экран. Подключите HDMI, включите «Расширить» по инструкции и
                      проверьте снова.
                    </p>
                  )}
                  {state.phase === "popup-blocked" && (
                    <p>Разрешите всплывающие окна для сайта и повторите тест.</p>
                  )}
                  {state.phase === "opening" && (
                    <p>Проверяем расположение. Материал пока не показывается.</p>
                  )}
                  {state.message && <p>{state.message}</p>}
                </div>
                {state.screens.length > 1 && !active && (
                  <>
                    <div className="projector-identify">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => setNumbers(browserProjection.identifyScreens())}
                      >
                        <Monitor size={18} />
                        Показать номера на всех экранах
                      </Button>
                      <p>
                        Номера от 1 до {state.screens.length} появятся на 10 секунд. Запомните номер
                        на проекторе.
                      </p>
                      {numbers && (
                        <p role={numbers.opened < numbers.total ? "alert" : "status"}>
                          {numbers.opened === numbers.total
                            ? "Номера открыты. Выберите ниже номер проектора."
                            : `Открыто ${numbers.opened} из ${numbers.total}. Разрешите несколько всплывающих окон или используйте помощник.`}
                        </p>
                      )}
                    </div>
                    <fieldset className="projector-screen-choice" disabled={busy}>
                      <legend>Какой номер виден на проекторе?</legend>
                      <div>
                        {state.screens.map((screen, index) => (
                          <label
                            key={screen.id}
                            className={`projector-display-option${screen.current ? " is-current" : ""}${selected === screen.id ? " is-selected" : ""}`}
                          >
                            <div className="projector-display-option__drawing">
                              <Monitor size={44} />
                              <span>{index + 1}</span>
                            </div>
                            <strong>
                              Экран {index + 1}
                              {screen.current ? " · управление" : ""}
                            </strong>
                            <span>
                              {screen.label} · {screen.width} × {screen.height}
                            </span>
                            <span className="projector-display-option__select">
                              <input
                                type="radio"
                                name="projector-screen"
                                checked={selected === screen.id}
                                disabled={screen.current || busy}
                                onChange={() => {
                                  browserProjection.selectScreen();
                                  setSelected(screen.id);
                                  setCodeConfirmed(false);
                                }}
                              />
                              {screen.current ? "Ваш рабочий экран" : "Выбрать"}
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </>
                )}
                {state.phase === "testing" && (
                  <section className="projector-confirm">
                    <p>Убедитесь, что код виден именно на физическом проекторе.</p>
                    <p
                      className="projector-confirm__code"
                      aria-label={`Проверочный код ${state.testCode}`}
                    >
                      {state.testCode}
                    </p>
                    <label className="projector-confirm__checkbox">
                      <input
                        type="checkbox"
                        checked={codeConfirmed}
                        onChange={(event) => setCodeConfirmed(event.target.checked)}
                      />
                      Вижу этот код на проекторе
                    </label>
                    <Button
                      disabled={!codeConfirmed || !canConfirmProjection(state)}
                      onClick={confirm}
                    >
                      <Check size={18} />
                      Подтвердить и показать материал
                    </Button>
                    {confirmationError && (
                      <p role="alert">Экран изменился или потерял связь. Повторите тест.</p>
                    )}
                  </section>
                )}
                <div className="projector-setup__actions">
                  {!active && (
                    <Button variant="outline" disabled={busy} onClick={begin}>
                      <RefreshCw size={18} />
                      {busy ? "Проверяем…" : "Проверить экраны снова"}
                    </Button>
                  )}
                  {!active && selectedScreen && state.phase !== "testing" && (
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setCodeConfirmed(false);
                        browserProjection.openTest(selectedScreen.id, joinCode || "setup");
                      }}
                    >
                      <Monitor size={18} />
                      Открыть проверочный код
                    </Button>
                  )}
                </div>
                {[
                  "unsupported",
                  "permission-denied",
                  "single-screen",
                  "popup-blocked",
                  "placement-failed",
                  "error"
                ].includes(state.phase) &&
                  joinCode && (
                    <div className="projector-manual-opening">
                      <strong>Ручной показ без помощника</strong>
                      <p>
                        Нажмите кнопку, затем перетащите открывшееся публичное окно на проектор.
                        Если Safari открыл вкладку, выберите «Окно → Переместить вкладку в новое
                        окно». Вернитесь сюда после проверки.
                      </p>
                      <Button variant="outline" onClick={openPublic}>
                        <ExternalLink size={18} />
                        Открыть публичное окно
                      </Button>
                      {manualResult === "blocked" && (
                        <p role="alert">Разрешите всплывающие окна для сайта и повторите.</p>
                      )}
                      {manualResult === "opened" && (
                        <>
                          <p role="status">
                            Окно открыто. Проверьте материал на физическом проекторе.
                          </p>
                          <Button onClick={() => setView("ready")}>
                            Материал виден на проекторе
                          </Button>
                        </>
                      )}
                    </div>
                  )}
              </>
            )}
            {view === "ready" && (
              <>
                <div className="projector-connected">
                  <ShieldCheck />
                  <div>
                    <strong>Учебный материал для аудитории</strong>
                    <p>Пульт, вопросы и заметки остаются у вас.</p>
                  </div>
                </div>
                <ol className="projector-next-steps">
                  <li>Вернитесь к занятию и переключайте слайды как обычно.</li>
                  <li>
                    Для другого приложения нажмите «Демонстрация» и выберите нужное окно. Окно
                    «Проектор» получает этот материал, выбирать его источником не нужно.
                  </li>
                  <li>
                    После занятия закройте показ и верните режим экранов в этой настройке. При
                    ручном подключении используйте обратную инструкцию.
                  </li>
                </ol>
              </>
            )}
          </div>
          <DialogFooter className="projector-tour__footer">
            {view === "ready" ? (
              <div className="projector-tour__completed-actions">
                {helperReady && (
                  <Button variant="outline" onClick={() => setView("helper")}>
                    Управление помощником
                  </Button>
                )}
                {state.attemptId && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      browserProjection.stop();
                      setView(null);
                      setReverseOpen(true);
                    }}
                  >
                    <X size={18} />
                    Закрыть проектор
                  </Button>
                )}
                <Button onClick={backToLecture}>
                  {presenterPath ? "Вернуться к занятию" : "Закрыть"}
                  {presenterPath && <ArrowRight size={16} />}
                </Button>
              </div>
            ) : (
              <>
                {view !== "connect" && (
                  <Button variant="ghost" onClick={() => setView("connect")}>
                    <ArrowLeft size={16} />
                    Выбор способа
                  </Button>
                )}
                <div>
                  <Button variant="outline" onClick={backToLecture}>
                    {presenterPath ? "К занятию" : "Закрыть"}
                  </Button>
                  {view === "manual" && (
                    <Button onClick={begin}>
                      Режим включён, проверить экраны
                      <ArrowRight size={16} />
                    </Button>
                  )}
                  {view === "helper" && (
                    <Button variant="ghost" onClick={() => setView("manual")}>
                      Без установки
                    </Button>
                  )}
                </div>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={reverseOpen}
        onOpenChange={(open) => {
          setReverseOpen(open);
          if (!open) onClose?.();
        }}
      >
        <DialogContent className="projector-tour projector-tour--reverse">
          <DialogHeader>
            <DialogTitle>Вернуть режим экранов</DialogTitle>
            <DialogDescription>
              Сначала закройте публичное окно и служебный пульт. Затем выберите нужный режим.
            </DialogDescription>
          </DialogHeader>
          <div className="projector-tour__body">
            <GuideSystemSelect os={os} onChange={setOs} />
            <Guide os={os} reverse />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setReverseOpen(false);
                onClose?.();
              }}
            >
              Закрыть
            </Button>
            {presenterPath && <Button onClick={backToLecture}>К занятию</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
