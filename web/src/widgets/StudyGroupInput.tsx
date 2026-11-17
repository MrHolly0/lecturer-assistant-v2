import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getGroupFormat, previewGroup, type GroupInput } from "../app/api/group-format";
import { userErrorMessage } from "../app/api/errors";
import { Button } from "../shared/ui/button";
import { Input } from "../shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";

export interface StudyGroupInputHandle {
  validate: () => Promise<GroupInput | null>;
}

/** Short text first. The institution's structured form appears only after an invalid submission. */
export const StudyGroupInput = forwardRef<
  StudyGroupInputHandle,
  {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }
>(function StudyGroupInput({ value, onChange, disabled }, ref) {
  const id = useId();
  const policy = useQuery({
    queryKey: ["group-format"],
    queryFn: getGroupFormat,
    staleTime: 60_000
  });
  const [structured, setStructured] = useState(false);
  const [step, setStep] = useState(0);
  const [parts, setParts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  useEffect(() => {
    if (!value) {
      generation.current++;
      setStructured(false);
      setParts({});
      setStep(0);
      setMessage("");
    }
  }, [value]);
  const fields = policy.data?.fields ?? [];
  const field = fields[step];

  const validate = async (): Promise<GroupInput | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    const version = generation.current;
    setChecking(true);
    setMessage("");
    try {
      const result = await previewGroup(structured ? { parts } : { name: value });
      if (version !== generation.current) return null;
      if (result.valid && result.name) {
        return {
          name: result.name,
          ...(Object.keys(result.parts).length ? { parts: result.parts } : {})
        };
      }
      const current = await policy.refetch();
      if (version !== generation.current) return null;
      if (current.data?.enabled) {
        const sourceParts = structured ? parts : result.parts;
        const nextParts = Object.fromEntries(
          current.data.fields
            .map((field) => [field.id, sourceParts[field.id] || field.defaultValue || ""])
            .filter(([, value]) => value)
        );
        setParts(nextParts);
        setStructured(true);
        const recognized = structured ? result.parts : nextParts;
        const missing = current.data.fields.findIndex((f) => !recognized[f.id]);
        setStep(missing < 0 ? 0 : missing);
      }
      setMessage(result.message ?? "Проверьте название группы");
      requestAnimationFrame(() =>
        container.current?.querySelector<HTMLElement>("[data-group-step-control]")?.focus()
      );
      return null;
    } catch (error) {
      if (version === generation.current)
        setMessage(userErrorMessage(error, "Не удалось проверить группу. Повторите попытку."));
      return null;
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  };
  useImperativeHandle(ref, () => ({ validate }));

  return (
    <div className="study-group-input" ref={container}>
      <label className="field" htmlFor={id}>
        <span>Название группы</span>
        <Input
          id={id}
          value={value}
          maxLength={120}
          autoComplete="off"
          placeholder="Введите название группы"
          disabled={disabled || checking}
          aria-describedby={message ? `${id}-message` : undefined}
          aria-invalid={Boolean(message) && !structured}
          onChange={(event) => {
            generation.current++;
            setStructured(false);
            setMessage("");
            onChange(event.target.value);
          }}
        />
      </label>
      {message && (
        <p id={`${id}-message`} className="form-error" role="alert">
          {message}
        </p>
      )}
      {structured && field && (
        <fieldset className="study-group-steps" disabled={disabled || checking}>
          <legend>Уточните группу</legend>
          <p className="muted">
            Шаг {step + 1} из {fields.length}. Распознанные значения уже заполнены.
          </p>
          <label className="field" htmlFor={`${id}-step`}>
            <span>{field.label}</span>
            {field.kind === "CHOICE" ? (
              <Select
                value={parts[field.id] ?? ""}
                onValueChange={(value) => {
                  setParts((old) => ({ ...old, [field.id]: value }));
                  setMessage("");
                }}
              >
                <SelectTrigger id={`${id}-step`} data-group-step-control>
                  <SelectValue placeholder="Выберите вариант" />
                </SelectTrigger>
                <SelectContent>
                  {field.choices.map((choice) => (
                    <SelectItem key={choice.code} value={choice.code}>
                      {choice.label || choice.code} ({choice.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={`${id}-step`}
                data-group-step-control
                inputMode="numeric"
                value={parts[field.id] ?? ""}
                placeholder={field.kind === "YEAR" ? "Например, 2023" : "Например, 4"}
                maxLength={field.kind === "YEAR" ? 4 : field.width}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setParts((old) => ({ ...old, [field.id]: value }));
                  setMessage("");
                }}
              />
            )}
          </label>
          <div className="study-group-steps__navigation">
            <Button
              type="button"
              variant="outline"
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
            >
              Назад
            </Button>
            {step < fields.length - 1 ? (
              <Button type="button" disabled={!parts[field.id]} onClick={() => setStep(step + 1)}>
                Далее
              </Button>
            ) : (
              <span className="muted">Сохраните группу, когда все поля заполнены.</span>
            )}
          </div>
        </fieldset>
      )}
      {checking && (
        <p className="muted" role="status">
          Проверяем формат…
        </p>
      )}
    </div>
  );
});
