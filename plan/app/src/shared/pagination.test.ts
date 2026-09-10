// RED (review 2026-09-07 C15, AC-09, T48): loadBack (main.tsx) обчислював
// прогрес кожного блоку-метрики лише з ПЕРШОЇ сторінки GET .../entries
// (сервер обмежує відповідь дефолтним лімітом 50, entry-handlers.ts) --
// картка з понад 50 записами по картці мовчки недорахувала прогрес блоків,
// що йшли за межею сторінки. collectAllPages -- чиста функція (жодного
// fetch/global всередині, лише ін'єктований fetchPage), тому тестується
// напряму без jsdom/мережі; main.tsx підставить реальний fetch-виклик як
// fetchPage.
import { collectAllPages } from './pagination';
import type { Page } from './pagination';

function page<T>(items: T[], next_cursor: string | null): Page<T> {
  return { items, next_cursor };
}

test('одна сторінка (next_cursor: null) -- повертає лише її items, викликає fetchPage один раз', async () => {
  const fetchPage = vi.fn().mockResolvedValue(page([1, 2, 3], null));

  const result = await collectAllPages(fetchPage);

  expect(result).toEqual([1, 2, 3]);
  expect(fetchPage).toHaveBeenCalledTimes(1);
  expect(fetchPage).toHaveBeenCalledWith(undefined);
});

test('декілька сторінок -- слідує за next_cursor, поки сервер не поверне null, зливає всі items по порядку', async () => {
  const fetchPage = vi
    .fn()
    .mockResolvedValueOnce(page(['a', 'b'], 'cursor-1'))
    .mockResolvedValueOnce(page(['c', 'd'], 'cursor-2'))
    .mockResolvedValueOnce(page(['e'], null));

  const result = await collectAllPages(fetchPage);

  expect(result).toEqual(['a', 'b', 'c', 'd', 'e']);
  expect(fetchPage).toHaveBeenCalledTimes(3);
  expect(fetchPage).toHaveBeenNthCalledWith(1, undefined);
  expect(fetchPage).toHaveBeenNthCalledWith(2, 'cursor-1');
  expect(fetchPage).toHaveBeenNthCalledWith(3, 'cursor-2');
});

test('порожня перша сторінка (картка без жодного запису) -- повертає порожній масив, не зависає', async () => {
  const fetchPage = vi.fn().mockResolvedValue(page([], null));

  const result = await collectAllPages(fetchPage);

  expect(result).toEqual([]);
  expect(fetchPage).toHaveBeenCalledTimes(1);
});

// Review 2026-09-07, post-ship follow-up review (E remainder, RED): якщо
// сервер повертає ТОЙ САМИЙ next_cursor двічі поспіль (напр. запис-курсор
// вибув зі списку між двома викликами -- entry-handlers.ts "Прострочений/
// невалідний cursor -- падаємо на першу сторінку, не помилка"), for(;;) тут
// ніколи не завершувався б -- та сама сторінка знову й знову.

test('той самий next_cursor повторюється -- зупиняється замість нескінченного циклу', async () => {
  const fetchPage = vi
    .fn()
    .mockResolvedValueOnce(page(['a'], 'cursor-1'))
    .mockResolvedValue(page(['a'], 'cursor-1')); // сервер "застряг" на тому самому курсорі

  const result = await collectAllPages(fetchPage);

  expect(result).toEqual(['a', 'a']); // одна фактична повторна спроба, потім зупинка -- не зависання
  expect(fetchPage.mock.calls.length).toBeLessThan(10);
});

test('аварійний захист: навіть без повторення курсора зупиняється після розумної межі сторінок', async () => {
  let call = 0;
  const fetchPage = vi.fn().mockImplementation(async () => {
    call += 1;
    return page([call], `cursor-${call}`); // next_cursor щоразу НОВИЙ -- ніколи не null
  });

  const result = await collectAllPages(fetchPage);

  expect(fetchPage.mock.calls.length).toBeLessThan(10_000);
  expect(result.length).toBe(fetchPage.mock.calls.length);
});
