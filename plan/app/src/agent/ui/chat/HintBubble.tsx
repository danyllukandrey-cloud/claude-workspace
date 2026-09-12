// Дисмісибл-підказка над Composer, SCR-01 confirmed-hint (T47, AC-16/AC-16b).
// Статичний текст інтерфейсу ("Звертайся до Агента щоразу..."), НЕ репліка
// агента (AC-16 explicitly: "не є винятком із D-43") -- тому окремий
// компонент від MessageBubble, а не ще один запис у MessageList.
//
// Правило залежностей (plan/app/CLAUDE.md): чистий presentation-примітив,
// без domain/ports -- жодних імпортів поза React. Дисмісятиметься ЗВІДКИ
// (клік ✕ тут, чи фокус Composer) вирішує викликач (ChatScreen, AC-16b) --
// цей компонент лише рендерить сам собою і повідомляє про клік по ✕.

export interface HintBubbleProps {
  text: string;
  /** AC-16b: клік ✕ -- одна з двох причин, з яких підказка зникає (друга -- фокус Composer, вирішує викликач). */
  onDismiss: () => void;
}

export function HintBubble({ text, onDismiss }: HintBubbleProps): JSX.Element {
  return (
    <div role="note">
      <span>{text}</span>
      <button type="button" aria-label="Закрити підказку" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}
