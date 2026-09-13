// Індикатор завантаження (T24).
//
// Навмисно спінер, не skeleton — так вирішено design-system.md (§Interaction &
// writing conventions, "Loading"): простіше зробити, відповідає обсягу MVP.

export function Spinner(): JSX.Element {
  return (
    <div role="status" className="flex items-center gap-2 text-sm font-medium text-ink-muted">
      <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-accent-soft border-t-accent" />
      Завантаження…
    </div>
  );
}
