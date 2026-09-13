import { describe, it, expect } from 'vitest';
import { detectConflict } from './conflict';
import type { RawEntryWithTiming } from './conflict';

describe('detectConflict', () => {
  // Тестове число вікна -- точне значення ще не узгоджене з Андрієм (sad.md §11,
  // відкрите питання), тож windowMs лишається параметром функції, не константою.
  const windowMs = 60000;

  // AC-06 (D-119, docs/DECISIONS.md): Given two entries for the same
  // metric-block arrive close together in time, when the system detects
  // this near-simultaneous overlap, then both are flagged for review --
  // регардless of device (жодного реального device-сигналу більше нема,
  // див. коментар у conflict.ts).
  it('flags a conflict when two entries for the same block arrive within the window', () => {
    const newEntry: RawEntryWithTiming = { recordedAt: 1_000_000 };
    const existingEntries: RawEntryWithTiming[] = [{ recordedAt: 1_000_000 - 30_000 }];
    expect(detectConflict(newEntry, existingEntries, windowMs)).toBe(true);
  });

  // AC-06 (та сама умова, межа поза вікном): різниця в часі більша за windowMs
  // -- це вже не "близько за часом", тож не конфлікт.
  it('does not flag a conflict once the pair falls outside the window', () => {
    const newEntry: RawEntryWithTiming = { recordedAt: 1_000_000 };
    const existingEntries: RawEntryWithTiming[] = [{ recordedAt: 1_000_000 - 90_000 }];
    expect(detectConflict(newEntry, existingEntries, windowMs)).toBe(false);
  });

  it('checks every candidate independently -- one far entry does not hide a close one', () => {
    const newEntry: RawEntryWithTiming = { recordedAt: 1_000_000 };
    const existingEntries: RawEntryWithTiming[] = [
      { recordedAt: 1_000_000 + 10_000_000 }, // far -- no conflict on its own
      { recordedAt: 1_000_000 - 5 }, // close -- this one alone triggers it
    ];
    expect(detectConflict(newEntry, existingEntries, windowMs)).toBe(true);
  });

  it('does not flag a conflict when there are no existing entries at all', () => {
    const newEntry: RawEntryWithTiming = { recordedAt: 1_000_000 };
    expect(detectConflict(newEntry, [], windowMs)).toBe(false);
  });
});
