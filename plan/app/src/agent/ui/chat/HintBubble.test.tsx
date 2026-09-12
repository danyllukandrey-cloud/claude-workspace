import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HintBubble } from './HintBubble';

describe('HintBubble (T47, AC-16/AC-16b)', () => {
  it('renders the given static hint text', () => {
    render(<HintBubble text="Звертайся до Агента щоразу, коли маєш запитання" onDismiss={vi.fn()} />);
    expect(screen.getByText('Звертайся до Агента щоразу, коли маєш запитання')).toBeTruthy();
  });

  it('calls onDismiss when the ✕ button is clicked (AC-16b)', () => {
    const onDismiss = vi.fn();
    render(<HintBubble text="підказка" onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'Закрити підказку' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
