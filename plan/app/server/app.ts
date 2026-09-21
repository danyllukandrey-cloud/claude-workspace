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
import { CardValidationError } from '../src/cards/life-area-card/domain/card';
import { ProgressValidationError } from '../src/cards/life-area-card/domain/progress';
import * as cardHandlers from '../src/cards/life-area-card/ports/card-handlers';
import * as metricBlockHandlers from '../src/cards/life-area-card/ports/metric-block-handlers';
import * as entryHandlers from '../src/cards/life-area-card/ports/entry-handlers';
import type { CallClaude } from '../src/cards/life-area-card/app/get-card';
// Review 2026-09-07 A2/B5: composition root -- ЄДИНЕ місце, де life-area-card
// і structure зустрічаються (ADR-0004, life-area-card НЕ імпортує structure/
// напряму). archiveCard приймає closeStructurePosition як опційний
// колаборатор саме заради цього -- до цього фіксу тут його ніхто не передавав,
// тож D-69/D-103 у production не спрацьовував НІКОЛИ, попри те, що нижчий
// рівень (archiveCard() викликаний напряму, migrations.integration.test.ts)
// це підтверджував.
import {
  closeActiveLayoutPositionForCard,
  reopenClosedLayoutPositionForCard,
  findStructureByOwner,
  insertLayoutPosition,
} from '../src/structure/infra/postgres-repo';
import { recordCardRenameEvent } from '../src/structure/infra/history-repo';
import { defaultPositionForNewCard } from '../src/structure/domain/layout';
// Review 2026-09-11 (MUST-FIX 1): порти Структури існували й були покриті
// юніт-тестами, але composition root їх НЕ монтував -- кожен шлях
// /api/v1/structure* віддавав 404, тож уся фіча була недосяжна з реального
// застосунку. Той самий клас дефекту, що A2/B5 вище.
import * as structureHandlers from '../src/structure/ports/structure-handlers';
import * as layoutHandlers from '../src/structure/ports/layout-handlers';
import * as connectionHandlers from '../src/structure/ports/connection-handlers';
// T29 -- порти фічі `agent` (contracts/openapi.yaml). Той самий урок, що
// MUST-FIX 1 вище: написані й покриті тестами порти лишаються 404, якщо їх
// тут ніхто не монтує -- server/app.test.ts нижче пінить КОЖЕН із 9 шляхів.
import * as chatHandlers from '../src/agent/ports/chat-handler';
import * as proposalHandlers from '../src/agent/ports/proposal-handler';
import * as rulesHandlers from '../src/agent/ports/rules-handler';
import * as reportsHandlers from '../src/agent/ports/reports-handler';
import * as onboardingHandlers from '../src/agent/ports/onboarding-handler';
import * as accountHandlers from '../src/agent/ports/account-handler';
import * as syncResourceHandlers from '../src/agent/ports/sync-resource-handler';
// "Лог дій" (заміна UI "Звіти активності", Андрій: "тупо пишемо кожну дію --
// час, дія, все.") -- action-log-handler.ts (GET), record-action.ts (запис,
// injected DI-параметр в use-case-и трьох фіч нижче, той самий стиль, що
// closeActiveLayoutPositionForCard/recordCardRenameEvent вище).
import * as actionLogHandlers from '../src/agent/ports/action-log-handler';
// T8 -- порти фічі `life-plan-levels` (сторінка ПЛАН, docs/features/
// life-plan-levels/contracts/openapi.yaml: 4 шляхи на /api/v1/plan-items).
// Той самий урок, що MUST-FIX 1 (Структура) і T29 (агент) вище: написані й
// покриті юніт-тестами порти лишаються 404, якщо composition root їх не
// монтує -- server/app.test.ts пінить кожен із цих шляхів.
import * as planItemHandlers from '../src/plan-horizons/ports/plan-item-handlers';
import { PlanItemValidationError } from '../src/plan-horizons/domain/plan-item';
import type { RecordAction } from '../src/agent/app/record-action';
import type { AskClaude } from '../src/agent/infra/claude-client';
import type { EmailTransport } from '../src/agent/infra/email-client';
// AC-20 wiring (review finding, docs/features/agent/spec.md AC-20): the
// generic/unexpected-error branch of the error-middleware below is the only
// defensible trigger point for `fileAgentDetectedErrorReport` -- no sad.md
// flow names one (already flagged as an under-specified integration point in
// AppDeps.emailTransport's docblock above). Narrow interpretation, not a
// product decision: flagged in the PR/handoff for a human to confirm.
import { fileAgentDetectedErrorReport } from '../src/agent/app/developer-report';

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
  /**
   * Review 2026-09-07 B5: реальна атомарність (BEGIN/COMMIT/ROLLBACK,
   * server/db.ts) -- обов'язковий, не опційний, параметр: без нього
   * DELETE /cards/{id} (card status + structure layout close, T40/T41)
   * писав би два незалежних write, знову без транзакції, той самий клас
   * бага, що це поле й закриває.
   */
  withTransaction: <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
  /** Перевіряє Google ID-токен (google-auth-library verifyIdToken у реальній реалізації). */
  verifyGoogleIdToken: (googleIdToken: string) => Promise<GoogleIdTokenPayload>;
  /** Підписує наш HS256 JWT (jose у реальній реалізації) -- sub = app_user.id, exp = now + 24h. */
  signJwt: (payload: JwtPayload) => Promise<SignJwtResult>;
  /** Перевіряє наш JWT (jose у реальній реалізації) -- кидає при невалідному/протермінованому токені. */
  verifyJwt: (token: string) => Promise<JwtPayload>;
  /**
   * Review 2026-09-07 A3: до цього фіксу getCard ніколи не отримував
   * callClaude у production -- dataWarning (AC-10) був назавжди недосяжний,
   * попри готовий і протестований infra/claude-client.ts (T12). Опційне,
   * не обов'язкове (як і в get-card.ts): відсутність -- "перевірка поки не
   * підключена", не помилка; відхилення реального виклику -- fail-open
   * (claude-client.ts саме тепер це гарантує), не 500.
   */
  callClaude?: CallClaude;
  /**
   * T29 -- agent's OWN Claude client (../src/agent/infra/claude-client.ts's
   * `askClaude`, T12) -- threaded the SAME optional-DI way as `callClaude`
   * above (server/index.ts constructs it, createApp never does), but a
   * DIFFERENT shape: `AskClaude` returns `ClaudeResult<string>` (domain-
   * sentinel, never throws for an expected failure), while `CallClaude`
   * above is life-area-card's own bare `(prompt) => Promise<string>`. The
   * two are NOT interchangeable -- chat-handler.ts's createMessage requires
   * exactly this shape (../src/agent/app/ask-agent.ts/handle-message.ts).
   * Optional in the type (so server/app.test.ts's noopDeps keeps compiling
   * without it) but operationally required for POST /messages to succeed --
   * missing it fails closed with 503 `agent.llm_unavailable` at the route
   * below, not a raw TypeError.
   */
  askClaude?: AskClaude;
  /**
   * T29 -- developer-report.ts's (T42) outbound email dependency (AC-20/
   * AC-20b), wired the same optional-DI way as callClaude/askClaude above.
   * OPEN INTEGRATION GAP (review finding, fixed narrowly, still not fully
   * decided): contracts/openapi.yaml has NO endpoint for AC-20/AC-20b --
   * spec.md describes AC-20 as an internal, non-HTTP service action ("агент
   * сам виявив технічну помилку... без участі користувача, службова дія"),
   * and no sad.md flow names where it should trigger. The error-middleware
   * below now calls `fileAgentDetectedErrorReport` best-effort when it is
   * present (generic/non-AppError branch only) -- the most defensible, narrow
   * reading available, NOT a confirmed product decision; flagged for a human
   * to confirm AC-20's real trigger point. AC-20b (user-initiated) still has
   * no caller anywhere -- unaffected by this fix.
   */
  emailTransport?: EmailTransport;
  /**
   * T29 -- developer's notification email address (AC-20/AC-20b) -- never
   * read from process.env inside src/ (plan/app/CLAUDE.md dependency rule);
   * composition root (server/index.ts) supplies it. See `emailTransport`
   * above -- used by the generic error-middleware branch (AC-20) AND, since
   * review 2026-09-13's gap fix, threaded into POST /api/v1/messages's
   * `chatHandlers.createMessage` call below (AC-20b, chat-initiated).
   */
  developerEmail?: string;
  /**
   * "Лог дій" -- опційний, той самий optional-DI підхід, що всі колаборатори
   * вище (closeStructurePosition/callClaude/askClaude/emailTransport):
   * server/index.ts підставляє реальну ../src/agent/app/record-action.ts's
   * `recordAction` один раз тут; юніт-тести цього файлу (noopDeps) її не
   * задають, тож жоден наявний тест не отримує зайвого запиту до `db.query`.
   */
  recordAction?: RecordAction;
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

