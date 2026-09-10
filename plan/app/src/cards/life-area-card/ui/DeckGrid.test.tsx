import { render, screen, fireEvent } from '@testing-library/react';
import { DeckGrid } from './DeckGrid';

test('DeckGrid рендерить тайл для кожної картки й викликає onOpen з її id при кліку', () => {
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
