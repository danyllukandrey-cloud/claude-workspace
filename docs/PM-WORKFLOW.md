# PM-WORKFLOW — потік команд для відслідковування прогресу

Короткий покажчик: коли яку команду вводити і що вона робить. Повні інструкції
живуть у файлах-джерелах (посилання в таблиці нижче) — тут навмисно без
дублювання тексту, лише карта потоку.

## Потік одного дня

```
git pull
   ↓
post-merge (хук) друкує підказку
   ↓
/session-brief   → статус: % по фазах + блокери (тільки читає, нічого не пише)
   ↓
   ... робота, git commit (commit-msg перевіряє мітку Decision:) ...
   ↓
git push
   ↓
pre-push (хук) питає [y/N]: запустити /pm-end?
   ├─ "так" → push зупинено → зайти в Claude Code → /pm-end → звірка → push ще раз
   └─ "ні"  → push іде одразу, без зупинки
```

Окремо, не прив'язано до git-подій: **`/pm-start`** — план на сьогодні, вводиш
вручну, коли він потрібен.

## Команди й хуки — покажчик

| Виклик | Тип | Що робить | Джерело |
|---|---|---|---|
| `/session-brief` | skill | статичний статус: % по фазах + блокери | [SKILL.md](../.claude/skills/session-brief/SKILL.md) |
| `/pm-start` | agent `pm`, режим daily | план на сьогодні, пріоритети | [pm.md](../.claude/agents/pm.md) · [pm-start.md](../.claude/commands/pm-start.md) |
| `/pm-end` | agent `pm`, режим sync | звіряє `git log` з `DECISIONS.md`/`DELIVERY-PLAN.md`, пропонує правки — записує лише після "+" | [pm.md](../.claude/agents/pm.md) · [pm-end.md](../.claude/commands/pm-end.md) |
| `post-merge` (git hook) | нагадування, нічого не блокує | після `git pull` підказує `/session-brief` | [.githooks/post-merge](../.githooks/post-merge) |
| `pre-push` (git hook) | інтерактивний гейт | перед `git push` питає про `/pm-end`, на "так" зупиняє push | [.githooks/pre-push](../.githooks/pre-push) |
| `commit-msg` (git hook) | перевірка, блокує | не пропускає коміт без мітки `Decision:` | [.githooks/commit-msg](../.githooks/commit-msg) |

## Пов'язані документи

- [DELIVERY-PLAN.md](DELIVERY-PLAN.md) — те, що показує `/session-brief` і звіряє `/pm-end`
- [DECISIONS.md](DECISIONS.md) — реєстр рішень, з ним теж звіряється `/pm-end`
- [.githooks/README.md](../.githooks/README.md) — технічні деталі хуків (чому саме такі назви, як увімкнути)
- [CLAUDE.md](../CLAUDE.md) — загальні правила роботи в проєкті
