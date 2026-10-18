import {
  BookOpen,
  Briefcase,
  Building2,
  FlaskConical,
  Folder,
  Globe,
  GraduationCap,
  Laptop,
  Library,
  Palette,
  School,
  Users
} from "lucide-react";

export const ORGANIZATION_ICONS = [
  { value: "USERS", label: "Люди", Icon: Users },
  { value: "GRADUATION", label: "Обучение", Icon: GraduationCap },
  { value: "BOOK", label: "Книга", Icon: BookOpen },
  { value: "BUILDING", label: "Здание", Icon: Building2 },
  { value: "SCHOOL", label: "Школа", Icon: School },
  { value: "LIBRARY", label: "Библиотека", Icon: Library },
  { value: "BRIEFCASE", label: "Работа", Icon: Briefcase },
  { value: "FLASK", label: "Исследования", Icon: FlaskConical },
  { value: "LAPTOP", label: "Компьютер", Icon: Laptop },
  { value: "PALETTE", label: "Творчество", Icon: Palette },
  { value: "GLOBE", label: "Мир", Icon: Globe },
  { value: "FOLDER", label: "Папка", Icon: Folder }
] as const;
