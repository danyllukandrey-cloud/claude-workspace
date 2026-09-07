// T31 -- наскрізні (cross-cutting) e2e-тести проти РЕАЛЬНОЇ Neon (той самий
// рівень, що migrations.integration.test.ts: npm run test:integration,
// DATABASE_URL(_POOLED) з ../../.env).
//
// Дві гарантії, які жоден окремий шар не перевіряє сам (t31-tests-cross-cutting.md DoD):
//   1. AC-04 non-disclosure: користувач A створює картку/запис через РЕАЛЬНИЙ
//      HTTP (composition root T30, server/app.ts) -- користувач B тим самим
//      HTTP жодним ендпоінтом (list/get card, list entries) не бачить чужого,
//      і форма відмови НЕ відрізняється від "картки не існує" (те саме
//      card.not_found, той самий 404) -- спроба зазирнути в чужу картку не
//      відрізняється зовні від спроби зазирнути в неіснуючу.
//   2. ADR-0001: офлайн-кешований запис (T11, infra/local-cache.ts) після
//      "підключення" (POST на реальний бекенд) прораховує ТОЧНО той самий
//      прогрес, що клієнтський domain/progress.ts порахував локально з кешу
//      ДО синхронізації -- жодне готове число ніколи не передається окремо,
//      обидві сторони рахують з сирих подій.
//
// JWT тут -- РЕАЛЬНІ jose-токени з фіктивним sub (не справжній Google-токен,
// verifyGoogleIdToken взагалі не викликається -- app_user-рядки для двох
// користувачів вставляються напряму в базу, той самий підхід, що
// migrations.integration.test.ts `withUser`). Перевірка самого Google
// ID-токена вже покрита юніт-тестами T30 (server/app.test.ts) -- поза обсягом
// цього файлу.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from 'pg';
import { SignJWT, jwtVerify } from 'jose';
import { createApp, type AppDeps, type JwtPayload } from './app';
import type { Db } from '../src/cards/life-area-card/infra/postgres-repo';
import type { StoragePort } from '../src/shared/storage/port';
import { cacheEntry, computeProgressFromCache } from '../src/cards/life-area-card/infra/local-cache';
import { createEntry as createDomainEntry } from '../src/cards/life-area-card/domain/entry';

const TEST_JWT_SECRET = new TextEncoder().encode('t31-integration-test-secret-do-not-use-in-prod-32bytes');

beforeAll(() => {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // уже завантажено (напр. --env-file прокинутий викликачем) -- ігноруємо
  }
});

async function signTestJwt(sub: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(TEST_JWT_SECRET);
}

async function verifyTestJwt(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, TEST_JWT_SECRET);
  if (typeof payload.sub !== 'string') {
    throw new Error('JWT без sub');
  }
  return { sub: payload.sub };
}

