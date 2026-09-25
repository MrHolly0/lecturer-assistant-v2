import { BookOpenText, LayoutDashboard, ListChecks } from "lucide-react";
import { NavLink } from "react-router-dom";

const sections = [
  { suffix: "", label: "Обзор", icon: LayoutDashboard, end: true },
  { suffix: "/materials", label: "Лекции и материалы", icon: BookOpenText },
  { suffix: "/questions", label: "Банк вопросов", icon: ListChecks }
];

export function CourseSectionNav({ courseId }: { courseId: string }) {
  return (
    <nav className="course-section-nav" aria-label="Разделы курса">
      {sections.map(({ suffix, label, icon: Icon, end }) => (
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
