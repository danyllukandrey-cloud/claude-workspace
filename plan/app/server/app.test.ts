// RED (T30): composition-root Express app -- ADR-0006 §Рішення/§Обґрунтування,
// docs/features/life-area-card/tasks/t30-wiring-app-shell.md.
//
// Unit tier (npm test): жодної реальної мережі/БД -- `db` і `verifyJwt`
// підробляються (vi.fn()), той самий підхід, що вже застосований у
// src/cards/life-area-card/app/create-card.test.ts (query як vi.fn(),
// канонічні snake_case-рядки).
//
// 'supertest' у devDependencies немає (перевірено на момент написання цього
// тесту -- `npm ls supertest` порожній) -- тому HTTP-запити йдуть напряму
// через http.createServer(app) + глобальний fetch (Node 24), а не через
// supertest-style .request(app). ІМПЛЕМЕНТЕРУ: додати 'supertest' у
// devDependencies спростить це, але не є обов'язковим -- поточний підхід
// повністю робочий без нього.
//
// createApp/AppDeps ще не існують (server/app.ts) -- цей файл мусить впасти
// на "Cannot find module './app'" (GOOD red), не на асерції всередині тестів.

import { describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, type AppDeps } from './app';
import type { Db } from '../src/cards/life-area-card/infra/postgres-repo';
// "Лог дій" -- та сама реальна реалізація, що server/index.ts підставляє в
// AppDeps.recordAction (не мок) -- тест нижче пінить реальний ланцюг
// composition root -> ports -> use-case -> insertActionLogEntry -> db.query,
// той самий "пінить реальний SQL, не лише передачу функції" підхід, що
// cardAndStructureDb вище (AC-09, review 2026-09-11 MUST-FIX 6).
import { recordAction } from '../src/agent/app/record-action';

const ERROR_SHAPE = {
  code: expect.stringMatching(/^[a-z_]+\.[a-z_]+$/),
  message: expect.any(String),
};

