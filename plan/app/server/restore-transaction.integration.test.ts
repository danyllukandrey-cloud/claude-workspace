// Fix 2026-09-21 (живе тестування, картка "Філософія"): доказ на рівні
// РЕАЛЬНОГО HTTP, що POST /api/v1/cards/{cardId}/restore через справжню
// composition root (server/app.ts + server/db.ts) відкриває ЗАКРИТУ позицію
// картки в structure_layout_position знову -- дзеркало
// archive-transaction.integration.test.ts (T40, A2/B5), той самий клас
// доказу для протилежного напрямку (архів -> розархів, не лише архів).
//
// Симптом до фіксу: картка, архівована й розархівована хоч раз, назавжди
// відповідала structure.card_not_found на PUT /structure/layout/{cardId}
// (перетягування) і POST /structure/connections (звʼязування) -- moveCard/
// createConnection обидва фільтрують на status='active', а нічого не
// відкривало закриту позицію назад. Цей тест доводить кінець-в-кінець: після
// архів->розархів позиція знову активна (без старих x/y, D-69), і
// перетягування знову працює.
//
// Використовує РЕАЛЬНИЙ createDb()/withTransaction (server/db.ts) проти
// реальної Neon -- той самий обʼєкт, що server/index.ts реально вмонтовує.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, jwtVerify } from 'jose';
import { createApp, type AppDeps, type JwtPayload } from './app';
import { createDb, type DbWithTransaction } from './db';

const TEST_JWT_SECRET = new TextEncoder().encode('restore-integration-test-secret-do-not-use-in-prod-32b');

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

describe('Fix 2026-09-21 -- реальний HTTP POST /api/v1/cards/{cardId}/restore відкриває structure_layout_position знову, проти реальної Neon', () => {
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
        throw new Error('verifyGoogleIdToken не мав викликатись -- користувач заведений напряму в БД');
      },
      signJwt: async () => {
        throw new Error('signJwt не мав викликатись -- токен підписаний signTestJwt() напряму в тесті');
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
      `test-restore-${ownerId}`,
      'restore@example.test',
    ]);
  });

  afterAll(async () => {
    server.close();
    await db.query('DELETE FROM app_user WHERE id = $1', [ownerId]); // каскадно прибирає card/structure/structure_layout_position
    await db.end();
  });

  it('архів -> розархів відкриває позицію знову (без старих x/y) і дозволяє знову перетягнути картку', async () => {
    const token = await signTestJwt(ownerId);

    const createCardRes = await fetch(`${baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Restore-fix laid-out card' }),
    });
    expect(createCardRes.status).toBe(201);
    const card = await createCardRes.json();

    // structure своєї власної черги /sdd:implement ще не пройшла -- єдиний
    // спосіб отримати рядок structure_layout_position той самий, що
    // archive-transaction.integration.test.ts: пряма вставка через SQL,
    // цього разу з РЕАЛЬНИМИ (ненульовими) x/y -- щоб перевірити, що вони
    // скидаються в NULL при відкритті, а не переносяться зі старого місця
    // (D-69: "жодна стара позиція не мапиться автоматично").
    const structureId = crypto.randomUUID();
    const positionId = crypto.randomUUID();
    await db.query('INSERT INTO structure (id, owner_user_id) VALUES ($1, $2)', [structureId, ownerId]);
    await db.query(
      'INSERT INTO structure_layout_position (id, structure_id, card_id, position_x, position_y) VALUES ($1, $2, $3, 42, 17)',
      [positionId, structureId, card.id]
    );

    const deleteRes = await fetch(`${baseUrl}/api/v1/cards/${card.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleteRes.status).toBe(200);

    const closedRow = await db.query<{ status: string }>(
      'SELECT status FROM structure_layout_position WHERE id = $1',
      [positionId]
    );
    expect(closedRow.rows[0].status).toBe('closed');

    // Без фіксу: перетягнути картку зараз -- 404 structure.card_not_found
    // (бо УМОВА до фіксу лишила б рядок 'closed' навіки). Перевіряємо ЦЕ
    // прямо, а не лише статус рядка -- саме цей HTTP-виклик і провалявся в
    // живому тестуванні ("Не вдалося зберегти позицію -- мережева помилка").
    const restoreRes = await fetch(`${baseUrl}/api/v1/cards/${card.id}/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(restoreRes.status).toBe(200);
    const restoredCard = await restoreRes.json();
    expect(restoredCard.status).toBe('active');

    const reopenedRow = await db.query<{ status: string; position_x: number | null; position_y: number | null }>(
      'SELECT status, position_x, position_y FROM structure_layout_position WHERE id = $1',
      [positionId]
    );
    expect(reopenedRow.rows[0].status).toBe('active');
    expect(reopenedRow.rows[0].position_x).toBeNull();
    expect(reopenedRow.rows[0].position_y).toBeNull();

    // Кінець-в-кінець доказ: та сама дія, що провалювалась у живому
    // тестуванні (PUT .../structure/layout/{cardId}) тепер проходить.
    const moveRes = await fetch(`${baseUrl}/api/v1/structure/layout/${card.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ x: 30, y: 40, positionUpdatedAt: new Date().toISOString() }),
    });
    expect(moveRes.status).toBe(200);
    const moved = await moveRes.json();
    expect(moved.x).toBe(30);
    expect(moved.y).toBe(40);
  });

  it('розархівація картки БЕЗ жодної закритої позиції не падає (нема що відкривати)', async () => {
    const token = await signTestJwt(ownerId);

    const createCardRes = await fetch(`${baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Restore-fix unlaid card' }),
    });
    const card = await createCardRes.json();

    const deleteRes = await fetch(`${baseUrl}/api/v1/cards/${card.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleteRes.status).toBe(200);

    const restoreRes = await fetch(`${baseUrl}/api/v1/cards/${card.id}/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(restoreRes.status).toBe(200);
    const restoredCard = await restoreRes.json();
    expect(restoredCard.status).toBe('active');
  });
});
