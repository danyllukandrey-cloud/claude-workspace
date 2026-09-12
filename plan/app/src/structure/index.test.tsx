// Публічний вхід Структури (index.ts) -- правило залежностей (plan/app/CLAUDE.md):
// решта проєкту імпортує Структуру ТІЛЬКИ звідси, ніколи напряму з ui/.
//
// Review 2026-09-11 (MUST-FIX 4): SCR-04 (CloseCardDialog) був написаний і
// покритий власним тестом, але НЕ експортований з index.ts і не підключений
// ніде -- 0 використань поза власним тестом, тож AC-12 ("система питає по
// кожній метриці картки, що закривається, чи перенести її в іншу") був
// недосяжний користувачу. Цей тест пінить саму досяжність: не "символ
// експортовано", а що через публічні двері модуля приходить СПРАВЖНІЙ діалог
// із рядками метрик, а не заглушка.

import { render, screen } from '@testing-library/react';
import { CloseCardDialog } from './index';

test('публічний вхід Структури віддає робочий CloseCardDialog (SCR-04, AC-12)', () => {
  render(
    <CloseCardDialog
      cardTitle="Навчання (дубль)"
      metricBlocks={[
        { metricBlockId: 'mb-1', label: 'книги' },
        { metricBlockId: 'mb-2', label: 'курси' },
      ]}
      targetCards={[{ cardId: 'card-navchannia', cardTitle: 'Навчання' }]}
      onClose={vi.fn().mockResolvedValue(undefined)}
      onClosed={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  // Рядок на кожну метрику з перемикачем переносу -- саме те, чого вимагає AC-12.
  expect(screen.getByText('книги')).toBeTruthy();
  expect(screen.getByText('курси')).toBeTruthy();
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
});
