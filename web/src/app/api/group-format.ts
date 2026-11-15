import { apiFetch } from "./http";

export interface GroupChoice {
  code: string;
  label: string;
  aliases: string[];
}
export interface GroupField {
  id: string;
  label: string;
  kind: "CHOICE" | "YEAR" | "NUMBER";
  prefix: string;
  width: number;
  yearBase: number;
  defaultValue: string | null;
  choices: GroupChoice[];
}
export interface GroupFormatPolicy {
  revision: number;
  enabled: boolean;
  fields: GroupField[];
}
export interface GroupInput {
  name: string;
  parts?: Record<string, string>;
}
export interface GroupPreview {
  valid: boolean;
  name: string | null;
  parts: Record<string, string>;
  message: string | null;
}
export async function getGroupFormat(): Promise<GroupFormatPolicy> {
  return (await apiFetch("/group-format")).json();
}
export async function previewGroup(input: {
  name?: string;
  parts?: Record<string, string>;
}): Promise<GroupPreview> {
  return (
    await apiFetch("/group-format/preview", { method: "POST", body: JSON.stringify(input) })
  ).json();
}
export async function saveGroupFormat(policy: GroupFormatPolicy): Promise<GroupFormatPolicy> {
  return (
    await apiFetch("/admin/group-format", { method: "PUT", body: JSON.stringify(policy) })
  ).json();
}
export async function reconcileGroups(
  revision: number
): Promise<{ matched: number; unrecognized: number; hasMore: boolean }> {
  return (
    await apiFetch("/admin/group-format/reconcile", {
      method: "POST",
      body: JSON.stringify({ revision })
    })
  ).json();
}
export function exampleGroupFormat(revision: number): GroupFormatPolicy {
  return {
    revision,
    enabled: true,
    fields: [
      {
        id: "level",
        label: "Уровень образования",
        kind: "CHOICE",
        prefix: "",
        width: 0,
        yearBase: 0,
        defaultValue: "б",
        choices: [
          { code: "б", label: "Бакалавриат", aliases: [] },
          { code: "м", label: "Магистратура", aliases: [] }
        ]
      },
      {
        id: "program",
        label: "Направление",
        kind: "CHOICE",
        prefix: "",
        width: 0,
        yearBase: 0,
        defaultValue: null,
        choices: [{ code: "ИСТ", label: "Информационные системы и технологии", aliases: [] }]
      },
      {
        id: "year",
        label: "Год поступления",
        kind: "YEAR",
        prefix: "-",
        width: 2,
        yearBase: 2000,
        defaultValue: null,
        choices: []
      },
      {
        id: "number",
        label: "Номер группы",
        kind: "NUMBER",
        prefix: "",
        width: 1,
        yearBase: 0,
        defaultValue: null,
        choices: []
      }
    ]
  };
}
