import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Copy, RefreshCw } from "lucide-react";
import type { components } from "../app/api/schema";
import { createCourseInvitation } from "../app/api/courses-api";
import { Button, IconButton, LinkButton } from "../shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";

type CourseRole = "LECTURER" | "ASSISTANT" | "STUDENT";
type StudyGroup = components["schemas"]["StudyGroup"];
type Invitation = components["schemas"]["Invitation"];

export function CourseInvitePanel({
  courseId,
  groups,
  staffOnly = false
}: {
  courseId: string;
  groups: StudyGroup[];
  staffOnly?: boolean;
}) {
  const [role, setRole] = useState<CourseRole>(staffOnly ? "LECTURER" : "STUDENT");
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
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Скопировано");
    } catch {
      toast.error("Не удалось скопировать. Выделите код и скопируйте его вручную.");
    }
  }
  function registrationUrl(code: string) {
    const url = new URL(window.location.href);
    url.hash = `/register?code=${encodeURIComponent(code)}`;
    return url.toString();
  }
  return (
    <div className="invite-panel">
      <label className="field">
        <span>Роль участника</span>
        <Select
          disabled={inviteMutation.isPending}
          value={role}
          onValueChange={(value) => {
            setRole(value as CourseRole);
            setLastInvite(null);
          }}
        >
          <SelectTrigger aria-label="Роль участника">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {!staffOnly && <SelectItem value="STUDENT">Студент</SelectItem>}
            <SelectItem value="ASSISTANT">Ассистент</SelectItem>
            <SelectItem value="LECTURER">Преподаватель</SelectItem>
          </SelectContent>
        </Select>
        <small className="muted">Роль относится к этому курсу.</small>
      </label>
      {role === "STUDENT" && (
        <label className="field">
          <span>Учебная группа</span>
          <Select
            disabled={inviteMutation.isPending}
            value={groupId}
            onValueChange={(value) => {
              setGroupId(value);
              setLastInvite(null);
            }}
          >
            <SelectTrigger aria-label="Учебная группа">
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
      {lastInvite ? (
        <div className="invite-result">
          <span className="invite-result__label">Код приглашения</span>
          <div className="invite-code-row">
            <code className="invite-code">{lastInvite.code}</code>
            <IconButton
              label="Скопировать код приглашения"
              onClick={() => void copy(lastInvite.code)}
            >
              <Copy />
            </IconButton>
          </div>
          <span className="muted">
            Действует до {new Date(lastInvite.expiresAt).toLocaleDateString("ru-RU")}
          </span>
          <Button onClick={() => void copy(registrationUrl(lastInvite.code))}>
            <Copy />
            Скопировать ссылку регистрации
          </Button>
          <Button
            variant="outline"
            disabled={inviteMutation.isPending}
            onClick={() => inviteMutation.mutate()}
          >
            <RefreshCw />
            {inviteMutation.isPending ? "Создаём…" : "Сгенерировать новый код"}
          </Button>
          <LinkButton to={`/register?code=${encodeURIComponent(lastInvite.code)}`} variant="ghost">
            Открыть регистрацию
          </LinkButton>
        </div>
      ) : (
        <Button disabled={inviteMutation.isPending} onClick={() => inviteMutation.mutate()}>
          {inviteMutation.isPending ? "Создаём…" : "Сгенерировать код"}
        </Button>
      )}
    </div>
  );
}
