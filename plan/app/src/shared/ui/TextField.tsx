// Поле вводу тексту (T27/T28/T37 — форми створення/редагування).
//
// Controlled-компонент: значення й зміна керуються ззовні (той самий підхід,
// що CardShell/ConfirmDialog — примітив не тримає власного стану). Інлайн-
// помилка під полем — конвенція проєкту, ніколи alert/confirm
// (design-system.md §Interaction & writing conventions, "Errors").
//
// D-112 (docs/DECISIONS.md): хмаринка-підказка (приклад + навіщо). Локальний
// стан лише презентаційний (isFocused/isDismissed) -- значення поля й далі
// повністю контролює викликач, той самий controlled-підхід лишається.
// Показується: поле в фокусі І порожнє І хмаринку ще не закрили. Ніколи не
// зʼявляється, якщо в поле не заходили. Дозволяється дизайном D-112: закрита
// хмаринка НЕ зʼявляється знову для цього монтування поля, навіть якщо
// користувач вийде й зайде в порожнє поле повторно.
//
// D-121 (docs/app-shell.md): `hideLabel` -- підпис лишається в DOM (`sr-only`,
// той самий accessible name через getByLabelText), лише візуально прихований.
// Потрібно чат-композеру -- значки замінюють видимий текстовий підпис
// (docs/app-shell.md §Значки композера), але поле без ЖОДНОГО імені для
// читалки з екрана неприпустимо.

import { useState } from 'react';

export interface TextFieldProps {
  /** Підпис поля. */
  label: string;
  /** Поточне значення. */
  value: string;
  /** Викликається з новим значенням при кожній зміні вводу. */
  onChange: (value: string) => void;
  /** Текст інлайн-помилки під полем; відсутній — помилки немає. */
  error?: string;
  /** Підказка всередині порожнього поля. */
  placeholder?: string;
  /** D-112: чи обовʼязкове поле — перший рядок хмаринки-підказки. */
  required?: boolean;
  /** D-112: приклад і навіщо (1-2 речення); відсутній — хмаринки не буде взагалі. */
  hint?: string;
  /** D-121: підпис лишається accessible name (sr-only), візуально не показаний. */
  hideLabel?: boolean;
}

export function TextField({
  label,
  value,
  onChange,
  error,
  placeholder,
  required,
  hint,
  hideLabel,
}: TextFieldProps): JSX.Element {
  const [isFocused, setIsFocused] = useState(false);
  const [isHintDismissed, setIsHintDismissed] = useState(false);
  const showHint = Boolean(hint) && isFocused && value.trim() === '' && !isHintDismissed;

  return (
    <>
      {/* Хмаринка -- ЗАВЖДИ поза <label>: текст усередині <label> формує
          accessible name поля (getByLabelText), домішувати туди текст
          підказки не можна -- зламає зв'язок підпис<->поле. */}
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        <span className={hideLabel ? 'sr-only' : undefined}>{label}</span>
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
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
            // Review 2026-09-07 E (T52): без preventDefault тут mousedown на цій
            // кнопці спершу відводить фокус з інпута (реальний браузер) -> onBlur
            // ставить isFocused=false -> хмаринка (разом із цією кнопкою)
            // розмонтовується ДО того, як встигає спрацювати click -- клік
            // губиться, хмаринка "не закривається" (з'являється знову при
            // наступному фокусі). preventDefault на mousedown стримує стандартну
            // дію браузера "перенести фокус", інпут лишається сфокусованим, click
            // встигає спрацювати штатно.
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
