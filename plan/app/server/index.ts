// Реальний composition root (T30) -- єдине місце, де AppDeps (app.ts) отримують
// справжні реалізації: pg.Pool (db.ts), google-auth-library, jose. Тонкий
// навмисно (ADR-0006 §Рішення) -- уся логіка вже в app.ts/ports/*.ts/app/*.ts,
// тут лише монтаж і app.listen(). НЕ юніт-тестується (реальна мережа/БД/Google) --
// покриття цього файлу дає npm run test:integration + ручний прогін.

import { SignJWT, jwtVerify } from 'jose';
import { OAuth2Client } from 'google-auth-library';
import { createApp, type GoogleIdTokenPayload, type JwtPayload } from './app';
import { createDb } from './db';

const PORT = Number(process.env.PORT ?? 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET не задано (.env) -- потрібен для підпису/перевірки власного JWT (ADR-0006 §Додаток)');
}
if (!GOOGLE_CLIENT_ID) {
  throw new Error('GOOGLE_CLIENT_ID не задано (.env) -- потрібен як audience для verifyIdToken');
}

const secretKey = new TextEncoder().encode(JWT_SECRET);
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

async function verifyGoogleIdToken(googleIdToken: string): Promise<GoogleIdTokenPayload> {
  const ticket = await googleClient.verifyIdToken({ idToken: googleIdToken, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error('Google ID-токен без sub/email');
  }
  return { sub: payload.sub, email: payload.email };
}

async function signJwt(payload: JwtPayload): Promise<{ token: string; expiresAt: string }> {
  // exp = now + 24h (ADR-0006 §Додаток, п.3 -- TTL, інженерний дефолт для one-person MVP).
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey);
  return { token, expiresAt: expiresAt.toISOString() };
}

async function verifyJwt(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, secretKey);
  if (typeof payload.sub !== 'string') {
    throw new Error('JWT без sub');
  }
  return { sub: payload.sub };
}

const db = createDb();
const app = createApp({ db, withTransaction: db.withTransaction, verifyGoogleIdToken, signJwt, verifyJwt });

app.listen(PORT, () => {
  // eslint-disable-next-line no-console -- немає власного логера (one-person MVP, ADR-0006).
  console.log(`plan/app server listening on :${PORT}`);
});
