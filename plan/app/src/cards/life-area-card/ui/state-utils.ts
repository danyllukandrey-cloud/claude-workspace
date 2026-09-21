// code-review 2026-09-21 (duplication): один і той самий null-guard --
// "патч поля, лише якщо дані вже завантажені" -- був написаний окремо в
// CardFace.tsx (двічі: назва, опис) і CardBack.tsx (режим картки):
// `(prev) => prev ? {...prev, ...patch} : prev`. DeckScreen.tsx має СХОЖИЙ,
// але структурно ІНШИЙ випадок (список під обгорткою status, не єдиний
// об'єкт) -- туди цю функцію не тягнемо, це вже інша форма, не той самий
// код двічі.
import type { Dispatch, SetStateAction } from 'react';

/**
 * Патчить `patch` у стан, лише якщо там уже щось завантажено (не `null`).
 * Немає даних -- виклик тихо ігнорується (той самий guard, що й раніше).
 */
export function patchIfLoaded<T>(setState: Dispatch<SetStateAction<T | null>>, patch: Partial<T>): void {
  setState((prev) => (prev ? { ...prev, ...patch } : prev));
}
