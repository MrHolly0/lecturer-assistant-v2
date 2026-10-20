import { useEffect, useState } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, ChevronRight, MoreHorizontal, Plus, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";
import type { components } from "../app/api/schema";
import {
  assignStudyGroupMember,
  listStudyGroupMembers,
  removeStudyGroupMember,
  type CourseMember
} from "../app/api/courses-api";
import { userErrorMessage } from "../app/api/errors";
import { Button, IconButton } from "../shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { SearchField } from "./ListControls";
import { includesQuery } from "../shared/lib/usePagedList";
import { ConfirmActionButton } from "./ConfirmActionButton";

type StudyGroup = components["schemas"]["StudyGroup"];

interface CourseGroupManagerProps {
  courseId: string;
  groups: StudyGroup[];
  courseMembers: CourseMember[];
  deleting: boolean;
  onDelete: (groupId: string) => void;
}

export function CourseGroupManager({
  courseId,
  groups,
  courseMembers,
  deleting,
  onDelete
}: CourseGroupManagerProps) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selectedGroupId = params.get("group") ?? "";
  const setSelectedGroupId = (id: string, replace = false) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id) next.set("group", id);
        else next.delete("group");
        return next;
      },
      { replace }
    );
  const [personId, setPersonId] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => setPersonId(""), [selectedGroupId, courseId]);
  const memberQueries = useQueries({
    queries: groups.map((group) => ({
      queryKey: ["courses", courseId, "groups", group.id, "members"],
      queryFn: () => listStudyGroupMembers(courseId, group.id)
    }))
  });
  const selectedIndex = groups.findIndex((group) => group.id === selectedGroupId);
  const selectedGroup = groups[selectedIndex];
  const selectedMembers = memberQueries[selectedIndex]?.data ?? [];
  const candidates = courseMembers.filter(
    (member) =>
      member.role === "STUDENT" &&
      !selectedMembers.some((current) => current.personId === member.personId)
  );

  useEffect(() => {
    if (selectedGroupId && !groups.some((group) => group.id === selectedGroupId)) {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete("group");
          return next;
        },
        { replace: true }
      );
      setPersonId("");
    }
  }, [groups, selectedGroupId, setParams]);

  const refreshGroups = () => qc.invalidateQueries({ queryKey: ["courses", courseId, "groups"] });
  const assignMutation = useMutation({
    mutationFn: () => assignStudyGroupMember(courseId, selectedGroupId, personId),
    onSuccess: () => {
      setPersonId("");
      void refreshGroups();
      toast.success("Студент добавлен в группу");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось изменить состав группы."))
  });
  const removeMutation = useMutation({
    mutationFn: (memberId: string) => removeStudyGroupMember(courseId, selectedGroupId, memberId),
    onSuccess: () => {
      void refreshGroups();
      toast.success("Студент исключён из группы");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось изменить состав группы."))
  });

  if (groups.length === 0) return <p className="muted">Нет групп.</p>;

  return (
    <div className="group-manager">
      <div className="group-manager__master">
        <SearchField value={query} onChange={setQuery} placeholder="Найти учебную группу" />
        <ul className="group-manager__list">
          {groups.map((group, index) => {
            if (!includesQuery(query, group.name)) return null;
            const members = memberQueries[index].data;
            const active = group.id === selectedGroupId;
            const [name, ...description] = group.name.split(" · ");
            return (
              <li key={group.id} className={active ? "group-row group-row--active" : "group-row"}>
                <button
                  type="button"
                  className="group-row__select"
                  onClick={() => {
                    setSelectedGroupId(group.id);
                    setPersonId("");
                  }}
                  aria-current={active ? "true" : undefined}
                >
                  <span>
                    <strong>{name}</strong>
                    <small>
                      {members
                        ? `${description.length ? description.join(" · ") + " · " : ""}Студентов: ${members.length}`
                        : memberQueries[index].isError
                          ? "Состав недоступен"
                          : "Загрузка состава…"}
                    </small>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
        {!groups.some((group) => includesQuery(query, group.name)) && (
          <p className="muted">Группы не найдены.</p>
        )}
      </div>

      {selectedGroup && (
        <section className="group-composition" aria-labelledby="group-composition-title">
          <Button
            type="button"
            variant="ghost"
            className="group-composition__back"
            onClick={() => {
              setSelectedGroupId("");
              setPersonId("");
            }}
          >
            <ArrowLeft size={16} /> К учебным группам
          </Button>
          <div className="group-composition__heading">
            <div>
              <h3 id="group-composition-title">{selectedGroup.name.split(" · ")[0]}</h3>
              <p className="muted">
                {selectedGroup.name.split(" · ").slice(1).join(" · ") || "Учебная группа курса"}
              </p>
            </div>
            <ConfirmActionButton
              title="Удалить группу?"
              description="Группа будет удалена из курса. Участники курса сохранятся."
              variant="ghost"
              size="icon"
              label={`Удалить учебную группу: ${selectedGroup.name}`}
              disabled={deleting}
              onConfirm={() => onDelete(selectedGroup.id)}
            >
              <MoreHorizontal aria-hidden="true" />
            </ConfirmActionButton>
          </div>
          <div className="group-composition__assign">
            <Select
              value={personId}
              onValueChange={setPersonId}
              disabled={
                candidates.length === 0 ||
                memberQueries[selectedIndex]?.isLoading ||
                memberQueries[selectedIndex]?.isError
              }
            >
              <SelectTrigger aria-label="Студент для добавления">
                <SelectValue
                  placeholder={
                    memberQueries[selectedIndex]?.isLoading
                      ? "Загрузка состава…"
                      : candidates.length === 0
                        ? "Нет студентов для добавления"
                        : "Выберите студента"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((member) => (
                  <SelectItem key={member.personId} value={member.personId}>
                    {member.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              disabled={
                !personId ||
                assignMutation.isPending ||
                memberQueries[selectedIndex]?.isLoading ||
                memberQueries[selectedIndex]?.isError
              }
              onClick={() => assignMutation.mutate()}
            >
              <Plus aria-hidden="true" />
              Добавить
            </Button>
          </div>
          {candidates.length === 0 &&
            !memberQueries[selectedIndex]?.isLoading &&
            !memberQueries[selectedIndex]?.isError && (
              <p className="muted" role="status">
                {courseMembers.some((member) => member.role === "STUDENT")
                  ? "Все студенты курса уже в этой группе."
                  : "В курсе пока нет студентов для добавления."}
              </p>
            )}
          {memberQueries[selectedIndex]?.isLoading && <p className="muted">Загрузка состава…</p>}
          {memberQueries[selectedIndex]?.isError && (
            <div className="form-error" role="alert">
              Не удалось загрузить состав группы.{" "}
              <Button
                variant="outline"
                onClick={() => void memberQueries[selectedIndex]?.refetch()}
              >
                Повторить
              </Button>
            </div>
          )}
          {selectedMembers.length === 0 &&
            !memberQueries[selectedIndex]?.isLoading &&
            !memberQueries[selectedIndex]?.isError && (
              <p className="muted">В группе пока нет студентов.</p>
            )}
          <ul className="group-composition__members">
            {selectedMembers.map((member) => (
              <li key={member.personId}>
                <span>{member.displayName}</span>
                <IconButton
                  type="button"
                  variant="ghost"
                  disabled={removeMutation.isPending}
                  onClick={() => removeMutation.mutate(member.personId)}
                  label={`Исключить ${member.displayName} из группы`}
                >
                  <UserMinus size={17} />
                </IconButton>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!selectedGroup && (
        <div className="group-composition__placeholder">
          <Users size={24} aria-hidden="true" />
          <p>Выберите учебную группу, чтобы посмотреть состав.</p>
        </div>
      )}
    </div>
  );
}
