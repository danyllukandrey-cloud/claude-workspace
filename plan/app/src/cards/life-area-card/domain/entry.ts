export type EntryStatus = 'pending' | 'confirmed' | 'rejected';

export interface Entry {
  id: string;
  metricBlockId: string;
  amount: number;
  status: EntryStatus;
}

export function createEntry(input: { id: string; metricBlockId: string; amount: number; needsReview?: boolean }): Entry {
  return {
    id: input.id,
    metricBlockId: input.metricBlockId,
    amount: input.amount,
    status: input.needsReview ? 'pending' : 'confirmed',
  };
}

export function confirmEntry(entry: Entry): Entry {
  return { ...entry, status: 'confirmed' };
}

export function rejectEntry(entry: Entry): Entry {
  return { ...entry, status: 'rejected' };
}
