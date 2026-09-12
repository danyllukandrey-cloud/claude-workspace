// Типи для чат-компонентів SCR-01 (T25) -- навмисно локальні для ui/chat, а не
// імпорт з domain: жоден domain-файл агента ще не написаний (T8-T10 "todo" у
// tracker.md, T25 в tasks.json не залежить від них -- deps: []). Форма полів
// узгоджена з contracts/openapi.yaml (Message/Proposal schemas), camelCase --
// той самий підхід, що вже в MessageTurn/Proposal контракту.
//
// Коли з'явиться domain/proposal.ts (T8) і реальний ports-шар (T20/T21),
// відповідність цих типів контракту звіряється там -- тут лише presentation
// потреба SCR-01.

export interface ChatMessage {
  /** `crypto.randomUUID()` на бекенді (§2 Conventions, sad.md). */
  id: string;
  role: 'user' | 'agent';
  content: string;
  createdAt: string;
}

export interface ChatProposal {
  id: string;
  /** Людський опис пропозиції, показаний користувачу (data-model.md `agent_proposal.proposed_summary`). */
  proposedSummary: string;
}
