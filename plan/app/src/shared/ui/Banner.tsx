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

// D-120 (оновлено): матовий тон, розбавлений семантичним кольором — не
// суцільна заливка (глянець лишається виключно за світлофором статусу
// виміру, `.chip-gloss`). "info" більше не фірмовий accent-колір — нейтральний
// ink-тон, той самий прийом (border/bg/10/text), просто без кольору.
const VARIANT_STYLES: Record<BannerVariant, string> = {
  success: 'border-good/25 bg-good/10 text-good',
  error: 'border-bad/25 bg-bad/10 text-bad',
  info: 'border-ink/25 bg-ink/10 text-ink',
};

export function Banner({ variant, text }: BannerProps): JSX.Element {
  // Системна підказка (курсив, за зразком CardFace.tsx "Опис ще не
  // заповнено"): info/success пояснюють контекст чи наслідок, не аварію --
  // error лишається прямим повідомленням про збій, курсив там недоречний.
  const isHint = variant !== 'error';
  return (
    <div
      data-variant={variant}
      className={`rounded-control border px-4 py-3 text-sm font-medium ${VARIANT_STYLES[variant]}${isHint ? ' italic' : ''}`}
    >
      {text}
    </div>
  );
}
