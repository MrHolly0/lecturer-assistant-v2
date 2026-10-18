import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, Search } from "lucide-react";
import {
  assignOrganizationMember,
  getOrganizationMembers,
  moveOrganizationMembers,
  saveOrganizationUnit,
  type OrganizationMember,
  type OrganizationUnit,
  type UnitKind,
  type UnitIcon,
  type UnitRole
} from "../app/api/organization-api";
import { createAdminInvitation } from "../app/api/admin-api";
import { PaginationBar } from "./ListControls";
import { Button } from "../shared/ui/button";
import { pluralizeRu } from "../shared/lib/plural";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { userErrorMessage } from "../app/api/errors";
import { ORGANIZATION_ICONS } from "./organizationIcons";
import { OrganizationUnitIcon } from "./OrganizationUnitIcon";

export const MAX_BULK_MOVE_MEMBERS = 200;

export interface UnitDraft {
  id: string | null;
  name: string;
  kind: UnitKind;
  icon: UnitIcon;
  parentId: string | null;
}

function DialogShell({
  title,
  description,
  children,
  footer,
  onClose,
  onCloseAutoFocus,
  className = ""
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  className?: string;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={`org-dialog ${className}`} onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader className="org-dialog-header">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="org-dialog-body">{children}</div>
        {footer}
      </DialogContent>
    </Dialog>
  );
}

