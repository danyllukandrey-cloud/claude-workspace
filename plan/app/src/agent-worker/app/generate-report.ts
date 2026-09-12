// T19 -- App (agent-worker): generate-report use-case (US-08, AC-11,
// sad.md Critical flow 14).
//
// Оркеструє T11's domain/report.ts (period bounds + idempotency key) разом з
// T15's infra/schedule.ts (cross-feature read life-area-card activity +
// idempotent persist) і додає те, що Flow 14 залишає App-шару (schedule.ts
// file header, "retry/backoff/dead-letter -- поза межами infra"):
//
//   1. рахує межі періоду (computeReportPeriod) для заданого (userId,
//      periodType, referenceDate) -- referenceDate = "сьогодні" з точки зору
//      власного розкладу worker'а (ADR-0002), інжектується викликачем
//      (composition root / крон-тригер, поза цим файлом);
//   2. читає підтверджену активність користувача за цей період
//      (readLifeAreaCardActivity, cross-feature read) і формує текст звіту
//      (`activity_report.content`, data-model.md) -- пасивний, без жодного
//      надсилання (D-70/D-43: "агент нічого не надсилає й нікого не
//      перериває");
//   3. намагається зберегти рядок ідемпотентно (saveActivityReport,
//      ON CONFLICT DO NOTHING на data-model.md's uq_activity_report_period)
//      -- на успіху повертає 'generated' чи 'duplicate' (звіт за цей період
//      уже існував, другий прогін нічого не додав, той самий сценарій, що
//      schedule.test.ts вже покриває для самого примітива);
//   4. якщо запис кидає (недоступна БД, збій з'єднання -- не очікуваний
//      доменний результат, а аварійна ситуація ADR-0006 §Neutral), повторює
//      з backoff (Flow 14: "retry N разів з backoff"); після вичерпання
//      спроб пише ОКРЕМИЙ dead-letter запис -- явний UPSERT, що ставить
//      `status = 'dead_letter'` (data-model.md), а не мовчазна відмова чи
//      нескінченний повтор (Flow 14: "звіт позначається як такий, що
//      потребує ручної перевірки").
//
// N (кількість спроб) і крок backoff НЕ зафіксовані числом у spec.md/sad.md
// (Flow 14 каже лише "retry N разів з backoff") -- WRITE_ATTEMPTS/
// BACKOFF_BASE_MS нижче найконсервативніше мінімальне значення, одна точка
// правки, якщо продукт колись зафіксує точне число (те саме застереження,
// що вже є в ../domain/report.ts для меж тижня/кварталу).
//
// DI (ADR-0004, той самий принцип, що ../app/daily-sync.ts і
// ../infra/resource-writer.ts): `db` і `sleep` -- explicit deps, файл сам
// з'єднання/таймера не створює. `sleep` інжектується для тестованості --
// юніт-тест підставляє миттєву заглушку замість реального очікування
// (той самий підхід, що DI Claude/email/resource клієнтів деінде в цій
// фічі, тут застосований до `setTimeout`, а не мережевого виклику).

import { randomUUID } from 'node:crypto';
import type { Db, ActivityReportInput } from '../infra/schedule';
import { readLifeAreaCardActivity, saveActivityReport } from '../infra/schedule';
import { computeReportPeriod } from '../domain/report';
import type { ReportPeriodType } from '../domain/report';

export interface GenerateReportDeps {
  db: Db;
  /** Ін'єктована затримка -- юніт-тест підставляє `async () => {}`, реальний виклик -- обгортка над `setTimeout`. */
  sleep: (ms: number) => Promise<void>;
}

export interface GenerateReportInput {
  userId: string;
  periodType: ReportPeriodType;
  /** "Сьогодні" з точки зору worker'а (ADR-0002) -- YYYY-MM-DD, той самий формат, що computeReportPeriod. */
  referenceDate: string;
  /** id майбутнього рядка `activity_report` -- за замовчуванням `crypto.randomUUID()`; параметризовано для тестованості (той самий підхід, що T42's insertDeveloperReport). */
  reportId?: string;
}

