import { fireEvent, render, screen } from '@testing-library/react';
import { ArchiveScreen } from './ArchiveScreen';

// screens.md SCR-07: усі перелічені стани (default / empty / card-view)
// мусять бути покриті тестом-тригером, не лише монтуванням. Дані приходять
// через ін'єктовану loadArchivedCards()/loadArchivedCardHistory() (ISS-45,
// DI), тому кожен стан тут триггериться реальним проходженням Promise.
//
// AC-18 should-fix: card-view мусить показувати "історію записів видима" --
// loadArchivedCardHistory за замовчуванням резолвиться порожнім масивом у
// тестах, де сама історія не є предметом перевірки.

test('loading: показує Spinner одразу після монтування, поки loadArchivedCards ще не резолвнувся', () => {
  const pending = new Promise<never>(() => {});
  const loadArchivedCards = vi.fn().mockReturnValue(pending);

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={vi.fn()}
      loadArchivedCardHistory={vi.fn().mockResolvedValue([])}
    />,
  );

  expect(screen.getByRole('status')).toBeTruthy();
  expect(loadArchivedCards).toHaveBeenCalledTimes(1);
});

test('default: після резолву loadArchivedCards із картками рендерить сітку (CH-09, усі картки видно одразу)', async () => {
  const items = [
    { id: 'card-1', name: 'Читання' },
    { id: 'card-2', name: 'Медитація' },
  ];
  const loadArchivedCards = vi.fn().mockResolvedValue(items);

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={vi.fn()}
      loadArchivedCardHistory={vi.fn().mockResolvedValue([])}
    />,
  );

  expect(await screen.findByText('Читання')).toBeTruthy();
  expect(screen.getByText('Медитація')).toBeTruthy();
});

// ISS-57: без постійного заголовка "Архів карток" (wireframe screens.md
// SCR-07) немає жодної ознаки, що це саме архів, не активна Колода --
// live-тестування Андрія це підтвердило. Заголовок має лишатись видимим і
// в списку, і всередині card-view (не лише на самому верхньому рівні).
test('ISS-57: заголовок "Архів карток" видимий у списку архіву', async () => {
  const loadArchivedCards = vi.fn().mockResolvedValue([{ id: 'card-1', name: 'Читання' }]);

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={vi.fn()}
      loadArchivedCardHistory={vi.fn().mockResolvedValue([])}
    />,
  );

  expect(await screen.findByRole('heading', { name: 'Архів карток' })).toBeTruthy();
});

test('ISS-57: заголовок "Архів карток" лишається видимим і в card-view', async () => {
  const loadArchivedCards = vi.fn().mockResolvedValue([{ id: 'card-1', name: 'Читання' }]);

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={vi.fn()}
      loadArchivedCardHistory={vi.fn().mockResolvedValue([])}
    />,
  );

  fireEvent.click(await screen.findByText('Читання'));

  expect(await screen.findByRole('heading', { name: 'Архів карток' })).toBeTruthy();
});

test('empty: після резолву loadArchivedCards із порожнім масивом рендерить EmptyState', async () => {
  const loadArchivedCards = vi.fn().mockResolvedValue([]);

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={vi.fn()}
      loadArchivedCardHistory={vi.fn().mockResolvedValue([])}
    />,
  );

  expect(await screen.findByText('Архів порожній')).toBeTruthy();
});

test('error: після реджекту loadArchivedCards рендерить Banner із текстом помилки', async () => {
  const loadArchivedCards = vi.fn().mockRejectedValue(new Error('Мережа недоступна'));

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={vi.fn()}
      loadArchivedCardHistory={vi.fn().mockResolvedValue([])}
    />,
  );

  expect(await screen.findByText('Мережа недоступна')).toBeTruthy();
});

