// Доменна модель activity-report (CONTEXT.md, AC-11) -- обчислення меж
// періоду (тижневий/місячний/квартальний) і ключа ідемпотентності, якими
// worker (app-шар T12+) керується за власним розкладом (ADR-0002, sad.md
// Critical flow 14).
//
// Чиста функція, без I/O (plan/app/CLAUDE.md, "domain -> НІЧОГО"): worker
// підставляє сюди дату відліку (звичайно "сьогодні"), отримує межі періоду,
// читає активність за них із БД і зберігає результат як
// activity_report.period_start/period_end (data-model.md).
//
// Дати -- рядки YYYY-MM-DD (DATE-колонка, без часу й часового поясу). Рахуємо
// в UTC-полях, зібраних із самого рядка (Date.UTC), той самий підхід, що вже
// описаний у cards/life-area-card/ports/metric-block-handlers.ts для
// targetDate -- жодного toISOString() з локальної дати, щоб не зсунути
// календарну дату часовим поясом.
//
// Межа тижня: ISO-тиждень, понеділок..неділя. Місяць/квартал: календарні
// (квартал -- січ-берез/квіт-черв/лип-верес/жовт-груд). Це не зафіксовано
// явно в spec.md/data-model.md/sad.md -- найконсервативніше й найпоширеніше
// трактування "тижневий/місячний/квартальний звіт" (D-70); якщо продукт
// матиме інший розклад (наприклад, тиждень з неділі), тут одна точка правки.

export type ReportPeriodType = 'weekly' | 'monthly' | 'quarterly';

export interface ReportPeriodBounds {
  periodStart: string;
  periodEnd: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDateOnly(dateOnly: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return { year, month, day };
}

function toDateOnlyString(utcMs: number): string {
  const d = new Date(utcMs);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function computeWeeklyBounds(refUtc: number): ReportPeriodBounds {
  const refDay = new Date(refUtc).getUTCDay(); // 0=нд..6=сб
  const isoDayIndex = refDay === 0 ? 7 : refDay; // 1=пн..7=нд
  const mondayUtc = refUtc - (isoDayIndex - 1) * MS_PER_DAY;
  const sundayUtc = mondayUtc + 6 * MS_PER_DAY;
  return { periodStart: toDateOnlyString(mondayUtc), periodEnd: toDateOnlyString(sundayUtc) };
}

function computeMonthlyBounds(year: number, month: number): ReportPeriodBounds {
  const startUtc = Date.UTC(year, month - 1, 1);
  const endUtc = Date.UTC(year, month, 0); // день 0 наступного місяця = останній день цього
  return { periodStart: toDateOnlyString(startUtc), periodEnd: toDateOnlyString(endUtc) };
}

function computeQuarterlyBounds(year: number, month: number): ReportPeriodBounds {
  const quarterIndex = Math.floor((month - 1) / 3); // 0..3
  const startMonth = quarterIndex * 3; // 0,3,6,9 (0-based)
  const startUtc = Date.UTC(year, startMonth, 1);
  const endUtc = Date.UTC(year, startMonth + 3, 0);
  return { periodStart: toDateOnlyString(startUtc), periodEnd: toDateOnlyString(endUtc) };
}

/** Межі періоду (period_start/period_end), що містить referenceDate, для заданого типу звіту. */
export function computeReportPeriod(
  periodType: ReportPeriodType,
  referenceDate: string,
): ReportPeriodBounds {
  const { year, month, day } = parseDateOnly(referenceDate);

  if (periodType === 'weekly') {
    return computeWeeklyBounds(Date.UTC(year, month - 1, day));
  }
  if (periodType === 'monthly') {
    return computeMonthlyBounds(year, month);
  }
  return computeQuarterlyBounds(year, month);
}

/**
 * Ключ ідемпотентності автозвіту (Flow 14, AC-11) -- відповідає унікальному
 * індексу `uq_activity_report_period (user_id, period_type, period_start)`
 * (data-model.md): той самий (user, period_type, period_start) завжди дає
 * той самий ключ, тож worker розпізнає "звіт за цей період уже існує" ще до
 * звернення в БД.
 */
export function activityReportIdempotencyKey(
  userId: string,
  periodType: ReportPeriodType,
  periodStart: string,
): string {
  return `${userId}:${periodType}:${periodStart}`;
}
