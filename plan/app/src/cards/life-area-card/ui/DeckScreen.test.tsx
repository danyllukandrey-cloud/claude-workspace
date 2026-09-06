import { render, screen, fireEvent } from '@testing-library/react';
import { DeckScreen } from './DeckScreen';

// AC-04 (T25 DoD, п.1): усі 4 стани зі screens.md SCR-01 (default / empty /
// loading / error) рендеряться за відповідним триггером -- не лише
// монтуванням з готовими пропами. Дані приходять через ін'єктовану
// loadCards() (ISS-45, DI), тому кожен стан тут триггериться реальним
// проходженням Promise: pending -> "loading", resolve([...]) -> "default",
// resolve([]) -> "empty", reject(...) -> "error".

test('loading: показує Spinner одразу після монтування, поки loadCards ще не резолвнувся', () => {
  // Promise навмисно ніколи не резолвиться в цьому тесті -- перевіряємо лише
  // стан "loading" одразу після початкового GET /cards (screens.md SCR-01).
  const pending = new Promise<never>(() => {});
  const loadCards = vi.fn().mockReturnValue(pending);

  render(<DeckScreen loadCards={loadCards} onOpenCard={vi.fn()} />);

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

  render(<DeckScreen loadCards={loadCards} onOpenCard={onOpenCard} />);

  const tile = await screen.findByText('Спорт');
  expect(screen.getByText('Навчання')).toBeTruthy();

  fireEvent.click(tile);

  expect(onOpenCard).toHaveBeenCalledWith('card-1');
});

test('empty: після резолву loadCards із порожнім масивом рендерить EmptyState', async () => {
  const loadCards = vi.fn().mockResolvedValue([]);

  render(<DeckScreen loadCards={loadCards} onOpenCard={vi.fn()} />);

  expect(await screen.findByText('Тут ще немає жодної картки')).toBeTruthy();
});

test('error: після реджекту loadCards рендерить Banner із текстом помилки', async () => {
  const loadCards = vi.fn().mockRejectedValue(new Error('Мережа недоступна'));

  render(<DeckScreen loadCards={loadCards} onOpenCard={vi.fn()} />);

  expect(await screen.findByText('Мережа недоступна')).toBeTruthy();
});

test('error: реджект без Error-повідомлення падає назад на дефолтний текст', async () => {
  const loadCards = vi.fn().mockRejectedValue('щось пішло не так');

  render(<DeckScreen loadCards={loadCards} onOpenCard={vi.fn()} />);

  expect(await screen.findByText('Не вдалося завантажити колоду карток')).toBeTruthy();
});
