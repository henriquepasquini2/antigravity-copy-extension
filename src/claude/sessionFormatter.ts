/**
 * Formats Claude Cowork / Claude Code JSONL session messages as clean Markdown.
 *
 * JSONL message schema (one JSON object per line):
 *   type: "user" | "assistant"
 *   message.role: "user" | "assistant"
 *   message.content: string | ContentBlock[]
 *   message.model: string (on assistant messages)
 *   isMeta: boolean (injected context like skill prompts)
 *   timestamp: ISO 8601
 *
 * ContentBlock variants:
 *   { type: "thinking",         thinking: string }
 *   { type: "redacted_thinking" }
 *   { type: "text",             text: string }
 *   { type: "tool_use",         name: string, input: object }
 *   { type: "tool_result",      tool_use_id: string, content: string | ContentBlock[] }
 *   { type: "server_tool_use",  name: string, input: object }
 *   { type: "server_tool_result", content: string | ContentBlock[] }
 */

export function formatClaudeSession(
  messages: any[],
  includeUserInput: boolean,
): string {
  const lines: string[] = [];

  for (const msg of messages) {
    if (msg.isMeta) continue;

    if (msg.type === 'user') {
      emitUserMessage(msg, lines, includeUserInput);
    } else if (msg.type === 'assistant') {
      emitAssistantMessage(msg, lines);
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function emitUserMessage(msg: any, lines: string[], includeUserInput: boolean): void {
  const content = msg.message?.content;
  if (!content) return;

  if (typeof content === 'string') {
    if (!includeUserInput) return;
    lines.push('## User');
    lines.push('');
    lines.push(content.trim());
    lines.push('');
    return;
  }

  if (!Array.isArray(content)) return;

  let hasUserText = false;

  for (const block of content) {
    if (block.type === 'tool_result') {
      emitToolResult(block, lines);
    } else if (block.type === 'text' && includeUserInput && !msg.isMeta) {
      const text = block.text?.trim();
      if (text) {
        if (!hasUserText) {
          lines.push('## User');
          lines.push('');
          hasUserText = true;
        }
        lines.push(text);
        lines.push('');
      }
    }
  }
}

function emitAssistantMessage(msg: any, lines: string[]): void {
  const content = msg.message?.content;
  if (!Array.isArray(content)) return;

  for (const block of content) {
    switch (block.type) {
      case 'thinking':
        emitThinking(block, lines);
        break;
      case 'redacted_thinking':
        lines.push('[redacted thinking]');
        lines.push('');
        break;
      case 'text':
        emitText(block, lines);
        break;
      case 'tool_use':
        emitToolUse(block, lines);
        break;
      case 'server_tool_use':
        emitServerToolUse(block, lines);
        break;
      case 'server_tool_result':
        emitToolResultContent(block.content, lines);
        break;
    }
  }
}

function emitThinking(block: any, lines: string[]): void {
  const thinking = block.thinking;
  if (!thinking?.trim()) return;

  lines.push(thinking.trim());
  lines.push('');
}

function emitText(block: any, lines: string[]): void {
  const text = block.text;
  if (!text?.trim()) return;

  lines.push(text.trim());
  lines.push('');
}

function emitToolUse(block: any, lines: string[]): void {
  const name: string = block.name || 'unknown';
  const input = block.input || {};

  switch (name) {
    case 'Write': {
      const filePath = input.file_path || input.path || '?';
      lines.push(`Wrote \`${filePath}\``);
      emitLineCounts(input.content, '', lines);
      emitFileContent(filePath, input.content, lines);
      break;
    }
    case 'Edit': {
      const filePath = input.file_path || input.path || '?';
      lines.push(`Edited \`${filePath}\``);
      emitLineCounts(input.new_string, input.old_string, lines);
      emitEditDiff(input.old_string, input.new_string, lines);
      break;
    }
    case 'MultiEdit': {
      const filePath = input.file_path || input.path || '?';
      lines.push(`Edited \`${filePath}\``);
      if (Array.isArray(input.edits)) {
        let added = 0, removed = 0;
        for (const e of input.edits) {
          added += countLines(e?.new_string);
          removed += countLines(e?.old_string);
        }
        if (added || removed) {
          lines.push(`+${added}`);
          lines.push(`-${removed}`);
        }
        for (const e of input.edits) {
          emitEditDiff(e?.old_string, e?.new_string, lines);
        }
      }
      break;
    }
    case 'NotebookEdit': {
      const filePath = input.notebook_path || input.file_path || '?';
      lines.push(`Edited notebook \`${filePath}\``);
      if (typeof input.new_source === 'string') {
        emitLineCounts(input.new_source, '', lines);
        emitFileContent(filePath, input.new_source, lines);
      }
      break;
    }
    case 'Read':
      lines.push(`Read \`${input.file_path || input.path || '?'}\``);
      break;
    case 'Bash':
      if (input.description) {
        lines.push(`Ran command — ${input.description}`);
      } else {
        lines.push('Ran command');
      }
      if (input.command) {
        lines.push('```bash');
        lines.push(input.command);
        lines.push('```');
      }
      break;
    case 'Glob':
      lines.push(`Glob: \`${input.pattern || input.glob || '?'}\``);
      break;
    case 'Grep':
      lines.push(`Searched for "${input.pattern || input.query || '?'}"`);
      break;
    case 'WebSearch':
      lines.push(`Searched web: "${input.query || '?'}"`);
      break;
    case 'WebFetch':
      lines.push(`Fetched: ${input.url || '?'}`);
      break;
    case 'Skill':
      lines.push(`Activated skill: ${input.skill || '?'}`);
      break;
    case 'AskUserQuestion':
      emitAskUserQuestion(input, lines);
      return;
    case 'TodoWrite':
      emitTodoWrite(input, lines);
      return;
    default:
      if (name.startsWith('mcp__')) {
        const shortName = name.replace(/^mcp__\w+__/, '');
        lines.push(`MCP: ${shortName}`);
      } else {
        lines.push(`Used ${name}`);
      }
      emitGenericInput(input, lines);
      break;
  }
  lines.push('');
}

/**
 * For unknown tools we don't have a dedicated renderer for, dump the input
 * fields as `key: value` lines. Strings are inlined when short; longer values
 * become fenced blocks so multi-line input remains readable.
 */
function emitGenericInput(input: any, lines: string[]): void {
  if (!input || typeof input !== 'object') return;
  const keys = Object.keys(input);
  if (keys.length === 0) return;
  for (const key of keys) {
    const v = (input as any)[key];
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') {
      if (v.includes('\n') || v.length > 120) {
        lines.push(`${key}:`);
        lines.push('```');
        lines.push(v.replace(/\n+$/, ''));
        lines.push('```');
      } else {
        lines.push(`${key}: ${v}`);
      }
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      lines.push(`${key}: ${v}`);
    } else {
      let s: string;
      try { s = JSON.stringify(v); } catch { s = String(v); }
      if (s.length > 120) {
        lines.push(`${key}:`);
        lines.push('```json');
        try { lines.push(JSON.stringify(v, null, 2)); } catch { lines.push(s); }
        lines.push('```');
      } else {
        lines.push(`${key}: ${s}`);
      }
    }
  }
}

/**
 * Counts lines in a string the way Claude's UI does: split on \n, but don't
 * count the empty tail produced by a final newline. Matches the manual log's
 * +N/-N markers (e.g. a 39-line file ending in \n shows +39, not +40).
 */
function countLines(s: any): number {
  if (typeof s !== 'string' || s.length === 0) return 0;
  const parts = s.split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts.length;
}

function emitLineCounts(added: any, removed: any, lines: string[]): void {
  const a = countLines(added);
  const r = countLines(removed);
  if (a === 0 && r === 0) return;
  lines.push(`+${a}`);
  lines.push(`-${r}`);
}

function emitAskUserQuestion(input: any, lines: string[]): void {
  const questions = input?.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    lines.push('Asked user a question');
    lines.push('');
    return;
  }
  lines.push('Asked');
  for (const q of questions) {
    if (q?.header) lines.push(q.header);
    if (q?.question) {
      lines.push('');
      lines.push(`**${q.question}**`);
    }
    if (Array.isArray(q?.options)) {
      for (const opt of q.options) {
        const label = opt?.label || '';
        const desc = opt?.description || '';
        if (label) lines.push(`- ${label}${desc ? ` — ${desc}` : ''}`);
      }
    }
    lines.push('');
  }
}

/**
 * Emits the full content that was written to a file as a fenced code block.
 * Without this, "Wrote `path`" leaves the reader with no idea what was written.
 */
function emitFileContent(filePath: string, content: any, lines: string[]): void {
  if (typeof content !== 'string' || content.length === 0) return;
  const lang = languageFromPath(filePath);
  lines.push('');
  lines.push('```' + lang);
  lines.push(content.replace(/\n+$/, ''));
  lines.push('```');
}

/**
 * Emits an Edit's before/after as a diff-style fenced block so removed and
 * added lines are both visible.
 */
function emitEditDiff(oldStr: any, newStr: any, lines: string[]): void {
  const oldText = typeof oldStr === 'string' ? oldStr : '';
  const newText = typeof newStr === 'string' ? newStr : '';
  if (!oldText && !newText) return;
  lines.push('');
  lines.push('```diff');
  if (oldText) {
    for (const l of oldText.split('\n')) lines.push('- ' + l);
  }
  if (newText) {
    for (const l of newText.split('\n')) lines.push('+ ' + l);
  }
  lines.push('```');
}

function languageFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  const base = lower.split(/[\\/]/).pop() || '';
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  const ext = base.includes('.') ? base.split('.').pop()! : '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
    c: 'c', h: 'c', cpp: 'cpp', cxx: 'cpp', cc: 'cpp', hpp: 'cpp', hxx: 'cpp',
    cs: 'csharp', php: 'php', swift: 'swift', scala: 'scala', lua: 'lua', dart: 'dart',
    json: 'json', jsonc: 'jsonc', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml',
    md: 'markdown', markdown: 'markdown', mdx: 'mdx',
    html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'sass', less: 'less',
    sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'fish', ps1: 'powershell',
    sql: 'sql', env: 'dotenv', ini: 'ini', conf: 'ini',
    vue: 'vue', svelte: 'svelte', astro: 'astro',
    graphql: 'graphql', gql: 'graphql', proto: 'protobuf',
  };
  return map[ext] || '';
}

