// RED (T30/D-109): POST /api/v1/session -- ADR-0006 §Додаток: Ендпоінт сесії.
//
// Обмін Google ID-токена на власний JWT. Не входить у openapi.yaml жодної
// product-фічі (D-109) -- форма запиту/відповіді й помилки взяті буквально
// з ADR-0006 §Додаток нижче, не вигадані тут.
//
// Unit tier: жодного реального виклику google-auth-library чи мережі --
// verifyGoogleIdToken і signJwt injected/mockable, той самий підхід, що
// app.test.ts. 'jose'/'google-auth-library' у package.json ще немає
// (ADR-0006 §Рішення перелічує їх як заплановані рантайм-залежності) --
// composition root підключить їх реалізацію, тест лишається незалежним від
// конкретної бібліотеки.
//
// createApp ще не існує (server/app.ts) -- цей файл мусить впасти на
// "Cannot find module './app'" (GOOD red), не на асерції всередині тестів.

import { describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, type AppDeps } from './app';
import type { Db } from '../src/cards/life-area-card/infra/postgres-repo';

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

// app_user, апсертнутий кроком 2 хендлера (ADR-0006 §Додаток, п.2) -- рядок,
// який поверне query() для INSERT ... ON CONFLICT ... RETURNING id, email.
const APP_USER_ROW = { id: 'app-user-1', email: 'andrii@example.com' };

describe('POST /api/v1/session -- Google ID token -> власний JWT (D-109)', () => {
  it('exchanges a valid Google ID token for {token, expiresAt, user} exactly per ADR-0006 appendix', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [APP_USER_ROW] });
    const db: Db = { query };
    const verifyGoogleIdToken = vi.fn().mockResolvedValue({ sub: 'google-sub-1', email: 'andrii@example.com' });
    const signJwt = vi.fn().mockResolvedValue({ token: 'signed.jwt.token', expiresAt: '2026-09-07T00:00:00.000Z' });

    const { server, baseUrl } = await startServer({
      db,
      verifyGoogleIdToken,
      signJwt,
      verifyJwt: vi.fn(),
    });

    try {
      const res = await fetch(`${baseUrl}/api/v1/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ googleIdToken: 'a-valid-google-id-token' }),
      });
      const body = await res.json();

      expect(verifyGoogleIdToken).toHaveBeenCalledWith('a-valid-google-id-token');
      // sub = app_user.id (ADR-0006 §Обґрунтування: "у токені потрібен НАШ ідентифікатор").
      expect(signJwt).toHaveBeenCalledWith(expect.objectContaining({ sub: 'app-user-1' }));

      expect(res.status).toBe(200);
      expect(body).toEqual({
        token: 'signed.jwt.token',
        expiresAt: '2026-09-07T00:00:00.000Z',
        user: { id: 'app-user-1', email: 'andrii@example.com' },
      });
    } finally {
      server.close();
    }
  });

  it('rejects an invalid/expired Google ID token with 401 {code: "auth.invalid_google_token"}', async () => {
    const query = vi.fn();
    const db: Db = { query };
    const verifyGoogleIdToken = vi.fn().mockRejectedValue(new Error('Wrong number of segments in token'));
    const signJwt = vi.fn();

    const { server, baseUrl } = await startServer({
      db,
      verifyGoogleIdToken,
      signJwt,
      verifyJwt: vi.fn(),
    });

    try {
      const res = await fetch(`${baseUrl}/api/v1/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ googleIdToken: 'not-a-real-google-token' }),
      });
      const body = await res.json();

      expect(res.status).toBe(401);
      // ADR-0006 §Додаток: envelope помилки -- { code: 'auth.invalid_google_token', message }.
      expect(body).toEqual({ code: 'auth.invalid_google_token', message: expect.any(String) });
      expect(query).not.toHaveBeenCalled();
      expect(signJwt).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it('does not require a Bearer token (POST /api/v1/session is the one route without BearerAuth)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [APP_USER_ROW] });
    const db: Db = { query };
    const verifyGoogleIdToken = vi.fn().mockResolvedValue({ sub: 'google-sub-1', email: 'andrii@example.com' });
    const signJwt = vi.fn().mockResolvedValue({ token: 'signed.jwt.token', expiresAt: '2026-09-07T00:00:00.000Z' });
    const verifyJwt = vi.fn();

    const { server, baseUrl } = await startServer({ db, verifyGoogleIdToken, signJwt, verifyJwt });

    try {
      // Немає Authorization header взагалі -- на відміну від /api/v1/cards, це не 401.
      const res = await fetch(`${baseUrl}/api/v1/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ googleIdToken: 'a-valid-google-id-token' }),
      });

      expect(res.status).toBe(200);
      expect(verifyJwt).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });
});
