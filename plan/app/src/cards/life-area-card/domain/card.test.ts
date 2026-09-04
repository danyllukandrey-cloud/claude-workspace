import { describe, it, expect } from 'vitest';
import { createCard, markFilled, getLifecycleState, archiveCard, CardValidationError } from './card';

describe('createCard', () => {
  // AC-02: Given a user is creating a new card, when the user tries to save
  // it without a name, then the system blocks the creation and explains
  // that a name is required before a card can exist.
  it('rejects creation without a name', () => {
    expect(() => createCard({ id: 'card-1', name: '' })).toThrow(CardValidationError);
    try {
      createCard({ id: 'card-1', name: '   ' });
      expect.fail('очікувалась помилка card.name_required');
    } catch (err) {
      expect(err).toBeInstanceOf(CardValidationError);
      expect((err as CardValidationError).code).toBe('card.name_required');
    }
  });

  it('creates a card with a valid name', () => {
    const card = createCard({ id: 'card-1', name: 'Здоров’я' });
    expect(card.name).toBe('Здоров’я');
    expect(card.status).toBe('active');
    expect(card.description).toBeNull();
  });
});

describe('markFilled', () => {
  // AC-03: Given a user is setting up a card's Опис (навіщо), when the user
  // tries to mark the card as filled while leaving Опис empty, then the
  // system blocks marking it filled and explains that a short "навіщо" is
  // required first.
  it('rejects marking filled without a description', () => {
    const card = createCard({ id: 'card-1', name: 'Здоров’я' });
    expect(() => markFilled(card, '')).toThrow(CardValidationError);
    try {
      markFilled(card, '   ');
      expect.fail('очікувалась помилка card.description_required');
    } catch (err) {
      expect(err).toBeInstanceOf(CardValidationError);
      expect((err as CardValidationError).code).toBe('card.description_required');
    }
  });

  it('fills the description when non-empty', () => {
    const card = createCard({ id: 'card-1', name: 'Здоров’я' });
    const filled = markFilled(card, 'Хочу бути активнішим');
    expect(filled.description).toBe('Хочу бути активнішим');
  });
});

describe('getLifecycleState', () => {
  // AC-08: Given a user creates a card with an Опис but no metric-block,
  // when the user leaves it without any metric-block, then the card exists
  // and is usable, but never reaches the "actively tracked" state — it
  // stays a declarative-only card.
  it('stays declarative (never in_use) when there are no metric-blocks', () => {
    const card = markFilled(createCard({ id: 'card-1', name: 'Здоров’я' }), 'Хочу бути активнішим');
    expect(getLifecycleState(card, 0)).toBe('filled');
    expect(getLifecycleState(card, 0)).not.toBe('in_use');
  });

  it('reaches in_use once filled and it has at least one metric-block', () => {
    const card = markFilled(createCard({ id: 'card-1', name: 'Здоров’я' }), 'Хочу бути активнішим');
    expect(getLifecycleState(card, 1)).toBe('in_use');
  });

  it('stays created before it is filled, regardless of metric-block count', () => {
    const card = createCard({ id: 'card-1', name: 'Здоров’я' });
    expect(getLifecycleState(card, 3)).toBe('created');
  });
});

describe('archiveCard', () => {
  // AC-16: Given a user decides to stop tracking a card, when the user
  // deletes it, then the system marks the card archived — never physically
  // removed.
  it('marks status archived without deleting the card', () => {
    const card = createCard({ id: 'card-1', name: 'Здоров’я' });
    const archived = archiveCard(card);
    expect(archived.status).toBe('archived');
    expect(archived).toMatchObject({ id: card.id, name: card.name });
  });
});
