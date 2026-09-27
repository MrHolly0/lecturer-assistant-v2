import { Moon, Sun } from "lucide-react";
import { useMaxBridge } from "../app/max/context";
import { Button, IconButton } from "../shared/ui/button";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setPreferredTheme } = useMaxBridge();
  const next = theme === "dark" ? "light" : "dark";
  const label = `Включить ${next === "dark" ? "тёмную" : "светлую"} тему`;
  const Icon = theme === "dark" ? Sun : Moon;

  if (compact) {
    return (
      <IconButton
        label={label}
        className="icon-touch-target theme-toggle-compact"
        onClick={() => setPreferredTheme(next)}
      >
        <Icon size={18} aria-hidden="true" />
      </IconButton>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className="w-full justify-start text-muted-foreground"
      onClick={() => setPreferredTheme(next)}
    >
      <Icon size={18} aria-hidden="true" />
      {label}
    </Button>
  );
}
