import { describe, it, expect } from 'vitest';
import { detectConflict } from './conflict';
import type { RawEntryWithTiming } from './conflict';

describe('detectConflict', () => {
  // Тестове число вікна -- точне значення ще не узгоджене з Андрієм (sad.md §11,
  // відкрите питання), тож windowMs лишається параметром функції, не константою.
  const windowMs = 60000;

  // AC-06: Given two changes to the same metric-block arrive close together
  // in time from different devices, when the system detects this
  // near-simultaneous conflict, then the agent asks the user whether it's a
  // duplicate or a genuinely separate entry before either one counts toward
  // progress.
  it('flags a conflict when two entries from different devices arrive within the window', () => {
    const newEntry: RawEntryWithTiming = { sourceDeviceId: 'device-b', recordedAt: 1_000_000 };
    const existingEntries: RawEntryWithTiming[] = [{ sourceDeviceId: 'device-a', recordedAt: 1_000_000 - 30_000 }];
    expect(detectConflict(newEntry, existingEntries, windowMs)).toBe(true);
  });

  // AC-06 (та сама умова, межа поза вікном): різниця в часі більша за windowMs
  // -- це вже не "близько за часом", тож не конфлікт.
  it('does not flag a conflict once the same different-device pair falls outside the window', () => {
    const newEntry: RawEntryWithTiming = { sourceDeviceId: 'device-b', recordedAt: 1_000_000 };
    const existingEntries: RawEntryWithTiming[] = [{ sourceDeviceId: 'device-a', recordedAt: 1_000_000 - 90_000 }];
    expect(detectConflict(newEntry, existingEntries, windowMs)).toBe(false);
  });

  // Звичайне уточнення з того самого пристрою, не конфлікт -- навіть за
  // великого інтервалу, щоб перевірка пристрою не ховалась за перевіркою вікна.
  it('does not flag a conflict for entries from the same device, at any interval', () => {
    const newEntry: RawEntryWithTiming = { sourceDeviceId: 'device-a', recordedAt: 1_000_000 };
    const existingEntries: RawEntryWithTiming[] = [
      { sourceDeviceId: 'device-a', recordedAt: 1_000_000 - 5 },
      { sourceDeviceId: 'device-a', recordedAt: 1_000_000 + 10_000_000 },
    ];
    expect(detectConflict(newEntry, existingEntries, windowMs)).toBe(false);
  });

  // Review 2026-09-07, post-ship follow-up review (regresja from the B7
  // "fix" above): treating "device id unknown" as "possibly a different
  // device" seemed safer in isolation, but main.tsx never sent a device id
  // at all before this same follow-up wave -- so in REAL usage every single
  // entry had sourceDeviceId: null, which made THIS branch fire for every
  // two entries recorded close together on the same block, regardless of
  // device. create-entry.ts then flips the earlier entry back to 'pending'
  // on every such "conflict" -- the user's confirmed progress visibly
  // dropped after recording a second entry, the opposite of AC-01. The
  // follow-up fix (main.tsx now sends a real, persisted per-device id,
  // see local device-id generation) makes null genuinely rare -- so the
  // safe default for "we don't know" flips back to "assume same device,
  // no conflict" instead of "assume different, flag it".
  it('does NOT flag a conflict when device id is unknown (null) on either/both sides -- unknown is not evidence of a different device', () => {
    const bothNull: RawEntryWithTiming = { sourceDeviceId: null, recordedAt: 1_000_000 };
    expect(detectConflict(bothNull, [{ sourceDeviceId: null, recordedAt: 1_000_000 - 30_000 }], windowMs)).toBe(false);

    const newKnown: RawEntryWithTiming = { sourceDeviceId: 'device-a', recordedAt: 1_000_000 };
    expect(detectConflict(newKnown, [{ sourceDeviceId: null, recordedAt: 1_000_000 - 30_000 }], windowMs)).toBe(false);

    const existingKnown: RawEntryWithTiming = { sourceDeviceId: null, recordedAt: 1_000_000 };
    expect(detectConflict(existingKnown, [{ sourceDeviceId: 'device-a', recordedAt: 1_000_000 - 30_000 }], windowMs)).toBe(
      false,
    );
  });
});
