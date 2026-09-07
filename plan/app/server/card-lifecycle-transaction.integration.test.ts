// Review 2026-09-07, post-ship follow-up review (B5 remainder): T40/T41
// wrapped archiveCard/transferMetricBlock/createEntry in deps.withTransaction,
// but three sibling write-pairs -- createCard, updateCard(markFilled:true),
// restoreCard -- each still did their row write and insertLifecycleEvent as
// two INDEPENDENT statements on the plain (non-transactional) deps.db. A
// failure of the second write silently loses the 'created'/'filled'/
// 'restored' audit row spec.md §7 KPIs are computed from, while the first
// write (card/status row) persists -- exactly the "напівзроблений стан" T41
// already proved unacceptable for the other three write-pairs.
//
// Same fault-injection technique as entry-transfer-transaction.integration.test.ts
// (T41): a REAL withTransaction (real BEGIN/COMMIT/ROLLBACK against Neon),
// wrapped so one specific query text throws -- proves true atomicity without
// needing to naturally trigger a DB error. Each test uses its OWN server so
// the injected failure only affects the call under test, not setup calls
// that happen to share the same route.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, jwtVerify } from 'jose';
import { createApp, type AppDeps, type JwtPayload } from './app';
import { createDb, type DbWithTransaction } from './db';
import type { Db } from '../src/cards/life-area-card/infra/postgres-repo';

const TEST_JWT_SECRET = new TextEncoder().encode('lifecycle-tx-integration-test-secret-do-not-use-32b');

beforeAll(() => {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // уже завантажено
  }
});

async function signTestJwt(sub: string): Promise<string> {
  return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setIssuedAt().setExpirationTime('1h').sign(TEST_JWT_SECRET);
}

async function verifyTestJwt(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, TEST_JWT_SECRET);
  if (typeof payload.sub !== 'string') throw new Error('JWT без sub');
  return { sub: payload.sub };
}

/** Той самий підхід, що T41 (entry-transfer-transaction.integration.test.ts). */
function withInjectedFailure(realDb: DbWithTransaction, failingQueryMatch: string): AppDeps['withTransaction'] {
  return (fn) =>
    realDb.withTransaction(async (txDb) => {
      const interceptingTxDb: Db = {
        query: async (text, params) => {
          if (text.includes(failingQueryMatch)) {
            throw new Error(`injected failure -- query matching "${failingQueryMatch}" simulated failing mid-transaction`);
          }
          return txDb.query(text, params);
        },
      };
      return fn(interceptingTxDb);
    });
}

function noopSocialDeps(db: Db, withTransaction: AppDeps['withTransaction']): AppDeps {
  return {
    db,
    withTransaction,
    verifyGoogleIdToken: async () => {
      throw new Error('verifyGoogleIdToken не мав викликатись у цьому тесті');
    },
    signJwt: async () => {
      throw new Error('signJwt не мав викликатись у цьому тесті');
    },
    verifyJwt: verifyTestJwt,
  };
}

