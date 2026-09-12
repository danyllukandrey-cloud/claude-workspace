// T42 -- App: developer-report use-case -- AC-20 (agent-detected) / AC-20b
// (user-requested), data-model.md `developer_report` (migration 09).
//
// Orchestrates domain/developer-report.ts (T36, ADR-0006 sentinel Result --
// validates description, builds the payload) + infra/email-client.ts (T37,
// DI EmailTransport) + a direct db.query against `developer_report` -- this
// table has no shared repo module (T13's files_hint covers only
// agent_proposal/imperative_rule/long_term_memory_fact/chat_message/
// agent_audit_event, NOT developer_report), so persistence is inline here,
// the same style ../../structure/app/close-card.ts already uses for a table
// with no dedicated repo function.
//
// Order (DoD, tracker.md T42, both AC-20/AC-20b):
// 1. Domain builds the payload (id generated here via randomUUID -- same
//    pattern as cards/life-area-card/app/create-card.ts). An empty/
//    whitespace description is a domain Err (ADR-0006 sentinel) -- mapped
//    here to a thrown AppError at the app boundary (plan/app/CLAUDE.md:
//    "domain returns Result, layers above may throw AppError when mapping a
//    domain Err"). Nothing is persisted before this check passes.
// 2. INSERT the row (delivery_status defaults 'sent', schema DEFAULT,
//    migration 09) -- the row exists BEFORE the send is attempted, so a
//    crash mid-send still leaves a persisted report, never nothing at all
//    ("both persist a developer_report row and send the email", DoD).
// 3. Attempt to send via the injected EmailTransport. email-client.ts
//    already turns any transport failure into a typed
//    AppError('email.send_failed', ..., 502) -- caught here and turned into
//    an UPDATE of delivery_status to 'failed', never re-thrown: the same
//    "recorded, not silently dropped" pattern activity_report.status
//    already uses for its own delivery failures (sad.md Critical flow 14,
//    dead-letter). The function still resolves normally with the TRUE final
//    status so a caller (a future ports/UI task) can inspect it and decide
//    what to tell the user -- it never claims 'sent' when the send actually
//    failed (DoD: "a failed send is marked delivery_status=failed, not
//    silently dropped").
//
// Open question (flagged for human review, not decided here): `developerEmail`
// (the "пошта розробника" of AC-20/AC-20b) is an explicit dependency, not
// read from env in this file -- reading configuration is a composition-root/
// wiring concern (T29), never the app layer's job (plan/app/CLAUDE.md
// dependency rule). Neither spec.md, data-model.md nor sad.md name where this
// address is configured (added 2026-08-29, data-model.md, without its own
// sequence flow) -- this is the most conservative reading available; T29
// (wiring) resolves the real value when it wires the real transport.

import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { reportAgentDetectedError, reportUserRequestedIssue } from '../domain/developer-report';
import type { DeveloperReport, DeveloperReportDeliveryStatus, DeveloperReportTriggerType } from '../domain/developer-report';
import { AppError } from '../../shared/errors';
import { sendEmail } from '../infra/email-client';
import type { EmailTransport } from '../infra/email-client';
import type { Db } from '../infra/postgres-repo';

export interface DeveloperReportDeps {
  db: Db;
  transport: EmailTransport;
  /** Пошта розробника (AC-20/AC-20b) -- інжектується composition root'ом (T29), не читається з env тут. */
  developerEmail: string;
}

export interface FileAgentDetectedErrorReportInput {
  userId?: string | null;
  errorSummary: string;
  context?: string | null;
}

export interface FileUserRequestedIssueReportInput {
  userId?: string | null;
  userDescription: string;
}

interface RawDeveloperReportRow extends QueryResultRow {
  id: string;
  user_id: string | null;
  trigger_type: DeveloperReportTriggerType;
  description: string;
  delivery_status: DeveloperReportDeliveryStatus;
  sent_at: Date;
}

function toDeveloperReport(row: RawDeveloperReportRow): DeveloperReport {
  return {
    id: row.id,
    userId: row.user_id,
    triggerType: row.trigger_type,
    description: row.description,
    deliveryStatus: row.delivery_status,
  };
}

const DEVELOPER_REPORT_COLUMNS = 'id, user_id, trigger_type, description, delivery_status, sent_at';

async function insertDeveloperReport(db: Db, report: DeveloperReport): Promise<RawDeveloperReportRow> {
  const { rows } = await db.query<RawDeveloperReportRow>(
    `INSERT INTO developer_report (id, user_id, trigger_type, description)
     VALUES ($1, $2, $3, $4) RETURNING ${DEVELOPER_REPORT_COLUMNS}`,
    [report.id, report.userId, report.triggerType, report.description]
  );
  return rows[0];
}

async function markDeliveryFailed(db: Db, id: string): Promise<void> {
  await db.query(`UPDATE developer_report SET delivery_status = 'failed' WHERE id = $1`, [id]);
}

function emailSubject(triggerType: DeveloperReportTriggerType): string {
  return triggerType === 'agent_detected'
    ? 'ПЛАН -- агент виявив технічну помилку'
    : 'ПЛАН -- користувач повідомив про проблему';
}

/**
 * Persist + send one already-built domain payload -- shared by both AC-20
 * and AC-20b entry points below; the only difference between them is which
 * domain function built `report`.
 */
async function fileDeveloperReport(deps: DeveloperReportDeps, report: DeveloperReport): Promise<DeveloperReport> {
  const inserted = await insertDeveloperReport(deps.db, report);

  try {
    await sendEmail(deps.transport, {
      to: deps.developerEmail,
      subject: emailSubject(inserted.trigger_type),
      body: inserted.description,
    });
    return toDeveloperReport(inserted);
  } catch (error) {
    if (!(error instanceof AppError)) {
      throw error; // непередбачена помилка -- не ковтаємо мовчки (email-client.ts завжди кидає AppError, це страховка)
    }
    await markDeliveryFailed(deps.db, inserted.id);
    return { ...toDeveloperReport(inserted), deliveryStatus: 'failed' };
  }
}

/** AC-20: агент сам виявив технічну помилку -- без участі користувача, службова дія. */
export async function fileAgentDetectedErrorReport(
  deps: DeveloperReportDeps,
  input: FileAgentDetectedErrorReportInput
): Promise<DeveloperReport> {
  const result = reportAgentDetectedError({ id: randomUUID(), ...input });
  if (!result.ok) {
    throw new AppError(result.error.code, result.error.message, 400);
  }
  return fileDeveloperReport(deps, result.value);
}

/** AC-20b: користувач просить переслати виявлену проблему розробнику. */
export async function fileUserRequestedIssueReport(
  deps: DeveloperReportDeps,
  input: FileUserRequestedIssueReportInput
): Promise<DeveloperReport> {
  const result = reportUserRequestedIssue({ id: randomUUID(), ...input });
  if (!result.ok) {
    throw new AppError(result.error.code, result.error.message, 400);
  }
  return fileDeveloperReport(deps, result.value);
}
