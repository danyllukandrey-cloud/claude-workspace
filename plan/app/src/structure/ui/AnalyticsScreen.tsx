// SCR-03 — Літопис-Аналітика (spec.md AC-01, AC-04, AC-05, AC-06, AC-06b,
// AC-07, AC-13).
//
// DI (plan/app/CLAUDE.md, той самий стиль, що DeclarationScreen/
// CardDetailScreen): `loadAnalytics` — ін'єктована пропи-функція, жодного
// fetch() тут. Дані вже прораховані use-case'ом ../app/get-analytics.ts
// (average/excludedCount/layoutMode/cards), доповнені `cardTitle` на
// картку (join з life-area-card робить шар ports/, поза межами цієї
// задачі) і окремим `trendAvailable` — `false` лише коли не відповів
// GET /structure/layout/history (sad.md §11, TBD), а не коли в конкретної
// картки `trend === null` (AC-07 "замало точок історії").
//
// AC-06/AC-06b: жодного слова-вердикту ("добре"/"погано"/"ефективно") —
// лише числа (прогрес %, ранг-розрив, стрілка тренду) або прапорець
// "заявлено важливим, не підтримується" для карток без метрик у
// не-логічній розкладці (spec.md §3 Non-goals, D-60).
// AC-13: картки без обчислюваного прогресу виключені з середнього, але їх
// кількість завжди показана окремо — і в порожньому, і в непорожньому стані.

import { useEffect, useState } from 'react';
import { Banner, Spinner } from '../../shared/ui';

export type AnalyticsTrend = 'growing' | 'shrinking' | null;

export interface AnalyticsScreenCard {
  cardId: string;
  cardTitle: string;
  progress: number | null;
  gap: number | null;
  trend: AnalyticsTrend;
  unmaintained: boolean;
}

export interface AnalyticsScreenState {
  layoutMode: 'single' | 'free' | 'logic' | null;
  average: number | null;
  excludedCount: number;
  /** `false` тільки коли не відповів GET /structure/layout/history — не плутати з trend===null у окремій картці. */
  trendAvailable: boolean;
  cards: AnalyticsScreenCard[];
}

export interface AnalyticsScreenProps {
  /** Завантажує прораховану аналітику. */
  loadAnalytics: () => Promise<AnalyticsScreenState>;
}

function formatPercent(value: number | null): string | null {
  if (value === null) return null;
  return `${Math.round(value * 100)}%`;
}

function trendLabel(trend: AnalyticsTrend): string | null {
  if (trend === 'growing') return 'росте';
  if (trend === 'shrinking') return 'меншає';
  return null;
}

export function AnalyticsScreen({ loadAnalytics }: AnalyticsScreenProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<AnalyticsScreenState | null>(null);

  useEffect(() => {
    loadAnalytics().then((result) => {
      setState(result);
      setLoading(false);
    });
    // Навмисно без loadAnalytics у deps -- викликається рівно раз при
    // монтуванні (той самий підхід, що DeclarationScreen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || state === null) {
    return <Spinner />;
  }

  const { layoutMode, average, excludedCount, trendAvailable, cards } = state;
  const averageText = formatPercent(average);

  // D-120: "статистична картка" -- та сама поверхня (border-border/bg-surface/
  // shadow-soft), що CardShell, без блобів-підкладок (тут не картка, що
  // перевертається). Тренд (growing/shrinking) і unmaintained (прапорець)
  // навмисно НЕ пофарбовані у світлофор good/warn/bad -- ні одне з них не є
  // готовим 3-станним статусом на кшталт confirmed/pending/rejected, а
  // growing/shrinking у контексті плану життя не завжди "добре"/"погано"
  // (AC-06 -- жодного вердикту). Обидва лишаються нейтральним ink/accent-стилем.
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1 rounded-card border border-border bg-surface p-5 shadow-soft backdrop-blur-xl">
        {averageText !== null && (
          <p className="text-sm font-medium text-ink-muted">
            Середній прогрес:{' '}
            <span className="font-display text-2xl font-bold text-ink">{averageText}</span>
          </p>
        )}
        <p className="text-xs text-ink-faint">{excludedCount} картки виключено з середнього (немає метрики)</p>
      </div>

      {!trendAvailable && (
        <Banner variant="info" text="Тренд наразі недоступний -- не вдалося завантажити історію" />
      )}

      {cards.length === 0 ? (
        <p className="px-2 py-8 text-center text-sm text-ink-muted">Немає карток з обчислюваним прогресом</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {cards.map((card) => {
            const progressText = formatPercent(card.progress);
            const trendText = trendAvailable ? trendLabel(card.trend) : null;
            return (
              <li
                key={card.cardId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-control border border-border bg-surface-solid px-4 py-3 shadow-soft"
              >
                <span className="font-medium text-ink">{card.cardTitle}</span>
                {progressText !== null && (
                  <span className="font-display text-sm font-bold text-accent">{progressText}</span>
                )}
                {layoutMode === 'logic' && card.gap !== null && (
                  <span className="text-xs text-ink-muted"> ранг-розрив: {card.gap}</span>
                )}
                {trendText !== null && <span className="text-xs text-ink-muted"> {trendText}</span>}
                {card.unmaintained && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                    заявлено важливим, не підтримується
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
