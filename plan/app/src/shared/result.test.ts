import { describe, it, expect } from 'vitest';
import { ok, err } from './result';
import type { Result } from './result';

describe('ok/err -- ADR-0006 domain sentinel', () => {
  it('ok() wraps a value as a discriminated success', () => {
    const result = ok(42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('err() wraps an error as a discriminated failure', () => {
    const result = err({ code: 'x.failed' });
    expect(result).toEqual({ ok: false, error: { code: 'x.failed' } });
  });

  it('the ok field discriminates the union at compile time and at runtime', () => {
    const results: Result<number, string>[] = [ok(1), err('boom')];
    const values = results.filter((r): r is { ok: true; value: number } => r.ok).map((r) => r.value);
    const errors = results.filter((r): r is { ok: false; error: string } => !r.ok).map((r) => r.error);

    expect(values).toEqual([1]);
    expect(errors).toEqual(['boom']);
  });
});
