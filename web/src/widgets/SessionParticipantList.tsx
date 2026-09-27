import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  kickSessionParticipant,
  requestSessionParticipantName,
  type SessionParticipant
} from "../app/api/live-api";
import { userErrorMessage } from "../app/api/errors";
import { Button } from "../shared/ui/button";
import { ConfirmActionButton } from "./ConfirmActionButton";

export function SessionParticipantList({
  courseId,
  sessionId,
  participants
}: {
  courseId: string;
  sessionId: string;
  participants: SessionParticipant[];
}) {
  const queryClient = useQueryClient();
  const active = participants.filter((participant) => !participant.leftAt && !participant.kicked);
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["live", courseId, sessionId, "participants"] });
  const kick = useMutation({
    mutationFn: (personId: string) => kickSessionParticipant(courseId, sessionId, personId),
    onSuccess: () => {
      void invalidate();
      toast.success("Студент отключён. Он сможет войти снова.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось отключить студента."))
  });
  const requestName = useMutation({
    mutationFn: (personId: string) => requestSessionParticipantName(courseId, sessionId, personId),
    onSuccess: () => {
      void invalidate();
      toast.success("Запрос имени отправлен студенту.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось запросить имя."))
  });

  if (active.length === 0) return <p className="muted">Пока никто не подключился.</p>;
  return (
    <ul className="participant-list">
      {active.map((participant) => {
        const pendingName = Boolean(participant.nameRequestedAt && !participant.nameSubmittedAt);
        return (
          <li key={`${participant.personId}-${participant.channelType}`}>
            <div className="participant-list__identity">
              <strong>{participant.displayName}</strong>
              <small>
                {participant.nameSubmittedAt
                  ? "Имя и фамилия указаны студентом"
                  : participant.channelType}
                {" · "}
                {new Date(participant.joinedAt).toLocaleTimeString("ru-RU", {
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </small>
            </div>
            <div className="participant-list__actions">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={requestName.isPending || pendingName}
                onClick={() => requestName.mutate(participant.personId)}
              >
                {pendingName ? "Имя запрошено" : "Запросить имя"}
              </Button>
              <ConfirmActionButton
                title={`Отключить ${participant.displayName}?`}
                description="Студент потеряет доступ к этому занятию, но сможет войти снова по коду."
                confirmLabel="Отключить"
                variant="outline"
                size="sm"
                disabled={kick.isPending}
                onConfirm={() => kick.mutate(participant.personId)}
              >
                Отключить
              </ConfirmActionButton>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
