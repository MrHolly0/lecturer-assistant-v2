import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, Search } from "lucide-react";
import {
  assignOrganizationMember,
  saveOrganizationUnit,
  type OrganizationMember,
  type OrganizationUnit,
  type UnitKind,
  type UnitRole
} from "../app/api/organization-api";
import { createAdminInvitation } from "../app/api/admin-api";
import { Button } from "../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";
import { userErrorMessage } from "../app/api/errors";

export interface UnitDraft {
  id: string | null;
  name: string;
  kind: UnitKind;
  parentId: string | null;
}

function DialogShell({
  title,
  description,
  children,
  onClose,
  className = ""
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={`org-dialog ${className}`}>
        <DialogHeader className="org-dialog-header">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function OrganizationUnitEditor({
  draft,
  units,
  onClose,
  onSaved
}: {
  draft: UnitDraft;
  units: OrganizationUnit[];
  onClose: () => void;
  onSaved: (unit: OrganizationUnit) => void;
}) {
  const [name, setName] = useState(draft.name);
  const mutation = useMutation({
    mutationFn: () =>
      saveOrganizationUnit(draft.id, {
        name: name.trim(),
        kind: draft.kind,
        parentId: draft.parentId
      }),
    onSuccess: (unit) => {
      onSaved(unit);
      toast.success(draft.id ? "Название группы изменено" : "Группа создана");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось сохранить группу"))
  });
  return (
    <DialogShell
      title={draft.id ? "Переименовать группу" : "Новая группа"}
      description={draft.id ? undefined : "Группа будет создана в текущем месте."}
      onClose={() => !mutation.isPending && onClose()}
      className="org-dialog--compact"
    >
      <form
        className="org-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <label className="field">
          <span>Название группы</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
            placeholder="Например, Методическое объединение"
          />
        </label>
        {!draft.id && draft.parentId && (
          <p className="org-dialog-context">
            В группе «{units.find((unit) => unit.id === draft.parentId)?.name ?? "…"}»
          </p>
        )}
        <DialogFooter className="org-dialog-actions">
          <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Отмена
          </Button>
          <Button type="submit" disabled={mutation.isPending || !name.trim()}>
            {mutation.isPending ? "Сохранение…" : draft.id ? "Сохранить" : "Создать группу"}
          </Button>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}

export function OrganizationUnitMoveDialog({
  unit,
  units,
  administrator,
  onClose,
  onSaved
}: {
  unit: OrganizationUnit;
  units: OrganizationUnit[];
  administrator: boolean;
  onClose: () => void;
  onSaved: (unit: OrganizationUnit) => void;
}) {
  const [parentId, setParentId] = useState(unit.parentId ?? "");
  const [search, setSearch] = useState("");
  const descendants = useMemo(() => {
    const found = new Set<string>([unit.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of units) {
        if (candidate.parentId && found.has(candidate.parentId) && !found.has(candidate.id)) {
          found.add(candidate.id);
          changed = true;
        }
      }
    }
    return found;
  }, [unit.id, units]);
  const candidates = units.filter(
    (candidate) =>
      candidate.canManage &&
      !descendants.has(candidate.id) &&
      `${candidate.name} ${groupPath(candidate, units)}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase())
  );
  const mutation = useMutation({
    mutationFn: () =>
      saveOrganizationUnit(unit.id, {
        name: unit.name,
        kind: unit.kind,
        parentId: parentId || null
      }),
    onSuccess: onSaved,
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось переместить группу"))
  });
  return (
    <DialogShell
      title={`Переместить «${unit.name}»`}
      description="Вместе с группой переместятся вложенные группы и сотрудники."
      onClose={() => !mutation.isPending && onClose()}
      className="org-dialog--picker"
    >
      <div className="org-dialog-body">
        <label className="org-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Найти родительскую группу</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Найти группу"
          />
        </label>
        <div className="org-picker-list" role="radiogroup" aria-label="Место для группы">
          {administrator && (
            <PickerOption
              name="group-parent"
              label="Верхний уровень"
              detail="Без родительской группы"
              selected={!parentId}
              onSelect={() => setParentId("")}
            />
          )}
          {candidates.map((candidate) => (
            <PickerOption
              name="group-parent"
              key={candidate.id}
              label={candidate.name}
              detail={groupPath(candidate, units)}
              selected={parentId === candidate.id}
              onSelect={() => setParentId(candidate.id)}
            />
          ))}
          {candidates.length === 0 && <p className="org-picker-empty">Группы не найдены.</p>}
        </div>
      </div>
      <DialogFooter className="org-dialog-actions">
        <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
          Отмена
        </Button>
        <Button
          onClick={() => mutation.mutate()}
          disabled={parentId === (unit.parentId ?? "") || mutation.isPending}
        >
          {mutation.isPending ? "Перемещение…" : "Переместить"}
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}

type MemberAction = "add" | "move" | "move-root" | "access";

export function OrganizationMemberEditor({
  action,
  member,
  people,
  units,
  targetUnitId,
  administrator,
  onClose,
  onSaved
}: {
  action: MemberAction;
  member: OrganizationMember | null;
  people: OrganizationMember[];
  units: OrganizationUnit[];
  targetUnitId: string | null;
  administrator: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [personId, setPersonId] = useState(member?.id ?? "");
  const [unitId, setUnitId] = useState(
    action === "add" ? targetUnitId ?? "" : action === "move-root" ? "" : member?.unitId ?? ""
  );
  const [unitRole, setUnitRole] = useState<UnitRole>(member?.unitRole ?? "MEMBER");
  const [search, setSearch] = useState("");
  const person = member ?? people.find((item) => item.id === personId);
  const choices = people.filter(
    (item) =>
      item.unitId !== targetUnitId &&
      `${item.displayName} ${item.email} ${item.unitName ?? ""}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase())
  );
  const mutation = useMutation({
    mutationFn: () => assignOrganizationMember(personId, unitId || null, unitRole),
    onSuccess: () => {
      onSaved();
      toast.success(
        action === "access"
          ? "Права обновлены"
          : action === "move-root"
            ? "Сотрудник перемещён в список «Без группы»"
            : "Место сотрудника обновлено"
      );
    },
    onError: (error) =>
      toast.error(userErrorMessage(error, "Не удалось изменить доступ сотрудника"))
  });
  const title =
    action === "add"
      ? "Добавить сотрудника"
      : action === "move-root"
        ? "Переместить из группы"
        : action === "move"
          ? "Переместить сотрудника"
          : "Права доступа";
  const targetName = units.find((unit) => unit.id === unitId)?.name ?? "Без группы";
  const sourceName = person?.unitName ?? "без группы";
  const requiresChoice = action === "add" || action === "move-root";
  return (
    <DialogShell
      title={title}
      description={
        action === "move-root"
          ? "Сотрудник перейдёт в общий список «Без группы»."
          : action === "add"
            ? `Место добавления: ${units.find((unit) => unit.id === targetUnitId)?.name ?? "Без группы"}.`
            : person?.displayName
      }
      onClose={() => !mutation.isPending && onClose()}
      className="org-dialog--picker"
    >
      {requiresChoice ? (
        <div className="org-dialog-body">
          <label className="org-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Найти сотрудника</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Имя или email"
            />
          </label>
          <div className="org-picker-list" aria-label="Сотрудники">
            {choices.map((candidate) => (
              <button
                type="button"
                className={`org-person-option ${personId === candidate.id ? "is-selected" : ""}`}
                key={candidate.id}
                aria-pressed={personId === candidate.id}
                onClick={() => {
                  setPersonId(candidate.id);
                  setUnitRole(
                    action === "move-root" || !targetUnitId
                      ? "MEMBER"
                      : candidate.unitRole ?? "MEMBER"
                  );
                }}
              >
                <span className="org-person-option__text">
                  <strong>{candidate.displayName}</strong>
                  <small>{candidate.email}</small>
                  <small>Сейчас: {candidate.unitName ?? "без группы"}</small>
                </span>
                {personId === candidate.id && <Check size={17} aria-label="Выбран" />}
              </button>
            ))}
            {choices.length === 0 && <p className="org-picker-empty">Сотрудники не найдены.</p>}
          </div>
        </div>
      ) : (
        <div className="org-dialog-form org-dialog-form--static">
          {action === "move" && (
            <>
              <label className="org-search">
                <Search size={16} aria-hidden="true" />
                <span className="sr-only">Найти группу</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Найти место"
                />
              </label>
              <div
                className="org-picker-list org-picker-list--short"
                role="radiogroup"
                aria-label="Место назначения"
              >
                {administrator && (
                  <PickerOption
                    name="member-destination"
                    label="Без группы"
                    detail="Общий список сотрудников"
                    selected={!unitId}
                    onSelect={() => {
                      setUnitId("");
                      setUnitRole("MEMBER");
                    }}
                  />
                )}
                {units
                  .filter(
                    (unit) =>
                      unit.canManage &&
                      `${unit.name} ${groupPath(unit, units)}`
                        .toLocaleLowerCase()
                        .includes(search.toLocaleLowerCase())
                  )
                  .map((unit) => (
                    <PickerOption
                      name="member-destination"
                      key={unit.id}
                      label={unit.name}
                      detail={groupPath(unit, units)}
                      selected={unitId === unit.id}
                      onSelect={() => {
                        setUnitId(unit.id);
                        setUnitRole(member?.unitRole ?? "MEMBER");
                      }}
                    />
                  ))}
              </div>
            </>
          )}
          {action === "access" && (
            <fieldset className="org-access-choice">
              <legend>Доступ в группе «{targetName}»</legend>
              <label>
                <input
                  type="radio"
                  name="unit-role"
                  checked={unitRole === "MEMBER"}
                  onChange={() => setUnitRole("MEMBER")}
                />
                <span>
                  <strong>Сотрудник</strong>
                  <small>Видит состав своей группы</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="unit-role"
                  checked={unitRole === "MANAGER"}
                  onChange={() => setUnitRole("MANAGER")}
                  disabled={!administrator}
                />
                <span>
                  <strong>Руководитель</strong>
                  <small>Управляет своей группой и вложенными группами</small>
                </span>
              </label>
              {!administrator && <small>Назначать руководителей может только администратор.</small>}
            </fieldset>
          )}
          {action === "move" &&
            person?.unitRole === "MANAGER" &&
            unitId !== person.unitId &&
            (unitId ? (
              <p className="org-inline-note" role="status">
                У сотрудника сохранится доступ руководителя. После переноса область его управления
                будет соответствовать новой группе.
              </p>
            ) : (
              <p className="org-inline-note" role="status">
                При переносе в список «Без группы» права руководителя будут сняты.
              </p>
            ))}
        </div>
      )}
      <DialogFooter className="org-dialog-actions">
        <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
          Отмена
        </Button>
        <Button
          onClick={() => mutation.mutate()}
          disabled={
            mutation.isPending ||
            !personId ||
            !person ||
            (action === "access" && !administrator) ||
            (action === "move" &&
              unitId === (member?.unitId ?? "") &&
              unitRole === (member?.unitRole ?? "MEMBER"))
          }
        >
          {mutation.isPending
            ? "Сохранение…"
            : action === "move-root"
              ? "Переместить в список «Без группы»"
              : action === "add"
                ? "Переместить сюда"
                : action === "move"
                  ? "Переместить"
                  : "Сохранить доступ"}
        </Button>
      </DialogFooter>
      {requiresChoice && person && person.unitId !== (targetUnitId ?? null) && (
        <p className="org-dialog-context">
          {person.displayName}: «{sourceName}» → «{targetName}». Доступ «
          {person.unitRole === "MANAGER" ? "руководитель" : "сотрудник"}» сохранится.
        </p>
      )}
    </DialogShell>
  );
}

export function OrganizationInvitationDialog({
  unit,
  onClose
}: {
  unit: OrganizationUnit | null;
  onClose: () => void;
}) {
  const [role, setRole] = useState<"LECTURER" | "ASSISTANT">("LECTURER");
  const [created, setCreated] = useState<{ code: string; expiresAt: string } | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      createAdminInvitation({
        role,
        ttlHours: 168,
        ...(unit ? { organizationUnitId: unit.id } : {})
      }),
    onSuccess: (invitation) => setCreated(invitation),
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось создать приглашение"))
  });
  const registrationLink = created
    ? `${new URL(import.meta.env.BASE_URL, window.location.origin).href}#/register?code=${encodeURIComponent(created.code)}`
    : "";
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(
        label === "Код приглашения" ? "Код приглашения скопирован" : `${label} скопирована`
      );
    } catch {
      toast.error("Не удалось скопировать. Выделите текст вручную.");
    }
  }
  return (
    <DialogShell
      title="Пригласить сотрудника"
      description={`После регистрации сотрудник попадёт ${unit ? `в группу «${unit.name}»` : "в общий список без группы"}.`}
      onClose={onClose}
      className="org-dialog--compact"
    >
      {created ? (
        <div className="org-invite-result">
          <label className="field">
            <span>Ссылка для регистрации</span>
            <input
              readOnly
              value={registrationLink}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <Button onClick={() => void copy(registrationLink, "Ссылка")}>
            <Copy size={16} />
            Скопировать ссылку
          </Button>
          <div className="org-invite-code">
            <p>
              Код: <code>{created.code}</code>
            </p>
            <Button variant="outline" onClick={() => void copy(created.code, "Код приглашения")}>
              <Copy size={15} />
              Скопировать код
            </Button>
          </div>
          <small>Действует до {new Date(created.expiresAt).toLocaleString("ru-RU")}</small>
          <DialogFooter className="org-dialog-actions">
            <Button onClick={onClose}>Готово</Button>
          </DialogFooter>
        </div>
      ) : (
        <div className="org-dialog-form org-dialog-form--static">
          <label className="field">
            <span>Роль</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as "LECTURER" | "ASSISTANT")}
            >
              <option value="LECTURER">Преподаватель</option>
              <option value="ASSISTANT">Ассистент</option>
            </select>
          </label>
          <p className="org-dialog-context">В группе новый сотрудник получит доступ «Сотрудник».</p>
          <DialogFooter className="org-dialog-actions">
            <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
              Отмена
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? "Создание…" : "Создать ссылку"}
            </Button>
          </DialogFooter>
        </div>
      )}
    </DialogShell>
  );
}

function PickerOption({
  name,
  label,
  detail,
  selected,
  onSelect
}: {
  name: string;
  label: string;
  detail: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label className={`org-picker-option ${selected ? "is-selected" : ""}`}>
      <input type="radio" name={name} checked={selected} onChange={onSelect} />
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </label>
  );
}

function groupPath(unit: OrganizationUnit, units: OrganizationUnit[]) {
  const names = [unit.name];
  const seen = new Set([unit.id]);
  let parent = units.find((candidate) => candidate.id === unit.parentId);
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    names.unshift(parent.name);
    parent = units.find((candidate) => candidate.id === parent?.parentId);
  }
  return names.join(" › ");
}
