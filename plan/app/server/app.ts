// Composition root -- Express app (T30, ADR-0006 §Рішення/§Обґрунтування,
// docs/features/life-area-card/tasks/t30-wiring-app-shell.md).
//
// Живе ПОЗА src/ (ADR-0006 §Обґрунтування) -- Vite ніколи не збирає цю
// папку, тож express/pg/jose/google-auth-library фізично не можуть
// потрапити в браузерний бандл. `createApp` -- чисто транспортний шар: сам
// не знає SQL, не рахує прогрес, лише монтує вже готові framework-agnostic
// хендлери (../src/cards/life-area-card/ports/*.ts) на реальні маршрути й
// перетворює AppError на конверт помилки контракту одним error-middleware.
//
// DI (той самий підхід, що і в ports/*.ts): усі побічні ефекти (БД, Google
// ID-токен, підпис/перевірка JWT) injected через AppDeps -- server/index.ts
// (реальний composition root, не тестується юніт-тестами) підставляє
// справжні реалізації; server/app.test.ts і server/session.test.ts
// підставляють vi.fn().

import express, { type NextFunction, type Request, type Response } from 'express';
import type { Db } from '../src/cards/life-area-card/infra/postgres-repo';
import { AppError } from '../src/shared/errors';
import * as cardHandlers from '../src/cards/life-area-card/ports/card-handlers';
import * as metricBlockHandlers from '../src/cards/life-area-card/ports/metric-block-handlers';
import * as entryHandlers from '../src/cards/life-area-card/ports/entry-handlers';

/** Мінімум, потрібний verifyGoogleIdToken -- google-auth-library повертає значно більше полів. */
export interface GoogleIdTokenPayload {
  sub: string;
  email: string;
}

/** Мінімум, потрібний JWT-корисному навантаженню (ADR-0006 §Додаток: sub = app_user.id). */
export interface JwtPayload {
  sub: string;
}

export interface SignJwtResult {
  token: string;
  expiresAt: string;
}

/**
 * Ін'єктовані залежності composition root -- жодна з них не створюється
 * всередині createApp (те саме правило DI, що postgres-repo.ts/ports/*.ts).
 */
export interface AppDeps {
  db: Db;
  /** Перевіряє Google ID-токен (google-auth-library verifyIdToken у реальній реалізації). */
  verifyGoogleIdToken: (googleIdToken: string) => Promise<GoogleIdTokenPayload>;
  /** Підписує наш HS256 JWT (jose у реальній реалізації) -- sub = app_user.id, exp = now + 24h. */
  signJwt: (payload: JwtPayload) => Promise<SignJwtResult>;
  /** Перевіряє наш JWT (jose у реальній реалізації) -- кидає при невалідному/протермінованому токені. */
  verifyJwt: (token: string) => Promise<JwtPayload>;
}

/** req розширюється ownerUserId (з JWT sub) -- кладе authMiddleware, читають хендлери-обгортки нижче. */
interface AuthenticatedRequest extends Request {
  ownerUserId?: string;
}

/** Обгортка над async-хендлером Express -- пропускає відхилений Promise у next() (error-middleware). */
function asyncHandler(
  handler: (req: AuthenticatedRequest, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req as AuthenticatedRequest, res).catch(next);
  };
}

