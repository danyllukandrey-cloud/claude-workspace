import { render, screen, fireEvent } from '@testing-library/react';
import { DeckScreen } from './DeckScreen';

// AC-04 (T25 DoD, п.1): усі 4 стани зі screens.md SCR-01 (default / empty /
// loading / error) рендеряться за відповідним триггером -- не лише
// монтуванням з готовими пропами. Дані приходять через ін'єктовану
// loadCards() (ISS-45, DI), тому кожен стан тут триггериться реальним
// проходженням Promise: pending -> "loading", resolve([...]) -> "default",
// resolve([]) -> "empty", reject(...) -> "error".
//
// ISS-55 (RED, stage 1/3): новий проп onCreateCard -- кнопка "+ Створити
// картку" має бути видима і в "default" (поряд з DeckGrid), і в "empty"
// (поряд з EmptyState) -- DeckScreen сама її рендерить, обгортаючи внутрішній
// стан, а не змінює контракти EmptyState/DeckGrid (ISS-55 явно каже: ці два
// компоненти лишаються текст-only/тайл-only за задумом).

// ISS-55 stage 3/3: DeckScreen отримує ще один required проп -- onOpenArchive
// (той самий стиль DI, що onCreateCard, ISS-55 stage 1). Усі наявні тести
// нижче оновлені додаванням onOpenArchive={vi.fn()} до render(), той самий
// підхід, що застосували stage 1 для onCreateCard.

test('loading: показує Spinner одразу після монтування, поки loadCards ще не резолвнувся', () => {
  // Promise навмисно ніколи не резолвиться в цьому тесті -- перевіряємо лише
  // стан "loading" одразу після початкового GET /cards (screens.md SCR-01).
  const pending = new Promise<never>(() => {});
  const loadCards = vi.fn().mockReturnValue(pending);

  render(<DeckScreen loadCards={loadCards} onOpenCard={vi.fn()} onCreateCard={vi.fn()} onOpenArchive={vi.fn()} />);

  expect(screen.getByRole('status')).toBeTruthy();
  expect(loadCards).toHaveBeenCalledTimes(1);
});

test('default: після резолву loadCards із картками рендерить DeckGrid і відкриває картку по кліку', async () => {
  const items = [
    { id: 'card-1', name: 'Спорт' },
    { id: 'card-2', name: 'Навчання' },
  ];
  const loadCards = vi.fn().mockResolvedValue(items);
  const onOpenCard = vi.fn();

  render(
    <DeckScreen loadCards={loadCards} onOpenCard={onOpenCard} onCreateCard={vi.fn()} onOpenArchive={vi.fn()} />,
  );

  const tile = await screen.findByText('Спорт');
  expect(screen.getByText('Навчання')).toBeTruthy();

  fireEvent.click(tile);

  expect(onOpenCard).toHaveBeenCalledWith('card-1');
});

test('empty: після резолву loadCards із порожнім масивом рендерить EmptyState', async () => {
  const loadCards = vi.fn().mockResolvedValue([]);

  render(<DeckScreen loadCards={loadCards} onOpenCard={vi.fn()} onCreateCard={vi.fn()} onOpenArchive={vi.fn()} />);

  expect(await screen.findByText('Тут ще немає жодної картки')).toBeTruthy();
});

test('error: після реджекту loadCards рендерить Banner із текстом помилки', async () => {
  const loadCards = vi.fn().mockRejectedValue(new Error('Мережа недоступна'));

  render(<DeckScreen loadCards={loadCards} onOpenCard={vi.fn()} onCreateCard={vi.fn()} onOpenArchive={vi.fn()} />);

  expect(await screen.findByText('Мережа недоступна')).toBeTruthy();
});

test('error: реджект без Error-повідомлення падає назад на дефолтний текст', async () => {
  const loadCards = vi.fn().mockRejectedValue('щось пішло не так');

  render(<DeckScreen loadCards={loadCards} onOpenCard={vi.fn()} onCreateCard={vi.fn()} onOpenArchive={vi.fn()} />);

  expect(await screen.findByText('Не вдалося завантажити колоду карток')).toBeTruthy();
});

test('ISS-55: empty-стан показує кнопку "+ Створити картку", клік викликає onCreateCard', async () => {
  const loadCards = vi.fn().mockResolvedValue([]);
  const onCreateCard = vi.fn();

  render(
    <DeckScreen loadCards={loadCards} onOpenCard={vi.fn()} onCreateCard={onCreateCard} onOpenArchive={vi.fn()} />,
  );

  await screen.findByText('Тут ще немає жодної картки');
  const button = screen.getByRole('button', { name: '+ Створити картку' });

  fireEvent.click(button);

  expect(onCreateCard).toHaveBeenCalledTimes(1);
});

test('ISS-55: default-стан (DeckGrid з картками) показує кнопку "+ Створити картку" поряд з тайлами', async () => {
  const items = [{ id: 'card-1', name: 'Спорт' }];
  const loadCards = vi.fn().mockResolvedValue(items);
  const onCreateCard = vi.fn();

  render(
    <DeckScreen loadCards={loadCards} onOpenCard={vi.fn()} onCreateCard={onCreateCard} onOpenArchive={vi.fn()} />,
  );

  await screen.findByText('Спорт');
  const button = screen.getByRole('button', { name: '+ Створити картку' });

  fireEvent.click(button);

  expect(onCreateCard).toHaveBeenCalledTimes(1);
});

// ISS-55 stage 3/3 (RED): нова кнопка "Архів" -- в ОБОХ станах (empty і
// default), той самий патерн розміщення, що onCreateCard (stage 1).

test('ISS-55 stage 3: empty-стан показує кнопку "Архів", клік викликає onOpenArchive', async () => {
  const loadCards = vi.fn().mockResolvedValue([]);
  const onOpenArchive = vi.fn();

  render(
    <DeckScreen loadCards={loadCards} onOpenCard={vi.fn()} onCreateCard={vi.fn()} onOpenArchive={onOpenArchive} />,
  );

  await screen.findByText('Тут ще немає жодної картки');
  const button = screen.getByRole('button', { name: 'Архів' });

  fireEvent.click(button);

  expect(onOpenArchive).toHaveBeenCalledTimes(1);
});

test('ISS-55 stage 3: default-стан (DeckGrid з картками) показує кнопку "Архів" поряд з тайлами', async () => {
  const items = [{ id: 'card-1', name: 'Спорт' }];
  const loadCards = vi.fn().mockResolvedValue(items);
  const onOpenArchive = vi.fn();

  render(
    <DeckScreen loadCards={loadCards} onOpenCard={vi.fn()} onCreateCard={vi.fn()} onOpenArchive={onOpenArchive} />,
  );

  await screen.findByText('Спорт');
  const button = screen.getByRole('button', { name: 'Архів' });

  fireEvent.click(button);

  expect(onOpenArchive).toHaveBeenCalledTimes(1);
});
