// SCR-04 — Закрити напрямок (screens.md, T23), spec.md AC-12.
//
// DI (plan/app/CLAUDE.md, той самий стиль, що LayoutBoard/DeclarationScreen):
// `onClose` мапиться 1:1 на POST /structure/layout/{cardId} (closeCard,
// contracts/openapi.yaml) -- сам fetch() лишається за ports/. Пропси
// відповідають app/close-card.ts's CloseCardInput/CloseCardMetricTransfer
// мінус ownerUserId/cardId (ті належать ports/http-шару, не цьому компоненту).
//
// screens.md стани:
// - default: на кожен метрик-блок -- Toggle "перенести" + CardPicker
//   (<select>) з'являється лише коли Toggle увімкнено -- немає сенсу
//   показувати вибір картки для метрики, яку не переносять.
// - empty: metricBlocks=[] -- лише кнопка "Закрити без переносу", без рядків.
// - validation: Toggle увімкнено, targetCardId не вибрано -- inline помилка
//   під CardPicker, onClose НЕ викликається (клієнтська перевірка, без
//   зайвого round-trip).
// - rename-needed: onClose відхиляється з life-area-card's AC-15 кодом
//   `metric_block.name_collision` (409, transfer-metric-block.ts) -- TextField
//   для нової назви + Banner, "Продовжити" повторює onClose з newLabel.
// - error: onClose відхиляється з `structure.metric_transfer_target_invalid`
//   (422, closeCard) -- Banner variant="error", ніколи alert/toast
//   (design-system.md "errors inline, never alert/confirm").
// - success: onClose резолвиться -- onClosed() сигналізує завершення;
//   повернення на SCR-02 -- відповідальність викликача, не цього діалогу.
//
// Accessible-name нюанс: чекбокс отримує узагальнений aria-label
// ("Перенести"), а не текст мітки метрики -- інакше getByLabelText(<мітка>)
// у тестах знаходив би і чекбокс, і <select> одночасно (обидва містять би
// назву метрики в accessible name) і кидав "multiple elements". Видима назва
// метрики -- окремий <span>, не всередині <label> чекбокса.

import { useState } from 'react';
import { Banner, Spinner, TextField } from '../../shared/ui';

export interface CloseCardDialogMetricBlock {
  metricBlockId: string;
  label: string;
}

export interface CloseCardDialogTargetCard {
  cardId: string;
  cardTitle: string;
}

export interface CloseCardMetricTransferInput {
  metricBlockId: string;
  targetCardId: string;
  newLabel?: string;
}

export interface CloseCardDialogProps {
  /** Назва картки, що закривається -- лише для тексту діалогу (тут не рендериться напряму, але лишається у пропсах для викликача). */
  cardTitle: string;
  metricBlocks: CloseCardDialogMetricBlock[];
  targetCards: CloseCardDialogTargetCard[];
  /** Мапиться 1:1 на POST /structure/layout/{cardId}. Кидає AppError-подібну помилку (code/httpStatus) при відмові сервера. */
  onClose: (input: { metricTransfers: CloseCardMetricTransferInput[] }) => Promise<void>;
  /** onClose резолвився -- викликач сам вирішує, що робити далі (screens.md: повернення на SCR-02). */
  onClosed: () => void;
  onCancel: () => void;
}

interface RowState {
  transferring: boolean;
  targetCardId: string;
  newLabel: string;
}

interface AppErrorShape {
  message: string;
  code: unknown;
}

// Duck-typing замість `instanceof AppError` -- той самий підхід, що
// LayoutBoard.tsx/DeclarationScreen.tsx.
function isAppErrorShape(err: unknown): err is AppErrorShape {
  return typeof err === 'object' && err !== null && 'code' in err && 'message' in err;
}

export function CloseCardDialog({
  metricBlocks,
  targetCards,
  onClose,
  onClosed,
  onCancel,
}: CloseCardDialogProps): JSX.Element {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      metricBlocks.map((mb) => [mb.metricBlockId, { transferring: false, targetCardId: '', newLabel: '' }])
    )
  );
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [needsRename, setNeedsRename] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const toggleTransfer = (id: string): void =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], transferring: !prev[id].transferring } }));

  const setTarget = (id: string, targetCardId: string): void =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], targetCardId } }));

  const setNewLabel = (id: string, newLabel: string): void =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], newLabel } }));

  const buildTransfers = (): CloseCardMetricTransferInput[] =>
    Object.entries(rows)
      .filter(([, row]) => row.transferring)
      .map(([metricBlockId, row]) => ({
        metricBlockId,
        targetCardId: row.targetCardId,
        ...(row.newLabel ? { newLabel: row.newLabel } : {}),
      }));

  const submit = (): void => {
    if (submitting) return;

    const errors: Record<string, string> = {};
    for (const [id, row] of Object.entries(rows)) {
      if (row.transferring && !row.targetCardId) {
        errors[id] = 'Оберіть картку-призначення для цієї метрики';
      }
    }
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setError(null);
    setSubmitting(true);
    onClose({ metricTransfers: buildTransfers() })
      .then(() => {
        setNeedsRename(false);
        onClosed();
      })
      .catch((err: unknown) => {
        if (isAppErrorShape(err) && err.code === 'metric_block.name_collision') {
          setNeedsRename(true);
          setError(err.message);
        } else {
          setNeedsRename(false);
          const message = isAppErrorShape(err)
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Не вдалося закрити картку';
          setError(message);
        }
      })
      .finally(() => setSubmitting(false));
  };

  // Поки onClose "у польоті" -- рендериться лише Spinner (без рядків/кнопок).
  // Це та мить, коли клієнтська валідація вже пройшла й запит пішов на
  // сервер -- тестам достатньо дочекатись будь-якого стабільного тексту тут
  // без прив'язки до фінального стану (успіх/rename-needed/error).
  if (submitting) {
    return <Spinner />;
  }

  if (metricBlocks.length === 0) {
    return (
      <div>
        {error !== null && <Banner variant="error" text={error} />}
        <button type="button" onClick={submit} disabled={submitting}>
          Закрити без переносу
        </button>
        <button type="button" onClick={onCancel}>
          Скасувати
        </button>
      </div>
    );
  }

  return (
    <div>
      {metricBlocks.map((mb) => {
        const row = rows[mb.metricBlockId];
        return (
          <div key={mb.metricBlockId}>
            <label>
              <input
                type="checkbox"
                aria-label="Перенести"
                checked={row.transferring}
                onChange={() => toggleTransfer(mb.metricBlockId)}
              />
            </label>
            <span>{mb.label}</span>
            {row.transferring && (
              <div>
                <select
                  aria-label={`Куди перенести «${mb.label}»`}
                  value={row.targetCardId}
                  onChange={(event) => setTarget(mb.metricBlockId, event.target.value)}
                >
                  <option value="">--</option>
                  {targetCards.map((card) => (
                    <option key={card.cardId} value={card.cardId}>
                      {card.cardTitle}
                    </option>
                  ))}
                </select>
                {validationErrors[mb.metricBlockId] !== undefined && (
                  <p role="alert">{validationErrors[mb.metricBlockId]}</p>
                )}
                {needsRename && (
                  <TextField
                    label="Нова назва блоку (перенесено)"
                    value={row.newLabel}
                    onChange={(value) => setNewLabel(mb.metricBlockId, value)}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      {error !== null && <Banner variant="error" text={error} />}

      <button type="button" onClick={submit} disabled={submitting}>
        {needsRename ? 'Продовжити' : 'Закрити'}
      </button>
      <button type="button" onClick={onCancel}>
        Скасувати
      </button>
    </div>
  );
}
