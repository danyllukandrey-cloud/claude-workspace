import { render, screen, fireEvent } from '@testing-library/react';
import { DeckGrid } from './DeckGrid';

// D-121 (живе тестування): renderFront замінює колишній onOpen -- DeckGrid
// сам не знає, що показати для передньої картки (ISS-46, узагальненість),
// тому тести рендерять просту кнопку через renderFront, той самий підхід,
// що ArchiveScreen.tsx реально використовує (DeckScreen.tsx передає
// DeckFrontCard, окремо протестований у DeckFrontCard.test.tsx).
function nameButtonRenderFront(onOpen: (id: string) => void) {
  return (item: { id: string; name: string }) => (
    <button type="button" onClick={() => onOpen(item.id)}>
      {item.name}
    </button>
  );
}

test('DeckGrid рендерить renderFront для передньої картки й підпис-тайл для задніх', () => {
  const items = [
    { id: 'card-1', name: 'Спорт' },
    { id: 'card-2', name: 'Навчання' },
  ];
  const onOpen = vi.fn();

  render(<DeckGrid items={items} renderFront={nameButtonRenderFront(onOpen)} />);

  expect(screen.getByText('Спорт')).toBeTruthy();
  expect(screen.getByText('Навчання')).toBeTruthy();

  fireEvent.click(screen.getByText('Спорт'));

  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onOpen).toHaveBeenCalledWith('card-1');
});

// Генералізація (ISS-46): T36/D-121 -- той самий DeckGrid для архіву й для
// повного CardFace/CardBack DeckScreen, лише передавши інший renderFront.
test('DeckGrid не рендерить жодного тайла для порожнього items', () => {
  render(<DeckGrid items={[]} renderFront={nameButtonRenderFront(vi.fn())} />);

  expect(screen.queryByRole('button')).toBeNull();
});

// Стос зі свайпом (Андрій, скетч "як банківські картки перелистуються") --
// клік по картці, що ВИЗИРАЄ позаду передньої, переносить її наперед, а НЕ
// рендерить renderFront для неї -- це окремий жест від "стати передньою".
test('клік по картці позаду передньої переносить її наперед, не рендерить для неї renderFront', () => {
  const items = [
    { id: 'card-1', name: 'Спорт' },
    { id: 'card-2', name: 'Навчання' },
    { id: 'card-3', name: "Здоров'я" },
  ];
  const onOpen = vi.fn();

  render(<DeckGrid items={items} renderFront={nameButtonRenderFront(onOpen)} />);

  fireEvent.click(screen.getByText('Навчання'));

  expect(onOpen).not.toHaveBeenCalled();

  // "Навчання" тепер передня -- клік по ній тепер іде через renderFront.
  fireEvent.click(screen.getByText('Навчання'));
  expect(onOpen).toHaveBeenCalledWith('card-2');
});

test('кнопки ‹/› перегортають колоду по колу', () => {
  const items = [
    { id: 'card-1', name: 'Спорт' },
    { id: 'card-2', name: 'Навчання' },
  ];
  const onOpen = vi.fn();

  render(<DeckGrid items={items} renderFront={nameButtonRenderFront(onOpen)} />);

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

  render(<DeckGrid items={items} renderFront={nameButtonRenderFront(vi.fn())} />);

  expect(screen.queryByRole('button', { name: 'Наступна картка' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Попередня картка' })).toBeNull();
});
