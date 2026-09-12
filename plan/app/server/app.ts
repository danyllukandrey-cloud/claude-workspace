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
  findStructureByOwner,
  insertLayoutPosition,
  listActiveLayoutPositionsByOwner,
} from '../src/structure/infra/postgres-repo';
import { recordCardRenameEvent } from '../src/structure/infra/history-repo';
import { defaultPositionForNewCard } from '../src/structure/domain/layout';
// Review 2026-09-11 (MUST-FIX 1): порти Структури існували й були покриті
// юніт-тестами, але composition root їх НЕ монтував -- кожен шлях
// /api/v1/structure* віддавав 404, тож уся фіча була недосяжна з реального
// застосунку. Той самий клас дефекту, що A2/B5 вище.
import * as structureHandlers from '../src/structure/ports/structure-handlers';
import * as layoutHandlers from '../src/structure/ports/layout-handlers';
import { LayoutValidationError } from '../src/structure/domain/layout';

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
 * AC-09 -- нова картка одразу отримує клітинку за замовчуванням (review
 * 2026-09-11, MUST-FIX 6: `defaultPositionForNewCard` і `insertLayoutPosition`
 * існували й були покриті тестами, але жоден рядок production-коду їх не
 * викликав, тож нова картка не отримувала клітинки НІКОЛИ).
 *
 * Живе тут, у composition root -- ЄДИНОМУ місці, де life-area-card і structure
 * зустрічаються (ADR-0004: life-area-card нічого не імпортує з structure/
 * напряму), рівно як closeActiveLayoutPositionForCard для DELETE /cards/{id}.
 *
 * `db` приходить параметром і це ТОЙ САМИЙ db, у якому щойно вставилась сама
 * картка -- тобто та сама транзакція (deps.withTransaction у маршруті нижче):
 * збій тут відкочує й INSERT картки, інакше AC-09 виконано наполовину (картка
 * є, клітинки немає). Помилка навмисно НЕ глушиться.
 *
 * Структури ще немає (перший вхід -- вона провісниться лениво на першому
 * GET /structure, ports/structure-handlers.ts) -- тихо нічого не робимо: це не
 * помилка, картка просто чекатиме в треї нерозкладених, щойно Структура
 * з'явиться (AC-17 описує рівно такий стан "картка без клітинки").
 */
async function assignDefaultLayoutPosition(db: Db, ownerUserId: string, cardId: string): Promise<void> {
  const structure = await findStructureByOwner(db, ownerUserId);
  if (!structure) {
    return;
  }

  const existing = await listActiveLayoutPositionsByOwner(db, ownerUserId);
  const { cellIndex } = defaultPositionForNewCard(existing, structure.layoutMode);

  await insertLayoutPosition(db, {
    id: crypto.randomUUID(),
    structureId: structure.id,
    cardId,
    cellIndex,
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
  app.use(express.json());
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
        const created = await cardHandlers.createCard(txDb, ownerUserId(req), req.body);
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
        cardHandlers.updateCard(txDb, ownerUserId(req), param(req, 'cardId'), req.body, recordCardRenameEvent)
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
        cardHandlers.archiveCard(txDb, ownerUserId(req), param(req, 'cardId'), closeActiveLayoutPositionForCard)
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
      const card = await deps.withTransaction((txDb) => cardHandlers.restoreCard(txDb, ownerUserId(req), param(req, 'cardId')));
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
      // Review 2026-09-07 B5 (remainder, T41): updateMetricBlock (card_id) +
      // reassignEntriesToCard (entry.card_id денормалізовано, AC-14) --
      // ОБОВ'ЯЗКОВА пара (коментар у use-case), той самий клас бага, що T40:
      // без транзакції відмова другого запису лишила б блок на новій картці,
      // а його записи -- на старій.
      const block = await deps.withTransaction((txDb) =>
        metricBlockHandlers.transferMetricBlock(txDb, ownerUserId(req), param(req, 'cardId'), req.body)
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
        entryHandlers.createEntry(txDb, ownerUserId(req), param(req, 'cardId'), param(req, 'metricBlockId'), req.body)
      );
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
        structureHandlers.updateStructure(txDb, ownerUserId(req), req.body)
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
        layoutHandlers.moveCardPosition(txDb, ownerUserId(req), param(req, 'cardId'), req.body)
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
        layoutHandlers.closeCardPosition(txDb, ownerUserId(req), param(req, 'cardId'), req.body)
      );
      res.status(200).json(position);
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
    if (err instanceof CardValidationError || err instanceof ProgressValidationError) {
      res.status(422).json({ code: err.code, message: err.message });
      return;
    }
    // Review 2026-09-11 (Частина 2): те саме для домену Структури --
    // LayoutValidationError (src/structure/domain/layout.ts) теж навмисно НЕ
    // AppError. До цього фіксу будь-яка доменна помилка розкладки падала в
    // generic 500 нижче: зокрема PATCH /structure зі зміною підвиду "за
    // логікою" на структурі, що вже не в режимі 'logic' (switchLogicVariant),
    // хоча контракт документує тут 422.
    //
    // На відміну від card-домену, LayoutValidationError поки не несе власного
    // `code` (його додання -- зміна domain/layout.ts, поза скоупом цього
    // фіксу), а єдина така помилка, що реально доходить до транспорту, -- саме
    // інваріант AC-16 "підвид лише в режимі logic": колізію клітинки
    // (assertCellAvailable) app/move-card.ts уже перегортає в AppError 409 до
    // того, як вона сюди дійде. Тому код нижче -- контрактний
    // structure.logic_variant_requires_logic_mode; щойно домен почне нести
    // власний `code`, ця гілка мусить пропускати його, як робить гілка вище.
    if (err instanceof LayoutValidationError) {
      res.status(422).json({ code: 'structure.logic_variant_requires_logic_mode', message: err.message });
      return;
    }
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
