// T42 (review 2026-09-07 A3): доказ на рівні реального HTTP, що GET
// /api/v1/cards/{cardId} реально передає callClaude у getCard (раніше -- ніколи,
// dataWarning був НАЗАВЖДИ недосяжний у production) і що відхилення цього
// виклику fail-open (test-plan.md, "Claude API unavailable -> card still opens,
// no dataWarning, no user-facing error"), а не 500.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, jwtVerify } from 'jose';
import { createApp, type AppDeps, type JwtPayload } from './app';
import { createDb, type DbWithTransaction } from './db';

const TEST_JWT_SECRET = new TextEncoder().encode('t42-integration-test-secret-do-not-use-in-prod-32b');

beforeAll(() => {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // уже завантажено -- ігноруємо
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

describe('T42 -- GET /api/v1/cards/{cardId} реально викликає callClaude, fail-open на відмову (A3), проти реальної Neon', () => {
  let db: DbWithTransaction;
  let server: http.Server;
  let baseUrl: string;
  let ownerId: string;
  let callClaudeCallCount = 0;

  beforeAll(async () => {
    db = createDb();

    const deps: AppDeps = {
      db,
      withTransaction: db.withTransaction,
      // Заглушка, що ЗАВЖДИ відхиляється -- симулює недоступний Claude API
      // (мережевий збій, відсутній ключ тощо), рахує виклики, щоб довести, що
      // wiring реально дійшов до неї (а не мовчки пропустив callClaude).
      callClaude: async () => {
        callClaudeCallCount += 1;
        throw new Error('T42 injected failure -- Claude API недоступний, симуляція');
      },
      verifyGoogleIdToken: async () => {
        throw new Error('verifyGoogleIdToken не мав викликатись у T42');
      },
      signJwt: async () => {
        throw new Error('signJwt не мав викликатись у T42');
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
      `test-t42-${ownerId}`,
      't42@example.test',
    ]);
  });

  afterAll(async () => {
    server.close();
    await db.query('DELETE FROM app_user WHERE id = $1', [ownerId]);
    await db.end();
  });

  it('картка відкривається (200) з dataWarning=null, попри те що callClaude щоразу відхиляється', async () => {
    const token = await signTestJwt(ownerId);

    const createCardRes = await fetch(`${baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'T42 fail-open card' }),
    });
    const card = await createCardRes.json();

    const callCountBefore = callClaudeCallCount;
    const getCardRes = await fetch(`${baseUrl}/api/v1/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await getCardRes.json();

    expect(getCardRes.status).toBe(200);
    expect(body.dataWarning).toBeNull();
    // Доказ, що wiring реально дійшов до callClaude (не просто "поле є, але
    // ніхто його не читає") -- саме розрив, що знайшло A3.
    expect(callClaudeCallCount).toBe(callCountBefore + 1);
  });
});
