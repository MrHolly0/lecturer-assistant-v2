import { Play, Radio } from "lucide-react";
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
  return (
    <main className="teacher-remote-state">
      <Radio size={28} aria-hidden="true" />
      <h1>Ожидание начала</h1>
      <p className="muted">
        «{lectureTitle}» уже доступна студентам по коду {joinCode}.
      </p>
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