export function OrganizationUnitEditor({
  draft,
  units,
  onClose,
  onCloseAutoFocus,
  onSaved
}: {
  draft: UnitDraft;
  units: OrganizationUnit[];
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  onSaved: (unit: OrganizationUnit) => void;
}) {
  const [name, setName] = useState(draft.name);
  const [icon, setIcon] = useState<UnitIcon>(draft.icon ?? "FOLDER");
  const mutation = useMutation({
    mutationFn: () =>
      saveOrganizationUnit(draft.id, {
        name: name.trim(),
        kind: draft.kind,
        parentId: draft.parentId,
        icon
      }),
    onSuccess: (unit) => {
      onSaved(unit);
      toast.success(draft.id ? "Группа изменена" : "Группа создана");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось сохранить группу"))
  });
  return (
    <DialogShell
      onCloseAutoFocus={onCloseAutoFocus}
      title={draft.id ? "Изменить группу" : "Новая группа"}
      description={draft.id ? undefined : "Группа будет создана в текущем месте."}
      onClose={() => !mutation.isPending && onClose()}
      className="org-dialog--compact"
      footer={
        <DialogFooter className="org-dialog-actions">
          <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Отмена
          </Button>
          <Button
            type="submit"
            form="organization-unit-form"
            disabled={mutation.isPending || !name.trim()}
          >
            {mutation.isPending ? "Сохранение…" : draft.id ? "Сохранить" : "Создать группу"}
          </Button>
        </DialogFooter>
      }
    >
      <form
        className="org-dialog-form"
        id="organization-unit-form"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <label className="field">
          <span>Название группы</span>
          <input
            value={name}
            disabled={mutation.isPending}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
            placeholder="Например, Методическое объединение"
          />
        </label>
        <fieldset className="org-icon-picker" disabled={mutation.isPending}>
          <legend>Иконка группы</legend>
          <div className="org-icon-picker__options">
            {ORGANIZATION_ICONS.map(({ value, label, Icon }) => (
              <label key={value} className="org-icon-choice" title={label}>
                <input
                  type="radio"
                  name="organization-icon"
                  value={value}
                  checked={icon === value}
                  onChange={() => setIcon(value)}
                />
                <Icon size={22} aria-hidden="true" />
                <span className="sr-only">{label}</span>
              </label>
            ))}
          </div>
          <p className="muted">
            Выбрано: {ORGANIZATION_ICONS.find((option) => option.value === icon)?.label}
          </p>
        </fieldset>
        {!draft.id && draft.parentId && (
          <p className="org-dialog-context">
            В группе «{units.find((unit) => unit.id === draft.parentId)?.name ?? "…"}»
          </p>
        )}
      </form>
    </DialogShell>
  );
}

export function OrganizationUnitMoveDialog({
  unit,
  units,
  administrator,
  onClose,
  onCloseAutoFocus,
  onSaved
}: {
  unit: OrganizationUnit;
  units: OrganizationUnit[];
  administrator: boolean;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  onSaved: (unit: OrganizationUnit) => void;
}) {
  const [parentId, setParentId] = useState(unit.parentId ?? "");
  const [search, setSearch] = useState("");
  const [managerConfirmed, setManagerConfirmed] = useState(false);
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
  const sourceAncestors = getAncestorUnitIds(unit.parentId, units);
  const targetAncestors = getAncestorUnitIds(parentId || null, units);
  const sourceOnlyAncestorIds = sourceAncestors.filter((id) => !targetAncestors.includes(id));
  const targetOnlyAncestorIds = targetAncestors.filter((id) => !sourceAncestors.includes(id));
  const memberScopeIds = [
    ...new Set([sourceAncestors[0], targetAncestors[0]].filter((id): id is string => Boolean(id)))
  ];
  const managerReview = useQuery({
    queryKey: ["organization", "members", "unit-move-review", unit.id, ...memberScopeIds],
    queryFn: async () => {
      const scopes = await Promise.all(
        memberScopeIds.map((scopeId) => getOrganizationMembers(scopeId))
      );
      return [...new Map(scopes.flat().map((member) => [member.id, member])).values()];
    },
    enabled: memberScopeIds.length > 0
  });
  const affectedManagers = (managerReview.data ?? []).filter(
    (member) =>
      member.unitRole === "MANAGER" &&
      member.unitId !== null &&
      (sourceOnlyAncestorIds.includes(member.unitId) ||
        targetOnlyAncestorIds.includes(member.unitId))
  );
  const losingManagers = affectedManagers.filter(
    (member) => member.unitId !== null && sourceOnlyAncestorIds.includes(member.unitId)
  );
  const gainingManagers = affectedManagers.filter(
    (member) => member.unitId !== null && targetOnlyAncestorIds.includes(member.unitId)
  );
  const losingManagerGroups = [
    ...new Set(
      losingManagers.flatMap((member) =>
        member.unitId ? [units.find((candidate) => candidate.id === member.unitId)?.name ?? ""] : []
      )
    )
  ].filter(Boolean);
  const gainingManagerGroups = [
    ...new Set(
      gainingManagers.flatMap((member) =>
        member.unitId ? [units.find((candidate) => candidate.id === member.unitId)?.name ?? ""] : []
      )
    )
  ].filter(Boolean);
  const parentChanged = parentId !== (unit.parentId ?? "");
  const managementChanges = parentChanged && affectedManagers.length > 0;
  const destinationParent = units.find((candidate) => candidate.id === parentId);
  const destinationPath = destinationParent
    ? `${groupPath(destinationParent, units)} › ${unit.name}`
    : `Верхний уровень › ${unit.name}`;
  const reviewPending = memberScopeIds.length > 0 && managerReview.isFetching;
  const reviewError = memberScopeIds.length > 0 && managerReview.isError;
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
      onCloseAutoFocus={onCloseAutoFocus}
      title={`Переместить «${unit.name}»`}
      description="Вместе с группой переместятся вложенные группы и сотрудники."
      onClose={() => !mutation.isPending && onClose()}
      className="org-dialog--picker org-unit-move-dialog"
      footer={
        <DialogFooter className="org-dialog-actions">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Отмена
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={
              parentId === (unit.parentId ?? "") ||
              mutation.isPending ||
              reviewPending ||
              reviewError ||
              (managementChanges && !managerConfirmed)
            }
          >
            {mutation.isPending ? "Перемещение…" : "Переместить"}
          </Button>
        </DialogFooter>
      }
    >
      <div className="org-bulk-move-result org-unit-move-review">
        <span>Из</span>
        <strong>{groupPath(unit, units)}</strong>
        <span>В</span>
        <strong>{destinationPath}</strong>
        <span>Состав</span>
        <strong>
          {unit.totalMembersCount}{" "}
          {pluralizeRu(unit.totalMembersCount, "сотрудник", "сотрудника", "сотрудников")} ·{" "}
          {descendants.size - 1}{" "}
          {pluralizeRu(
            descendants.size - 1,
            "вложенная группа",
            "вложенные группы",
            "вложенных групп"
          )}
        </strong>
      </div>
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
            onSelect={() => {
              setParentId("");
              setManagerConfirmed(false);
            }}
          />
        )}
        {candidates.map((candidate) => (
          <PickerOption
            name="group-parent"
            key={candidate.id}
            label={candidate.name}
            icon={candidate.icon}
            detail={groupParentPath(candidate, units)}
            selected={parentId === candidate.id}
            onSelect={() => {
              setParentId(candidate.id);
              setManagerConfirmed(false);
            }}
          />
        ))}
        {candidates.length === 0 && !administrator && (
          <p className="org-picker-empty">Подходящих групп нет.</p>
        )}
      </div>
      {managementChanges && (
        <>
          <p className="org-inline-note" role="status">
            {losingManagers.length > 0 && (
              <>
                У {losingManagers.length}{" "}
                {pluralizeRu(
                  losingManagers.length,
                  "руководителя",
                  "руководителей",
                  "руководителей"
                )}{" "}
                из {losingManagerGroups.map((name) => "«" + name + "»").join(", ")} область
                управления уменьшится.
              </>
            )}
            {gainingManagers.length > 0 && (
              <>
                {losingManagers.length > 0 ? " У " : "У "}
                {gainingManagers.length}{" "}
                {pluralizeRu(
                  gainingManagers.length,
                  "руководителя",
                  "руководителей",
                  "руководителей"
                )}{" "}
                из {gainingManagerGroups.map((name) => "«" + name + "»").join(", ")} область
                управления расширится.
              </>
            )}
          </p>
          <label className="org-manager-consent">
            <input
              type="checkbox"
              checked={managerConfirmed}
              onChange={(event) => setManagerConfirmed(event.target.checked)}
            />
            <span>Подтверждаю изменение области управления при переносе группы.</span>
          </label>
        </>
      )}
      {reviewPending && (
        <p className="org-inline-state" role="status">
          Проверяем изменение области управления…
        </p>
      )}
      {reviewError && (
        <div className="org-state org-state--inline" role="alert">
          <p>Не удалось проверить изменение прав руководителей.</p>
          <Button variant="outline" onClick={() => void managerReview.refetch()}>
            Попробовать снова
          </Button>
        </div>
      )}
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
  onCloseAutoFocus,
  onSaved
}: {
  action: MemberAction;
  member: OrganizationMember | null;
  people: OrganizationMember[];
  units: OrganizationUnit[];
  targetUnitId: string | null;
  administrator: boolean;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  onSaved: () => void;
}) {
  const [personId, setPersonId] = useState(member?.id ?? "");
  const [choicePage, setChoicePage] = useState(1);
  const choicePageSize = 20;
  const [unitId, setUnitId] = useState(
    action === "add" ? targetUnitId ?? "" : action === "move-root" ? "" : member?.unitId ?? ""
  );
  const [unitRole, setUnitRole] = useState<UnitRole>(member?.unitRole ?? "MEMBER");
  const [search, setSearch] = useState("");
  const [managerConfirmed, setManagerConfirmed] = useState(false);
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
  const sourceUnit = units.find((unit) => unit.id === person?.unitId);
  const sourceName = sourceUnit ? groupPath(sourceUnit, units) : "Без группы";
  const targetPath = units.find((unit) => unit.id === unitId);
  const destinationName = targetPath ? groupPath(targetPath, units) : "Без группы";
  const managerMoveChangesScope =
    Boolean(person?.unitRole === "MANAGER") &&
    (action === "add" || action === "move" || action === "move-root") &&
    (unitId || null) !== (person?.unitId ?? null);
  const managementChanges =
    managerMoveChangesScope ||
    Boolean(action === "access" && member?.unitRole !== "MANAGER" && unitRole === "MANAGER");
  const requiresChoice = action === "add" || action === "move-root";
  return (
    <DialogShell
      onCloseAutoFocus={onCloseAutoFocus}
      title={title}
      description={
        action === "move-root"
          ? "Сотрудник перейдёт в общий список «Без группы»."
          : action === "add"
            ? `Место добавления: ${units.find((unit) => unit.id === targetUnitId)?.name ?? "Без группы"}.`
            : person?.displayName
      }
      onClose={() => !mutation.isPending && onClose()}
      className={action === "access" ? "org-dialog--access" : "org-dialog--picker"}
      footer={
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
              (managementChanges && !managerConfirmed) ||
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
      }
    >
      {requiresChoice ? (
        <div className="org-member-editor-content">
          <label className="org-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Найти сотрудника</span>
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setChoicePage(1);
              }}
              placeholder="Имя или email"
            />
          </label>
          <div className="org-picker-list" aria-label="Сотрудники">
            {choices
              .slice((choicePage - 1) * choicePageSize, choicePage * choicePageSize)
              .map((candidate) => (
                <button
                  type="button"
                  className={`org-person-option ${personId === candidate.id ? "is-selected" : ""}`}
                  key={candidate.id}
                  aria-pressed={personId === candidate.id}
                  onClick={() => {
                    setPersonId(candidate.id);
                    setManagerConfirmed(false);
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
          <PaginationBar
            page={choicePage}
            pageCount={Math.max(1, Math.ceil(choices.length / choicePageSize))}
            pageSize={choicePageSize}
            total={choices.length}
            onPageChange={setChoicePage}
          />
          {managementChanges && (
            <label className="org-manager-consent">
              <input
                type="checkbox"
                checked={managerConfirmed}
                onChange={(event) => setManagerConfirmed(event.target.checked)}
              />
              <span>
                {unitId
                  ? `Подтверждаю изменение области управления на «${destinationName}» и вложенные группы.`
                  : "Подтверждаю снятие прав руководителя."}
              </span>
            </label>
          )}
          {person && person.unitId !== (targetUnitId ?? null) && (
            <p className="org-dialog-context">
              {person.displayName}: «{sourceName}» → «{targetName}».{" "}
              {person.unitRole === "MANAGER" && !unitId
                ? "Руководство будет снято."
                : "Доступ «" +
                  (person.unitRole === "MANAGER" ? "руководитель" : "сотрудник") +
                  "» сохранится."}
            </p>
          )}
        </div>
      ) : (
        <div className="org-member-editor-content">
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
              <div className="org-picker-list" role="radiogroup" aria-label="Место назначения">
                {administrator && (
                  <PickerOption
                    name="member-destination"
                    label="Без группы"
                    detail="Общий список сотрудников"
                    selected={!unitId}
                    onSelect={() => {
                      setUnitId("");
                      setUnitRole("MEMBER");
                      setManagerConfirmed(false);
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
                      icon={unit.icon}
                      detail={groupParentPath(unit, units)}
                      selected={unitId === unit.id}
                      onSelect={() => {
                        setUnitId(unit.id);
                        setUnitRole(member?.unitRole ?? "MEMBER");
                        setManagerConfirmed(false);
                      }}
                    />
                  ))}
              </div>
            </>
          )}
          {action === "access" && (
            <fieldset className="org-access-choice">
              <legend>
                Группа: <strong>{destinationName}</strong>
              </legend>
              <p className="org-current-access">
                Текущий доступ: {member?.unitRole === "MANAGER" ? "Руководитель" : "Сотрудник"}
              </p>
              <label>
                <input
                  type="radio"
                  name="unit-role"
                  checked={unitRole === "MEMBER"}
                  onChange={() => {
                    setUnitRole("MEMBER");
                    setManagerConfirmed(false);
                  }}
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
                  onChange={() => {
                    setUnitRole("MANAGER");
                    setManagerConfirmed(false);
                  }}
                  disabled={!administrator}
                />
                <span>
                  <strong>Руководитель</strong>
                  <small>Управляет своей группой и вложенными группами</small>
                </span>
              </label>
              {!administrator && <small>Назначать руководителей может только администратор.</small>}
              {member?.unitRole === "MANAGER" && unitRole === "MEMBER" && (
                <p className="org-inline-note" role="status">
                  После сохранения сотрудник перестанет управлять этой группой и вложенными
                  группами.
                </p>
              )}
              {action === "access" && unitRole === "MANAGER" && member?.unitRole !== "MANAGER" && (
                <label className="org-manager-consent">
                  <input
                    type="checkbox"
                    checked={managerConfirmed}
                    onChange={(event) => setManagerConfirmed(event.target.checked)}
                  />
                  <span>
                    Подтверждаю, что сотрудник будет управлять этой группой и всеми вложенными
                    группами.
                  </span>
                </label>
              )}
            </fieldset>
          )}
          {action === "move" && person?.unitRole === "MANAGER" && unitId !== person.unitId && (
            <>
              <p className="org-inline-note" role="status">
                {unitId
                  ? `Область управления изменится на «${destinationName}» и вложенные группы.`
                  : "При переносе в «Без группы» права руководителя будут сняты."}
              </p>
              <label className="org-manager-consent">
                <input
                  type="checkbox"
                  checked={managerConfirmed}
                  onChange={(event) => setManagerConfirmed(event.target.checked)}
                />
                <span>
                  {unitId
                    ? "Подтверждаю изменение области управления."
                    : "Подтверждаю снятие прав руководителя."}
                </span>
              </label>
            </>
          )}
        </div>
      )}
    </DialogShell>
  );
}

export function OrganizationBulkMemberMoveDialog({
  members,
  units,
  onClose,
  onSaved
}: {
  members: OrganizationMember[];
  units: OrganizationUnit[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [unitId, setUnitId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [managerConfirmed, setManagerConfirmed] = useState(false);
  const overMemberLimit = members.length > MAX_BULK_MOVE_MEMBERS;
  const managerMembers = members.filter((member) => member.unitRole === "MANAGER");
  const hasMove = unitId !== null && members.some((member) => member.unitId !== (unitId || null));
  const managerScopeChanges =
    unitId !== null &&
    managerMembers.length > 0 &&
    managerMembers.some((member) => member.unitId !== (unitId || null));
  const candidates = units.filter((unit) =>
    `${unit.name} ${groupPath(unit, units)}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase())
  );
  const mutation = useMutation({
    mutationFn: () =>
      moveOrganizationMembers({
        personIds: members.map((member) => member.id),
        unitId: unitId || null
      }),
    onSuccess: () => {
      onSaved();
      toast.success(
        `${members.length} ${members.length === 1 ? "сотрудник перемещён" : "сотрудников перемещены"}`
      );
    },
    onError: (error) =>
      toast.error(userErrorMessage(error, "Не удалось переместить сотрудников. Состав не изменён."))
  });
  const destination = units.find((unit) => unit.id === unitId);
  return (
    <DialogShell
      title={`Переместить сотрудников: ${members.length}`}
      description="Состав будет перемещён одной операцией. Доступ в группе сохранится у каждого сотрудника."
      onClose={() => !mutation.isPending && onClose()}
      className="org-dialog--picker org-bulk-move-dialog"
      footer={
        <DialogFooter className="org-dialog-actions">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Отмена
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={
              mutation.isPending ||
              overMemberLimit ||
              !members.length ||
              !hasMove ||
              (managerScopeChanges && !managerConfirmed)
            }
          >
            {mutation.isPending ? "Перемещение…" : `Переместить: ${members.length}`}
          </Button>
        </DialogFooter>
      }
    >
      <div className="org-bulk-move-review">
        <strong>Сотрудники</strong>
        <ul aria-label="Первые сотрудники в списке">
          {members.slice(0, 4).map((member) => (
            <li key={member.id}>
              <span>{member.displayName}</span>
              <small>
                {member.email} · {member.unitName ?? "Без группы"}
              </small>
            </li>
          ))}
        </ul>
        {members.length > 4 && (
          <details className="org-bulk-move-review-details">
            <summary>Посмотреть всех {members.length}</summary>
            <ul aria-label="Все выбранные сотрудники">
              {members.map((member) => (
                <li key={member.id}>
                  <span>{member.displayName}</span>
                  <small>
                    {member.email} · {member.unitName ?? "Без группы"}
                  </small>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {overMemberLimit && (
        <p className="org-bulk-move-limit-error" role="alert">
          За один перенос можно переместить до {MAX_BULK_MOVE_MEMBERS} сотрудников. Сократите выбор.
        </p>
      )}
      <h3 className="org-destination-title">Куда переместить</h3>
      <label className="org-search">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">Найти группу назначения</span>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Найти группу"
        />
      </label>
      <div className="org-picker-list" role="radiogroup" aria-label="Место назначения">
        <PickerOption
          name="bulk-member-destination"
          label="Без группы"
          detail="Общий список сотрудников"
          selected={unitId === ""}
          onSelect={() => {
            setUnitId("");
            setManagerConfirmed(false);
          }}
        />
        {candidates.map((unit) => (
          <PickerOption
            name="bulk-member-destination"
            key={unit.id}
            label={unit.name}
            icon={unit.icon}
            detail={groupParentPath(unit, units)}
            selected={unitId === unit.id}
            onSelect={() => {
              setUnitId(unit.id);
              setManagerConfirmed(false);
            }}
          />
        ))}
        {candidates.length === 0 && (
          <p className="org-picker-empty">Совпадений нет. Можно выбрать «Без группы».</p>
        )}
      </div>
      <div className="org-bulk-move-result">
        <span>Из</span>
        <strong>{members.length} выбранных сотрудников</strong>
        <span>В</span>
        <strong>
          {unitId === null
            ? "Выберите место назначения"
            : destination
              ? groupPath(destination, units)
              : "Без группы"}
        </strong>
        <span>Доступ</span>
        <strong>Сохранится для каждого; в «Без группы» руководство снимается</strong>
      </div>
      {managerScopeChanges && (
        <label className="org-manager-consent">
          <input
            type="checkbox"
            checked={managerConfirmed}
            onChange={(event) => setManagerConfirmed(event.target.checked)}
          />
          <span>
            Подтверждаю изменение области управления для {managerMembers.length}{" "}
            {pluralizeRu(managerMembers.length, "руководителя", "руководителей", "руководителей")}
            {unitId ? " согласно новому месту" : ", руководство будет снято"}.
          </span>
        </label>
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
      onClose={() => !mutation.isPending && onClose()}
      className="org-dialog--compact"
      footer={
        <DialogFooter className="org-dialog-actions">
          {created ? (
            <Button onClick={onClose}>Готово</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
                Отмена
              </Button>
              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                {mutation.isPending ? "Создание…" : "Создать ссылку"}
              </Button>
            </>
          )}
        </DialogFooter>
      }
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
        </div>
      ) : (
        <div className="org-dialog-form">
          <label className="field">
            <span>Роль</span>
            <Select
              value={role}
              onValueChange={(value) => setRole(value as "LECTURER" | "ASSISTANT")}
            >
              <SelectTrigger
                className="org-dialog-select"
                aria-label="Роль приглашённого сотрудника"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LECTURER">Преподаватель</SelectItem>
                <SelectItem value="ASSISTANT">Ассистент</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <p className="org-dialog-context">В группе новый сотрудник получит доступ «Сотрудник».</p>
        </div>
      )}
    </DialogShell>
  );
}

function PickerOption({
  name,
  label,
  icon,
  detail,
  selected,
  onSelect
}: {
  name: string;
  label: string;
  icon?: UnitIcon;
  detail: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label className={`org-picker-option ${selected ? "is-selected" : ""}`}>
      <input type="radio" name={name} checked={selected} onChange={onSelect} />
      <span>
        <strong className={icon ? "org-picker-group-label" : undefined}>
          {icon && <OrganizationUnitIcon icon={icon} size={18} />}
          {label}
        </strong>
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

function getAncestorUnitIds(parentId: string | null, units: OrganizationUnit[]) {
  const ids: string[] = [];
  const seen = new Set<string>();
  let parent = units.find((candidate) => candidate.id === parentId);
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    ids.unshift(parent.id);
    parent = units.find((candidate) => candidate.id === parent?.parentId);
  }
  return ids;
}

function groupParentPath(unit: OrganizationUnit, units: OrganizationUnit[]) {
  const parent = units.find((candidate) => candidate.id === unit.parentId);
  return parent ? groupPath(parent, units) : "Группа верхнего уровня";
}