const CARD_ROW = {
  id: 'card-1',
  owner_user_id: 'user-42',
  name: 'Здоров’я',
  description: null,
  status: 'active',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

async function startServer(deps: AppDeps): Promise<{ server: http.Server; baseUrl: string }> {
  const app = createApp(deps);
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function noopDeps(db: Db, verifyJwt: AppDeps['verifyJwt']): AppDeps {
  // withTransaction тут -- прохідний no-op (просто викликає fn з тим самим db), не
  // реальна транзакція: контроль потоку BEGIN/COMMIT/ROLLBACK перевіряється окремо,
  // server/db.test.ts (T40). Тести цього файлу перевіряють транспортний шар/error-
  // middleware, не транзакційність.
  return { db, withTransaction: (fn) => fn(db), verifyGoogleIdToken: vi.fn(), signJwt: vi.fn(), verifyJwt };
}

describe('composition root -- auth middleware on mounted routes (T30, D-107)', () => {
  it('rejects GET /api/v1/cards with no Authorization header (401, contract Error envelope)', async () => {
    const query = vi.fn();
    const verifyJwt = vi.fn();
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/cards`);
      const body = await res.json();

      expect(res.status).toBe(401);
      // components.schemas.Error (openapi.yaml): required [code, message], additionalProperties:false.
      expect(body).toMatchObject(ERROR_SHAPE);
      expect(query).not.toHaveBeenCalled();
      expect(verifyJwt).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it('rejects GET /api/v1/cards with an invalid Bearer token (401, contract Error envelope)', async () => {
    const query = vi.fn();
    const verifyJwt = vi.fn().mockRejectedValue(new Error('bad signature'));
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/cards`, {
        headers: { Authorization: 'Bearer not-a-real-jwt' },
      });
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body).toMatchObject(ERROR_SHAPE);
    } finally {
      server.close();
    }
  });

  it('extracts ownerUserId from the JWT sub claim down to the real card-handlers/postgres-repo query', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [CARD_ROW] });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/cards`, {
        headers: { Authorization: 'Bearer a-valid-looking-jwt' },
      });
      const body = await res.json();

      expect(verifyJwt).toHaveBeenCalledWith('a-valid-looking-jwt');
      expect(res.status).toBe(200);
      // Business-observable: власний токен користувача 'user-42' мусить дійти до SQL-параметрів
      // репозиторію (non-disclosure, AC-04) -- middleware не просто "пропускає", а передає sub далі.
      expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining(['user-42']));
      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe('card-1');
    } finally {
      server.close();
    }
  });

  it('maps a thrown AppError (card.not_found, 404) to the exact contract Error envelope via one error-middleware', async () => {
    // getCard use-case (app/get-card.ts) кидає AppError('card.not_found', 'Картку не знайдено', 404)
    // САМ, коли findCardById не знаходить рядок -- тут перевіряємо лише, що транспортний шар
    // (error-middleware) перетворює це на контрактний конверт {code, message}, а не деталь use-case.
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/cards/does-not-exist`, {
        headers: { Authorization: 'Bearer a-valid-looking-jwt' },
      });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body).toEqual({ code: 'card.not_found', message: expect.any(String) });
    } finally {
      server.close();
    }
  });

  // Review 2026-09-07 A1: domain/card.ts кидає CardValidationError (окремий
  // клас, не AppError -- домен навмисно нічого не знає про HTTP) на порожню
  // назву; ДО цього фіксу error-middleware перевіряв лише `instanceof
  // AppError` і будь-яка інша помилка падала у generic-гілку 500. Контракт
  // (openapi.yaml POST /cards) документує саме 422 card.name_required.
  it('maps a thrown CardValidationError (card.name_required, 422) to the exact contract Error envelope', async () => {
    const query = vi.fn(); // createCard кидає ДО будь-якого query
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: { Authorization: 'Bearer a-valid-looking-jwt', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '   ' }),
      });
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body).toEqual({ code: 'card.name_required', message: expect.any(String) });
      expect(query).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  // Той самий клас, для markFilled (AC-03) -- ProgressValidationError/CardValidationError,
  // обидва не instanceof AppError.
  it('maps a thrown CardValidationError (card.description_required, 422) via PATCH /cards/{id}', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [CARD_ROW] }); // findCardById лише
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/cards/card-1`, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer a-valid-looking-jwt', 'Content-Type': 'application/json' },
        body: JSON.stringify({ markFilled: true }),
      });
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body).toEqual({ code: 'card.description_required', message: expect.any(String) });
    } finally {
      server.close();
    }
  });

  // Review 2026-09-07 (backend hardening, T50, "не-UUID id в шляху -- 500
  // замість 404"): раніше пробивало до generic 500-гілки error-middleware
  // (Postgres 22P02 не оброблений на жодному рівні нижче) -- тепер
  // postgres-repo.ts (findCardById) ловить саме цей код і повертає null, той
  // самий сигнал, що "картки не існує" (AC-04 non-disclosure).
  it('T50: non-UUID cardId у шляху повертає контрактний 404, не сирий Postgres 500', async () => {
    const invalidUuidError = Object.assign(new Error('invalid input syntax for type uuid: "not-a-uuid"'), { code: '22P02' });
    const query = vi.fn().mockRejectedValue(invalidUuidError);
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/cards/not-a-uuid`, {
        headers: { Authorization: 'Bearer a-valid-looking-jwt' },
      });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body).toEqual({ code: 'card.not_found', message: expect.any(String) });
    } finally {
      server.close();
    }
  });

  // Review 2026-09-07 (backend hardening, T50, "Express 5 req.body===undefined
  // -- 500 замість контрактного 401" [sic, фактично 422 тут] -- запит без
  // Content-Type: application/json (чи взагалі без тіла) лишає req.body
  // undefined (express.json() не парсить, коли Content-Type не збігається).
  // ports/entry-handlers.ts.resolveEntry читає `body.status` без перевірки --
  // undefined.status кидав би TypeError ДО будь-якого AppError/domain-branch
  // в error-middleware, тому пробивав до generic 500.
  const PENDING_ENTRY_ROW_FOR_BODY_TEST = {
    id: 'entry-1',
    metric_block_id: 'block-1',
    card_id: 'card-1',
    amount: '5',
    raw_text: 'пробіг 5 км',
    status: 'pending',
    source_device_id: 'device-a',
    recorded_at: new Date('2026-01-03T00:00:00Z'),
    confirmed_at: null,
    created_at: new Date('2026-01-03T00:00:00Z'),
  };

  it('T50: PATCH /entries/{id} без тіла запиту (req.body undefined, Express 5) не падає в сирий 500', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [PENDING_ENTRY_ROW_FOR_BODY_TEST] }) // findEntryById
      .mockResolvedValueOnce({ rows: [CARD_ROW] }); // findCardById
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/entries/entry-1`, {
        method: 'PATCH',
        // Навмисно БЕЗ Content-Type і без тіла -- express.json() лишає
        // req.body undefined, не {} (той самий випадок, що реальний клієнт
        // із мережевим збоєм посеред запиту чи криво написаний curl).
        headers: { Authorization: 'Bearer a-valid-looking-jwt' },
      });
      const body = await res.json();

      expect(res.status).not.toBe(500);
      expect(body).toEqual({ code: 'entry.invalid_status', message: expect.any(String) });
    } finally {
      server.close();
    }
  });

  // Review 2026-09-07, post-ship follow-up review: express.json() (body-parser)
  // сигналізує зіпсований JSON окремою помилкою з числовим `status` (400,
  // "entity.parse.failed") -- жодна гілка error-middleware цього не
  // перевіряла, тож така помилка теж падала в generic 500.
  it('T50-remainder: зіпсований JSON у тілі запиту повертає 400, не сирий 500', async () => {
    const query = vi.fn();
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: { Authorization: 'Bearer a-valid-looking-jwt', 'Content-Type': 'application/json' },
        body: '{"name": "unclosed', // навмисно зіпсований JSON
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body).toMatchObject(ERROR_SHAPE);
    } finally {
      server.close();
    }
  });
});

// --- Структура (фіча `structure`) -------------------------------------------
//
// Review 2026-09-11, MUST-FIX 1: ЖОДЕН маршрут Структури не був змонтований у
// composition root -- ports/structure-handlers.ts і ports/layout-handlers.ts
// були написані й покриті юніт-тестами, а з реального застосунку недосяжні
// (404 на кожен шлях), тож жоден код відповіді з контракту й жоден 401 із DoD
// T15/T16 не спостерігались у живому застосунку. Тести нижче -- саме той
// "пінячий" рівень, якого бракувало: вони йдуть через справжній HTTP, через
// справжній auth-middleware і через справжні хендлери до межі `db.query`.

const STRUCTURE_ROW = {
  id: 'structure-1',
  owner_user_id: 'user-42',
  declaration: 'Навчання й здоров’я зараз важливіші за кар’єру.',
  layout_mode: 'focus',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-02T00:00:00Z'),
};

function layoutPositionRow(cardId: string, x: number | null, y: number | null = x, positionUpdatedAt = '2026-01-02T00:00:00Z') {
  return {
    id: `position-${cardId}`,
    structure_id: STRUCTURE_ROW.id,
    card_id: cardId,
    position_x: x,
    position_y: y,
    status: 'active',
    position_updated_at: new Date(positionUpdatedAt),
    created_at: new Date('2026-01-01T00:00:00Z'),
  };
}

function historyEventRow(cardId: string, detail: string | null, occurredAt: string) {
  return {
    id: `history-${cardId}`,
    structure_id: STRUCTURE_ROW.id,
    card_id: cardId,
    event_type: 'moved',
    detail,
    occurred_at: new Date(occurredAt),
  };
}

/**
 * Підроблена база для маршрутів Структури -- маршрутизує за текстом SQL (той
 * самий стиль, що src/structure/app/move-card.test.ts). Мокається лише межа
 * `db.query`: infra/postgres-repo.ts, infra/history-repo.ts, use-case'и й
 * порти виконуються справжні.
 */
function connectionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'connection-1',
    structure_id: STRUCTURE_ROW.id,
    card_id_a: 'card-a',
    card_id_b: 'card-b',
    directed: false,
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function structureDb(
  opts: {
    structure?: typeof STRUCTURE_ROW | null;
    positions?: ReturnType<typeof layoutPositionRow>[];
    moved?: ReturnType<typeof layoutPositionRow> | null;
    history?: ReturnType<typeof historyEventRow>[];
    connections?: ReturnType<typeof connectionRow>[];
    /** DELETE /connections/{id} -- rows returned when the connection exists and belongs to this owner. */
    deletableConnection?: boolean;
  } = {}
) {
  return vi.fn(async (text: string) => {
    const sql = text.trim().toUpperCase();

    if (text.includes('structure_history_event')) {
      if (sql.startsWith('INSERT')) {
        return { rows: [historyEventRow('inserted', null, '2026-01-05T00:00:00Z')] };
      }
      return { rows: opts.history ?? [] };
    }
    if (text.includes('structure_connection')) {
      if (sql.startsWith('INSERT')) {
        return { rows: [connectionRow()] };
      }
      if (sql.startsWith('DELETE')) {
        return { rows: opts.deletableConnection ? [{ id: 'connection-1' }] : [] };
      }
      return { rows: opts.connections ?? [] };
    }
    if (text.includes('structure_layout_position')) {
      if (sql.startsWith('UPDATE')) {
        return { rows: opts.moved ? [opts.moved] : [] };
      }
      if (sql.startsWith('INSERT')) {
        return { rows: [layoutPositionRow('inserted', null, null)] };
      }
      return { rows: opts.positions ?? [] };
    }
    if (text.includes('structure')) {
      return { rows: opts.structure === null ? [] : [opts.structure ?? STRUCTURE_ROW] };
    }

    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
}

/** noopDeps + withTransaction, що РАХУЄ виклики (мультизапис мусить іти в транзакції). */
function countedTransactionDeps(db: Db, verifyJwt: AppDeps['verifyJwt']) {
  const transactions: number[] = [];
  const withTransaction: AppDeps['withTransaction'] = (fn) => {
    transactions.push(1);
    return fn(db);
  };
  return { deps: { ...noopDeps(db, verifyJwt), withTransaction }, transactions };
}

const AUTHED = { Authorization: 'Bearer a-valid-looking-jwt' };
const AUTHED_JSON = { ...AUTHED, 'Content-Type': 'application/json' };

describe('composition root -- маршрути Структури змонтовані (review 2026-09-11, MUST-FIX 1)', () => {
  it('GET /api/v1/structure returns the owner’s Structure (200)', async () => {
    const query = structureDb();
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query } as unknown as Db, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure`, { headers: AUTHED });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({ id: 'structure-1', layoutMode: 'focus' });
      // Токен власника мусить дійти до SQL-параметрів (AC-03 non-disclosure).
      expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining(['user-42']));
    } finally {
      server.close();
    }
  });

  it('GET /api/v1/structure without a token is 401 -- the shared auth-middleware already covers the new routes', async () => {
    const query = structureDb();
    const verifyJwt = vi.fn();
    const { server, baseUrl } = await startServer(noopDeps({ query } as unknown as Db, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure`);

      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject(ERROR_SHAPE);
      expect(query).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it('PATCH /api/v1/structure saves the declaration (200) inside one transaction', async () => {
    const query = structureDb();
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { deps, transactions } = countedTransactionDeps({ query } as unknown as Db, verifyJwt);
    const { server, baseUrl } = await startServer(deps);

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure`, {
        method: 'PATCH',
        headers: AUTHED_JSON,
        body: JSON.stringify({ declaration: 'Нова декларація' }),
      });

      expect(res.status).toBe(200);
      expect((await res.json()).id).toBe('structure-1');
      // T11 DoD: PATCH -- мультизапис (UPDATE structure + N UPDATE позицій при
      // скиданні розкладки, AC-11b/AC-16b), тож мусить іти в транзакції.
      expect(transactions).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it('GET /api/v1/structure/layout returns the active positions page (200)', async () => {
    const query = structureDb({ positions: [layoutPositionRow('card-a', 0), layoutPositionRow('card-b', 3)] });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query } as unknown as Db, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure/layout?limit=10`, { headers: AUTHED });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.items).toHaveLength(2);
      expect(body.items.map((item: { cardId: string }) => item.cardId).sort()).toEqual(['card-a', 'card-b']);
      expect(body).toMatchObject({ has_next: false, has_prev: false, next_cursor: null });
    } finally {
      server.close();
    }
  });

  it('GET /api/v1/structure/layout/history reconstructs the past layout from the history log (200)', async () => {
    const query = structureDb({
      // Той самий формат `detail`, що пише src/structure/app/move-card.ts.
      history: [historyEventRow('card-a', 'pos_x -> 44, pos_y -> 12, prev_x -> 10, prev_y -> 10', '2026-01-03T00:00:00Z')],
    });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query } as unknown as Db, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure/layout/history?asOf=2026-01-04T00:00:00.000Z`, {
        headers: AUTHED,
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.items).toEqual([
        expect.objectContaining({ cardId: 'card-a', x: 44, y: 12, status: 'active' }),
      ]);
    } finally {
      server.close();
    }
  });

  it('GET /api/v1/structure/layout/history without asOf is the contract 422, not a 500', async () => {
    const query = structureDb();
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query } as unknown as Db, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure/layout/history`, { headers: AUTHED });

      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: 'structure.invalid_as_of' });
      expect(query).not.toHaveBeenCalled(); // validate-first, ДО будь-якого запиту в базу
    } finally {
      server.close();
    }
  });

  it('PUT /api/v1/structure/layout/{cardId} moves the card (200), in a transaction, recording a readable history detail', async () => {
    const query = structureDb({
      positions: [layoutPositionRow('card-a', 3)],
      moved: layoutPositionRow('card-a', 65, 80, '2026-01-05T00:00:00Z'),
    });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { deps, transactions } = countedTransactionDeps({ query } as unknown as Db, verifyJwt);
    const { server, baseUrl } = await startServer(deps);

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure/layout/card-a`, {
        method: 'PUT',
        headers: AUTHED_JSON,
        body: JSON.stringify({ x: 65, y: 80, positionUpdatedAt: '2026-01-05T00:00:00.000Z' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({ cardId: 'card-a', x: 65, y: 80, status: 'active' });
      expect(transactions).toHaveLength(1); // UPDATE позиції + INSERT події -- разом або ніяк
      // Подія 'moved' мусить нести detail, який читає GET /layout/history вище.
      const historyInsert = query.mock.calls.find(
        ([text]: [string]) => text.includes('structure_history_event') && text.trim().toUpperCase().startsWith('INSERT')
      ) as [string, unknown[]];
      expect(historyInsert).toBeDefined();
      expect(String(historyInsert[1][4])).toMatch(/pos_x\s*->\s*65/);
    } finally {
      server.close();
    }
  });

  // D-131-наступне рішення: AC-02 (колізія клітинки, 409 structure.cell_occupied)
  // прибрана повністю -- вільне позиціювання дозволяє картки, що перекриваються.
  it('PUT /api/v1/structure/layout/{cardId} onto the same x/y another active card already holds is still 200 -- no collision left to reject', async () => {
    const query = structureDb({
      positions: [layoutPositionRow('card-a', 3), layoutPositionRow('card-b', 7)],
      moved: layoutPositionRow('card-a', 7, 7, '2026-01-05T00:00:00Z'),
    });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query } as unknown as Db, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure/layout/card-a`, {
        method: 'PUT',
        headers: AUTHED_JSON,
        body: JSON.stringify({ x: 7, y: 7, positionUpdatedAt: '2026-01-05T00:00:00.000Z' }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ cardId: 'card-a', x: 7, y: 7 });
    } finally {
      server.close();
    }
  });

  it('POST /api/v1/structure/layout/{cardId}/close closes the direction (200) in a transaction', async () => {
    const query = structureDb({ positions: [layoutPositionRow('card-a', 2)] });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { deps, transactions } = countedTransactionDeps({ query } as unknown as Db, verifyJwt);
    const { server, baseUrl } = await startServer(deps);

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure/layout/card-a/close`, {
        method: 'POST',
        headers: AUTHED_JSON,
        body: JSON.stringify({}),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({ cardId: 'card-a', status: 'closed' });
      expect(transactions).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it('POST /api/v1/structure/layout/{cardId}/close for a card with no active position is the contract 404 (AC-03)', async () => {
    const query = structureDb({ positions: [] });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query } as unknown as Db, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure/layout/ghost-card/close`, {
        method: 'POST',
        headers: AUTHED_JSON,
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'structure.card_not_found' });
    } finally {
      server.close();
    }
  });

  // Вимоги 14/15 (плоска модель): 'single' скасований, невідоме значення
  // layoutMode лишається контрактним 422, перевіреним ДО будь-якого запису
  // (ports/structure-handlers.ts) -- не generic 500.
  it('maps an invalid layoutMode value to the contract 422, not a generic 500', async () => {
    const query = structureDb({ structure: { ...STRUCTURE_ROW, layout_mode: 'free' } });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query } as unknown as Db, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure`, {
        method: 'PATCH',
        headers: AUTHED_JSON,
        body: JSON.stringify({ layoutMode: 'single' }),
      });
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body).toMatchObject(ERROR_SHAPE);
      expect(body.code).toBe('structure.invalid_layout_mode');
    } finally {
      server.close();
    }
  });
});

