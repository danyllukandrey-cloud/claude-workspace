// T21 -- SCR-02 Схема, screens.md: component test for LayoutBoard --
// canvas/tray/drag/connections/config states (spec.md AC-08, AC-11, AC-11b).
//
// D-131-наступне рішення (Андрій, чат, 2026-09-15) -- ПОВНЕ переписування:
// 1. "Схема не працює і вона жахлива. Пропоную прибрати повністю оті
//    клітинки." -- клітинки/HTML5 draggable прибрані, картка тепер {x, y}
//    (відсоток канви 0-100), драг -- через Pointer Events API
//    (fireEvent.pointerDown/Move/Up, jsdom підтримує).
// 2. "просто зображення схеми щоб займало верхні 70 відсотків екрану, а
//    блоки просто нехай будуть поскладані з низу" -- ОДНА канва
//    (data-testid="canvas") + купка нерозкладених (data-testid="unassigned-tray").
// 3. Реальний touch/mouse drag -- пінимо через симуляцію pointer-подій.
// 4/5. Інструмент "Зв'язати" (лінія/стрілка) -- тап по двох картках створює
//    зв'язок; тап по наявній лінії видаляє.
//
// getBoundingClientRect мокається ГЛОБАЛЬНО для файлу -- jsdom за
// замовчуванням повертає нулі, а формула переведення клієнтських
// координат у відсоток канви (LayoutBoard.tsx's toCanvasPercent) ділить на
// rect.width/height.

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { LayoutBoard } from './LayoutBoard';
import type { LayoutBoardState } from './LayoutBoard';

const CANVAS_RECT = { x: 0, y: 0, left: 0, top: 0, width: 300, height: 210, right: 300, bottom: 210 };

/**
 * jsdom 25 (this project's version) has NO `PointerEvent` implementation at
 * all (long-standing jsdom limitation, confirmed against this repo's actual
 * node_modules) -- `@testing-library/dom`'s `fireEvent.pointerDown/Move/Up`
 * silently falls back to a bare `window.Event`, which does not carry
 * `clientX`/`clientY` (unlike `MouseEvent`, which jsdom DOES implement
 * fully). LayoutBoard.tsx's drag math reads `event.clientX`/`clientY`
 * directly off the native event dispatched on `window` -- a bare `Event`
 * silently makes every computed coordinate `0`. This helper dispatches a
 * real `MouseEvent` (so `clientX`/`clientY` work) under the `pointerdown`/
 * `pointermove`/`pointerup` type string React's synthetic pointer-event
 * delegation listens for -- the DOM dispatches by `.type` string, not by the
 * constructor that created the event, so React's root listener (registered
 * for that exact type) still picks it up and builds a SyntheticEvent from
 * it. `pointerId` (PointerEvent-only, absent on MouseEvent) is added
 * afterwards as a plain property -- LayoutBoard.tsx only reads it
 * defensively for `setPointerCapture`, already wrapped in try/catch.
 */
function firePointer(target: EventTarget, type: 'pointerdown' | 'pointermove' | 'pointerup', clientX: number, clientY: number): void {
  const event = new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerId', { value: 1, configurable: true });
  act(() => {
    target.dispatchEvent(event);
  });
}

// Реалістичний розмір чипа картки (для рect-based відступу лінії зв'язку --
// LayoutBoard.tsx's rectPullback) -- значно менший за канву 300x210, інакше
// (як CANVAS_RECT для всіх елементів) чип "заповнював" би пів-канви і
// відступ ліній ставав абсурдно великим.
const CARD_CHIP_RECT = { x: 0, y: 0, left: 0, top: 0, width: 70, height: 36, right: 70, bottom: 36 };

let originalGetBoundingClientRect: typeof Element.prototype.getBoundingClientRect;

