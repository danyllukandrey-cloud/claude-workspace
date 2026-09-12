import { describe, it, expect } from 'vitest';
import {
  getShortTermWindow,
  findFactsByTopic,
  stripThirdPersonNames,
  prepareFactText,
} from './memory';
import type { ChatMessage, LongTermMemoryFact } from './memory';

// T10 -- гібридна пам'ять агента: коротке сире вікно поточної сесії
// (AC-15, D-26 -- одиниця "сесія" = календарний день, sad.md §5/§6 Flow 12)
// + довгострокові структуровані факти, що шукаються за темою (AC-09,
// sad.md §6 Flow 11) + приватність третьої особи перед записом факту
// (AC-06, sad.md §8 "third person в тексті", data-model.md
// `long_term_memory_fact.fact_text`: "ім'я третьої особи вже прибране
// перед записом").
//
// Домен НІЧОГО не імпортує (plan/app/CLAUDE.md, "domain -> НІЧОГО"): усі
// три функції нижче чисті, без I/O -- отримують уже прочитані рядки
// (repo/postgres-repo -- інфра T13) і повертають похідні дані/текст.

describe('getShortTermWindow -- AC-15 (коротке вікно = календарний день, D-26)', () => {
  const messages: ChatMessage[] = [
    { id: 'm1', userId: 'u1', role: 'user', content: 'вчора бігав 5 км', sessionDate: '2026-09-11', createdAt: '2026-09-11T20:00:00.000Z' },
    { id: 'm2', userId: 'u1', role: 'user', content: 'сьогодні зранку йога', sessionDate: '2026-09-12', createdAt: '2026-09-12T07:00:00.000Z' },
    { id: 'm3', userId: 'u1', role: 'agent', content: 'записав йогу?', sessionDate: '2026-09-12', createdAt: '2026-09-12T07:00:05.000Z' },
    { id: 'm4', userId: 'u1', role: 'user', content: 'ще не, ввечері', sessionDate: '2026-09-12', createdAt: '2026-09-12T07:01:00.000Z' },
  ];

  it('returns only messages whose sessionDate matches the current calendar day', () => {
    const window = getShortTermWindow(messages, '2026-09-12');

    expect(window.map((m) => m.id)).toEqual(['m2', 'm3', 'm4']);
  });

  it('excludes yesterday\'s messages even though they belong to the same user', () => {
    const window = getShortTermWindow(messages, '2026-09-12');

    expect(window.some((m) => m.id === 'm1')).toBe(false);
  });

  it('orders the window chronologically by createdAt, regardless of input order', () => {
    const shuffled: ChatMessage[] = [messages[3], messages[1], messages[2]];

    const window = getShortTermWindow(shuffled, '2026-09-12');

    expect(window.map((m) => m.id)).toEqual(['m2', 'm3', 'm4']);
  });

  it('returns an empty window for a calendar day with no messages -- next session starts fresh', () => {
    const window = getShortTermWindow(messages, '2026-09-13');

    expect(window).toEqual([]);
  });
});

describe('findFactsByTopic -- AC-09 (пошук довгострокового факту "тієї самої теми")', () => {
  const facts: LongTermMemoryFact[] = [
    { id: 'f1', userId: 'u1', factText: 'алергія на горіхи', topic: 'здоровʼя', status: 'active', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
    { id: 'f2', userId: 'u1', factText: 'працює віддалено з понеділка по середу', topic: 'робота', status: 'active', createdAt: '2026-08-05T00:00:00.000Z', updatedAt: '2026-08-05T00:00:00.000Z' },
    { id: 'f3', userId: 'u1', factText: 'кинув бігати взимку торік', topic: 'здоровʼя', status: 'deleted', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-08-06T00:00:00.000Z' },
  ];

  it('returns the active fact matching the given topic', () => {
    const found = findFactsByTopic(facts, 'здоровʼя');

    expect(found.map((f) => f.id)).toEqual(['f1']);
  });

  it('never returns a soft-deleted fact, even if the topic matches ("забудь, що..." command, sad.md §4)', () => {
    const found = findFactsByTopic(facts, 'здоровʼя');

    expect(found.some((f) => f.id === 'f3')).toBe(false);
  });

  it('matches the topic case-insensitively and ignores surrounding whitespace (free-text tag, data-model.md)', () => {
    const found = findFactsByTopic(facts, '  ЗДОРОВʼЯ  ');

    expect(found.map((f) => f.id)).toEqual(['f1']);
  });

  it('returns an empty list when no active fact matches the topic', () => {
    const found = findFactsByTopic(facts, 'фінанси');

    expect(found).toEqual([]);
  });
});

describe('stripThirdPersonNames -- AC-06 (приватність: чуже ім\'я ніколи не потрапляє в пам\'ять, sad.md §8)', () => {
  it('removes the third-person name from the text, keeping the measurable fact (sad.md §6 Flow 4 example)', () => {
    const result = stripThirdPersonNames('біг з Марією 5 км', ['Марією']);

    expect(result).not.toContain('Марією');
    expect(result).toContain('5 км');
  });

  it('removes multiple third-person names in one pass', () => {
    const result = stripThirdPersonNames('вечеря з Олегом і Мар\'яною', ['Олегом', "Мар'яною"]);

    expect(result).not.toContain('Олегом');
    expect(result).not.toContain("Мар'яною");
  });

  it('does not touch names that only appear as a substring of another word', () => {
    const result = stripThirdPersonNames('Марк написав звіт', ['Марія']);

    expect(result).toBe('Марк написав звіт');
  });

  it('collapses the double space left behind after removing a name', () => {
    const result = stripThirdPersonNames('говорив з Іваном сьогодні', ['Іваном']);

    expect(result).toBe('говорив з сьогодні');
  });

  it('returns the original text unchanged when no third-person names are given', () => {
    const result = stripThirdPersonNames('пробіг 5 км сам', []);

    expect(result).toBe('пробіг 5 км сам');
  });
});

describe('prepareFactText -- AC-06 + AC-09 (текст факту готується до запису, data-model.md fact_text NOT NULL)', () => {
  it('strips the third-person name before the text is handed off for storage', () => {
    const result = prepareFactText('біг з Марією 5 км', ['Марією']);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toContain('Марією');
      expect(result.value).toBe('біг з 5 км');
    }
  });

  it('returns an err (ADR-0006 sentinel, not a throw) when nothing measurable survives stripping -- a fact record can never be empty', () => {
    const result = prepareFactText('Марія', ['Марія']);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('long_term_memory_fact.fact_text_empty');
  });

  it('returns an err on a blank raw fact text even with no names to strip', () => {
    const result = prepareFactText('   ', []);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('long_term_memory_fact.fact_text_empty');
  });
});
