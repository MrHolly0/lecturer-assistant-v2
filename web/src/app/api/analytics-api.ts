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
  offset: number
): Promise<StudentAnalyticsPage> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (groupId) params.set("groupId", groupId);
  const res = await apiFetch(`/courses/${courseId}/analytics/students?${params}`);
  return res.json() as Promise<StudentAnalyticsPage>;
}

export async function getStudentAnalytics(
  courseId: string,
  personId: string
): Promise<StudentLearningAnalytics> {
  const res = await apiFetch(`/courses/${courseId}/analytics/students/${personId}`);
  return res.json() as Promise<StudentLearningAnalytics>;
}
