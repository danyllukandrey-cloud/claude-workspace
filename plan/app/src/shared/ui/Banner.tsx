// Інлайн-повідомлення (успіх / помилка / офлайн) (T24).
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

// D-120: матовий тон, розбавлений семантичним кольором — не суцільна заливка
// (глянець лишається виключно за світлофором статусу виміру, `.chip-gloss`).
const VARIANT_STYLES: Record<BannerVariant, string> = {
  success: 'border-good/25 bg-good/10 text-good',
  error: 'border-bad/25 bg-bad/10 text-bad',
  info: 'border-accent/25 bg-accent/10 text-accent',
};

export function Banner({ variant, text }: BannerProps): JSX.Element {
  return (
    <div
      data-variant={variant}
      className={`rounded-control border px-4 py-3 text-sm font-medium ${VARIANT_STYLES[variant]}`}
    >
      {text}
    </div>
  );
}
