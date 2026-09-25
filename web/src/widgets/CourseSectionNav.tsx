import { BarChart3, BookOpenText, LayoutDashboard, ListChecks } from "lucide-react";
import { NavLink } from "react-router-dom";

const sections = [
  { suffix: "", label: "Обзор", icon: LayoutDashboard, end: true },
  { suffix: "/materials", label: "Лекции и материалы", icon: BookOpenText },
  { suffix: "/questions", label: "Банк вопросов", icon: ListChecks },
  { suffix: "/analytics", label: "Аналитика", icon: BarChart3, manageOnly: true }
];

export function CourseSectionNav({
  courseId,
  canManage = false
}: {
  courseId: string;
  canManage?: boolean;
}) {
  const visibleSections = sections.filter((section) => !section.manageOnly || canManage);

  return (
    <nav
      className={`course-section-nav${canManage ? " course-section-nav--manage" : ""}`}
      aria-label="Разделы курса"
    >
      {visibleSections.map(({ suffix, label, icon: Icon, end }) => (
        <NavLink
          key={suffix || "overview"}
          to={`/courses/${courseId}${suffix}`}
          end={end}
          className={({ isActive }) =>
            `course-section-nav__item${isActive ? " course-section-nav__item--active" : ""}`
          }
        >
          <Icon size={17} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
