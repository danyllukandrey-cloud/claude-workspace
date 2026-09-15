// Поле вводу числа (T28 — ціль блоку-метрики: кількість).
//
// Той самий controlled-підхід, що TextField. `value: null` означає "поле
// порожнє" — важливо тримати null, а не 0, бо 0 і "не заповнено" це різні
// стани для валідації (design-system.md §Interaction & writing conventions,
// "Validation").
//
// D-112 (docs/DECISIONS.md): та сама хмаринка-підказка, що TextField
// (приклад + навіщо) -- дивись коментар там, поведінка ідентична.

import { useState } from 'react';

export interface NumberFieldProps {
  /** Підпис поля. */
  label: string;
  /** Поточне значення; `null` — поле порожнє. */
  value: number | null;
  /** Викликається з новим значенням при кожній зміні вводу (`null`, коли поле спорожнено). */
  onChange: (value: number | null) => void;
  /** Текст інлайн-помилки під полем; відсутній — помилки немає. */
  error?: string;
  /** D-112: чи обовʼязкове поле — перший рядок хмаринки-підказки. */
  required?: boolean;
  /** D-112: приклад і навіщо (1-2 речення); відсутній — хмаринки не буде взагалі. */
  hint?: string;
}

export function NumberField({
  label,
  value,
  onChange,
  error,
  required,
  hint,
}: NumberFieldProps): JSX.Element {
  const [isFocused, setIsFocused] = useState(false);
  const [isHintDismissed, setIsHintDismissed] = useState(false);
  const showHint = Boolean(hint) && isFocused && value === null && !isHintDismissed;

  return (
    <>
      {/* Хмаринка -- ЗАВЖДИ поза <label>, той самий прецедент, що TextField. */}
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        {label}
        <input
          type="number"
          value={value === null ? '' : value}
          onChange={(event) => {
            const raw = event.target.value;
            onChange(raw === '' ? null : Number(raw));
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="rounded-control border border-border bg-surface-solid px-3.5 py-2.5 font-sans text-sm font-normal text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/15"
        />
        {error && (
          <p role="alert" className="text-xs font-semibold text-bad">
            {error}
          </p>
        )}
      </label>
      {showHint && (
        <div
          role="tooltip"
          className="mt-1.5 flex items-start gap-2 rounded-control border border-border bg-surface-solid px-3.5 py-2.5 shadow-soft"
        >
          <div className="flex-1">
            <span className="text-xs font-bold text-ink">{required ? 'Обовʼязково' : 'Необовʼязково'}</span>
            <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>
          </div>
          <button
            type="button"
            aria-label={`Закрити підказку: ${label}`}
            className="text-ink-faint transition-colors hover:text-ink"
            // Review 2026-09-07 E (T52): той самий фікс, що TextField.tsx --
            // без preventDefault mousedown відводить фокус з інпута ДО click,
            // хмаринка розмонтовується разом із цією кнопкою, клік губиться.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setIsHintDismissed(true)}
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
