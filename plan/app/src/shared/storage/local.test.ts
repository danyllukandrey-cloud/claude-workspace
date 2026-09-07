// T45 (review 2026-09-07 B8/C13): local.ts був заглушкою (export {}) -- цей
// тест доводить, що реальна реалізація дійсно читає/пише/видаляє через
// СПРАВЖНІЙ localStorage (jsdom-середовище Vitest надає глобальний
// localStorage, той самий, що в реальному браузері), а не проти фейкового
// StoragePort, як решта тестів картки.

import { describe, it, expect, beforeEach } from 'vitest';
import { createLocalStorageAdapter } from './local';

describe('createLocalStorageAdapter (T45)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('write -> read round-trips через справжній localStorage (не фейковий StoragePort)', () => {
    const storage = createLocalStorageAdapter();
    storage.write('life-area-card/card-1/entries', [{ id: 'entry-1', amount: 3 }]);

    // Доказ, що це САПРАВДІ localStorage, не якийсь інший рівень непрямості.
    expect(localStorage.getItem('life-area-card/card-1/entries')).toBe(
      JSON.stringify([{ id: 'entry-1', amount: 3 }]),
    );
    expect(storage.read('life-area-card/card-1/entries')).toEqual([{ id: 'entry-1', amount: 3 }]);
  });

  it('read повертає null для ключа, якого ніколи не було', () => {
    const storage = createLocalStorageAdapter();
    expect(storage.read('never-written')).toBeNull();
  });

  it('read повертає null (не кидає) на биті/не-JSON дані в localStorage', () => {
    localStorage.setItem('corrupted-key', 'це не валідний JSON{{{');
    const storage = createLocalStorageAdapter();

    expect(storage.read('corrupted-key')).toBeNull();
  });

  it('remove справді видаляє ключ', () => {
    const storage = createLocalStorageAdapter();
    storage.write('to-remove', 'значення');
    storage.remove('to-remove');

    expect(storage.read('to-remove')).toBeNull();
    expect(localStorage.getItem('to-remove')).toBeNull();
  });

  // Review 2026-09-07 E (T52): clear() -- викликається на logout
  // (local-cache.ts:clearAllCachedData), щоб дані попереднього акаунта не
  // лишались читомими на спільному пристрої після виходу.
  it('clear справді очищає ВСІ ключі, не лише один', () => {
    const storage = createLocalStorageAdapter();
    storage.write('life-area-card/user-1/card-1/entries', [{ id: 'entry-1' }]);
    storage.write('life-area-card/user-1/card-2/metric-blocks', [{ id: 'block-1' }]);
    storage.write('plan.jwt', { token: 'abc' });

    storage.clear();

    expect(storage.read('life-area-card/user-1/card-1/entries')).toBeNull();
    expect(storage.read('life-area-card/user-1/card-2/metric-blocks')).toBeNull();
    expect(storage.read('plan.jwt')).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});
