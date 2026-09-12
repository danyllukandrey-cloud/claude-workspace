// T38 -- Infra (agent-worker): external resource writer.
// RED (mocked Db + stub external-doc client, same convention as
// ../../structure/infra/postgres-repo.test.ts and
// ../../cards/life-area-card/infra/claude-client.test.ts): AC-18/AC-18b.
//
// The real HTTP/OAuth call to the user's external resource (Google Doc/Sheet
// тощо) is never made here -- `writeToResource` is injected (DI, ADR-0004,
// той самий принцип, що claude-client's callClaude), so this suite documents
// the intended behaviour against a stub external-doc endpoint (test-plan.md,
// "outbound email ... and the external resource writer (AC-18) each go
// through their own stub, never a real send/write") without a live network
// or a live Postgres.

import { describe, it, expect, vi } from 'vitest';
import type { Db } from './resource-writer';
import { writeExternalResource } from './resource-writer';

const RESOURCE = { id: 'resource-1', url: 'https://docs.example.test/doc-1' };

describe('writeExternalResource -- AC-18 happy path', () => {
  it('writes the content and updates last_synced_at (status active, last_error cleared)', async () => {
    const writeToResource = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    const result = await writeExternalResource(db, writeToResource, RESOURCE, 'копія карток/записів/декларацій');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.syncedAt).toBeInstanceOf(Date);
    }

    expect(writeToResource).toHaveBeenCalledWith(RESOURCE.url, 'копія карток/записів/декларацій');

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/last_synced_at/);
    expect(sql).toMatch(/status/);
    expect(params).toContain(RESOURCE.id);
  });
});

describe('writeExternalResource -- AC-18b access error', () => {
  it('an unreachable resource (network failure, no HTTP status) surfaces as a typed "unreachable" error -- never throws', async () => {
    const writeToResource = vi.fn().mockRejectedValue(new Error('ECONNREFUSED -- симуляція недоступного хоста'));
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    // Awaited directly, no try/catch: if writeExternalResource threw instead of
    // returning a typed result, this await would reject and fail the test --
    // exactly the behaviour AC-18b forbids ("не намагається мовчки повторювати
    // нескінченно" зчитуємо тут як "і не валить виклик необробленим винятком").
    const result = await writeExternalResource(db, writeToResource, RESOURCE, 'копія');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unreachable');
      expect(result.message.length).toBeGreaterThan(0);
      // Security fix: the raw transport error text (which routinely embeds
      // request URLs/tokens/account details) must never surface -- only a
      // fixed, sanitized, per-category message.
      expect(result.message).not.toMatch(/ECONNREFUSED/);
    }

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/status/);
    expect(sql).toMatch(/last_error/);
    expect(params).toContain(RESOURCE.id);
    // The value written into sync_resource.last_error (rendered verbatim in
    // the AccountScreen Banner) must be the sanitized message, never the raw
    // provider error text.
    expect(params[0]).toBe(result.ok ? undefined : result.message);
    expect(params[0]).not.toMatch(/ECONNREFUSED/);
  });

  it('a revoked/lost access resource (HTTP 403) surfaces as a typed "access_revoked" error -- never throws', async () => {
    const deniedError = Object.assign(new Error('Google API: permission denied for user@example.com token=abc123'), {
      status: 403,
    });
    const writeToResource = vi.fn().mockRejectedValue(deniedError);
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    const result = await writeExternalResource(db, writeToResource, RESOURCE, 'копія');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('access_revoked');
      expect(result.message).not.toMatch(/token=abc123/);
      expect(result.message).not.toMatch(/user@example\.com/);
    }

    const [, params] = query.mock.calls[0];
    expect(params[0]).not.toMatch(/token=abc123/);
  });

  it('an unexpected HTTP failure (e.g. 500) surfaces as a typed "unknown" error -- never throws', async () => {
    const serverError = Object.assign(new Error('Google API: internal error at https://docs.googleapis.com/secret-path'), {
      status: 500,
    });
    const writeToResource = vi.fn().mockRejectedValue(serverError);
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    const result = await writeExternalResource(db, writeToResource, RESOURCE, 'копія');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unknown');
      expect(result.message).not.toMatch(/secret-path/);
    }
  });

  it('a failed write leaves status=error scoped to this resource id, distinct from AC-18 success columns', async () => {
    const writeToResource = vi.fn().mockRejectedValue(new Error('unreachable'));
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await writeExternalResource(db, writeToResource, RESOURCE, 'копія');

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/'error'/);
    expect(params[params.length - 1]).toBe(RESOURCE.id);
  });
});