beforeEach(() => {
  originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    // "card chip" -- сам чип (data-card-id на собі) АБО card-wrapper, чия
    // ПРЯМА дитина -- чип (LayoutBoard.tsx's ref на wrapper-div). НЕ
    // querySelector (глибокий пошук) -- канва теж МІСТИТЬ чипи як нащадків
    // (просто не прямих), і глибокий пошук хибно позначав би саму канву
    // як "чип", підмінюючи canvasRect на CARD_CHIP_RECT.
    const isCardChip =
      this.hasAttribute('data-card-id') ||
      Array.from(this.children).some((child) => child.hasAttribute('data-card-id'));
    const rect = isCardChip ? CARD_CHIP_RECT : CANVAS_RECT;
    return { ...rect, toJSON: () => rect } as DOMRect;
  };
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

function baseState(overrides: Partial<LayoutBoardState> = {}): LayoutBoardState {
  return {
    layoutMode: null,
    cards: [
      { cardId: 'card-a', cardTitle: 'Картка A', x: 20, y: 30 },
      { cardId: 'card-b', cardTitle: 'Картка B', x: 60, y: 70 },
    ],
    connections: [],
    ...overrides,
  };
}

function baseProps(stateOverrides: Partial<LayoutBoardState> = {}) {
  return {
    loadLayout: vi.fn().mockResolvedValue(baseState(stateOverrides)),
    onMoveCard: vi.fn().mockResolvedValue(undefined),
    onCreateConnection: vi.fn().mockResolvedValue(undefined),
    onDeleteConnection: vi.fn().mockResolvedValue(undefined),
    onSaveLayoutMode: vi.fn().mockResolvedValue(undefined),
  };
}

test('loading: показує Spinner, поки GET /structure/layout ще в польоті', () => {
  let resolveLoad: (value: LayoutBoardState) => void = () => {};
  const loadLayout = vi.fn(() => new Promise<LayoutBoardState>((resolve) => { resolveLoad = resolve; }));

  render(
    <LayoutBoard
      loadLayout={loadLayout}
      onMoveCard={vi.fn()}
      onCreateConnection={vi.fn()}
      onDeleteConnection={vi.fn()}
      onSaveLayoutMode={vi.fn()}
    />,
  );

  expect(screen.getByRole('status')).toBeTruthy();
  void resolveLoad;
});

test('empty: жодної картки в колоді -- показує порожній стан', async () => {
  const props = baseProps({ cards: [] });
  render(<LayoutBoard {...props} />);

  await screen.findByText(/наступ|додай|порожн/i);
  expect(screen.queryByTestId('canvas')).toBeNull();
});

test('default: розкладені картки показані всередині канви на своєму x/y', async () => {
  const props = baseProps();
  render(<LayoutBoard {...props} />);

  const canvas = await screen.findByTestId('canvas');
  const cardA = screen.getByTestId('card-card-a');
  expect(canvas.contains(cardA)).toBe(true);
  expect(cardA.parentElement?.style.left).toBe('20%');
  expect(cardA.parentElement?.style.top).toBe('30%');
});

test('default: нерозкладена картка (x/y null) показана в купці, не серед вільно розташованих карток канви', async () => {
  const props = baseProps({
    cards: [
      { cardId: 'card-a', cardTitle: 'Картка A', x: 20, y: 30 },
      { cardId: 'card-tray', cardTitle: 'У треї', x: null, y: null },
    ],
  });
  render(<LayoutBoard {...props} />);

  const tray = await screen.findByTestId('unassigned-tray');
  const trayCard = screen.getByTestId('card-card-tray');

  // Живе тестування (Андрій): "блоки мають лежати в зоні де схема а не поза
  // нею" -- купка нерозкладених тепер НАВМИСНЕ вкладена всередину тієї самої
  // зони (data-testid="canvas"), тож canvas.contains(trayCard) законно true.
  // Значущий інваріант -- картка без позиції лежить САМЕ в треї, а не
  // позиціонована вільно (style left/top) як розкладена картка канви.
  expect(tray.contains(trayCard)).toBe(true);
  expect(trayCard.style.left).toBe('');
});

describe('вимога 3 (чат): реальний драг мишею/дотиком через Pointer Events', () => {
  test('перетягування картки на канві викликає onMoveCard із новим x/y (відсоток canvasRect)', async () => {
    const props = baseProps();
    render(<LayoutBoard {...props} />);

    const card = await screen.findByTestId('card-card-a');

    firePointer(card, 'pointerdown', 60, 63); // (20%,30%) канви 300x210
    firePointer(window, 'pointermove', 150, 105); // центр -> 50%,50%
    firePointer(window, 'pointerup', 150, 105);

    await waitFor(() => expect(props.onMoveCard).toHaveBeenCalledWith({ cardId: 'card-a', x: 50, y: 50 }));
  });

  test('перетягування картки з купки нерозкладених на канву теж зберігає нову позицію', async () => {
    const props = baseProps({
      cards: [
        { cardId: 'card-a', cardTitle: 'Картка A', x: 20, y: 30 },
        { cardId: 'card-tray', cardTitle: 'У треї', x: null, y: null },
      ],
    });
    render(<LayoutBoard {...props} />);

    const trayCard = await screen.findByTestId('card-card-tray');

    firePointer(trayCard, 'pointerdown', 0, 250);
    firePointer(window, 'pointermove', 75, 42); // 25%, 20%
    firePointer(window, 'pointerup', 75, 42);

    await waitFor(() => expect(props.onMoveCard).toHaveBeenCalledWith({ cardId: 'card-tray', x: 25, y: 20 }));
  });

  test('координати клемпляться в 0..100 -- перетягування за межі канви не виходить за них', async () => {
    const props = baseProps();
    render(<LayoutBoard {...props} />);

    const card = await screen.findByTestId('card-card-a');

    firePointer(card, 'pointerdown', 60, 63);
    firePointer(window, 'pointermove', 900, -500);
    firePointer(window, 'pointerup', 900, -500);

    await waitFor(() => expect(props.onMoveCard).toHaveBeenCalledWith({ cardId: 'card-a', x: 100, y: 0 }));
  });

  test('мережева помилка при збереженні позиції -- банер, не toast/alert', async () => {
    const onMoveCard = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    const props = { ...baseProps(), onMoveCard };
    render(<LayoutBoard {...props} />);

    const card = await screen.findByTestId('card-card-a');
    firePointer(card, 'pointerdown', 60, 63);
    firePointer(window, 'pointermove', 150, 105);
    firePointer(window, 'pointerup', 150, 105);

    const banner = await screen.findByText(/не вдалося зберегти|мереж/i);
    expect(banner.closest('[data-variant]')?.getAttribute('data-variant')).toBe('error');
  });
});

describe('вимоги 4/5 (чат): два завжди видимі інструменти "Лінія"/"Стрілка" -- без проміжної кнопки-шлюзу "Зв\'язати"', () => {
  test('обидва інструменти видимі одразу, клік по "Лінія" вмикає підказку "оберіть першу картку"', async () => {
    const props = baseProps();
    render(<LayoutBoard {...props} />);

    await screen.findByTestId('canvas');
    expect(screen.getByRole('button', { name: 'Лінія' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Стрілка' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Лінія' }));
    await screen.findByText(/оберіть першу картку/i);
  });

  test('тап по двох картках з обраним "Лінія" створює недирекційний зв\'язок (directed: false)', async () => {
    const props = baseProps();
    render(<LayoutBoard {...props} />);

    await screen.findByTestId('canvas');
    fireEvent.click(screen.getByRole('button', { name: 'Лінія' }));
    firePointer(screen.getByTestId('card-card-a'), 'pointerdown', 10, 10);
    firePointer(screen.getByTestId('card-card-b'), 'pointerdown', 20, 20);

    await waitFor(() =>
      expect(props.onCreateConnection).toHaveBeenCalledWith({ cardIdA: 'card-a', cardIdB: 'card-b', directed: false }),
    );
  });

  test('обрання "Стрілка" перед тапом по двох картках створює напрямлений зв\'язок (directed: true)', async () => {
    const props = baseProps();
    render(<LayoutBoard {...props} />);

    await screen.findByTestId('canvas');
    fireEvent.click(screen.getByRole('button', { name: 'Стрілка' }));
    firePointer(screen.getByTestId('card-card-a'), 'pointerdown', 10, 10);
    firePointer(screen.getByTestId('card-card-b'), 'pointerdown', 20, 20);

    await waitFor(() =>
      expect(props.onCreateConnection).toHaveBeenCalledWith({ cardIdA: 'card-a', cardIdB: 'card-b', directed: true }),
    );
  });

  test('тап по вже обраній першій картці вдруге скасовує вибір, не створює зв\'язок картки самої із собою', async () => {
    const props = baseProps();
    render(<LayoutBoard {...props} />);

    await screen.findByTestId('canvas');
    fireEvent.click(screen.getByRole('button', { name: 'Лінія' }));
    firePointer(screen.getByTestId('card-card-a'), 'pointerdown', 10, 10);
    firePointer(screen.getByTestId('card-card-a'), 'pointerdown', 10, 10);

    expect(props.onCreateConnection).not.toHaveBeenCalled();
    await screen.findByText(/оберіть першу картку/i);
  });

  test('повторний клік по вже активному інструменту вимикає режим зв\'язування без побічних дій', async () => {
    const props = baseProps();
    render(<LayoutBoard {...props} />);

    await screen.findByTestId('canvas');
    fireEvent.click(screen.getByRole('button', { name: 'Лінія' }));
    await screen.findByText(/оберіть першу картку/i);

    fireEvent.click(screen.getByRole('button', { name: 'Лінія' }));

    expect(screen.queryByText(/оберіть першу картку/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Лінія' }).getAttribute('aria-pressed')).toBe('false');
    expect(props.onCreateConnection).not.toHaveBeenCalled();
  });

  test('клік по "Стрілка", поки активна "Лінія", перемикає інструмент замість вмикання обох', async () => {
    const props = baseProps();
    render(<LayoutBoard {...props} />);

    await screen.findByTestId('canvas');
    fireEvent.click(screen.getByRole('button', { name: 'Лінія' }));
    fireEvent.click(screen.getByRole('button', { name: 'Стрілка' }));

    expect(screen.getByRole('button', { name: 'Лінія' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Стрілка' }).getAttribute('aria-pressed')).toBe('true');
  });

  test('наявний зв\'язок рендериться SVG-лінією, відтягнутою від центрів карток (щоб вістря стрілки не ховалось під чипом)', async () => {
    const props = baseProps({
      connections: [{ id: 'conn-1', cardIdA: 'card-a', cardIdB: 'card-b', directed: false }],
    });
    render(<LayoutBoard {...props} />);

    const line = await screen.findByTestId('connection-conn-1');
    // Центри карток -- (20,30) і (60,70); кінці лінії відтягнуті від центру
    // на межу ФАКТИЧНОГО прямокутника чипа (CARD_CHIP_RECT 70x36 на канві
    // 300x210, +1 запасу), щоб і лінія, і вістря стрілки (для directed:true)
    // малювались поза межею непрозорого чипа картки, а не під ним.
    expect(Number(line.getAttribute('x1'))).toBeCloseTo(29.281, 2);
    expect(Number(line.getAttribute('y1'))).toBeCloseTo(39.281, 2);
    expect(Number(line.getAttribute('x2'))).toBeCloseTo(50.719, 2);
    expect(Number(line.getAttribute('y2'))).toBeCloseTo(60.719, 2);
    expect(line.getAttribute('data-directed')).toBe('false');
  });

  test('тап по наявному зв\'язку (поза режимом зв\'язування) видаляє його', async () => {
    const props = baseProps({
      connections: [{ id: 'conn-1', cardIdA: 'card-a', cardIdB: 'card-b', directed: false }],
    });
    render(<LayoutBoard {...props} />);

    const line = await screen.findByTestId('connection-conn-1');
    fireEvent.click(line);

    await waitFor(() => expect(props.onDeleteConnection).toHaveBeenCalledWith({ connectionId: 'conn-1' }));
    // Оптимістичне видалення -- лінія зникає одразу, не чекаючи відповіді сервера.
    expect(screen.queryByTestId('connection-conn-1')).toBeNull();
  });
});

// --- AC-12: вхід у SCR-04 "Закрити напрямок" прямо зі Схеми ------------------

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

  await screen.findByTestId('canvas');
  expect(screen.queryByRole('button', { name: /Закрити напрямок/ })).toBeNull();
});

test('AC-12: кожна картка має власну дію "Закрити напрямок", клік відкриває SCR-04 із назвою саме цієї картки', async () => {
  const props = { ...baseProps(), ...closeCapability() };
  render(<LayoutBoard {...props} />);

  const openA = await screen.findByRole('button', { name: 'Закрити напрямок «Картка A»' });
  expect(screen.getByRole('button', { name: 'Закрити напрямок «Картка B»' })).toBeTruthy();

  fireEvent.click(openA);

  expect(props.loadCloseCardOptions).toHaveBeenCalledWith('card-a');

  const dialog = await screen.findByRole('dialog');
  expect(dialog.textContent).toContain('Картка A');
  expect(await screen.findByText('книги')).toBeTruthy();
});

test('AC-12: клік на "Закрити напрямок" не запускає драг картки (stopPropagation)', async () => {
  const props = { ...baseProps(), ...closeCapability() };
  render(<LayoutBoard {...props} />);

  const closeButton = await screen.findByRole('button', { name: 'Закрити напрямок «Картка A»' });
  firePointer(closeButton, 'pointerdown', 60, 63);

  // pointerdown на кнопці не мусить стартувати драг батьківського чипа --
  // жодного onMoveCard навіть після pointerup деінде.
  firePointer(window, 'pointerup', 200, 150);
  expect(props.onMoveCard).not.toHaveBeenCalled();
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
    .mockResolvedValueOnce(baseState({ cards: [{ cardId: 'card-b', cardTitle: 'Картка B', x: 60, y: 70 }] }));
  const props = {
    loadLayout,
    onMoveCard: vi.fn().mockResolvedValue(undefined),
    onCreateConnection: vi.fn().mockResolvedValue(undefined),
    onDeleteConnection: vi.fn().mockResolvedValue(undefined),
    onSaveLayoutMode: vi.fn().mockResolvedValue(undefined),
    ...closeCapability(),
  };
  render(<LayoutBoard {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Закрити напрямок «Картка A»' }));
  await screen.findByText('книги');
  fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));

  await waitFor(() => expect(loadLayout).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByTestId('card-card-a')).toBeNull();
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

test('AC-12 + купка нерозкладених: картку звідти теж можна закрити', async () => {
  const props = {
    ...baseProps({
      cards: [{ cardId: 'card-a', cardTitle: 'Картка A', x: null, y: null }],
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

// --- Живе тестування: "Конфігурація" -- пікер режиму розкладки (D-131) -------

test('живе тестування: плаваюча кнопка "Конфігурація" знизу по центру перемикає на пікер 5 режимів', async () => {
  const props = baseProps({ layoutMode: 'free', cards: [{ cardId: 'card-a', cardTitle: 'Картка A', x: null, y: null }] });
  render(<LayoutBoard {...props} />);

  await screen.findByTestId('unassigned-tray');
  fireEvent.click(screen.getByRole('button', { name: 'Конфігурація' }));

  for (const label of ['Баланс навколо ядра', 'Фокус і спостереження', 'Причина і наслідок', 'Вільна розкладка', 'Готово до розкладання']) {
    expect(screen.getByRole('radio', { name: label })).toBeTruthy();
  }
  expect((screen.getByRole('radio', { name: 'Вільна розкладка' }) as HTMLInputElement).checked).toBe(true);
});

test('AC-11: обрання нового layoutMode без уже розкладених карток застосовує його одразу, без ConfirmDialog, і повертає на BOARD', async () => {
  const props = baseProps({
    layoutMode: 'free',
    cards: [
      { cardId: 'card-a', cardTitle: 'Картка A', x: null, y: null },
      { cardId: 'card-b', cardTitle: 'Картка B', x: null, y: null },
    ],
  });
  render(<LayoutBoard {...props} />);

  await screen.findByTestId('unassigned-tray');
  fireEvent.click(screen.getByRole('button', { name: 'Конфігурація' }));

  fireEvent.click(await screen.findByRole('radio', { name: 'Баланс навколо ядра' }));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(props.onSaveLayoutMode).toHaveBeenCalledWith({ layoutMode: 'balance' }));
  await waitFor(() => expect(props.loadLayout).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('radio', { name: 'Баланс навколо ядра' })).toBeNull());
});

test('AC-11b: зміна layoutMode з уже розкладеними картками показує ConfirmDialog ПЕРЕД onSaveLayoutMode', async () => {
  const props = baseProps({ layoutMode: 'free' }); // baseState -- обидві картки вже мають x/y -- hasArrangedCards true.
  render(<LayoutBoard {...props} />);

  await screen.findByTestId('canvas');
  fireEvent.click(screen.getByRole('button', { name: 'Конфігурація' }));

  fireEvent.click(await screen.findByRole('radio', { name: 'Баланс навколо ядра' }));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(props.onSaveLayoutMode).not.toHaveBeenCalled();
});

test('AC-11b: підтвердження в ConfirmDialog викликає onSaveLayoutMode з новим layoutMode і повертає на BOARD', async () => {
  const props = baseProps({ layoutMode: 'free' });
  render(<LayoutBoard {...props} />);

  await screen.findByTestId('canvas');
  fireEvent.click(screen.getByRole('button', { name: 'Конфігурація' }));
  fireEvent.click(await screen.findByRole('radio', { name: 'Баланс навколо ядра' }));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Змінити' }));

  await waitFor(() => expect(props.onSaveLayoutMode).toHaveBeenCalledWith({ layoutMode: 'balance' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(screen.queryByRole('radio', { name: 'Баланс навколо ядра' })).toBeNull());
});

test('AC-11b: скасування в ConfirmDialog не викликає onSaveLayoutMode, лишає попередній режим обраним, CONFIG не закривається', async () => {
  const props = baseProps({ layoutMode: 'free' });
  render(<LayoutBoard {...props} />);

  await screen.findByTestId('canvas');
  fireEvent.click(screen.getByRole('button', { name: 'Конфігурація' }));
  fireEvent.click(await screen.findByRole('radio', { name: 'Баланс навколо ядра' }));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Скасувати' }));

  expect(props.onSaveLayoutMode).not.toHaveBeenCalled();
  expect((screen.getByRole('radio', { name: 'Вільна розкладка' }) as HTMLInputElement).checked).toBe(true);
});

test('CONFIG: onSaveLayoutMode падає з AppError -- Banner variant="error" у CONFIG, режим не збережено, екран лишається в CONFIG', async () => {
  const onSaveLayoutMode = vi.fn().mockRejectedValue({
    name: 'AppError',
    message: 'layoutMode must be one of: balance, focus, cause_effect, free, staging',
    code: 'structure.invalid_layout_mode',
    httpStatus: 422,
  });
  const props = { ...baseProps({ layoutMode: 'free' }), onSaveLayoutMode };
  render(<LayoutBoard {...props} />);

  await screen.findByTestId('canvas');
  fireEvent.click(screen.getByRole('button', { name: 'Конфігурація' }));
  fireEvent.click(await screen.findByRole('radio', { name: 'Вільна розкладка' })); // той самий режим -- без діалогу
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  const banner = await screen.findByText('layoutMode must be one of: balance, focus, cause_effect, free, staging');
  expect(banner.closest('[data-variant]')?.getAttribute('data-variant')).toBe('error');
  expect(screen.getByRole('radio', { name: 'Вільна розкладка' })).toBeTruthy();
});

// --- Вимога 15 ("Готово до розкладання") -------------------------------------

test('staging: підказка з\'являється, поки лишається хоч одна нерозкладена картка', async () => {
  const props = baseProps({
    layoutMode: 'staging',
    cards: [
      { cardId: 'card-a', cardTitle: 'Картка A', x: null, y: null },
      { cardId: 'card-b', cardTitle: 'Картка B', x: null, y: null },
    ],
  });
  render(<LayoutBoard {...props} />);

  const hint = await screen.findByText(/готово до розкладання/i);
  expect(hint.closest('[data-variant]')?.getAttribute('data-variant')).toBe('info');
});

test('staging: коли всі картки вже розкладені, підказки немає', async () => {
  const props = baseProps({ layoutMode: 'staging' }); // baseState -- обидві картки вже мають x/y.
  render(<LayoutBoard {...props} />);

  await screen.findByTestId('canvas');
  expect(screen.queryByText(/готово до розкладання/i)).toBeNull();
});

test('staging: режим інший -- підказки немає навіть із нерозкладеними картками', async () => {
  const props = baseProps({
    layoutMode: 'free',
    cards: [{ cardId: 'card-a', cardTitle: 'Картка A', x: null, y: null }],
  });
  render(<LayoutBoard {...props} />);

  await screen.findByTestId('unassigned-tray');
  expect(screen.queryByText(/готово до розкладання/i)).toBeNull();
});
