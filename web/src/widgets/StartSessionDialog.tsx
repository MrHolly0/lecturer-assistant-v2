import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Play, UsersRound, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { Lecture } from "../app/api/content-api";
import { getCourse } from "../app/api/courses-api";
import { userErrorMessage } from "../app/api/errors";
import { startLiveSession, type StartSessionRequest } from "../app/api/live-api";
import { useMaxBridge } from "../app/max/context";
import { isMobileMax, teacherRemotePath } from "../app/max/navigation";
import { Button } from "../shared/ui/button";
import { Checkbox } from "../shared/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";
import { Input } from "../shared/ui/input";
import { Label } from "../shared/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/ui/tabs";

interface StartSessionDialogProps {
  courseId: string;
  lecture: Pick<Lecture, "id" | "title"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type GroupMode = "existing" | "new";

export function StartSessionDialog({
  courseId,
  lecture,
  open,
  onOpenChange
}: StartSessionDialogProps) {
  const navigate = useNavigate();
  const maxEnvironment = useMaxBridge();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<GroupMode>("existing");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [newGroupNames, setNewGroupNames] = useState<string[]>([]);
  const courseQuery = useQuery({
    queryKey: ["courses", courseId],
    queryFn: () => getCourse(courseId),
    enabled: open
  });
  const groups = useMemo(() => courseQuery.data?.groups ?? [], [courseQuery.data?.groups]);
  const groupsKey = groups.map((group) => group.id).join("|");

  useEffect(() => {
    if (!open || courseQuery.isLoading) return;
    setMode(groups.length === 0 ? "new" : "existing");
    setGroupIds([]);
    setGroupName("");
    setNewGroupNames([]);
  }, [courseQuery.isLoading, groups, groupsKey, open]);

  const startMutation = useMutation({
    mutationFn: (request: StartSessionRequest) => {
      if (!lecture) throw new Error("Лекция не выбрана");
      return startLiveSession(courseId, lecture.id, request);
    },
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ["active-session"] });
      void queryClient.invalidateQueries({ queryKey: ["courses", courseId] });
      void queryClient.invalidateQueries({ queryKey: ["live", courseId, "history"] });
      onOpenChange(false);
      navigate(
        isMobileMax(maxEnvironment)
          ? teacherRemotePath(courseId, session.id)
          : `/courses/${courseId}/sessions/${session.id}/join`
      );
      toast.success("Занятие создано. Покажите студентам код и начните показ.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось запустить занятие."))
  });
  const cleanGroupName = groupName.trim().replace(/\s+/g, " ");
  const selectedCount = groupIds.length + newGroupNames.length;
  const canSubmit =
    Boolean(lecture) && !courseQuery.isLoading && !courseQuery.isError && selectedCount > 0;

  const addGroupName = () => {
    if (!cleanGroupName) return;
    const duplicate = newGroupNames.some(
      (name) => name.localeCompare(cleanGroupName, "ru", { sensitivity: "accent" }) === 0
    );
    if (duplicate) {
      toast.info("Эта группа уже добавлена.");
      return;
    }
    setNewGroupNames((names) => [...names, cleanGroupName]);
    setGroupName("");
  };

  const submit = () => {
    startMutation.mutate({
      groups: [
        ...groupIds.map((selectedGroupId) => ({ groupId: selectedGroupId })),
        ...newGroupNames.map((selectedGroupName) => ({ groupName: selectedGroupName }))
      ]
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!startMutation.isPending) onOpenChange(next);
      }}
    >
      <DialogContent className="start-session-dialog top-4 translate-y-0">
        <DialogHeader>
          <DialogTitle>Запустить занятие</DialogTitle>
          <DialogDescription>
            Выберите одну или несколько групп. Лекция «{lecture?.title ?? ""}» останется доступна
            для следующих запусков.
          </DialogDescription>
        </DialogHeader>

        <div className="start-session-context">
          <UsersRound size={20} aria-hidden="true" />
          <div>
            <span>Курс</span>
            <strong>{courseQuery.data?.title ?? "Загрузка…"}</strong>
          </div>
        </div>

        {courseQuery.isError ? (
          <div className="form-error" role="alert">
            Не удалось загрузить группы курса.
            <Button type="button" variant="outline" onClick={() => courseQuery.refetch()}>
              Повторить
            </Button>
          </div>
        ) : (
          <Tabs value={mode} onValueChange={(value) => setMode(value as GroupMode)}>
            <TabsList className="start-session-tabs">
              <TabsTrigger value="existing" disabled={groups.length === 0}>
                Существующая группа
              </TabsTrigger>
              <TabsTrigger value="new">Новая группа</TabsTrigger>
            </TabsList>
            <TabsContent value="existing" className="start-session-field">
              <Label>Группы занятия</Label>
              <div className="start-session-group-list" role="group" aria-label="Группы занятия">
                {groups.map((group) => {
                  const checked = groupIds.includes(group.id);
                  return (
                    <label key={group.id} className="start-session-group-option">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) =>
                          setGroupIds((ids) =>
                            next ? [...ids, group.id] : ids.filter((id) => id !== group.id)
                          )
                        }
                      />
                      <span>{group.name}</span>
                    </label>
                  );
                })}
              </div>
              <p className="muted">Можно провести один общий эфир сразу для нескольких групп.</p>
            </TabsContent>
            <TabsContent value="new" className="start-session-field">
              <Label htmlFor="start-session-new-group">Название новой группы</Label>
              <div className="start-session-new-group">
                <Input
                  id="start-session-new-group"
                  className="start-session-control"
                  value={groupName}
                  maxLength={120}
                  placeholder="Например, ИКБО-01-23"
                  autoComplete="off"
                  onChange={(event) => setGroupName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addGroupName();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!cleanGroupName}
                  onClick={addGroupName}
                >
                  <Plus size={16} aria-hidden="true" /> Добавить
                </Button>
              </div>
              <p className="muted">Новые группы будут созданы вместе с занятием.</p>
            </TabsContent>
          </Tabs>
        )}

        {selectedCount > 0 && (
          <div className="start-session-selection" aria-live="polite">
            <strong>Выбрано: {selectedCount}</strong>
            <div className="start-session-selection__items">
              {groups
                .filter((group) => groupIds.includes(group.id))
                .map((group) => (
                  <span key={group.id} className="start-session-chip">
                    {group.name}
                    <button
                      type="button"
                      aria-label={`Убрать группу ${group.name}`}
                      onClick={() => setGroupIds((ids) => ids.filter((id) => id !== group.id))}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              {newGroupNames.map((name) => (
                <span key={name} className="start-session-chip start-session-chip--new">
                  {name}
                  <button
                    type="button"
                    aria-label={`Убрать новую группу ${name}`}
                    onClick={() =>
                      setNewGroupNames((names) => names.filter((item) => item !== name))
                    }
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={startMutation.isPending}>
              Отмена
            </Button>
          </DialogClose>
          <Button type="button" disabled={!canSubmit || startMutation.isPending} onClick={submit}>
            <Play size={16} aria-hidden="true" />
            {startMutation.isPending ? "Запускаем…" : "Запустить занятие"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
