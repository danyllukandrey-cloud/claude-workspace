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

  return (
    <div>
      {averageText !== null && <p>Середній прогрес: {averageText}</p>}
      <p>{excludedCount} картки виключено з середнього (немає метрики)</p>

      {!trendAvailable && (
        <Banner variant="info" text="Тренд наразі недоступний -- не вдалося завантажити історію" />
      )}

      {cards.length === 0 ? (
        <p>Немає карток з обчислюваним прогресом</p>
      ) : (
        <ul>
          {cards.map((card) => {
            const progressText = formatPercent(card.progress);
            const trendText = trendAvailable ? trendLabel(card.trend) : null;
            return (
              <li key={card.cardId}>
                <span>{card.cardTitle}</span>
                {progressText !== null && <span> {progressText}</span>}
                {layoutMode === 'logic' && card.gap !== null && (
                  <span> ранг-розрив: {card.gap}</span>
                )}
                {trendText !== null && <span> {trendText}</span>}
                {card.unmaintained && <span> заявлено важливим, не підтримується</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
