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
  DropdownMenuTrigger
} from "../shared/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { IconButton } from "../shared/ui/button";

type CourseRole = "LECTURER" | "ASSISTANT" | "STUDENT";
type MemberAction = "owner" | "remove" | null;

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

  return (
    <div className="member-actions">
      <Select value={role} onValueChange={(value) => onRoleChange(value as CourseRole)}>
        <SelectTrigger className="member-role-select" aria-label={`Роль: ${displayName}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="STUDENT">Студент</SelectItem>
          <SelectItem value="ASSISTANT">Ассистент</SelectItem>
          <SelectItem value="LECTURER">Лектор</SelectItem>
        </SelectContent>
      </Select>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            className="member-more-button"
            label={`Действия: ${displayName}`}
          >
            <MoreHorizontal size={18} aria-hidden="true" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setAction("owner")}>
            <Crown aria-hidden="true" /> Сделать владельцем
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setAction("remove")}>
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
              onClick={() => (remove ? onRemove() : onChangeOwner())}
            >
              {remove ? "Удалить" : "Сделать владельцем"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
