// SCR-04 — Архівування (CH-05/CH-06, docs/features/structure/changes.md).
// Раніше "Закрити напрямок" (CloseCardDialog.tsx, T23) -- перейменовано разом
// із файлом: CH-05 прибирає структуроспецифічний флоу POST
// /structure/layout/{cardId}/close повністю ("без мережевих помилок і без
// дублювання картки" -- картка раніше зникала зі Схеми, лишалась активною в
// колоді, і з'являлась знову внизу Схеми при поверненні на вкладку, бо
// closeCard і archiveCard були ДВОМА різними діями з різним станом).
//
// CH-05 архітектура: "Архівувати" тепер викликає ТОЙ САМИЙ injected
// `archiveCard`, що вже архівує картку з колоди (life-area-card
// CardFace/CardBack "..." -> "Архівувати") -- той самий use-case (D-103,
// archive-card.ts) сам закриває активну позицію картки в розкладці
// Структури, тож нічого структуроспецифічного тут більше викликати не треба.
//
// CH-06 юзер-кейс п.2-4: кожен блок-метрика переноситься ОКРЕМО, одразу по
// кліку "Перенести" в своєму рядку -- той самий патерн, що вже працює на
// звороті картки (CardBack.tsx "Перенести на іншу картку": select + кнопка,
// виклик injected onTransferMetricBlock одразу, без пакетного накопичення).
// Це свідомо ІНША модель взаємодії, ніж стара CloseCardDialog мала (там усі
// позначені перенесення йшли ОДНИМ пакетом разом із самим закриттям) -- CH-06
// п.5 "Архівувати без перенесення" підтверджує: сам архів більше не носить
// жодної метрик-логіки, вона вся вже сталась (чи ні) до цього кліку.
//
// Колізія назви при перенесенні (life-area-card AC-14/AC-15,
// metric_block.name_collision) тут БІЛЬШЕ НЕ ОБРОБЛЯЄТЬСЯ: генеричний
// onTransferMetricBlock (main.tsx) завжди або резолвиться, або кидає звичайну
// Error -- колізія (якщо станеться) виявляється й пропонується перейменувати
// пізніше, коли користувач відкриє КАРТКУ-ЦІЛЬ (CardBack.tsx's
// pendingTransferCollision/onRenameTransferredBlock), не тут.

import { useState } from 'react';
import { Banner, Button, Spinner } from '../../shared/ui';

export interface ArchiveCardDialogMetricBlock {
  metricBlockId: string;
  label: string;
}

export interface ArchiveCardDialogTargetCard {
  cardId: string;
  cardTitle: string;
}

export interface ArchiveCardDialogProps {
  /** Назва картки, що архівується -- лише для тексту діалогу (заголовок сторінки лишається "Архівування", CH-06 п.1). */
  cardTitle: string;
  metricBlocks: ArchiveCardDialogMetricBlock[];
  targetCards: ArchiveCardDialogTargetCard[];
  /**
   * CH-06: переносить ОДИН блок-метрику одразу по кліку "Перенести" в його
   * рядку -- той самий injected onTransferMetricBlock, що вже працює на
   * звороті картки. Опційний -- без нього рядок метрики показує лише назву,
   * без чекбокса/picker'а (той самий "без пропу афорданс не рендериться"
   * принцип, що CardBack.tsx's "Перенести на іншу картку").
   */
  onTransferMetricBlock?: (input: { metricBlockId: string; targetCardId: string }) => Promise<void>;
  /** CH-05: "Архівувати без перенесення" -- та сама injected archiveCard, що колода (CardFace/CardBack "..." -> "Архівувати"). */
  onArchive: () => Promise<void>;
  /** onArchive резолвився -- викликач сам вирішує, що робити далі (LayoutBoard: закрити діалог, перечитати розкладку). */
  onArchived: () => void;
  onCancel: () => void;
}

interface RowState {
  checked: boolean;
  targetCardId: string;
  transferring: boolean;
  transferred: boolean;
  error?: string;
}

function initialRows(metricBlocks: ArchiveCardDialogMetricBlock[]): Record<string, RowState> {
  return Object.fromEntries(
    metricBlocks.map((mb) => [mb.metricBlockId, { checked: false, targetCardId: '', transferring: false, transferred: false }])
  );
}