function emitTodoWrite(input: any, lines: string[]): void {
  const todos = input.todos;
  if (!Array.isArray(todos) || todos.length === 0) return;

  lines.push('Todo list:');
  for (const todo of todos) {
    const status = todo.status || 'pending';
    const marker = status === 'completed' ? 'x' : status === 'in_progress' ? '~' : ' ';
    lines.push(`- [${marker}] ${todo.content || '?'}`);
  }
  lines.push('');
}

function emitServerToolUse(block: any, lines: string[]): void {
  const name: string = block.name || 'unknown';
  if (name === 'web_search' || name === 'brave_search') {
    lines.push(`Searched web: "${block.input?.query || '?'}"`);
  } else {
    lines.push(`Server tool: ${name}`);
  }
  lines.push('');
}

/**
 * Strips ANSI color/style escape sequences (CSI + final byte) from terminal
 * output. Claude's app renders these as styles; in copied text they're noise.
 */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;?]*[ -/]*[@-~]/g, '');
}

/**
 * Extracts text from tool_result content, which can be a string or an array
 * of content blocks like [{type: "text", text: "..."}, {type: "image", ...}].
 */
function emitToolResultContent(content: any, lines: string[]): void {
  if (!content) return;

  if (typeof content === 'string') {
    const trimmed = stripAnsi(content).trim();
    if (trimmed) {
      lines.push(trimmed);
      lines.push('');
    }
    return;
  }

  if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === 'string') {
        const trimmed = stripAnsi(item).trim();
        if (trimmed) {
          lines.push(trimmed);
          lines.push('');
        }
      } else if (item?.type === 'text' && typeof item.text === 'string') {
        const trimmed = stripAnsi(item.text).trim();
        if (trimmed) {
          lines.push(trimmed);
          lines.push('');
        }
      }
    }
  }
}

function emitToolResult(block: any, lines: string[]): void {
  emitToolResultContent(block.content, lines);
}