// --- Зв'язки Структури (вимоги 4/5, чат 2026-09-15) -------------------------
//
// Той самий "пінячий" урок, що MUST-FIX 1 вище (маршрути Структури):
// написані й покриті юніт-тестами порти лишаються 404, якщо composition root
// (server/app.ts) їх не монтує -- ці тести пінять реальний HTTP через
// справжній auth-middleware до межі db.query, не лише "функцію передано".

describe('composition root -- маршрути зв\'язків Структури змонтовані (вимоги 4/5)', () => {
  it('GET /api/v1/structure/connections returns every connection (200)', async () => {
    const query = structureDb({ connections: [connectionRow()] });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query } as unknown as Db, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure/connections`, { headers: AUTHED });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual([
        expect.objectContaining({ id: 'connection-1', cardIdA: 'card-a', cardIdB: 'card-b', directed: false }),
      ]);
    } finally {
      server.close();
    }
  });

  it('POST /api/v1/structure/connections creates a connection (201) between two owned cards', async () => {
    const query = structureDb({
      positions: [layoutPositionRow('card-a', 10), layoutPositionRow('card-b', 20)],
    });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query } as unknown as Db, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure/connections`, {
        method: 'POST',
        headers: AUTHED_JSON,
        body: JSON.stringify({ cardIdA: 'card-a', cardIdB: 'card-b', directed: true }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body).toMatchObject({ cardIdA: 'card-a', cardIdB: 'card-b', directed: false }); // fake db завжди повертає той самий connectionRow()
    } finally {
      server.close();
    }
  });

  it('POST /api/v1/structure/connections for a card outside this owner is the contract 404 (AC-03)', async () => {
    const query = structureDb({ positions: [layoutPositionRow('card-a', 10)] }); // card-b відсутня
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query } as unknown as Db, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure/connections`, {
        method: 'POST',
        headers: AUTHED_JSON,
        body: JSON.stringify({ cardIdA: 'card-a', cardIdB: 'card-b', directed: false }),
      });

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'structure.card_not_found' });
    } finally {
      server.close();
    }
  });

  it('DELETE /api/v1/structure/connections/{connectionId} removes an owned connection (204)', async () => {
    const query = structureDb({ deletableConnection: true });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query } as unknown as Db, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure/connections/connection-1`, {
        method: 'DELETE',
        headers: AUTHED,
      });

      expect(res.status).toBe(204);
    } finally {
      server.close();
    }
  });

  it('DELETE /api/v1/structure/connections/{connectionId} for a missing/not-owned connection is the contract 404', async () => {
    const query = structureDb({ deletableConnection: false });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query } as unknown as Db, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure/connections/someone-elses`, {
        method: 'DELETE',
        headers: AUTHED,
      });

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'structure.connection_not_found' });
    } finally {
      server.close();
    }
  });
});

// --- AC-09: нова картка одразу отримує позицію за замовчуванням -------------
//
// D-131-наступне рішення (Андрій, чат, 2026-09-15): вільне полотно прибрало
// "наступну вільну клітинку" -- `defaultPositionForNewCard` тепер ЗАВЖДИ
// {x: null, y: null} (домен/layout.test.ts), незалежно від уже наявних
// позицій чи обраного layoutMode. Тести нижче звужені до того, що з цим
// фактом реально лишилось спостерігати на композиційному рівні: сам INSERT
// доходить до БД, у тій самій транзакції, і тихо не пишеться, коли Структури
// ще немає.

/**
 * Підроблена база для POST /cards разом зі Структурою -- маршрутизація за
 * текстом SQL. Порядок перевірок значущий: `structure_layout_position` містить
 * підрядок `structure`, а `card_lifecycle_event` -- підрядок `card`.
 */
function cardAndStructureDb(
  opts: {
    structure?: typeof STRUCTURE_ROW | null;
    positions?: ReturnType<typeof layoutPositionRow>[];
    layoutInsertFails?: boolean;
  } = {}
) {
  return vi.fn(async (text: string) => {
    const sql = text.trim().toUpperCase();

    if (text.includes('structure_layout_position')) {
      if (sql.startsWith('INSERT')) {
        if (opts.layoutInsertFails) {
          throw new Error('duplicate key value violates unique constraint on structure_layout_position');
        }
        return { rows: [layoutPositionRow('inserted', null, null)] };
      }
      return { rows: opts.positions ?? [] };
    }
    if (text.includes('structure')) {
      return { rows: opts.structure === null ? [] : [opts.structure ?? STRUCTURE_ROW] };
    }
    if (text.includes('card_lifecycle_event')) {
      return { rows: [{ id: 'lifecycle-1', card_id: CARD_ROW.id, transition: 'created', occurred_at: new Date() }] };
    }
    if (text.includes('card')) {
      return { rows: [CARD_ROW] };
    }

    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
}

/** Усі INSERT-и у structure_layout_position, що дійшли до межі db.query. */
function layoutInserts(query: ReturnType<typeof cardAndStructureDb>): [string, unknown[]][] {
  return query.mock.calls.filter(
    ([text]) => text.includes('structure_layout_position') && text.trim().toUpperCase().startsWith('INSERT')
  ) as unknown as [string, unknown[]][];
}

describe('composition root -- POST /api/v1/cards дає новій картці позицію за замовчуванням (AC-09)', () => {
  it('вставляє позицію {x: null, y: null} (купка нерозкладених), у тій самій транзакції, незалежно від уже наявних позицій', async () => {
    const query = cardAndStructureDb({
      positions: [layoutPositionRow('card-a', 20), layoutPositionRow('card-b', 80)],
    });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { deps, transactions } = countedTransactionDeps({ query } as unknown as Db, verifyJwt);
    const { server, baseUrl } = await startServer(deps);

    try {
      const res = await fetch(`${baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: AUTHED_JSON,
        body: JSON.stringify({ name: 'Здоровʼя' }),
      });

      expect(res.status).toBe(201);

      const inserts = layoutInserts(query);
      expect(inserts).toHaveLength(1);
      // params: [id, structureId, cardId, x, y, positionUpdatedAt]
      expect(inserts[0][1][1]).toBe(STRUCTURE_ROW.id);
      expect(inserts[0][1][2]).toBe(CARD_ROW.id);
      expect(inserts[0][1][3]).toBeNull();
      expect(inserts[0][1][4]).toBeNull();
      // Один `withTransaction` на весь запит -- INSERT card + подія життєвого
      // циклу + INSERT позиції разом або ніяк.
      expect(transactions).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it('перша картка власника теж іде в купку нерозкладених -- жодного спеціального випадку для "першої"', async () => {
    const query = cardAndStructureDb({ positions: [] });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query } as unknown as Db, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: AUTHED_JSON,
        body: JSON.stringify({ name: 'Здоровʼя' }),
      });

      expect(res.status).toBe(201);
      expect(layoutInserts(query)[0][1][3]).toBeNull();
    } finally {
      server.close();
    }
  });

  it('Структури в користувача ще немає -- картка створюється, у розкладку не пишеться нічого (лінива ініціалізація)', async () => {
    const query = cardAndStructureDb({ structure: null });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query } as unknown as Db, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: AUTHED_JSON,
        body: JSON.stringify({ name: 'Здоровʼя' }),
      });

      // Картка створилась (201), помилки немає: Структура з'явиться на першому
      // GET /structure, і картка чекатиме в треї нерозкладених.
      expect(res.status).toBe(201);
      expect((await res.json()).id).toBe(CARD_ROW.id);
      expect(layoutInserts(query)).toHaveLength(0);
    } finally {
      server.close();
    }
  });

  it('збій вставки позиції не глушиться -- запит падає, щоб транзакція відкотила й саму картку', async () => {
    const query = cardAndStructureDb({ layoutInsertFails: true });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    // withTransaction, що РЕАЛЬНО фіксує відхилення -- сюди дивиться
    // server/db.ts's BEGIN/ROLLBACK у production.
    const rejections: unknown[] = [];
    const db = { query } as unknown as Db;
    const deps: AppDeps = {
      ...noopDeps(db, verifyJwt),
      withTransaction: (fn) =>
        fn(db).catch((err: unknown) => {
          rejections.push(err);
          throw err;
        }),
    };
    const { server, baseUrl } = await startServer(deps);

    try {
      const res = await fetch(`${baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: AUTHED_JSON,
        body: JSON.stringify({ name: 'Здоровʼя' }),
      });

      expect(res.status).toBe(500);
      // Ключове: помилка ВИЙШЛА за межі withTransaction -- саме це змушує
      // server/db.ts зробити ROLLBACK і не лишити картку без клітинки.
      expect(rejections).toHaveLength(1);
    } finally {
      server.close();
    }
  });
});

// --- Агент (фіча `agent`, T29) ----------------------------------------------
//
// Той самий урок і той самий "пінячий" рівень, що описка Структури вище
// (MUST-FIX 1): ports/*.ts для агента були написані й покриті юніт-тестами,
// але composition root мусить РЕАЛЬНО їх монтувати -- ці тести самоперевірку
// проходять через справжній HTTP + справжній auth-middleware для КОЖНОГО з 9
// шляхів контракту (contracts/openapi.yaml), не вибірково.

const PROPOSAL_ROW = {
  id: 'proposal-1',
  user_id: 'user-42',
  card_id: 'card-1',
  metric_block_id: 'block-1',
  status: 'active',
  source_type: 'text',
  raw_input: 'пробіг 5 км',
  proposed_amount: '5',
  proposed_summary: 'Спорт: 5 км',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

const RULE_ROW = {
  id: 'rule-1',
  user_id: 'user-42',
  scope_card_id: null,
  category: 'reminder',
  rule_text: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

const REPORT_ROW = {
  id: 'report-1',
  period_type: 'weekly',
  period_start: new Date('2026-01-01T00:00:00Z'),
  period_end: new Date('2026-01-07T00:00:00Z'),
  content: 'Підсумок тижня',
  status: 'generated',
  generated_at: new Date('2026-01-08T00:00:00Z'),
};

const ACTION_LOG_ROW = {
  id: 'log-1',
  owner_user_id: 'user-42',
  action: 'Створено картку «Спорт»',
  occurred_at: new Date('2026-01-01T00:00:00Z'),
};

const SYNC_RESOURCE_ROW = {
  id: 'resource-1',
  user_id: 'user-42',
  url: 'https://docs.google.com/document/d/abc',
  status: 'active',
  last_synced_at: null,
  last_error: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
};

const CHAT_MESSAGE_ROW = {
  id: 'message-1',
  user_id: 'user-42',
  role: 'agent',
  content: 'Привіт!',
  session_date: '2026-01-01',
  created_at: new Date('2026-01-01T00:00:00Z'),
};

/**
 * Підроблена база для маршрутів агента -- той самий "маршрутизувати за
 * текстом SQL" стиль, що structureDb вище. Мокається лише межа `db.query`;
 * use-case'и й порти виконуються справжні.
 */
function agentDb(
  opts: {
    activeProposal?: typeof PROPOSAL_ROW | null;
    rules?: (typeof RULE_ROW)[];
    reports?: (typeof REPORT_ROW)[];
    actionLog?: (typeof ACTION_LOG_ROW)[];
    syncResources?: (typeof SYNC_RESOURCE_ROW)[];
    hasAnyChatMessage?: boolean;
    activeCards?: unknown[];
  } = {}
) {
  return vi.fn(async (text: string) => {
    const sql = text.trim().toUpperCase();

    if (text.includes('chat_message')) {
      if (sql.startsWith('SELECT COUNT')) return { rows: [{ count: '0' }] }; // rate limit
      // AC-13 race fix (2026-09-12): getOnboardingStatus's insertWelcomeMessageIfFirst
      // is now ONE atomic `INSERT ... SELECT ... WHERE NOT EXISTS` query -- no
      // longer a separate hasAnyChatMessage SELECT. `hasAnyChatMessage: true` here
      // simulates "already onboarded" (the WHERE NOT EXISTS finds a row -> 0 rows back).
      if (sql.includes('WHERE NOT EXISTS')) {
        return { rows: opts.hasAnyChatMessage ? [] : [CHAT_MESSAGE_ROW] };
      }
      if (sql.startsWith('INSERT')) return { rows: [CHAT_MESSAGE_ROW] };
      return { rows: [] }; // listMessagesForSession / findAllMessagesByUser
    }
    if (text.includes('agent_proposal')) {
      if (sql.startsWith('INSERT')) return { rows: [PROPOSAL_ROW] };
      return { rows: opts.activeProposal === null ? [] : [opts.activeProposal ?? PROPOSAL_ROW] };
    }
    if (text.includes('imperative_rule')) {
      if (sql.startsWith('INSERT')) return { rows: [RULE_ROW] };
      return { rows: opts.rules ?? [] };
    }
    if (text.includes('activity_report')) {
      return { rows: opts.reports ?? [] };
    }
    if (text.includes('action_log')) {
      if (sql.startsWith('INSERT')) return { rows: [ACTION_LOG_ROW] };
      return { rows: opts.actionLog ?? [] };
    }
    if (text.includes('sync_resource')) {
      if (sql.startsWith('INSERT')) return { rows: [SYNC_RESOURCE_ROW] };
      if (sql.startsWith('DELETE')) return { rows: [SYNC_RESOURCE_ROW] };
      return { rows: opts.syncResources ?? [] };
    }
    if (text.includes('agent_audit_event')) {
      return { rows: [{ id: 'audit-1', user_id: 'user-42', event_type: 'account_deleted', subject_type: 'account', subject_id: null, detail: null, occurred_at: new Date() }] };
    }
    if (text.includes('DELETE FROM app_user')) {
      return { rows: [] };
    }
    // life-area-card's listCards (handleMessage's AC-05 card catalog) -- own table, own tests elsewhere.
    if (text.includes('FROM card')) {
      return { rows: opts.activeCards ?? [] };
    }

    throw new Error(`Непередбачений запит у тесті (agentDb): ${text}`);
  });
}

describe('composition root -- маршрути агента змонтовані (T29, contracts/openapi.yaml)', () => {
  // Self-check (уникнути МУST-FIX 1 знову): КОЖЕН з 9 шляхів контракту,
  // кожен зареєстрований метод -- 401 без токена доводить "змонтовано і
  // всередині auth-межі", не 404 "не існує".
  const AGENT_ROUTES: Array<{ method: 'GET' | 'POST' | 'DELETE'; path: string }> = [
    { method: 'GET', path: '/api/v1/messages' },
    { method: 'POST', path: '/api/v1/messages' },
    { method: 'GET', path: '/api/v1/proposals/active' },
    { method: 'POST', path: '/api/v1/proposals/proposal-1/confirm' },
    { method: 'GET', path: '/api/v1/rules' },
    { method: 'POST', path: '/api/v1/rules' },
    { method: 'GET', path: '/api/v1/reports' },
    { method: 'GET', path: '/api/v1/onboarding' },
    { method: 'DELETE', path: '/api/v1/account' },
    { method: 'GET', path: '/api/v1/sync-resources' },
    { method: 'POST', path: '/api/v1/sync-resources' },
    { method: 'DELETE', path: '/api/v1/sync-resources/resource-1' },
  ];

  it.each(AGENT_ROUTES)('$method $path without a token is 401 (mounted, not 404)', async ({ method, path }) => {
    const query = agentDb();
    const verifyJwt = vi.fn();
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}${path}`, { method });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject(ERROR_SHAPE);
      expect(verifyJwt).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it('GET /api/v1/onboarding creates the one-time welcome chat_message for a brand-new user (AC-13)', async () => {
    const query = agentDb({ hasAnyChatMessage: false });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/onboarding`, { headers: AUTHED });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({ welcomeShown: true, message: { id: 'message-1', role: 'agent' } });
    } finally {
      server.close();
    }
  });

  it('GET /api/v1/rules returns the owner’s global rules (200)', async () => {
    const query = agentDb({ rules: [RULE_ROW] });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/rules`, { headers: AUTHED });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.items).toEqual([expect.objectContaining({ id: 'rule-1', category: 'reminder' })]);
    } finally {
      server.close();
    }
  });

  it('POST /api/v1/rules creates a rule (201)', async () => {
    const query = agentDb({ rules: [] });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/rules`, {
        method: 'POST',
        headers: AUTHED_JSON,
        body: JSON.stringify({ category: 'reminder', ruleText: null, scopeCardId: null }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body).toMatchObject({ id: 'rule-1', category: 'reminder' });
    } finally {
      server.close();
    }
  });

  it('GET /api/v1/reports returns the owner’s activity reports (200)', async () => {
    const query = agentDb({ reports: [REPORT_ROW] });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/reports`, { headers: AUTHED });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.items).toEqual([expect.objectContaining({ id: 'report-1', periodType: 'weekly' })]);
    } finally {
      server.close();
    }
  });

  it('GET /api/v1/action-log returns the owner’s Лог дій, newest first (заміна GET /reports у UI, D-123)', async () => {
    const query = agentDb({ actionLog: [ACTION_LOG_ROW] });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/action-log`, { headers: AUTHED });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.items).toEqual([{ id: 'log-1', action: 'Створено картку «Спорт»', occurredAt: '2026-01-01T00:00:00.000Z' }]);
    } finally {
      server.close();
    }
  });

  it('GET /api/v1/proposals/active returns null when there is no active proposal (200)', async () => {
    const query = agentDb({ activeProposal: null });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/proposals/active`, { headers: AUTHED });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ proposal: null });
    } finally {
      server.close();
    }
  });

  it('POST /api/v1/proposals/{id}/confirm on a nonexistent/foreign proposal is the contract 404 (AC-06 non-disclosure), inside one transaction', async () => {
    const query = agentDb({ activeProposal: null });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { deps, transactions } = countedTransactionDeps({ query }, verifyJwt);
    const { server, baseUrl } = await startServer(deps);

    try {
      const res = await fetch(`${baseUrl}/api/v1/proposals/does-not-exist/confirm`, {
        method: 'POST',
        headers: AUTHED_JSON,
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'agent.proposal_not_found' });
      // Мультизапис через межу фіч (life-area-card's createEntry + власний
      // updateProposal) -- withTransaction обгортає ВЕСЬ виклик, навіть коли
      // він падає ДО першого запису (той самий інваріант, що Cards/Structure
      // вище: якщо колись з'явиться другий запис, він не лишиться сиротою).
      expect(transactions).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it('POST /api/v1/messages without deps.askClaude fails closed with 503 agent.llm_unavailable, not a raw crash', async () => {
    const query = agentDb();
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/messages`, {
        method: 'POST',
        headers: AUTHED_JSON,
        body: JSON.stringify({ content: 'пробіг 5 км' }),
      });

      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: 'agent.llm_unavailable' });
    } finally {
      server.close();
    }
  });

  it('POST /api/v1/messages with deps.askClaude wired reaches Claude and returns a MessageTurn (201)', async () => {
    const query = agentDb({ activeProposal: null, activeCards: [] });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const askClaude = vi.fn().mockResolvedValue({ ok: true, value: JSON.stringify({ outcome: 'clarification', reply: 'Уточни, будь ласка' }) });
    const { server, baseUrl } = await startServer({ ...noopDeps({ query }, verifyJwt), askClaude });

    try {
      const res = await fetch(`${baseUrl}/api/v1/messages`, {
        method: 'POST',
        headers: AUTHED_JSON,
        body: JSON.stringify({ content: 'пробіг 5 км' }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body).toEqual({ reply: 'Уточни, будь ласка', proposal: null });
      expect(askClaude).toHaveBeenCalledTimes(1);
    } finally {
      server.close();
    }
  });

  it('GET /api/v1/sync-resources returns the owner’s resources (200)', async () => {
    const query = agentDb({ syncResources: [SYNC_RESOURCE_ROW] });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/sync-resources`, { headers: AUTHED });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual([expect.objectContaining({ id: 'resource-1', url: SYNC_RESOURCE_ROW.url })]);
    } finally {
      server.close();
    }
  });

  it('POST /api/v1/sync-resources adds a resource (201)', async () => {
    const query = agentDb();
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/sync-resources`, {
        method: 'POST',
        headers: AUTHED_JSON,
        body: JSON.stringify({ url: SYNC_RESOURCE_ROW.url }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body).toMatchObject({ id: 'resource-1' });
    } finally {
      server.close();
    }
  });

  it('DELETE /api/v1/sync-resources/{id} removes a resource (204)', async () => {
    const query = agentDb();
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/sync-resources/resource-1`, { method: 'DELETE', headers: AUTHED });
      expect(res.status).toBe(204);
    } finally {
      server.close();
    }
  });

  it('DELETE /api/v1/account without confirmed:true is the contract 400 (AC-17b defense-in-depth), no db write reaches app_user', async () => {
    const query = agentDb();
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { deps, transactions } = countedTransactionDeps({ query }, verifyJwt);
    const { server, baseUrl } = await startServer(deps);

    try {
      const res = await fetch(`${baseUrl}/api/v1/account`, { method: 'DELETE', headers: AUTHED_JSON, body: JSON.stringify({}) });

      expect(res.status).toBe(400);
      expect(query.mock.calls.some(([text]: [string]) => text.includes('DELETE FROM app_user'))).toBe(false);
      expect(transactions).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it('DELETE /api/v1/account with confirmed:true deletes the account (204), audit-then-delete inside one transaction (D-89)', async () => {
    const query = agentDb();
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { deps, transactions } = countedTransactionDeps({ query }, verifyJwt);
    const { server, baseUrl } = await startServer(deps);

    try {
      const res = await fetch(`${baseUrl}/api/v1/account`, {
        method: 'DELETE',
        headers: AUTHED_JSON,
        body: JSON.stringify({ confirmed: true }),
      });

      expect(res.status).toBe(204);
      expect(transactions).toHaveLength(1);
      // D-89: audit-рядок пишеться ДО DELETE app_user -- зворотний порядок
      // втратив би слід видалення (FK CASCADE знищила б щойно вставлений рядок).
      const auditIndex = query.mock.calls.findIndex(([text]: [string]) => text.includes('agent_audit_event'));
      const deleteIndex = query.mock.calls.findIndex(([text]: [string]) => text.includes('DELETE FROM app_user'));
      expect(auditIndex).toBeGreaterThanOrEqual(0);
      expect(deleteIndex).toBeGreaterThan(auditIndex);
    } finally {
      server.close();
    }
  });
});

// AC-20 (US-14, spec.md "агент сам виявив технічну помилку чи збій") -- review
// finding: reportAgentDetectedError (domain, T36) + fileAgentDetectedErrorReport
// (app, T42) existed fully tested but had ZERO callers anywhere, so AC-20 could
// never fire in production. No sad.md flow names the exact trigger point
// (flagged as under-specified) -- the generic/non-AppError branch of the
// error-middleware (server/app.ts) is the most defensible, narrow reading:
// a genuine unexpected bug reaching that branch now best-effort files an
// agent-detected developer report, WITHOUT ever changing the client-visible
// response (filing is a side effect, not part of the response contract).
describe('AC-20: generic error-middleware branch best-effort files an agent-detected developer report', () => {
  it('files fileAgentDetectedErrorReport when an unexpected error reaches the generic branch, without changing the 500 response', async () => {
    const boom = new Error('кешований драйвер БД впав -- справжній непередбачений баг');
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM card')) throw boom;
      if (sql.includes('INSERT INTO developer_report')) {
        return {
          rows: [
            {
              id: 'report-1',
              user_id: null,
              trigger_type: 'agent_detected',
              description: boom.message,
              delivery_status: 'sent',
              sent_at: new Date('2026-09-12T00:00:00Z'),
            },
          ],
        };
      }
      throw new Error(`Непередбачений запит у тесті (AC-20): ${sql}`);
    });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const emailTransport = vi.fn().mockResolvedValue({ messageId: 'msg-1' });
    const developerEmail = 'dev@example.com';
    const { server, baseUrl } = await startServer({
      ...noopDeps({ query }, verifyJwt),
      emailTransport,
      developerEmail,
    });

    try {
      const res = await fetch(`${baseUrl}/api/v1/cards/card-1`, { headers: AUTHED });
      const body = await res.json();

      // (a) клієнт і далі отримує ОРИГІНАЛЬНУ 500-відповідь -- filing звіту не
      // частина контракту відповіді.
      expect(res.status).toBe(500);
      expect(body).toEqual({ code: 'internal.error', message: 'Internal server error' });

      // (b) fileAgentDetectedErrorReport реально викликаний (fire-and-forget,
      // тому чекаємо, поки мікрозадачі долетять, а не перевіряємо синхронно).
      await vi.waitFor(() => {
        expect(emailTransport).toHaveBeenCalledTimes(1);
      });
      expect(emailTransport.mock.calls[0][0]).toEqual(
        expect.objectContaining({ to: developerEmail, body: expect.stringContaining(boom.message) })
      );
      const insertCall = query.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO developer_report'));
      expect(insertCall).toBeDefined();
      // AC-20: службова дія без участі користувача -- ownerUserId НЕ
      // читається в error-middleware (не гарантовано доступний саме тут).
      expect(insertCall![1]).toEqual(expect.arrayContaining([null]));
    } finally {
      server.close();
    }
  });

  it('a failure inside fileAgentDetectedErrorReport itself never changes the client response or crashes the server', async () => {
    const boom = new Error('справжній непередбачений баг');
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM card')) throw boom;
      if (sql.includes('INSERT INTO developer_report')) throw new Error('developer_report insert теж впав');
      throw new Error(`Непередбачений запит у тесті (AC-20): ${sql}`);
    });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const emailTransport = vi.fn().mockResolvedValue({ messageId: 'msg-1' });
    const { server, baseUrl } = await startServer({
      ...noopDeps({ query }, verifyJwt),
      emailTransport,
      developerEmail: 'dev@example.com',
    });

    try {
      const res = await fetch(`${baseUrl}/api/v1/cards/card-1`, { headers: AUTHED });
      const body = await res.json();

      // (c) filing сам провалився (INSERT кинув) -- клієнт і далі бачить ТУ Ж
      // саму 500-відповідь, не 502/іншу помилку email.send_failed зсередини.
      expect(res.status).toBe(500);
      expect(body).toEqual({ code: 'internal.error', message: 'Internal server error' });

      await vi.waitFor(() => {
        const insertAttempted = query.mock.calls.some(([sql]: [string]) => sql.includes('INSERT INTO developer_report'));
        expect(insertAttempted).toBe(true);
      });
      // INSERT провалився ДО sendEmail -- transport ніколи не викликаний.
      expect(emailTransport).not.toHaveBeenCalled();

      // Сервер і далі відповідає (не впав некерованим unhandled rejection).
      const res2 = await fetch(`${baseUrl}/api/v1/cards/card-1`, { headers: AUTHED });
      expect(res2.status).toBe(500);
    } finally {
      server.close();
    }
  });

  it('does nothing when emailTransport/developerEmail are not wired (existing behavior unchanged)', async () => {
    const boom = new Error('непередбачений баг без DI-звіту');
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM card')) throw boom;
      throw new Error(`Непередбачений запит у тесті (AC-20): ${sql}`);
    });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/cards/card-1`, { headers: AUTHED });
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body).toEqual({ code: 'internal.error', message: 'Internal server error' });
      expect(query.mock.calls.some(([sql]: [string]) => sql.includes('INSERT INTO developer_report'))).toBe(false);
    } finally {
      server.close();
    }
  });
});

// --- "Лог дій" -- deps.recordAction реально прокинутий у маршрути ----------
//
// Той самий урок, що AC-09/MUST-FIX 6 і MUST-FIX 1 вище: у цьому проєкті вже
// траплялось, що use-case приймав опційний DI-колаборатор, а composition
// root його НІКОЛИ не передавав -- тож можливість лишалась недосяжною в
// production, попри зелені юніт-тести нижчого рівня. Тест нижче пінить
// РЕАЛЬНИЙ SQL (INSERT INTO action_log), що доходить до межі db.query, коли
// deps.recordAction реально задано -- не лише сам факт виклику мокнутої функції.

describe('composition root -- "Лог дій" (deps.recordAction) реально прокинутий у маршрути', () => {
  it('POST /api/v1/cards записує рядок у action_log, коли deps.recordAction задано', async () => {
    const query = vi.fn(async (text: string) => {
      const sql = text.trim().toUpperCase();
      if (text.includes('action_log')) return { rows: [ACTION_LOG_ROW] };
      if (text.includes('card_lifecycle_event')) {
        return { rows: [{ id: 'lifecycle-1', card_id: CARD_ROW.id, transition: 'created', occurred_at: new Date() }] };
      }
      if (text.includes('structure')) return { rows: [] }; // Структури ще нема -- assignDefaultLayoutPosition no-op
      if (sql.startsWith('INSERT INTO CARD')) return { rows: [CARD_ROW] };
      throw new Error(`Непередбачений запит у тесті (recordAction wiring): ${text}`);
    });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer({ ...noopDeps({ query }, verifyJwt), recordAction });

    try {
      const res = await fetch(`${baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: AUTHED_JSON,
        body: JSON.stringify({ name: CARD_ROW.name }),
      });

      expect(res.status).toBe(201);
      const actionLogInsert = query.mock.calls.find(([text]: [string]) => text.includes('INSERT INTO action_log'));
      expect(actionLogInsert).toBeTruthy();
      const [, params] = actionLogInsert as unknown as [string, unknown[]];
      expect(params).toEqual([expect.any(String), 'user-42', `Створено картку «${CARD_ROW.name}»`]);
    } finally {
      server.close();
    }
  });

  it('POST /api/v1/cards не пише в action_log, коли deps.recordAction не задано (наявна поведінка без регресії)', async () => {
    const query = vi.fn(async (text: string) => {
      const sql = text.trim().toUpperCase();
      if (text.includes('card_lifecycle_event')) {
        return { rows: [{ id: 'lifecycle-1', card_id: CARD_ROW.id, transition: 'created', occurred_at: new Date() }] };
      }
      if (text.includes('structure')) return { rows: [] };
      if (sql.startsWith('INSERT INTO CARD')) return { rows: [CARD_ROW] };
      throw new Error(`Непередбачений запит у тесті (recordAction wiring): ${text}`);
    });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query }, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: AUTHED_JSON,
        body: JSON.stringify({ name: CARD_ROW.name }),
      });

      expect(res.status).toBe(201);
      expect(query.mock.calls.some(([text]: [string]) => text.includes('action_log'))).toBe(false);
    } finally {
      server.close();
    }
  });
});
