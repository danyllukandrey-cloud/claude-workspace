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
// CH-03/CH-04/CH-05/CH-06/CH-10 (docs/features/structure/changes.md,
// 2026-09-21): "На зад" на CONFIG, купка -- явна ціль перетягування навіть
// порожньою (CH-04), "Закрити напрямок" -> "Архівувати" через ТОЙ САМИЙ
// injected archiveCard, що колода (CH-05/CH-06), перемикання на "Готово до
// розкладання" переносить картки канви в трей (CH-10).
//
// getBoundingClientRect мокається ГЛОБАЛЬНО для файлу -- jsdom за
// замовчуванням повертає нулі, а формула переведення клієнтських
// координат у відсоток канви (LayoutBoard.tsx's toCanvasPercent) ділить на
// rect.width/height. CH-04: купка (data-testid="unassigned-tray") тепер має
// ВЛАСНИЙ прямокутник (TRAY_RECT, вузька смуга внизу CANVAS_RECT) -- без
// цього купка (порожня, під час драгу) мала б ТОЙ САМИЙ прямокутник, що й
// канва (загальний фолбек для "не чіп картки"), і будь-яке відпускання
// картки хибно розпізнавалось би як "у треї".

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { LayoutBoard } from './LayoutBoard';
import type { LayoutBoardState } from './LayoutBoard';

const CANVAS_RECT = { x: 0, y: 0, left: 0, top: 0, width: 300, height: 210, right: 300, bottom: 210 };
// Вузька смуга внизу канви (40px із 210) -- реалістична пропорція max-h-28
// (7rem) на типовому мобільному екрані, окрема від CANVAS_RECT (CH-04).
const TRAY_RECT = { x: 0, y: 170, left: 0, top: 170, width: 300, height: 40, right: 300, bottom: 210 };

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
    // CH-04: купка -- ВЛАСНИЙ прямокутник, перевіряється ПЕРШИМ (інакше
    // непорожня купка хибно розпізналась би як "чип картки" нижче, бо її
    // прямі діти -- чипи з data-card-id).
    if (this.getAttribute('data-testid') === 'unassigned-tray') {
      return { ...TRAY_RECT, toJSON: () => TRAY_RECT } as DOMRect;
    }
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
      { cardId: 'card-a', cardTitle: 'Картка A', x: 20, y: 30, healthState: null },
      { cardId: 'card-b', cardTitle: 'Картка B', x: 60, y: 70, healthState: null },
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
    // CH-01 (docs/features/structure/changes.md): "Архів карток" біля
    // "Конфігурація" -- App.tsx підставляє реальний shared callback.
    onOpenArchive: vi.fn(),
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
      onOpenArchive={vi.fn()}
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
      { cardId: 'card-a', cardTitle: 'Картка A', x: 20, y: 30, healthState: null },
      { cardId: 'card-tray', cardTitle: 'У треї', x: null, y: null, healthState: null },
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

// CH-04 (docs/features/structure/changes.md): купка -- явна ціль
// перетягування, зона внизу не затуляє канву (рескейл), "невизначено" ---
// власний стан, до якого можна повернутись перетягуванням.

