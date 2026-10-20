import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronRight, Folder, UserRound } from "lucide-react";
import { useAuth } from "../app/AuthContext";
import {
  getOrganization,
  getOrganizationMembers,
  type OrganizationMember
} from "../app/api/organization-api";
import { Button } from "../shared/ui/button";
import { includesQuery } from "../shared/lib/usePagedList";
import { SearchField } from "./ListControls";
import { OrganizationUnitIcon } from "./OrganizationUnitIcon";

export function CourseStaffPicker({
  courseId,
  memberIds,
  selectedId,
  disabled,
  onSelect
}: {
  courseId: string;
  memberIds: string[];
  selectedId?: string;
  disabled: boolean;
  onSelect: (member: OrganizationMember) => void;
}) {
  const { user } = useAuth();
  const [unitId, setUnitId] = useState<string>();
  const [query, setQuery] = useState("");
  const staff = Boolean(user && user.role !== "STUDENT");
  const tree = useQuery({
    queryKey: ["course-staff", user?.id, courseId, "tree"],
    queryFn: getOrganization,
    enabled: staff
  });
  const units = tree.data?.units ?? [];
  const selected = units.find((unit) => unit.id === unitId);
  const canView = !selected || selected.canViewMembers || tree.data?.administrator;
  const roster = useQuery({
    queryKey: ["course-staff", user?.id, courseId, "members", unitId ?? "root"],
    queryFn: () => getOrganizationMembers(unitId),
    enabled: staff && Boolean(tree.data) && Boolean(canView)
  });
  const folders = units.filter(
    (unit) => (unit.parentId ?? undefined) === unitId && includesQuery(query, unit.name)
  );
  const members = (roster.data ?? []).filter(
    (member) =>
      member.status === "ACTIVE" &&
      member.role !== "STUDENT" &&
      includesQuery(query, member.displayName, member.email)
  );
  const navigate = (id?: string) => {
    setUnitId(id);
    setQuery("");
  };
  const loading = tree.isLoading || (canView && roster.isLoading);
  const failed = tree.isError || (canView && roster.isError);

  if (!staff)
    return (
      <p className="muted">
        Справочник сотрудников недоступен для этого аккаунта. Найдите человека по email.
      </p>
    );
  return (
    <div className="course-staff-picker">
      <div className="course-staff-picker__location">
        {unitId && (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => navigate(selected?.parentId ?? undefined)}
          >
            <ArrowLeft size={16} /> Назад
          </Button>
        )}
        <span>{selected?.name ?? "Все доступные сотрудники"}</span>
      </div>
      <SearchField value={query} onChange={setQuery} placeholder="Найти по ФИО или почте" />
      {loading && (
        <p className="muted" role="status">
          Загрузка сотрудников…
        </p>
      )}
      {failed && (
        <div role="alert">
          <p>Не удалось загрузить сотрудников.</p>
          <Button
            variant="outline"
            onClick={() => {
              void tree.refetch();
              if (tree.data && canView) void roster.refetch();
            }}
          >
            Повторить
          </Button>
        </div>
      )}
      <ul className="course-staff-picker__list" aria-label="Папки и сотрудники">
        {folders.map((unit) => (
          <li key={unit.id}>
            <button
              type="button"
              className="course-staff-picker__row"
              disabled={disabled}
              onClick={() => navigate(unit.id)}
            >
              <OrganizationUnitIcon icon={unit.icon} />
              <span>
                <strong>{unit.name}</strong>
                <small>Папка сотрудников</small>
              </span>
              <ChevronRight size={16} />
            </button>
          </li>
        ))}
        {!loading &&
          !failed &&
          members.map((member) => {
            const added = memberIds.includes(member.id);
            return (
              <li key={member.id}>
                <button
                  type="button"
                  className="course-staff-picker__row"
                  aria-pressed={selectedId === member.id}
                  disabled={disabled || added}
                  onClick={() => onSelect(member)}
                >
                  <UserRound size={18} />
                  <span>
                    <strong>{member.displayName}</strong>
                    <small>{added ? "Уже в курсе" : member.unitName ?? "Без папки"}</small>
                  </span>
                  {added || selectedId === member.id ? <Check size={18} /> : null}
                </button>
              </li>
            );
          })}
      </ul>
      {!loading && !failed && folders.length === 0 && members.length === 0 && (
        <p className="muted" role="status">
          {query
            ? "Сотрудники не найдены."
            : canView
              ? "Доступных сотрудников пока нет."
              : "Выберите доступную папку сотрудников."}
        </p>
      )}
      {unitId && (
        <Button type="button" variant="ghost" disabled={disabled} onClick={() => navigate()}>
          <Folder size={16} /> Все сотрудники
        </Button>
      )}
    </div>
  );
}
