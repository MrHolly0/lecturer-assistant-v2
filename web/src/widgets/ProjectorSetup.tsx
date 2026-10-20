import { useId, useState } from "react";
import { ArrowRight, Check, CircleHelp, ExternalLink, Laptop, Monitor } from "lucide-react";
import { openProjectionWindow } from "../app/projection/browserProjection";
import { screenShare } from "../app/sharing/screenShare";
import { BrandMark } from "../shared/brand/BrandMark";
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
          : "Затем откройте проектор и перенесите его окно на внешний дисплей."}
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

export function ProjectorSetup({ joinCode, onClose }: { joinCode: string; onClose: () => void }) {
  const [os, setOs] = useState<GuideOs>(initialOs);
  const [open, setOpen] = useState(true);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const close = () => {
    setOpen(false);
    onClose?.();
  };
  const openPublic = () => {
    const share = screenShare.getSnapshot();
    const channel = share.scope?.joinCode === joinCode ? share.localChannelId : null;
    setBlocked(!openProjectionWindow(joinCode, channel ?? undefined));
  };
  return (
    <>
      <Dialog open={open} onOpenChange={(value) => !value && close()}>
        <DialogContent className="projector-tour projector-setup-dialog">
          <DialogHeader>
            <DialogTitle>Настройка показа</DialogTitle>
            <DialogDescription>
              Подключите проектор по HDMI. Настройте отдельный рабочий стол по инструкции для вашей
              системы.
            </DialogDescription>
          </DialogHeader>
          <div className="projector-tour__body">
            <DisplayPair />
            <GuideSystemSelect os={os} onChange={setOs} />
            <Guide os={os} />
            <ol className="projector-next-steps">
              <li>
                Нажмите «Проектор» в занятии и перенесите открывшееся окно на внешний экран. Если
                браузер открыл вкладку, вынесите её в отдельное окно.
              </li>
              <li>
                Разверните окно проектора на весь экран. Вопросы, заметки и пульт оставьте на своём
                экране.
              </li>
              <li>
                Чтобы показать приложение или экран, нажмите «Демонстрация» в занятии или пульте.
                Выберите источник и проверьте кадр перед показом.
              </li>
              <li>
                Нажмите «Вернуться к презентации», чтобы снова показать слайды. Закрытие пульта не
                закрывает проектор; его окно закроется после завершения лекции.
              </li>
            </ol>
            <p className="projector-muted">
              При показе всего экрана аудитория видит все его окна. Для приватного пульта выберите
              отдельное окно с учебным материалом. Окно «Проектор» выбирать источником не нужно.
            </p>
            {blocked && (
              <p role="alert">
                Браузер заблокировал окно проектора. Разрешите всплывающие окна для сайта и
                повторите.
              </p>
            )}
          </div>
          <DialogFooter className="projector-tour__footer">
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setReverseOpen(true);
              }}
            >
              <CircleHelp size={18} />
              Вернуть режим экрана
            </Button>
            <div>
              <Button variant="outline" onClick={close}>
                Готово
              </Button>
              {joinCode && (
                <Button onClick={openPublic}>
                  <ExternalLink size={18} />
                  Открыть проектор
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={reverseOpen}
        onOpenChange={(value) => {
          setReverseOpen(value);
          if (!value) onClose();
        }}
      >
        <DialogContent className="projector-tour projector-tour--reverse">
          <DialogHeader>
            <DialogTitle>Вернуть режим экранов</DialogTitle>
            <DialogDescription>
              После завершения занятия выберите привычный режим экрана.
            </DialogDescription>
          </DialogHeader>
          <div className="projector-tour__body">
            <GuideSystemSelect os={os} onChange={setOs} />
            <Guide os={os} reverse />
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setReverseOpen(false);
                setOpen(true);
              }}
            >
              Готово
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
