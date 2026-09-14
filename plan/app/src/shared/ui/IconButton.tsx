// Кнопка-значок (D-121, docs/app-shell.md) -- той самий мінімальний
// presentation-примітив, що Button.tsx (лише обробник кліку, жодної
// бізнес-логіки, ADR-0004), але без видимого тексту: accessible name йде
// ЛИШЕ через обов'язковий `label` (aria-label) -- іконка сама по собі
// aria-hidden (icons.tsx), тому без цього пропу кнопка була б без імені для
// читалки з екрана.

import type { ReactNode } from 'react';

export interface IconButtonProps {
  /** Accessible name (aria-label) -- єдине джерело підпису кнопки, бо іконка aria-hidden. */
  label: string;
  /** Сама іконка (одна з icons.tsx), передається дитиною -- IconButton не знає конкретних значків. */
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
}

export function IconButton({ label, children, onClick, type = 'button', disabled = false }: IconButtonProps): JSX.Element {
  return (
    <button
      type={type}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-accent-soft hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-muted"
    >
      {children}
    </button>
  );
}
