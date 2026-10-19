import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
import { Link, useSearchParams } from "react-router-dom";
import { browserProjection } from "../app/projection/browserProjection";
import { canConfirmProjection } from "../app/projection/setupState";
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
function hasSeenTraining() {
  try {
    return localStorage.getItem("la_projector_training_seen") === "1";
  } catch {
    return false;
  }
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
  idle: "Подключите проектор по HDMI",
  requesting: "Проверяем доступные экраны",
  unsupported: "Откройте настройку в Chrome или Edge",
  "permission-denied": "Разрешите управление экранами",
  error: "Проверку не удалось завершить",
  "single-screen": "Пока доступен один экран",
  choosing: "Выберите экран для проектора",
  opening: "Открываем нейтральный тест",
  testing: "Видите код на физическом проекторе?",
  "placement-failed": "Размещение окна не подтверждено",
  "popup-blocked": "Браузер заблокировал окно теста",
  showing: "Проектор проверен",
  invalidated: "Проверим проектор заново",
  stopped: "Показ на проекторе закрыт"
};

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
  const [tour, setTour] = useState<number | null>(hasSeenTraining() ? null : 0);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [neutral, setNeutral] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [confirmationError, setConfirmationError] = useState(false);
  const [codeConfirmed, setCodeConfirmed] = useState(false);
  const [repeat] = useState(hasSeenTraining);
  const trainingTrigger = useRef<HTMLButtonElement>(null);
  const active = state.phase === "showing";
  const busy = state.phase === "requesting" || state.phase === "opening";
  const guideSelect = (
    <label className="projector-os-select">
      <span>Ваша система</span>
      <select value={os} onChange={(event) => setOs(event.target.value as GuideOs)}>
        {Object.entries(osLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
  const begin = () => {
    setTour(null);
    setCodeConfirmed(false);
    setConfirmationError(false);
    void browserProjection.requestScreens();
  };
  const test = () => {
    setCodeConfirmed(false);
    setConfirmationError(false);
    browserProjection.openTest(selected, joinCode || "setup");
  };
  const finish = () => {
    browserProjection.stop();
    setTour(null);
    setNeutral(true);
    setReverseOpen(true);
  };
  const confirm = () => {
    if (!browserProjection.confirmTest()) {
      setConfirmationError(true);
      return;
    }
    setConfirmationError(false);
  };
  const showGuideInline = ["single-screen", "permission-denied", "unsupported"].includes(
    state.phase
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
            <p>
              Занятие продолжается. Перед возвращением к служебным панелям убедитесь, что рабочий
              экран не дублируется.
            </p>
            <Button variant="outline" onClick={() => setReverseOpen(true)}>
              <CircleHelp size={18} />
              Как вернуть режим экрана?
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setNeutral(false);
                setTour(null);
              }}
            >
              Вернуться к настройке
            </Button>
          </div>
        ) : (
          <>
            <header className="page-header projector-setup__header">
              <div>
                <h1>Настройка проектора</h1>
                <p className="muted">Отдельный показ для аудитории. Без обязательной установки.</p>
              </div>
              <Button ref={trainingTrigger} variant="outline" onClick={() => setTour(0)}>
                <CircleHelp size={18} />
                Инструкция
              </Button>
            </header>
            <div className="projector-setup__columns">
              <section className="projector-setup__main" aria-labelledby="projector-status-title">
                <p className="projector-status">
                  <Monitor size={20} />
                  {active ? "Экран подтверждён" : "Материал пока не показывается"}
                </p>
                <h2 id="projector-status-title" aria-live="polite">
                  {phaseTitles[state.phase]}
                </h2>
                {state.phase === "idle" && (
                  <>
                    <p>
                      {repeat
                        ? "Повторять длинное обучение не нужно. Снова проверим физический проектор перед показом."
                        : "Пульт, вопросы и заметки останутся на рабочем экране. На проектор отправим только учебный материал."}
                    </p>
                    <DisplayPair />
                  </>
                )}
                {state.phase === "unsupported" && (
                  <p>
                    Этот браузер не предоставляет управление несколькими экранами. Откройте тот же
                    адрес в настольном Chrome или Edge и войдите в свой аккаунт. Установка помощника
                    для этого пути не нужна.
                  </p>
                )}
                {state.phase === "permission-denied" && (
                  <p>
                    В настройках сайта разрешите «Управление окнами», затем повторите проверку.
                    Отказ в разрешении не означает, что HDMI отключён.
                  </p>
                )}
                {state.phase === "single-screen" && (
                  <p>
                    Подключите HDMI и включите расширенный рабочий стол. Если проектор уже
                    подключён, проверьте настройки дисплеев. Вернувшись сюда, нажмите «Проверить
                    экраны».
                  </p>
                )}
                {state.phase === "popup-blocked" && (
                  <p>
                    Разрешите всплывающие окна для этого сайта в адресной строке браузера. Затем
                    повторно нажмите «Открыть тест».
                  </p>
                )}
                {state.message && (
                  <p className="projector-feedback" role="status">
                    {state.message}
                  </p>
                )}
                {showGuideInline && (
                  <div className="projector-inline-guide">
                    {guideSelect}
                    <Guide os={os} />
                  </div>
                )}
                {state.screens.length > 1 && !active && (
                  <fieldset className="projector-screen-choice">
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
                            {screen.current ? "Здесь открыто управление" : "Выбрать"}
                          </span>
                        </label>
                      ))}
                    </div>
                    <p className="projector-muted">
                      Название экрана не определяет, где находится проектор. Перед материалом
                      проверим код на настоящем проекторе.
                    </p>
                  </fieldset>
                )}
                {state.phase === "testing" && (
                  <section className="projector-confirm">
                    <p>Посмотрите на физический проектор, а не на другой монитор.</p>
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
                      Вижу этот код именно на физическом проекторе
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
                        {joinCode
                          ? "Учебный материал показан на выбранном экране"
                          : "Проверка экрана завершена"}
                      </strong>
                      <p>
                        {joinCode
                          ? "Частные вопросы, ответы и заметки остаются в пульте."
                          : "Откройте занятие и запустите проектор из его инструментов. Перед материалом экран проверяется повторно."}
                      </p>
                    </div>
                  </div>
                )}
                <div className="projector-setup__actions">
                  {active ? (
                    <>
                      <Button variant="outline" onClick={finish}>
                        <X size={18} />
                        Закрыть показ на проекторе
                      </Button>
                      {presenterPath && (
                        <LinkButton to={presenterPath}>
                          К управлению занятием
                          <ArrowRight size={18} />
                        </LinkButton>
                      )}
                    </>
                  ) : (
                    <>
                      {state.phase === "idle" ? (
                        <Button onClick={begin}>
                          {repeat ? "Проверить проектор" : "Продолжить настройку"}
                          <ArrowRight size={18} />
                        </Button>
                      ) : (
                        <Button variant="outline" disabled={busy} onClick={begin}>
                          <RefreshCw size={18} />
                          {state.phase === "requesting" ? "Проверяем…" : "Проверить экраны"}
                        </Button>
                      )}
                      {selected &&
                        state.screens.some((screen) => screen.id === selected && !screen.current) &&
                        state.phase !== "testing" && (
                          <Button disabled={busy} onClick={test}>
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
                        <Button variant="ghost" onClick={finish}>
                          Закрыть проектор
                        </Button>
                      )}
                    </>
                  )}
                </div>
                {!active && (
                  <p className="projector-setup__footnote">
                    Разрешения браузера и проверка проектора обязательны. Приложение не меняет режим
                    экрана в системе.
                  </p>
                )}
                {helperPanel && <div className="projector-helper-slot">{helperPanel}</div>}
              </section>
              <aside className="projector-setup__aside">
                <h2>Перед началом</h2>
                <ol>
                  <li>Подключите проектор по HDMI.</li>
                  <li>Включите «Расширить» по инструкции.</li>
                  <li>Разрешите браузеру разместить окно.</li>
                  <li>Подтвердите код на проекторе.</li>
                </ol>
                <p>Настройка проектора не завершает и не приостанавливает занятие.</p>
                {presenterPath && (
                  <Link to={presenterPath} className="projector-back">
                    <ArrowLeft size={16} />К занятию
                  </Link>
                )}
                <Button
                  variant="ghost"
                  onClick={() => {
                    browserProjection.stop();
                    setNeutral(true);
                    setReverseOpen(true);
                  }}
                >
                  Как вернуть режим экрана?
                </Button>
              </aside>
            </div>
          </>
        )}
      </div>
      <Dialog
        open={tour !== null && !neutral}
        onOpenChange={(open) => {
          if (!open) setTour(null);
        }}
      >
        <DialogContent
          className="projector-tour"
          onCloseAutoFocus={(event) => {
            if (trainingTrigger.current) {
              event.preventDefault();
              trainingTrigger.current.focus({ preventScroll: true });
            }
          }}
        >
          <DialogHeader>
            <p className="projector-eyebrow">Настройка проектора · шаг {(tour ?? 0) + 1} из 3</p>
            <DialogTitle>
              {tour === 0
                ? "Две разные картинки"
                : tour === 1
                  ? "Включите расширение экрана"
                  : "Вернитесь сюда и продолжите"}
            </DialogTitle>
            <DialogDescription>
              {tour === 0
                ? "Пульт на рабочем экране, учебный материал на проекторе."
                : tour === 1
                  ? "Подключите HDMI. Настройку системы достаточно сделать один раз перед показом."
                  : "Следующее нажатие запускает проверку экранов, а не показ материала."}
            </DialogDescription>
          </DialogHeader>
          <div className="projector-tour__body">
            {tour === 0 ? (
              <>
                <DisplayPair />
                <p>
                  Вопросы студентов, ваши заметки и правильные ответы проверок не попадут в
                  публичное окно проектора.
                </p>
              </>
            ) : tour === 1 ? (
              <>
                {guideSelect}
                <Guide os={os} />
              </>
            ) : (
              <>
                <div className="projector-guide-illustration">
                  <Monitor size={80} />
                </div>
                <ol className="projector-return-steps">
                  <li>Разрешите управление окнами браузера.</li>
                  <li>Выберите экран проектора.</li>
                  <li>Посмотрите на проектор и подтвердите проверочный код.</li>
                </ol>
                <p className="projector-muted">
                  Закрытие или пропуск обучения не пропускает проверку.
                </p>
              </>
            )}
          </div>
          <DialogFooter className="projector-tour__footer">
            <Button variant="ghost" onClick={begin}>
              Пропустить обучение
            </Button>
            <div>
              {tour !== 0 && (
                <Button variant="outline" onClick={() => setTour((tour ?? 1) - 1)}>
                  Назад
                </Button>
              )}
              <Button onClick={() => (tour === 2 ? begin() : setTour((tour ?? 0) + 1))}>
                {tour === 2 ? "Продолжить настройку" : "Далее"}
                <ArrowRight size={16} />
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={reverseOpen} onOpenChange={setReverseOpen}>
        <DialogContent className="projector-tour projector-tour--reverse">
          <DialogHeader>
            <p className="projector-eyebrow">Показ на проекторе закрыт</p>
            <DialogTitle>Как использовать экраны дальше?</DialogTitle>
            <DialogDescription>
              Выберите нужный результат. Приложение не знает прежнюю конфигурацию и не меняет её
              автоматически.
            </DialogDescription>
          </DialogHeader>
          <div className="projector-tour__body">
            {guideSelect}
            <Guide os={os} reverse />
            <div className="projector-connected">
              <ShieldCheck />
              <p>
                Это окно нейтральное. Занятие остаётся открытым. Другие служебные окна закройте
                перед включением дублирования.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setReverseOpen(false)}>
              <Check size={18} />Я выбрал режим
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
