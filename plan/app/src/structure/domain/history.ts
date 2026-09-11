// Доменна логіка "Структури" -- локальна черга Літопису (AC-15, AC-12).
// Чиста функція, без I/O (plan/app/CLAUDE.md, "domain -> НІЧОГО"): додає
// подію renamed/moved/closed до черги в пам'яті й повертає нову чергу,
// щоб застосунок міг синхронізувати її пізніше, навіть якщо зараз офлайн.

export type StructureHistoryEventType = 'renamed' | 'moved' | 'closed';

export interface StructureHistoryEvent {
  id: string;
  cardId: string;
  eventType: StructureHistoryEventType;
  detail: string | null;
  occurredAt: string;
}

export function recordHistoryEvent(
  queue: StructureHistoryEvent[],
  event: StructureHistoryEvent,
): StructureHistoryEvent[] {
  return [...queue, event];
}
