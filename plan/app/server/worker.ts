// Composition root for the agent-worker process (review fix -- see the
// review finding this closes: generate-report.ts's generateReport and
// daily-sync.ts's runDailySync were fully implemented and unit-tested, but
// nothing in production ever called them, so AC-11 reports and AC-18/AC-18b
// resource sync were completely non-functional end to end).
//
// This is a SEPARATE, ADDITIVE entry point -- it does not touch server/app.ts
// or server/index.ts's HTTP server. Run via:
//   npm run dev:worker  (see package.json's "dev:worker" script, mirroring
//   "dev:server"'s exact tsx-based dev convention).
//
// Builds its `db` the SAME way server/index.ts does (createDb()) rather than
// a second bespoke composition style -- sad.md §5 already declares `worker`
// as its own top-level module/C4-container that reads the same Postgres as
// `backend-service` (ADR-0002), not a separate package.
//
// Scheduling choice (deviation from sad.md's literal wording, noted
// explicitly as instructed): sad.md §7 "Topology" floats "node-cron у тому
// самому Node-процесі" as ONE example of how backend-service and worker can
// share a physical process, not a decision that binds this file to the
// node-cron library. A plain setInterval tick gives the exact same
// observable behaviour -- a process that wakes up periodically and does
// whatever work is due -- with zero new dependencies, which fits this
// project's stated scale (one person + a ~30-person focus group, D-55;
// sad.md §7: "без реплік, без autoscaling"). This is an ordinary engineering
// call within an option sad.md itself already left open, not a new
// project-level decision worth a D-NN entry.

import { fileURLToPath } from 'node:url';
import { createDb } from './db';
import { generateReport } from '../src/agent-worker/app/generate-report';
import type { ReportPeriodType } from '../src/agent-worker/domain/report';
import { runDailySync } from '../src/agent-worker/app/daily-sync';
import type { Db } from '../src/agent-worker/infra/schedule';
import type { ExternalDocClient } from '../src/agent-worker/infra/resource-writer';

// AC-11 covers three report cadences; generateReport is idempotent per
// (user_id, period_type, period_start) via `saveActivityReport`'s
// `ON CONFLICT ... DO NOTHING` (schedule.ts). That means "is this period
// due" does not need its own separate calendar check here: calling
// generateReport for all three period types on every tick is safe and
// correct -- a period that was already generated simply comes back
// 'duplicate' (a no-op), and a newly-entered period (the date rolled past a
// week/month/quarter boundary since the last tick) naturally produces
// exactly one 'generated' row the first time a tick's referenceDate falls in
// it. This mirrors how generate-report.test.ts itself exercises the
// use-case: one (periodType, referenceDate) pair at a time, relying on the
// unique index for repeat-call safety rather than a separate "due" predicate.
const REPORT_PERIOD_TYPES: ReportPeriodType[] = ['weekly', 'monthly', 'quarterly'];

// AC-18 asks for a "щоденної синхронізації" (daily sync) and
// isDueForSync/runDailySync already gate on calendar-day granularity
// (sync-resource.ts), so ticking more often than a day is harmless -- it
// just means a resource whose sync failed or whose worker process restarted
// gets picked up sooner instead of waiting a full day for the next tick.
const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1 година

