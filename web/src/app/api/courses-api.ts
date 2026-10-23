import type { components } from "./schema";
import { apiFetch } from "./http";
import { newOperationKey } from "./operation-key";

type Course = components["schemas"]["Course"];
type CourseDetails = components["schemas"]["CourseDetails"];
type CreateCourseRequest = components["schemas"]["CreateCourseRequest"];
type StudyGroup = components["schemas"]["StudyGroup"];
type CreateStudyGroupRequest = components["schemas"]["CreateStudyGroupRequest"];
type CreateCourseInvitationRequest = components["schemas"]["CreateCourseInvitationRequest"];
type Invitation = components["schemas"]["Invitation"];
export type CourseMember = components["schemas"]["CourseMember"];

export async function listCourses(): Promise<Course[]> {
  const res = await apiFetch("/courses");
  return res.json() as Promise<Course[]>;
}

export async function createCourse(
  req: CreateCourseRequest,
  key = newOperationKey()
): Promise<Course> {
  const res = await apiFetch("/courses", {
    method: "POST",
    body: JSON.stringify(req),
    headers: { "Idempotency-Key": key }
  });
  return res.json() as Promise<Course>;
}

export async function archiveCourse(courseId: string): Promise<void> {
  await apiFetch(`/courses/${courseId}`, { method: "DELETE" });
}

export async function restoreCourse(courseId: string): Promise<void> {
  await apiFetch(`/courses/${courseId}/restore`, { method: "POST" });
}

export async function hardDeleteCourse(courseId: string): Promise<void> {
  await apiFetch(`/courses/${courseId}/hard`, { method: "DELETE" });
}

export async function getCourse(courseId: string): Promise<CourseDetails> {
  const res = await apiFetch(`/courses/${courseId}`);
  return res.json() as Promise<CourseDetails>;
}

export async function createStudyGroup(
  courseId: string,
  req: CreateStudyGroupRequest,
  key = newOperationKey()
): Promise<StudyGroup> {
  const res = await apiFetch(`/courses/${courseId}/groups`, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify(req)
  });
  return res.json() as Promise<StudyGroup>;
}

export async function deleteStudyGroup(courseId: string, groupId: string): Promise<void> {
  await apiFetch(`/courses/${courseId}/groups/${groupId}`, { method: "DELETE" });
}

export async function listStudyGroupMembers(
  courseId: string,
  groupId: string
): Promise<CourseMember[]> {
  const res = await apiFetch(`/courses/${courseId}/groups/${groupId}/members`);
  return res.json() as Promise<CourseMember[]>;
}

export async function assignStudyGroupMember(
  courseId: string,
  groupId: string,
  personId: string
): Promise<void> {
  await apiFetch(`/courses/${courseId}/groups/${groupId}/members/${personId}`, { method: "PUT" });
}

export async function removeStudyGroupMember(
  courseId: string,
  groupId: string,
  personId: string
): Promise<void> {
  await apiFetch(`/courses/${courseId}/groups/${groupId}/members/${personId}`, {
    method: "DELETE"
  });
}

export type CourseRole = components["schemas"]["CourseRole"];

export type CourseMemberCandidate = components["schemas"]["CourseMemberCandidate"];
export type AddCourseMemberRequest = components["schemas"]["AddCourseMemberRequest"];

export async function findCourseMemberCandidate(
  courseId: string,
  email: string
): Promise<CourseMemberCandidate[]> {
  const params = new URLSearchParams({ email });
  const res = await apiFetch(`/courses/${courseId}/member-candidates?${params.toString()}`);
  return res.json() as Promise<CourseMemberCandidate[]>;
}

export async function addCourseMember(
  courseId: string,
  req: AddCourseMemberRequest
): Promise<CourseMember> {
  const res = await apiFetch(`/courses/${courseId}/members`, {
    method: "POST",
    body: JSON.stringify(req)
  });
  return res.json() as Promise<CourseMember>;
}

export async function removeCourseMember(courseId: string, personId: string): Promise<void> {
  await apiFetch(`/courses/${courseId}/members/${personId}`, { method: "DELETE" });
}

export async function changeCourseMemberRole(
  courseId: string,
  personId: string,
  role: CourseRole
): Promise<void> {
  await apiFetch(`/courses/${courseId}/members/${personId}/role`, {
    method: "PUT",
    body: JSON.stringify({ role })
  });
}

export async function changeCourseOwner(courseId: string, personId: string): Promise<void> {
  await apiFetch(`/courses/${courseId}/owner`, {
    method: "PUT",
    body: JSON.stringify({ personId })
  });
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
