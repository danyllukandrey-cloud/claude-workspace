// Доменна модель розкладу синхронізації зовнішніх ресурсів (`sync_resource`,
// data-model.md), T35 (AC-18). Дзеркалить логіку меж періоду з T11
// (`agent-worker/domain/report.ts`) -- лише крок один календарний день, а
// не тижневий/місячний/квартальний. Як і report.ts, це ЧИСТІ функції: домен
// не читає й не пише в БД (plan/app/CLAUDE.md -- "domain -> НІЧОГО"), він
// лише каже, який ресурс потребує синхронізації ЗАРАЗ, маючи вже прочитані
// поля з `sync_resource`.

export type SyncResourceStatus = 'active' | 'error';

/**
 * Поля `sync_resource` (data-model.md), потрібні саме для розкладу.
 * `lastSyncedAt` приймає і `Date`, і ISO-рядок -- infra-шар (postgres-repo,
 * T13/T38) може віддати timestamptz як рядок, і домену не варто змушувати
 * викликача парсити його заздалегідь.
 */
export interface SyncResourceForSchedule {
  id: string;
  status: SyncResourceStatus;
  lastSyncedAt: Date | string | null;
}

/** Межі одного календарного дня (UTC), що містить `date`: `start` включно, `end` виключно -- той самий вигляд відповіді, що period_start/period_end у T11. */
export interface CalendarDayBoundary {
  start: Date;
  end: Date;
}

/**
 * Ключ ідемпотентності на календарний день -- дзеркалить роль `period_start`
 * у T11's `(user_id, period_type, period_start)`: тут крок завжди "день",
 * тож ключем є сама дата у форматі YYYY-MM-DD (UTC).
 *
 * ПРИПУЩЕННЯ (нічого в spec.md/data-model.md/sad.md не фіксує часовий
 * пояс користувача для цієї межі, на відміну від `session_date` D-26, де
 * теж не уточнено): межа дня -- UTC, найконсервативніший варіант без
 * додаткової залежності. Якщо пізніше з'явиться пер-користувацький часовий
 * пояс -- ця функція єдине місце, яке довелось би змінити.
 */
export function calendarDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Межі календарного дня (UTC), що містить `date` -- аналог period-boundary розрахунку T11, крок "день". */
export function calendarDayBoundary(date: Date): CalendarDayBoundary {
  const key = calendarDayKey(date);
  return {
    start: new Date(`${key}T00:00:00.000Z`),
    end: new Date(new Date(`${key}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000),
  };
}

/**
 * Чи потребує ресурс синхронізації прямо зараз (AC-18): ще не було успішного
 * чи невдалого проходу СЬОГОДНІ (за `now`) -- незалежно від `status`.
 *
 * `status: 'error'` навмисно НЕ виключає ресурс з відбору (DoD T35, другий
 * unit-тест): помилка минулої спроби фіксується для банера користувачу
 * (AC-18b), а не як "здався назавжди" -- інакше ресурс застряг би в стані
 * `error` без жодного нового шансу. AC-18b "не намагається мовчки
 * повторювати нескінченно" стосується частоти В МЕЖАХ ДНЯ (без тісного
 * циклу ретраїв), а не забороняє звичайний щоденний прохід, який тут і є.
 *
 * Примітка на майбутнє (не рішення цієї задачі): `idx_sync_resource_active`
 * у data-model.md звужений до `WHERE status = 'active'`, а ця функція
 * навмисно свідома і для `'error'` -- якщо infra-запит колись буде звужений
 * тим самим партиковим індексом, помилкові ресурси випадуть із щоденного
 * проходу всупереч цій доменній логіці й DoD T35. Вартує уваги людини.
 */
export function isDueForSync(resource: SyncResourceForSchedule, now: Date): boolean {
  if (resource.lastSyncedAt === null) {
    return true;
  }

  const lastSyncedAt =
    typeof resource.lastSyncedAt === 'string' ? new Date(resource.lastSyncedAt) : resource.lastSyncedAt;

  return calendarDayKey(lastSyncedAt) !== calendarDayKey(now);
}

/** Відбір усіх ресурсів, що потребують синхронізації зараз (AC-18) -- фільтр `isDueForSync` над партією. */
export function selectDueForSync(
  resources: SyncResourceForSchedule[],
  now: Date,
): SyncResourceForSchedule[] {
  return resources.filter((resource) => isDueForSync(resource, now));
}
