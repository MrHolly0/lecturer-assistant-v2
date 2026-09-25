import { HelpCircle, Loader2 } from "lucide-react";

export function StudentSessionLoading() {
  return (
    <main className="student-session-shell student-session-shell--center">
      <Loader2 className="student-spinner" size={24} />
      Загрузка занятия...
    </main>
  );
}

export function StudentSessionError() {
  return (
    <main className="student-session-shell student-session-shell--center">
      <HelpCircle size={28} />
      <h1>Занятие не найдено</h1>
      <p className="muted">Проверьте код подключения у преподавателя.</p>
    </main>
  );
}
