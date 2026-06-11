"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, ToasterProps, toast } from "sonner";
import { useEffect } from "react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  useEffect(() => {
    // Catch the pointerup event during the capture phase, so we get it
    // before sonner has any chance to stop propagation or suppress clicks.
    const handleInteraction = (e: Event) => {
      const target = e.target as HTMLElement;
      const toastEl = target.closest("[data-sonner-toast]");
      if (toastEl && target.tagName !== "BUTTON" && target.tagName !== "A") {
        toast.dismiss();
      }
    };

    // Use pointerup/click with capture: true
    document.addEventListener("click", handleInteraction, { capture: true });
    document.addEventListener("pointerup", handleInteraction, { capture: true });

    return () => {
      document.removeEventListener("click", handleInteraction, { capture: true });
      document.removeEventListener("pointerup", handleInteraction, { capture: true });
    };
  }, []);

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: "cursor-pointer"
        }
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)"
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
