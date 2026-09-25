import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Link, type LinkProps } from "react-router-dom";

import { cn } from "./utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

const buttonVariants = cva("ui-button", {
  variants: {
    variant: {
      default: "ui-button--primary",
      destructive: "ui-button--destructive",
      outline: "ui-button--outline",
      secondary: "ui-button--secondary",
      ghost: "ui-button--ghost",
      link: "ui-button--link"
    },
    size: {
      default: "ui-button--md",
      sm: "ui-button--sm",
      lg: "ui-button--lg",
      icon: "ui-button--icon"
    }
  },
  defaultVariants: {
    variant: "default",
    size: "default"
  }
});

type ButtonProps = React.ComponentPropsWithoutRef<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, ...props },
  ref
) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      ref={ref}
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
});

type LinkButtonProps = Omit<LinkProps, "className"> &
  VariantProps<typeof buttonVariants> & {
    className?: string;
  };

function LinkButton({ className, variant, size, ...props }: LinkButtonProps) {
  return <Link className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

type IconButtonProps = Omit<React.ComponentPropsWithoutRef<"button">, "aria-label" | "children"> &
  Omit<VariantProps<typeof buttonVariants>, "size"> & {
    children: React.ReactNode;
    label: string;
    tooltip?: boolean;
  };

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { children, className, label, tooltip = true, variant = "ghost", ...props },
  ref
) {
  const control = (
    <Button
      ref={ref}
      aria-label={label}
      className={className}
      size="icon"
      variant={variant}
      {...props}
    >
      {children}
    </Button>
  );

  if (!tooltip) return control;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
});

export { Button, IconButton, LinkButton, buttonVariants };