function todayDateOnly(now: Date): string {
  // YYYY-MM-DD from UTC fields (report.ts's own convention/comment: never
  // derive a calendar date via a local-timezone toISOString() shortcut).
  return now.toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface AppUserRow {
  id: string;
}

/**
 * Enumerates every `app_user` id. This worker deliberately iterates ALL
 * users by design (AC-11/AC-18 are both "for every user with something due",
 * not a request scoped to one signed-in caller), so it does not need the
 * ports-layer non-disclosure/ownership machinery that the HTTP routes use.
 */
async function listAllUserIds(db: Db): Promise<string[]> {
  const { rows } = await db.query<AppUserRow>('SELECT id FROM app_user');
  return rows.map((row) => row.id);
}

export interface WorkerDeps {
  db: Db;
  sleep: (ms: number) => Promise<void>;
  writeToResource: ExternalDocClient;
  /** Injected clock -- defaults to `() => new Date()`; a test pins it for a deterministic referenceDate/`now`. */
  now?: () => Date;
}

export interface RunOnceResult {
  reportsGenerated: number;
  reportsDuplicate: number;
  reportsDeadLetter: number;
  reportFailures: number;
  syncOutcomes: number;
  syncFailures: number;
}

/**
 * One worker tick, extracted out of the setInterval plumbing so a test can
 * call it exactly once with a fake Db/deps and assert on the result --
 * setInterval itself is untestable/uninteresting glue, this function is the
 * actual logic (per-task instruction: test the tick, not the timer).
 *
 * Never throws (task requirement -- "one user's failure must not silently
 * stop the whole worker for everyone else"): failure to enumerate users, a
 * single user's generateReport call, and the whole daily-sync pass are each
 * caught and logged independently, so one broken user or one broken sync
 * pass never prevents the rest of the tick's work.
 */
export async function runOnce(deps: WorkerDeps): Promise<RunOnceResult> {
  const now = (deps.now ?? (() => new Date()))();
  const referenceDate = todayDateOnly(now);

  const result: RunOnceResult = {
    reportsGenerated: 0,
    reportsDuplicate: 0,
    reportsDeadLetter: 0,
    reportFailures: 0,
    syncOutcomes: 0,
    syncFailures: 0,
  };

  let userIds: string[];
  try {
    userIds = await listAllUserIds(deps.db);
  } catch (err) {
    console.error('[worker] не вдалось прочитати app_user -- пропускаю тік звітів', err);
    userIds = [];
  }

  for (const userId of userIds) {
    for (const periodType of REPORT_PERIOD_TYPES) {
      try {
        const outcome = await generateReport(
          { db: deps.db, sleep: deps.sleep },
          { userId, periodType, referenceDate }
        );
        if (outcome.status === 'generated') {
          result.reportsGenerated++;
        } else if (outcome.status === 'duplicate') {
          result.reportsDuplicate++;
        } else {
          result.reportsDeadLetter++;
        }
      } catch (err) {
        // Один користувач/період не зупиняє решту -- лог і далі.
        result.reportFailures++;
        console.error(`[worker] generateReport провалився -- user=${userId} period=${periodType}`, err);
      }
    }
  }

  try {
    const syncOutcomes = await runDailySync(deps.db, deps.writeToResource, now);
    result.syncOutcomes = syncOutcomes.length;
    result.syncFailures = syncOutcomes.filter((outcome) => !outcome.ok).length;
  } catch (err) {
    console.error('[worker] runDailySync провалився цілком -- пропускаю синхронізацію цього тіку', err);
  }

  console.log(
    `[worker] тік завершено (${referenceDate}): звіти generated=${result.reportsGenerated} duplicate=${result.reportsDuplicate} dead_letter=${result.reportsDeadLetter} failed=${result.reportFailures}; sync outcomes=${result.syncOutcomes} failed=${result.syncFailures}`
  );

  return result;
}

function startWorker(): void {
  const db = createDb();

  // AC-18/AC-18b: жодного OAuth/HTTP-клієнта до Google Docs/Sheets ще не
  // обрано -- той самий відкритий розрив, що server/index.ts вже документує
  // для emailTransport (T37/T42): "SMTP чи transactional email API --
  // конкретний постачальник ще не обраний". Вигадувати тут якийсь провайдер
  // означало б саме "рішення без рішення", проти якого застерігає
  // docs/DECISIONS.md ("одне рішення — одне місце"). Стаб кидає одразу й
  // конкретно -- writeExternalResource (infra/resource-writer.ts) уже ловить
  // це й чесно позначає sync_resource.status='error' (AC-18b), замість
  // мовчки прикидатись, що запис відбувся.
  const writeToResource: ExternalDocClient = async () => {
    throw new Error(
      'Зовнішній ресурс (Google Docs/Sheets) ще не підключено -- OAuth/HTTP-клієнт не обрано (infra/resource-writer.ts, ADR-0004)'
    );
  };

  console.log(`[worker] запущено -- тік кожні ${TICK_INTERVAL_MS} мс`);

  const tick = (): void => {
    runOnce({ db, sleep, writeToResource }).catch((err: unknown) => {
      // runOnce вже ловить помилки по кожному користувачу/ресурсу окремо --
      // цей catch лише останній рубіж, щоб жодна несподівана помилка не
      // вбила сам setInterval і не зупинила воркер назавжди.
      console.error('[worker] тік провалився цілком (несподівана помилка поза runOnce)', err);
    });
  };

  tick(); // перший прогін одразу при старті, не чекаючи першого інтервалу
  setInterval(tick, TICK_INTERVAL_MS);
}

// Композиційний корінь стартує лише коли цей файл запущено напряму (tsx
// server/worker.ts), не коли worker.test.ts імпортує runOnce -- інакше
// createDb() впав би одразу під час імпорту (DATABASE_URL_POOLED відсутній
// у тестовому середовищі, той самий довід, що server/index.ts's власний
// коментар: "НЕ юніт-тестується").
const isMainModule = (() => {
  try {
    return process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMainModule) {
  startWorker();
}
