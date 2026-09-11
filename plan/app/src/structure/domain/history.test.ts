import { describe, it, expect } from 'vitest';
import { recordHistoryEvent } from './history';
import type { StructureHistoryEvent } from './history';

// T8 (AC-15, domain invariant) -- Структура записує "renamed"/"moved"/"closed"
// як подію Літопису з часовою міткою, тим самим механізмом, що вже описаний
// для AC-12 (closed) -- data-model.md "Літопис Структури", event_type CHECK
// IN ('renamed','moved','closed').
//
// Домен НІЧОГО не імпортує (plan/app/CLAUDE.md, "domain -> НІЧОГО") -- ця
// функція чисто додає подію до локальної черги в пам'яті, без мережі й без
// storage. Саме тому вона "переживає офлайн": немає жодної залежності від
// з'єднання, щоб виконатись і повернути нову чергу подій, готову бути
// синхронізованою пізніше (той самий підхід, що local-cache.ts картки
// (T11) використовує для сирих подій, лише на рівні домену, без StoragePort).

describe('recordHistoryEvent -- AC-15 (renamed/moved записуються, як і closed з AC-12)', () => {
  it('appends a "renamed" event with a timestamp to the local queue', () => {
    const queue: StructureHistoryEvent[] = [];

    const next = recordHistoryEvent(queue, {
      id: 'evt-1',
      cardId: 'card-1',
      eventType: 'renamed',
      detail: 'Здоров\'я -> Тіло і здоров\'я',
      occurredAt: '2026-09-11T10:00:00.000Z',
    });

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: 'evt-1',
      cardId: 'card-1',
      eventType: 'renamed',
      occurredAt: '2026-09-11T10:00:00.000Z',
    });
  });

  it('appends a "moved" event -- move in the logic-based layout is recorded the same way as a rename', () => {
    const queue: StructureHistoryEvent[] = [];

    const next = recordHistoryEvent(queue, {
      id: 'evt-2',
      cardId: 'card-2',
      eventType: 'moved',
      detail: 'cellIndex 3 -> 5',
      occurredAt: '2026-09-11T10:05:00.000Z',
    });

    expect(next[0].eventType).toBe('moved');
    expect(next[0].occurredAt).toBe('2026-09-11T10:05:00.000Z');
  });

  it('keeps recording "closed" the same way AC-12 already does, alongside renamed/moved in one queue', () => {
    const queue: StructureHistoryEvent[] = [];

    const afterRename = recordHistoryEvent(queue, {
      id: 'evt-3',
      cardId: 'card-3',
      eventType: 'renamed',
      detail: null,
      occurredAt: '2026-09-11T09:00:00.000Z',
    });
    const afterClose = recordHistoryEvent(afterRename, {
      id: 'evt-4',
      cardId: 'card-3',
      eventType: 'closed',
      detail: null,
      occurredAt: '2026-09-11T09:30:00.000Z',
    });

    expect(afterClose.map((e) => e.eventType)).toEqual(['renamed', 'closed']);
  });

  it('never mutates the queue passed in -- each call returns a new array, so the local queue survives being replayed offline without losing prior entries', () => {
    const queue: StructureHistoryEvent[] = [
      { id: 'evt-0', cardId: 'card-1', eventType: 'renamed', detail: null, occurredAt: '2026-09-10T00:00:00.000Z' },
    ];

    const next = recordHistoryEvent(queue, {
      id: 'evt-1',
      cardId: 'card-1',
      eventType: 'moved',
      detail: null,
      occurredAt: '2026-09-11T00:00:00.000Z',
    });

    expect(queue).toHaveLength(1); // оригінальна черга не мутована
    expect(next).toHaveLength(2);
  });
});
