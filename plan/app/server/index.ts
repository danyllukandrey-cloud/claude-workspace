// Реальний composition root (T30) -- єдине місце, де AppDeps (app.ts) отримують
// справжні реалізації: pg.Pool (db.ts), google-auth-library, jose. Тонкий
// навмисно (ADR-0006 §Рішення) -- уся логіка вже в app.ts/ports/*.ts/app/*.ts,
// тут лише монтаж і app.listen(). НЕ юніт-тестується (реальна мережа/БД/Google) --
// покриття цього файлу дає npm run test:integration + ручний прогін.

import { SignJWT, jwtVerify } from 'jose';
import { OAuth2Client } from 'google-auth-library';
import { createApp, type GoogleIdTokenPayload, type JwtPayload } from './app';
import { createDb } from './db';
import { assertJwtSigningKeyStrength } from './jwt-config';
// T29 -- agent's own Claude client (../src/agent/infra/claude-client.ts, T12) --
// threaded the same optional-DI way as life-area-card's `callClaude` below,
// but a distinct factory/shape (app.ts's AppDeps.askClaude docblock explains why).
import { createClaudeClient } from '../src/agent/infra/claude-client';
import type { EmailTransport } from '../src/agent/infra/email-client';
// "Лог дій" -- реальна реалізація, підключена тут один раз для всіх
// use-case-ів трьох фіч (server/app.ts's AppDeps.recordAction докладніше).
import { recordAction } from '../src/agent/app/record-action';

const PORT = Number(process.env.PORT ?? 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET не задано (.env) -- потрібен для підпису/перевірки власного JWT (ADR-0006 §Додаток)');
}
// Review 2026-09-07 (backend hardening, T50): довжина, не лише наявність --
// слабкий (закороткий) секрет технічно "задано", але робить HS256-підпис
// підбірним (jwt-config.ts).
assertJwtSigningKeyStrength(JWT_SECRET);
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

// Review 2026-09-07 A3: реальний Claude API (Messages, тонкий fetch -- ADR-0006
// §Рушії рішення, "переінженерія на цьому масштабі -- мінус", жодного SDK заради
// одного виклику). Ключа може не бути в .env (AC-10 необов'язкова) -- кидає
// одразу, без мережевого виклику; checkSuspiciousData (infra/claude-client.ts)
// ловить це так само, як і будь-яку іншу відмову, fail-open, не валить getCard.
async function callClaude(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY не задано (.env) -- AC-10 необов’язкова, fail-open вище');
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Claude API відповів ${res.status}`);
  }
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  const text = data.content?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error('Claude API: неочікувана форма відповіді');
  }
  return text.trim();
}

// T29 -- agent's own Claude client (AC-01, sad.md Critical flow 1): optional,
// same reasoning as life-area-card's `callClaude` above (ANTHROPIC_API_KEY
// may be absent in a given environment) -- when absent, POST /api/v1/messages
// fails closed with 503 `agent.llm_unavailable` at the route (server/app.ts),
// never a raw crash. Distinct factory from `callClaude` above on purpose --
// see AppDeps.askClaude's docblock in app.ts for why the two aren't merged.
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const askClaude = anthropicApiKey ? createClaudeClient({ apiKey: anthropicApiKey }) : undefined;

// T29 -- developer-report.ts's (T42, AC-20/AC-20b) email dependency. OPEN GAP
// (see AppDeps.emailTransport's docblock in app.ts): no contract endpoint
// calls this yet, and no email provider has been chosen (infra/email-client.ts's
// own comment: "SMTP чи transactional email API — конкретний постачальник ще
// не обраний") -- inventing a real HTTP call to an unchosen provider here
// would be exactly the kind of silent decision plan/app/CLAUDE.md and
// docs/DECISIONS.md's "одне рішення — одне місце" rule warn against. This
// stub keeps the DI shape ready (fails loudly and specifically if ever
// invoked) without pretending a provider has been picked.
const emailTransport: EmailTransport = async () => {
  throw new Error('Email-провайдер ще не обраний (developer-report.ts, T37/T42) -- SMTP/API інтеграція не підключена');
};
const developerEmail = process.env.DEVELOPER_EMAIL ?? '';

const db = createDb();
const app = createApp({
  db,
  withTransaction: db.withTransaction,
  verifyGoogleIdToken,
  signJwt,
  verifyJwt,
  callClaude,
  askClaude,
  emailTransport,
  developerEmail,
  recordAction,
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console -- немає власного логера (one-person MVP, ADR-0006).
  console.log(`plan/app server listening on :${PORT}`);
});
