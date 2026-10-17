import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRightLeft,
  ChevronRight,
  Folder,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Users
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteOrganizationUnit,
  getOrganization,
  getOrganizationMembers,
  assignOrganizationMember,
  type OrganizationMember,
  type OrganizationUnit
} from "../app/api/organization-api";
import { userErrorMessage } from "../app/api/errors";
import { useAuth } from "../app/AuthContext";
import { includesQuery, usePagedList } from "../shared/lib/usePagedList";
import { pluralizeRu } from "../shared/lib/plural";
import { Button, IconButton } from "../shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../shared/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "../shared/ui/alert-dialog";
import { PaginationBar } from "../widgets/ListControls";
import {
  OrganizationInvitationDialog,
  OrganizationMemberEditor,
  OrganizationUnitEditor,
  OrganizationUnitMoveDialog,
  type UnitDraft
} from "../widgets/OrganizationEditors";

const roleLabels: Record<OrganizationMember["role"], string> = {
  ADMIN: "Администратор",
  LECTURER: "Преподаватель",
  ASSISTANT: "Ассистент",
  STUDENT: "Студент"
};

type MemberDialog =
  | { action: "add" | "move-root"; member: null }
  | { action: "move" | "access"; member: OrganizationMember };
const EMPTY_UNITS: OrganizationUnit[] = [];

