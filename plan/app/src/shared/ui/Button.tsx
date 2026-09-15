// Кнопка дії (T27/T28/T29/T36/T37 — форми та підтвердження).
//
// Мінімальний presentation-примітив: підпис + обробник кліку. Жодної
// бізнес-логіки (ADR-0004) — що саме робити при кліку, вирішує виклик картки.
//
// Стиль (D-120, оновлено -- фірмовий колір прибрано): прозора кнопка з
// рамкою й ефектом скла (backdrop-blur, той самий рівень, що CardShell.tsx)
// -- жодної кольорової заливки, текст лише --color-ink (чорний у світлій
// темі, білий у темній) -- design-system.md поки описує лише один варіант
// (стани "default, disabled"), без поділу на "головна/другорядна" дія. Такий
// поділ — реальне рішення про конкретні екрани (де саме потрібна
// другорядна/скасувальна кнопка), не властивість самого примітива —
// свідомо залишено на крок стилізації екранів, а не додано сюди наперед.

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
      className="rounded-control border border-border bg-surface px-4 py-3 font-sans text-sm font-bold leading-relaxed text-ink shadow-btn backdrop-blur-xl transition-colors enabled:hover:bg-border disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
    >
      {label}
    </button>
  );
}
