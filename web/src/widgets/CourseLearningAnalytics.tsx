import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  getCourseGroupAnalytics,
  getStudentAnalytics,
  listStudentAnalytics,
  type LearningMetrics,
  type StudentLearningAnalytics
} from "../app/api/analytics-api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { PaginationBar } from "./ListControls";
import { LearningMetricsView } from "./LearningMetricsView";

const PAGE_SIZE = 20;
type SortMode = "name" | "errors" | "red";

export function CourseLearningAnalytics({
  courseId,
  initialStudentId,
  onStudentChange
}: {
  courseId: string;
  initialStudentId: string;
  onStudentChange: (studentId: string) => void;
}) {
  const [view, setView] = useState<"groups" | "students">("groups");
  const [groupId, setGroupId] = useState("all");
  const [page, setPage] = useState(1);
  const [studentId, setStudentId] = useState("");
  const [sort, setSort] = useState<SortMode>("name");
  const [detail, setDetail] = useState<{ title: string; metrics: LearningMetrics } | null>(null);
  const groupsQuery = useQuery({
    queryKey: ["analytics", courseId, "groups"],
    queryFn: () => getCourseGroupAnalytics(courseId)
  });
  const studentsQuery = useQuery({
    queryKey: ["analytics", courseId, "students", groupId, page],
    queryFn: () =>
      listStudentAnalytics(
        courseId,
        groupId === "all" ? null : groupId,
        PAGE_SIZE,
        (page - 1) * PAGE_SIZE
      ),
    enabled: view === "students",
    placeholderData: keepPreviousData
  });
  const detailQuery = useQuery({
    queryKey: ["analytics", courseId, "students", studentId],
    queryFn: () => getStudentAnalytics(courseId, studentId),
    enabled: Boolean(studentId)
  });
  const groups = groupsQuery.data?.groups ?? [];
  const pageCount = Math.max(1, Math.ceil((studentsQuery.data?.total ?? 0) / PAGE_SIZE));
  const students = useMemo(
    () => sortStudents(studentsQuery.data?.items ?? [], sort),
    [sort, studentsQuery.data?.items]
  );

  useEffect(() => {
    setPage(1);
    setStudentId("");
  }, [groupId]);

  useEffect(() => {
    if (!initialStudentId) return;
    setView("students");
    setStudentId(initialStudentId);
  }, [initialStudentId]);

  return (
    <section className="learning-analytics" aria-labelledby="learning-analytics-title">
      <div className="section-heading learning-analytics__heading">
        <div>
          <h2 id="learning-analytics-title">Учебная активность</h2>
          <p className="muted">Накопленные данные курса. Состав групп показывается текущий.</p>
        </div>
        <Tabs value={view} onValueChange={(value) => setView(value as typeof view)}>
          <TabsList>
            <TabsTrigger value="groups">Группы</TabsTrigger>
            <TabsTrigger value="students">Студенты</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {groupsQuery.isLoading && <p className="muted">Загрузка учебной аналитики…</p>}
      {groupsQuery.isError && (
        <div className="form-error" role="alert">
          Не удалось загрузить учебную аналитику.
        </div>
      )}

      {view === "groups" && groupsQuery.data && (
        <>
          <div className="learning-group-table">
            <div className="learning-group-row learning-group-row--header" aria-hidden="true">
              <span>Группа</span>
              <span>Состав</span>
              <span>Посещения</span>
              <span>Не понимаю</span>
              <span>Верно</span>
            </div>
            <GroupRow title="Весь курс" metrics={groupsQuery.data.overall} onOpen={setDetail} />
            {groups.map((group) => (
              <GroupRow
                key={group.groupId}
                title={group.groupName}
                metrics={group.metrics}
                onOpen={setDetail}
              />
            ))}
            {groupsQuery.data.ungrouped.memberCount > 0 && (
              <GroupRow
                title="Без группы"
                metrics={groupsQuery.data.ungrouped}
                onOpen={setDetail}
              />
            )}
            {hasObservedData(groupsQuery.data.unidentified) && (
              <GroupRow
                title="Неидентифицированные"
                metrics={groupsQuery.data.unidentified}
                onOpen={setDetail}
              />
            )}
          </div>
          {detail && (
            <div className="learning-group-detail">
              <h3>{detail.title}</h3>
              <LearningMetricsView metrics={detail.metrics} />
            </div>
          )}
          {groups.length === 0 && groupsQuery.data.overall.memberCount === 0 && (
            <p className="analytics-empty">Постоянных студентов и учебных групп пока нет.</p>
          )}
        </>
      )}

      {view === "students" && (
        <div className="student-analytics">
          <div className="student-analytics__toolbar">
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger aria-label="Фильтр по группе">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все группы</SelectItem>
                {groups.map((group) => (
                  <SelectItem key={group.groupId} value={group.groupId}>
                    {group.groupName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(value) => setSort(value as SortMode)}>
              <SelectTrigger aria-label="Сортировка студентов">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">По имени</SelectItem>
                <SelectItem value="errors">Больше ошибок на странице</SelectItem>
                <SelectItem value="red">Больше непонимания на странице</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {studentsQuery.isLoading && <p className="muted">Загрузка студентов…</p>}
          {studentsQuery.isError && (
            <div className="form-error" role="alert">
              Не удалось загрузить студентов.
            </div>
          )}
          {studentsQuery.data?.items.length === 0 && (
            <p className="analytics-empty">В выбранной группе студентов нет.</p>
          )}
          <ul className="student-analytics__list">
            {students.map((student) => (
              <li key={student.personId}>
                <button
                  type="button"
                  onClick={() => {
                    setStudentId(student.personId);
                    onStudentChange(student.personId);
                  }}
                  aria-pressed={studentId === student.personId}
                >
                  <span>
                    <strong>{student.displayName}</strong>
                    <small>{student.groups.map((g) => g.name).join(", ") || "Без группы"}</small>
                  </span>
                  <MetricLabel
                    label="Посещения"
                    value={String(student.metrics.sessionAttendances)}
                  />
                  <MetricLabel label="Верно" value={gradedLabel(student.metrics)} />
                  <MetricLabel label="Не понимаю" value={signalLabel(student.metrics)} />
                  <MetricLabel label="Вопросы" value={String(student.metrics.questionsAsked)} />
                </button>
              </li>
            ))}
          </ul>
          {studentsQuery.data && (
            <PaginationBar
              page={page}
              pageCount={pageCount}
              pageSize={PAGE_SIZE}
              total={studentsQuery.data.total}
              onPageChange={setPage}
            />
          )}
          {studentId && (
            <div className="student-analytics__detail">
              <button
                type="button"
                className="student-analytics__close"
                onClick={() => {
                  setStudentId("");
                  onStudentChange("");
                }}
              >
                Закрыть карточку
              </button>
              {detailQuery.isLoading && <p className="muted">Загрузка карточки…</p>}
              {detailQuery.isError && (
                <p className="form-error">Не удалось загрузить карточку студента.</p>
              )}
              {detailQuery.data && (
                <>
                  <h3>{detailQuery.data.displayName}</h3>
                  <LearningMetricsView metrics={detailQuery.data.metrics} />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function GroupRow({
  title,
  metrics,
  onOpen
}: {
  title: string;
  metrics: LearningMetrics;
  onOpen: (value: { title: string; metrics: LearningMetrics }) => void;
}) {
  return (
    <button
      type="button"
      className="learning-group-row"
      onClick={() => onOpen({ title, metrics })}
      aria-label={`${title}: состав ${metrics.memberCount}, посещений ${metrics.sessionAttendances}, сигналов не понимаю ${signalLabel(metrics)}, верных ответов ${gradedLabel(metrics)}`}
    >
      <strong>{title}</strong>
      <span data-label="Состав">{metrics.memberCount}</span>
      <span data-label="Посещения">{metrics.sessionAttendances}</span>
      <span data-label="Не понимаю">{signalLabel(metrics)}</span>
      <span data-label="Верно">{gradedLabel(metrics)}</span>
    </button>
  );
}

function MetricLabel({ label, value }: { label: string; value: string }) {
  return (
    <span className="student-metric">
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function gradedLabel(metrics: LearningMetrics) {
  return metrics.gradedAnswers === 0
    ? "—"
    : `${metrics.correctAnswers}/${metrics.gradedAnswers} · ${Math.round((metrics.correctRate ?? 0) * 100)}%`;
}

function signalLabel(metrics: LearningMetrics) {
  return metrics.signalCount === 0
    ? "—"
    : `${metrics.redSignals}/${metrics.signalCount} · ${Math.round((metrics.redShare ?? 0) * 100)}%`;
}

function sortStudents(items: StudentLearningAnalytics[], sort: SortMode) {
  return [...items].sort((a, b) => {
    if (sort === "errors")
      return (
        errorRate(b.metrics) - errorRate(a.metrics) ||
        b.metrics.gradedAnswers - a.metrics.gradedAnswers
      );
    if (sort === "red")
      return (
        redRate(b.metrics) - redRate(a.metrics) || b.metrics.signalCount - a.metrics.signalCount
      );
    return a.displayName.localeCompare(b.displayName, "ru");
  });
}

function errorRate(metrics: LearningMetrics) {
  return metrics.gradedAnswers === 0 ? -1 : 1 - (metrics.correctRate ?? 0);
}
function redRate(metrics: LearningMetrics) {
  return metrics.signalCount === 0 ? -1 : metrics.redSignals / metrics.signalCount;
}
function hasObservedData(metrics: LearningMetrics) {
  return (
    metrics.participantCount + metrics.signalCount + metrics.checkAnswers + metrics.questionsAsked >
    0
  );
}