test('card-view: клік на тайл архіву відкриває картку з кнопкою "Розархівувати" (AC-17), новий запис недоступний', async () => {
  const items = [{ id: 'card-1', name: 'Читання' }];
  const loadArchivedCards = vi.fn().mockResolvedValue(items);

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={vi.fn()}
      loadArchivedCardHistory={vi.fn().mockResolvedValue([])}
    />,
  );

  const tile = await screen.findByText('Читання');
  fireEvent.click(tile);

  expect(screen.getByRole('heading', { name: 'Читання' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Розархівувати' })).toBeTruthy();
  expect(screen.getByText(/новий запис недоступний/)).toBeTruthy();
  // Дочекатись резолву loadArchivedCardHistory -- інакше проміс лишається "у
  // польоті" й наступний setState стається поза act() уже в наступному тесті.
  expect(await screen.findByText('Історія записів')).toBeTruthy();
});

// Review 2026-09-07 E (RED, T52): "з картки в архіві немає повернення до
// списку архіву" -- card-view раніше не мав жодного способу повернутись,
// окрім кнопки "Розархівувати" (яка змінює саму картку, а не просто
// закриває перегляд). Той самий текст кнопки, що App.tsx уже використовує
// для інших "назад" (CardDetailScreen, ArchiveScreen-обгортка в App.tsx).

test('card-view: кнопка "← Назад" повертає до списку архіву (без повторного GET), картки лишаються тими самими', async () => {
  const items = [
    { id: 'card-1', name: 'Читання' },
    { id: 'card-2', name: 'Біг' },
  ];
  const loadArchivedCards = vi.fn().mockResolvedValue(items);

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={vi.fn()}
      loadArchivedCardHistory={vi.fn().mockResolvedValue([])}
    />,
  );

  fireEvent.click(await screen.findByText('Читання'));
  await screen.findByRole('heading', { name: 'Читання' });

  fireEvent.click(screen.getByRole('button', { name: '← Назад' }));

  expect(await screen.findByText('Біг')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Читання' })).toBeNull();
  expect(loadArchivedCards).toHaveBeenCalledTimes(1); // не перезавантажило список
});

test('card-view: показує історію записів (AC-18) після резолву loadArchivedCardHistory', async () => {
  const items = [{ id: 'card-1', name: 'Читання' }];
  const loadArchivedCards = vi.fn().mockResolvedValue(items);
  const entries = [
    { id: 'e1', metricBlockId: 'm1', amount: 1, status: 'confirmed' as const, recordedAtLabel: '27.08', summary: '+1 сторінка' },
  ];
  const loadArchivedCardHistory = vi.fn().mockResolvedValue(entries);

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={vi.fn()}
      loadArchivedCardHistory={loadArchivedCardHistory}
    />,
  );

  fireEvent.click(await screen.findByText('Читання'));

  expect(loadArchivedCardHistory).toHaveBeenCalledWith('card-1');
  expect(await screen.findByText('Історія записів')).toBeTruthy();
  expect(screen.getByText('+1 сторінка')).toBeTruthy();
  // Read-only -- на відміну від EntryHistoryList (T26), тут немає "виправити".
  expect(screen.queryByRole('button', { name: 'виправити' })).toBeNull();
});

test('card-view: помилка loadArchivedCardHistory показує Banner, не ламає решту card-view', async () => {
  const items = [{ id: 'card-1', name: 'Читання' }];
  const loadArchivedCards = vi.fn().mockResolvedValue(items);
  const loadArchivedCardHistory = vi.fn().mockRejectedValue(new Error('Історія недоступна'));

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={vi.fn()}
      loadArchivedCardHistory={loadArchivedCardHistory}
    />,
  );

  fireEvent.click(await screen.findByText('Читання'));

  expect(await screen.findByText('Історія недоступна')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Розархівувати' })).toBeTruthy();
});

test('card-view -> "Розархівувати" викликає onRestoreCard, після успіху картка зникає зі списку архіву (AC-17/AC-18)', async () => {
  const items = [
    { id: 'card-1', name: 'Читання' },
    { id: 'card-2', name: 'Медитація' },
  ];
  const loadArchivedCards = vi.fn().mockResolvedValue(items);
  const onRestoreCard = vi.fn().mockResolvedValue(undefined);

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={onRestoreCard}
      loadArchivedCardHistory={vi.fn().mockResolvedValue([])}
    />,
  );

  fireEvent.click(await screen.findByText('Читання'));
  fireEvent.click(screen.getByRole('button', { name: 'Розархівувати' }));

  expect(onRestoreCard).toHaveBeenCalledWith('card-1');

  // Назад у список (default), розархівованої картки в архіві вже нема, друга лишається.
  expect(await screen.findByText('Медитація')).toBeTruthy();
  expect(screen.queryByText('Читання')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Розархівувати' })).toBeNull();
});

test('card-view -> "Розархівувати" блокується (disabled) на час виконання, щоб подвійний клік не викликав дію двічі', async () => {
  const items = [{ id: 'card-1', name: 'Читання' }];
  const loadArchivedCards = vi.fn().mockResolvedValue(items);
  let resolveRestore: (() => void) | undefined;
  const onRestoreCard = vi.fn().mockReturnValue(
    new Promise<void>((resolve) => {
      resolveRestore = resolve;
    }),
  );

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={onRestoreCard}
      loadArchivedCardHistory={vi.fn().mockResolvedValue([])}
    />,
  );

  fireEvent.click(await screen.findByText('Читання'));
  const button = screen.getByRole('button', { name: 'Розархівувати' }) as HTMLButtonElement;

  fireEvent.click(button);
  expect(button.disabled).toBe(true);

  fireEvent.click(button);
  expect(onRestoreCard).toHaveBeenCalledTimes(1);

  resolveRestore?.();
  expect(await screen.findByText('Архів порожній')).toBeTruthy();
});

