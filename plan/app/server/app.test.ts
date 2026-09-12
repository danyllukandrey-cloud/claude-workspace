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
  layout_mode: 'logic',
  logic_variant: 'focus',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-02T00:00:00Z'),
};

function layoutPositionRow(cardId: string, cellIndex: number, positionUpdatedAt = '2026-01-02T00:00:00Z') {
  return {
    id: `position-${cardId}`,
    structure_id: STRUCTURE_ROW.id,
    card_id: cardId,
    cell_index: cellIndex,
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
function structureDb(
  opts: {
    structure?: typeof STRUCTURE_ROW | null;
    positions?: ReturnType<typeof layoutPositionRow>[];
    moved?: ReturnType<typeof layoutPositionRow> | null;
    history?: ReturnType<typeof historyEventRow>[];
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
    if (text.includes('structure_layout_position')) {
      if (sql.startsWith('UPDATE')) {
        return { rows: opts.moved ? [opts.moved] : [] };
      }
      if (sql.startsWith('INSERT')) {
        return { rows: [layoutPositionRow('inserted', 0)] };
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
      expect(body).toMatchObject({ id: 'structure-1', layoutMode: 'logic', logicVariant: 'focus' });
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
      history: [historyEventRow('card-a', 'cell_index -> 4, from_cell_index -> 1', '2026-01-03T00:00:00Z')],
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
        expect.objectContaining({ cardId: 'card-a', cellIndex: 4, status: 'active' }),
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
      moved: layoutPositionRow('card-a', 7, '2026-01-05T00:00:00Z'),
    });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { deps, transactions } = countedTransactionDeps({ query } as unknown as Db, verifyJwt);
    const { server, baseUrl } = await startServer(deps);

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure/layout/card-a`, {
        method: 'PUT',
        headers: AUTHED_JSON,
        body: JSON.stringify({ cellIndex: 7, positionUpdatedAt: '2026-01-05T00:00:00.000Z' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({ cardId: 'card-a', cellIndex: 7, status: 'active' });
      expect(transactions).toHaveLength(1); // UPDATE позиції + INSERT події -- разом або ніяк
      // Подія 'moved' мусить нести detail, який читає GET /layout/history вище.
      const historyInsert = query.mock.calls.find(
        ([text]: [string]) => text.includes('structure_history_event') && text.trim().toUpperCase().startsWith('INSERT')
      ) as [string, unknown[]];
      expect(historyInsert).toBeDefined();
      expect(String(historyInsert[1][4])).toMatch(/cell_index\s*->\s*7/);
    } finally {
      server.close();
    }
  });

  it('PUT /api/v1/structure/layout/{cardId} onto an occupied cell is the contract 409 (AC-02)', async () => {
    const query = structureDb({
      positions: [layoutPositionRow('card-a', 3), layoutPositionRow('card-b', 7)],
    });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query } as unknown as Db, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure/layout/card-a`, {
        method: 'PUT',
        headers: AUTHED_JSON,
        body: JSON.stringify({ cellIndex: 7, positionUpdatedAt: '2026-01-05T00:00:00.000Z' }),
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'structure.cell_occupied' });
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

  // Review 2026-09-11, Частина 2 [major]: domain/layout.ts кидає
  // LayoutValidationError (окремий клас -- домен навмисно не знає про HTTP,
  // як і CardValidationError вище), і error-middleware цього класу не знав,
  // тож будь-яка доменна помилка розкладки падала в generic 500 замість
  // контрактного 422.
  it('maps a thrown LayoutValidationError to the contract 422, not a generic 500', async () => {
    // Структура вже у режимі 'free' із збереженим logic_variant 'focus';
    // PATCH {logicVariant: null} змінює підвид, а змінювати підвид можна лише
    // в режимі 'logic' -- app/update-structure.ts -> domain switchLogicVariant.
    const query = structureDb({ structure: { ...STRUCTURE_ROW, layout_mode: 'free' } });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query } as unknown as Db, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/structure`, {
        method: 'PATCH',
        headers: AUTHED_JSON,
        body: JSON.stringify({ logicVariant: null }),
      });
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body).toMatchObject(ERROR_SHAPE);
      expect(body.code).toBe('structure.logic_variant_requires_logic_mode');
    } finally {
      server.close();
    }
  });
});

// --- AC-09: нова картка одразу отримує клітинку за замовчуванням ------------
//
// Review 2026-09-11 (MUST-FIX 6): `defaultPositionForNewCard` (domain) і
// `insertLayoutPosition` (infra) були написані й покриті юніт-тестами, але
// ЖОДЕН рядок production-коду їх не викликав -- нова картка не отримувала
// клітинки ніколи, тож AC-09 ("система ставить картку за замовчуванням, не
// змушуючи спершу обирати режим") у живому застосунку не виконувався.
//
// Колаборатор живе в composition root -- ЄДИНОМУ місці, де life-area-card і
// structure зустрічаються (ADR-0004), рівно як closeActiveLayoutPositionForCard
// для DELETE /cards/{id}. Тести нижче пінять не "функція передана", а реальний
// SQL, що доходить до межі db.query: номер клітинки, той самий `db` (тобто та
// сама транзакція) і тишу, коли Структури ще немає.

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
          throw new Error('duplicate key value violates unique constraint uq_layout_position_active_cell');
        }
        return { rows: [layoutPositionRow('inserted', 0)] };
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

describe('composition root -- POST /api/v1/cards дає новій картці клітинку (AC-09, review 2026-09-11 MUST-FIX 6)', () => {
  it('вставляє позицію в НАСТУПНУ вільну клітинку сітки, у тій самій транзакції', async () => {
    // Зайняті клітинки 0 і 3 -> defaultPositionForNewCard дає 4 (максимум + 1),
    // не 2 ("перша дірка") і не 0.
    const query = cardAndStructureDb({
      positions: [layoutPositionRow('card-a', 0), layoutPositionRow('card-b', 3)],
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
      // params: [id, structureId, cardId, cellIndex]
      expect(inserts[0][1][1]).toBe(STRUCTURE_ROW.id);
      expect(inserts[0][1][2]).toBe(CARD_ROW.id);
      expect(inserts[0][1][3]).toBe(4);
      // Один `withTransaction` на весь запит -- INSERT card + подія життєвого
      // циклу + INSERT позиції разом або ніяк.
      expect(transactions).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it('перша картка власника отримує клітинку 0', async () => {
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
      expect(layoutInserts(query)[0][1][3]).toBe(0);
    } finally {
      server.close();
    }
  });

  it('картки в треї (cell_index NULL) не зсувають наступну вільну клітинку', async () => {
    // Міграція 06: активна позиція без клітинки -- норма (AC-11b/AC-16b/AC-17).
    // Вона НЕ займає жодної клітинки, тож нова картка має піти в 1 (після
    // єдиної зайнятої клітинки 0), а не в 2.
    const tray = { ...layoutPositionRow('card-tray', 0), cell_index: null };
    const query = cardAndStructureDb({
      positions: [layoutPositionRow('card-a', 0), tray as unknown as ReturnType<typeof layoutPositionRow>],
    });
    const verifyJwt = vi.fn().mockResolvedValue({ sub: 'user-42' });
    const { server, baseUrl } = await startServer(noopDeps({ query } as unknown as Db, verifyJwt));

    try {
      const res = await fetch(`${baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: AUTHED_JSON,
        body: JSON.stringify({ name: 'Здоровʼя' }),
      });

      expect(res.status).toBe(201);
      expect(layoutInserts(query)[0][1][3]).toBe(1);
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
