// T12 -- Підключення допомоги агента в чаті (AC-06/AC-09, sad.md §6 Critical
// flow 4) проти РЕАЛЬНОЇ Neon (ADR-0006, server/db.ts createDb()) -- та сама
// конвенція, що ../ports/plan-item-handlers.integration.test.ts.
//
// Що саме доводиться тут (і чого НЕ доводить жоден юніт-тест):
// 1. AC-09 -- підтвердження пропозиції в чаті створює пункт ТИМ САМИМ шляхом
//    створення, що й пряме введення на сторінці ПЛАН: колбек, який зв'язує
//    композиційний корінь (server/app.ts), -- це буквально
//    ports/plan-item-handlers.createPlanItem, той самий, що обслуговує
//    POST /api/v1/plan-items. Підтверджений текст доходить до бази незмінним.
// 2. AC-06 -- хід, у якому агент лише ПРОПОНУЄ формулювання, не лишає в
//    plan_item жодного сліду: сторінка ПЛАН (listPlanItems -- те саме
//    читання, що GET /api/v1/plan-items) показує рівно те, що було до ходу.
//
// Claude тут не викликається по-справжньому: `askClaude` -- стаб, що повертає
// рівно той JSON-конверт, яким handle-message.ts інструктує відповідати
// (та сама межа, що вже мокована в ../../agent/app/handle-message.test.ts).
// Реальна тут -- БАЗА, бо перевіряється саме факт запису/незапису.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMessage } from '../../agent/ports/chat-handler';
import { createPlanItem, listPlanItems } from '../ports/plan-item-handlers';
import type { AskClaude } from '../../agent/infra/claude-client';
import { createDb, type DbWithTransaction } from '../../../server/db';

beforeAll(() => {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // уже завантажено (напр. --env-file прокинутий викликачем) -- ігноруємо
  }
});

const PROPOSED_TEXT = 'Записатись до сімейного лікаря цього тижня';

/** Рівно той конверт, яким handle-message.ts інструктує відповідати Claude. */
function decision(extra: Record<string, unknown>): string {
  return JSON.stringify({
    outcome: 'clarification',
    reply: 'Гаразд.',
    cardId: null,
    metricBlockId: null,
    proposedAmount: null,
    proposedSummary: null,
    activeProposalRelated: false,
    ...extra,
  });
}

function stubClaude(payload: string): AskClaude {
  return async () => ({ ok: true, value: payload });
}

describe('T12 -- пропозиція агента в чаті й підтвердження (AC-06/AC-09, реальна БД)', () => {
  let db: DbWithTransaction;
  let userId: string;

  /**
   * Те саме зв'язування, що робить композиційний корінь (server/app.ts):
   * agent нічого не знає про plan-horizons, він лише викликає переданий
   * колбек -- а колбек веде в ports/plan-item-handlers.createPlanItem, той
   * самий вхід, що й POST /api/v1/plan-items прямого введення.
   */
  function boundCreatePlanItem() {
    return (input: { ownerUserId: string; horizon: string; planText: string }) =>
      createPlanItem(db, input.ownerUserId, { horizon: input.horizon, planText: input.planText });
  }

  beforeAll(async () => {
    db = createDb();
    userId = crypto.randomUUID();
    await db.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
      userId,
      `test-t12-${userId}`,
      `t12-${userId}@example.test`,
    ]);
  });

  afterAll(async () => {
    await db.query('DELETE FROM app_user WHERE id = $1', [userId]);
    await db.end();
  });

  it('AC-06: непідтверджена пропозиція лишається лише в чаті -- на сторінці ПЛАН її немає', async () => {
    const before = await listPlanItems(db, userId);

    const turn = await createMessage(
      db,
      stubClaude(
        decision({
          reply: `Пропоную так: «${PROPOSED_TEXT}». Підтвердиш?`,
          planItemProposal: { horizon: 'tactical', planText: PROPOSED_TEXT },
        })
      ),
      userId,
      { content: 'хочу щось зробити зі здоровʼям, допоможи сформулювати' },
      { createPlanItem: boundCreatePlanItem() }
    );

    // Формулювання справді дійшло до користувача -- саме в чаті, і ніде більше.
    expect(turn.reply).toContain(PROPOSED_TEXT);

    const after = await listPlanItems(db, userId);
    expect(after.items.map((item) => item.planText)).not.toContain(PROPOSED_TEXT);
    expect(after.items).toHaveLength(before.items.length);

    // Сильніша перевірка, ніж "не видно в списку": жодного рядка в самій
    // таблиці -- у тому числі прихованого 'removed'-пункта, яким можна було б
    // спокусливо реалізувати "очікує підтвердження" (sad.md §4 п.3 такий стан
    // на сервері прямо забороняє).
    const { rows } = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM plan_item WHERE owner_user_id = $1', [
      userId,
    ]);
    expect(rows[0]?.count).toBe('0');
  });

  it('AC-09: підтвердження в чаті створює пункт тим самим шляхом, що й пряме введення', async () => {
    await createMessage(
      db,
      stubClaude(
        decision({
          reply: 'Додав до тактичного горизонту.',
          confirmedPlanItem: { horizon: 'tactical', planText: PROPOSED_TEXT },
        })
      ),
      userId,
      { content: 'так, додай' },
      { createPlanItem: boundCreatePlanItem() }
    );

    // Сторінка ПЛАН (те саме читання, що GET /api/v1/plan-items) показує пункт.
    const page = await listPlanItems(db, userId);
    const created = page.items.filter((item) => item.planText === PROPOSED_TEXT);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ horizon: 'tactical', done: false });

    // Той самий запис у базі, що й від прямого введення: власник -- із
    // авторизованого контексту, стан -- активний, текст -- підтверджений.
    const { rows } = await db.query<{ owner_user_id: string; status: string; plan_text: string }>(
      'SELECT owner_user_id, status, plan_text FROM plan_item WHERE id = $1',
      [created[0].id]
    );
    expect(rows[0]).toMatchObject({ owner_user_id: userId, status: 'active', plan_text: PROPOSED_TEXT });
  });
});
