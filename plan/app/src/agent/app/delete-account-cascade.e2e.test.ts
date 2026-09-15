// T46 -- Tests: cascading account deletion across features (AC-17, US-11).
//
// tracker.md T46 DoD: "End-to-end test against a seeded user with cards, a
// Structure declaration, rules and memory: deleting the account leaves zero
// rows owned by that user_id in agent, life-area-card, AND structure tables".
// test-plan.md AC-17 row: level "e2e", expected outcome "zero rows for that
// user_id in agent, life-area-card, AND structure tables".
//
// Sandbox constraint (task instructions): no live Postgres/.env available
// here, so this documents the INTENDED real-DB behaviour against a fake `Db`
// -- the same convention already used throughout plan/app/src/agent/
// (delete-account.test.ts/postgres-repo.test.ts: a fake `db.query` per call,
// asserted by SQL text and params) -- rather than claiming a live-DB run.
//
// What makes this an "e2e" test and not a repeat of delete-account.test.ts
// (T39, integration level): T39 asserts the exact two SQL statements
// deleteAccount() issues and their order. It does NOT prove that a real
// Postgres ON DELETE CASCADE graph actually empties every dependent table
// across all THREE features -- that graph lives in migrations spread over
// three separate features (agent/01-09, life-area-card/07, structure/
// backend/03), never exercised together in one test until now. This file
// therefore models that FK graph in-memory (`FakeCascadingDb`, built directly
// from the FOREIGN KEY ... ON DELETE clauses in those migration files) and
// then runs the real `deleteAccount` use-case against it, so the assertion
// is "zero rows across every table the graph reaches", not "two SQL calls
// were made".
//
// FK graph modelled below (column -> onDelete), one edge per migration:
//   agent_proposal.user_id          -> app_user   CASCADE   (agent/02)
//   agent_proposal.card_id          -> card        SET NULL (agent/02)
//   agent_proposal.metric_block_id  -> metric_block SET NULL (agent/02)
//   imperative_rule.user_id         -> app_user   CASCADE   (agent/03)
//   imperative_rule.scope_card_id   -> card        SET NULL (agent/03)
//   long_term_memory_fact.user_id   -> app_user   CASCADE   (agent/04)
//   chat_message.user_id            -> app_user   CASCADE   (agent/05)
//   agent_audit_event.user_id       -> app_user   SET NULL  (agent/06 -- fixed by D-118, was CASCADE; migration 11)
//   activity_report.user_id         -> app_user   CASCADE   (agent/07)
//   sync_resource.user_id           -> app_user   CASCADE   (agent/08)
//   developer_report.user_id        -> app_user   SET NULL  (agent/09 -- deliberately survives, D-89 Notes)
//   card.owner_user_id              -> app_user   CASCADE   (life-area-card/07)
//   metric_block.card_id            -> card        CASCADE  (life-area-card/02)
//   entry.metric_block_id           -> metric_block CASCADE (life-area-card/03)
//   entry.card_id                   -> card        CASCADE  (life-area-card/03)
//   card_lifecycle_event.card_id    -> card        CASCADE  (life-area-card/04)
//   structure.owner_user_id         -> app_user   CASCADE   (structure/backend/03)
//   structure_layout_position.structure_id -> structure CASCADE (structure/backend/02)
//   structure_layout_position.card_id      -> card      CASCADE (structure/backend/02)
//   structure_history_event.structure_id   -> structure CASCADE (structure/backend/05)
//   structure_history_event.card_id        -> card      CASCADE (structure/backend/05)
//
// `agent`'s tables that actually reach zero rows for the deleted user_id:
// agent_proposal, imperative_rule, long_term_memory_fact, chat_message,
// activity_report, sync_resource (agent/08, T31, also CASCADE -- tracker.md
// T46 DoD's original "6 tables" wording predates this one and undercounts,
// see ISS-109). Two agent tables intentionally do NOT reach zero rows --
// `developer_report` (ON DELETE SET NULL from the start, data-model.md Notes:
// "a bug report must outlive the account that triggered it") and, since
// D-118, `agent_audit_event` too: it was ON DELETE CASCADE until an
// independent review found that CASCADE silently defeated the very reason
// deleteAccount writes an `account_deleted` row before deleting app_user --
// the freshly-written audit row vanished in the same transaction, so the
// deletion trail it was meant to leave was never actually reachable. Fixed
// to SET NULL (migration 11): the row -- both this pre-existing one and the
// `account_deleted` row deleteAccount writes -- now survives with `user_id`
// cleared, asserted explicitly below, not lumped in with the "zero rows" set.

import { describe, it, expect } from 'vitest';
import { deleteAccount } from './delete-account';
import type { Db } from '../infra/postgres-repo';

