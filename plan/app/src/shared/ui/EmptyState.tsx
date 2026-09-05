// ЗАГОТОВКА (T24). Порожній стан.
//
// Простий текст — що тут порожньо і яка наступна дія, без ілюстрацій
// (design-system.md §Interaction & writing conventions, "Empty states").

export interface EmptyStateProps {
  /** Що тут порожньо. */
  message: string;
  /** Яка наступна дія доступна користувачу. */
  actionHint: string;
}

export function EmptyState({ message, actionHint }: EmptyStateProps): JSX.Element {
  return (
    <div>
      <p>{message}</p>
      <p>{actionHint}</p>
    </div>
  );
}
