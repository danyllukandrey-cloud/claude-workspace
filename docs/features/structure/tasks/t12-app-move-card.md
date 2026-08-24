---
id: T12
title: "App: moveCard use-case"
layer: "app"
deps: ["T4", "T5", "T9", "T10"]
acs: ["AC-02", "AC-08", "AC-15"]
files_hint: ["plan/app/src/structure/app/"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T12 — App: moveCard use-case

## Why

[sad.md Потік 2](../sad.md#6-runtime-view) — переміщення картки, конфлікт, подія літопису.

## What

Use-case: перевіряє власника картки (AC-03 — 404 для чужої/неіснуючої, не 403), перевіряє колізію клітинки (T5, AC-02), зберігає позицію (T9), вирішує конфлікт часової мітки за LWW (T5), пише подію `moved` через T10 (AC-15).

## Definition of Done

- [ ] Integration test: успішне переміщення на вільну клітинку записує позицію й подію `moved`
- [ ] Integration test: колізія в розкладці «за логікою» відхиляється з кодом `structure.cell_occupied`, подія літопису НЕ пишеться
- [ ] Integration test: конфліктна пізніша мітка часу перемагає (ADR-0002)
- [ ] lint + vet clean

## Notes

`cardId`, що не належить власнику Структури, — та сама відповідь 404, що й «не існує» (AC-03 non-disclosure) — не 403.
