import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  createQuestion,
  updateQuestion,
  type CreateQuestionRequest,
  type QuestionBankEntry,
  type QuestionOption,
  type QuestionType
} from "../app/api/interaction-api";
import { Badge } from "../shared/ui/badge";
import { Button } from "../shared/ui/button";
import { Checkbox } from "../shared/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../shared/ui/dialog";
import { Input } from "../shared/ui/input";
import { Label } from "../shared/ui/label";
import { QUESTION_TYPES } from "../shared/lib/questionTypes";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/ui/tabs";

interface QuestionDialogProps {
  courseId: string;
  open: boolean;
  initial?: QuestionBankEntry;
  onClose: () => void;
  onSaved: () => void;
}

const EMPTY_OPTIONS: QuestionOption[] = [
  { text: "", correct: false },
  { text: "", correct: false }
];

export function QuestionDialog({ courseId, open, initial, onClose, onSaved }: QuestionDialogProps) {
  const [text, setText] = useState(initial?.text ?? "");
  const [type, setType] = useState<QuestionType>(initial?.questionType ?? "CHOICE");
  const [options, setOptions] = useState<QuestionOption[]>(
    initial?.options && initial.options.length > 0 ? initial.options : EMPTY_OPTIONS
  );
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);

  const saveMut = useMutation({
    mutationFn: () => {
      const request: CreateQuestionRequest = {
        text: text.trim(),
        questionType: type,
        options,
        tags
      };
      return initial
        ? updateQuestion(courseId, initial.id, request)
        : createQuestion(courseId, request);
    },
    onSuccess: () => {
      toast.success(initial ? "Вопрос обновлён." : "Вопрос создан.");
      onSaved();
    },
    onError: () => toast.error("Не удалось сохранить вопрос.")
  });

  function addTag() {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) setTags([...tags, tag]);
    setTagInput("");
  }

  const canSave =
    text.trim().length > 0 &&
    options.length >= 1 &&
    options.every((option) => option.text.trim().length > 0) &&
    !saveMut.isPending;

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="qbank-dialog">
        <DialogHeader>
          <DialogTitle>{initial ? "Редактировать вопрос" : "Новый вопрос"}</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="question">
          <TabsList>
            <TabsTrigger value="question">Вопрос</TabsTrigger>
            <TabsTrigger value="options">Ответы</TabsTrigger>
            <TabsTrigger value="tags">Теги</TabsTrigger>
          </TabsList>
          <TabsContent value="question" className="qbank-tab">
            <div className="qbank-field">
              <Label>Тип вопроса</Label>
              <Select value={type} onValueChange={(value) => setType(value as QuestionType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUESTION_TYPES.map((questionType) => (
                    <SelectItem key={questionType.value} value={questionType.value}>
                      {questionType.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="qbank-field">
              <Label htmlFor="q-text">Текст вопроса</Label>
              <textarea
                id="q-text"
                className="qbank-textarea"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Введите текст вопроса"
                rows={4}
                maxLength={2000}
              />
            </div>
          </TabsContent>
          <TabsContent value="options" className="qbank-tab">
            <p className="muted qbank-hint">
              {type === "MULTIPLE_CHOICE"
                ? "Отметьте все правильные варианты."
                : "Отметьте один правильный вариант."}
            </p>
            <div className="qbank-options-editor">
              {options.map((option, index) => (
                <div key={index} className="qbank-option-edit-row">
                  <Checkbox
                    id={`opt-correct-${index}`}
                    checked={option.correct}
                    aria-label={`Правильный вариант ${index + 1}`}
                    onCheckedChange={(checked) =>
                      setOptions(
                        options.map((item, itemIndex) => ({
                          ...item,
                          correct:
                            type === "MULTIPLE_CHOICE"
                              ? itemIndex === index
                                ? Boolean(checked)
                                : item.correct
                              : itemIndex === index
                        }))
                      )
                    }
                  />
                  <Input
                    value={option.text}
                    onChange={(event) =>
                      setOptions(
                        options.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, text: event.target.value } : item
                        )
                      )
                    }
                    placeholder={`Вариант ${index + 1}`}
                    aria-label={`Текст варианта ${index + 1}`}
                    maxLength={500}
                  />
                  {options.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setOptions(options.filter((_, itemIndex) => itemIndex !== index))
                      }
                      aria-label={`Удалить вариант ${index + 1}`}
                      title={`Удалить вариант ${index + 1}`}
                    >
                      <X size={12} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {options.length < 10 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOptions([...options, { text: "", correct: false }])}
              >
                <Plus size={12} />
                Добавить вариант
              </Button>
            )}
          </TabsContent>
          <TabsContent value="tags" className="qbank-tab">
            <div className="qbank-tag-editor">
              <div className="qbank-tag-input-row">
                <Input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  placeholder="Тег (напр. алгебра)"
                  onKeyDown={(event) => event.key === "Enter" && addTag()}
                  maxLength={50}
                />
                <Button variant="outline" size="sm" onClick={addTag}>
                  Добавить
                </Button>
              </div>
              <div className="qbank-tag-list">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="qbank-tag-chip">
                    {tag}
                    <button
                      type="button"
                      onClick={() => setTags(tags.filter((item) => item !== tag))}
                      aria-label={`Удалить тег ${tag}`}
                      title={`Удалить тег ${tag}`}
                    >
                      <X size={10} />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
        <div className="qbank-dialog-footer">
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!canSave} onClick={() => saveMut.mutate()}>
            {initial ? "Сохранить" : "Создать"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
