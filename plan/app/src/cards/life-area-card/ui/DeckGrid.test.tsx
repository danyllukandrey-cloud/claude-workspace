import { render, screen, fireEvent } from '@testing-library/react';
import { DeckGrid } from './DeckGrid';

test('DeckGrid рендерить тайл для кожної картки й викликає onOpen з її id при кліку на передню картку', () => {
  const items = [
    { id: 'card-1', name: 'Спорт' },
    { id: 'card-2', name: 'Навчання' },
  ];
  const onOpen = vi.fn();

  render(<DeckGrid items={items} onOpen={onOpen} />);

  expect(screen.getByText('Спорт')).toBeTruthy();
  expect(screen.getByText('Навчання')).toBeTruthy();

  fireEvent.click(screen.getByText('Спорт'));

  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onOpen).toHaveBeenCalledWith('card-1');
});

// Генералізація (ISS-46): T36 перевикористає цей самий DeckGrid для архіву,
// лише передавши інші items/onOpen -- сам компонент не знає про статус картки.
test('DeckGrid не рендерить жодного тайла для порожнього items', () => {
  const onOpen = vi.fn();

  render(<DeckGrid items={[]} onOpen={onOpen} />);

  expect(screen.queryByRole('button')).toBeNull();
});

// Стос зі свайпом (Андрій, скетч "як банківські картки перелистуються") --
// клік по картці, що ВИЗИРАЄ позаду передньої, переносить її наперед, а НЕ
// відкриває картку -- це окремий жест від відкриття.
test('клік по картці позаду передньої переносить її наперед і НЕ викликає onOpen', () => {
  const items = [
    { id: 'card-1', name: 'Спорт' },
    { id: 'card-2', name: 'Навчання' },
    { id: 'card-3', name: "Здоров'я" },
  ];
  const onOpen = vi.fn();

  render(<DeckGrid items={items} onOpen={onOpen} />);

  fireEvent.click(screen.getByText('Навчання'));

  expect(onOpen).not.toHaveBeenCalled();

  // "Навчання" тепер передня -- клік по ній відкриває картку.
  fireEvent.click(screen.getByText('Навчання'));
  expect(onOpen).toHaveBeenCalledWith('card-2');
});

test('кнопки ‹/› перегортають колоду по колу без виклику onOpen', () => {
  const items = [
    { id: 'card-1', name: 'Спорт' },
    { id: 'card-2', name: 'Навчання' },
  ];
  const onOpen = vi.fn();

  render(<DeckGrid items={items} onOpen={onOpen} />);

  fireEvent.click(screen.getByRole('button', { name: 'Наступна картка' }));
  // "Навчання" тепер передня.
  fireEvent.click(screen.getByText('Навчання'));
  expect(onOpen).toHaveBeenCalledWith('card-2');

  fireEvent.click(screen.getByRole('button', { name: 'Попередня картка' }));
  fireEvent.click(screen.getByRole('button', { name: 'Попередня картка' }));
  // Два кроки назад від "Навчання" (index 1) по колу з 2 карток -- знову "Навчання".
  fireEvent.click(screen.getByText('Навчання'));
  expect(onOpen).toHaveBeenCalledWith('card-2');

  expect(onOpen).toHaveBeenCalledTimes(2);
});

test('кнопки перегортання не рендеряться, коли картка лише одна', () => {
  const items = [{ id: 'card-1', name: 'Спорт' }];

  render(<DeckGrid items={items} onOpen={vi.fn()} />);

  expect(screen.queryByRole('button', { name: 'Наступна картка' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Попередня картка' })).toBeNull();
});