type Row = Record<string, unknown> & { id: string };
type OnDelete = 'CASCADE' | 'SET NULL';
interface ForeignKey {
  column: string;
  refTable: string;
  onDelete: OnDelete;
}

// One entry per table this graph reaches -- see the header comment for the
// migration each edge comes from.
const SCHEMA: Record<string, ForeignKey[]> = {
  app_user: [],
  agent_proposal: [
    { column: 'user_id', refTable: 'app_user', onDelete: 'CASCADE' },
    { column: 'card_id', refTable: 'card', onDelete: 'SET NULL' },
    { column: 'metric_block_id', refTable: 'metric_block', onDelete: 'SET NULL' },
  ],
  imperative_rule: [
    { column: 'user_id', refTable: 'app_user', onDelete: 'CASCADE' },
    { column: 'scope_card_id', refTable: 'card', onDelete: 'SET NULL' },
  ],
  long_term_memory_fact: [{ column: 'user_id', refTable: 'app_user', onDelete: 'CASCADE' }],
  chat_message: [{ column: 'user_id', refTable: 'app_user', onDelete: 'CASCADE' }],
  agent_audit_event: [{ column: 'user_id', refTable: 'app_user', onDelete: 'SET NULL' }], // D-118, migration 11 -- was CASCADE
  activity_report: [{ column: 'user_id', refTable: 'app_user', onDelete: 'CASCADE' }],
  sync_resource: [{ column: 'user_id', refTable: 'app_user', onDelete: 'CASCADE' }],
  developer_report: [{ column: 'user_id', refTable: 'app_user', onDelete: 'SET NULL' }],
  card: [{ column: 'owner_user_id', refTable: 'app_user', onDelete: 'CASCADE' }],
  metric_block: [{ column: 'card_id', refTable: 'card', onDelete: 'CASCADE' }],
  entry: [
    { column: 'metric_block_id', refTable: 'metric_block', onDelete: 'CASCADE' },
    { column: 'card_id', refTable: 'card', onDelete: 'CASCADE' },
  ],
  card_lifecycle_event: [{ column: 'card_id', refTable: 'card', onDelete: 'CASCADE' }],
  structure: [{ column: 'owner_user_id', refTable: 'app_user', onDelete: 'CASCADE' }],
  structure_layout_position: [
    { column: 'structure_id', refTable: 'structure', onDelete: 'CASCADE' },
    { column: 'card_id', refTable: 'card', onDelete: 'CASCADE' },
  ],
  structure_history_event: [
    { column: 'structure_id', refTable: 'structure', onDelete: 'CASCADE' },
    { column: 'card_id', refTable: 'card', onDelete: 'CASCADE' },
  ],
};

/**
 * In-memory stand-in for the real PostgreSQL FK graph above. Only
 * understands the two statements `deleteAccount` (T39) actually issues --
 * `INSERT INTO agent_audit_event` and `DELETE FROM app_user WHERE id = $1`
 * -- everything else (seeding, and cascading the delete through SCHEMA) is
 * driven directly, the way `pg` would drive it inside PostgreSQL itself, not
 * by the application code.
 */
class FakeCascadingDb implements Db {
  private tables: Record<string, Row[]> = Object.fromEntries(
    Object.keys(SCHEMA).map((table) => [table, [] as Row[]])
  );

  /** Direct seeding -- bypasses SQL, the way a test fixture inserts rows before the scenario runs. */
  seed(table: keyof typeof SCHEMA, row: Row): void {
    this.tables[table].push({ ...row });
  }

  rows(table: keyof typeof SCHEMA): Row[] {
    return this.tables[table];
  }

  private deleteWhereIdIn(table: string, ids: Set<string>): void {
    if (ids.size === 0) return;
    this.tables[table] = this.tables[table].filter((row) => !ids.has(row.id));

    for (const [childTable, foreignKeys] of Object.entries(SCHEMA)) {
      for (const fk of foreignKeys) {
        if (fk.refTable !== table) continue;
        if (fk.onDelete === 'CASCADE') {
          const childIds = new Set(
            this.tables[childTable].filter((row) => ids.has(row[fk.column] as string)).map((row) => row.id)
          );
          this.deleteWhereIdIn(childTable, childIds);
        } else {
          // SET NULL: the row survives, only the dangling FK column is cleared.
          for (const row of this.tables[childTable]) {
            if (ids.has(row[fk.column] as string)) row[fk.column] = null;
          }
        }
      }
    }
  }

