export interface RawEntryWithTiming {
  sourceDeviceId: string | null;
  recordedAt: number;
}

export function detectConflict(
  newEntry: RawEntryWithTiming,
  existingEntries: RawEntryWithTiming[],
  windowMs: number,
): boolean {
  return existingEntries.some(
    (existing) =>
      existing.sourceDeviceId !== newEntry.sourceDeviceId &&
      Math.abs(newEntry.recordedAt - existing.recordedAt) <= windowMs,
  );
}
