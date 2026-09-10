// Індикатор завантаження (T24).
//
// Навмисно спінер, не skeleton — так вирішено design-system.md (§Interaction &
// writing conventions, "Loading"): простіше зробити, відповідає обсягу MVP.

export function Spinner(): JSX.Element {
  return <div role="status">Завантаження…</div>;
}
