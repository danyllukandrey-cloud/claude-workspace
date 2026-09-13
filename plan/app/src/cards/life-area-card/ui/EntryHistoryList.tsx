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

export function EntryHistoryList({ entries, onFlagEntry, isFlagEntryDisabled }: EntryHistoryListProps): JSX.Element {
  return (
    <div>
      <h3>Історія записів</h3>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <span>{entry.recordedAtLabel}</span> <span>{entry.summary}</span>{' '}
            {entry.status === 'confirmed' && onFlagEntry && (
              <button type="button" onClick={() => onFlagEntry(entry.id)} disabled={isFlagEntryDisabled}>
                виправити
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
