// Поле вводу числа (T28 — ціль блоку-метрики: кількість).
//
// Той самий controlled-підхід, що TextField. `value: null` означає "поле
// порожнє" — важливо тримати null, а не 0, бо 0 і "не заповнено" це різні
// стани для валідації (design-system.md §Interaction & writing conventions,
// "Validation").

export interface NumberFieldProps {
  /** Підпис поля. */
  label: string;
  /** Поточне значення; `null` — поле порожнє. */
  value: number | null;
  /** Викликається з новим значенням при кожній зміні вводу (`null`, коли поле спорожнено). */
  onChange: (value: number | null) => void;
  /** Текст інлайн-помилки під полем; відсутній — помилки немає. */
  error?: string;
}

export function NumberField({ label, value, onChange, error }: NumberFieldProps): JSX.Element {
  return (
    <label>
      {label}
      <input
        type="number"
        value={value === null ? '' : value}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === '' ? null : Number(raw));
        }}
      />
      {error && <p role="alert">{error}</p>}
    </label>
  );
}
