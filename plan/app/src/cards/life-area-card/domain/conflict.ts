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
    // Review 2026-09-07 B7 (AC-06): відсутній sourceDeviceId (null) з обох боків
    // не доводить, що це один і той самий пристрій -- ми просто цього не знаємо.
    // `null !== null` хибне, тому наївне порівняння ховало б конфлікт. Якщо
    // хоча б один бік не має ідентифікатора пристрою, вважаємо це МОЖЛИВО
    // різними пристроями -- безпечніше зайвий раз уточнити, ніж мовчки
    // зарахувати обидва записи (дух AC-06: ніколи не рахувати мовчки).
    const possiblyDifferentDevice =
      existing.sourceDeviceId !== newEntry.sourceDeviceId ||
      existing.sourceDeviceId === null ||
      newEntry.sourceDeviceId === null;
    return possiblyDifferentDevice && Math.abs(newEntry.recordedAt - existing.recordedAt) <= windowMs;
  });
}
