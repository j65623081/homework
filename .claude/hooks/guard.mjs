#!/usr/bin/env node
/**
 * PreToolUse-страж проекта Notes API.
 *
 * Зачем он нужен поверх списка `deny` в settings.json.
 * `deny` — это шаблон на строку команды. Запрет `Bash(cat .env)` не останавливает
 *   node -e "console.log(require('fs').readFileSync('.env','utf8'))"
 * потому что строка другая, а цель та же. Этот хук смотрит не на глагол, а на цель:
 * он ищет в команде упоминание защищённого объекта, каким бы способом до него
 * ни добирались.
 *
 * Честная граница. Это не песочница. Хук поднимает стоимость обхода, но не делает
 * его невозможным: склейка строк ('.e'+'nv'), кодирование пути в base64 или чтение
 * через процесс, запущенный не Bash-инструментом, — не ловятся. Настоящая изоляция —
 * уровнем ниже (песочница ОС, контейнер), и это проверяется отдельным шагом задания.
 *
 * Протокол: на stdin — JSON события PreToolUse, выход 0 — пропустить,
 * выход 2 — заблокировать, причина в stderr.
 */

import { readFileSync } from 'node:fs';

/** Сессии ДЗ №1 закрыты и правке не подлежат: журнал только дополняется.
 *  Закрывая сессию, добавьте её номер сюда — это и есть акт закрытия. */
const CLOSED_SESSIONS = [1, 2, 3, 4, 5];

/** Секреты. Ищутся как цель, а не как аргумент конкретной утилиты. */
const SECRET_TARGETS = [
  /(^|[^\w.-])\.env(?!\.example)([^\w-]|$)/i,
  /\.pem([^\w-]|$)/i,
  /\.key([^\w-]|$)/i,
  /id_rsa/i,
  /\.ssh[\/\\]/i,
  /credentials?\.json/i,
];

/** Необратимое. Здесь важно именно совпадение по смыслу команды. */
const DESTRUCTIVE = [
  [/\brm\s+(-\w*[rf]\w*\s+)+/i, 'рекурсивное или принудительное удаление'],
  [/\bgit\s+reset\s+--hard/i, 'git reset --hard'],
  [/\bgit\s+push\s+(--force|-f)\b/i, 'git push --force'],
  [/\bgit\s+clean\b/i, 'git clean'],
  [/\bgit\s+filter-branch\b/i, 'git filter-branch'],
  [/\bRemove-Item\b[^|]*-Recurse/i, 'Remove-Item -Recurse'],
  [/\brmdir\s+\/s/i, 'rmdir /s'],
];

/** Запрещено условиями задания №1 и остаётся запрещённым. */
const FORBIDDEN_BY_TASK = [
  [/\bcomposer\s+(require|remove|update)\b/i, 'изменение зависимостей composer'],
  [/\bnpm\s+(install|i|add)\b/i, 'установка npm-зависимостей'],
  [/\bphp\s+artisan\s+(migrate|db:)/i, 'миграции и обращения к БД'],
  [/\bdocker(-compose)?\b/i, 'Docker'],
];

/** Комплект занятия и журнал. Уходят в сдачу нетронутыми. */
const IMMUTABLE_PATHS = [
  [/homework\.pdf/i, 'homework.pdf — комплект занятия'],
  [/(^|[\/\\])materials[\/\\]/i, 'materials/ — комплект занятия'],
  [/(^|[\/\\])naive[\/\\]/i, 'naive/ — наивный прогон, восстановить его нельзя'],
];

const MUTATING_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit']);

/** Признаки того, что Bash-команда что-то пишет или удаляет, а не читает. */
const BASH_MUTATION = /(\brm\b|\bmv\b|\bdel\b|Remove-Item|Set-Content|Add-Content|Out-File|\bsed\s+-i|\btee\b|>>?[^>]|\bgit\s+rm\b|\btruncate\b)/i;

function deny(reason) {
  process.stderr.write(
    `ЗАБЛОКИРОВАНО PreToolUse-хуком проекта (.claude/hooks/guard.mjs)\n\n` +
    `${reason}\n\n` +
    `Это механизм, а не пожелание: подобрать другую команду для той же цели не получится.\n` +
    `Если запрет мешает по делу — это вопрос человеку. Ослаблять хук, чтобы прошёл шаг,\n` +
    `правила проекта запрещают отдельным пунктом (AGENTS.md, «Механизм сильнее текста»).\n`
  );
  process.exit(2);
}

let event;
try {
  event = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0); // Не разобрали событие — не наше дело мешать работе.
}

const tool = event.tool_name ?? '';
const input = event.tool_input ?? {};

// ---------- Ветка 1: правка файлов инструментами Write/Edit ----------
if (MUTATING_TOOLS.has(tool)) {
  const path = String(input.file_path ?? input.notebook_path ?? '');

  for (const [re, what] of IMMUTABLE_PATHS) {
    if (re.test(path)) deny(`Попытка изменить ${what}.\nПуть: ${path}`);
  }

  const closed = path.match(/sessions[\/\\]session-(\d+)\.md$/i);
  if (closed && CLOSED_SESSIONS.includes(Number(closed[1]))) {
    deny(
      `Сессия ${closed[1]} закрыта, её журнал правке не подлежит.\n` +
      `Журнал только дополняется: переписывание задним числом — прямой запрет Части I AGENTS.md.\n` +
      `Путь: ${path}`
    );
  }
  process.exit(0);
}

// ---------- Ветка 2: команды оболочки ----------
if (tool === 'Bash') {
  const cmd = String(input.command ?? '');

  for (const re of SECRET_TARGETS) {
    if (re.test(cmd)) {
      deny(
        `Команда обращается к файлу с секретами.\n` +
        `Совпадение: ${re}\nКоманда: ${cmd}\n\n` +
        `Проверяется цель, а не утилита: cat, node -e, python -c, Get-Content и любая другая\n` +
        `обёртка вокруг того же пути блокируются одинаково.`
      );
    }
  }

  for (const [re, what] of DESTRUCTIVE) {
    if (re.test(cmd)) deny(`Необратимая команда: ${what}.\nКоманда: ${cmd}`);
  }

  for (const [re, what] of FORBIDDEN_BY_TASK) {
    if (re.test(cmd)) {
      deny(`Запрещено условиями задания: ${what}.\nКоманда: ${cmd}`);
    }
  }

  const mutating = BASH_MUTATION.test(cmd);

  if (mutating) {
    for (const [re, what] of IMMUTABLE_PATHS) {
      if (re.test(cmd)) deny(`Попытка изменить или удалить ${what}.\nКоманда: ${cmd}`);
    }
    if (/sessions[\/\\]/i.test(cmd)) {
      deny(
        `Попытка изменить или удалить содержимое sessions/ командой оболочки.\n` +
        `Журнал дополняется только инструментами правки, чей результат виден человеку\n` +
        `в диффе. Команда: ${cmd}`
      );
    }
    if (/\.claude[\/\\](hooks|settings)/i.test(cmd)) {
      deny(
        `Попытка изменить сам механизм защиты командой оболочки.\n` +
        `Правка settings.json и hooks/ разрешена только инструментами Write и Edit —\n` +
        `там изменение попадает в дифф и человек его увидит. Команда: ${cmd}`
      );
    }
  }
}

process.exit(0);
