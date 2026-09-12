// RED (T21 -- SCR-02 Схема, screens.md): component test for LayoutBoard --
// default/empty/loading/reset-basic-order/error-cell-occupied/error states
// (spec.md AC-02, AC-08, AC-11b, AC-16b). Component does not exist yet --
// this is the RED step, no production code written (test-author role).
//
// DI style (plan/app/CLAUDE.md, matches AnalyticsScreen/DeclarationScreen):
// `loadLayout` / `onMoveCard` are injected prop-functions, no fetch() inside
// the component. `onMoveCard` maps 1:1 to `PUT /structure/layout/{cardId}`
// (contracts/openapi.yaml `moveCard`, app/move-card.ts's MoveCardInput
// minus ownerUserId/positionUpdatedAt -- those are the ports/http layer's
// job, out of scope here).
//
// AC-11b/AC-16b (screens.md "reset-basic-order"): the screen does not itself
// decide *why* a reset happened -- `loadLayout` already reports the fact via
// `justReset` (mirrors AnalyticsScreen's `trendAvailable` pattern: a single
// upstream flag, not two separate ones per trigger). Both a layoutMode
// switch (AC-11b) and a logicVariant switch while layoutMode stays 'logic'
// (AC-16b) must drive the exact same banner + bottom-base-order rendering --
// asserted below with two separate scenarios that differ only in *why*
// `justReset` is true, never in what's rendered.
//
// AC-02 (D-62, `409 structure.cell_occupied`): rejection is shown inline
// next to the cell that was dropped on, never a toast/alert
// (design-system.md "errors inline, never alert/confirm").
// AC-08: a successful drop calls `onMoveCard` with the dragged card's id
// and the target cell's index -- the actual PUT happens one layer up
// (ports/), not asserted here.

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LayoutBoard } from './LayoutBoard';
import type { LayoutBoardState } from './LayoutBoard';

// jsdom does not implement DataTransfer -- a minimal fake carrying the
// dragged card's id is enough for LayoutBoard's onDragStart/onDrop handlers.
function fakeDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    setData: (key: string, value: string) => store.set(key, value),
    getData: (key: string) => store.get(key) ?? '',
  } as unknown as DataTransfer;
}

function baseState(overrides: Partial<LayoutBoardState> = {}): LayoutBoardState {
  return {
    cellCount: 6,
    justReset: false,
    cards: [
      { cardId: 'card-a', cardTitle: 'Картка A', cellIndex: 0, baseOrder: 0 },
      { cardId: 'card-b', cardTitle: 'Картка B', cellIndex: 1, baseOrder: 1 },
    ],
    ...overrides,
  };
}

function baseProps(stateOverrides: Partial<LayoutBoardState> = {}) {
  return {
    loadLayout: vi.fn().mockResolvedValue(baseState(stateOverrides)),
    onMoveCard: vi.fn().mockResolvedValue(undefined),
  };
}

test('loading: показує Spinner, поки GET /structure/layout ще в польоті', () => {
  let resolveLoad: (value: LayoutBoardState) => void = () => {};
  const loadLayout = vi.fn(
    () => new Promise<LayoutBoardState>((resolve) => { resolveLoad = resolve; }),
  );

  render(<LayoutBoard loadLayout={loadLayout} onMoveCard={vi.fn()} />);

  expect(screen.getByRole('status')).toBeTruthy();
  void resolveLoad;
});

test('empty: жодної картки в колоді -- показує порожній стан', async () => {
  const props = baseProps({ cards: [] });
  render(<LayoutBoard {...props} />);

  await screen.findByText(/наступ|додай|порожн/i);
  expect(screen.queryByTestId('cell-0')).toBeNull();
});

test('default: активні позиції -- картки показані на своїх клітинках', async () => {
  const props = baseProps();
  render(<LayoutBoard {...props} />);

  const cellZero = await screen.findByTestId('cell-0');
  expect(cellZero.textContent).toContain('Картка A');

  const cellOne = screen.getByTestId('cell-1');
  expect(cellOne.textContent).toContain('Картка B');
});

test('default (AC-08): перетягування картки на вільну клітинку викликає onMoveCard з новим cellIndex', async () => {
  const props = baseProps();
  render(<LayoutBoard {...props} />);

  const card = await screen.findByText('Картка A');
  const targetCell = screen.getByTestId('cell-2');
  const dataTransfer = fakeDataTransfer();

  fireEvent.dragStart(card, { dataTransfer });
  fireEvent.drop(targetCell, { dataTransfer });

  expect(props.onMoveCard).toHaveBeenCalledWith({ cardId: 'card-a', cellIndex: 2 });
});

