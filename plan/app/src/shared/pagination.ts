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

// Review 2026-09-07, post-ship follow-up review (E remainder): без обмеження
// сервер, що "застряг" на тому самому cursor (напр. запис-курсор вибув зі
// списку між двома запитами -- entry-handlers.ts: "Прострочений/невалідний
// cursor -- падаємо на першу сторінку, не помилка") чи просто ніколи не
// повертає next_cursor: null, спричиняв справжній нескінченний цикл --
// підтверджено живим прогоном: процес упав з "JavaScript heap out of
// memory", не просто "тест довго висів". MAX_PAGES -- останній рубіж, коли
// навіть повторення курсора не спрацювало (кожен курсор новий, але їх
// нескінченно багато).
const MAX_PAGES = 1000;

export async function collectAllPages<T>(fetchPage: (after: string | undefined) => Promise<Page<T>>): Promise<T[]> {
  const all: T[] = [];
  let after: string | undefined;

  for (let pageCount = 0; pageCount < MAX_PAGES; pageCount += 1) {
    const page = await fetchPage(after);
    all.push(...page.items);
    if (!page.next_cursor || page.next_cursor === after) break;
    after = page.next_cursor;
  }

  return all;
}
