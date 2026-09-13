// Порожній стан (T24).
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
    <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-ink">{message}</p>
      <p className="text-sm text-ink-muted">{actionHint}</p>
    </div>
  );
}