describe('CH-04: купка як явна ціль "визначено/невизначено"', () => {
  test('без жодної нерозкладеної картки купка НЕ рендериться поза драгом', async () => {
    const props = baseProps(); // обидві картки визначені.
    render(<LayoutBoard {...props} />);

    await screen.findByTestId('canvas');
    expect(screen.queryByTestId('unassigned-tray')).toBeNull();
  });

  test('під час будь-якого драгу купка з\'являється як ціль, навіть порожня, з підказкою', async () => {
    const props = baseProps(); // обидві картки визначені, купки на старті немає.
    render(<LayoutBoard {...props} />);

    const card = await screen.findByTestId('card-card-a');
    firePointer(card, 'pointerdown', 60, 63);

    const tray = await screen.findByTestId('unassigned-tray');
    expect(tray.textContent).toMatch(/відпустіть|невизначен/i);

    firePointer(window, 'pointerup', 150, 105);
  });

  test('відпустив картку в зоні купки (TRAY_RECT) -- onMoveCard НЕ викликається, картка залишається в треї', async () => {
    const props = baseProps();
    render(<LayoutBoard {...props} />);

    const card = await screen.findByTestId('card-card-a');
    firePointer(card, 'pointerdown', 60, 63);
    // (150, 190) -- усередині TRAY_RECT (top:170..bottom:210).
    firePointer(window, 'pointermove', 150, 190);
    firePointer(window, 'pointerup', 150, 190);

    const tray = await screen.findByTestId('unassigned-tray');
    await waitFor(() => expect(tray.contains(screen.getByTestId('card-card-a'))).toBe(true));
    expect(props.onMoveCard).not.toHaveBeenCalled();
  });

  test('перетягнув картку з купки назад на канву -- знову "визначена" (onMoveCard викликається)', async () => {
    const props = baseProps();
    render(<LayoutBoard {...props} />);

    const card = await screen.findByTestId('card-card-a');
    firePointer(card, 'pointerdown', 60, 63);
    firePointer(window, 'pointermove', 150, 190); // спершу в трей.
    firePointer(window, 'pointerup', 150, 190);

    await waitFor(() => {
      const tray = screen.getByTestId('unassigned-tray');
      expect(tray.contains(screen.getByTestId('card-card-a'))).toBe(true);
    });

    // Другий драг тієї самої картки -- назад на канву (за межами TRAY_RECT).
    firePointer(screen.getByTestId('card-card-a'), 'pointerdown', 60, 63);
    firePointer(window, 'pointermove', 150, 105);
    firePointer(window, 'pointerup', 150, 105);

    await waitFor(() => expect(props.onMoveCard).toHaveBeenCalledWith({ cardId: 'card-a', x: 50, y: 50 }));
  });

  test('коли купка видима (реальна нерозкладена картка), картки канви рендеряться вище (стиснуто по Y)', async () => {
    const props = baseProps({
      cards: [
        { cardId: 'card-a', cardTitle: 'Картка A', x: 20, y: 30, healthState: null },
        { cardId: 'card-b', cardTitle: 'Картка B', x: 60, y: 70, healthState: null },
        { cardId: 'card-tray', cardTitle: 'У треї', x: null, y: null, healthState: null },
      ],
    });
    render(<LayoutBoard {...props} />);

    await screen.findByTestId('unassigned-tray');
    const cardB = screen.getByTestId('card-card-b');
    // free = 1 - 40/210 = 170/210 -- top стиснуто МЕНШЕ за сирі 70%, картка
    // не ховається за трей (TRAY_RECT top=170 з 210 -- 80.95% канви).
    const top = Number(cardB.parentElement?.style.top?.replace('%', ''));
    expect(top).toBeLessThan(70);
    expect(top).toBeCloseTo(56.67, 1);
  });
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
        { cardId: 'card-a', cardTitle: 'Картка A', x: 20, y: 30, healthState: null },
        { cardId: 'card-tray', cardTitle: 'У треї', x: null, y: null, healthState: null },
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

// --- AC-12, CH-05/CH-06: вхід в "Архівування" прямо зі Схеми -----------------

function archiveCapability(overrides: Record<string, unknown> = {}) {
  return {
    loadCloseCardOptions: vi.fn().mockResolvedValue({
      metricBlocks: [{ metricBlockId: 'mb-1', label: 'книги' }],
      targetCards: [{ cardId: 'card-b', cardTitle: 'Картка B' }],
    }),
    onArchiveCard: vi.fn().mockResolvedValue(undefined),
    onTransferMetricBlock: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

test('AC-12: без інжектованої можливості архівації кнопки "Архівувати" немає', async () => {
  const props = baseProps();
  render(<LayoutBoard {...props} />);

  await screen.findByTestId('canvas');
  expect(screen.queryByRole('button', { name: /Архівувати/ })).toBeNull();
});

test('AC-12: кожна картка має власну дію "Архівувати", клік відкриває "Архівування" саме цієї картки', async () => {
  const props = { ...baseProps(), ...archiveCapability() };
  render(<LayoutBoard {...props} />);

  const openA = await screen.findByRole('button', { name: 'Архівувати «Картка A»' });
  expect(screen.getByRole('button', { name: 'Архівувати «Картка B»' })).toBeTruthy();

  fireEvent.click(openA);

  expect(props.loadCloseCardOptions).toHaveBeenCalledWith('card-a');

  const dialog = await screen.findByRole('dialog');
  // CH-06 п.1: заголовок сторінки -- "Архівування", не "Закрити «Назва»".
  expect(dialog.textContent).toContain('Архівування');
  expect(dialog.textContent).toContain('Картка A');
  expect(await screen.findByText('книги')).toBeTruthy();
});

test('AC-12: клік на "Архівувати" не запускає драг картки (stopPropagation)', async () => {
  const props = { ...baseProps(), ...archiveCapability() };
  render(<LayoutBoard {...props} />);

  const archiveButton = await screen.findByRole('button', { name: 'Архівувати «Картка A»' });
  firePointer(archiveButton, 'pointerdown', 60, 63);

  // pointerdown на кнопці не мусить стартувати драг батьківського чипа --
  // жодного onMoveCard навіть після pointerup деінде.
  firePointer(window, 'pointerup', 200, 150);
  expect(props.onMoveCard).not.toHaveBeenCalled();
});

test('CH-05/CH-06: чекбокс + вибір цільової картки + "Перенести" переносять метрику ОДРАЗУ (без чекання архівації)', async () => {
  const props = { ...baseProps(), ...archiveCapability() };
  render(<LayoutBoard {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Архівувати «Картка A»' }));
  await screen.findByText('книги');

  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'card-b' } });
  fireEvent.click(screen.getByRole('button', { name: 'Перенести' }));

  await waitFor(() =>
    expect(props.onTransferMetricBlock).toHaveBeenCalledWith('card-a', 'mb-1', 'card-b'),
  );
  // Архівація ЩЕ не викликана -- перенесення й архівація тепер дві незалежні дії.
  expect(props.onArchiveCard).not.toHaveBeenCalled();
});

test('CH-05: "Архівувати без перенесення" викликає ТОЙ САМИЙ injected archiveCard з cardId цієї картки', async () => {
  const props = { ...baseProps(), ...archiveCapability() };
  render(<LayoutBoard {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Архівувати «Картка A»' }));
  await screen.findByText('книги');

  fireEvent.click(screen.getByRole('button', { name: 'Архівувати без перенесення' }));

  await waitFor(() => expect(props.onArchiveCard).toHaveBeenCalledWith('card-a'));
});

test('AC-12: після успішної архівації діалог зникає, а розкладка перечитується з сервера', async () => {
  const loadLayout = vi
    .fn()
    .mockResolvedValueOnce(baseState())
    .mockResolvedValueOnce(baseState({ cards: [{ cardId: 'card-b', cardTitle: 'Картка B', x: 60, y: 70, healthState: null }] }));
  const props = {
    loadLayout,
    onMoveCard: vi.fn().mockResolvedValue(undefined),
    onCreateConnection: vi.fn().mockResolvedValue(undefined),
    onDeleteConnection: vi.fn().mockResolvedValue(undefined),
    onSaveLayoutMode: vi.fn().mockResolvedValue(undefined),
    onOpenArchive: vi.fn(),
    ...archiveCapability(),
  };
  render(<LayoutBoard {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Архівувати «Картка A»' }));
  await screen.findByText('книги');
  fireEvent.click(screen.getByRole('button', { name: 'Архівувати без перенесення' }));

  await waitFor(() => expect(loadLayout).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByTestId('card-card-a')).toBeNull();
});

test('AC-12: "Скасувати" закриває діалог і нічого не надсилає', async () => {
  const props = { ...baseProps(), ...archiveCapability() };
  render(<LayoutBoard {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Архівувати «Картка A»' }));
  await screen.findByText('книги');
  fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(props.onArchiveCard).not.toHaveBeenCalled();
  expect(props.loadLayout).toHaveBeenCalledTimes(1);
});

test('AC-12 + купка нерозкладених: картку звідти теж можна архівувати', async () => {
  const props = {
    ...baseProps({
      cards: [{ cardId: 'card-a', cardTitle: 'Картка A', x: null, y: null, healthState: null }],
    }),
    ...archiveCapability(),
  };
  render(<LayoutBoard {...props} />);

  const tray = await screen.findByTestId('unassigned-tray');
  const openA = screen.getByRole('button', { name: 'Архівувати «Картка A»' });
  expect(tray.contains(openA)).toBe(true);

  fireEvent.click(openA);
  expect(props.loadCloseCardOptions).toHaveBeenCalledWith('card-a');
});

// --- CH-01 (docs/features/structure/changes.md): "Архів карток" -------------

test('CH-01: кнопка "Архів карток" видима поруч із "Конфігурація" й викликає injected onOpenArchive', async () => {
  const props = baseProps();
  render(<LayoutBoard {...props} />);

  await screen.findByTestId('canvas');
  expect(screen.getByRole('button', { name: 'Конфігурація' })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Архів карток' }));

  expect(props.onOpenArchive).toHaveBeenCalledTimes(1);
});

// --- Живе тестування: "Конфігурація" -- пікер режиму розкладки (D-131) -------

test('живе тестування: плаваюча кнопка "Конфігурація" знизу по центру перемикає на пікер 5 режимів', async () => {
  const props = baseProps({ layoutMode: 'free', cards: [{ cardId: 'card-a', cardTitle: 'Картка A', x: null, y: null, healthState: null }] });
  render(<LayoutBoard {...props} />);

  await screen.findByTestId('unassigned-tray');
  fireEvent.click(screen.getByRole('button', { name: 'Конфігурація' }));

  for (const label of ['Баланс навколо ядра', 'Фокус і спостереження', 'Причина і наслідок', 'Вільна розкладка', 'Готово до розкладання']) {
    expect(screen.getByRole('radio', { name: label })).toBeTruthy();
  }
  expect((screen.getByRole('radio', { name: 'Вільна розкладка' }) as HTMLInputElement).checked).toBe(true);
});

// CH-03 (частина 1, docs/features/structure/changes.md): "На зад" на CONFIG.

test('CH-03: "На зад" на CONFIG видима зліва від "Зберегти" й повертає на BOARD без збереження', async () => {
  const props = baseProps({ layoutMode: 'free' });
  render(<LayoutBoard {...props} />);

  await screen.findByTestId('canvas');
  fireEvent.click(screen.getByRole('button', { name: 'Конфігурація' }));

  fireEvent.click(await screen.findByRole('radio', { name: 'Баланс навколо ядра' }));
  fireEvent.click(screen.getByRole('button', { name: 'На зад' }));

  expect(screen.queryByRole('radio', { name: 'Баланс навколо ядра' })).toBeNull();
  expect(props.onSaveLayoutMode).not.toHaveBeenCalled();
});

test('AC-11: обрання нового layoutMode без уже розкладених карток застосовує його одразу, без ConfirmDialog, і повертає на BOARD', async () => {
  const props = baseProps({
    layoutMode: 'free',
    cards: [
      { cardId: 'card-a', cardTitle: 'Картка A', x: null, y: null, healthState: null },
      { cardId: 'card-b', cardTitle: 'Картка B', x: null, y: null, healthState: null },
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
      { cardId: 'card-a', cardTitle: 'Картка A', x: null, y: null, healthState: null },
      { cardId: 'card-b', cardTitle: 'Картка B', x: null, y: null, healthState: null },
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
    cards: [{ cardId: 'card-a', cardTitle: 'Картка A', x: null, y: null, healthState: null }],
  });
  render(<LayoutBoard {...props} />);

  await screen.findByTestId('unassigned-tray');
  expect(screen.queryByText(/готово до розкладання/i)).toBeNull();
});

// CH-10 (docs/features/structure/changes.md): перемикання конфігурації на
// "Готово до розкладання" переносить усі картки з канви в трей.

test('CH-10: перемикання на "Готово до розкладання" з уже розкладеними картками переносить їх усі в трей', async () => {
  const props = baseProps({ layoutMode: 'free' }); // baseState -- обидві картки з x/y.
  render(<LayoutBoard {...props} />);

  await screen.findByTestId('canvas');
  fireEvent.click(screen.getByRole('button', { name: 'Конфігурація' }));
  fireEvent.click(await screen.findByRole('radio', { name: 'Готово до розкладання' }));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  // hasArrangedCards -- ConfirmDialog з'являється першим (AC-11b).
  fireEvent.click(await screen.findByRole('button', { name: 'Змінити' }));

  await waitFor(() => expect(props.onSaveLayoutMode).toHaveBeenCalledWith({ layoutMode: 'staging' }));

  const tray = await screen.findByTestId('unassigned-tray');
  await waitFor(() => {
    expect(tray.contains(screen.getByTestId('card-card-a'))).toBe(true);
    expect(tray.contains(screen.getByTestId('card-card-b'))).toBe(true);
  });
  // Канва порожня -- жодна картка не позиціонована style left/top.
  expect(screen.getByTestId('card-card-a').style.left).toBe('');
  expect(screen.getByTestId('card-card-b').style.left).toBe('');
});

// code-review 2026-09-21 (correctness): перемикання ПІСЛЯ staging на
// будь-який РЕАЛЬНИЙ режим мусить очистити клієнтську позначку
// "невизначено" -- інакше картки, щойно розкладені сервером наново
// (справжній x/y), і далі рахувались би застряглими в треї.
test('CH-10 review-fix: перемикання зі staging на реальний режим повертає картки на канву, не лишає їх у треї', async () => {
  const loadLayout = vi
    .fn()
    .mockResolvedValueOnce(baseState({ layoutMode: 'free' })) // початкове завантаження
    .mockResolvedValueOnce(baseState({ layoutMode: 'staging' })) // після переходу в staging (сервер x/y не міняє)
    .mockResolvedValueOnce(
      baseState({
        layoutMode: 'balance',
        cards: [
          { cardId: 'card-a', cardTitle: 'Картка A', x: 15, y: 25, healthState: null },
          { cardId: 'card-b', cardTitle: 'Картка B', x: 55, y: 65, healthState: null },
        ],
      }),
    ); // після переходу в balance -- сервер дав СПРАВЖНІ нові позиції
  const props = { ...baseProps(), loadLayout };
  render(<LayoutBoard {...props} />);

  await screen.findByTestId('canvas');
  fireEvent.click(screen.getByRole('button', { name: 'Конфігурація' }));
  fireEvent.click(await screen.findByRole('radio', { name: 'Готово до розкладання' }));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Змінити' }));

  const tray = await screen.findByTestId('unassigned-tray');
  await waitFor(() => expect(tray.contains(screen.getByTestId('card-card-a'))).toBe(true));

  fireEvent.click(screen.getByRole('button', { name: 'Конфігурація' }));
  fireEvent.click(await screen.findByRole('radio', { name: 'Баланс навколо ядра' }));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Змінити' }));

  await waitFor(() => expect(loadLayout).toHaveBeenCalledTimes(3));
  // Трей більше НЕ рендериться взагалі -- жодної нерозкладеної картки й
  // жодного активного драгу (showTray === false), тож `queryByTestId` тут
  // -- сам факт відсутності контейнера трею, найпряміший доказ, що обидві
  // картки повернулись на канву.
  await waitFor(() => expect(screen.queryByTestId('unassigned-tray')).toBeNull());
  expect(screen.getByTestId('card-card-a')).toBeTruthy();
  expect(screen.getByTestId('card-card-b')).toBeTruthy();
});

// CH-02 (docs/features/structure/changes.md, скоординовано з life-area-card
// CH-02): м'ячик стану на чипі картки -- власний канал (loadLayout), не
// перевикористання UI картки.

test('CH-02: картка без healthState не показує жодного м\'ячика', async () => {
  const props = baseProps({
    cards: [{ cardId: 'card-a', cardTitle: 'Картка A', x: 20, y: 30, healthState: null }],
  });
  render(<LayoutBoard {...props} />);

  await screen.findByTestId('card-card-a');
  expect(screen.queryByLabelText(/Стан картки/)).toBeNull();
});

test('CH-02: картка з healthState показує м\'ячик стану на чипі', async () => {
  const props = baseProps({
    cards: [{ cardId: 'card-a', cardTitle: 'Картка A', x: 20, y: 30, healthState: 'critical' }],
  });
  render(<LayoutBoard {...props} />);

  expect(await screen.findByLabelText('Стан картки: критично потребує відновлення')).toBeTruthy();
});
