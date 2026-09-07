// T41 (review 2026-09-07 B5, remainder): доказ на рівні РЕАЛЬНОГО HTTP проти
// реальної Neon, що createEntry's conflict-pair write і transferMetricBlock's
// block+entries reassignment реально атомарні -- не лише "перший запис
// пройшов, другий не пройшов, стан лишився напівзробленим" (DoD T41: "an
// injected mid-write failure leaves no partial state").
//
// Техніка (той самий підхід, що DI StoragePort/callClaude в цьому проєкті):
// РЕАЛЬНИЙ createDb()/withTransaction (server/db.ts, справжні BEGIN/COMMIT/
// ROLLBACK проти Neon), обгорнутий так, щоб ОДИН конкретний SQL-запит
// усередині транзакції штучно впав -- симулює "другий запис не пройшов" без
// потреби виловлювати природну помилку БД. Після падіння перевіряємо стан
// НАПРЯМУ через окремий чистий db.query (не через withTransaction) -- якщо
// відкат реальний, перший запис теж не мав лишитись.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, jwtVerify } from 'jose';
import { createApp, type AppDeps, type JwtPayload } from './app';
import { createDb, type DbWithTransaction } from './db';
import type { Db } from '../src/cards/life-area-card/infra/postgres-repo';

const TEST_JWT_SECRET = new TextEncoder().encode('t41-integration-test-secret-do-not-use-in-prod-32b');

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

/**
 * Реальна транзакція (server/db.ts, справжній BEGIN/COMMIT/ROLLBACK проти
 * Neon), але будь-який запит усередині, чий текст містить `failingQueryMatch`,
 * штучно кидає -- симулює "другий запис у парі не пройшов" (мережевий збій,
 * timeout тощо), не покладаючись на природну помилку БД.
 */
function withInjectedFailure(realDb: DbWithTransaction, failingQueryMatch: string): AppDeps['withTransaction'] {
  return (fn) =>
    realDb.withTransaction(async (txDb) => {
      const interceptingTxDb: Db = {
        query: async (text, params) => {
          if (text.includes(failingQueryMatch)) {
            throw new Error(`T41 injected failure -- query matching "${failingQueryMatch}" simulated failing mid-transaction`);
          }
          return txDb.query(text, params);
        },
      };
      return fn(interceptingTxDb);
    });
}

