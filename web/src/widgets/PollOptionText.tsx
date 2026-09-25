import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

export function PollOptionText({ text, className = "" }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = text.length > 120;

  return (
    <div className={`poll-option-text ${className}`.trim()}>
      <span
        className={`poll-option-text__content${expanded ? " poll-option-text__content--expanded" : ""}`}
      >
        {text}
      </span>
      {canExpand && (
        <button
          type="button"
          className="poll-option-text__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <ChevronUp size={15} aria-hidden="true" />
          ) : (
            <ChevronDown size={15} aria-hidden="true" />
          )}
          {expanded ? "Свернуть" : "Показать полностью"}
        </button>
      )}
    </div>
  );
}
