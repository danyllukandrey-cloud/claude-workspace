// Composition root (main.tsx) -- ЄДИНЕ місце, де народжуються справжні
// fetch-реалізації DI-пропів (loadLayout/loadAnalytics/onSaveDeclaration...).
// До цього файлу main.tsx не був покритий жодним тестом, і саме тут жили дві
// знахідки рев'ю 2026-09-11 (Частина 3), через які екрани Структури показували
// заглушки замість даних:
//
// 1. (історично) `justReset: false` хардкодом -- банер "Розклади заново"
//    не показувався НІКОЛИ. D-131-наступне рішення (Андрій, чат,
//    2026-09-15) прибрало саме поняття "скидання в трей" повністю -- зміна
//    layoutMode тепер запускає РЕАЛЬНИЙ авто-розклад (сервер сам рахує
//    x/y), тож LayoutBoardState більше не несе `justReset` взагалі.
// 2. `gap: null, trend: null, unmaintained: false, trendAvailable: false`
//    хардкодом -- AC-06/AC-06b/AC-07 на екрані мертві, а банер "тренд
//    недоступний" висів для всіх користувачів завжди.
//
// Вимоги 14/15 (Андрій, чат, плоска модель): layoutMode -- ОДНЕ поле з 5
// значень ('balance'/'focus'/'cause_effect'/'free'/'staging'); logicVariant
// прибраний з фейкового сервера й тіл PATCH нижче разом з ним.
//
// D-131-наступне рішення: cellIndex прибраний -- позиція картки {x, y}
// (відсоток канви 0-100). aggregate.ts's ранг-розрив формула (AC-06/AC-07)
// не змінена (D-19) -- x грає РІВНО ту саму роль, що cellIndex грав
// (менше число = вищий пріоритет), тож нижче тести й далі використовують
// прості цілі 0/1/2 для x, лише щоб математика лишалась легкою для ока.
//
// Як тестуємо: App підмінений (vi.mock) компонентом, що лише ЗАПАМ'ЯТОВУЄ
// передані пропи -- далі тест викликає самі ці функції з підробленим fetch.
// Тобто перевіряється не "проп переданий", а реальне число, яке дійде до
// екрана. Імпорт main.tsx виконує createRoot -- тому в DOM є #root, а рендер
// обгорнутий в act().

import { act } from '@testing-library/react';
import type { AppProps } from './App';

let captured: AppProps | null = null;

vi.mock('./App', () => ({
  App: (props: AppProps) => {
    captured = props;
    return null;
  },
}));

// --- підроблений сервер ------------------------------------------------------

interface FakePosition {
  cardId: string;
  x: number | null;
  y?: number | null;
  positionUpdatedAt?: string;
}

interface FakeConnection {
  id: string;
  cardIdA: string;
  cardIdB: string;
  directed: boolean;
}

interface FakeServer {
  structure: { layoutMode: string | null };
  positions: FakePosition[];
  connections: FakeConnection[];
  cards: { id: string; name: string }[];
  progressByCard: Record<string, number | null>;
  /** 'fail' -- GET /structure/layout/history відповів помилкою (trendAvailable=false). */
  history: FakePosition[] | 'fail';
  metricBlocksByCard: Record<string, { id: string }[]>;
  entryCountByCard: Record<string, number>;
  patchBodies: unknown[];
  historyAsOf: string[];
  closeCalls: { cardId: string; body: unknown }[];
  /** POST .../close відповідає 409 metric_block.name_collision (life-area-card AC-15). */
  closeNameCollision?: boolean;
  /** T11 (life-plan-levels): пункти ПЛАНу, які віддає GET /plan-items (сторінками по `planPageSize`). */
  planItems: FakePlanItem[];
  /** Скільки пунктів вміщає одна сторінка -- щоб перевірити, що клієнт іде по курсору до кінця. */
  planPageSize: number;
  /** Кожен запит до /plan-items -- метод, шлях, тіло, Idempotency-Key. */
  planCalls: { method: string; url: string; body: unknown; idempotencyKey: string | null }[];
}

