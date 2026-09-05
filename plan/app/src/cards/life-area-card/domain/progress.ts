export interface MetricBlockGoal {
  targetCount: number | null;
  isOngoing: boolean;
}

export interface RawEntry {
  amount: number;
  status: 'pending' | 'confirmed' | 'rejected';
}

export interface OngoingProgress {
  kind: 'ongoing';
  accumulated: number;
}

export interface BoundedProgress {
  kind: 'bounded';
  share: number;
  overGoal: number;
}

export type Progress = OngoingProgress | BoundedProgress;

export class ProgressValidationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProgressValidationError';
    this.code = code;
  }
}

function sumConfirmed(entries: RawEntry[]): number {
  return entries.reduce((sum, entry) => (entry.status === 'confirmed' ? sum + entry.amount : sum), 0);
}

export function computeProgress(goal: MetricBlockGoal, entries: RawEntry[]): Progress {
  const accumulated = sumConfirmed(entries);

  if (goal.isOngoing) {
    return { kind: 'ongoing', accumulated };
  }

  if (goal.targetCount == null || goal.targetCount <= 0) {
    throw new ProgressValidationError(
      'progress.target_count_required',
      'targetCount обовʼязковий (додатне число) для цілі, що не є постійним процесом',
    );
  }

  const share = Math.min(accumulated / goal.targetCount, 1);
  const overGoal = accumulated > goal.targetCount ? accumulated - goal.targetCount : 0;

  return { kind: 'bounded', share, overGoal };
}
