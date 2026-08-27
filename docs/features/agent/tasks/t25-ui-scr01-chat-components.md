---
id: T25
title: "UI: SCR-01 chat components (MessageList, MessageBubble, ProposalCard, Composer)"
layer: "ui"
deps: []
acs: ["AC-01", "AC-02", "AC-10"]
files_hint: ["plan/app/src/agent/ui/chat/"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T25 — UI: SCR-01 chat components

## Why

Будівельні блоки чат-екрана — [`screens.md` SCR-01](../screens.md#scr-01--чат), `§New components` (`MessageList`/`MessageBubble`/`ProposalCard`/`Composer`).

## What

Чотири нові компоненти: прокручуваний список повідомлень, одне повідомлення (роль user/agent), картка пропозиції з діями «Підтвердити»/«Уточнити», поле вводу тексту + прикріплення фото + надсилання.

## Definition of Done

- [ ] Component test: `MessageList` рендерить порожній і заповнений список
- [ ] Component test: `ProposalCard` рендерить кнопки дій і `proposedSummary`
- [ ] Component test: `Composer` приймає текст, вкладення, або обидва
- [ ] Зареєстровано в `docs/design-system.md` §Component inventory
- [ ] lint + vet clean

## Notes

Не переюзані з `structure` — специфічно для природи чат-даних (`CardShell`, що перевертається, тут не підходить).
