// Історія записів на звороті картки (SCR-03 "history-expanded", T26, AC-13) --
// показує найновіші записи по черзі, кожен з тим, що записано і коли.
//
// "виправити" (AC-12, ux-flows.md US-12) доступне лише для вже підтверджених
// записів -- саме такий приклад у wireframe SCR-03. Клік НЕ виправляє нічого
// сам -- він лише повідомляє картку "користувач вважає цей запис помилковим";
// саме виправлення завжди відбувається в діалозі з агентом (ux-flows.md:
// "виправлення -- завжди діалог з агентом, ніколи пряме редагування числа"),
// поза цим компонентом.
import type { EntryViewModel } from './types';

export interface EntryHistoryListProps {
  entries: EntryViewModel[];
  /**
   * Review 2026-09-07, post-ship follow-up review (C11 remainder): опційний,
   * як onCreateMetricBlock деінде в цій картці (ISS-60 прецедент) --
   * відсутність означає "кнопка не рендериться взагалі", не "рендериться,
   * але клік нічого не робить" (саме це й було C11 -- мертва кнопка).
   */
  onFlagEntry?: (entryId: string) => void;
  /** Review 2026-09-07 (AC-12/E remainder, T52-style guard): вимикає ВСІ кнопки "виправити", поки один такий запит уже в польоті -- захист від подвійного кліку. */
  isFlagEntryDisabled?: boolean;
}

// D-120: entry.status -- готовий дискретний статус (confirmed/pending/
// rejected, domain/entry.ts), не вигаданий поріг -- саме той випадок, де
// дозволено світлофор (good/warn/bad), глянцевий `.chip-gloss`.
const STATUS_DOT: Record<EntryViewModel['status'], string> = {
  confirmed: 'bg-good',
  pending: 'bg-warn',
  rejected: 'bg-bad',
};

export function EntryHistoryList({ entries, onFlagEntry, isFlagEntryDisabled }: EntryHistoryListProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-display text-sm font-bold uppercase tracking-wide text-ink-muted">Історія записів</h3>
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center gap-2 rounded-control border border-border bg-surface-solid px-3 py-2.5"
          >
            <span
              aria-hidden="true"
              className={`chip-gloss h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[entry.status]}`}
            />{' '}
            <span className="text-xs text-ink-muted">{entry.recordedAtLabel}</span>{' '}
            <span className="flex-1 text-sm text-ink">{entry.summary}</span>{' '}
            {entry.status === 'confirmed' && onFlagEntry && (
              <button
                type="button"
                onClick={() => onFlagEntry(entry.id)}
                disabled={isFlagEntryDisabled}
                className="shrink-0 rounded-control border border-border px-2.5 py-1 text-xs font-bold text-ink transition-colors hover:bg-border disabled:cursor-not-allowed disabled:opacity-50"
              >
                виправити
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
