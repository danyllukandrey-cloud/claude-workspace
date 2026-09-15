// Лог дій -- заміна SCR-03 "Звіти активності" у навігації (той самий слот
// меню шестерні, D-123, ../../app/App.tsx). Андрій: "Звіт активності -- що
// це таке, воно дублює Аналітику якось. Це має бути Лог. В нього тупо пишемо
// кожну дію -- час, дія, все."
//
// Простий хронологічний список: кожен рядок -- "час — опис дії", найновіші
// зверху (GET /api/v1/action-log, ../ports/action-log-handler.ts
// listActionLog). Read-only, той самий read-only дух, що ReportsScreen.tsx
// мало (жодної дії користувача, що запускає запис -- записи в Лог пишуть
// use-case-и інших фіч самі, ../app/record-action.ts).
//
// Механізм періодичних звітів agent-worker (activity_report, D-70) лишається
// як backend-only -- цей екран НЕ показує їх, GET /api/v1/reports просто
// більше нема звідки викликати з UI (main.tsx's loadReports прибрано разом
// із цим екраном).
//
// DI (plan/app/CLAUDE.md, той самий стиль, що AnalyticsScreen/ArchiveScreen):
// `loadActionLog` -- ін'єктована пропи-функція, жодного fetch() тут. Час уже
// відформатований у view model (occurredAtLabel) -- той самий підхід, що
// EntryViewModel.recordedAtLabel (life-area-card/ui/types.ts) і
// ReportViewModel.periodLabel мали: компонент навмисно не форматує дати сам,
// щоб не вносити локаль-залежну логіку в presentation-шар.
//
// Стани: loading / error / list (список чи порожній стан) -- той самий
// дискримінований union, що ReportsScreen.tsx мав.
import { useEffect, useState } from 'react';
import { Banner, EmptyState, Spinner } from '../../shared/ui';

export interface LogEntryViewModel {
  id: string;
  /** Вже відформатована мітка часу, напр. "15.09 14:32". */
  occurredAtLabel: string;
  /** Короткий людяний опис дії, напр. "Створено картку «Спорт»". */
  action: string;
}

export interface LogScreenProps {
  /**
   * Завантажує хронологічний Лог дій поточного користувача, найновіші перші.
   * Ін'єктована функція (DI) -- компонент не знає, звідки походять дані
   * (GET /api/v1/action-log).
   */
  loadActionLog: () => Promise<LogEntryViewModel[]>;
}

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'list'; entries: LogEntryViewModel[] };

const DEFAULT_LOAD_ERROR = 'Не вдалося завантажити Лог дій';

export function LogScreen({ loadActionLog }: LogScreenProps): JSX.Element {
  const [state, setState] = useState<ScreenState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    loadActionLog()
      .then((entries) => {
        if (!cancelled) {
          setState({ status: 'list', entries });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : DEFAULT_LOAD_ERROR;
          setState({ status: 'error', message });
        }
      });

    return () => {
      cancelled = true;
    };
    // Навмисно без loadActionLog у deps -- викликається рівно раз при
    // монтуванні (той самий підхід, що AnalyticsScreen/ReportsScreen мали).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="flex justify-center px-6 py-10">
        <Spinner />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-col gap-4 p-4">
        <h1 className="font-display text-xl font-bold text-ink">Лог дій</h1>
        <Banner variant="error" text={state.message} />
      </div>
    );
  }

  if (state.entries.length === 0) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <h1 className="font-display text-xl font-bold text-ink">Лог дій</h1>
        <EmptyState message="Ще немає жодної дії" actionHint="Тут з'являться записи про кожну значущу дію в застосунку -- час і що сталося" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="font-display text-xl font-bold text-ink">Лог дій</h1>
      <ul className="flex list-none flex-col gap-2">
        {state.entries.map((entry) => (
          <li
            key={entry.id}
            className="flex items-baseline gap-3 rounded-card border border-border bg-surface-solid px-4 py-2.5 shadow-soft"
          >
            <span className="shrink-0 text-xs text-ink-muted">{entry.occurredAtLabel}</span>
            <span className="text-sm text-ink">{entry.action}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
