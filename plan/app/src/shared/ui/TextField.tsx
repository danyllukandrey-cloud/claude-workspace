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
}

export function TextField({
  label,
  value,
  onChange,
  error,
  placeholder,
  required,
  hint,
}: TextFieldProps): JSX.Element {
  const [isFocused, setIsFocused] = useState(false);
  const [isHintDismissed, setIsHintDismissed] = useState(false);
  const showHint = Boolean(hint) && isFocused && value.trim() === '' && !isHintDismissed;

  return (
    <>
      {/* Хмаринка -- ЗАВЖДИ поза <label>: текст усередині <label> формує
          accessible name поля (getByLabelText), домішувати туди текст
          підказки не можна -- зламає зв'язок підпис<->поле. */}
      <label>
        {label}
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
        {error && <p role="alert">{error}</p>}
      </label>
      {showHint && (
        <div role="tooltip">
          <span>{required ? 'Обовʼязково' : 'Необовʼязково'}</span>
          <p>{hint}</p>
          <button type="button" aria-label={`Закрити підказку: ${label}`} onClick={() => setIsHintDismissed(true)}>
            ✕
          </button>
        </div>
      )}
    </>
  );
}
