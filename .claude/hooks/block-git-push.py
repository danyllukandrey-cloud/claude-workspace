#!/usr/bin/env python
"""Блокує будь-який `git push`, у якому б місці команди він не стояв.

Навіщо: правила permissions у settings.json порівнюються з ПОЧАТКОМ команди.
Складена команда `cd кудись && git push` починається з `cd`, тому правило
`Bash(git push*)` її пропускає. Цей hook дивиться на весь текст.

Як працює: Claude Code передає сюди JSON на stdin перед запуском Bash.
Розбиваємо команду на сегменти (; && || |), у кожному шукаємо виклик git
і визначаємо підкоманду. Якщо підкоманда — push, повертаємо рішення deny.

Рішення D-14. Деталі — docs/PROJECT-STATE.md §13.12.
"""

import json
import re
import shlex
import sys

# Опції git, що йдуть ПЕРЕД підкомандою і забирають наступне слово як значення.
OPTS_WITH_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}

BLOCKED = "push"


def segments(command):
    """Розрізати командний рядок на окремі виклики."""
    return re.split(r"&&|\|\||[;|\n]", command)


def subcommand_after_git(tokens):
    """Знайти підкоманду git у списку токенів. Повертає її або None."""
    for i, token in enumerate(tokens):
        # `git` або шлях, що ним закінчується (/usr/bin/git, git.exe)
        if token != "git" and not re.search(r"[\\/]git(\.exe)?$", token):
            continue
        j = i + 1
        while j < len(tokens):
            t = tokens[j]
            if t in OPTS_WITH_VALUE:
                j += 2
                continue
            if t.startswith("-"):
                j += 1
                continue
            return t
        return None
    return None


def is_blocked(command):
    for segment in segments(command):
        try:
            tokens = shlex.split(segment)
        except ValueError:
            tokens = segment.split()
        if subcommand_after_git(tokens) == BLOCKED:
            return True
    return False


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0

    command = (payload.get("tool_input") or {}).get("command") or ""

    if is_blocked(command):
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    "git push виконує тільки Андрій (рішення D-14). "
                    "Клод доводить роботу до коміту й повідомляє, що готово "
                    "до відправки."
                ),
            }
        }))  # ensure_ascii за замовчуванням: кирилиця йде як \uXXXX,
        # інакше консоль Windows перекручує вивід своїм кодуванням

    return 0


if __name__ == "__main__":
    sys.exit(main())