  async query<T extends Record<string, unknown> = Row>(
    text: string,
    params: unknown[] = []
  ): Promise<{ rows: T[] }> {
    if (/INSERT INTO agent_audit_event/.test(text)) {
      const [id, userId, eventType, subjectType, subjectId, detail] = params as (string | null)[];
      const row: Row = {
        id: id as string,
        user_id: userId as string,
        event_type: eventType,
        subject_type: subjectType,
        subject_id: subjectId ?? null,
        detail: detail ?? null,
        occurred_at: new Date(),
      };
      this.tables.agent_audit_event.push(row);
      return { rows: [row as unknown as T] };
    }

    if (/DELETE FROM app_user WHERE id = \$1/.test(text)) {
      const [id] = params as string[];
      this.deleteWhereIdIn('app_user', new Set([id]));
      return { rows: [] };
    }

    throw new Error(`FakeCascadingDb: unrecognized query -- ${text}`);
  }
}

// The tables that actually reach zero rows for the deleted user_id -- see
// header comment for tracker.md T46 DoD's original wording (ISS-109) and for
// why `agent_audit_event` moved out of this set (D-118). `developer_report`
// was never in this set: both it and `agent_audit_event` survive by design
// (SET NULL), asserted separately below.
const AGENT_TABLES_THAT_MUST_EMPTY = [
  'agent_proposal',
  'imperative_rule',
  'long_term_memory_fact',
  'chat_message',
  'activity_report',
  'sync_resource',
] as const;

const LIFE_AREA_CARD_TABLES_THAT_MUST_EMPTY = ['card', 'metric_block', 'entry', 'card_lifecycle_event'] as const;

const STRUCTURE_TABLES_THAT_MUST_EMPTY = ['structure', 'structure_layout_position', 'structure_history_event'] as const;

function seedFullUserGraph(db: FakeCascadingDb, userId: string, seed: string): void {
  const cardId = `card-${seed}`;
  const metricBlockId = `metric-block-${seed}`;
  const structureId = `structure-${seed}`;

  db.seed('app_user', { id: userId, google_sub: `sub-${seed}`, email: `${seed}@example.test` });

  // life-area-card: a card with a metric block, an entry, and a lifecycle event.
  db.seed('card', { id: cardId, owner_user_id: userId, name: `Картка ${seed}` });
  db.seed('metric_block', { id: metricBlockId, card_id: cardId, label: 'Пробіжка', unit: 'km' });
  db.seed('entry', { id: `entry-${seed}`, metric_block_id: metricBlockId, card_id: cardId, amount: 5 });
  db.seed('card_lifecycle_event', { id: `lifecycle-${seed}`, card_id: cardId, transition: 'created' });

  // structure: a declaration with the card placed on it.
  db.seed('structure', { id: structureId, owner_user_id: userId, declaration: 'Моя структура' });
  db.seed('structure_layout_position', {
    id: `layout-${seed}`,
    structure_id: structureId,
    card_id: cardId,
    position_x: 0,
    position_y: 0,
  });
  db.seed('structure_history_event', {
    id: `history-${seed}`,
    structure_id: structureId,
    card_id: cardId,
    event_type: 'created',
  });

  // agent's own tables: a proposal, a rule, a memory fact, a chat message,
  // a pre-existing audit event, an activity report, a sync resource, and a
  // developer report (the one row that must NOT disappear).
  db.seed('agent_proposal', {
    id: `proposal-${seed}`,
    user_id: userId,
    card_id: cardId,
    metric_block_id: metricBlockId,
    status: 'confirmed',
  });
  db.seed('imperative_rule', { id: `rule-${seed}`, user_id: userId, scope_card_id: null, rule_text: 'не радь, якщо не питаю' });
  db.seed('long_term_memory_fact', { id: `fact-${seed}`, user_id: userId, fact_text: 'бігає щоранку', status: 'active' });
  db.seed('chat_message', { id: `msg-${seed}`, user_id: userId, role: 'user', content: 'привіт' });
  db.seed('agent_audit_event', {
    id: `audit-preexisting-${seed}`,
    user_id: userId,
    event_type: 'proposal_confirmed',
    subject_type: 'proposal',
    subject_id: `proposal-${seed}`,
  });
  db.seed('activity_report', { id: `report-${seed}`, user_id: userId, period_type: 'weekly', status: 'generated' });
  db.seed('sync_resource', { id: `resource-${seed}`, user_id: userId, url: 'https://example.test/doc', status: 'active' });
  db.seed('developer_report', {
    id: `bugreport-${seed}`,
    user_id: userId,
    trigger_type: 'user_requested',
    description: 'щось зламалось',
    delivery_status: 'sent',
  });
}

