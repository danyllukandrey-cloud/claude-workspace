// ЗАГОТОВКА (T24). Інлайн-повідомлення (успіх / помилка / офлайн).
//
// Ніколи alert/confirm — вони блокують інтерфейс (plan/app/CLAUDE.md
// §Конвенції, design-system.md §Interaction & writing conventions, "Errors").

export type BannerVariant = 'success' | 'error' | 'info';

export interface BannerProps {
  /** Який тип повідомлення показати — визначає стиль/атрибут для розпізнавання в тесті. */
  variant: BannerVariant;
  /** Текст повідомлення. */
  text: string;
}

export function Banner({ variant, text }: BannerProps): JSX.Element {
  return <div data-variant={variant}>{text}</div>;
}
