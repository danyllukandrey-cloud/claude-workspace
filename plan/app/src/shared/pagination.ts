// Review 2026-09-07 C15 (AC-09, T48): чиста функція без побічних ефектів
// (жодного fetch/global тут) -- слідує за курсором сторінки, поки джерело не
// поверне next_cursor: null, і зливає всі items в один масив по порядку.
//
// Навіщо окремий файл, не інлайн у main.tsx: main.tsx -- composition root із
// побічним ефектом на рівні модуля (createRoot(...).render(...)), тож
// імпортувати його напряму в тест не можна (той самий вибір, що виніс App.tsx
// з main.tsx -- App.test.tsx, коментар "Окремий експортований компонент").
// Ця функція чиста -- тестується напряму, а main.tsx лише підставляє реальний
// fetch як `fetchPage`.

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export async function collectAllPages<T>(fetchPage: (after: string | undefined) => Promise<Page<T>>): Promise<T[]> {
  const all: T[] = [];
  let after: string | undefined;

  for (;;) {
    const page = await fetchPage(after);
    all.push(...page.items);
    if (!page.next_cursor) break;
    after = page.next_cursor;
  }

  return all;
}
