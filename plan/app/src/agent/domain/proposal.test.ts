import { describe, it, expect } from 'vitest';
import { createProposal, refineProposal, confirmProposal, dropProposal } from './proposal';
import type { Proposal } from './proposal';

// Доменний життєвий цикл пропозиції агента (spec.md AC-01/AC-02/AC-02b/AC-03/
// AC-10/AC-10b, data-model.md agent_proposal, sad.md §4/§6 Flow 1/3/5).
// Sentinel Result (ADR-0006 agent) -- жодна з цих функцій не кидає виняток
// для очікуваного результату, тому кожен тест перевіряє `.ok`/`.value`/
// `.error`, а не `toThrow()`.

function activeProposal(overrides: Partial<Proposal> = {}): Proposal {
  const created = createProposal({
    id: 'proposal-1',
    userId: 'user-1',
    sourceType: 'text',
    rawInput: 'пробіг 5 км',
    proposedSummary: '5 км бігу',
    cardId: 'card-1',
    metricBlockId: 'block-1',
    proposedAmount: 5,
  });
  if (!created.ok) {
    throw new Error('test fixture must build a valid active proposal');
  }
  return { ...created.value, ...overrides };
}

describe('createProposal — AC-01 (текст) / AC-10 (вкладення)', () => {
  it('creates an active proposal from free text', () => {
    const result = createProposal({
      id: 'proposal-1',
      userId: 'user-1',
      sourceType: 'text',
      rawInput: 'пробіг 5 км',
      proposedSummary: '5 км бігу',
      cardId: 'card-1',
      metricBlockId: 'block-1',
      proposedAmount: 5,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      id: 'proposal-1',
      userId: 'user-1',
      cardId: 'card-1',
      metricBlockId: 'block-1',
      status: 'active',
      sourceType: 'text',
      rawInput: 'пробіг 5 км',
      proposedAmount: 5,
      proposedSummary: '5 км бігу',
    });
  });

  it('creates an active proposal from an attachment the same way as from text (AC-10 -- вкладення замінює текст повністю)', () => {
    const result = createProposal({
      id: 'proposal-2',
      userId: 'user-1',
      sourceType: 'attachment',
      rawInput: 'фото сторінки книги',
      proposedSummary: '30 сторінок прочитано',
      proposedAmount: 30,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('active');
    expect(result.value.sourceType).toBe('attachment');
    expect(result.value.cardId).toBeNull();
    expect(result.value.metricBlockId).toBeNull();
  });

  it('rejects an empty raw input without creating any proposal', () => {
    const result = createProposal({
      id: 'proposal-3',
      userId: 'user-1',
      sourceType: 'text',
      rawInput: '   ',
      proposedSummary: 'щось',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('proposal.raw_input_required');
  });

  it('AC-10b -- an unrecognized/unreadable attachment does not create a proposal, symmetric to AC-04', () => {
    const result = createProposal({
      id: 'proposal-4',
      userId: 'user-1',
      sourceType: 'attachment',
      rawInput: 'нечитабельний файл',
      proposedSummary: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('proposal.fact_not_recognized');
  });

  it('rejects a blank proposedSummary from text input the same way as from an attachment', () => {
    const result = createProposal({
      id: 'proposal-5',
      userId: 'user-1',
      sourceType: 'text',
      rawInput: 'щось незрозуміле',
      proposedSummary: '   ',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('proposal.fact_not_recognized');
  });
});

describe('refineProposal — AC-02b (уточнення оновлює ТУ САМУ пропозицію)', () => {
  it('updates amount and summary in place, keeping the same id and active status', () => {
    const proposal = activeProposal();

    const result = refineProposal(proposal, { proposedAmount: 3, proposedSummary: '3 км бігу' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Та сама пропозиція (id незмінний) -- не новий діалог з нуля.
    expect(result.value.id).toBe(proposal.id);
    expect(result.value.status).toBe('active');
    expect(result.value.proposedAmount).toBe(3);
    expect(result.value.proposedSummary).toBe('3 км бігу');
  });

  it('leaves fields not mentioned in the refinement untouched', () => {
    const proposal = activeProposal();

    const result = refineProposal(proposal, { proposedAmount: 3 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.proposedAmount).toBe(3);
    expect(result.value.proposedSummary).toBe(proposal.proposedSummary);
  });

  it('refuses to refine a proposal that is no longer active', () => {
    const proposal = activeProposal({ status: 'confirmed' });

    const result = refineProposal(proposal, { proposedAmount: 3 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('proposal.not_active');
  });
});

describe('confirmProposal — AC-02 (active -> confirmed)', () => {
  it('transitions an active proposal to confirmed', () => {
    const proposal = activeProposal();

    const result = confirmProposal(proposal);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('confirmed');
    expect(result.value.id).toBe(proposal.id);
  });

  it('refuses to confirm a proposal that is not active', () => {
    const proposal = activeProposal({ status: 'dropped' });

    const result = confirmProposal(proposal);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('proposal.not_active');
  });
});

describe('dropProposal — AC-03 (мовчазне відкидання -- мовчазного запису не буває)', () => {
  it('silently transitions an active proposal to dropped', () => {
    const proposal = activeProposal();

    const result = dropProposal(proposal);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('dropped');
    expect(result.value.id).toBe(proposal.id);
    // Нічого з даних пропозиції (майбутнього запису) не змінилось -- лише статус.
    expect(result.value.proposedAmount).toBe(proposal.proposedAmount);
  });

  it('is idempotent when the proposal is already dropped', () => {
    const proposal = activeProposal({ status: 'dropped' });

    const result = dropProposal(proposal);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('dropped');
  });

  it('refuses to drop a proposal that was already confirmed and recorded', () => {
    const proposal = activeProposal({ status: 'confirmed' });

    const result = dropProposal(proposal);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('proposal.already_confirmed');
  });
});
