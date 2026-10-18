import { useEffect, useMemo, useRef, useState } from "react";
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
import { includesQuery } from "../shared/lib/usePagedList";
import { PaginationBar, SearchField } from "./ListControls";
import { LearningMetricsView } from "./LearningMetricsView";
import { Button } from "../shared/ui/button";

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
  const studentDetailRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
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
    () =>
      sortStudents(studentsQuery.data?.items ?? [], sort).filter((student) =>
        includesQuery(query, student.displayName, ...student.groups.map((group) => group.name))
      ),
    [sort, studentsQuery.data?.items, query]
  );

  useEffect(() => {
    setPage(1);
    setStudentId("");
  }, [groupId]);

  useEffect(() => {
    if (studentId && window.matchMedia("(max-width: 760px)").matches) {
      studentDetailRef.current?.scrollIntoView({ block: "start" });
    }
  }, [studentId]);

  useEffect(() => {
    if (!initialStudentId) return;
    setView("students");
    setStudentId(initialStudentId);
  }, [initialStudentId]);

  return (
    <section className="learning-analytics" aria-labelledby="learning-analytics-title">
      <div className="section-heading learning-analytics__heading">
        <h2 id="learning-analytics-title" className="sr-only">
          Учебная активность
        </h2>
        <Tabs value={view} onValueChange={(value) => setView(value as typeof view)}>
          <TabsList>
            <TabsTrigger value="groups">Группы</TabsTrigger>
            <TabsTrigger value="students">Студенты</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <p className="muted preparation-analytics-note">
        Фактические данные курса. Состав учебных групп показывается текущий.
      </p>
      {groupsQuery.isLoading && <p className="muted">Загрузка учебной аналитики…</p>}
      {groupsQuery.isError && (
        <div className="analytics-load-error" role="alert">
          <p>Не удалось загрузить состав учебных групп.</p>
          <Button type="button" variant="outline" onClick={() => void groupsQuery.refetch()}>
            Повторить
          </Button>
        </div>
      )}

      {view === "groups" && groupsQuery.data && (
        <>
          <div className="learning-group-table">
            <div className="learning-group-row learning-group-row--header" aria-hidden="true">
              <span>Группа</span>
              <span>Участники</span>
              <span>Сигналы «Не понимаю»</span>
              <span>Ответов на проверки</span>
              <span>Вопросов</span>
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
                title="Участники без привязанного профиля"
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
          <div className="student-analytics__master">
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder={pageCount > 1 ? "Имя или группа на странице" : "Имя или группа"}
            />
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
              <div className="analytics-load-error" role="alert">
                <p>Не удалось загрузить аналитику студентов.</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void studentsQuery.refetch()}
                >
                  Повторить
                </Button>
              </div>
            )}
            {studentsQuery.data?.items.length === 0 && !studentsQuery.isError && (
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
          </div>
          {studentId ? (
            <div ref={studentDetailRef} className="student-analytics__detail">
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
                <div className="analytics-load-error" role="alert">
                  <p>Не удалось загрузить карточку студента.</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void detailQuery.refetch()}
                  >
                    Повторить
                  </Button>
                </div>
              )}
              {detailQuery.data && (
                <>
                  <h3>{detailQuery.data.displayName}</h3>
                  <LearningMetricsView metrics={detailQuery.data.metrics} />
                </>
              )}
            </div>
          ) : (
            <div className="student-analytics__detail student-analytics__detail--empty">
              <p className="muted">Выберите студента, чтобы посмотреть его данные.</p>
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
      <span data-label="Участники">{metrics.participantCount}</span>
      <span data-label="Сигналы «Не понимаю»">{metrics.redSignals}</span>
      <span data-label="Ответов на проверки">
        {metrics.checkAnswers === 0 ? "Нет данных" : metrics.checkAnswers}
      </span>
      <span data-label="Вопросов">{metrics.questionsAsked}</span>
    </button>
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