async function startServer(deps: AppDeps): Promise<{ server: http.Server; baseUrl: string }> {
  const app = createApp(deps);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

describe('T41 -- createEntry конфліктна пара і transferMetricBlock реально атомарні (B5), проти реальної Neon', () => {
  let db: DbWithTransaction;
  let ownerId: string;

  beforeAll(async () => {
    db = createDb();
    ownerId = crypto.randomUUID();
    await db.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
      ownerId,
      `test-t41-${ownerId}`,
      't41@example.test',
    ]);
  });

  afterAll(async () => {
    await db.query('DELETE FROM app_user WHERE id = $1', [ownerId]); // каскадно прибирає card/metric_block/entry
    await db.end();
  });

  it('createEntry: штучний збій updateEntryStatus (друга частина пари, AC-06) відкочує і щойно вставлений конфліктний запис', async () => {
    const deps: AppDeps = {
      db,
      withTransaction: withInjectedFailure(db, 'SET status = $1'), // updateEntryStatus (postgres-repo.ts)
      verifyGoogleIdToken: async () => {
        throw new Error('verifyGoogleIdToken не мав викликатись у T41');
      },
      signJwt: async () => {
        throw new Error('signJwt не мав викликатись у T41');
      },
      verifyJwt: verifyTestJwt,
    };
    const { server, baseUrl } = await startServer(deps);
    try {
      const token = await signTestJwt(ownerId);

      const createCardRes = await fetch(`${baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'T41 conflict-pair card' }),
      });
      const card = await createCardRes.json();

      const createBlockRes = await fetch(`${baseUrl}/api/v1/cards/${card.id}/metric-blocks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ label: 'Читання', unit: 'сторінки', targetCount: 1000 }),
      });
      const block = await createBlockRes.json();

      // Перший запис -- жодного конфлікту (це взагалі перший запис на блок),
      // проходить транзакцію без жодного перехопленого запиту -- звичайний
      // 'confirmed'. Той самий шлях, що деінде в проєкті, тут лише готує
      // конфліктного кандидата для другого запиту.
      const firstEntryRes = await fetch(
        `${baseUrl}/api/v1/cards/${card.id}/metric-blocks/${block.id}/entries`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ amount: 10, sourceDeviceId: 'device-A' }),
        }
      );
      expect(firstEntryRes.status).toBe(201);
      const firstEntry = await firstEntryRes.json();
      expect(firstEntry.status).toBe('confirmed');

      // Другий запис, інший пристрій, у тому самому "вікні близькості" (< 60с
      // за замовчуванням, domain/conflict.ts) -- detectConflict знаходить
      // конфлікт із першим (confirmed) записом, тож createEntry МАЄ і
      // вставити новий (pending), і перевести перший на pending -- саме
      // друга дія тут штучно падає.
      const secondEntryRes = await fetch(
        `${baseUrl}/api/v1/cards/${card.id}/metric-blocks/${block.id}/entries`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ amount: 5, sourceDeviceId: 'device-B' }),
        }
      );
      expect(secondEntryRes.status).toBe(500); // помилка не AppError -- generic-гілка error-middleware

      // Реальний стан у базі (окремим, неперехопленим db.query) -- РІВНО один
      // запис (перший), і він і далі 'confirmed'. Якби transactions не було,
      // тут лежало б ДВА записи: перший 'confirmed' (мав стати 'pending') і
      // другий 'pending' (мав НЕ зʼявитись, бо друга частина пари впала) --
      // саме той "напівзроблений" стан, проти якого T41.
      const { rows } = await db.query<{ id: string; status: string }>(
        'SELECT id, status FROM entry WHERE metric_block_id = $1 ORDER BY created_at',
        [block.id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: firstEntry.id, status: 'confirmed' });
    } finally {
      server.close();
    }
  });

  it('transferMetricBlock: штучний збій reassignEntriesToCard (друга частина пари, AC-14) відкочує і updateMetricBlock', async () => {
    const deps: AppDeps = {
      db,
      withTransaction: withInjectedFailure(db, 'UPDATE entry SET card_id'), // reassignEntriesToCard (postgres-repo.ts)
      verifyGoogleIdToken: async () => {
        throw new Error('verifyGoogleIdToken не мав викликатись у T41');
      },
      signJwt: async () => {
        throw new Error('signJwt не мав викликатись у T41');
      },
      verifyJwt: verifyTestJwt,
    };
    const { server, baseUrl } = await startServer(deps);
    try {
      const token = await signTestJwt(ownerId);

      const sourceCardRes = await fetch(`${baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'T41 transfer -- джерело' }),
      });
      const sourceCard = await sourceCardRes.json();

      const targetCardRes = await fetch(`${baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'T41 transfer -- призначення' }),
      });
      const targetCard = await targetCardRes.json();

      const createBlockRes = await fetch(`${baseUrl}/api/v1/cards/${sourceCard.id}/metric-blocks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ label: 'Пробіжки', unit: 'км', targetCount: 50 }),
      });
      const block = await createBlockRes.json();

      const createEntryRes = await fetch(
        `${baseUrl}/api/v1/cards/${sourceCard.id}/metric-blocks/${block.id}/entries`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ amount: 3 }),
        }
      );
      const entry = await createEntryRes.json();

      const transferRes = await fetch(`${baseUrl}/api/v1/cards/${targetCard.id}/metric-blocks/transfer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sourceMetricBlockId: block.id }),
      });
      expect(transferRes.status).toBe(500); // помилка не AppError -- generic-гілка error-middleware

      // Реальний стан -- окремим, неперехопленим db.query. Якби транзакції не
      // було, updateMetricBlock (перший запис пари) устиг би пройти: блок
      // показував би targetCardId, а його запис -- і далі старий card_id
      // (денормалізація розійшлась би, саме AC-14, проти якого T41).
      const { rows: blockRows } = await db.query<{ card_id: string }>(
        'SELECT card_id FROM metric_block WHERE id = $1',
        [block.id]
      );
      expect(blockRows[0].card_id).toBe(sourceCard.id);

      const { rows: entryRows } = await db.query<{ card_id: string }>(
        'SELECT card_id FROM entry WHERE id = $1',
        [entry.id]
      );
      expect(entryRows[0].card_id).toBe(sourceCard.id);
    } finally {
      server.close();
    }
  });
});