test('card-view -> "Розархівувати" при помилці лишається в card-view з Banner, картка НЕ зникає', async () => {
  const items = [{ id: 'card-1', name: 'Читання' }];
  const loadArchivedCards = vi.fn().mockResolvedValue(items);
  const onRestoreCard = vi.fn().mockRejectedValue(new Error('Картку не знайдено'));

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={onRestoreCard}
      loadArchivedCardHistory={vi.fn().mockResolvedValue([])}
    />,
  );

  fireEvent.click(await screen.findByText('Читання'));
  fireEvent.click(screen.getByRole('button', { name: 'Розархівувати' }));

  expect(await screen.findByText('Картку не знайдено')).toBeTruthy();
  // Досі в card-view -- заголовок і кнопка лишаються на екрані, знову доступна.
  expect(screen.getByRole('heading', { name: 'Читання' })).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Розархівувати' }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
});

// CH-16 (docs/features/life-area-card/changes.md): "Видалити" в Архіві
// карток -- назавжди, з підтвердженням через ввід слова "видалити" (той
// самий ConfirmDialog-патерн, що видалення блоку-метрики/акаунту).

test('CH-16: без injected onDeleteCardPermanently кнопка "Видалити" не рендериться взагалі', async () => {
  const loadArchivedCards = vi.fn().mockResolvedValue([{ id: 'card-1', name: 'Читання' }]);

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={vi.fn()}
      loadArchivedCardHistory={vi.fn().mockResolvedValue([])}
    />,
  );

  await screen.findByText('Читання');
  expect(screen.queryByRole('button', { name: /Видалити назавжди/ })).toBeNull();
});

test('CH-16: клік на "Видалити" в списку архіву НЕ відкриває картку (stopPropagation) -- показує підтвердження', async () => {
  const loadArchivedCards = vi.fn().mockResolvedValue([{ id: 'card-1', name: 'Читання' }]);

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={vi.fn()}
      onDeleteCardPermanently={vi.fn()}
      loadArchivedCardHistory={vi.fn().mockResolvedValue([])}
    />,
  );

  await screen.findByText('Читання');
  fireEvent.click(screen.getByRole('button', { name: 'Видалити назавжди картку «Читання»' }));

  expect(screen.queryByRole('heading', { name: 'Читання' })).toBeNull(); // не перейшло в card-view
  expect(screen.getByText(/Видалити назавжди картку «Читання»\?/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Видалити назавжди' })).toBeTruthy();
});

test('CH-16: кнопка підтвердження вимкнена, поки не введено точне слово «видалити»', async () => {
  const loadArchivedCards = vi.fn().mockResolvedValue([{ id: 'card-1', name: 'Читання' }]);

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={vi.fn()}
      onDeleteCardPermanently={vi.fn()}
      loadArchivedCardHistory={vi.fn().mockResolvedValue([])}
    />,
  );

  await screen.findByText('Читання');
  fireEvent.click(screen.getByRole('button', { name: 'Видалити назавжди картку «Читання»' }));

  const confirmButton = screen.getByRole('button', { name: 'Видалити назавжди' }) as HTMLButtonElement;
  expect(confirmButton.disabled).toBe(true);

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'видалити' } });
  expect(confirmButton.disabled).toBe(false);
});

