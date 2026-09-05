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

  // Немає фіксованої цілі -- нема з чим рахувати частку, показуємо накопичену
  // кількість як є (той самий вигляд відповіді, що й "постійний процес").
  // Дві різні причини ведуть сюди (ISS-34, data-model.md target_count):
  //   - isOngoing: true -- явний "постійний процес" (AC-05, без кінцевої дати);
  //   - targetCount: null сам по собі -- "чисто частотна" ціль без підсумку
  //     (data-model.md: "NULL для чисто частотних цілей без фіксованого
  //     підсумку"), незалежно від isOngoing.
  if (goal.isOngoing || goal.targetCount == null) {
    return { kind: 'ongoing', accumulated };
  }

  // targetCount заданий (не null) -- залишається лише відкинути некоректне
  // число (0 чи від'ємне), яке ділило б на неробочий знаменник.
  if (goal.targetCount <= 0) {
    throw new ProgressValidationError(
      'progress.target_count_invalid',
      'targetCount має бути додатним числом, якщо він заданий',
    );
  }

  const share = Math.min(accumulated / goal.targetCount, 1);
  const overGoal = accumulated > goal.targetCount ? accumulated - goal.targetCount : 0;

  return { kind: 'bounded', share, overGoal };
}
