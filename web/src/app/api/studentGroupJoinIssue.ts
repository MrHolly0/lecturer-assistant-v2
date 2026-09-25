import { ApiError } from "./errors";
import type { StudentSessionGroup } from "./student-api";

export type JoinIssue =
  | { kind: "selection"; allowedGroups: StudentSessionGroup[] }
  | {
      kind: "mismatch";
      currentGroup: StudentSessionGroup;
      allowedGroups: StudentSessionGroup[];
    };

export function joinIssueFromError(error: unknown): JoinIssue | null {
  if (!(error instanceof ApiError)) return null;
  const allowedGroups = readGroups(error.details?.allowedGroups);
  if (error.code === "GROUP_SELECTION_REQUIRED" && allowedGroups.length > 0) {
    return { kind: "selection", allowedGroups };
  }
  const currentGroup = readGroup(error.details?.currentGroup);
  if (error.code === "GROUP_MISMATCH" && currentGroup && allowedGroups.length > 0) {
    return { kind: "mismatch", currentGroup, allowedGroups };
  }
  return null;
}

function readGroups(value: unknown): StudentSessionGroup[] {
  if (!Array.isArray(value)) return [];
  return value.map(readGroup).filter((group): group is StudentSessionGroup => group !== null);
}

function readGroup(value: unknown): StudentSessionGroup | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.name === "string"
    ? { id: record.id, name: record.name }
    : null;
}
