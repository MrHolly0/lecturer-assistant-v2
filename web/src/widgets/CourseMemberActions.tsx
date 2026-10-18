import { useRef, useState } from "react";
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
type MemberAction = "owner" | "remove" | "role" | null;

const ROLE_LABELS: Record<CourseRole, string> = {
  LECTURER: "Преподаватель",
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
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [nextRole, setNextRole] = useState<CourseRole | null>(null);
  const remove = action === "remove";
  const changeRole = action === "role";
  const scheduleAction = (next: Exclude<MemberAction, null>) => {
    window.setTimeout(() => setAction(next), 0);
  };

  return (
    <div className="member-actions">
      <span className="badge member-role-badge">{ROLE_LABELS[role]}</span>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <IconButton
            ref={menuTrigger}
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
              if (value !== role) {
                setNextRole(value as CourseRole);
                scheduleAction("role");
              }
            }}
          >
            <DropdownMenuRadioItem value="LECTURER">Преподаватель</DropdownMenuRadioItem>
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
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            if (menuTrigger.current?.isConnected) {
              event.preventDefault();
              menuTrigger.current.focus();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {remove
                ? "Удалить участника?"
                : changeRole
                  ? "Изменить роль в курсе?"
                  : "Сделать владельцем курса?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {remove
                ? `${displayName} потеряет доступ к этому курсу.`
                : changeRole
                  ? `${displayName} получит роль «${ROLE_LABELS[nextRole ?? role]}» в этом курсе. Системная роль и другие курсы не изменятся.`
                  : `${displayName} станет владельцем курса с ролью преподавателя. У вас сохранится роль преподавателя.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={disabled}
              onClick={() => {
                setAction(null);
                if (remove) onRemove();
                else if (changeRole && nextRole) onRoleChange(nextRole);
                else onChangeOwner();
              }}
            >
              {remove ? "Удалить из курса" : changeRole ? "Сохранить роль" : "Сделать владельцем"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