export type GenerateReportStatus = 'generated' | 'duplicate' | 'dead_letter';

export interface GenerateReportOutcome {
  status: GenerateReportStatus;
  reportId: string;
}

/** 1 початкова спроба + 2 повтори -- див. коментар угорі файлу щодо непрописаного явно числа N. */
const WRITE_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 200;

function backoffDelayMs(attempt: number): number {
  return BACKOFF_BASE_MS * 2 ** (attempt - 1); // 200мс, 400мс, ...
}

/**
 * Пасивний текст звіту (`activity_report.content`) -- людиночитний підсумок
 * підтвердженої активності за період; порожня активність -- валідний, не
 * помилковий випадок (звіт "нічого не сталось цього тижня" так само пасивний).
 */
function buildReportContent(
  periodType: ReportPeriodType,
  periodStart: string,
  periodEnd: string,
  activity: Awaited<ReturnType<typeof readLifeAreaCardActivity>>
): string {
  const totalAmount = activity.reduce((sum, record) => sum + record.amount, 0);
  const lines = activity.map(
    (record) => `- ${record.recordedAt.toISOString().slice(0, 10)}: ${record.rawText ?? ''} (${record.amount})`
  );
  return [
    `Звіт активності (${periodType}) за ${periodStart}..${periodEnd}`,
    `Записів: ${activity.length}, сумарно: ${totalAmount}`,
    ...lines,
  ].join('\n');
}

/**
 * Явний dead-letter запис (Flow 14) -- окремий SQL-текст від
 * schedule.ts's saveActivityReport, бо той навмисно не приймає `status`
 * (примітив лишається "просто ідемпотентний INSERT", позначення dead_letter
 * -- відповідальність App-шару, той самий поділ, що коментар schedule.ts
 * прямо називає). `ON CONFLICT ... DO UPDATE` (а не DO NOTHING) -- якщо рядок
 * усе ж встиг з'явитись раніше (наприклад інший worker-прогін встиг
 * записати його між невдалими спробами цього виклику), позначаємо його
 * dead_letter, а не мовчки лишаємо конфлікт непоміченим.
 */
async function writeDeadLetter(db: Db, input: ActivityReportInput): Promise<void> {
  await db.query(
    `INSERT INTO activity_report (id, user_id, period_type, period_start, period_end, content, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'dead_letter')
     ON CONFLICT (user_id, period_type, period_start)
     DO UPDATE SET status = 'dead_letter'`,
    [input.id, input.userId, input.periodType, input.periodStart, input.periodEnd, input.content]
  );
}

/**
 * Один прогін генерації звіту за конкретний період (Flow 14) -- викликається
 * worker'ом за власним розкладом, окремо на (userId, periodType) (composition
 * root / крон-тригер вирішує, для кого й коли, поза цим файлом).
 */
export async function generateReport(
  deps: GenerateReportDeps,
  input: GenerateReportInput
): Promise<GenerateReportOutcome> {
  const reportId = input.reportId ?? randomUUID();
  const { periodStart, periodEnd } = computeReportPeriod(input.periodType, input.referenceDate);

  const activity = await readLifeAreaCardActivity(deps.db, input.userId, periodStart, periodEnd);
  const content = buildReportContent(input.periodType, periodStart, periodEnd, activity);

  const reportInput: ActivityReportInput = {
    id: reportId,
    userId: input.userId,
    periodType: input.periodType,
    periodStart,
    periodEnd,
    content,
  };

  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt++) {
    try {
      const result = await saveActivityReport(deps.db, reportInput);
      return { status: result.inserted ? 'generated' : 'duplicate', reportId };
    } catch {
      if (attempt < WRITE_ATTEMPTS) {
        await deps.sleep(backoffDelayMs(attempt));
      }
    }
  }

  // Усі WRITE_ATTEMPTS спроб провалились -- dead-letter (Flow 14: "звіт
  // позначається як такий, що потребує ручної перевірки"), не мовчазна
  // втрата й не нескінченний повтор.
  await writeDeadLetter(deps.db, reportInput);
  return { status: 'dead_letter', reportId };
}
