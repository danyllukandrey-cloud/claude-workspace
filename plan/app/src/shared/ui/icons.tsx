// Мінімальний набір SVG-значків композера чату (D-121, docs/app-shell.md):
// вкладення/відправка/мікрофон (заглушка)/хендл розгортання. Inline SVG, не
// бібліотека — той самий підхід, що design-system.md §Design tool ("code",
// без Figma/MCP): 4 значки не виправдовують нову залежність.
//
// currentColor скрізь -- колір задає viewer через text-* клас на IconButton
// (та сама конвенція, що решта shared/ui: колір/тема -- відповідальність
// викликача, не примітива).

export interface IconProps {
  className?: string;
}

export function AttachIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21.44 11.05 12.25 20.24a5 5 0 0 1-7.07-7.07l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a2 2 0 0 1-2.83-2.83l7.78-7.78" />
    </svg>
  );
}

export function SendIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </svg>
  );
}

export function MicIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 19v3" />
    </svg>
  );
}

/** Хендл розгортання/згортання чат-панелі (D-121) — шеврон, напрямок задає обгортка (rotate). */
export function ChevronIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}
