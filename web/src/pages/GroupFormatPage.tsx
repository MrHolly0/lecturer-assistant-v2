import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  exampleGroupFormat,
  getGroupFormat,
  previewGroup,
  reconcileGroups,
  saveGroupFormat,
  type GroupField,
  type GroupFormatPolicy
} from "../app/api/group-format";
import { userErrorMessage } from "../app/api/errors";
import { Button } from "../shared/ui/button";
import { Input } from "../shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";

export function GroupFormatPage() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["group-format"], queryFn: getGroupFormat });
  const [draft, setDraft] = useState<GroupFormatPolicy | null>(null);
  const [sample, setSample] = useState("");
  const [sampleResult, setSampleResult] = useState("");
  useEffect(() => {
    if (query.data) setDraft(query.data);
  }, [query.data]);
  const save = useMutation({
    mutationFn: saveGroupFormat,
    onSuccess: (value) => {
      qc.setQueryData(["group-format"], value);
      setDraft(value);
      setSampleResult("");
      toast.success("Формат групп сохранён");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось сохранить формат"))
  });
  const reconcile = useMutation({
    mutationFn: () => reconcileGroups(query.data!.revision),
    onSuccess: (result) => {
      toast.success(
        `Распознано групп: ${result.matched}. Требуют проверки: ${result.unrecognized}.${result.hasMore ? " Остались группы для следующей проверки." : ""}`
      );
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось проверить группы"))
  });
  const preview = useMutation({
    mutationFn: () => previewGroup({ name: sample }),
    onSuccess: (result) => {
      setSampleResult(
        result.valid
          ? `Будет сохранено: ${result.name}`
          : result.message ?? "Нужно уточнить группу по шагам"
      );
    },
    onError: (error) => setSampleResult(userErrorMessage(error, "Не удалось проверить пример"))
  });
  const changeField = (index: number, change: Partial<GroupField>) =>
    setDraft(
      (old) =>
        old && {
          ...old,
          fields: old.fields.map((field, i) => (i === index ? { ...field, ...change } : field))
        }
    );
  const move = (index: number, delta: number) =>
    setDraft((old) => {
      if (!old) return old;
      const fields = [...old.fields];
      [fields[index], fields[index + delta]] = [fields[index + delta], fields[index]];
      return { ...old, fields };
    });
  if (query.isLoading)
    return (
      <div className="page" role="status">
        Загружаем формат групп…
      </div>
    );
  if (!draft)
    return (
      <div className="page">
        <p role="alert">Не удалось получить настройки.</p>
        <Button onClick={() => void query.refetch()}>Повторить</Button>
      </div>
    );
  const dirty = JSON.stringify(draft) !== JSON.stringify(query.data);
  return (
    <div className="page group-format-page">
      <div className="page-header">
        <div>
          <h1>Формат учебных групп</h1>
          <p className="muted">Единое название группы для всех преподавателей учреждения.</p>
        </div>
      </div>
      <p>
        Преподаватель вводит название одной строкой. Если оно не распознано, приложение предложит
        короткую форму по вашим правилам.
      </p>
      <form
        className="group-format-editor"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({
            ...draft,
            fields: draft.fields.map((field) => ({
              ...field,
              choices: field.choices.map((choice) => ({
                ...choice,
                aliases: choice.aliases.map((alias) => alias.trim()).filter(Boolean)
              }))
            }))
          });
        }}
      >
        <label className="group-format-toggle">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          />{" "}
          Проверять новые группы по формату учреждения
        </label>
        <div className="group-format-toolbar">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDraft(exampleGroupFormat(draft.revision))}
          >
            Взять за основу бИСТ-234
          </Button>
          <span className="muted">Уровень → направление → год поступления → номер</span>
        </div>
        {draft.fields.map((field, index) => (
          <fieldset className="group-format-field" key={field.id}>
            <legend>
              Часть {index + 1}: {field.label || "Новое поле"}
            </legend>
            <div className="group-format-field__heading">
              <label className="field">
                <span>Название поля</span>
                <Input
                  value={field.label}
                  maxLength={80}
                  required
                  onChange={(event) => changeField(index, { label: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Что вводит преподаватель</span>
                <Select
                  value={field.kind}
                  onValueChange={(kind) =>
                    changeField(index, {
                      kind: kind as GroupField["kind"],
                      width: kind === "YEAR" ? 2 : 1,
                      yearBase: 2000,
                      defaultValue: null,
                      choices: kind === "CHOICE" ? [{ code: "", label: "", aliases: [] }] : []
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CHOICE">Вариант из списка</SelectItem>
                    <SelectItem value="YEAR">Год</SelectItem>
                    <SelectItem value="NUMBER">Номер</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <div className="group-format-field__actions">
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`Выше: ${field.label}`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`Ниже: ${field.label}`}
                  disabled={index === draft.fields.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`Удалить поле ${field.label}`}
                  onClick={() =>
                    setDraft({ ...draft, fields: draft.fields.filter((_, i) => i !== index) })
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
            <div className="group-format-field__settings">
              <label className="field">
                <span>Разделитель перед этой частью</span>
                <Input
                  value={field.prefix}
                  maxLength={8}
                  placeholder="Без разделителя"
                  onChange={(event) => changeField(index, { prefix: event.target.value })}
                />
              </label>
              {field.kind !== "CHOICE" && (
                <label className="field">
                  <span>Цифр в названии</span>
                  <Input
                    type="number"
                    min={field.kind === "YEAR" ? 2 : 1}
                    max={field.kind === "YEAR" ? 4 : 6}
                    step={field.kind === "YEAR" ? 2 : 1}
                    value={field.width}
                    onChange={(event) => changeField(index, { width: Number(event.target.value) })}
                  />
                </label>
              )}
              {field.kind === "YEAR" && (
                <label className="field">
                  <span>Начало столетия</span>
                  <Input
                    type="number"
                    min={1900}
                    max={2200}
                    step={100}
                    value={field.yearBase}
                    onChange={(event) =>
                      changeField(index, { yearBase: Number(event.target.value) })
                    }
                  />
                </label>
              )}
            </div>
            {field.kind === "CHOICE" && (
              <div className="group-format-choices">
                <p className="muted">
                  Обозначение попадёт в название. Допустимые написания можно перечислить через
                  запятую.
                </p>
                {field.choices.map((choice, choiceIndex) => (
                  <div className="group-format-choice" key={choiceIndex}>
                    <label className="field">
                      <span>Обозначение</span>
                      <Input
                        value={choice.code}
                        required
                        maxLength={24}
                        placeholder="б"
                        onChange={(event) =>
                          changeField(index, {
                            choices: field.choices.map((c, n) =>
                              n === choiceIndex ? { ...c, code: event.target.value } : c
                            ),
                            defaultValue:
                              field.defaultValue === choice.code
                                ? event.target.value
                                : field.defaultValue
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Полное название</span>
                      <Input
                        value={choice.label}
                        maxLength={160}
                        placeholder="Бакалавриат"
                        onChange={(event) =>
                          changeField(index, {
                            choices: field.choices.map((c, n) =>
                              n === choiceIndex ? { ...c, label: event.target.value } : c
                            )
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Другие написания</span>
                      <Input
                        value={choice.aliases.join(",")}
                        placeholder="Например, B"
                        onChange={(event) =>
                          changeField(index, {
                            choices: field.choices.map((c, n) =>
                              n === choiceIndex
                                ? { ...c, aliases: event.target.value.split(",").filter(Boolean) }
                                : c
                            )
                          })
                        }
                      />
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={`Удалить вариант ${choice.label || choiceIndex + 1}`}
                      disabled={field.choices.length === 1}
                      onClick={() =>
                        changeField(index, {
                          choices: field.choices.filter((_, n) => n !== choiceIndex),
                          defaultValue:
                            field.defaultValue === choice.code ? null : field.defaultValue
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={field.choices.length >= 128}
                  onClick={() =>
                    changeField(index, {
                      choices: [...field.choices, { code: "", label: "", aliases: [] }]
                    })
                  }
                >
                  <Plus /> Добавить вариант
                </Button>
                <label className="field">
                  <span>Если эту часть пропустили</span>
                  <select
                    value={field.defaultValue || ""}
                    onChange={(event) =>
                      changeField(index, { defaultValue: event.target.value || null })
                    }
                  >
                    <option value="">Попросить уточнить</option>
                    {field.choices
                      .filter((c) => c.code)
                      .map((choice, n) => (
                        <option key={n} value={choice.code}>
                          Подставить: {choice.label || choice.code}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            )}
          </fieldset>
        ))}
        <div className="group-format-toolbar">
          <Button
            type="button"
            variant="outline"
            disabled={draft.fields.length >= 8}
            onClick={() =>
              setDraft({
                ...draft,
                fields: [
                  ...draft.fields,
                  {
                    id: `field_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
                    label: "",
                    kind: "NUMBER",
                    prefix: "-",
                    width: 1,
                    yearBase: 2000,
                    defaultValue: null,
                    choices: []
                  }
                ]
              })
            }
          >
            <Plus /> Добавить часть
          </Button>
          <Button type="submit" disabled={save.isPending || !dirty}>
            {save.isPending ? "Сохраняем…" : "Сохранить формат"}
          </Button>
        </div>
        {save.isError && (
          <p className="form-error" role="alert">
            {userErrorMessage(save.error, "Не удалось сохранить формат")}
          </p>
        )}
      </form>
      <section className="group-format-check">
        <h2>Проверить ввод</h2>
        <p className="muted">
          Проверка использует сохранённый формат. Старые группы сохранят названия и историю.
        </p>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            preview.mutate();
          }}
        >
          <Input
            aria-label="Название для проверки"
            value={sample}
            onChange={(event) => setSample(event.target.value)}
            placeholder="БИСТ234"
            maxLength={120}
          />
          <Button variant="outline" disabled={dirty || !sample || preview.isPending}>
            Проверить
          </Button>
        </form>
        {dirty && <p className="muted">Сначала сохраните изменения формата.</p>}
        {sampleResult && <p role="status">{sampleResult}</p>}
        <h3>Связать существующие группы</h3>
        <p className="muted">
          Распознанные группы получат общую структуру для поиска занятий между курсами. Названия,
          составы и история не изменятся. Неоднозначные названия останутся для ручной проверки.
        </p>
        <Button
          variant="outline"
          disabled={dirty || !query.data?.enabled || reconcile.isPending}
          onClick={() => reconcile.mutate()}
        >
          {reconcile.isPending ? "Проверяем…" : "Проверить существующие группы"}
        </Button>
      </section>
    </div>
  );
}
