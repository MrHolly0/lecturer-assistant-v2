import { apiFetch } from "./http";
import { publicFetch, studentFetch } from "./student-api";
import type { components } from "./schema";

type PublishScope = { courseId: string; sessionId: string; shareId: string };
export type VideoViewerScope = {
  code: string;
  viewerId: string;
  participantToken: string;
  projectionViewToken?: string | null;
};
export type ShareVideoManifest = components["schemas"]["ShareVideoMetadata"];
const publishPath = (scope: PublishScope, epoch: string) =>
  `/courses/${scope.courseId}/sessions/${scope.sessionId}/screen-share/${scope.shareId}/video/${epoch}`;

export async function uploadShareVideoInit(
  scope: PublishScope,
  epoch: string,
  codec: string,
  body: Blob,
  signal: AbortSignal
) {
  await apiFetch(`${publishPath(scope, epoch)}/init?codec=${encodeURIComponent(codec)}`, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body,
    signal
  });
}

export async function uploadShareVideoSegment(
  scope: PublishScope,
  epoch: string,
  sequence: number,
  body: Blob,
  signal: AbortSignal
) {
  await apiFetch(`${publishPath(scope, epoch)}/segments/${sequence}`, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body,
    signal
  });
}

async function videoFetch(scope: VideoViewerScope, suffix: string, signal: AbortSignal) {
  const code = encodeURIComponent(scope.code);
  const path = scope.projectionViewToken
    ? `/projection/agent/view/sessions/${code}/screen-share/viewers/${scope.viewerId}/video`
    : `/student/sessions/${code}/screen-share/viewers/${scope.viewerId}/video`;
  return (scope.projectionViewToken ? publicFetch : studentFetch)(path + suffix, {
    cache: "no-store",
    headers: {
      Accept: suffix ? "video/mp4" : "application/json",
      ...(scope.projectionViewToken
        ? { "X-Projection-View-Token": scope.projectionViewToken }
        : scope.participantToken
          ? { "X-Participant-Token": scope.participantToken }
          : {})
    },
    signal
  });
}

export async function getShareVideoManifest(scope: VideoViewerScope, signal: AbortSignal) {
  const response = await videoFetch(scope, "", signal);
  return response.status === 204 ? null : (response.json() as Promise<ShareVideoManifest>);
}

export async function getShareVideoPart(
  scope: VideoViewerScope,
  epoch: string,
  sequence: number | "init",
  signal: AbortSignal
) {
  const suffix = sequence === "init" ? "init" : `segments/${sequence}`;
  const response = await videoFetch(scope, `/${epoch}/${suffix}`, signal);
  return response.arrayBuffer();
}
