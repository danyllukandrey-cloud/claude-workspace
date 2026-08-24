---
id: T4
title: "Domain: declaration + layout core models"
layer: "domain"
deps: []
acs: ["AC-09", "AC-10", "AC-11", "AC-11b"]
files_hint: ["plan/app/src/structure/domain/declaration.ts", "plan/app/src/structure/domain/layout.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T4 — Domain: declaration + layout core models

## Why

Чиста доменна логіка (нуль I/O), окремо від Опису картки — [sad.md §5](../sad.md#5-building-block-view), AC-09/10/11/11b.

## What

`declaration.ts` — модель декларації (вільний текст, ніколи не змішується з полями картки). `layout.ts` — enum трьох способів (`single`/`free`/`logic`), правило «`layoutMode: null` = ще не обрано», правило дефолтної позиції для нової картки (AC-09), і план «скинути всі позиції в базовий порядок» при зміні способу (AC-11b) — **план**, застосування плану до реальних рядків БД — T11 (app-шар).

## Definition of Done

- [ ] Unit test: декларація ніколи не зливається з полем `description` картки (структурна перевірка типів, не лише рантайм)
- [ ] Unit test: `layoutMode = null` — валідний стан, не помилка
- [ ] Unit test: функція «план скидання» повертає базовий порядок для довільного набору активних позицій, детерміновано (той самий вхід → той самий порядок)
- [ ] Unit test: нова картка без обраного способу отримує дефолтну клітинку без винятку
- [ ] lint + vet clean

## Notes

Правило залежностей ([`plan/app/CLAUDE.md`](../../../../plan/app/CLAUDE.md)): `domain` не імпортує React, `localStorage`, Tailwind — чисті функції.
