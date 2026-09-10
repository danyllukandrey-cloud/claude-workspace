// Кнопка дії (T27/T28/T29/T36/T37 — форми та підтвердження).
//
// Мінімальний presentation-примітив: підпис + обробник кліку. Жодної
// бізнес-логіки (ADR-0004) — що саме робити при кліку, вирішує виклик картки.

export interface ButtonProps {
  /** Текст на кнопці. */
  label: string;
  /** Викликається при кліку. */
  onClick?: () => void;
  /** 'submit' — кнопка форми (спрацьовує і на Enter); 'button' — звичайна дія. */
  type?: 'button' | 'submit';
  /** Кнопка недоступна (наприклад — поки триває збереження). */
  disabled?: boolean;
}

export function Button({
  label,
  onClick,
  type = 'button',
  disabled = false,
}: ButtonProps): JSX.Element {
  return (
    <button type={type} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}
