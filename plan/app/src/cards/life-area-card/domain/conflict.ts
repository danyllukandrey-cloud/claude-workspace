export interface RawEntryWithTiming {
  sourceDeviceId: string | null;
  recordedAt: number;
}

export function detectConflict(
  newEntry: RawEntryWithTiming,
  existingEntries: RawEntryWithTiming[],
  windowMs: number,
): boolean {
  return existingEntries.some((existing) => {
    // Post-ship follow-up review (regression from the earlier B7 "fix",
    // 2026-09-07): treating "device id unknown" as "possibly a different
    // device" broke the common case, because the real client did not send
    // sourceDeviceId at ALL before this same follow-up wave -- every entry
    // had it null, so this branch fired for every two entries recorded
    // close together on the same block, regardless of device, and
    // create-entry.ts flipped the earlier CONFIRMED entry back to
    // 'pending' every time -- the user's progress visibly dropped after a
    // second recording, the opposite of AC-01.
    //
    // AC-06's own wording is "different devices" -- a difference we can
    // only assert when BOTH sides actually carry a known id. The client now
    // sends a real, persisted per-device id for the normal flow (main.tsx),
    // so `null` becomes rare; for that rare case, "unknown" defaults to
    // "assume same device, no conflict" -- the safe choice that does not
    // break the ordinary single-device flow.
    const bothDeviceIdsKnown = existing.sourceDeviceId !== null && newEntry.sourceDeviceId !== null;
    const differentDevice = bothDeviceIdsKnown && existing.sourceDeviceId !== newEntry.sourceDeviceId;
    return differentDevice && Math.abs(newEntry.recordedAt - existing.recordedAt) <= windowMs;
  });
}