/** Апсертить app_user за googleSub/email -- той самий підхід, що postgres-repo.ts (SQL напряму, без ORM). */
async function upsertAppUser(db: Db, googleSub: string, email: string): Promise<{ id: string; email: string }> {
  const { rows } = await db.query<{ id: string; email: string }>(
    `INSERT INTO app_user (id, google_sub, email)
     VALUES (gen_random_uuid(), $1, $2)
     ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, updated_at = now()
     RETURNING id, email`,
    [googleSub, email]
  );
  return rows[0];
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.use(express.json());

  // POST /api/v1/session -- ЄДИНИЙ маршрут без BearerAuth (D-109, ADR-0006 §Додаток):
  // видає перепустку, тому не може сам її вимагати.
  app.post(
    '/api/v1/session',
    asyncHandler(async (req, res) => {
      const { googleIdToken } = req.body as { googleIdToken?: string };

      let googlePayload: GoogleIdTokenPayload;
      try {
        googlePayload = await deps.verifyGoogleIdToken(googleIdToken ?? '');
      } catch {
        throw new AppError('auth.invalid_google_token', 'Невалідний або протермінований Google ID-токен', 401);
      }

      const appUser = await upsertAppUser(deps.db, googlePayload.sub, googlePayload.email);
      const { token, expiresAt } = await deps.signJwt({ sub: appUser.id });

      res.status(200).json({ token, expiresAt, user: { id: appUser.id, email: appUser.email } });
    })
  );

  // Спільний auth-middleware -- решта маршрутів усіх трьох фіч (ADR-0006 §Додаток, останній
  // абзац). Перевіряє Bearer JWT, кладе ownerUserId (sub) у req для хендлерів нижче.
  // Не через asyncHandler (той не має доступу до next() на успіху) -- виклик next()
  // тут явний, помилки йдуть у next(err), який Express передає в error-middleware нижче.
  app.use((req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    const header = req.header('authorization') ?? req.header('Authorization');
    const match = header?.match(/^Bearer (.+)$/);
    if (!match) {
      next(new AppError('auth.missing_token', 'Authorization: Bearer <token> обов’язковий', 401));
      return;
    }

    deps
      .verifyJwt(match[1])
      .then((payload) => {
        req.ownerUserId = payload.sub;
        next();
      })
      .catch(() => {
        next(new AppError('auth.invalid_token', 'Невалідний або протермінований токен', 401));
      });
  });

  // --- Cards ---------------------------------------------------------------

  app.get(
    '/api/v1/cards',
    asyncHandler(async (req, res) => {
      const { status, after, limit } = req.query as { status?: string; after?: string; limit?: string };
      const page = await cardHandlers.listCards(deps.db, ownerUserId(req), {
        status: status as 'active' | 'archived' | undefined,
        after,
        limit: limit !== undefined ? Number(limit) : undefined,
      });
      res.status(200).json(page);
    })
  );

  app.post(
    '/api/v1/cards',
    asyncHandler(async (req, res) => {
      const card = await cardHandlers.createCard(deps.db, ownerUserId(req), req.body);
      res.status(201).json(card);
    })
  );

  app.get(
    '/api/v1/cards/:cardId',
    asyncHandler(async (req, res) => {
      const card = await cardHandlers.getCard(deps.db, ownerUserId(req), param(req, 'cardId'));
      res.status(200).json(card);
    })
  );

  app.patch(
    '/api/v1/cards/:cardId',
    asyncHandler(async (req, res) => {
      const card = await cardHandlers.updateCard(deps.db, ownerUserId(req), param(req, 'cardId'), req.body);
      res.status(200).json(card);
    })
  );

  app.delete(
    '/api/v1/cards/:cardId',
    asyncHandler(async (req, res) => {
      const card = await cardHandlers.archiveCard(deps.db, ownerUserId(req), param(req, 'cardId'));
      res.status(200).json(card);
    })
  );

  app.post(
    '/api/v1/cards/:cardId/restore',
    asyncHandler(async (req, res) => {
      const card = await cardHandlers.restoreCard(deps.db, ownerUserId(req), param(req, 'cardId'));
      res.status(200).json(card);
    })
  );

  // --- MetricBlocks ----------------------------------------------------------

  app.get(
    '/api/v1/cards/:cardId/metric-blocks',
    asyncHandler(async (req, res) => {
      const blocks = await metricBlockHandlers.listMetricBlocks(deps.db, ownerUserId(req), param(req, 'cardId'));
      res.status(200).json(blocks);
    })
  );

  app.post(
    '/api/v1/cards/:cardId/metric-blocks',
    asyncHandler(async (req, res) => {
      const block = await metricBlockHandlers.createMetricBlock(deps.db, ownerUserId(req), param(req, 'cardId'), req.body);
      res.status(201).json(block);
    })
  );

  app.post(
    '/api/v1/cards/:cardId/metric-blocks/transfer',
    asyncHandler(async (req, res) => {
      const block = await metricBlockHandlers.transferMetricBlock(deps.db, ownerUserId(req), param(req, 'cardId'), req.body);
      res.status(200).json(block);
    })
  );

  // --- Entries -----------------------------------------------------------

  app.post(
    '/api/v1/cards/:cardId/metric-blocks/:metricBlockId/entries',
    asyncHandler(async (req, res) => {
      const entry = await entryHandlers.createEntry(deps.db, ownerUserId(req), param(req, 'cardId'), param(req, 'metricBlockId'), req.body);
      res.status(201).json(entry);
    })
  );

  app.patch(
    '/api/v1/entries/:entryId',
    asyncHandler(async (req, res) => {
      const entry = await entryHandlers.resolveEntry(deps.db, ownerUserId(req), param(req, 'entryId'), req.body);
      res.status(200).json(entry);
    })
  );

  app.get(
    '/api/v1/cards/:cardId/entries',
    asyncHandler(async (req, res) => {
      const { after, limit } = req.query as { after?: string; limit?: string };
      const page = await entryHandlers.listEntries(deps.db, ownerUserId(req), param(req, 'cardId'), {
        after,
        limit: limit !== undefined ? Number(limit) : undefined,
      });
      res.status(200).json(page);
    })
  );

  // Error-middleware -- ЄДИНЕ місце, де AppError мапиться в конверт контракту
  // (ADR-0006 §Обґрунтування, "Envelope помилки народжується в одному місці").
  // 4 параметри обов'язкові -- Express розпізнає error-handler саме за арністю.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.httpStatus).json({ code: err.code, message: err.message });
      return;
    }
    // eslint-disable-next-line no-console -- немає власного логера (one-person MVP, ADR-0006).
    console.error(err);
    res.status(500).json({ code: 'internal.error', message: 'Internal server error' });
  });

  return app;
}

function ownerUserId(req: Request): string {
  return (req as AuthenticatedRequest).ownerUserId as string;
}

/**
 * Express 5 типізує req.params[name] як string | string[] (path-to-regexp v8
 * дозволяє повторювані сегменти) -- жоден наш маршрут таким не користується,
 * тому тут просто звужуємо тип до того, що реально прийде.
 */
function param(req: Request, name: string): string {
  return req.params[name] as string;
}
