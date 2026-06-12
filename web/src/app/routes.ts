import type { components } from "./api/schema";

export type UserRole = components["schemas"]["UserProfile"]["role"];

export function landingPath(role: UserRole): string {
  return role === "STUDENT" ? "/home" : "/courses";
}
