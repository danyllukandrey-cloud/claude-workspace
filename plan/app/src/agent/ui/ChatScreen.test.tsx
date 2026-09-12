// T26 -- SCR-01 Чат screen (screens.md), spec.md AC-01/02/02b/03/04/05/09/10/
// 10b/13/15. Component test: default/empty-onboarding/loading/proposal-
// pending/confirmed/clarifying/attachment-error/rate-limited/llm-unavailable
// (tasks.json T26 DoD -- confirmed-hint deliberately excluded, T47 adds it).

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChatScreen } from './ChatScreen';
import type { ChatMessage, ChatProposal } from './chat/types';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'пробіг 5 км',
    createdAt: '2026-09-12T10:00:00.000Z',
    ...overrides,
  };
}

function proposal(overrides: Partial<ChatProposal> = {}): ChatProposal {
  return { id: 'proposal-1', proposedSummary: 'Спорт: 5 км', ...overrides };
}

function baseProps(overrides: Partial<Parameters<typeof ChatScreen>[0]> = {}) {
  return {
    loadHistory: vi.fn().mockResolvedValue([]),
    loadOnboarding: vi.fn().mockResolvedValue({ welcomeShown: true, message: null }),
    loadActiveProposal: vi.fn().mockResolvedValue(null),
    sendMessage: vi.fn(),
    confirmProposal: vi.fn(),
    ...overrides,
  };
}

describe('ChatScreen -- loading', () => {
  it('shows a spinner while the initial GET /messages + /onboarding + /proposals/active are in flight', () => {
    const props = baseProps({
      loadHistory: vi.fn(() => new Promise<ChatMessage[]>(() => {})),
    });
    render(<ChatScreen {...props} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});

describe('ChatScreen -- empty-onboarding (AC-13)', () => {
  it("renders the agent's welcome message when this is the first-ever visit and history is empty", async () => {
    const welcome = message({ id: 'welcome-1', role: 'agent', content: 'Привіт! Я допомагаю вести картину життя.' });
    const props = baseProps({
      loadHistory: vi.fn().mockResolvedValue([]),
      loadOnboarding: vi.fn().mockResolvedValue({ welcomeShown: true, message: welcome }),
    });

    render(<ChatScreen {...props} />);

    await waitFor(() => expect(screen.getByText(welcome.content)).toBeTruthy());
  });
});

describe('ChatScreen -- default (history loaded, no active proposal)', () => {
  it('renders the message history via MessageList', async () => {
    const props = baseProps({
      loadHistory: vi.fn().mockResolvedValue([
        message({ id: 'm1', role: 'user', content: 'пробіг 5 км' }),
        message({ id: 'm2', role: 'agent', content: 'записано ✓ Спорт: 5 км' }),
      ]),
    });

    render(<ChatScreen {...props} />);

    await waitFor(() => expect(screen.getByText('пробіг 5 км')).toBeTruthy());
    expect(screen.getByText('записано ✓ Спорт: 5 км')).toBeTruthy();
  });
});

describe('ChatScreen -- clarifying (AC-04/AC-05, no proposal)', () => {
  it("renders the agent's clarifying question as a plain message, with no ProposalCard", async () => {
    const props = baseProps({
      loadHistory: vi.fn().mockResolvedValue([
        message({ id: 'm1', role: 'user', content: 'прочитав книгу' }),
        message({ id: 'm2', role: 'agent', content: 'яку саме картку ти маєш на увазі?' }),
      ]),
    });

    render(<ChatScreen {...props} />);

    await waitFor(() => expect(screen.getByText('яку саме картку ти маєш на увазі?')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Підтвердити' })).not.toBeTruthy();
  });
});

describe('ChatScreen -- proposal-pending (AC-01/AC-02/AC-10)', () => {
  it('renders a ProposalCard when an active proposal exists', async () => {
    const props = baseProps({
      loadActiveProposal: vi.fn().mockResolvedValue(proposal()),
    });

    render(<ChatScreen {...props} />);

    await waitFor(() => expect(screen.getByText('Спорт: 5 км')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Підтвердити' })).toBeTruthy();
  });

  it('sending a message that returns a fresh proposal shows the ProposalCard without a reload', async () => {
    const props = baseProps({
      sendMessage: vi.fn().mockResolvedValue({ reply: 'записати в картку "Спорт", 5 км?', proposal: proposal() }),
    });

    render(<ChatScreen {...props} />);
    await waitFor(() => expect(props.loadHistory).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Повідомлення'), { target: { value: 'пробіг 5 км' } });
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));

    await waitFor(() => expect(screen.getByText('Спорт: 5 км')).toBeTruthy());
    expect(screen.getByText('записати в картку "Спорт", 5 км?')).toBeTruthy();
  });
});

describe('ChatScreen -- confirmed (AC-02)', () => {
  it('confirming the active proposal clears the ProposalCard and shows a synthesized confirmation bubble', async () => {
    const props = baseProps({
      loadActiveProposal: vi.fn().mockResolvedValue(proposal()),
      confirmProposal: vi.fn().mockResolvedValue(undefined),
    });

    render(<ChatScreen {...props} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Підтвердити' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Підтвердити' }));

    await waitFor(() => expect(props.confirmProposal).toHaveBeenCalledWith('proposal-1'));
    expect(screen.queryByRole('button', { name: 'Підтвердити' })).not.toBeTruthy();
    expect(screen.getByText(/записано ✓ Спорт: 5 км/)).toBeTruthy();
  });
});

describe('ChatScreen -- error banners (AC-10b/AC-19b, §8 rate limit, sad.md §6 Flow 2)', () => {
  it('shows an attachment-unrecognized banner (422) without losing the typed text', async () => {
    const props = baseProps({
      sendMessage: vi.fn().mockRejectedValue({ code: 'agent.attachment_unrecognized', message: 'Не вдалося розпізнати вкладення' }),
    });
    render(<ChatScreen {...props} />);
    await waitFor(() => expect(props.loadHistory).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Повідомлення'), { target: { value: 'ось фото' } });
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));

    await waitFor(() => expect(screen.getByText('Не вдалося розпізнати вкладення')).toBeTruthy());
  });

  it('shows a rate-limited banner (429)', async () => {
    const props = baseProps({
      sendMessage: vi.fn().mockRejectedValue({ code: 'agent.rate_limited', message: 'Забагато повідомлень, спробуй пізніше' }),
    });
    render(<ChatScreen {...props} />);
    await waitFor(() => expect(props.loadHistory).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Повідомлення'), { target: { value: 'ще одне' } });
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));

    await waitFor(() => expect(screen.getByText('Забагато повідомлень, спробуй пізніше')).toBeTruthy());
  });

  it('shows an llm-unavailable banner (503, sad.md §6 Flow 2) without dropping the typed text', async () => {
    const props = baseProps({
      sendMessage: vi.fn().mockRejectedValue({ code: 'agent.llm_unavailable', message: 'Агент тимчасово недоступний' }),
    });
    render(<ChatScreen {...props} />);
    await waitFor(() => expect(props.loadHistory).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Повідомлення'), { target: { value: 'пробіг 5 км' } });
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));

    await waitFor(() => expect(screen.getByText('Агент тимчасово недоступний')).toBeTruthy());
  });
});
