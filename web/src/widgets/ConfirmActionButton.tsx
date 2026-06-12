import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "../shared/ui/alert-dialog";

interface ConfirmActionButtonProps {
  children: ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  className?: string;
  disabled?: boolean;
  onConfirm: () => void;
}

export function ConfirmActionButton({
  children,
  title,
  description,
  confirmLabel = "Удалить",
  className = "btn-ghost",
  disabled,
  onConfirm
}: ConfirmActionButtonProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button type="button" className={className} disabled={disabled}>
          {children}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
