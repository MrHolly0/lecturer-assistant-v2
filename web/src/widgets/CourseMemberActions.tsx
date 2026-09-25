import { useState } from "react";
import { Crown, MoreHorizontal, UserMinus } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../shared/ui/dropdown-menu";
import { IconButton } from "../shared/ui/button";

type CourseRole = "LECTURER" | "ASSISTANT" | "STUDENT";
type MemberAction = "owner" | "remove" | null;

const ROLE_LABELS: Record<CourseRole, string> = {
  LECTURER: "Лектор",
  ASSISTANT: "Ассистент",
  STUDENT: "Студент"
};

interface CourseMemberActionsProps {
  displayName: string;
  role: CourseRole;
  disabled: boolean;
  onRoleChange: (role: CourseRole) => void;
  onChangeOwner: () => void;
  onRemove: () => void;
}

export function CourseMemberActions({
  displayName,
  role,
  disabled,
  onRoleChange,
  onChangeOwner,
  onRemove
}: CourseMemberActionsProps) {
  const [action, setAction] = useState<MemberAction>(null);
  const remove = action === "remove";
  const scheduleAction = (next: Exclude<MemberAction, null>) => {
    window.setTimeout(() => setAction(next), 0);
  };

  return (
    <div className="member-actions">
      <span className="badge member-role-badge">{ROLE_LABELS[role]}</span>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <IconButton
            className="member-more-button"
            label={`Действия: ${displayName}`}
            tooltip={false}
            disabled={disabled}
            title={`Действия: ${displayName}`}
          >
            <MoreHorizontal size={18} aria-hidden="true" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="member-action-menu">
          <DropdownMenuLabel>Роль в курсе</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={role}
            onValueChange={(value) => {
              if (value !== role) onRoleChange(value as CourseRole);
            }}
          >
            <DropdownMenuRadioItem value="LECTURER">Лектор</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="ASSISTANT">Ассистент</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="STUDENT">Студент</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => scheduleAction("owner")}>
            <Crown aria-hidden="true" /> Сделать владельцем
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => scheduleAction("remove")}>
            <UserMinus aria-hidden="true" /> Удалить из курса
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={action !== null} onOpenChange={(open) => !open && setAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {remove ? "Удалить участника?" : "Сделать владельцем курса?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {remove
                ? `${displayName} потеряет доступ к курсу.`
                : `${displayName} станет лектором-владельцем курса. Вы останетесь лектором.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={disabled}
              onClick={() => {
                setAction(null);
                if (remove) onRemove();
                else onChangeOwner();
              }}
            >
              {remove ? "Удалить" : "Сделать владельцем"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
