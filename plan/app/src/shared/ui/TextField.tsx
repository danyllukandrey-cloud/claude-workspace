// Поле вводу тексту (T27/T28/T37 — форми створення/редагування).
//
// Controlled-компонент: значення й зміна керуються ззовні (той самий підхід,
// що CardShell/ConfirmDialog — примітив не тримає власного стану). Інлайн-
// помилка під полем — конвенція проєкту, ніколи alert/confirm
// (design-system.md §Interaction & writing conventions, "Errors").

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
}

export function TextField({ label, value, onChange, error, placeholder }: TextFieldProps): JSX.Element {
  return (
    <label>
      {label}
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <p role="alert">{error}</p>}
    </label>
  );
}
