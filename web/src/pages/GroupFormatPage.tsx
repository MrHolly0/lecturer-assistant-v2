import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  exampleGroupFormat,
  getGroupFormat,
  previewGroupDraft,
  reconcileGroups,
  saveGroupFormat,
  type GroupField,
  type GroupFormatPolicy
} from "../app/api/group-format";
import { ApiError, userErrorMessage } from "../app/api/errors";
import { Button } from "../shared/ui/button";
import { Input } from "../shared/ui/input";
import { GroupFormatField } from "./GroupFormatField";

function cleanPolicy(policy: GroupFormatPolicy) {
  return {
    ...policy,
    fields: policy.fields.map((field) => ({
      ...field,
      choices: (field.choices ?? []).map((choice) => ({
        ...choice,
        aliases: (choice.aliases ?? []).map((alias) => alias.trim()).filter(Boolean)
      }))
    }))
  };
}

function examplePart(field: GroupField) {
  if (field.kind === "CHOICE") return field.defaultValue || field.choices[0]?.code || "…";
  if (field.kind === "NUMBER") return "4".padStart(field.width, "0");
  return field.width === 2 ? "23" : String(field.yearBase + 23);
}

export function GroupFormatPage() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["group-format"], queryFn: getGroupFormat });
  const [edited, setEdited] = useState<GroupFormatPolicy | null>(null);
  const [newId, setNewId] = useState("");
  const [sample, setSample] = useState("");
  const draft = edited ?? query.data;
  const save = useMutation({
    mutationFn: saveGroupFormat,
    onSuccess: (value) => {
      qc.setQueryData(["group-format"], value);
      setEdited(null);
      toast.success("Формат групп сохранён");
    }
  });
  const reconcile = useMutation({ mutationFn: reconcileGroups });
  const preview = useMutation({
    mutationFn: ({ policy, name }: { policy: GroupFormatPolicy; name: string }) =>
      previewGroupDraft(cleanPolicy(policy), name)
  });
  if (!draft)
    return (
      <div className="page">
        {query.isLoading ? (
          <p role="status">Загружаем формат групп…</p>
        ) : (
          <>
            <p role="alert">Не удалось получить настройки.</p>
            <Button onClick={() => void query.refetch()}>Повторить</Button>
          </>
        )}
      </div>
    );
  const dirty = Boolean(edited) && JSON.stringify(draft) !== JSON.stringify(query.data);
  const update = (next: GroupFormatPolicy) => {
    preview.reset();
    save.reset();
    reconcile.reset();
    setEdited(next);
  };
  const addField = () => {
    const id =
      "field_" +
      Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) =>
        n.toString(16).padStart(2, "0")
      ).join("");
    setNewId(id);
    update({
      ...draft,
      fields: [
        ...draft.fields,
        {
          id,
          label: "",
          kind: "NUMBER",
          prefix: "",
          width: 1,
          yearBase: 2000,
          defaultValue: null,
          choices: []
        }
      ]
    });
  };
  const hasPreview = preview.variables?.policy === draft && preview.variables.name === sample;
  return (
    <div className="page group-format-page">
      <header className="page-header">
        <div>
          <h1>Формат учебных групп</h1>
          <p className="muted">Задайте единое написание групп для вашего учреждения.</p>
        </div>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(cleanPolicy(draft));
        }}
      >
        <fieldset
          className="group-format-editor"
          disabled={save.isPending}
          onInvalidCapture={(event) => {
            const details = (event.target as HTMLElement).closest("details");
            if (details) details.open = true;
          }}
        >
          <label className="group-format-toggle">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => update({ ...draft, enabled: e.target.checked })}
            />
            <span>
              <strong>Проверять названия групп</strong>
              <small>Если название не распознано, преподаватель заполнит его по частям.</small>
            </span>
          </label>
          <section className="group-format-parts">
            <h2>Части названия</h2>
            {draft.fields.length > 0 ? (
              <p className="group-format-example">
                Пример названия{" "}
                <strong>
                  {draft.fields.map((field) => field.prefix + examplePart(field)).join("")}
                </strong>
              </p>
            ) : (
              <p className="muted">
                Начните с шаблона «бИСТ-234» или добавьте первую часть своего формата.
              </p>
            )}
            {draft.fields.map((field, index) => (
              <GroupFormatField
                key={field.id}
                field={field}
                count={draft.fields.length}
                index={index}
                initiallyOpen={field.id === newId}
                changeField={(change) =>
                  update({
                    ...draft,
                    fields: draft.fields.map((f, i) => (i === index ? { ...f, ...change } : f))
                  })
                }
                onRemove={() =>
                  update({ ...draft, fields: draft.fields.filter((_, i) => i !== index) })
                }
                onMove={(delta) => {
                  const fields = [...draft.fields];
                  [fields[index], fields[index + delta]] = [fields[index + delta], fields[index]];
                  update({ ...draft, fields });
                }}
              />
            ))}
            <div className="group-format-toolbar">
              <Button
                type="button"
                variant="outline"
                onClick={() => update(exampleGroupFormat(draft.revision))}
              >
                {draft.fields.length
                  ? "Заменить шаблоном бИСТ-234"
                  : "Использовать шаблон бИСТ-234"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={draft.fields.length >= 8}
                onClick={addField}
              >
                <Plus />
                Добавить часть
              </Button>
            </div>
          </section>
          <div className="group-format-toolbar">
            <Button type="submit" disabled={!dirty || (draft.enabled && !draft.fields.length)}>
              {save.isPending ? "Сохраняем…" : "Сохранить формат"}
            </Button>
            {dirty && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEdited(null);
                  save.reset();
                  preview.reset();
                  void query.refetch();
                }}
              >
                Отменить изменения
              </Button>
            )}
          </div>
          {save.isError && (
            <p className="form-error" role="alert">
              {userErrorMessage(save.error, "Не удалось сохранить формат")}
              {save.error instanceof ApiError &&
                save.error.status === 409 &&
                " Отмените изменения, чтобы загрузить актуальные правила."}
            </p>
          )}
        </fieldset>
      </form>
      <section className="group-format-check">
        <h2>Проверить название</h2>
        <p className="muted">
          Введите группу как преподаватель. Проверка учитывает даже несохранённые изменения.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            preview.mutate({ policy: draft, name: sample });
          }}
        >
          <Input
            aria-label="Название для проверки"
            placeholder="Например, ИСТ234"
            value={sample}
            maxLength={120}
            onChange={(e) => {
              setSample(e.target.value);
              preview.reset();
            }}
          />
          <Button variant="outline" disabled={!sample.trim() || preview.isPending}>
            {preview.isPending ? "Проверяем…" : "Проверить"}
          </Button>
        </form>
        {hasPreview && preview.data && (
          <p role="status">
            {preview.data.valid ? "Название группы: " + preview.data.name : preview.data.message}
          </p>
        )}
        {hasPreview && preview.isError && (
          <p className="form-error" role="alert">
            {userErrorMessage(preview.error, "Не удалось проверить пример")}
          </p>
        )}
      </section>
      <section className="group-format-check">
        <h2>Существующие группы</h2>
        <p className="muted">
          Свяжите группы со схожим написанием для поиска занятий между курсами. Их названия, состав
          и история сохранятся.
        </p>
        <Button
          variant="outline"
          disabled={dirty || !query.data?.enabled || reconcile.isPending}
          onClick={() => reconcile.mutate(draft.revision)}
        >
          {reconcile.isPending ? "Проверяем…" : "Проверить существующие группы"}
        </Button>
        {(dirty || !query.data?.enabled) && (
          <p className="muted">
            {dirty ? "Сначала сохраните формат." : "Для проверки включите формат и сохраните его."}
          </p>
        )}
        {reconcile.data && (
          <p role="status">
            Распознано групп: {reconcile.data.matched}. Требуют проверки:{" "}
            {reconcile.data.unrecognized}.
            {reconcile.data.hasMore && " Запустите проверку ещё раз для следующих групп."}
          </p>
        )}
        {reconcile.isError && (
          <p role="alert">{userErrorMessage(reconcile.error, "Не удалось проверить группы")}</p>
        )}
      </section>
    </div>
  );
}
