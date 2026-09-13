// Картка пропозиції запису SCR-01, стан proposal-pending (T25) -- агент
// сформував пропозицію й чекає підтвердження (AC-01/AC-02/AC-10,
// screens.md SCR-01 wireframe "[ Підтвердити ] [ Уточнити ]").
//
// Навмисно без onRefine(text): "Уточнити" лише сигналізує намір -- саме
// уточнення користувач набирає звичайним повідомленням у Composer, а
// бекенд оновлює ту саму активну пропозицію (AC-02b, sad.md §4 "наступне
// повідомлення оновлює її"). Ця картка не знає, що станеться після кліку --
// той самий DI-стиль, що ArchiveCardDialog (onArchive ін'єктується ззовні).
//
// Правило залежностей (plan/app/CLAUDE.md): ui -> shared/ui (Button), без
// domain/ports.

import { Button } from '../../../shared/ui';

export interface ProposalCardProps {
  /** Людський опис пропозиції, показаний користувачу (`agent_proposal.proposed_summary`, data-model.md). */
  proposedSummary: string;
  /** AC-02: явне підтвердження -- лише після нього стається запис. */
  onConfirm: () => void;
  /** AC-02b: користувач хоче уточнити деталь замість підтвердження. */
  onRefine: () => void;
  /** Кнопка "Підтвердити" недоступна, поки запис у польоті (захист від подвійного сабміту). */
  confirmDisabled?: boolean;
}

export function ProposalCard({
  proposedSummary,
  onConfirm,
  onRefine,
  confirmDisabled = false,
}: ProposalCardProps): JSX.Element {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface-solid p-4 shadow-soft">
      <p className="text-sm font-medium text-ink">{proposedSummary}</p>
      {/* D-111: обидві дії стосуються цієї ж пропозиції -- лишаються поруч, одна група. */}
      <div className="flex flex-wrap gap-3">
        <Button label="Підтвердити" onClick={onConfirm} disabled={confirmDisabled} />
        <Button label="Уточнити" onClick={onRefine} />
      </div>
    </div>
  );
}