describe('deleteAccount -- AC-17 cascading deletion across agent/life-area-card/structure (e2e, fake Db)', () => {
  it('leaves zero rows owned by the deleted user_id in every one of the three features', async () => {
    const db = new FakeCascadingDb();

    // Seed the target user with a full graph across all three features...
    seedFullUserGraph(db, 'user-deleted', 'a');
    // ...and a second, untouched user, so an empty result proves scoping,
    // not an accidentally-truncated whole table.
    seedFullUserGraph(db, 'user-kept', 'b');

    await deleteAccount(db, { userId: 'user-deleted', confirmed: true });

    // app_user itself: gone, the other user unaffected.
    expect(db.rows('app_user').map((row) => row.id)).toEqual(['user-kept']);

    for (const table of AGENT_TABLES_THAT_MUST_EMPTY) {
      const remainingForDeletedUser = db.rows(table).filter((row) => row.user_id === 'user-deleted');
      expect(remainingForDeletedUser, `expected ${table} to have 0 rows for the deleted user`).toEqual([]);
    }

    for (const table of LIFE_AREA_CARD_TABLES_THAT_MUST_EMPTY) {
      const remainingForDeletedUser = db
        .rows(table)
        .filter((row) => row.owner_user_id === 'user-deleted' || row.card_id === 'card-a' || row.metric_block_id === 'metric-block-a');
      expect(remainingForDeletedUser, `expected ${table} to have 0 rows for the deleted user`).toEqual([]);
    }

    for (const table of STRUCTURE_TABLES_THAT_MUST_EMPTY) {
      const remainingForDeletedUser = db
        .rows(table)
        .filter((row) => row.owner_user_id === 'user-deleted' || row.structure_id === 'structure-a');
      expect(remainingForDeletedUser, `expected ${table} to have 0 rows for the deleted user`).toEqual([]);
    }

    // The untouched second user's graph survives completely -- deletion was
    // scoped to one user_id, not a blanket truncate.
    expect(db.rows('card').map((row) => row.id)).toEqual(['card-b']);
    expect(db.rows('structure').map((row) => row.id)).toEqual(['structure-b']);
    expect(db.rows('agent_proposal').map((row) => row.id)).toEqual(['proposal-b']);
  });

  it('never touches the FK-scoped card/metric_block belonging to a different user (non-disclosure, AC-06 spirit)', async () => {
    const db = new FakeCascadingDb();
    seedFullUserGraph(db, 'user-deleted', 'a');
    seedFullUserGraph(db, 'user-kept', 'b');

    await deleteAccount(db, { userId: 'user-deleted', confirmed: true });

    expect(db.rows('metric_block').map((row) => row.id)).toEqual(['metric-block-b']);
    expect(db.rows('entry').map((row) => row.id)).toEqual(['entry-b']);
    expect(db.rows('card_lifecycle_event').map((row) => row.id)).toEqual(['lifecycle-b']);
    expect(db.rows('structure_layout_position').map((row) => row.id)).toEqual(['layout-b']);
    expect(db.rows('structure_history_event').map((row) => row.id)).toEqual(['history-b']);
  });

  it('the account_deleted audit row (and any pre-existing audit row) survives the deletion, orphaned, not swept away (D-118)', async () => {
    // agent_audit_event.user_id is ON DELETE SET NULL (agent/06, migration 11,
    // D-118) -- CASCADE here used to defeat the very reason deleteAccount
    // writes an `account_deleted` row before deleting app_user: the row
    // vanished in the same transaction, so the deletion trail was never
    // actually reachable. Both the pre-existing audit row seeded below and
    // the fresh `account_deleted` row deleteAccount itself writes must
    // survive with `user_id` cleared -- documented here so the behaviour is
    // asserted, not merely narrated in delete-account.ts's comments.
    const db = new FakeCascadingDb();
    seedFullUserGraph(db, 'user-deleted', 'a');

    await deleteAccount(db, { userId: 'user-deleted', confirmed: true });

    const survivingAuditRows = db.rows('agent_audit_event');
    expect(survivingAuditRows.map((row) => row.event_type).sort()).toEqual(['account_deleted', 'proposal_confirmed']);
    for (const row of survivingAuditRows) {
      expect(row.user_id).toBeNull();
    }
  });

  it('developer_report survives the cascade by design (ON DELETE SET NULL, not CASCADE) -- the bug report outlives the account', async () => {
    const db = new FakeCascadingDb();
    seedFullUserGraph(db, 'user-deleted', 'a');

    await deleteAccount(db, { userId: 'user-deleted', confirmed: true });

    const [survivor] = db.rows('developer_report').filter((row) => row.id === 'bugreport-a');
    expect(survivor).toBeDefined();
    expect(survivor.user_id).toBeNull();
  });

  it('rejects deletion without confirmation before touching any seeded row (AC-17b guard, same as delete-account.test.ts)', async () => {
    const db = new FakeCascadingDb();
    seedFullUserGraph(db, 'user-deleted', 'a');

    await expect(deleteAccount(db, { userId: 'user-deleted', confirmed: false })).rejects.toMatchObject({
      code: 'account.confirmation_required',
    });

    // Nothing was touched -- the full graph is still there.
    expect(db.rows('app_user').map((row) => row.id)).toEqual(['user-deleted']);
    expect(db.rows('card').map((row) => row.id)).toEqual(['card-a']);
  });
});
