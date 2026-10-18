import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Download, Expand, Minimize, X, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { getMaxWebApp, isMaxLaunch } from "../app/max/bridge";
import { Button } from "../shared/ui/button";

interface ViewerSlide {
  idx: number;
  imageUrl: string;
}

export function StudentSlideViewer({ slide }: { slide: ViewerSlide }) {
  const [open, setOpen] = useState(false);
  const shownSlide = slide;
  const [zoomed, setZoomed] = useState(false);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const operationRef = useRef(false);
  const fileRef = useRef<{ url: string; file: File } | null>(null);

  useEffect(() => {
    setZoomed(false);
    fileRef.current = null;
    if (!open || (isMaxLaunch() && getMaxWebApp()?.downloadFile)) return;
    const controller = new AbortController();
    const url = new URL(shownSlide.imageUrl, window.location.href).href;
    // Preload the file so Web Share can run directly from the Save click.
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const blob = await response.blob();
        if (!controller.signal.aborted) {
          fileRef.current = {
            url,
            file: new File([blob], `slide-${shownSlide.idx}.png`, {
              type: blob.type || "image/png"
            })
          };
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [open, shownSlide.imageUrl, shownSlide.idx]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.scrollTo({
      left: zoomed ? (canvas.scrollWidth - canvas.clientWidth) / 2 : 0,
      top: zoomed ? (canvas.scrollHeight - canvas.clientHeight) / 2 : 0
    });
  }, [zoomed]);

  async function saveSlide() {
    if (operationRef.current) return;
    operationRef.current = true;
    setSaving(true);
    let objectUrl: string | undefined;
    try {
      const url = new URL(shownSlide.imageUrl, window.location.href).href;
      const fileName = `slide-${shownSlide.idx}.png`;
      const max = getMaxWebApp();
      if (isMaxLaunch(max) && max?.downloadFile) {
        // MAX handles the download natively and requires the original user click.
        await max.downloadFile(url, fileName);
        return;
      }
      let file = fileRef.current?.url === url ? fileRef.current.file : null;
      if (!file) {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Image download failed");
        const blob = await response.blob();
        file = new File([blob], fileName, { type: blob.type || "image/png" });
      }
      if (
        navigator.canShare?.({ files: [file] }) &&
        navigator.share &&
        navigator.userActivation?.isActive !== false
      ) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          // A blocked/unsupported share still permits a normal file download.
        }
      }
      objectUrl = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error("Не удалось сохранить слайд. Проверьте связь и попробуйте ещё раз.");
      }
    } finally {
      if (objectUrl) {
        const savedUrl = objectUrl;
        // Give browsers time to consume the download before releasing the URL.
        window.setTimeout(() => URL.revokeObjectURL(savedUrl), 1000);
      }
      operationRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setZoomed(false);
        }
        setOpen(next);
      }}
    >
      <Dialog.Trigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Expand size={18} aria-hidden="true" /> Увеличить слайд
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="student-slide-viewer-overlay" />
        <Dialog.Content className="student-slide-viewer">
          <Dialog.Title className="sr-only">Просмотр слайда</Dialog.Title>
          <Dialog.Description className="sr-only">
            Слайд {shownSlide.idx}. Увеличьте изображение или сохраните его на устройство.
          </Dialog.Description>
          <div className="student-slide-viewer__toolbar">
            <Button
              variant="outline"
              size="icon"
              aria-label={zoomed ? "Вписать слайд в экран" : "Увеличить изображение вдвое"}
              aria-pressed={zoomed}
              onClick={() => setZoomed((current) => !current)}
            >
              {zoomed ? <Minimize size={22} /> : <ZoomIn size={22} />}
            </Button>
            <Button variant="outline" onClick={() => void saveSlide()} disabled={saving}>
              <Download size={20} aria-hidden="true" />
              {saving ? "Сохраняем…" : "Сохранить"}
            </Button>
            <Dialog.Close asChild>
              <Button variant="outline">
                <X size={22} aria-hidden="true" /> Закрыть
              </Button>
            </Dialog.Close>
          </div>
          <div
            className="student-slide-viewer__canvas"
            ref={canvasRef}
            role="region"
            aria-label="Изображение слайда, область прокрутки"
            tabIndex={0}
          >
            <div className={`student-slide-viewer__image-container${zoomed ? " is-zoomed" : ""}`}>
              <img src={shownSlide.imageUrl} alt={`Слайд ${shownSlide.idx}`} />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
