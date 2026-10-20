import type { components } from "./schema";
import { apiFetch } from "./http";

export type CourseGroupAnalytics = components["schemas"]["CourseGroupAnalytics"];
export type LearningMetrics = components["schemas"]["LearningMetrics"];
export type StudentAnalyticsPage = components["schemas"]["StudentAnalyticsPage"];
export type StudentLearningAnalytics = components["schemas"]["StudentLearningAnalytics"];

export async function getCourseGroupAnalytics(courseId: string): Promise<CourseGroupAnalytics> {
  const res = await apiFetch(`/courses/${courseId}/analytics/groups`);
  return res.json() as Promise<CourseGroupAnalytics>;
}

export async function listStudentAnalytics(
  courseId: string,
  groupId: string | null,
  limit: number,
  offset: number,
  signal?: AbortSignal
): Promise<StudentAnalyticsPage> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (groupId) params.set("groupId", groupId);
  const res = await apiFetch(`/courses/${courseId}/analytics/students?${params}`, { signal });
  return res.json() as Promise<StudentAnalyticsPage>;
}

/** Load the complete group before filtering, sorting and paginating the visible list. */
export async function listAllStudentAnalytics(
  courseId: string,
  groupId: string | null,
  signal?: AbortSignal
): Promise<StudentLearningAnalytics[]> {
  const students = new Map<string, StudentLearningAnalytics>();
  let offset = 0;
  let total = 1;
  while (offset < total) {
    const page = await listStudentAnalytics(courseId, groupId, 100, offset, signal);
    total = page.total;
    for (const student of page.items) students.set(student.personId, student);
    offset += page.items.length;
    if (offset >= page.total) return [...students.values()];
    if (page.items.length === 0)
      throw new Error("Не удалось загрузить полный список студентов. Повторите загрузку.");
  }
  return [...students.values()];
}

export async function getStudentAnalytics(
  courseId: string,
  personId: string
): Promise<StudentLearningAnalytics> {
  const res = await apiFetch(`/courses/${courseId}/analytics/students/${personId}`);
  return res.json() as Promise<StudentLearningAnalytics>;
}
