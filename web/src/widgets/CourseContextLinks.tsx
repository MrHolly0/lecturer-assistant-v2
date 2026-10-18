import { BarChart3, BookOpen, ChevronRight, CircleHelp, ExternalLink, Users } from "lucide-react";
import { Link } from "react-router-dom";

export function CourseContextLinks({
  courseId,
  canManage,
  includeOpen = false,
  onPeople
}: {
  courseId: string;
  canManage: boolean;
  includeOpen?: boolean;
  onPeople?: () => void;
}) {
  const links = [
    ...(includeOpen ? [{ suffix: "", label: "Открыть курс", icon: ExternalLink }] : []),
    { suffix: "/materials", label: "Лекции и материалы", icon: BookOpen },
    { suffix: "/questions", label: "Банк вопросов", icon: CircleHelp },
    ...(canManage ? [{ suffix: "/analytics", label: "Аналитика", icon: BarChart3 }] : [])
  ];
  return (
    <nav className="course-context-links" aria-label="Открыть раздел курса">
      {links.map(({ suffix, label, icon: Icon }) => (
        <Link key={suffix || "overview"} to={`/courses/${courseId}${suffix}`}>
          <Icon aria-hidden="true" />
          <span>{label}</span>
          <ChevronRight aria-hidden="true" />
        </Link>
      ))}
      {onPeople && (
        <button type="button" onClick={onPeople}>
          <Users aria-hidden="true" />
          <span>Люди и доступ</span>
          <ChevronRight aria-hidden="true" />
        </button>
      )}
    </nav>
  );
}