test('CH-16: підтвердження викликає onDeleteCardPermanently(cardId), картка зникає зі списку', async () => {
  const items = [
    { id: 'card-1', name: 'Читання' },
    { id: 'card-2', name: 'Медитація' },
  ];
  const loadArchivedCards = vi.fn().mockResolvedValue(items);
  const onDeleteCardPermanently = vi.fn().mockResolvedValue(undefined);

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={vi.fn()}
      onDeleteCardPermanently={onDeleteCardPermanently}
      loadArchivedCardHistory={vi.fn().mockResolvedValue([])}
    />,
  );

  await screen.findByText('Читання');
  fireEvent.click(screen.getByRole('button', { name: 'Видалити назавжди картку «Читання»' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'видалити' } });
  fireEvent.click(screen.getByRole('button', { name: 'Видалити назавжди' }));

  expect(onDeleteCardPermanently).toHaveBeenCalledWith('card-1');
  await screen.findByText('Медитація');
  expect(screen.queryByText('Читання')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Видалити назавжди' })).toBeNull(); // діалог закрився
});

test('CH-16: клік "Скасувати" закриває підтвердження без виклику onDeleteCardPermanently, картка лишається', async () => {
  const loadArchivedCards = vi.fn().mockResolvedValue([{ id: 'card-1', name: 'Читання' }]);
  const onDeleteCardPermanently = vi.fn();

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={vi.fn()}
      onDeleteCardPermanently={onDeleteCardPermanently}
      loadArchivedCardHistory={vi.fn().mockResolvedValue([])}
    />,
  );

  await screen.findByText('Читання');
  fireEvent.click(screen.getByRole('button', { name: 'Видалити назавжди картку «Читання»' }));
  fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));

  expect(onDeleteCardPermanently).not.toHaveBeenCalled();
  expect(screen.getByText('Читання')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Видалити назавжди' })).toBeNull();
});

test('CH-16: провал onDeleteCardPermanently показує Banner з помилкою, картка НЕ зникає', async () => {
  const loadArchivedCards = vi.fn().mockResolvedValue([{ id: 'card-1', name: 'Читання' }]);
  const onDeleteCardPermanently = vi.fn().mockRejectedValue(new Error('Не вдалося видалити'));

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={vi.fn()}
      onDeleteCardPermanently={onDeleteCardPermanently}
      loadArchivedCardHistory={vi.fn().mockResolvedValue([])}
    />,
  );

  await screen.findByText('Читання');
  fireEvent.click(screen.getByRole('button', { name: 'Видалити назавжди картку «Читання»' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'видалити' } });
  fireEvent.click(screen.getByRole('button', { name: 'Видалити назавжди' }));

  expect(await screen.findByText('Не вдалося видалити')).toBeTruthy();
  expect(screen.getByText('Читання')).toBeTruthy();
});

test('card-view -> реджект без Error-повідомлення падає назад на дефолтний текст', async () => {
  const items = [{ id: 'card-1', name: 'Читання' }];
  const loadArchivedCards = vi.fn().mockResolvedValue(items);
  const onRestoreCard = vi.fn().mockRejectedValue('network down');

  render(
    <ArchiveScreen
      loadArchivedCards={loadArchivedCards}
      onRestoreCard={onRestoreCard}
      loadArchivedCardHistory={vi.fn().mockResolvedValue([])}
    />,
  );

  fireEvent.click(await screen.findByText('Читання'));
  fireEvent.click(screen.getByRole('button', { name: 'Розархівувати' }));

  expect(await screen.findByText('Не вдалося розархівувати картку')).toBeTruthy();
});
