// SCR-03 -- Звіти активності (spec.md AC-11, US-08).
//
// Read-only (T28 Notes): жодної дії користувача, що запускає формування
// звіту -- `agent-worker` формує звіти самостійно за власним розкладом
// (Flow 14, ADR-0002). Цей екран лише читає GET /reports (T23,
// ../ports/reports-handler.ts listReports), окрема сутність від
// Літопису-Аналітики Структури (CONTEXT.md `activity-report`).
//
// DI (plan/app/CLAUDE.md, той самий стиль, що AnalyticsScreen/ArchiveScreen):
// `loadReports` -- ін'єктована пропи-функція, жодного fetch() тут.
// Реальний HTTP-транспорт і camelCase-мапінг ports-DTO -> view model
// (periodLabel/summary вже відформатовані) -- турбота майбутньої задачі
// підключення (той самий підхід, що EntryViewModel.recordedAtLabel у
// life-area-card/ui/types.ts): компонент навмисно не форматує дати сам,
// щоб не вносити локаль-залежну логіку в presentation-шар.
//
// Стани (screens.md SCR-03): default / empty / loading / dead-letter-flagged
// / error -- дискримінована унія ScreenState, той самий підхід, що
// ArchiveScreen.tsx (SCR-07).
import { useEffect, useState } from 'react';
import { Banner, EmptyState, Spinner } from '../../shared/ui';

export type ReportStatus = 'generated' | 'dead_letter';

export interface ReportViewModel {
  id: string;
  /** Вже відформатована мітка періоду, напр. "Тижневий, 18-24 серпня" чи "Квартальний, Q3". */
  periodLabel: string;
  /** Короткий підсумок звіту (`activity_report.content`). */
  summary: string;
  /** `dead_letter` -- запис не вдався після retry (Flow 14, sad.md §11 accepted debt), потребує ручної перевірки. */
  status: ReportStatus;
}

export interface ReportsScreenProps {
  /**
   * Завантажує звіти активності поточного користувача (AC-11). Ін'єктована
   * функція (DI) -- компонент не знає, звідки походять дані (GET /reports,
   * T23, підключить майбутня транспортна задача).
   */
  loadReports: () => Promise<ReportViewModel[]>;
}

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'list'; reports: ReportViewModel[] };

const DEFAULT_LOAD_ERROR = 'Не вдалося завантажити звіти активності';

export function ReportsScreen({ loadReports }: ReportsScreenProps): JSX.Element {
  const [state, setState] = useState<ScreenState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    loadReports()
      .then((reports) => {
        if (!cancelled) {
          setState({ status: 'list', reports });
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
    // Навмисно без loadReports у deps -- викликається рівно раз при
    // монтуванні (той самий підхід, що AnalyticsScreen/DeclarationScreen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.status === 'loading') {
    return <Spinner />;
  }

  if (state.status === 'error') {
    return (
      <div>
        <h1>Звіти активності</h1>
        <Banner variant="error" text={state.message} />
      </div>
    );
  }

  if (state.reports.length === 0) {
    return (
      <div>
        <h1>Звіти активності</h1>
        <EmptyState
          message="Ще немає жодного звіту"
          actionHint="Перший звіт з'явиться тут після завершення періоду (тижневого, місячного чи квартального)"
        />
      </div>
    );
  }

  return (
    <div>
      <h1>Звіти активності</h1>
      <ul>
        {state.reports.map((report) => (
          <li key={report.id}>
            <p>{report.periodLabel}</p>
            <p>{report.summary}</p>
            {report.status === 'dead_letter' && (
              <Banner
                variant="error"
                text="Формування не вдалось, показані дані можуть бути неповні -- потребує перевірки"
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