async function startServer(db: Db): Promise<{ server: http.Server; baseUrl: string }> {
  const deps: AppDeps = {
    db,
    // Прохідний no-op (жоден тест цього файлу не архівує картку) -- реальна
    // транзакційність через BEGIN/COMMIT/ROLLBACK перевіряється окремо
    // (server/db.test.ts, server/archive-transaction.integration.test.ts, T40).
    withTransaction: (fn) => fn(db),
    verifyGoogleIdToken: async () => {
      throw new Error('verifyGoogleIdToken не мав викликатись у T31 -- обидва користувачі заведені напряму в БД');
    },
    signJwt: async () => {
      throw new Error('signJwt не мав викликатись у T31 -- токени підписані signTestJwt() напряму в тесті');
    },
    verifyJwt: verifyTestJwt,
  };
  const app = createApp(deps);
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

/** Заглушка StoragePort для тесту -- та сама роль, що localStorage у браузері (ADR-0004, DI). */
function inMemoryStorage(): StoragePort {
  const store = new Map<string, unknown>();
  return {
    read: <T>(key: string) => (store.has(key) ? (store.get(key) as T) : null),
    write: <T>(key: string, value: T) => {
      store.set(key, value);
    },
    remove: (key: string) => {
      store.delete(key);
    },
  };
}

describe('T31 -- AC-04 non-disclosure через реальний HTTP (composition root T30), проти реальної Neon', () => {
  let client: Client;
  let ownerA: string;
  let ownerB: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    ownerA = crypto.randomUUID();
    ownerB = crypto.randomUUID();
    await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
      ownerA,
      `test-t31-a-${ownerA}`,
      't31-a@example.test',
    ]);
    await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
      ownerB,
      `test-t31-b-${ownerB}`,
      't31-b@example.test',
    ]);
  });

  afterAll(async () => {
    await client.query('DELETE FROM app_user WHERE id = ANY($1)', [[ownerA, ownerB]]); // каскадно прибирає card/entry
    await client.end();
  });

  it('user B жодним ендпоінтом не бачить картку/записи, створені user A -- та сама 404-форма, що для неіснуючої картки', async () => {
    const { server, baseUrl } = await startServer(client as unknown as Db);
    try {
      const tokenA = await signTestJwt(ownerA);
      const tokenB = await signTestJwt(ownerB);

      // User A створює картку + запис через реальний HTTP.
      const createCardRes = await fetch(`${baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ name: 'T31 owner A card' }),
      });
      expect(createCardRes.status).toBe(201);
      const cardA = await createCardRes.json();

      const createBlockRes = await fetch(`${baseUrl}/api/v1/cards/${cardA.id}/metric-blocks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ label: 'Пробіжки', unit: 'км', targetCount: 10 }),
      });
      expect(createBlockRes.status).toBe(201);
      const blockA = await createBlockRes.json();

      const createEntryRes = await fetch(
        `${baseUrl}/api/v1/cards/${cardA.id}/metric-blocks/${blockA.id}/entries`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenA}` },
          body: JSON.stringify({ amount: 5 }),
        }
      );
      expect(createEntryRes.status).toBe(201);

      // Референс: та сама форма відмови для картки, що СПРАВДІ не існує.
      const genuinelyMissingId = crypto.randomUUID();
      const missingRes = await fetch(`${baseUrl}/api/v1/cards/${genuinelyMissingId}`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      });
      const missingBody = await missingRes.json();

      // User B: GET на чужу картку -- та сама форма відмови (non-disclosure, AC-04).
      const getForeignRes = await fetch(`${baseUrl}/api/v1/cards/${cardA.id}`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      });
      const getForeignBody = await getForeignRes.json();

      // Не лише однаковий статус -- ТОЧНО той самий envelope.code, що для
      // картки, яка справді не існує (non-disclosure, AC-04): звідси не можна
      // дізнатись "картка є, але чужа" на відміну від "картки взагалі нема".
      expect(getForeignRes.status).toBe(missingRes.status);
      expect(getForeignRes.status).toBe(404);
      expect(getForeignBody.code).toBe(missingBody.code);
      expect(getForeignBody.code).toBe('card.not_found');

      // User B: list cards -- картка user A ніколи не з'являється в списку.
      const listRes = await fetch(`${baseUrl}/api/v1/cards`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      });
      const listBody = await listRes.json();
      expect(listRes.status).toBe(200);
      expect((listBody.items as Array<{ id: string }>).map((c) => c.id)).not.toContain(cardA.id);

      // User B: list entries чужої картки -- та сама non-disclosure форма, не окремий "forbidden".
      const entriesRes = await fetch(`${baseUrl}/api/v1/cards/${cardA.id}/entries`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      });
      const entriesBody = await entriesRes.json();
      expect(entriesRes.status).toBe(404);
      expect(entriesBody.code).toBe('card.not_found');
    } finally {
      server.close();
    }
  });
});

describe('T31 -- офлайн-кеш (T11) -> синхронізація -> прогрес клієнта == прогрес бекенда (ADR-0001), проти реальної Neon', () => {
  let client: Client;
  let ownerId: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL_POOLED });
    await client.connect();
    ownerId = crypto.randomUUID();
    await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
      ownerId,
      `test-t31-offline-${ownerId}`,
      't31-offline@example.test',
    ]);
  });

  afterAll(async () => {
    await client.query('DELETE FROM app_user WHERE id = $1', [ownerId]);
    await client.end();
  });

  it('запис, зроблений офлайн і синхронізований після підключення, дає client progress.ts === backend aggregateProgress', async () => {
    const { server, baseUrl } = await startServer(client as unknown as Db);
    try {
      const token = await signTestJwt(ownerId);

      // Картка + ціль (targetCount=10) через реальний HTTP -- та сама ціль,
      // яку клієнт кешує локально (D-106, local-cache.ts CachedMetricBlock).
      const createCardRes = await fetch(`${baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'T31 offline-sync card' }),
      });
      const card = await createCardRes.json();

      const createBlockRes = await fetch(`${baseUrl}/api/v1/cards/${card.id}/metric-blocks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ label: 'Медитація', unit: 'хвилини', targetCount: 10 }),
      });
      const block = await createBlockRes.json();

      // --- Офлайн: запис іде в local-cache.ts (T11), мережі немає -----------
      const storage = inMemoryStorage();
      const offlineEntry = createDomainEntry({ id: crypto.randomUUID(), metricBlockId: block.id, amount: 4 });
      cacheEntry(storage, card.id, offlineEntry);

      const goal = { targetCount: block.targetCount as number, isOngoing: block.isOngoing as boolean };
      const clientProgressBeforeSync = computeProgressFromCache(storage, card.id, block.id, goal);
      // Клієнт локально вважає цей запис confirmed (createEntry без needsReview,
      // domain/entry.ts) -- те саме допущення для "звичайного" офлайн-запису.
      expect(clientProgressBeforeSync).toMatchObject({ kind: 'bounded', share: 0.4 });

      // --- "Підключення": офлайн-запис синхронізується на реальний бекенд ---
      const syncRes = await fetch(
        `${baseUrl}/api/v1/cards/${card.id}/metric-blocks/${block.id}/entries`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ amount: offlineEntry.amount }),
        }
      );
      expect(syncRes.status).toBe(201);
      const syncedEntry = await syncRes.json();
      // Синхронізований запис реально дійшов до "confirmed" стану на бекенді --
      // не лишився pending (AC-11 стосується лише конфліктних/неперевірених
      // записів, тут єдиний запис на цей блок).
      expect(syncedEntry.status).toBe('confirmed');

      // --- Бекенд рахує прогрес НАПРЯМУ з сирих подій (ADR-0001) -- НІКОЛИ
      // не приймає готове число з клієнта; порівнюємо результат після синку. ---
      const getCardRes = await fetch(`${baseUrl}/api/v1/cards/${card.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const cardWithProgress = await getCardRes.json();

      expect(cardWithProgress.aggregateProgress).toBe(clientProgressBeforeSync.kind === 'bounded' ? clientProgressBeforeSync.share : null);
    } finally {
      server.close();
    }
  });
});
