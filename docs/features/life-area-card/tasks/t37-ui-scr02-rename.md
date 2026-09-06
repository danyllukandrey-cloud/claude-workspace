---
id: T37
title: "UI: SCR-02 rename state (inline edit)"
layer: "ui"
deps: ["T24", "T21"]
acs: ["AC-19"]
files_hint: ["plan/app/src/cards/life-area-card/ui/CardFace.tsx"]
owner: "TBD"
estimate: "S"
status: "done"
---

# T37 — UI: SCR-02 rename state (inline edit)

## Why

[screens.md SCR-02 стан `rename`](../screens.md#scr-02--картка-лицьова-сторона).

## What

Меню «...» → «Перейменувати» → назва редагована inline (той самий компонент `CardFace.tsx`, T26, новий стан — не новий файл). Зберегти викликає `updateCard` (T21, `name` уже в контракті — новий ендпоінт не потрібен).

## Definition of Done

- [x] Component test: рендерить стан `rename` per screens.md SCR-02
- [x] Component test: «Зберегти» оновлює назву в колоді й викликає ін'єктований `onRename`; «Скасувати» відкидає зміну без виклику ([ISS-41](../../../ISSUES.md): пункт «пише подію в Літопис Структури» дескоуплено — сервіс не існує жодним рядком коду, [ISS-28](../../../ISSUES.md); TODO-коментар на майбутній виклик лишено в `CardFace.tsx`)
- [x] lint + vet clean (`npx tsc --noEmit` чисто)
