import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Plus, Search, X } from "lucide-react";
import { listQuestions, type QuestionBankEntry } from "../app/api/interaction-api";
import { userErrorMessage } from "../app/api/errors";
import { pluralizeRu } from "../shared/lib/plural";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { Button, IconButton, LinkButton } from "../shared/ui/button";

export interface PollDraft {
  questionText: string;
  options: string[];
  questionId?: string;
  correctOptionIdx?: number;
}

interface PollComposerProps {
  courseId: string;
  pending: boolean;
  onCancel: () => void;
  onStart: (draft: PollDraft) => void;
}

export function PollComposer({ courseId, pending, onCancel, onStart }: PollComposerProps) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [search, setSearch] = useState("");
  const questionsQuery = useQuery({
    queryKey: ["questions", courseId],
    queryFn: () => listQuestions(courseId)
  });
  const eligibleQuestions = useMemo(
    () =>
      (questionsQuery.data ?? []).filter((item) => {
        const matchesSearch = item.text.toLocaleLowerCase("ru-RU").includes(search.toLowerCase());
        return !item.archived && eligibleForQuickPoll(item) && matchesSearch;
      }),
    [questionsQuery.data, search]
  );
  const canStart =
    !pending &&
    question.trim().length > 0 &&
    options.length >= 2 &&
    options.every((option) => option.trim().length > 0);

  return (
    <div className="poll-panel poll-composer">
      <div className="poll-panel-header">
        <span className="poll-panel-title">Запустить проверку</span>
        <IconButton className="poll-icon-button" onClick={onCancel} label="Закрыть редактор опроса">
          <X size={16} />
        </IconButton>
      </div>
      <Tabs defaultValue="bank">
        <TabsList className="poll-source-tabs h-auto min-h-[52px]">
          <TabsTrigger value="bank">Из банка</TabsTrigger>
          <TabsTrigger value="quick">Быстрый вопрос</TabsTrigger>
        </TabsList>
        <TabsContent value="bank" className="poll-source-content">
          <label className="poll-search">
            <Search size={15} aria-hidden="true" />
            <span className="sr-only">Поиск по банку вопросов</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Найти вопрос"
            />
          </label>
          {questionsQuery.isLoading && <p className="muted poll-message">Загрузка вопросов…</p>}
          {questionsQuery.isError && (
            <div className="poll-message form-error" role="alert">
              <span>{userErrorMessage(questionsQuery.error, "Не удалось загрузить банк.")}</span>
              <Button type="button" variant="outline" onClick={() => questionsQuery.refetch()}>
                Повторить
              </Button>
            </div>
          )}
          {!questionsQuery.isLoading && !questionsQuery.isError && (
            <div className="poll-bank-list">
              {eligibleQuestions.map((item) => {
                const correctOptionIdx = item.options.findIndex((option) => option.correct);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="poll-bank-question"
                    disabled={pending}
                    onClick={() =>
                      onStart({
                        questionId: item.id,
                        questionText: item.text,
                        options: item.options.map((option) => option.text),
                        correctOptionIdx
                      })
                    }
                  >
                    <span>{item.text}</span>
                    <small>
                      {item.options.length}{" "}
                      {pluralizeRu(item.options.length, "вариант", "варианта", "вариантов")}
                    </small>
                  </button>
                );
              })}
              {eligibleQuestions.length === 0 && !search && (
                <div className="poll-message poll-bank-empty">
                  <p className="muted">В банке нет вопросов с одним правильным ответом.</p>
                  <LinkButton
                    variant="outline"
                    to={`/courses/${courseId}/questions`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Plus size={14} aria-hidden="true" /> Создать в банке
                  </LinkButton>
                </div>
              )}
              {eligibleQuestions.length === 0 && search && (
                <p className="muted poll-message">По этому запросу вопросов нет.</p>
              )}
            </div>
          )}
        </TabsContent>
        <TabsContent value="quick" className="poll-source-content">
          <textarea
            className="poll-question-input"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Текст вопроса"
            rows={2}
            maxLength={500}
          />
          <div className="poll-options-list">
            {options.map((option, index) => (
              <div key={index} className="poll-option-row">
                <input
                  className="poll-option-input"
                  value={option}
                  onChange={(event) => {
                    const next = [...options];
                    next[index] = event.target.value;
                    setOptions(next);
                  }}
                  placeholder={`Вариант ${index + 1}`}
                  maxLength={200}
                />
                {options.length > 2 && (
                  <IconButton
                    className="poll-icon-button"
                    onClick={() =>
                      setOptions(options.filter((_, itemIndex) => itemIndex !== index))
                    }
                    label={`Удалить вариант ${index + 1}`}
                  >
                    <X size={14} />
                  </IconButton>
                )}
              </div>
            ))}
          </div>
          {options.length < 6 && (
            <Button type="button" variant="ghost" onClick={() => setOptions([...options, ""])}>
              <Plus size={14} />
              Добавить вариант
            </Button>
          )}
          <Button
            type="button"
            disabled={!canStart}
            onClick={() =>
              onStart({
                questionText: question.trim(),
                options: options.map((option) => option.trim())
              })
            }
          >
            <Check size={16} />
            Запустить
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function eligibleForQuickPoll(question: QuestionBankEntry) {
  const supportedType =
    question.questionType === "CHOICE" || question.questionType === "TRUE_FALSE";
  const correctOptions = question.options.filter((option) => option.correct).length;
  return (
    supportedType &&
    question.options.length >= 2 &&
    question.options.length <= 6 &&
    correctOptions === 1
  );
}
