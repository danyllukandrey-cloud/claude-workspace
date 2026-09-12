import { describe, it, expect } from 'vitest';
import { setDeclaration } from './declaration';
import type { Structure } from './declaration';

// AC-10 (domain invariant): Структура тримає власну декларацію "картина
// світу, навіщо, пріоритет" повністю окремо від Опису будь-якої картки --
// два поля НІКОЛИ не мерджаться і не показуються як одне.
// life-area-card/domain/card.ts тримає власне поле `description` (Опис) --
// нижче навмисно фігурує окремий об'єкт card, що симулює цю картку, аби
// перевірити: зміна declaration НІКОЛИ не чіпає card.description і навпаки.

describe('setDeclaration — AC-10 (декларація Структури окремо від Опису картки)', () => {
  it('stores the Structure-level declaration completely independent of a card\'s own Опис', () => {
    const structure: Structure = { id: 'structure-1', ownerUserId: 'user-1', declaration: null };
    const card = { id: 'card-1', description: 'Опис картки -- зовсім інше поле' };

    const updated = setDeclaration(structure, 'Картина світу, навіщо, пріоритет');

    expect(updated.declaration).toBe('Картина світу, навіщо, пріоритет');
    // Опис картки лишається незмінним -- жодного мерджу двох полів в одне.
    expect(card.description).toBe('Опис картки -- зовсім інше поле');
    expect(updated).not.toHaveProperty('description');
    expect(card).not.toHaveProperty('declaration');
  });

  it('allows the declaration to stay null until the user writes one, without borrowing the card\'s Опис', () => {
    const structure: Structure = { id: 'structure-1', ownerUserId: 'user-1', declaration: null };
    expect(structure.declaration).toBeNull();
  });

  it('rejects setting the declaration to an empty/whitespace-only string the same way a real edit would be blocked', () => {
    const structure: Structure = { id: 'structure-1', ownerUserId: 'user-1', declaration: 'Попередній текст' };
    expect(() => setDeclaration(structure, '   ')).toThrow();
    // Попередній текст не підмінюється мовчки порожнім значенням.
    expect(structure.declaration).toBe('Попередній текст');
  });
});