export function OrganizationPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const legacyUnassigned = params.get("unit") === "unassigned";
  const selectedId = legacyUnassigned ? null : params.get("unit");
  const allDirectory = params.get("view") === "all" || legacyUnassigned;
  const noGroupOnly = legacyUnassigned || params.get("filter") === "unassigned";
  const [query, setQuery] = useState("");
  const [unitDraft, setUnitDraft] = useState<UnitDraft | null>(null);
  const [movingUnit, setMovingUnit] = useState<OrganizationUnit | null>(null);
  const [memberDialog, setMemberDialog] = useState<MemberDialog | null>(null);
  const [inviting, setInviting] = useState(false);
  const [deleting, setDeleting] = useState<OrganizationUnit | null>(null);
  const [removing, setRemoving] = useState<OrganizationMember | null>(null);
  useEffect(() => {
    if (legacyUnassigned) {
      setParams({ view: "all", filter: "unassigned" }, { replace: true });
    }
  }, [legacyUnassigned, setParams]);

  const organization = useQuery({ queryKey: ["organization", "tree"], queryFn: getOrganization });
  const units = organization.data?.units ?? EMPTY_UNITS;
  const administrator = organization.data?.administrator ?? user?.role === "ADMIN";
  const selected = units.find((unit) => unit.id === selectedId);
  const invalidUnit = Boolean(selectedId && !selected);
  const scope = selected?.id;
  const canViewSelected = Boolean(selected?.canViewMembers || administrator);
  const roster = useQuery({
    queryKey: ["organization", "members", scope ?? "root"],
    queryFn: () => getOrganizationMembers(scope),
    enabled: Boolean(organization.data && selected) && canViewSelected
  });
  const allPeople = useQuery({
    queryKey: ["organization", "members", "all"],
    queryFn: () => getOrganizationMembers(),
    enabled: Boolean(organization.data) && administrator
  });

  const breadcrumbs = selected ? getUnitPath(selected, units) : [];
  const title = selected?.name ?? (allDirectory ? "Все сотрудники" : "Сотрудники и группы");
  const groupChildren = useMemo(
    () => units.filter((unit) => unit.parentId === (selected?.id ?? null)),
    [selected?.id, units]
  );

  const shownFolders = useMemo(() => {
    if (selected) {
      return groupChildren.filter((unit) => !query.trim() || includesQuery(query, unit.name));
    }
    const topLevel = units.filter((unit) => !unit.parentId);
    if (!query.trim()) return topLevel;
    const normalized = query.trim().toLocaleLowerCase();
    return units.filter((unit) =>
      `${unit.name} ${getUnitPath(unit, units)
        .map((part) => part.name)
        .join(" ")}`
        .toLocaleLowerCase()
        .includes(normalized)
    );
  }, [groupChildren, query, selected, units]);

  const people = useMemo(() => {
    const peopleSource = selected ? roster.data ?? [] : allPeople.data ?? [];
    if (selected) return peopleSource.filter((person) => person.unitId === selected.id);
    if (allDirectory) {
      return peopleSource.filter((person) => !noGroupOnly || person.unitId === null);
    }
    if (query.trim() && administrator) return peopleSource;
    return peopleSource.filter((person) => person.unitId === null);
  }, [administrator, allDirectory, allPeople.data, noGroupOnly, query, roster.data, selected]);
  const filteredPeople = useMemo(
    () =>
      people.filter((person) =>
        includesQuery(query, person.displayName, person.email, person.unitName)
      ),
    [people, query]
  );
  const paged = usePagedList(filteredPeople, 20);

  function navigateTo(id: string | null, view: "root" | "all" = "root") {
    setParams(id ? { unit: id } : view === "all" ? { view: "all" } : {});
    setQuery("");
    paged.setPage(1);
  }

  function refreshOrganization() {
    void queryClient.invalidateQueries({ queryKey: ["organization"] });
  }

  const deleteMutation = useMutation({
    mutationFn: (unit: OrganizationUnit) => deleteOrganizationUnit(unit.id),
    onSuccess: () => {
      const parent = deleting?.parentId ?? null;
      const removedIds = getDescendantIds(deleting?.id, units);
      setDeleting(null);
      navigateTo(parent);
      void queryClient.invalidateQueries({ queryKey: ["organization"], refetchType: "none" });
      void queryClient.refetchQueries({
        queryKey: ["organization"],
        type: "active",
        predicate: (queryItem) => !removedIds.has(String(queryItem.queryKey[2]))
      });
      toast.success("Группа удалена. Аккаунты сотрудников и материалы сохранены.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось удалить группу"))
  });
  const removeMutation = useMutation({
    mutationFn: (member: OrganizationMember) => assignOrganizationMember(member.id, null, "MEMBER"),
    onSuccess: () => {
      setRemoving(null);
      refreshOrganization();
      toast.success("Сотрудник перемещён в список «Без группы». Аккаунт сохранён.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось переместить сотрудника"))
  });

  function openAdd() {
    if (administrator) setMemberDialog({ action: "add", member: null });
  }

  if (organization.isPending) {
    return (
      <main className="page organization-page">
        <p className="muted" role="status">
          Загрузка групп…
        </p>
      </main>
    );
  }
  if (organization.isError) {
    return (
      <main className="page organization-page">
        <div className="org-state" role="alert">
          <p>Не удалось загрузить группы и права доступа.</p>
          <Button variant="outline" onClick={() => void organization.refetch()}>
            Попробовать снова
          </Button>
        </div>
      </main>
    );
  }
  if (invalidUnit) {
    return (
      <main className="page organization-page">
        <h1>Группа недоступна</h1>
        <div className="org-state" role="status">
          <p>Эта группа удалена или у вас больше нет к ней доступа.</p>
          <Button onClick={() => navigateTo(null)}>К группам и сотрудникам</Button>
        </div>
      </main>
    );
  }

  const loadingPeople = selected ? roster.isPending : allPeople.isPending;
  const peopleError = selected ? roster.isError : allPeople.isError;
  const refreshPeople = selected ? roster.refetch : allPeople.refetch;

  return (
    <main className="page organization-page">
      <header className="org-header">
        <div className="org-header-copy">
          <h1>Сотрудники и группы</h1>
          {selected && (
            <nav className="org-breadcrumbs" aria-label="Путь группы">
              <button type="button" onClick={() => navigateTo(null)}>
                Сотрудники и группы
              </button>
              {breadcrumbs.map((unit, index) => (
                <span className="org-breadcrumb-part" key={unit.id}>
                  <ChevronRight size={14} aria-hidden="true" />
                  {index === breadcrumbs.length - 1 ? (
                    <span aria-current="page">{unit.name}</span>
                  ) : (
                    <button type="button" onClick={() => navigateTo(unit.id)}>
                      {unit.name}
                    </button>
                  )}
                </span>
              ))}
            </nav>
          )}
        </div>
        <div className="org-header-links">
          {allDirectory ? (
            <Button variant="ghost" onClick={() => navigateTo(null)}>
              <ArrowLeft size={17} />К группам
            </Button>
          ) : (
            administrator && (
              <Button variant="ghost" onClick={() => navigateTo(null, "all")}>
                <Users size={17} />
                Все сотрудники
              </Button>
            )
          )}
        </div>
      </header>

      <section className="org-browser" aria-label={title}>
        {!selected && allDirectory && <h2 className="org-view-title">Все сотрудники</h2>}
        {selected && (
          <div className="org-view-heading">
            <div className="org-view-title-wrap">
              <Button
                variant="ghost"
                className="org-back-button"
                onClick={() => navigateTo(selected.parentId)}
                aria-label="Назад к родительской группе"
              >
                <ArrowLeft size={18} />
              </Button>
              <h2 className="org-view-title">{selected.name}</h2>
            </div>
            {selected.canManage && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <IconButton label={`Действия с группой ${selected.name}`}>
                    <MoreHorizontal size={20} />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() =>
                      setUnitDraft({
                        id: selected.id,
                        name: selected.name,
                        kind: selected.kind,
                        parentId: selected.parentId
                      })
                    }
                  >
                    <Pencil size={16} />
                    Переименовать
                  </DropdownMenuItem>
                  {selected.canManage && (
                    <DropdownMenuItem onSelect={() => setMovingUnit(selected)}>
                      <ArrowRightLeft size={16} />
                      Переместить группу
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={() => setDeleting(selected)}
                  >
                    <Trash2 size={16} />
                    Удалить группу
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}

        <div className="org-toolbar">
          <label className="org-main-search">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">
              Поиск {selected || allDirectory ? "сотрудников и групп" : "групп и сотрудников"}
            </span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                paged.setPage(1);
              }}
              placeholder={
                selected || allDirectory ? "Имя, email или группа" : "Найти группу или сотрудника"
              }
            />
          </label>
          {(administrator || Boolean(selected?.canManage)) && !allDirectory && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button>
                  <Plus size={17} />
                  Добавить
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="org-add-menu">
                <DropdownMenuItem
                  onSelect={() =>
                    setUnitDraft({
                      id: null,
                      name: "",
                      kind: "UNIT",
                      parentId: selected?.id ?? null
                    })
                  }
                >
                  <Folder size={16} />
                  Создать группу
                </DropdownMenuItem>
                {selected
                  ? administrator && (
                      <>
                        <DropdownMenuItem onSelect={openAdd}>
                          <Users size={16} />
                          Добавить из списка
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setInviting(true)}>
                          <Plus size={16} />
                          Пригласить сотрудника
                        </DropdownMenuItem>
                      </>
                    )
                  : administrator && (
                      <>
                        <DropdownMenuItem onSelect={() => setInviting(true)}>
                          <Plus size={16} />
                          Пригласить сотрудника
                        </DropdownMenuItem>
                        {allPeople.data?.some((person) => person.unitId !== null) && (
                          <DropdownMenuItem
                            onSelect={() => setMemberDialog({ action: "move-root", member: null })}
                          >
                            <ArrowRightLeft size={16} />
                            Переместить из группы
                          </DropdownMenuItem>
                        )}
                      </>
                    )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {administrator && allDirectory && (
            <Button onClick={() => setInviting(true)}>
              <Plus size={17} />
              Пригласить
            </Button>
          )}
        </div>

        {allDirectory && administrator && (
          <label className="org-filter-check">
            <input
              type="checkbox"
              checked={noGroupOnly}
              onChange={(event) =>
                setParams(
                  event.target.checked ? { view: "all", filter: "unassigned" } : { view: "all" }
                )
              }
            />
            Без группы
          </label>
        )}

        {!selected && !allDirectory && query.trim() && (
          <p className="org-search-hint">
            Поиск групп по всей структуре. Путь показан под названием.
          </p>
        )}
        {!selected && !allDirectory && query.trim() && shownFolders.length === 0 && (
          <p className="org-empty-inline">Группы по этому запросу не найдены.</p>
        )}

        {shownFolders.length > 0 && !allDirectory && (
          <section className="org-section" aria-label="Группы">
            <div className="org-section-heading">
              <h3>Группы</h3>
              <span>{shownFolders.length}</span>
            </div>
            <ul className="org-folder-list">
              {shownFolders.map((unit) => {
                const childrenCount = units.filter(
                  (candidate) => candidate.parentId === unit.id
                ).length;
                return (
                  <li key={unit.id}>
                    <button
                      type="button"
                      className="org-folder-row"
                      onClick={() => navigateTo(unit.id)}
                    >
                      <Folder size={19} aria-hidden="true" />
                      <span className="org-folder-copy">
                        <strong>{unit.name}</strong>
                        {!selected && query.trim() && (
                          <small>
                            {getUnitPath(unit, units)
                              .map((part) => part.name)
                              .join(" › ")}
                          </small>
                        )}
                      </span>
                      <span className="org-folder-counts">
                        {unit.totalMembersCount > 0 && (
                          <small>
                            {unit.totalMembersCount}{" "}
                            {pluralizeRu(
                              unit.totalMembersCount,
                              "сотрудник",
                              "сотрудника",
                              "сотрудников"
                            )}
                          </small>
                        )}
                        {childrenCount > 0 && (
                          <small>
                            {childrenCount}{" "}
                            {pluralizeRu(childrenCount, "группа", "группы", "групп")}
                          </small>
                        )}
                        {unit.totalMembersCount === 0 && childrenCount === 0 && (
                          <small>Пустая группа</small>
                        )}
                      </span>
                      <ChevronRight size={17} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {!selected && !allDirectory && !administrator && (
          <div className="org-state org-state--inline">
            <ShieldCheck size={18} />
            <p>
              Состав сотрудников без группы доступен администратору. Откройте группу, к которой у
              вас есть доступ.
            </p>
          </div>
        )}

        {selected && !canViewSelected && (
          <div className="org-state org-state--inline">
            <ShieldCheck size={19} />
            <p>
              Вы не можете просматривать сотрудников этой группы. Доступный список не подменяется
              общим списком.
            </p>
          </div>
        )}

        {allDirectory && !administrator ? (
          <div className="org-state org-state--inline" role="alert">
            <ShieldCheck size={19} />
            <p>Общий справочник сотрудников доступен администратору.</p>
          </div>
        ) : (
          (selected ? canViewSelected : administrator) && (
            <section className="org-section org-people-section" aria-label="Сотрудники">
              <div className="org-section-heading org-people-heading">
                <h3>
                  {allDirectory ? "Сотрудники" : selected ? "Сотрудники в группе" : "Без группы"}
                </h3>
                {!loadingPeople && !peopleError && <span>{filteredPeople.length}</span>}
              </div>
              {loadingPeople ? (
                <p className="org-inline-state" role="status">
                  Загрузка сотрудников…
                </p>
              ) : peopleError ? (
                <div className="org-state org-state--inline" role="alert">
                  <p>Не удалось загрузить сотрудников.</p>
                  <Button variant="outline" onClick={() => void refreshPeople()}>
                    Попробовать снова
                  </Button>
                </div>
              ) : filteredPeople.length === 0 ? (
                <div className="org-empty-inline">
                  <Users size={22} aria-hidden="true" />
                  <p>
                    {query
                      ? "По этому запросу ничего не найдено."
                      : allDirectory
                        ? noGroupOnly
                          ? "Сотрудников без группы пока нет."
                          : "Сотрудников пока нет."
                        : selected
                          ? "В этой группе пока нет сотрудников."
                          : "Сотрудников без группы пока нет."}
                  </p>
                  {administrator && !query && !allDirectory && (
                    <small>Добавьте существующего сотрудника или пригласите нового.</small>
                  )}
                </div>
              ) : (
                <>
                  <ul className="org-member-list">
                    {paged.pageItems.map((person) => (
                      <li key={person.id}>
                        <div className="org-member-main">
                          <strong>{person.displayName}</strong>
                          <span>{person.email}</span>
                        </div>
                        <div className="org-member-meta">
                          <span>
                            {roleLabels[person.role]}
                            {person.status === "DISABLED" ? " · отключён" : ""}
                          </span>
                          {person.unitRole === "MANAGER" && (
                            <span className="org-access-badge">
                              <ShieldCheck size={13} aria-hidden="true" />
                              Руководитель
                            </span>
                          )}
                          {!selected && person.unitId && person.unitName ? (
                            <button
                              type="button"
                              className="org-member-location"
                              onClick={() => navigateTo(person.unitId)}
                            >
                              {person.unitName}
                            </button>
                          ) : (
                            !selected && <span className="org-member-location">Без группы</span>
                          )}
                        </div>
                        {getPersonCanEdit(person, selected, administrator, user?.id) && (
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                              <IconButton label={`Действия с сотрудником ${person.displayName}`}>
                                <MoreHorizontal size={19} />
                              </IconButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() => setMemberDialog({ action: "move", member: person })}
                              >
                                <ArrowRightLeft size={16} />
                                Переместить сотрудника
                              </DropdownMenuItem>
                              {administrator && person.unitId && (
                                <DropdownMenuItem
                                  onSelect={() =>
                                    setMemberDialog({ action: "access", member: person })
                                  }
                                >
                                  <ShieldCheck size={16} />
                                  Изменить права доступа
                                </DropdownMenuItem>
                              )}
                              {person.unitId && (
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onSelect={() => setRemoving(person)}
                                >
                                  <Trash2 size={16} />
                                  Убрать из группы
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </li>
                    ))}
                  </ul>
                  <PaginationBar {...paged} onPageChange={paged.setPage} />
                </>
              )}
            </section>
          )
        )}
      </section>

      {unitDraft && (
        <OrganizationUnitEditor
          key={`${unitDraft.id ?? "new"}-${unitDraft.parentId}`}
          draft={unitDraft}
          units={units}
          onClose={() => setUnitDraft(null)}
          onSaved={(unit) => {
            setUnitDraft(null);
            refreshOrganization();
            if (!unitDraft.id) navigateTo(unit.id);
          }}
        />
      )}
      {movingUnit && (
        <OrganizationUnitMoveDialog
          unit={movingUnit}
          units={units}
          administrator={administrator}
          onClose={() => setMovingUnit(null)}
          onSaved={() => {
            setMovingUnit(null);
            refreshOrganization();
            toast.success("Группа перемещена");
          }}
        />
      )}
      {memberDialog && (
        <OrganizationMemberEditor
          key={`${memberDialog.action}-${memberDialog.member?.id ?? "new"}-${selectedId ?? "root"}`}
          action={memberDialog.action}
          member={memberDialog.member}
          people={allPeople.data ?? []}
          units={units}
          targetUnitId={selected?.id ?? null}
          administrator={administrator}
          onClose={() => setMemberDialog(null)}
          onSaved={() => {
            setMemberDialog(null);
            refreshOrganization();
          }}
        />
      )}
      {inviting && (
        <OrganizationInvitationDialog unit={selected ?? null} onClose={() => setInviting(false)} />
      )}

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && !deleteMutation.isPending && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить группу «{deleting?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting &&
                (() => {
                  const removed = getDescendantIds(deleting.id, units);
                  const nestedGroups = Math.max(removed.size - 1, 0);
                  return `${nestedGroups > 0 ? `Вместе с ней удалятся ${nestedGroups} вложенных групп. ` : ""}${deleting.totalMembersCount} ${pluralizeRu(deleting.totalMembersCount, "сотрудник", "сотрудника", "сотрудников")} перейдут в список «Без группы». `;
                })()}
              Аккаунты сотрудников, курсы, материалы и история сохранятся. Доступ руководителей
              удалённой ветки будет снят.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deleting) deleteMutation.mutate(deleting);
              }}
            >
              {deleteMutation.isPending ? "Удаление…" : "Удалить группу"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && !removeMutation.isPending && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Переместить сотрудника в список «Без группы»?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.displayName} останется в системе. Курсы и материалы сохранятся, доступ
              руководителя группы будет снят.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMutation.isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (removing) removeMutation.mutate(removing);
              }}
            >
              {removeMutation.isPending ? "Перемещение…" : "Переместить в список «Без группы»"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function getUnitPath(unit: OrganizationUnit, units: OrganizationUnit[]) {
  const result: OrganizationUnit[] = [unit];
  const visited = new Set([unit.id]);
  let parentId = unit.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = units.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    result.unshift(parent);
    parentId = parent.parentId;
  }
  return result;
}

function getDescendantIds(unitId: string | undefined, units: OrganizationUnit[]) {
  const ids = new Set<string>();
  if (!unitId) return ids;
  ids.add(unitId);
  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of units) {
      if (unit.parentId && ids.has(unit.parentId) && !ids.has(unit.id)) {
        ids.add(unit.id);
        changed = true;
      }
    }
  }
  return ids;
}

function getPersonCanEdit(
  person: OrganizationMember,
  selected: OrganizationUnit | undefined,
  administrator: boolean,
  currentUserId: string | undefined
) {
  if (administrator) return true;
  if (
    !selected?.canManage ||
    person.id === currentUserId ||
    person.unitRole === "MANAGER" ||
    person.role === "ADMIN"
  )
    return false;
  return true;
}
