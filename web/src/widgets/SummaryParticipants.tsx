import { useSearchParams } from "react-router-dom";
import type { LectureSummary } from "../app/api/live-api";
import { SearchField, PaginationBar } from "./ListControls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";

const PAGE_SIZE = 25;

export function SummaryParticipants({ summary }: { summary: LectureSummary }) {
  const [params, setParams] = useSearchParams();
  const query = params.get("summaryParticipantSearch") ?? "";
  const groupNames = new Map(summary.groups.map((group) => [group.id, group.name]));
  for (const participant of summary.participants) {
    if (participant.groupId && !groupNames.has(participant.groupId)) {
      groupNames.set(participant.groupId, participant.groupName || "Группа без названия");
    }
  }
  const requestedGroup = params.get("summaryParticipantGroup") ?? "all";
  const group =
    requestedGroup === "none" || groupNames.has(requestedGroup) ? requestedGroup : "all";
  const term = query.trim().toLocaleLowerCase("ru");
  const participants = summary.participants
    .filter((participant) => {
      const inGroup =
        group === "all" ||
        (group === "none" ? !participant.groupId : participant.groupId === group);
      return inGroup && (!term || participant.displayName?.toLocaleLowerCase("ru").includes(term));
    })
    .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "", "ru"));
  const pageCount = Math.max(1, Math.ceil(participants.length / PAGE_SIZE));
  const requestedPage = Number(params.get("summaryParticipantPage") ?? 1);
  const page = Math.min(
    pageCount,
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  );
  const visible = participants.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function filter(key: string, value: string, replace = false) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete("summaryParticipantPage");
        return next;
      },
      { replace }
    );
  }

  return (
    <section
      className="session-analytics__section report-participants"
      aria-labelledby="participants-title"
    >
      <div className="session-analytics__section-heading">
        <div>
          <h2 id="participants-title">Участники занятия</h2>
          <p className="muted">Все, кто подключался к этому занятию.</p>
        </div>
        <span className="muted" role="status">
          Найдено: {participants.length}
        </span>
      </div>
      <div className="report-participants__filters">
        <SearchField
          value={query}
          placeholder="Найти участника по имени"
          onChange={(value) => filter("summaryParticipantSearch", value, true)}
        />
        <Select value={group} onValueChange={(value) => filter("summaryParticipantGroup", value)}>
          <SelectTrigger aria-label="Учебная группа участников">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все учебные группы</SelectItem>
            {[...groupNames].map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name || "Группа без названия"}
              </SelectItem>
            ))}
            <SelectItem value="none">Без учебной группы</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {visible.length === 0 ? (
        <p className="session-analytics__empty">
          {summary.participants.length === 0
            ? "К этому занятию никто не подключался."
            : query || group !== "all"
              ? "По выбранным условиям участников не найдено."
              : "Список участников пуст."}
        </p>
      ) : (
        <div className="report-groups__table report-participants__table">
          <table className="data-table" aria-label="Подключавшиеся участники">
            <thead>
              <tr>
                <th scope="col">Участник</th>
                <th scope="col">Учебная группа</th>
                <th scope="col">Подключился</th>
                <th scope="col">Завершил участие</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((participant, index) => (
                <tr
                  key={`${participant.personId}-${participant.channelType}-${participant.joinedAt}-${index}`}
                >
                  <td data-label="Участник">
                    <div className="report-participants__identity">
                      <strong>{participant.displayName?.trim() || "Участник без имени"}</strong>
                      {participant.kicked && <small className="muted">Исключён из занятия</small>}
                    </div>
                  </td>
                  <td data-label="Учебная группа">
                    {participant.groupName ||
                      (participant.groupId && groupNames.get(participant.groupId)) ||
                      "Без учебной группы"}
                  </td>
                  <td data-label="Подключился">
                    <ParticipantTime value={participant.joinedAt} />
                  </td>
                  <td data-label="Завершил участие">
                    <div className="report-participants__identity">
                      <ParticipantTime
                        value={
                          participant.leftAt || participant.completedAt || participant.lastSeenAt
                        }
                      />
                      {!participant.leftAt && participant.completedAt ? (
                        <small className="muted">До конца занятия</small>
                      ) : !participant.leftAt && participant.lastSeenAt ? (
                        <small className="muted">Последняя связь</small>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PaginationBar
        page={page}
        pageCount={pageCount}
        pageSize={PAGE_SIZE}
        total={participants.length}
        onPageChange={(value) =>
          setParams((current) => {
            const next = new URLSearchParams(current);
            next.set("summaryParticipantPage", String(value));
            return next;
          })
        }
      />
      <p className="muted report-method-note">
        Показаны сохранённые подключения, включая вышедших и исключённых участников. Один человек
        мог подключаться несколькими способами. «Последняя связь» — получение данных, обычно с
        точностью около 40 секунд. «До конца занятия» — получено его завершение. Для старых
        подключений время могло не сохраниться.
      </p>
    </section>
  );
}

function ParticipantTime({ value }: { value?: string | null }) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return <span className="muted">Не зафиксировано</span>;
  return (
    <time dateTime={value ?? undefined}>
      {new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      }).format(date)}
    </time>
  );
}