test('reset-basic-order (AC-11b): щойно змінено layoutMode -- банер "розклади заново" і картки внизу в базовому порядку', async () => {
  const props = baseProps({
    justReset: true,
    cards: [
      { cardId: 'card-a', cardTitle: 'Картка A', cellIndex: null, baseOrder: 0 },
      { cardId: 'card-b', cardTitle: 'Картка B', cellIndex: null, baseOrder: 1 },
    ],
  });
  render(<LayoutBoard {...props} />);

  const banner = await screen.findByText(/розклад.*заново/i);
  expect(banner.closest('[data-variant]')?.getAttribute('data-variant')).toBe('info');

  const tray = screen.getByTestId('unassigned-tray');
  const trayCardIds = Array.from(tray.querySelectorAll('[data-card-id]')).map((el) =>
    el.getAttribute('data-card-id'),
  );
  expect(trayCardIds).toEqual(['card-a', 'card-b']);

  // Жодна картка ще не сидить на клітинці -- сітка вище порожня.
  expect(screen.getByTestId('cell-0').textContent).not.toContain('Картка');
});

test('reset-basic-order (AC-16b): той самий банер і та сама розкладка, коли скинуто через зміну logicVariant (не layoutMode)', async () => {
  const props = baseProps({
    justReset: true,
    cards: [
      { cardId: 'card-a', cardTitle: 'Картка A', cellIndex: null, baseOrder: 0 },
      { cardId: 'card-b', cardTitle: 'Картка B', cellIndex: null, baseOrder: 1 },
    ],
  });
  // layoutMode лишається 'logic' в обидва боки -- єдине, що змінилось
  // "нагорі" (T5, switchLogicVariant), це logicVariant; loadLayout уже
  // згорнув причину в той самий `justReset` прапорець (той самий підхід,
  // що AnalyticsScreen's trendAvailable), тож рендер має бути ідентичним
  // AC-11b-сценарію вище -- це і є суть DoD "не лише layoutMode".
  render(<LayoutBoard {...props} />);

  const banner = await screen.findByText(/розклад.*заново/i);
  expect(banner).toBeTruthy();

  const tray = screen.getByTestId('unassigned-tray');
  expect(tray.querySelectorAll('[data-card-id]')).toHaveLength(2);
});

test('error-cell-occupied (AC-02, 409 structure.cell_occupied): показується inline біля клітинки, не toast/alert', async () => {
  const onMoveCard = vi.fn().mockRejectedValue({
    name: 'AppError',
    message: 'Клітинку вже займає інша картка',
    code: 'structure.cell_occupied',
    httpStatus: 409,
  });
  const props = { loadLayout: vi.fn().mockResolvedValue(baseState()), onMoveCard };
  render(<LayoutBoard {...props} />);

  const card = await screen.findByText('Картка A');
  const targetCell = screen.getByTestId('cell-3');
  const dataTransfer = fakeDataTransfer();

  fireEvent.dragStart(card, { dataTransfer });
  fireEvent.drop(targetCell, { dataTransfer });

  const inlineError = await screen.findByText(/зайнят/i);
  // Inline -- прив'язана до самої клітинки, не окремий банер на всю ширину екрана.
  expect(targetCell.contains(inlineError)).toBe(true);
});

test('error: мережева помилка при збереженні позиції -- банер, не toast/alert', async () => {
  const onMoveCard = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
  const props = { loadLayout: vi.fn().mockResolvedValue(baseState()), onMoveCard };
  render(<LayoutBoard {...props} />);

  const card = await screen.findByText('Картка A');
  const targetCell = screen.getByTestId('cell-3');
  const dataTransfer = fakeDataTransfer();

  fireEvent.dragStart(card, { dataTransfer });
  fireEvent.drop(targetCell, { dataTransfer });

  const banner = await screen.findByText(/не вдалося зберегти|мереж/i);
  expect(banner.closest('[data-variant]')).not.toBeNull();
});

// --- AC-12: вхід у SCR-04 "Закрити напрямок" прямо зі Схеми ------------------
//
// Review 2026-09-11 (MUST-FIX 4): SCR-04 (CloseCardDialog) був написаний і
// протестований, але НЕ мав жодної точки входу -- 0 використань поза власним
// тестом, тож AC-12 був недосяжний користувачу. screens.md SCR-04 state
// `success` каже "повернення на SCR-02" -- отже вхід і є SCR-02 (цей екран).
//
// DI лишається тим самим (plan/app/CLAUDE.md): жодного fetch() тут.
// `loadCloseCardOptions` -- GET /cards/{id}/metric-blocks + перелік карток-цілей,
// `onCloseCard` -- POST /structure/layout/{cardId}/close. Обидва ОПЦІЙНІ: поки
// composition root їх не підставив, кнопки просто немає (не напівживий діалог,
// що нікуди не веде).

