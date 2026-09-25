import type { ReactNode } from "react";
import type { VariantProps } from "class-variance-authority";
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
import { Button, buttonVariants } from "../shared/ui/button";

interface ConfirmActionButtonProps {
  children: ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  className?: string;
  variant?: VariantProps<typeof buttonVariants>["variant"];
  disabled?: boolean;
  onConfirm: () => void;
}

export function ConfirmActionButton({
  children,
  title,
  description,
  confirmLabel = "Удалить",
  className,
  variant = "ghost",
  disabled,
  onConfirm
}: ConfirmActionButtonProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" className={className} variant={variant} disabled={disabled}>
          {children}
        </Button>
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
