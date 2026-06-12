import type { components } from "./schema";
import { apiFetch } from "./http";

type Course = components["schemas"]["Course"];
type CourseDetails = components["schemas"]["CourseDetails"];
type CreateCourseRequest = components["schemas"]["CreateCourseRequest"];
type StudyGroup = components["schemas"]["StudyGroup"];
type CreateStudyGroupRequest = components["schemas"]["CreateStudyGroupRequest"];
type CreateCourseInvitationRequest = components["schemas"]["CreateCourseInvitationRequest"];
type Invitation = components["schemas"]["Invitation"];

export async function listCourses(): Promise<Course[]> {
  const res = await apiFetch("/courses");
  return res.json() as Promise<Course[]>;
}

export async function createCourse(req: CreateCourseRequest): Promise<Course> {
  const res = await apiFetch("/courses", { method: "POST", body: JSON.stringify(req) });
  return res.json() as Promise<Course>;
}

export async function archiveCourse(courseId: string): Promise<void> {
  await apiFetch(`/courses/${courseId}`, { method: "DELETE" });
}

export async function getCourse(courseId: string): Promise<CourseDetails> {
  const res = await apiFetch(`/courses/${courseId}`);
  return res.json() as Promise<CourseDetails>;
}

export async function createStudyGroup(
  courseId: string,
  req: CreateStudyGroupRequest
): Promise<StudyGroup> {
  const res = await apiFetch(`/courses/${courseId}/groups`, {
    method: "POST",
    body: JSON.stringify(req)
  });
  return res.json() as Promise<StudyGroup>;
}

export async function deleteStudyGroup(courseId: string, groupId: string): Promise<void> {
  await apiFetch(`/courses/${courseId}/groups/${groupId}`, { method: "DELETE" });
}

export async function createCourseInvitation(
  courseId: string,
  req: CreateCourseInvitationRequest
): Promise<Invitation> {
  const res = await apiFetch(`/courses/${courseId}/invitations`, {
    method: "POST",
    body: JSON.stringify(req)
  });
  return res.json() as Promise<Invitation>;
}