function closeCapability(overrides: Record<string, unknown> = {}) {
  return {
    loadCloseCardOptions: vi.fn().mockResolvedValue({
      metricBlocks: [{ metricBlockId: 'mb-1', label: 'книги' }],
      targetCards: [{ cardId: 'card-b', cardTitle: 'Картка B' }],
    }),
    onCloseCard: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

test('AC-12: без інжектованої можливості закриття кнопки "Закрити напрямок" немає', async () => {
  const props = baseProps();
  render(<LayoutBoard {...props} />);

  await screen.findByTestId('cell-0');
  expect(screen.queryByRole('button', { name: /Закрити напрямок/ })).toBeNull();
});

test('AC-12: кожна картка має власну дію "Закрити напрямок", клік відкриває SCR-04 із назвою саме цієї картки', async () => {
  const props = { ...baseProps(), ...closeCapability() };
  render(<LayoutBoard {...props} />);

  const openA = await screen.findByRole('button', { name: 'Закрити напрямок «Картка A»' });
  expect(screen.getByRole('button', { name: 'Закрити напрямок «Картка B»' })).toBeTruthy();

  fireEvent.click(openA);

  // cardId тієї картки, на якій натиснули -- не першої в списку "про всяк випадок".
  expect(props.loadCloseCardOptions).toHaveBeenCalledWith('card-a');

  const dialog = await screen.findByRole('dialog');
  // Доступність (review 2026-09-11, Частина 3): видно, ЯКУ картку закриваєш --
  // інакше діалог без назви однаковий для будь-якої картки.
  expect(dialog.textContent).toContain('Картка A');
  expect(await screen.findByText('книги')).toBeTruthy();
});

test('AC-12: підтвердження викликає onCloseCard з cardId цієї картки і обраними переносами метрик', async () => {
  const props = { ...baseProps(), ...closeCapability() };
  render(<LayoutBoard {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Закрити напрямок «Картка A»' }));
  await screen.findByText('книги');

  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'card-b' } });
  fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));

  await waitFor(() =>
    expect(props.onCloseCard).toHaveBeenCalledWith({
      cardId: 'card-a',
      metricTransfers: [{ metricBlockId: 'mb-1', targetCardId: 'card-b' }],
    }),
  );
});

test('AC-12: після успішного закриття діалог зникає, а розкладка перечитується з сервера', async () => {
  const loadLayout = vi
    .fn()
    .mockResolvedValueOnce(baseState())
    .mockResolvedValueOnce(
      baseState({ cards: [{ cardId: 'card-b', cardTitle: 'Картка B', cellIndex: 1, baseOrder: 1 }] }),
    );
  const props = { loadLayout, onMoveCard: vi.fn().mockResolvedValue(undefined), ...closeCapability() };
  render(<LayoutBoard {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Закрити напрямок «Картка A»' }));
  await screen.findByText('книги');
  fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));

  // Джерело правди -- сервер: закрита позиція зникає з сітки після перечитування,
  // а не через локальне вгадування нового стану.
  await waitFor(() => expect(loadLayout).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByTestId('cell-0').textContent).not.toContain('Картка A');
});

test('AC-12: "Скасувати" закриває діалог і нічого не надсилає', async () => {
  const props = { ...baseProps(), ...closeCapability() };
  render(<LayoutBoard {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Закрити напрямок «Картка A»' }));
  await screen.findByText('книги');
  fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(props.onCloseCard).not.toHaveBeenCalled();
  expect(props.loadLayout).toHaveBeenCalledTimes(1);
});

test('AC-12: не вдалося прочитати метрики картки -- банер, діалог не відкривається', async () => {
  const props = {
    ...baseProps(),
    ...closeCapability({ loadCloseCardOptions: vi.fn().mockRejectedValue(new Error('Failed to fetch')) }),
  };
  render(<LayoutBoard {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Закрити напрямок «Картка A»' }));

  const banner = await screen.findByText(/не вдалося|мереж/i);
  expect(banner.closest('[data-variant]')).not.toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('AC-12 + AC-11b: картку з треї нерозкладених теж можна закрити', async () => {
  const props = {
    ...baseProps({
      justReset: true,
      cards: [{ cardId: 'card-a', cardTitle: 'Картка A', cellIndex: null, baseOrder: 0 }],
    }),
    ...closeCapability(),
  };
  render(<LayoutBoard {...props} />);

  const tray = await screen.findByTestId('unassigned-tray');
  const openA = screen.getByRole('button', { name: 'Закрити напрямок «Картка A»' });
  expect(tray.contains(openA)).toBe(true);

  fireEvent.click(openA);
  expect(props.loadCloseCardOptions).toHaveBeenCalledWith('card-a');
});