/**
 * AC-09 -- нова картка одразу отримує позицію (у купці нерозкладених,
 * D-131-наступне рішення: вільне полотно прибрало "наступну вільну
 * клітинку" -- defaultPositionForNewCard тепер завжди {x: null, y: null}).
 *
 * Живе тут, у composition root -- ЄДИНОМУ місці, де life-area-card і structure
 * зустрічаються (ADR-0004: life-area-card нічого не імпортує з structure/
 * напряму), рівно як closeActiveLayoutPositionForCard для DELETE /cards/{id}.
 *
 * `db` приходить параметром і це ТОЙ САМИЙ db, у якому щойно вставилась сама
 * картка -- тобто та сама транзакція (deps.withTransaction у маршруті нижче):
 * збій тут відкочує й INSERT картки, інакше AC-09 виконано наполовину (картка
 * є, позиції немає). Помилка навмисно НЕ глушиться.
 *
 * Структури ще немає (перший вхід -- вона провісниться лениво на першому
 * GET /structure, ports/structure-handlers.ts) -- тихо нічого не робимо: це не
 * помилка, картка просто чекатиме в купці нерозкладених, щойно Структура
 * з'явиться (AC-17 описує рівно такий стан "картка без позиції").
 */
async function assignDefaultLayoutPosition(db: Db, ownerUserId: string, cardId: string): Promise<void> {
  const structure = await findStructureByOwner(db, ownerUserId);
  if (!structure) {
    return;
  }

  const { x, y } = defaultPositionForNewCard();

  await insertLayoutPosition(db, {
    id: crypto.randomUUID(),
    structureId: structure.id,
    cardId,
    x,
    y,
  });
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
  // Review 2026-09-12: агент приймає вкладення (фото/документ) як base64 у
  // JSON-тілі (main.tsx FileReader -> base64), не multipart -- дефолтний
  // ліміт express.json() (~100kb) відхиляв би будь-яке реальне фото/PDF ще
  // до того, як agent.attachment_unrecognized встиг би спрацювати, і
  // помилка виглядала б як generic request.invalid_body, не контрактна
  // 422. 10mb -- запас під base64-роздування (~33%) навіть великого фото.
  app.use(express.json({ limit: '10mb' }));
  // Review 2026-09-07 (backend hardening, T50, "Express 5 req.body===undefined"):
  // express.json() лишає req.body undefined, коли Content-Type не збігається
  // (чи взагалі відсутній) -- не {}, як можна було б очікати. Кожен обробник
  // нижче (cardHandlers.*, entryHandlers.*, metricBlockHandlers.*) читає
  // поля тіла напряму (`body.status`, `body.name`, ...) без перевірки на
  // undefined -- без цього рядка такий запит кидав TypeError ДО будь-якого
  // AppError/domain-branch в error-middleware, тож завжди падав у generic 500
  // замість контрактної відповіді про валідацію.
  app.use((req, _res, next) => {
    if (req.body === undefined) req.body = {};
    next();
  });

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
      // Review 2026-09-07, post-ship follow-up review (B5 remainder): insertCard
      // + insertLifecycleEvent('created') -- та сама атомарність, що DELETE/
      // transfer/POST-entries нижче вже мають (T40/T41); без транзакції збій
      // другого запису лишив би рядок card сиротою, без жодної події в Літописі.
      //
      // Review 2026-09-11 (MUST-FIX 6, AC-09): третій крок того ж запису --
      // клітинка за замовчуванням у розкладці Структури. Той самий txDb, тож
      // усі три кроки або разом, або жоден.
      //
      // ЧОМУ ВИКЛИК ТУТ, А НЕ ЧЕРЕЗ ПОРТ: use-case app/create-card.ts уже
      // приймає цей колаборатор третім, опційним параметром (дзеркально до
      // archive-card.ts's closeStructurePosition), але порт
      // ports/card-handlers.ts's createCard(db, ownerUserId, body) параметра
      // під нього НЕ має -- на відміну від archiveCard, який його прокидає.
      // Дописати порт -- правка файлу поза скоупом цього фіксу, тому ланцюг
      // замкнено тут, у composition root: послідовність (картка -> подія ->
      // позиція) і транзакція ті самі, спостережувана поведінка ідентична.
      // ЩОЙНО порт отримає параметр -- виклик має переїхати туди, а цей рядок
      // зникнути: два місця одночасно присвоять клітинку ДВІЧІ.
      const card = await deps.withTransaction(async (txDb) => {
        const created = await cardHandlers.createCard(txDb, ownerUserId(req), req.body, deps.recordAction);
        await assignDefaultLayoutPosition(txDb, ownerUserId(req), created.id);
        return created;
      });
      res.status(201).json(card);
    })
  );

  app.get(
    '/api/v1/cards/:cardId',
    asyncHandler(async (req, res) => {
      const card = await cardHandlers.getCard(deps.db, ownerUserId(req), param(req, 'cardId'), deps.callClaude);
      res.status(200).json(card);
    })
  );

  app.patch(
    '/api/v1/cards/:cardId',
    asyncHandler(async (req, res) => {
      // Review 2026-09-07, post-ship follow-up review (B5 remainder): коли
      // markFilled:true, updateCard пише і сам патч, і insertLifecycleEvent
      // ('filled') -- без транзакції збій другого запису лишав би Опис уже
      // збереженим, попри те, що подія "заповнена" ніколи не записалась.
      //
      // D-103/D-115 (ISS-105): recordCardRenameEvent реально переданий --
      // ЄДИНЕ місце, де life-area-card і structure зустрічаються (ADR-0004),
      // той самий приклад, що closeActiveLayoutPositionForCard для DELETE.
      const card = await deps.withTransaction((txDb) =>
        cardHandlers.updateCard(txDb, ownerUserId(req), param(req, 'cardId'), req.body, recordCardRenameEvent, deps.recordAction)
      );
      res.status(200).json(card);
    })
  );

  app.delete(
    '/api/v1/cards/:cardId',
    asyncHandler(async (req, res) => {
      // Review 2026-09-07 A2/B5: обидва write (card.status='archived' +
      // structure_layout_position.status='closed', якщо позиція є) -- в
      // ОДНІЙ транзакції через txDb, і closeStructurePosition реально
      // переданий (раніше -- ніколи, тому D-69/D-103 не діяв у production).
      const card = await deps.withTransaction((txDb) =>
        cardHandlers.archiveCard(txDb, ownerUserId(req), param(req, 'cardId'), closeActiveLayoutPositionForCard, deps.recordAction)
      );
      res.status(200).json(card);
    })
  );

  app.post(
    '/api/v1/cards/:cardId/restore',
    asyncHandler(async (req, res) => {
      // Review 2026-09-07, post-ship follow-up review (B5 remainder): дзеркало
      // archiveCard -- updateCard(status:'active') + insertLifecycleEvent
      // ('restored') в одній транзакції, той самий ризик "напівзробленого стану".
      //
      // Fix 2026-09-21 (живе тестування, картка "Філософія" назавжди
      // втратила позицію в Структурі після архів/розархів): reopenClosedLayoutPositionForCard
      // реально переданий -- ДО цього фіксу тут його ніхто не передавав, тож
      // розархівована картка ніколи не отримувала активну позицію назад, і
      // moveCard/createConnection завжди відповідали structure.card_not_found.
      // Той самий клас дефекту, що closeActiveLayoutPositionForCard мав до
      // A2/B5 (рядок з archiveCard вище).
      const card = await deps.withTransaction((txDb) =>
        cardHandlers.restoreCard(txDb, ownerUserId(req), param(req, 'cardId'), reopenClosedLayoutPositionForCard, deps.recordAction)
      );
      res.status(200).json(card);
    })
  );

  app.delete(
    '/api/v1/cards/:cardId/permanent',
    asyncHandler(async (req, res) => {
      // CH-15 (docs/features/life-area-card/changes.md): "Видалити" в
      // Архіві карток -- назавжди, не архівація (DELETE вище). Один
      // DELETE-запит на рядок card, ON DELETE CASCADE у міграціях сам
      // прибирає все пов'язане (postgres-repo.ts's deleteCard, докладніше
      // там) -- withTransaction тут лише заради recordAction (action_log)
      // в тій самій транзакції, той самий підхід, що archiveCard/restoreCard.
      await deps.withTransaction((txDb) => cardHandlers.deleteCard(txDb, ownerUserId(req), param(req, 'cardId'), deps.recordAction));
      res.status(204).send();
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
      const block = await metricBlockHandlers.createMetricBlock(
        deps.db,
        ownerUserId(req),
        param(req, 'cardId'),
        req.body,
        deps.recordAction
      );
      res.status(201).json(block);
    })
  );

  app.post(
    '/api/v1/cards/:cardId/metric-blocks/transfer',
    asyncHandler(async (req, res) => {
      // Review 2026-09-07 B5 (remainder, T41): updateMetricBlock (card_id) +
      // reassignEntriesToCard (entry.card_id денормалізовано, AC-14) --
      // ОБОВ'ЯЗКОВА пара (коментар у use-case), той самий клас бага, що T40:
      // без транзакції відмова другого запису лишила б блок на новій картці,
      // а його записи -- на старій.
      const block = await deps.withTransaction((txDb) =>
        metricBlockHandlers.transferMetricBlock(txDb, ownerUserId(req), param(req, 'cardId'), req.body, deps.recordAction)
      );
      res.status(200).json(block);
    })
  );

  app.delete(
    '/api/v1/cards/:cardId/metric-blocks/:metricBlockId',
    asyncHandler(async (req, res) => {
      // US-17/AC-20 (D-127): мʼяка архівація ОДНОГО блоку-метрики -- один
      // UPDATE, без другого запису (на відміну від archiveCard, яка в тій
      // самій транзакції ще й пише card_lifecycle_event і закриває позицію
      // Структури) -- жодного cross-feature side-effect тут немає, тож
      // withTransaction не потрібен.
      const block = await metricBlockHandlers.archiveMetricBlock(
        deps.db,
        ownerUserId(req),
        param(req, 'cardId'),
        param(req, 'metricBlockId'),
        deps.recordAction
      );
      res.status(200).json(block);
    })
  );

  app.patch(
    '/api/v1/cards/:cardId/metric-blocks/:metricBlockId',
    asyncHandler(async (req, res) => {
      // CH-03 (docs/features/life-area-card/changes.md): перейменування й
      // зміна налаштувань -- один UPDATE, жодного cross-feature side-effect
      // (той самий "withTransaction не потрібен" міркування, що DELETE вище).
      const block = await metricBlockHandlers.updateMetricBlock(
        deps.db,
        ownerUserId(req),
        param(req, 'cardId'),
        param(req, 'metricBlockId'),
        req.body,
        deps.recordAction
      );
      res.status(200).json(block);
    })
  );

  // --- Entries -----------------------------------------------------------

  app.post(
    '/api/v1/cards/:cardId/metric-blocks/:metricBlockId/entries',
    asyncHandler(async (req, res) => {
      // Review 2026-09-07 B5 (remainder, T41): insertEntry + (за потреби)
      // updateEntryStatus конфліктного запису на 'pending' (AC-06) -- без
      // транзакції відмова другого запису лишила б нову подію вставленою, а
      // конфліктну -- досі 'confirmed', тобто AC-06 (обидва pending) мовчки
      // порушено.
      const entry = await deps.withTransaction((txDb) =>
        entryHandlers.createEntry(
          txDb,
          ownerUserId(req),
          param(req, 'cardId'),
          param(req, 'metricBlockId'),
          req.body,
          deps.recordAction
        )
      );
      res.status(201).json(entry);
    })
  );

  app.patch(
    '/api/v1/entries/:entryId',
    asyncHandler(async (req, res) => {
      const entry = await entryHandlers.resolveEntry(deps.db, ownerUserId(req), param(req, 'entryId'), req.body, deps.recordAction);
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

  // --- Structure -----------------------------------------------------------
  //
  // Review 2026-09-11 (MUST-FIX 1): маршрути фічі `structure`
  // (contracts/openapi.yaml: getMyStructure, updateMyStructure,
  // listLayoutPositions, getLayoutHistoryAsOf, moveCard, closeCard). Той
  // самий транспортний шаблон, що секція Cards вище: asyncHandler +
  // ownerUserId(req) + param(req, ...), жодного SQL і жодної логіки тут.
  // Bearer-auth-middleware стоїть ВИЩЕ, тож 401 із DoD T15/T16 покривається
  // цими маршрутами автоматично, без окремого коду.

  app.get(
    '/api/v1/structure',
    asyncHandler(async (req, res) => {
      const structure = await structureHandlers.getStructure(deps.db, ownerUserId(req));
      res.status(200).json(structure);
    })
  );

  app.patch(
    '/api/v1/structure',
    asyncHandler(async (req, res) => {
      // T11 DoD ("в одній транзакції"): PATCH -- мультизапис. UPDATE structure
      // плюс, коли змінився режим чи підвид розкладки (AC-11b/AC-16b), N
      // окремих UPDATE позицій скидання. Без транзакції збій посеред циклу
      // лишив би режим уже новим, а частину карток -- у старих клітинках: той
      // самий клас бага, що createCard/archiveCard вище вже закрили.
      const structure = await deps.withTransaction((txDb) =>
        structureHandlers.updateStructure(txDb, ownerUserId(req), req.body, deps.recordAction)
      );
      res.status(200).json(structure);
    })
  );

  app.get(
    '/api/v1/structure/layout',
    asyncHandler(async (req, res) => {
      const { after, limit } = req.query as { after?: string; limit?: string };
      const page = await layoutHandlers.listLayoutPositions(deps.db, ownerUserId(req), {
        after,
        limit: limit !== undefined ? Number(limit) : undefined,
      });
      res.status(200).json(page);
    })
  );

  // Перед /layout/:cardId навмисно -- 'history' інакше могло б виглядати як
  // cardId (тут методи різні, тож конфлікту немає, але порядок лишаємо
  // очевидним для наступної зміни).
  app.get(
    '/api/v1/structure/layout/history',
    asyncHandler(async (req, res) => {
      const { asOf } = req.query as { asOf?: string };
      const page = await layoutHandlers.getLayoutHistoryAsOf(deps.db, ownerUserId(req), asOf);
      res.status(200).json(page);
    })
  );

  app.put(
    '/api/v1/structure/layout/:cardId',
    asyncHandler(async (req, res) => {
      // Мультизапис: UPDATE позиції (cell_index/position_updated_at) + INSERT
      // події 'moved' у Літопис (AC-15) -- разом або ніяк, інакше картка вже
      // переїхала, а історія про це не знає (і тренд AC-07 рахується по
      // неповному логу).
      const position = await deps.withTransaction((txDb) =>
        layoutHandlers.moveCardPosition(txDb, ownerUserId(req), param(req, 'cardId'), req.body, deps.recordAction)
      );
      res.status(200).json(position);
    })
  );

  app.post(
    '/api/v1/structure/layout/:cardId/close',
    asyncHandler(async (req, res) => {
      // Мультизапис: закриття позиції + подія 'closed' + опційні переноси
      // метрик на інші картки (AC-12) -- усе в одній транзакції, той самий
      // ризик "напівзакритого напрямку", що DELETE /cards/{id} вище.
      const position = await deps.withTransaction((txDb) =>
        layoutHandlers.closeCardPosition(txDb, ownerUserId(req), param(req, 'cardId'), req.body, deps.recordAction)
      );
      res.status(200).json(position);
    })
  );

  // --- Structure connections (вимоги 4/5, чат 2026-09-15) -------------------
  //
  // Інструмент "Зв'язати" на Схемі -- звичайна лінія чи стрілка між двома
  // картками власника. Той самий транспортний шаблон, що секції Cards/
  // Structure вище.

  app.get(
    '/api/v1/structure/connections',
    asyncHandler(async (req, res) => {
      const items = await connectionHandlers.listConnections(deps.db, ownerUserId(req));
      res.status(200).json(items);
    })
  );

  app.post(
    '/api/v1/structure/connections',
    asyncHandler(async (req, res) => {
      const created = await connectionHandlers.createConnection(deps.db, ownerUserId(req), req.body, deps.recordAction);
      res.status(201).json(created);
    })
  );

  app.delete(
    '/api/v1/structure/connections/:connectionId',
    asyncHandler(async (req, res) => {
      await connectionHandlers.deleteConnection(deps.db, ownerUserId(req), param(req, 'connectionId'), deps.recordAction);
      res.status(204).end();
    })
  );

  // --- Agent -----------------------------------------------------------
  //
  // T29 -- маршрути фічі `agent` (contracts/openapi.yaml, усі 9 шляхів:
  // messages GET+POST, proposals/active GET, proposals/{id}/confirm POST,
  // rules GET+POST, reports GET, onboarding GET, account DELETE,
  // sync-resources GET+POST, sync-resources/{id} DELETE). Той самий
  // транспортний шаблон, що секції Cards/Structure вище: asyncHandler +
  // ownerUserId(req) + param(req, ...), жодного SQL і жодної логіки тут --
  // усе вже реалізовано в ../src/agent/ports/*.ts. Bearer-auth-middleware
  // стоїть ВИЩЕ, тож жоден із цих маршрутів не є винятком D-109 (лише
  // /api/v1/session ним є).

  app.get(
    '/api/v1/messages',
    asyncHandler(async (req, res) => {
      const { after, before, limit } = req.query as { after?: string; before?: string; limit?: string };
      const page = await chatHandlers.listMessages(deps.db, ownerUserId(req), {
        after,
        before,
        limit: limit !== undefined ? Number(limit) : undefined,
      });
      res.status(200).json(page);
    })
  );

  app.post(
    '/api/v1/messages',
    asyncHandler(async (req, res) => {
      // ВІДКРИТЕ ПИТАННЯ (флаговане в ../src/agent/ports/chat-handler.ts і
      // ../src/agent/infra/claude-client.ts): контракт документує це тіло
      // як `multipart/form-data` (MessageCreate.attachment: binary), але в
      // репозиторії ще НЕМАЄ жодного multipart-парсера (multer/busboy) --
      // додавання нової продакшн-залежності заради одного маршруту НЕ
      // вирішується мовчки цим wiring-проходом (це власне рішення, гідне
      // DECISIONS.md, не побічний ефект T29). Натомість цей маршрут приймає
      // JSON-тіло, де `attachment` УЖЕ у формі ClaudeAttachment
      // (mediaType+base64Data) -- РІВНО та сама форма, що createMessage/
      // askClaude вже очікують (жодного додаткового мапінгу немає); клієнт
      // (src/app/main.tsx) сам конвертує File у base64 перед відправкою.
      // Реальний binary/multipart upload лишається майбутнім проходом --
      // позначено тут явно, не мовчки підмінено.
      if (!deps.askClaude) {
        throw new AppError('agent.llm_unavailable', 'Агент тимчасово недоступний — Claude-клієнт не підключено', 503);
      }
      // AC-20b (review 2026-09-13 gap fix): emailTransport/developerEmail
      // threaded through the same optional way as everywhere else -- absent
      // in an environment that hasn't configured outbound email, createMessage
      // simply never attempts to forward a problem to the developer.
      // T12 (life-plan-levels AC-09, sad.md §6 Critical flow 4): підтверджений
      // у чаті пункт ПЛАНу створюється РІВНО тим самим хендлером, що обслуговує
      // POST /api/v1/plan-items прямого введення (нижче в цьому ж файлі) --
      // один шлях запису на обидва способи. Зв'язується саме тут, у
      // композиційному корені: ні agent не імпортує plan-horizons, ні навпаки
      // (tasks/T12 Notes, architecture-map.md §Конвенції).
      const turn = await chatHandlers.createMessage(deps.db, deps.askClaude, ownerUserId(req), req.body, {
        transport: deps.emailTransport,
        developerEmail: deps.developerEmail,
        recordAction: deps.recordAction,
        createPlanItem: (input) =>
          planItemHandlers.createPlanItem(
            deps.db,
            input.ownerUserId,
            { horizon: input.horizon, planText: input.planText },
            deps.recordAction
          ),
      });
      res.status(201).json(turn);
    })
  );

  app.get(
    '/api/v1/proposals/active',
    asyncHandler(async (req, res) => {
      const result = await proposalHandlers.getActiveProposal(deps.db, ownerUserId(req));
      res.status(200).json(result);
    })
  );

  app.post(
    '/api/v1/proposals/:proposalId/confirm',
    asyncHandler(async (req, res) => {
      // Мультизапис через межу фіч: life-area-card's createEntry (agent/
      // app/confirm.ts делегує ЦІЛКОМ) + agent's власний updateProposal
      // status='confirmed' -- той самий ризик "напівзробленого стану", що
      // createCard/archiveCard вище вже закрили withTransaction: без неї
      // збій другого запису лишив би запис у картці вже вставленим, а
      // пропозицію -- досі 'active' (ризик повторного запису при retry).
      //
      // Review 2026-09-12: жодного тіла запиту тут немає (openapi.yaml,
      // confirmProposal не визначає requestBody) -- `req.body` свідомо не
      // передається далі, симетрично life-area-card's entry-handlers.ts
      // createEntry.
      const proposal = await deps.withTransaction((txDb) =>
        proposalHandlers.confirmProposal(txDb, ownerUserId(req), param(req, 'proposalId'), deps.recordAction)
      );
      res.status(200).json(proposal);
    })
  );

  app.get(
    '/api/v1/rules',
    asyncHandler(async (req, res) => {
      const { scopeCardId, after, limit } = req.query as { scopeCardId?: string; after?: string; limit?: string };
      const page = await rulesHandlers.listRules(deps.db, ownerUserId(req), {
        scopeCardId: scopeCardId ?? null,
        after,
        limit: limit !== undefined ? Number(limit) : undefined,
      });
      res.status(200).json(page);
    })
  );

  app.post(
    '/api/v1/rules',
    asyncHandler(async (req, res) => {
      const rule = await rulesHandlers.createRule(deps.db, ownerUserId(req), req.body);
      res.status(201).json(rule);
    })
  );

  app.get(
    '/api/v1/reports',
    asyncHandler(async (req, res) => {
      const { periodType, after, limit } = req.query as {
        periodType?: 'weekly' | 'monthly' | 'quarterly';
        after?: string;
        limit?: string;
      };
      const page = await reportsHandlers.listReports(deps.db, ownerUserId(req), {
        periodType,
        after,
        limit: limit !== undefined ? Number(limit) : undefined,
      });
      res.status(200).json(page);
    })
  );

  // "Лог дій" -- заміна UI "Звіти активності" (Андрій: "тупо пишемо кожну
  // дію -- час, дія, все."). GET /reports (agent-worker's періодичні звіти)
  // лишається окремим, незачепленим ендпоінтом вище -- backend-механізм
  // лишається, лише більше не показаний через UI (LogScreen.tsx замінив
  // ReportsScreen.tsx у навігації, той самий слот меню шестерні, D-123).
  app.get(
    '/api/v1/action-log',
    asyncHandler(async (req, res) => {
      const { after, limit } = req.query as { after?: string; limit?: string };
      const page = await actionLogHandlers.listActionLog(deps.db, ownerUserId(req), {
        after,
        limit: limit !== undefined ? Number(limit) : undefined,
      });
      res.status(200).json(page);
    })
  );

  app.get(
    '/api/v1/onboarding',
    asyncHandler(async (req, res) => {
      const status = await onboardingHandlers.getOnboardingStatus(deps.db, ownerUserId(req));
      res.status(200).json(status);
    })
  );

  app.delete(
    '/api/v1/account',
    asyncHandler(async (req, res) => {
      // ВІДКРИТЕ ПИТАННЯ (флаговане в ../src/agent/ports/account-handler.ts,
      // T43): контракт не описує тіло запиту й не називає, звідки
      // транспорт бере `confirmed` (AC-17b) -- цей wiring-прохід читає його
      // з JSON-тіла DELETE-запиту (express.json() парсить тіло незалежно
      // від методу; глобальний `req.body === undefined -> {}` мідлвар вище
      // покриває запит зовсім без тіла). Не задокументовано окремо в
      // openapi.yaml -- лишається предметом звірки з людиною, як і сам
      // порт коментує.
      //
      // withTransaction -- той самий ризик "напівзробленого стану", що
      // proposals/confirm вище: audit-рядок (AC-17) і сам DELETE app_user
      // (delete-account.ts) -- два послідовних запити, D-89 вимагає порядок
      // audit-ПОТІМ-delete саме тому, що FK CASCADE знищив би аудит-рядок,
      // якби порядок був зворотним; withTransaction гарантує, що збій
      // другого не лишає осиротілий audit без фактичного видалення акаунта.
      const { confirmed } = req.body as { confirmed?: boolean };
      await deps.withTransaction((txDb) => accountHandlers.deleteAccount(txDb, ownerUserId(req), confirmed === true));
      res.status(204).end();
    })
  );

  app.get(
    '/api/v1/sync-resources',
    asyncHandler(async (req, res) => {
      const resources = await syncResourceHandlers.listSyncResources(deps.db, ownerUserId(req));
      res.status(200).json(resources);
    })
  );

  app.post(
    '/api/v1/sync-resources',
    asyncHandler(async (req, res) => {
      const resource = await syncResourceHandlers.createSyncResource(deps.db, ownerUserId(req), req.body);
      res.status(201).json(resource);
    })
  );

  app.delete(
    '/api/v1/sync-resources/:resourceId',
    asyncHandler(async (req, res) => {
      await syncResourceHandlers.deleteSyncResource(deps.db, ownerUserId(req), param(req, 'resourceId'));
      res.status(204).end();
    })
  );

  // --- ПЛАН (фіча `life-plan-levels`) ---------------------------------------
  //
  // T8 -- 4 маршрути contracts/openapi.yaml: listPlanItems, createPlanItem,
  // updatePlanItem, deletePlanItem. Той самий транспортний шаблон, що секції
  // Cards/Structure/Agent вище: asyncHandler + ownerUserId(req) + param(req,
  // ...), жодного SQL і жодної логіки тут. Bearer-auth-middleware стоїть ВИЩЕ,
  // тож 401 із контракту покривається цими маршрутами автоматично.
  //
  // withTransaction ОБОВ'ЯЗКОВИЙ на трьох write-маршрутах (review 2026-09-20,
  // sad.md §8): запис у plan_item і запис у Лог дій (AC-05) мусять
  // комітитись чи відкочуватись РАЗОМ -- інакше збій самого лише запису в
  // Лог дій лишає зміну плану збереженою без жодного сліду, а це пряме
  // порушення spec.md §2 цілі 3 ("жодна зміна пункту плану не проходить
  // непоміченою"). Той самий підхід, що POST /api/v1/cards вище: txDb
  // прокидається в порт, recordAction усередині use-case викликається тим
  // самим db-параметром, тож бере участь у тій самій транзакції автоматично.

  app.get(
    '/api/v1/plan-items',
    asyncHandler(async (req, res) => {
      const { after, limit } = req.query as { after?: string; limit?: string };
      const page = await planItemHandlers.listPlanItems(deps.db, ownerUserId(req), {
        after,
        limit: limit !== undefined ? Number(limit) : undefined,
      });
      res.status(200).json(page);
    })
  );

  app.post(
    '/api/v1/plan-items',
    asyncHandler(async (req, res) => {
      // Idempotency-Key (T14, spec.md §6 NFR): повтор того самого ключа в
      // межах вікна віддає перший результат і другого пункту не створює.
      // Відсутність заголовка не блокуємо 400-ю -- контракт оголошує його
      // обов'язковим, але наявні клієнти (і всі чотири маршрути вище) писались
      // без нього; жорсткішати тут означало б зламати робочий екран заради
      // формальності. Немає ключа -- немає дедуплікації, і це видно з коду.
      const item = await deps.withTransaction((txDb) =>
        planItemHandlers.createPlanItem(txDb, ownerUserId(req), req.body, deps.recordAction, req.get('Idempotency-Key'))
      );
      res.status(201).json(item);
    })
  );

  app.patch(
    '/api/v1/plan-items/:planItemId',
    asyncHandler(async (req, res) => {
      const item = await deps.withTransaction((txDb) =>
        planItemHandlers.updatePlanItem(txDb, ownerUserId(req), param(req, 'planItemId'), req.body, deps.recordAction)
      );
      res.status(200).json(item);
    })
  );

  app.delete(
    '/api/v1/plan-items/:planItemId',
    asyncHandler(async (req, res) => {
      // М'яке видалення (AC-04) -- 204 без тіла, точно як у контракті:
      // віддавати назад щойно прибраний пункт означало б вигадати поле,
      // якого в openapi.yaml немає.
      await deps.withTransaction((txDb) =>
        planItemHandlers.deletePlanItem(txDb, ownerUserId(req), param(req, 'planItemId'), deps.recordAction)
      );
      res.status(204).end();
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
    // Review 2026-09-07 A1: доменні помилки валідації (CardValidationError,
    // ProgressValidationError) НАВМИСНО не є AppError -- домен нічого не знає
    // про HTTP (шарова архітектура, sad.md §5). До цього фіксу вони падали в
    // generic-гілку нижче (500 замість контрактного 422 card.name_required/
    // card.description_required) -- домен уже несе правильний `code`, тут
    // лише додаємо статус, як і для AppError вище.
    // T8: PlanItemValidationError -- рівно та сама історія, що A1 вище (домен
    // ПЛАНу так само нічого не знає про HTTP і несе лише код
    // plan_item.text_required / plan_item.horizon_invalid). Без цієї гілки
    // порожній текст пункту віддавав би 500 замість контрактної 422.
    if (err instanceof CardValidationError || err instanceof ProgressValidationError || err instanceof PlanItemValidationError) {
      res.status(422).json({ code: err.code, message: err.message });
      return;
    }
    // Review 2026-09-11 (Частина 2), знято вимогами 14/15 (плоска модель
    // layoutMode, logicVariant прибраний), і знову D-131-наступним рішенням
    // (2026-09-15, вільне полотно): domain/layout.ts більше не кидає жодної
    // власної помилки взагалі (LayoutValidationError і assertCellAvailable,
    // разом із колізією клітинки AC-02, прибрані повністю -- вільне
    // позиціювання не має інваріанту, який варто було б перевіряти тут).
    // Якщо колись знову з'явиться доменна помилка розкладки -- гілка
    // повертається як AppError-обгортка в самому use-case (той самий підхід,
    // що app/move-card.ts застосовує для інших кодів), а не тут генерично.
    // Review 2026-09-07, post-ship follow-up review ("Express 5 req.body ->
    // 500"): T50 handled req.body===undefined, але зіпсований JSON
    // (entity.parse.failed) чи завеликий (entity.too.large) -- окрема
    // помилка body-parser (express.json()) з готовим числовим `status`
    // (400/413) -- жодна гілка тут цього не перевіряла, тож обидва падали в
    // generic 500 нижче попри те, що самі несуть правильну відповідь.
    const bodyParserStatus = (err as { status?: unknown; statusCode?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode;
    if (typeof bodyParserStatus === 'number' && bodyParserStatus >= 400 && bodyParserStatus < 500) {
      res.status(bodyParserStatus).json({ code: 'request.invalid_body', message: 'Некоректне тіло запиту' });
      return;
    }
    // eslint-disable-next-line no-console -- немає власного логера (one-person MVP, ADR-0006).
    console.error(err);
    // AC-20 (US-14, "агент сам виявив технічну помилку чи збій") -- цей
    // catch-all і є та точка: справжня, непередбачена помилка (не звичайний
    // очікуваний доменний код 4xx/5xx на кшталт agent.llm_unavailable вище).
    // Best-effort, fire-and-forget: клієнт мусить отримати ЦЮ Ж саму 500-
    // відповідь незалежно від того, чи вдалось зафайлити звіт -- filing
    // ніколи не є частиною контракту відповіді (звідси .catch(() => {}),
    // а не await/throw). ownerUserId НЕ передається -- ця точка не
    // гарантовано має користувача (запит міг впасти ще до Bearer-auth-
    // middleware, напр. у POST /api/v1/session), тож "без userId" тут
    // безпечніший, а не менш правильний варіант, ніж читання req.ownerUserId.
    // Best-effort лише коли DI-залежності реально підключені (composition
    // root, server/index.ts) -- у юніт-тестах/раннix середовищах без
    // emailTransport/developerEmail генерик-гілка й далі поводиться так, як
    // до цього фіксу.
    if (deps.emailTransport && deps.developerEmail) {
      const errorSummary = err instanceof Error && err.message ? err.message : 'Unexpected server error';
      fileAgentDetectedErrorReport(
        { db: deps.db, transport: deps.emailTransport, developerEmail: deps.developerEmail },
        { errorSummary }
      ).catch(() => {
        // Навмисно проковтнуто (review finding fix): збій самого filing
        // (БД, email-провайдер) НЕ повинен ані змінити вже надіслану
        // клієнту відповідь, ані впасти некерованим unhandled rejection.
      });
    }
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
