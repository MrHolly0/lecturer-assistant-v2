import { HelpCircle, Loader2 } from "lucide-react";
import { Button } from "../shared/ui/button";

export function StudentSessionLoading() {
  return (
    <main className="student-session-shell student-session-shell--center">
      <Loader2 className="student-spinner" size={24} />
      Загрузка занятия...
    </main>
  );
}

export function StudentSessionError({
  title = "Занятие не найдено",
  description = "Проверьте код подключения у преподавателя.",
  onRetry
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <main className="student-session-shell student-session-shell--center">
      <HelpCircle size={28} />
      <h1>{title}</h1>
      <p className="muted">{description}</p>
      {onRetry && (
        <Button type="button" variant="outline" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </main>
  );
}
