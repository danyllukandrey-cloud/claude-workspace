import { render, screen, fireEvent } from '@testing-library/react';
import { ProposalCard } from './ProposalCard';

test('ProposalCard рендерить proposedSummary і кнопки Підтвердити/Уточнити (AC-01/AC-02)', () => {
  const onConfirm = vi.fn();
  const onRefine = vi.fn();

  render(
    <ProposalCard
      proposedSummary='записати в картку "Спорт", 5 км?'
      onConfirm={onConfirm}
      onRefine={onRefine}
    />,
  );

  expect(screen.getByText('записати в картку "Спорт", 5 км?')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Підтвердити' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Уточнити' })).toBeTruthy();
});

test('ProposalCard викликає onConfirm при кліку на "Підтвердити" (AC-02 -- запис лише після явного підтвердження)', () => {
  const onConfirm = vi.fn();
  const onRefine = vi.fn();

  render(<ProposalCard proposedSummary="5 км?" onConfirm={onConfirm} onRefine={onRefine} />);

  fireEvent.click(screen.getByRole('button', { name: 'Підтвердити' }));

  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onRefine).not.toHaveBeenCalled();
});

test('ProposalCard викликає onRefine при кліку на "Уточнити", без запису (AC-02b)', () => {
  const onConfirm = vi.fn();
  const onRefine = vi.fn();

  render(<ProposalCard proposedSummary="5 км?" onConfirm={onConfirm} onRefine={onRefine} />);

  fireEvent.click(screen.getByRole('button', { name: 'Уточнити' }));

  expect(onRefine).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});
