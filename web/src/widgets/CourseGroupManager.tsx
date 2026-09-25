import { useEffect, useRef, useState } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { UserMinus, Users } from "lucide-react";
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
import { ConfirmActionButton } from "./ConfirmActionButton";

type StudyGroup = components["schemas"]["StudyGroup"];

interface CourseGroupManagerProps {
  courseId: string;
  groups: StudyGroup[];
  courseMembers: CourseMember[];
  preferredGroupId?: string;
  deleting: boolean;
  onDelete: (groupId: string) => void;
}

export function CourseGroupManager({
  courseId,
  groups,
  courseMembers,
  preferredGroupId,
  deleting,
  onDelete
}: CourseGroupManagerProps) {
  const qc = useQueryClient();
  const appliedPreferredGroupId = useRef<string>();
  const [selectedGroupId, setSelectedGroupId] = useState(groups[0]?.id ?? "");
  const [personId, setPersonId] = useState("");
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
    if (
      preferredGroupId &&
      appliedPreferredGroupId.current !== preferredGroupId &&
      groups.some((group) => group.id === preferredGroupId)
    ) {
      appliedPreferredGroupId.current = preferredGroupId;
      setSelectedGroupId(preferredGroupId);
      setPersonId("");
      return;
    }
    if (!groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(groups[0]?.id ?? "");
      setPersonId("");
    }
  }, [groups, preferredGroupId, selectedGroupId]);

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
      <ul className="group-manager__list">
        {groups.map((group, index) => {
          const members = memberQueries[index].data;
          const active = group.id === selectedGroupId;
          return (
            <li key={group.id} className={active ? "group-row group-row--active" : "group-row"}>
              <button
                type="button"
                className="group-row__select"
                onClick={() => {
                  setSelectedGroupId(group.id);
                  setPersonId("");
                }}
                aria-pressed={active}
              >
                <Users size={18} aria-hidden="true" />
                <span>{group.name}</span>
                <small>{members ? `${members.length} чел.` : "…"}</small>
              </button>
              <ConfirmActionButton
                title="Удалить группу?"
                description="Группа будет удалена из курса. Участники курса сохранятся."
                disabled={deleting}
                onConfirm={() => onDelete(group.id)}
              >
                Удалить
              </ConfirmActionButton>
            </li>
          );
        })}
      </ul>

      {selectedGroup && (
        <section className="group-composition" aria-labelledby="group-composition-title">
          <div>
            <h3 id="group-composition-title">Состав: {selectedGroup.name}</h3>
            <p className="muted">Текущая учебная группа студента используется в аналитике курса.</p>
          </div>
          <div className="group-composition__assign">
            <Select value={personId} onValueChange={setPersonId}>
              <SelectTrigger aria-label="Студент для добавления">
                <SelectValue placeholder="Выберите студента" />
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
              disabled={!personId || assignMutation.isPending}
              onClick={() => assignMutation.mutate()}
            >
              Добавить
            </Button>
          </div>
          {memberQueries[selectedIndex]?.isLoading && <p className="muted">Загрузка состава…</p>}
          {memberQueries[selectedIndex]?.isError && (
            <p className="form-error">Не удалось загрузить состав группы.</p>
          )}
          {selectedMembers.length === 0 && !memberQueries[selectedIndex]?.isLoading && (
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
    </div>
  );
}
