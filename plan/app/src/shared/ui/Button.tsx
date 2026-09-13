// Кнопка дії (T27/T28/T29/T36/T37 — форми та підтвердження).
//
// Мінімальний presentation-примітив: підпис + обробник кліку. Жодної
// бізнес-логіки (ADR-0004) — що саме робити при кліку, вирішує виклик картки.
//
// Стиль (D-120): матовий фірмовий колір (суцільна заливка, без відблиску) --
// design-system.md поки описує лише один варіант (стани "default, disabled"),
// без поділу на "головна/другорядна" дія. Такий поділ — реальне рішення про
// конкретні екрани (де саме потрібна другорядна/скасувальна кнопка), не
// властивість самого примітива — свідомо залишено на крок стилізації екранів,
// а не додано сюди наперед.

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
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="rounded-control bg-accent px-4 py-3 font-sans text-sm font-bold text-accent-ink shadow-btn transition-opacity enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
    >
      {label}
    </button>
  );
}
