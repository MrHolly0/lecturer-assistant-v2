import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { GroupField } from "../app/api/group-format";
import { Button } from "../shared/ui/button";
import { Input } from "../shared/ui/input";

export function GroupFormatField({
  field,
  index,
  count,
  changeField,
  onMove,
  onRemove,
  initiallyOpen
}: {
  field: GroupField;
  index: number;
  count: number;
  changeField: (change: Partial<GroupField>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
  initiallyOpen: boolean;
}) {
  const type = { CHOICE: "Список", YEAR: "Год", NUMBER: "Номер" }[field.kind];
  return (
    <details className="group-format-field" open={initiallyOpen}>
      <summary>
        <strong>
          {index + 1}. {field.label || "Новая часть"}
        </strong>
        <span>{type}</span>
      </summary>
      <div className="group-format-field__body">
        <div className="group-format-field__heading">
          <label className="field">
            <span>Название поля</span>
            <Input
              value={field.label}
              maxLength={80}
              required
              onChange={(event) => changeField({ label: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Тип значения</span>
            <select
              value={field.kind}
              onChange={(event) => {
                const kind = event.currentTarget.value as GroupField["kind"];
                changeField({
                  kind,
                  width: kind === "YEAR" ? 2 : 1,
                  yearBase: 2000,
                  defaultValue: null,
                  choices: kind === "CHOICE" ? [{ code: "", label: "", aliases: [] }] : []
                });
              }}
            >
              <option value="CHOICE">Вариант из списка</option>
              <option value="YEAR">Год</option>
              <option value="NUMBER">Номер</option>
            </select>
          </label>
          <div className="group-format-field__actions">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Выше: ${field.label}`}
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Ниже: ${field.label}`}
              disabled={index === count - 1}
              onClick={() => onMove(1)}
            >
              <ArrowDown />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Удалить поле ${field.label}`}
              onClick={onRemove}
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
              onChange={(event) => changeField({ prefix: event.target.value })}
            />
          </label>
          {field.kind !== "CHOICE" && (
            <label className="field">
              <span>Цифр в названии</span>
              <select
                value={field.width}
                onChange={(event) => changeField({ width: Number(event.target.value) })}
              >
                {(field.kind === "YEAR" ? [2, 4] : [1, 2, 3, 4, 5, 6]).map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          )}
          {field.kind === "YEAR" && (
            <label className="field">
              <span>Диапазон годов</span>
              <select
                value={field.yearBase}
                onChange={(event) => changeField({ yearBase: Number(event.target.value) })}
              >
                {[1900, 2000, 2100, 2200].map((year) => (
                  <option key={year} value={year}>
                    {year}–{year + 99}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {field.kind === "CHOICE" && (
          <div className="group-format-choices">
            <p className="muted">
              Обозначение попадёт в название. Допустимые написания можно перечислить через запятую.
            </p>
            {field.choices.map((choice, choiceIndex) => (
              <div className="group-format-choice" key={choiceIndex}>
                <label className="field">
                  <span>Обозначение</span>
                  <Input
                    value={choice.code}
                    required
                    maxLength={24}
                    placeholder="Например, ИСТ"
                    onChange={(event) =>
                      changeField({
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
                    placeholder="Название для преподавателя"
                    onChange={(event) =>
                      changeField({
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
                    value={(choice.aliases ?? []).join(",")}
                    placeholder="Через запятую"
                    onChange={(event) =>
                      changeField({
                        choices: field.choices.map((c, n) =>
                          n === choiceIndex ? { ...c, aliases: event.target.value.split(",") } : c
                        )
                      })
                    }
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Удалить вариант ${choice.label || choiceIndex + 1}`}
                  disabled={field.choices.length === 1}
                  onClick={() =>
                    changeField({
                      choices: field.choices.filter((_, n) => n !== choiceIndex),
                      defaultValue: field.defaultValue === choice.code ? null : field.defaultValue
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
                changeField({
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
                onChange={(event) => changeField({ defaultValue: event.target.value || null })}
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
      </div>
    </details>
  );
}
