import { UsersRound } from "lucide-react";
import type { SessionGroupRef } from "../app/api/live-api";

interface SessionGroupsProps {
  groups?: SessionGroupRef[];
  compact?: boolean;
}

export function SessionGroups({ groups = [], compact = false }: SessionGroupsProps) {
  if (groups.length === 0) return null;

  return (
    <span className={`session-groups${compact ? " session-groups--compact" : ""}`}>
      <UsersRound size={compact ? 14 : 16} aria-hidden="true" />
      <span>{groups.map((group) => group.name).join(", ")}</span>
    </span>
  );
}
