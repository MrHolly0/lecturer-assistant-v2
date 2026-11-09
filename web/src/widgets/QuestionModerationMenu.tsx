import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, MessageSquareOff, MessageSquare, Eraser } from "lucide-react";
import { toast } from "sonner";
import { moderateQuestionAuthor } from "../app/api/student-api";
import { userErrorMessage } from "../app/api/errors";
import { Button } from "../shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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

export function QuestionModerationMenu({
  courseId,
  sessionId,
  questionId,
  disabled = false,
  container,
  onClear
}: {
  courseId: string;
  sessionId: string;
  questionId: string;
  disabled?: boolean;
  container?: HTMLElement | null;
  onClear?: () => void;
}) {
  const client = useQueryClient();
  const [confirmClear, setConfirmClear] = useState(false);
  const moderation = useMutation({
    mutationFn: ({ muted, hideQuestions = false }: { muted: boolean; hideQuestions?: boolean }) =>
      moderateQuestionAuthor(courseId, sessionId, questionId, { muted, hideQuestions }),
    onSuccess: (result, request) => {
      void client.invalidateQueries({ queryKey: ["live", courseId, sessionId] });
      if (request.hideQuestions) onClear?.();
      toast.success(
        result.muted
          ? request.hideQuestions
            ? "Автор заглушён до конца занятия. Его вопросы скрыты."
            : "Автор заглушён до конца занятия."
          : "Автор снова может задавать вопросы."
      );
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось изменить ограничение."))
  });
  const busy = disabled || moderation.isPending;
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={busy}
            aria-label="Модерация автора вопроса"
            title="Модерация автора вопроса"
          >
            <Ellipsis size={18} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          container={container}
          className="max-w-[calc(100vw-2rem)] data-[state=open]:animate-none data-[state=closed]:animate-none"
        >
          <DropdownMenuItem disabled={busy} onSelect={() => moderation.mutate({ muted: true })}>
            <MessageSquareOff aria-hidden="true" /> Заглушить до конца занятия
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onSelect={() => setConfirmClear(true)}>
            <Eraser aria-hidden="true" /> Заглушить и очистить
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={busy} onSelect={() => moderation.mutate({ muted: false })}>
            <MessageSquare aria-hidden="true" /> Снять заглушение
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent container={container}>
          <AlertDialogHeader>
            <AlertDialogTitle>Заглушить автора и скрыть его вопросы?</AlertDialogTitle>
            <AlertDialogDescription>
              До конца занятия автор не сможет отправлять вопросы. Все его вопросы на этом занятии,
              включая опубликованные ответы, переместятся в «Скрытые». Снятие заглушения не вернёт
              их в ленту.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => moderation.mutate({ muted: true, hideQuestions: true })}
            >
              Заглушить и очистить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
