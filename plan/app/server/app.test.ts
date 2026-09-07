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
});