async function startServer(deps: AppDeps): Promise<{ server: http.Server; baseUrl: string }> {
  const app = createApp(deps);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

describe('review-followup B5 remainder -- createCard/updateCard(markFilled)/restoreCard реально атомарні, проти реальної Neon', () => {
  let db: DbWithTransaction;
  let ownerId: string;

  beforeAll(async () => {
    db = createDb();
    ownerId = crypto.randomUUID();
    await db.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
      ownerId,
      `test-lifecycle-tx-${ownerId}`,
      'lifecycle-tx@example.test',
    ]);
  });

  afterAll(async () => {
    await db.query('DELETE FROM app_user WHERE id = $1', [ownerId]); // каскадно прибирає card/metric_block/entry
    await db.end();
  });

  it('createCard: штучний збій insertLifecycleEvent ("created") відкочує і щойно вставлений рядок card', async () => {
    const deps = noopSocialDeps(db, withInjectedFailure(db, 'INSERT INTO card_lifecycle_event'));
    const { server, baseUrl } = await startServer(deps);
    try {
      const token = await signTestJwt(ownerId);

      const { rows: before } = await db.query<{ count: string }>('SELECT count(*)::text FROM card WHERE owner_user_id = $1', [
        ownerId,
      ]);

      const res = await fetch(`${baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'B5 remainder -- createCard' }),
      });
      expect(res.status).toBe(500); // помилка не AppError -- generic-гілка error-middleware

      // Якби транзакції не було, insertCard устиг би пройти і рядок card
      // лишився б сиротою -- без жодної події "created" у Літописі.
      const { rows: after } = await db.query<{ count: string }>('SELECT count(*)::text FROM card WHERE owner_user_id = $1', [
        ownerId,
      ]);
      expect(after[0].count).toBe(before[0].count);
    } finally {
      server.close();
    }
  });

  it('updateCard(markFilled:true): штучний збій insertLifecycleEvent ("filled") відкочує і щойно записаний Опис', async () => {
    // Сетап -- ЧИСТИЙ сервер (жодного впровадженого збою), картка вже має
    // Опис, але ще НЕ позначена заповненою -- готуємо кандидата для markFilled.
    const cleanDeps = noopSocialDeps(db, (fn) => db.withTransaction(fn));
    const setup = await startServer(cleanDeps);
    let cardId: string;
    try {
      const token = await signTestJwt(ownerId);
      const createRes = await fetch(`${setup.baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'B5 remainder -- updateCard' }),
      });
      cardId = (await createRes.json()).id;
    } finally {
      setup.server.close();
    }

    const deps = noopSocialDeps(db, withInjectedFailure(db, 'INSERT INTO card_lifecycle_event'));
    const { server, baseUrl } = await startServer(deps);
    try {
      const token = await signTestJwt(ownerId);

      const res = await fetch(`${baseUrl}/api/v1/cards/${cardId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ description: 'Регулярні тренування', markFilled: true }),
      });
      expect(res.status).toBe(500);

      // Якби транзакції не було, updateCard (перший запис пари) устиг би
      // пройти: Опис лежав би вже збереженим, попри те, що подія "filled"
      // ніколи не записалась -- саме "напівзроблений стан" проти якого B5.
      const { rows } = await db.query<{ description: string | null }>('SELECT description FROM card WHERE id = $1', [cardId]);
      expect(rows[0].description).toBeNull();
    } finally {
      server.close();
    }
  });

  it('restoreCard: штучний збій insertLifecycleEvent ("restored") відкочує status назад в archived', async () => {
    // Сетап -- ЧИСТИЙ сервер: створюємо й одразу архівуємо картку.
    const cleanDeps = noopSocialDeps(db, (fn) => db.withTransaction(fn));
    const setup = await startServer(cleanDeps);
    let cardId: string;
    try {
      const token = await signTestJwt(ownerId);
      const createRes = await fetch(`${setup.baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'B5 remainder -- restoreCard' }),
      });
      cardId = (await createRes.json()).id;
      const archiveRes = await fetch(`${setup.baseUrl}/api/v1/cards/${cardId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(archiveRes.status).toBe(200);
    } finally {
      setup.server.close();
    }

    const deps = noopSocialDeps(db, withInjectedFailure(db, 'INSERT INTO card_lifecycle_event'));
    const { server, baseUrl } = await startServer(deps);
    try {
      const token = await signTestJwt(ownerId);

      const res = await fetch(`${baseUrl}/api/v1/cards/${cardId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(500);

      // Якби транзакції не було, updateCard (status: 'active') устиг би
      // пройти, попри те, що подія "restored" ніколи не записалась.
      const { rows } = await db.query<{ status: string }>('SELECT status FROM card WHERE id = $1', [cardId]);
      expect(rows[0].status).toBe('archived');
    } finally {
      server.close();
    }
  });
});
