// T40 (review 2026-09-07 A2/B5): доказ на рівні РЕАЛЬНОГО HTTP, що DELETE
// /api/v1/cards/{cardId} через справжню composition root (server/app.ts +
// server/db.ts) закриває активну позицію картки в structure_layout_position
// -- не лише коли closeActiveLayoutPositionForCard переданий напряму у
// виклик use-case (те, що вже перевіряв migrations.integration.test.ts, блок
// "D-69/D-103 (закриває ISS-26)"). Рев'ю (A2) якраз і знайшло розрив між
// цими двома: use-case підтримував колаборатор, але production-wiring
// (server/app.ts) його НІКОЛИ не передавав -- нижчий тест проходив, а
// реальний застосунок нічого не закривав.
//
// Використовує РЕАЛЬНИЙ createDb()/withTransaction (server/db.ts) проти
// реальної Neon -- той самий обʼєкт, що server/index.ts реально вмонтовує,
// не саморобний дублікат транзакційної логіки лише для тесту.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, jwtVerify } from 'jose';
import { createApp, type AppDeps, type JwtPayload } from './app';
import { createDb, type DbWithTransaction } from './db';

const TEST_JWT_SECRET = new TextEncoder().encode('t40-integration-test-secret-do-not-use-in-prod-32b');

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

describe('T40 -- реальний HTTP DELETE /api/v1/cards/{cardId} закриває structure_layout_position (A2/B5), проти реальної Neon', () => {
  let db: DbWithTransaction;
  let server: http.Server;
  let baseUrl: string;
  let ownerId: string;

  beforeAll(async () => {
    db = createDb();

    const deps: AppDeps = {
      db,
      withTransaction: db.withTransaction,
      verifyGoogleIdToken: async () => {
        throw new Error('verifyGoogleIdToken не мав викликатись у T40 -- користувач заведений напряму в БД');
      },
      signJwt: async () => {
        throw new Error('signJwt не мав викликатись у T40 -- токен підписаний signTestJwt() напряму в тесті');
      },
      verifyJwt: verifyTestJwt,
    };
    const app = createApp(deps);
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    ownerId = crypto.randomUUID();
    await db.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
      ownerId,
      `test-t40-${ownerId}`,
      't40@example.test',
    ]);
  });

  afterAll(async () => {
    server.close();
    await db.query('DELETE FROM app_user WHERE id = $1', [ownerId]); // каскадно прибирає card/structure/structure_layout_position
    await db.end();
  });

  it('архівує картку і закриває її активну позицію в тій самій дії, через реальний composition root', async () => {
    const token = await signTestJwt(ownerId);

    const createCardRes = await fetch(`${baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'T40 laid-out card' }),
    });
    expect(createCardRes.status).toBe(201);
    const card = await createCardRes.json();

    // structure своєї власної черги /sdd:implement ще не пройшла -- єдиний спосіб
    // отримати рядок structure_layout_position той самий, що
    // migrations.integration.test.ts D-69/D-103: пряма вставка через SQL.
    const structureId = crypto.randomUUID();
    const positionId = crypto.randomUUID();
    await db.query('INSERT INTO structure (id, owner_user_id) VALUES ($1, $2)', [structureId, ownerId]);
    await db.query(
      'INSERT INTO structure_layout_position (id, structure_id, card_id, position_x, position_y) VALUES ($1, $2, $3, 0, 0)',
      [positionId, structureId, card.id]
    );

    const deleteRes = await fetch(`${baseUrl}/api/v1/cards/${card.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleteRes.status).toBe(200);
    const archivedCard = await deleteRes.json();
    expect(archivedCard.status).toBe('archived');

    const { rows } = await db.query<{ status: string }>(
      'SELECT status FROM structure_layout_position WHERE id = $1',
      [positionId]
    );
    expect(rows[0].status).toBe('closed');
  });

  it('картка без жодної позиції в розкладці архівується нормально через реальний HTTP (нема що закривати)', async () => {
    const token = await signTestJwt(ownerId);

    const createCardRes = await fetch(`${baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'T40 unlaid card' }),
    });
    const card = await createCardRes.json();

    const deleteRes = await fetch(`${baseUrl}/api/v1/cards/${card.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleteRes.status).toBe(200);
    const archivedCard = await deleteRes.json();
    expect(archivedCard.status).toBe('archived');
  });
});
