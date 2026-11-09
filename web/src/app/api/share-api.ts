import { apiFetch } from "./http";
import { studentFetch, publicFetch } from "./student-api";
import type { components } from "./schema";
import { newOperationKey } from "./operation-key";
export type ShareStatus = components["schemas"]["ShareStatus"] & { transport?: "SFU" };
export type ShareViewer = components["schemas"]["ShareViewer"];
const path = (courseId: string, sessionId: string) =>
  `/courses/${courseId}/sessions/${sessionId}/screen-share`;
let provider: Promise<"sfu" | "legacy"> | undefined;
export function getMediaProvider(): Promise<"sfu" | "legacy"> {
  return (provider ??= publicFetch("/media/capabilities")
    .then((response) => response.json())
    .then((value) => (value.provider === "sfu" ? ("sfu" as const) : ("legacy" as const)))
    .catch((error) => {
      provider = undefined;
      throw error;
    }));
}
const controlPath = async (course: string, session: string) =>
  (await getMediaProvider()) === "sfu"
    ? `/courses/${course}/sessions/${session}/sfu-share`
    : path(course, session);
export type SfuTicket = { url: string; token: string; room: string; expiresAt: string };
export async function publisherSfuTicket(
  course: string,
  session: string,
  id: string
): Promise<SfuTicket> {
  return (
    await apiFetch(`/courses/${course}/sessions/${session}/sfu-share/${id}/ticket`, {
      method: "POST"
    })
  ).json();
}
export async function viewerSfuTicket(
  code: string,
  viewer: string,
  token: string,
  projector?: string | null,
  signal?: AbortSignal
): Promise<(ShareStatus & { ticket?: SfuTicket }) | null> {
  const route = projector
    ? `/projection/agent/view/sessions/${encodeURIComponent(code)}`
    : `/student/sessions/${encodeURIComponent(code)}`;
  const response = await (projector ? publicFetch : studentFetch)(`${route}/sfu-share/${viewer}`, {
    method: "POST",
    signal,
    headers: projector ? { "X-Projection-View-Token": projector } : { "X-Participant-Token": token }
  });
  return response.status === 204 ? null : response.json();
}
export async function startShare(
  courseId: string,
  sessionId: string,
  sourceName: string,
  operationKey = newOperationKey()
): Promise<ShareStatus> {
  return (
    await apiFetch(await controlPath(courseId, sessionId), {
      method: "POST",
      headers: { "Idempotency-Key": operationKey },
      body: JSON.stringify({ sourceName })
    })
  ).json();
}
export async function pollShare(
  courseId: string,
  sessionId: string,
  id: string
): Promise<ShareStatus> {
  return (await apiFetch(`${await controlPath(courseId, sessionId)}/${id}`)).json();
}
export async function offerShare(
  courseId: string,
  sessionId: string,
  id: string,
  viewerId: string,
  sdp: string
) {
  await apiFetch(`${path(courseId, sessionId)}/${id}/viewers/${viewerId}`, {
    method: "PUT",
    body: JSON.stringify({ sdp })
  });
}
export async function stopShare(courseId: string, sessionId: string, id: string) {
  await apiFetch(`${await controlPath(courseId, sessionId)}/${id}`, { method: "DELETE" });
}
export async function viewShare(
  code: string,
  viewerId: string,
  token: string,
  signal?: AbortSignal
): Promise<ShareViewer | null> {
  const res = await studentFetch(
    `/student/sessions/${encodeURIComponent(code)}/screen-share/viewers/${viewerId}`,
    { headers: token ? { "X-Participant-Token": token } : {}, signal }
  );
  return res.status === 204 ? null : res.json();
}
export async function answerShare(
  code: string,
  viewerId: string,
  token: string,
  id: string,
  sdp: string,
  signal?: AbortSignal
) {
  await studentFetch(
    `/student/sessions/${encodeURIComponent(code)}/screen-share/viewers/${viewerId}/${id}`,
    {
      method: "PUT",
      headers: token ? { "X-Participant-Token": token } : {},
      body: JSON.stringify({ sdp }),
      signal
    }
  );
}

export async function viewProjectionShare(
  code: string,
  viewerId: string,
  token: string,
  signal?: AbortSignal
): Promise<ShareViewer | null> {
  const response = await publicFetch(
    `/projection/agent/view/sessions/${encodeURIComponent(code)}/screen-share/viewers/${viewerId}`,
    { headers: { "X-Projection-View-Token": token }, signal }
  );
  return response.status === 204 ? null : response.json();
}

export async function answerProjectionShare(
  code: string,
  viewerId: string,
  token: string,
  shareId: string,
  sdp: string,
  signal?: AbortSignal
) {
  await publicFetch(
    `/projection/agent/view/sessions/${encodeURIComponent(code)}/screen-share/viewers/${viewerId}/${shareId}`,
    {
      method: "PUT",
      headers: { "X-Projection-View-Token": token },
      body: JSON.stringify({ sdp }),
      signal
    }
  );
}

export async function uploadShareFrame(
  courseId: string,
  sessionId: string,
  shareId: string,
  frame: Blob,
  signal: AbortSignal
) {
  await apiFetch(`${path(courseId, sessionId)}/${shareId}/frame`, {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
    body: frame,
    signal
  });
}

export async function getShareFrame(
  code: string,
  viewerId: string,
  token: string,
  signal?: AbortSignal
): Promise<Blob | null> {
  const response = await studentFetch(
    `/student/sessions/${encodeURIComponent(code)}/screen-share/viewers/${viewerId}/frame`,
    {
      headers: { Accept: "image/jpeg", ...(token ? { "X-Participant-Token": token } : {}) },
      signal
    }
  );
  return response.status === 204 ? null : response.blob();
}
export async function getProjectionShareFrame(
  code: string,
  viewerId: string,
  token: string,
  signal?: AbortSignal
): Promise<Blob | null> {
  const response = await publicFetch(
    `/projection/agent/view/sessions/${encodeURIComponent(code)}/screen-share/viewers/${viewerId}/frame`,
    { headers: { Accept: "image/jpeg", "X-Projection-View-Token": token }, signal }
  );
  return response.status === 204 ? null : response.blob();
}
