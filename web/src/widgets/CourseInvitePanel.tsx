import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { components } from "../app/api/schema";
import { createCourseInvitation } from "../app/api/courses-api";
import { Button, LinkButton } from "../shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";

type CourseRole = "LECTURER" | "ASSISTANT" | "STUDENT";
type StudyGroup = components["schemas"]["StudyGroup"];
type Invitation = components["schemas"]["Invitation"];

export function CourseInvitePanel({
  courseId,
  groups
}: {
  courseId: string;
  groups: StudyGroup[];
}) {
  const [role, setRole] = useState<CourseRole>("STUDENT");
  const [groupId, setGroupId] = useState("none");
  const [lastInvite, setLastInvite] = useState<Invitation | null>(null);
  const inviteMutation = useMutation({
    mutationFn: () =>
      createCourseInvitation(courseId, {
        role,
        ttlHours: 168,
        ...(role === "STUDENT" && groupId !== "none" ? { groupId } : {})
      }),
    onSuccess: setLastInvite,
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось создать приглашение."))
  });

  return (
    <div className="invite-panel">
      <label className="field">
        <span>Роль участника</span>
        <Select value={role} onValueChange={(value) => setRole(value as CourseRole)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="STUDENT">Студент</SelectItem>
            <SelectItem value="ASSISTANT">Ассистент</SelectItem>
            <SelectItem value="LECTURER">Лектор</SelectItem>
          </SelectContent>
        </Select>
      </label>
      {role === "STUDENT" && groups.length > 0 && (
        <label className="field">
          <span>Учебная группа</span>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Без группы</SelectItem>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}
      <Button
        type="button"
        onClick={() => {
          setLastInvite(null);
          inviteMutation.mutate();
        }}
        disabled={inviteMutation.isPending}
      >
        Сгенерировать код
      </Button>
      {lastInvite && (
        <div className="invite-result">
          <code className="invite-code">{lastInvite.code}</code>
          <span className="muted">
            до {new Date(lastInvite.expiresAt).toLocaleDateString("ru-RU")}
          </span>
          <LinkButton
            to={`/register?code=${encodeURIComponent(lastInvite.code)}`}
            variant="outline"
          >
            Ссылка для регистрации
          </LinkButton>
        </div>
      )}
    </div>
  );
}