export function ArchiveCardDialog({
  metricBlocks,
  targetCards,
  onTransferMetricBlock,
  onArchive,
  onArchived,
  onCancel,
}: ArchiveCardDialogProps): JSX.Element {
  const [rows, setRows] = useState<Record<string, RowState>>(() => initialRows(metricBlocks));
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const patchRow = (id: string, patch: Partial<RowState>): void =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  // CH-06 п.4: зняв чекбокс -- форма скидається до вибору картки (обраний
  // targetCardId і будь-яка помилка попередньої спроби очищаються).
  const toggleChecked = (id: string): void => {
    const row = rows[id];
    if (row.checked) {
      patchRow(id, { checked: false, targetCardId: '', error: undefined });
    } else {
      patchRow(id, { checked: true });
    }
  };

  const setTarget = (id: string, targetCardId: string): void => patchRow(id, { targetCardId, error: undefined });

  // CH-06 п.3: клік "Перенести" в рядку -- переносить ЦЮ ОДНУ метрику одразу,
  // не чекаючи наступного кроку архівації (той самий "миттєвий" підхід, що
  // CardBack.tsx's handleTransferMetricBlock).
  const handleTransfer = (id: string): void => {
    const row = rows[id];
    if (!onTransferMetricBlock || !row || !row.targetCardId || row.transferring) return;
    patchRow(id, { transferring: true, error: undefined });
    onTransferMetricBlock({ metricBlockId: id, targetCardId: row.targetCardId })
      .then(() => patchRow(id, { transferring: false, transferred: true }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Не вдалося перенести метрику';
        patchRow(id, { transferring: false, error: message });
      });
  };

  // CH-06 п.5: "Архівувати без перенесення" -- сама архівація більше не несе
  // жодної метрик-логіки, перенесення (якщо було) вже сталось окремими
  // кліками "Перенести" вище.
  const handleArchive = (): void => {
    if (archiving) return;
    setArchiveError(null);
    setArchiving(true);
    onArchive()
      .then(() => onArchived())
      .catch((err: unknown) => {
        setArchiving(false);
        const message = err instanceof Error ? err.message : 'Не вдалося архівувати картку';
        setArchiveError(message);
      });
  };

  // Поки onArchive "у польоті" -- лише Spinner, той самий підхід, що стара
  // CloseCardDialog мала для "submitting".
  if (archiving) {
    return <Spinner />;
  }

  const actions = (
    <div className="flex justify-end gap-3">
      <button
        type="button"
        onClick={handleArchive}
        className="rounded-control border border-border bg-surface px-4 py-2.5 text-sm font-bold text-ink shadow-btn backdrop-blur-xl transition-colors enabled:hover:bg-border disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
      >
        Архівувати без перенесення
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-control border border-border px-4 py-2.5 text-sm font-bold text-ink transition-colors hover:bg-border"
      >
        Скасувати
      </button>
    </div>
  );

  if (metricBlocks.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {archiveError !== null && <Banner variant="error" text={archiveError} />}
        {actions}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {metricBlocks.map((mb) => {
        const row = rows[mb.metricBlockId];
        // Без onTransferMetricBlock (чи без жодної картки-цілі) переносити
        // нікуди -- рядок лишається просто назвою, без чекбокса, який нічого
        // б не робив (той самий "без пропу афорданс не рендериться"
        // принцип, що CardBack.tsx's "Перенести на іншу картку").
        const canTransfer = onTransferMetricBlock !== undefined && targetCards.length > 0;
        return (
          <div key={mb.metricBlockId} className="flex flex-col gap-2 rounded-control border border-border bg-surface-solid p-3">
            <div className="flex items-center gap-2.5">
              {canTransfer && (
                <label className="inline-flex items-center">
                  <input
                    type="checkbox"
                    aria-label="Перенести"
                    checked={row.checked}
                    disabled={row.transferred}
                    onChange={() => toggleChecked(mb.metricBlockId)}
                    className="h-4 w-4 accent-ink"
                  />
                </label>
              )}
              <span className="text-sm font-medium text-ink">{mb.label}</span>
              {row.transferred && <span className="text-xs font-semibold text-good">Перенесено</span>}
            </div>
            {canTransfer && row.checked && !row.transferred && (
              <div className="flex flex-col gap-1.5 pl-6">
                <select
                  aria-label={`Куди перенести «${mb.label}»`}
                  value={row.targetCardId}
                  onChange={(event) => setTarget(mb.metricBlockId, event.target.value)}
                  className="rounded-control border border-border bg-surface-solid px-3.5 py-2.5 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/15"
                >
                  <option value="">--</option>
                  {targetCards.map((card) => (
                    <option key={card.cardId} value={card.cardId}>
                      {card.cardTitle}
                    </option>
                  ))}
                </select>
                {/* CH-06 п.2: кнопка "Перенести" зʼявляється лише після вибору картки-цілі. */}
                {row.targetCardId !== '' && (
                  <Button
                    label={row.transferring ? 'Переноситься…' : 'Перенести'}
                    onClick={() => handleTransfer(mb.metricBlockId)}
                    disabled={row.transferring}
                  />
                )}
                {row.error !== undefined && <Banner variant="error" text={row.error} />}
              </div>
            )}
          </div>
        );
      })}

      {archiveError !== null && <Banner variant="error" text={archiveError} />}

      {actions}
    </div>
  );
}
