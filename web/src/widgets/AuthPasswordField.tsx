import { useId, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

interface AuthPasswordFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  label: string;
  onValueChange: (value: string) => void;
}

export function AuthPasswordField({ label, id, onValueChange, ...props }: AuthPasswordFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return (
    <div className="field auth-password-field">
      <label htmlFor={inputId}>{label}</label>
      <div className="auth-password-control">
        <input
          {...props}
          id={inputId}
          type={visible ? "text" : "password"}
          onChange={(event) => onValueChange(event.target.value)}
        />
        <button
          type="button"
          aria-label={`${visible ? "Скрыть" : "Показать"} ${label.toLocaleLowerCase("ru-RU")}`}
          aria-pressed={visible}
          className="auth-password-toggle"
          onClick={() => setVisible((value) => !value)}
        >
          <Icon size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