interface FakePlanItem {
  id: string;
  horizon: 'tactical' | 'operational' | 'strategic';
  planText: string;
  done: boolean;
  createdAt: string;
}

function makeServer(overrides: Partial<FakeServer> = {}): FakeServer {
  return {
    structure: { layoutMode: 'focus' },
    positions: [],
    connections: [],
    cards: [],
    progressByCard: {},
    history: [],
    metricBlocksByCard: {},
    entryCountByCard: {},
    patchBodies: [],
    historyAsOf: [],
    closeCalls: [],
    planItems: [],
    planPageSize: 50,
    planCalls: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function positionDto(position: FakePosition) {
  return {
    cardId: position.cardId,
    x: position.x,
    y: position.y ?? position.x,
    status: 'active',
    positionUpdatedAt: position.positionUpdatedAt ?? '2026-09-01T00:00:00.000Z',
  };
}

function fakeFetch(server: FakeServer): typeof fetch {
  return (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const structureDto = {
      id: 'structure-1',
      declaration: 'декларація',
      layoutMode: server.structure.layoutMode,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };

    // T11 (life-plan-levels): чотири ендпоінти ПЛАНу. Стоять ПЕРЕД гілками
    // Структури/Карток лише тому, що шлях інший -- жодного перетину префіксів.
    if (url.startsWith('/api/v1/plan-items')) {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      server.planCalls.push({
        method,
        url,
        body: init?.body === undefined ? null : JSON.parse(String(init.body)),
        idempotencyKey: headers['Idempotency-Key'] ?? null,
      });

      const oneItem = url.match(/^\/api\/v1\/plan-items\/([^/?]+)$/);
      if (oneItem && method === 'PATCH') {
        return jsonResponse(server.planItems.find((item) => item.id === oneItem[1]) ?? null);
      }
      if (oneItem && method === 'DELETE') {
        server.planItems = server.planItems.filter((item) => item.id !== oneItem[1]);
        return jsonResponse(null, 204);
      }
      if (method === 'POST') {
        return jsonResponse({ ...(server.planItems[0] ?? {}), id: 'plan-item-new' }, 201);
      }

      // GET -- сторінка за курсором `after` (id останнього побаченого пункту).
      const after = new URL(url, 'http://localhost').searchParams.get('after');
      const startIndex = after ? server.planItems.findIndex((item) => item.id === after) + 1 : 0;
      const page = server.planItems.slice(startIndex, startIndex + server.planPageSize);
      const hasNext = startIndex + server.planPageSize < server.planItems.length;
      return jsonResponse({
        items: page,
        has_next: hasNext,
        has_prev: startIndex > 0,
        next_cursor: hasNext ? page[page.length - 1].id : null,
      });
    }

    if (url.startsWith('/api/v1/structure/layout/history')) {
      const asOf = new URL(url, 'http://localhost').searchParams.get('asOf');
      if (asOf) server.historyAsOf.push(asOf);
      if (server.history === 'fail') {
        return jsonResponse({ code: 'structure.request_failed', message: 'історія недоступна' }, 500);
      }
      return jsonResponse({
        items: server.history.map(positionDto),
        has_next: false,
        has_prev: false,
        next_cursor: null,
      });
    }

    const closeCard = url.match(/^\/api\/v1\/structure\/layout\/([^/?]+)\/close$/);
    if (closeCard) {
      server.closeCalls.push({ cardId: closeCard[1], body: JSON.parse(String(init?.body ?? 'null')) });
      if (server.closeNameCollision) {
        return jsonResponse(
          { code: 'metric_block.name_collision', message: 'У картці-призначенні вже є блок із такою назвою' },
          409,
        );
      }
      return jsonResponse(positionDto({ cardId: closeCard[1], x: null }));
    }

    if (url === '/api/v1/structure/connections' && method === 'GET') {
      return jsonResponse(
        server.connections.map((c) => ({ ...c, createdAt: '2026-09-01T00:00:00.000Z' })),
      );
    }

    if (url === '/api/v1/structure/connections' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { cardIdA: string; cardIdB: string; directed: boolean };
      const created = { id: `connection-${server.connections.length + 1}`, ...body };
      server.connections.push(created);
      return jsonResponse({ ...created, createdAt: '2026-09-01T00:00:00.000Z' }, 201);
    }

    const deleteConnection = url.match(/^\/api\/v1\/structure\/connections\/([^/?]+)$/);
    if (deleteConnection && method === 'DELETE') {
      server.connections = server.connections.filter((c) => c.id !== deleteConnection[1]);
      return jsonResponse(null, 204);
    }

    const moveCard = url.match(/^\/api\/v1\/structure\/layout\/([^/?]+)$/);
    if (moveCard && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as { x: number; y: number; positionUpdatedAt: string };
      const existing = server.positions.find((p) => p.cardId === moveCard[1]);
      const updated: FakePosition = { cardId: moveCard[1], x: body.x, y: body.y, positionUpdatedAt: body.positionUpdatedAt };
      if (existing) {
        Object.assign(existing, updated);
      } else {
        server.positions.push(updated);
      }
      return jsonResponse(positionDto(updated));
    }

    if (url.startsWith('/api/v1/structure/layout')) {
      return jsonResponse({
        items: server.positions.map(positionDto),
        has_next: false,
        has_prev: false,
        next_cursor: null,
      });
    }

    if (url === '/api/v1/structure') {
      if (method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as { layoutMode?: string | null };
        server.patchBodies.push(body);
        if (body.layoutMode !== undefined) server.structure.layoutMode = body.layoutMode;
        return jsonResponse(structureDto);
      }
      return jsonResponse(structureDto);
    }

    const metricBlocks = url.match(/^\/api\/v1\/cards\/([^/?]+)\/metric-blocks/);
    if (metricBlocks) {
      return jsonResponse(
        (server.metricBlocksByCard[metricBlocks[1]] ?? []).map((block) => ({
          id: block.id,
          cardId: metricBlocks[1],
          label: 'мітка',
          unit: 'раз',
          frequency: null,
          targetCount: null,
          isOngoing: true,
          targetDate: null,
        })),
      );
    }

    const entries = url.match(/^\/api\/v1\/cards\/([^/?]+)\/entries/);
    if (entries) {
      const count = server.entryCountByCard[entries[1]] ?? 0;
      return jsonResponse({
        items: Array.from({ length: count }, (_, index) => ({
          id: `entry-${index}`,
          metricBlockId: 'mb',
          cardId: entries[1],
          amount: 1,
          status: 'confirmed',
          recordedAt: '2026-09-01T00:00:00.000Z',
        })),
        next_cursor: null,
      });
    }

    if (url.startsWith('/api/v1/cards/')) {
      const cardId = url.slice('/api/v1/cards/'.length).split('?')[0];
      return jsonResponse({
        id: cardId,
        name: server.cards.find((card) => card.id === cardId)?.name ?? cardId,
        description: null,
        aggregateProgress: server.progressByCard[cardId] ?? null,
        dataWarning: null,
      });
    }

    if (url.startsWith('/api/v1/cards')) {
      return jsonResponse({ items: server.cards, has_next: false, has_prev: false, next_cursor: null });
    }

    throw new Error(`Непередбачений запит у тесті: ${method} ${url}`);
  }) as unknown as typeof fetch;
}

/** Перезавантажує main.tsx із чистого стану й віддає пропи, які він передав у App. */
async function loadMain(server: FakeServer): Promise<AppProps> {
  captured = null;
  vi.resetModules();
  vi.stubGlobal('fetch', fakeFetch(server));
  document.body.innerHTML = '<div id="root"></div>';
  // payload = {"sub":"user-42"} -- currentOwnerUserId() декодує саме його.
  localStorage.setItem(
    'plan.jwt',
    JSON.stringify({ token: 'h.eyJzdWIiOiJ1c2VyLTQyIn0.s', expiresAt: '2099-01-01T00:00:00.000Z' }),
  );

  await act(async () => {
    await import('./main');
  });

  if (captured === null) throw new Error('main.tsx не передав пропи в App');
  return captured;
}

/**
 * Ті самі fetch-реалізації, але взяті як експорти модуля -- для AC-12 вони поки
 * НЕ доходять до App (AppProps не має під них полів, App.tsx поза скоупом цього
 * фіксу), тож перевіряємо їх напряму, а не через пропи.
 */
async function loadMainExports(server: FakeServer): Promise<typeof import('./main')> {
  await loadMain(server);
  return import('./main');
}

// --- D-131-наступне рішення: loadLayout/onMoveCard/connections на вільному полотні ---

test('loadLayout читає /structure + /structure/layout + /structure/connections + /cards і збирає {layoutMode, cards, connections}', async () => {
  const server = makeServer({
    structure: { layoutMode: 'focus' },
    cards: [{ id: 'card-a', name: 'Картка A' }, { id: 'card-b', name: 'Картка B' }],
    positions: [{ cardId: 'card-a', x: 20, y: 30 }],
    connections: [{ id: 'conn-1', cardIdA: 'card-a', cardIdB: 'card-b', directed: true }],
  });
  const props = await loadMain(server);

  const layout = await props.loadLayout();

  expect(layout.layoutMode).toBe('focus');
  expect(layout.cards).toEqual([
    { cardId: 'card-a', cardTitle: 'Картка A', x: 20, y: 30, healthState: null },
    { cardId: 'card-b', cardTitle: 'Картка B', x: null, y: null, healthState: null },
  ]);
  expect(layout.connections).toEqual([{ id: 'conn-1', cardIdA: 'card-a', cardIdB: 'card-b', directed: true }]);
});

test('onMoveCard надсилає PUT /structure/layout/{cardId} з x/y і positionUpdatedAt', async () => {
  const server = makeServer({ cards: [{ id: 'card-a', name: 'Картка A' }] });
  const props = await loadMain(server);

  await props.onMoveCard({ cardId: 'card-a', x: 65, y: 80 });

  expect(server.positions).toEqual([expect.objectContaining({ cardId: 'card-a', x: 65, y: 80 })]);
});

test('onCreateConnection надсилає POST /structure/connections із cardIdA/cardIdB/directed', async () => {
  const server = makeServer({ cards: [{ id: 'card-a', name: 'A' }, { id: 'card-b', name: 'B' }] });
  const props = await loadMain(server);

  await props.onCreateConnection({ cardIdA: 'card-a', cardIdB: 'card-b', directed: true });

  expect(server.connections).toEqual([{ id: 'connection-1', cardIdA: 'card-a', cardIdB: 'card-b', directed: true }]);
});

test('onDeleteConnection надсилає DELETE /structure/connections/{connectionId}', async () => {
  const server = makeServer({
    connections: [{ id: 'conn-1', cardIdA: 'card-a', cardIdB: 'card-b', directed: false }],
  });
  const props = await loadMain(server);

  await props.onDeleteConnection({ connectionId: 'conn-1' });

  expect(server.connections).toEqual([]);
});

// Живе тестування (Андрій): "Налаштування розкладки схеми переносимо в
// сторінку схеми" -- `hasArrangedCards` більше не поле DeclarationScreenState
// (loadStructure тепер несе лише `declaration`) -- LayoutBoard рахує його
// напряму з `cards`, що вже приходять через loadLayout (перевірено в
// LayoutBoard.test.tsx, не тут).
test('loadStructure несе лише declaration -- жодного зайвого запиту /structure/layout для нього', async () => {
  const server = makeServer({
    structure: { layoutMode: 'focus' },
    cards: [{ id: 'card-a', name: 'Картка A' }],
    positions: [{ cardId: 'card-a', x: null }],
  });
  const props = await loadMain(server);

  const state = await props.loadStructure();
  expect(state).toEqual({ declaration: 'декларація' });
});

test('onSaveDeclaration лише з declaration (без ключа layoutMode) не несе layoutMode у тілі PATCH', async () => {
  const server = makeServer({
    structure: { layoutMode: 'focus' },
    cards: [{ id: 'card-a', name: 'Картка A' }],
    positions: [{ cardId: 'card-a', x: 0 }],
  });
  const props = await loadMain(server);

  await props.onSaveDeclaration({ declaration: 'лише текст' });

  // Тіло PATCH не несе layoutMode ВЗАГАЛІ (не лише не змінює його) --
  // JSON.stringify сам відкидає ключ зі значенням undefined.
  expect(server.patchBodies).toEqual([{ declaration: 'лише текст' }]);
});

test('onSaveDeclaration лише з layoutMode (LayoutBoard.onSaveLayoutMode) не несе declaration', async () => {
  const server = makeServer({
    structure: { layoutMode: 'free' },
    cards: [{ id: 'card-a', name: 'Картка A' }],
    positions: [{ cardId: 'card-a', x: null }],
  });
  const props = await loadMain(server);

  await props.onSaveDeclaration({ layoutMode: 'focus' });

  expect(server.patchBodies).toEqual([{ layoutMode: 'focus' }]);
  expect(server.structure.layoutMode).toBe('focus');
});

// --- AC-06 / AC-06b / AC-07: аналітика рахується, а не заглушена -------------

test('AC-06: у розкладці "за логікою" кожна розкладена картка отримує реальний ранг-розрив', async () => {
  const server = makeServer({
    structure: { layoutMode: 'focus' },
    cards: [
      { id: 'card-a', name: 'Картка A' },
      { id: 'card-b', name: 'Картка B' },
      { id: 'card-c', name: 'Картка C' },
    ],
    // Сітка: максимальна клітинка 2 -> rank(0)=1, rank(2)=0.
    positions: [
      { cardId: 'card-a', x: 0 },
      { cardId: 'card-b', x: 2 },
    ],
    progressByCard: { 'card-a': 0.4, 'card-b': 0.5, 'card-c': 0.9 },
  });
  const props = await loadMain(server);

  const analytics = await props.loadAnalytics();
  const byId = new Map(analytics.cards.map((card) => [card.cardId, card]));

  expect(byId.get('card-a')?.gap).toBeCloseTo(0.6, 10); // 1 - 0.4
  expect(byId.get('card-b')?.gap).toBeCloseTo(-0.5, 10); // 0 - 0.5
  // Картка без клітинки (не в розкладці) розриву не отримує -- клітинка 0 була б
  // найвищим пріоритетом, тобто заявою, якої користувач не робив.
  expect(byId.get('card-c')?.gap).toBeNull();
  // Розрив завжди в межах -1..1 (нормалізація по сітці, не по кількості карток).
  for (const card of analytics.cards) {
    if (card.gap !== null) expect(Math.abs(card.gap)).toBeLessThanOrEqual(1);
  }
});

test('AC-07: минула розкладка з /structure/layout/history дає напрямок тренду', async () => {
  const server = makeServer({
    structure: { layoutMode: 'focus' },
    cards: [{ id: 'card-a', name: 'Картка A' }],
    positions: [{ cardId: 'card-a', x: 0 }],
    progressByCard: { 'card-a': 0.4 },
    // Була в останній клітинці сітки (ранг 0): розрив 0-0.4 = -0.4, модуль 0.4.
    // Зараз клітинка 0 (ранг 1): розрив 0.6 -- модуль зріс, отже 'росте'.
    history: [{ cardId: 'card-a', x: 2, positionUpdatedAt: '2026-08-01T00:00:00.000Z' }],
  });
  const props = await loadMain(server);

  const analytics = await props.loadAnalytics();

  expect(analytics.trendAvailable).toBe(true);
  expect(analytics.cards[0].trend).toBe('growing');
  // Контрольна точка справді в минулому -- інакше сервер відповів би
  // 422 structure.invalid_as_of.
  expect(server.historyAsOf).toHaveLength(1);
  expect(new Date(server.historyAsOf[0]).getTime()).toBeLessThan(Date.now());
});

test('AC-07: історія не відповіла -- trendAvailable=false, але розрив усе одно порахований', async () => {
  const server = makeServer({
    structure: { layoutMode: 'focus' },
    cards: [{ id: 'card-a', name: 'Картка A' }],
    positions: [{ cardId: 'card-a', x: 0 }],
    progressByCard: { 'card-a': 0.4 },
    history: 'fail',
  });
  const props = await loadMain(server);

  const analytics = await props.loadAnalytics();

  expect(analytics.trendAvailable).toBe(false);
  expect(analytics.cards[0].trend).toBeNull();
  // Збій ОДНОГО запиту не має гасити решту екрана.
  expect(analytics.cards[0].gap).toBeCloseTo(0.6, 10);
});

test('AC-06b: у розкладці без схеми пріоритету розриву немає, зате видно "заявлено -- не ведеться"', async () => {
  const server = makeServer({
    structure: { layoutMode: 'free' },
    cards: [
      { id: 'card-a', name: 'Картка A' },
      { id: 'card-b', name: 'Картка B' },
      { id: 'card-c', name: 'Картка C' },
    ],
    positions: [
      { cardId: 'card-a', x: 0 },
      { cardId: 'card-b', x: 1 },
      { cardId: 'card-c', x: 2 },
    ],
    progressByCard: { 'card-a': 0.5, 'card-b': 0.5, 'card-c': null },
    metricBlocksByCard: { 'card-a': [{ id: 'mb-1' }], 'card-b': [{ id: 'mb-2' }], 'card-c': [] },
    entryCountByCard: { 'card-a': 0, 'card-b': 3, 'card-c': 0 },
  });
  const props = await loadMain(server);

  const analytics = await props.loadAnalytics();
  const byId = new Map(analytics.cards.map((card) => [card.cardId, card]));

  // Метрика є, записів нуль -> "заявлено важливим, не підтримується".
  expect(byId.get('card-a')?.unmaintained).toBe(true);
  // Записи є -> жодного прапорця.
  expect(byId.get('card-b')?.unmaintained).toBe(false);
  // Метрики взагалі немає -> це не "не ведеться", це просто декларативна картка.
  expect(byId.get('card-c')?.unmaintained).toBe(false);
  // Ранг-розрив у розкладці без схеми не показується НІКОМУ (AC-06b).
  for (const card of analytics.cards) expect(card.gap).toBeNull();
});

// --- AC-12: транспорт для "Архівування" (CH-05/CH-06) -------------------------
//
// CH-05 прибрала структуроспецифічний POST /structure/layout/{cardId}/close
// (onCloseCard, main.tsx) повністю -- архівація тепер іде через ТОЙ САМИЙ
// archiveCard/onTransferMetricBlock, що вже покриті тестами нижче для колоди
// (ISS-56 "реальний DELETE /cards/{cardId}"/CH-03 "реальний POST
// .../metric-blocks/transfer"). loadCloseCardOptions (GET .../metric-blocks,
// не структуроспецифічний) лишається без змін.

test('AC-12: loadCloseCardOptions віддає метрики картки, що архівується, і решту карток як цілі переносу', async () => {
  const server = makeServer({
    cards: [
      { id: 'card-a', name: 'Навчання (дубль)' },
      { id: 'card-b', name: 'Навчання' },
      { id: 'card-c', name: 'Спорт' },
    ],
    metricBlocksByCard: { 'card-a': [{ id: 'mb-1' }, { id: 'mb-2' }] },
  });
  const main = await loadMainExports(server);

  const options = await main.loadCloseCardOptions('card-a');

  expect(options.metricBlocks.map((block) => block.metricBlockId)).toEqual(['mb-1', 'mb-2']);
  // Сама картка, що архівується, не може бути ціллю власного переносу.
  expect(options.targetCards.map((card) => card.cardId)).toEqual(['card-b', 'card-c']);
});

// --- T11 (life-plan-levels): чотири реальні виклики /api/v1/plan-items -------
//
// Перевіряємо не "проп переданий", а що саме долетить до сервера й що
// повернеться на екран -- той самий підхід, що в тестах Структури вище.

const PLAN_ITEM: FakePlanItem = {
  id: 'plan-item-1',
  horizon: 'tactical',
  planText: 'Пробігти півмарафон',
  done: false,
  createdAt: '2026-09-15T09:00:00.000Z',
};

test('T11: loadPlanItems збирає ВСІ сторінки /plan-items за курсором, не лише першу', async () => {
  const server = makeServer({
    planPageSize: 2,
    planItems: [
      PLAN_ITEM,
      { ...PLAN_ITEM, id: 'plan-item-2', planText: 'Вивчити іспанську' },
      { ...PLAN_ITEM, id: 'plan-item-3', horizon: 'strategic', planText: 'Побудувати дім' },
    ],
  });

  const props = await loadMain(server);
  const items = await props.loadPlanItems();

  // Без слідування за next_cursor третій пункт тихо зник би з екрана.
  expect(items.map((item) => item.id)).toEqual(['plan-item-1', 'plan-item-2', 'plan-item-3']);
  expect(server.planCalls.filter((call) => call.method === 'GET')).toHaveLength(2);
  expect(server.planCalls[1].url).toContain('after=plan-item-2');
});

test('T11: onCreatePlanItem надсилає POST /plan-items з horizon/planText і свіжим Idempotency-Key на кожне збереження', async () => {
  const server = makeServer();
  const props = await loadMain(server);

  await props.onCreatePlanItem({ horizon: 'operational', planText: 'Змінити професію' });
  await props.onCreatePlanItem({ horizon: 'operational', planText: 'Переїхати' });

  const posts = server.planCalls.filter((call) => call.method === 'POST');
  expect(posts[0].body).toEqual({ horizon: 'operational', planText: 'Змінити професію' });
  // Ключ обов'язковий за контрактом -- і він РІЗНИЙ для двох різних намірів
  // користувача (інакше друге збереження повернуло б перший пункт).
  expect(posts[0].idempotencyKey).toBeTruthy();
  expect(posts[1].idempotencyKey).not.toBe(posts[0].idempotencyKey);
});

test('T11: onUpdatePlanItem несе РІВНО передані поля (чекбокс окремо, текст окремо) -- PATCH-семантика', async () => {
  const server = makeServer({ planItems: [PLAN_ITEM] });
  const props = await loadMain(server);

  await props.onUpdatePlanItem('plan-item-1', { done: true });
  await props.onUpdatePlanItem('plan-item-1', { planText: 'Пробігти марафон' });

  const patches = server.planCalls.filter((call) => call.method === 'PATCH');
  expect(patches[0].url).toBe('/api/v1/plan-items/plan-item-1');
  expect(patches[0].body).toEqual({ done: true });
  expect(patches[1].body).toEqual({ planText: 'Пробігти марафон' });
});

test('T11 (AC-04): onDeletePlanItem надсилає DELETE /plan-items/{id}, і пункт зникає з наступного читання', async () => {
  const server = makeServer({ planItems: [PLAN_ITEM] });
  const props = await loadMain(server);

  await props.onDeletePlanItem('plan-item-1');

  expect(server.planCalls.some((call) => call.method === 'DELETE' && call.url === '/api/v1/plan-items/plan-item-1')).toBe(true);
  expect(await props.loadPlanItems()).toEqual([]);
});

test('T11: помилка сервера доходить як AppError із кодом -- екран показує message, а не свою вигадку', async () => {
  const server = makeServer();
  const props = await loadMain(server);

  vi.stubGlobal('fetch', (async () =>
    jsonResponse({ code: 'plan_item.text_required', message: 'Пункт плану не може бути без тексту' }, 422)) as unknown as typeof fetch);

  await expect(props.onCreatePlanItem({ horizon: 'tactical', planText: ' ' })).rejects.toMatchObject({
    code: 'plan_item.text_required',
    message: 'Пункт плану не може бути без тексту',
  });
});
