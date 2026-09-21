// Публічний вхід Структури (index.ts) -- правило залежностей (plan/app/CLAUDE.md):
// решта проєкту імпортує Структуру ТІЛЬКИ звідси, ніколи напряму з ui/.
//
// Review 2026-09-11 (MUST-FIX 4): SCR-04 (тепер ArchiveCardDialog, CH-05/CH-06)
// був написаний і покритий власним тестом, але НЕ експортований з index.ts і
// не підключений ніде -- 0 використань поза власним тестом, тож AC-12
// ("система питає по кожній метриці картки, що архівується, чи перенести її
// в іншу") був недосяжний користувачу. Цей тест пінить саму досяжність: не
// "символ експортовано", а що через публічні двері модуля приходить
// СПРАВЖНІЙ діалог із рядками метрик, а не заглушка.

import { render, screen } from '@testing-library/react';
import { ArchiveCardDialog } from './index';

test('публічний вхід Структури віддає робочий ArchiveCardDialog (SCR-04, AC-12)', () => {
  render(
    <ArchiveCardDialog
      cardTitle="Навчання (дубль)"
      metricBlocks={[
        { metricBlockId: 'mb-1', label: 'книги' },
        { metricBlockId: 'mb-2', label: 'курси' },
      ]}
      targetCards={[{ cardId: 'card-navchannia', cardTitle: 'Навчання' }]}
      onTransferMetricBlock={vi.fn().mockResolvedValue(undefined)}
      onArchive={vi.fn().mockResolvedValue(undefined)}
      onArchived={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  // Рядок на кожну метрику з чекбоксом переносу -- саме те, чого вимагає AC-12.
  expect(screen.getByText('книги')).toBeTruthy();
  expect(screen.getByText('курси')).toBeTruthy();
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
});
