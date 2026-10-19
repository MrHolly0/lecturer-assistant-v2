import { useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
import { useSearchParams } from "react-router-dom";
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
type SetupView = "connect" | "screens" | "helper";

export function ProjectorSetupPage({ helperPanel }: { helperPanel?: ReactNode }) {
  const [query] = useSearchParams();
  const joinCode = query.get("joinCode") ?? "";
  const courseId = query.get("courseId");
  const sessionId = query.get("sessionId");
  const presenterPath =
    courseId && sessionId
      ? `/courses/${encodeURIComponent(courseId)}/sessions/${encodeURIComponent(sessionId)}/presenter`
      : null;
  const state = useSyncExternalStore(browserProjection.subscribe, browserProjection.getSnapshot);
  const [os, setOs] = useState<GuideOs>(initialOs);
  const [view, setView] = useState<SetupView | null>(joinCode ? "connect" : null);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [neutral, setNeutral] = useState(false);
  const [selected, setSelected] = useState("");
  const [confirmationError, setConfirmationError] = useState(false);
  const [codeConfirmed, setCodeConfirmed] = useState(false);
  const [manualResult, setManualResult] = useState<"opened" | "blocked" | null>(null);
  const trainingTrigger = useRef<HTMLButtonElement>(null);
  const active = state.phase === "showing";
  const busy = state.phase === "requesting" || state.phase === "opening";
  const selectedScreen = state.screens.find((screen) => screen.id === selected && !screen.current);
  const begin = () => {
    setView("screens");
    setSelected("");
    setCodeConfirmed(false);
    setConfirmationError(false);
    void browserProjection.requestScreens();
  };
  const openPublic = () => {
    const share = screenShare.getSnapshot();
    const channel = share.scope?.joinCode === joinCode ? share.localChannelId : null;
    setManualResult(openProjectionWindow(joinCode, channel ?? undefined) ? "opened" : "blocked");
  };
  const finish = () => {
    browserProjection.stop();
    setView(null);
    setNeutral(true);
    setReverseOpen(true);
  };
  const confirm = () => {
    setConfirmationError(!browserProjection.confirmTest());
  };
  const manualOpening = joinCode && (
    <div className="projector-manual-opening">
      <Button variant="outline" onClick={openPublic}>
        <ExternalLink size={18} />
        Открыть окно проектора
      </Button>
      <p>
        Откроется только материал занятия. Для ручного показа перенесите это окно на проектор после
        включения «Расширить». Оно не переместится само.
      </p>
      {manualResult === "opened" && (
        <p role="status">Окно открыто. Проверьте, что его видит аудитория.</p>
      )}
      {manualResult === "blocked" && (
        <p role="alert">Разрешите всплывающие окна для сайта и нажмите кнопку ещё раз.</p>
      )}
    </div>
  );
  return (
    <>
      <div className={`page projector-setup${neutral ? " projector-setup--neutral" : ""}`}>
        {neutral ? (
          <div className="projector-finish">
            <div className="projector-public-test__brand">
              <BrandMark />
              <strong>Lecturer Assistant</strong>
            </div>
            <Monitor size={52} />
            <h1>Показ на проекторе закрыт</h1>
            <p>Занятие продолжается. Перед дублированием экрана закройте служебные окна.</p>
            <Button variant="outline" onClick={() => setReverseOpen(true)}>
              <CircleHelp size={18} />
              Как вернуть режим экрана?
            </Button>
            <Button variant="ghost" onClick={() => setNeutral(false)}>
              Вернуться к настройке
            </Button>
          </div>
        ) : (
          <>
            <header className="page-header projector-setup__header">
              <div>
                <h1>Настройка проектора</h1>
                <p className="muted">Публичное окно для аудитории, управление на вашем экране.</p>
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
                {active ? "Экран проверен и подключён" : "Автоматическое размещение не настроено"}
              </p>
              <h2 id="projector-status-title">
                {active ? "Проектор готов" : "Выберите способ показа"}
              </h2>
              <p>
                Можно сразу открыть публичное окно и перенести его вручную или пройти настройку,
                чтобы выбрать экран и проверить расположение.
              </p>
              <div className="projector-setup__actions">
                {joinCode && (
                  <Button variant="outline" onClick={openPublic}>
                    <ExternalLink size={18} />
                    Открыть окно проектора
                  </Button>
                )}
                <Button
                  ref={trainingTrigger}
                  onClick={() => setView(active ? "screens" : "connect")}
                >
                  <Monitor size={18} />
                  {active ? "Управлять проектором" : "Настроить экраны"}
                </Button>
              </div>
              {manualResult && (
                <p role={manualResult === "blocked" ? "alert" : "status"}>
                  {manualResult === "blocked"
                    ? "Окно заблокировано. Разрешите всплывающие окна для сайта и повторите открытие."
                    : "Окно открыто. Перенесите его на проектор, если оно появилось на рабочем экране."}
                </p>
              )}
              {!joinCode && (
                <p className="projector-muted">
                  Для показа материала откройте проектор из идущего занятия.
                </p>
              )}
            </section>
            <div className="projector-setup__secondary-actions">
              <Button variant="ghost" onClick={() => setView("connect")}>
                <CircleHelp size={18} />
                Инструкция подключения
              </Button>
              {helperPanel && (
                <Button variant="ghost" onClick={() => setView("helper")}>
                  <ShieldCheck size={18} />
                  Автоматическая настройка
                </Button>
              )}
              <Button variant="ghost" onClick={() => setReverseOpen(true)}>
                Как вернуть режим экрана?
              </Button>
            </div>
          </>
        )}
      </div>
      <Dialog open={view !== null && !neutral} onOpenChange={(open) => !open && setView(null)}>
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
              {view === "helper"
                ? "Настройка проектора · необязательная установка"
                : `Настройка проектора · шаг ${view === "connect" ? 1 : 2} из 2`}
            </p>
            <DialogTitle>
              {view === "helper"
                ? "Помощник для компьютера"
                : view === "connect"
                  ? "Подключите проектор"
                  : phaseTitles[state.phase]}
            </DialogTitle>
            <DialogDescription>
              {view === "helper"
                ? "Установка и использование зависят от разрешения учреждения. Показ без установки доступен всегда."
                : view === "connect"
                  ? "Включите отдельный рабочий стол. Тогда аудитория увидит материал, а вопросы и ответы останутся у вас."
                  : "Сначала нейтральный код на выбранном экране, затем ваше подтверждение и материал занятия."}
            </DialogDescription>
          </DialogHeader>
          <div className="projector-tour__body">
            {view === "connect" && (
              <>
                <DisplayPair />
                <div className="projector-show-destinations">
                  <p>
                    <strong>Куда показываем:</strong> публичное окно «Проектор» на отдельном
                    физическом экране.
                  </p>
                  <p>
                    <strong>Что показываем:</strong> слайды занятия или выбранное вами приложение.
                    Для демонстрации выбирайте IDE, вкладку или рабочий экран, а не окно «Проектор».
                  </p>
                </div>
                <p>Подключите HDMI, включите «Расширить» и вернитесь сюда.</p>
                <GuideSystemSelect os={os} onChange={setOs} />
                <Guide os={os} />
                {helperPanel && (
                  <div className="projector-helper-offer">
                    <strong>Хотите запускать показ с помощником?</strong>
                    <p>
                      Здесь можно проверить доступность установки или подключить уже установленный
                      компонент.
                    </p>
                    <Button variant="outline" onClick={() => setView("helper")}>
                      Установка и подключение
                    </Button>
                  </div>
                )}
              </>
            )}
            {view === "helper" && helperPanel}
            {view === "screens" && (
              <>
                <div className="projector-check-result" role="status" aria-live="polite">
                  {state.phase === "requesting" ? (
                    <p>Подтвердите запрос «Управление окнами» в браузере.</p>
                  ) : state.phase === "unsupported" ? (
                    <>
                      <p>
                        Этот браузер не даёт сайту список мониторов и не позволяет выбрать проектор
                        автоматически.
                      </p>
                      <p>
                        Откройте настройку в настольном Chrome или Edge либо перенесите публичное
                        окно вручную.
                      </p>
                    </>
                  ) : state.phase === "permission-denied" ? (
                    <p>
                      Разрешите «Управление окнами» в настройках сайта и повторите проверку. Отказ
                      не означает, что HDMI отключён.
                    </p>
                  ) : state.phase === "single-screen" ? (
                    <p>
                      Подключите HDMI и включите «Расширить». Один доступный экран также может
                      означать ограничение браузера. После переключения вернитесь сюда и повторите
                      проверку.
                    </p>
                  ) : state.phase === "popup-blocked" ? (
                    <p>
                      Разрешите всплывающие окна для сайта, затем нажмите «Открыть тест» ещё раз.
                    </p>
                  ) : state.phase === "choosing" ? (
                    <p>
                      Доступно экранов: {state.screens.length}. Выберите, где должен появиться тест.
                    </p>
                  ) : state.phase === "opening" ? (
                    <p>Проверяем фактическое расположение окна. Материал занятия пока скрыт.</p>
                  ) : null}
                  {state.message && <p>{state.message}</p>}
                </div>
                {state.screens.length > 1 && !active && (
                  <fieldset className="projector-screen-choice" disabled={busy}>
                    <legend>Доступные экраны</legend>
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
                          <strong>{screen.current ? "Ваш рабочий экран" : screen.label}</strong>
                          <span>
                            {screen.width} × {screen.height}
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
                            {screen.current ? "Здесь управление" : "Выбрать"}
                          </span>
                        </label>
                      ))}
                    </div>
                    <p className="projector-muted">
                      Название монитора не доказывает, что это физический проектор. Это подтвердит
                      проверочный код.
                    </p>
                  </fieldset>
                )}
                {state.phase === "testing" && (
                  <section className="projector-confirm">
                    <p>Посмотрите на физический проектор.</p>
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
                      Вижу этот код именно на проекторе
                    </label>
                    <Button
                      disabled={!codeConfirmed || !canConfirmProjection(state)}
                      onClick={confirm}
                    >
                      <Check size={18} />
                      {joinCode ? "Показать материал" : "Подтвердить экран"}
                    </Button>
                    {confirmationError && (
                      <p role="alert">Экран изменился или потерял связь. Повторите тест.</p>
                    )}
                  </section>
                )}
                {active && (
                  <div className="projector-connected">
                    <ShieldCheck />
                    <div>
                      <strong>
                        {joinCode ? "Материал на выбранном экране" : "Экран проверен"}
                      </strong>
                      <p>
                        {joinCode
                          ? "Вопросы, ответы и заметки остаются на рабочем экране. Для демонстрации выберите нужное приложение в управлении занятием, не окно проектора."
                          : "Откройте занятие и запустите проектор из его инструментов."}
                      </p>
                    </div>
                  </div>
                )}
                <div className="projector-setup__actions">
                  {!active && (
                    <Button variant="outline" disabled={busy} onClick={begin}>
                      <RefreshCw size={18} />
                      {state.phase === "requesting" ? "Проверяем…" : "Проверить экраны"}
                    </Button>
                  )}
                  {!active && selectedScreen && state.phase !== "testing" && (
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setCodeConfirmed(false);
                        setConfirmationError(false);
                        browserProjection.openTest(selectedScreen.id, joinCode || "setup");
                      }}
                    >
                      <Monitor size={18} />
                      {state.phase === "opening" ? "Открываем…" : "Открыть тест"}
                    </Button>
                  )}
                  {state.phase === "testing" && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        browserProjection.selectScreen();
                        setSelected("");
                      }}
                    >
                      Другой экран
                    </Button>
                  )}
                  {state.attemptId && (
                    <Button variant="outline" onClick={finish}>
                      <X size={18} />
                      Закрыть проектор
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
                ].includes(state.phase) && manualOpening}
                {helperPanel && !active && (
                  <Button
                    className="projector-helper-link"
                    variant="ghost"
                    onClick={() => setView("helper")}
                  >
                    Установка и подключение помощника
                  </Button>
                )}
              </>
            )}
          </div>
          <DialogFooter className="projector-tour__footer">
            {view !== "connect" && (
              <Button variant="ghost" onClick={() => setView("connect")}>
                <ArrowLeft size={16} />К подключению
              </Button>
            )}
            <div>
              <Button variant="outline" onClick={() => setView(null)}>
                {active ? "Готово" : "Закрыть настройку"}
              </Button>
              {view === "connect" && (
                <Button onClick={begin}>
                  <Monitor size={18} />
                  Проверить экраны
                </Button>
              )}
              {view === "helper" && (
                <Button variant="outline" onClick={begin}>
                  Продолжить без установки
                </Button>
              )}
              {view === "screens" && active && presenterPath && (
                <LinkButton to={presenterPath}>
                  К занятию
                  <ArrowRight size={16} />
                </LinkButton>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={reverseOpen} onOpenChange={setReverseOpen}>
        <DialogContent className="projector-tour projector-tour--reverse">
          <DialogHeader>
            <DialogTitle>Как использовать экраны дальше?</DialogTitle>
            <DialogDescription>
              Выберите нужный результат. Приложение не меняет режим экранов автоматически.
            </DialogDescription>
          </DialogHeader>
          <div className="projector-tour__body">
            <GuideSystemSelect os={os} onChange={setOs} />
            <Guide os={os} reverse />
            <p className="projector-muted">
              Перед включением дублирования закройте служебные окна. Занятие продолжится.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setReverseOpen(false)}>
              <Check size={18} />
              Понятно
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
