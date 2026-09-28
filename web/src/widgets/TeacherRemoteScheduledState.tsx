import { Play, Radio } from "lucide-react";
import { buildMaxJoinUrl } from "../app/max/deepLink";
import { Button } from "../shared/ui/button";
import { LocalQrCode } from "./LocalQrCode";
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

interface Props {
  lectureTitle: string;
  joinCode: string;
  beginPending: boolean;
  cancelPending: boolean;
  onBegin: () => void;
  onBack: () => void;
  onCancel: () => void;
}

export function TeacherRemoteScheduledState({
  lectureTitle,
  joinCode,
  beginPending,
  cancelPending,
  onBegin,
  onBack,
  onCancel
}: Props) {
  const joinUrl = buildMaxJoinUrl(joinCode);

  return (
    <main className="teacher-remote-state teacher-remote-state--scheduled">
      <div className="teacher-remote-scheduled__heading">
        <span className="teacher-remote-scheduled__eyebrow">
          <Radio size={16} aria-hidden="true" /> Ожидание начала
        </span>
        <h1>{lectureTitle}</h1>
        <p className="muted">Студенты могут подключиться до начала показа.</p>
      </div>
      <section className="teacher-remote-scheduled__join" aria-label="Подключение студентов">
        <div className="teacher-remote-scheduled__code">
          <span>Код занятия</span>
          <strong>{joinCode}</strong>
          <p className="muted">Продиктуйте код или покажите QR студентам.</p>
        </div>
        {joinUrl && <LocalQrCode value={joinUrl} label="QR для студентов" />}
      </section>
      <Button type="button" size="lg" disabled={beginPending} onClick={onBegin}>
        <Play size={20} aria-hidden="true" />
        {beginPending ? "Начинаем…" : "Начать показ"}
      </Button>
      <Button type="button" variant="outline" onClick={onBack}>
        Вернуться к курсу
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="ghost" disabled={cancelPending}>
            Отменить занятие
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отменить занятие до начала?</AlertDialogTitle>
            <AlertDialogDescription>
              Ссылка студентов перестанет работать. Запись останется как отмененная.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Оставить</AlertDialogCancel>
            <AlertDialogAction onClick={onCancel}>Отменить занятие</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
