import { AlertTriangle, UsersRound } from "lucide-react";
import type { JoinIssue } from "../app/api/studentGroupJoinIssue";
import type { StudentSessionGroup } from "../app/api/student-api";
import { Button } from "../shared/ui/button";
import { RadioGroup, RadioGroupItem } from "../shared/ui/radio-group";

interface StudentGroupJoinIssueProps {
  issue: JoinIssue;
  selectedGroupId: string;
  pending: boolean;
  onGroupChange: (groupId: string) => void;
  onRetry: () => void;
}

export function StudentGroupJoinIssue({
  issue,
  selectedGroupId,
  pending,
  onGroupChange,
  onRetry
}: StudentGroupJoinIssueProps) {
  if (issue.kind === "mismatch") {
    return (
      <section className="student-action-panel student-group-issue" role="alert">
        <AlertTriangle size={24} aria-hidden="true" />
        <div>
          <h2>Это занятие другой группы</h2>
          <p>
            Ваша текущая группа — <strong>{issue.currentGroup.name}</strong>. Занятие проводится для{" "}
            {formatGroupNames(issue.allowedGroups)}.
          </p>
          <p className="muted">
            Обратитесь к преподавателю: перевод между группами автоматически не выполняется.
          </p>
        </div>
        <Button type="button" variant="outline" disabled={pending} onClick={onRetry}>
          Проверить снова
        </Button>
      </section>
    );
  }

  return (
    <section className="student-action-panel student-group-choice">
      <UsersRound size={24} aria-hidden="true" />
      <div>
        <h2>Выберите свою группу</h2>
        <p className="muted">Она сохранится после подключения к занятию.</p>
      </div>
      <StudentGroupPicker
        groups={issue.allowedGroups}
        value={selectedGroupId}
        onChange={onGroupChange}
        embedded
      />
      <Button type="button" disabled={!selectedGroupId || pending} onClick={onRetry}>
        {pending ? "Подключаем…" : "Подключиться"}
      </Button>
    </section>
  );
}

export function StudentGroupPicker({
  groups,
  value,
  onChange,
  embedded = false
}: {
  groups: StudentSessionGroup[];
  value: string;
  onChange: (groupId: string) => void;
  embedded?: boolean;
}) {
  const Wrapper = embedded ? "div" : "section";
  return (
    <Wrapper
      className={embedded ? "student-group-picker" : "student-action-panel student-group-picker"}
      aria-labelledby="student-group-title"
    >
      <h2 id="student-group-title">Ваша группа</h2>
      <RadioGroup value={value} onValueChange={onChange}>
        {groups.map((group) => (
          <label key={group.id} className="student-group-option">
            <RadioGroupItem value={group.id} />
            <span>{group.name}</span>
          </label>
        ))}
      </RadioGroup>
    </Wrapper>
  );
}

function formatGroupNames(groups: StudentSessionGroup[]) {
  return groups.length === 1
    ? `группы «${groups[0].name}»`
    : `групп «${groups.map((group) => group.name).join("», «")}»`;
}
