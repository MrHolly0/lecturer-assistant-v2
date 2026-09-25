import { ChevronDown, ChevronUp } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

export function PollOptionText({ text, className = "" }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const contentRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    setExpanded(false);
  }, [text]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const measureOverflow = () => {
      const lineHeight = Number.parseFloat(window.getComputedStyle(content).lineHeight);
      const collapsedHeight = lineHeight * 3;
      const overflows =
        Number.isFinite(collapsedHeight) && content.scrollHeight > collapsedHeight + 1;
      setCanExpand(overflows);
      if (!overflows) setExpanded(false);
    };

    measureOverflow();
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(content);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <div className={`poll-option-text ${className}`.trim()}>
      <span
        ref={contentRef}
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
