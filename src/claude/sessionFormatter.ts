/**
 * Formats Claude Cowork JSONL session messages as clean Markdown.
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
 *   { type: "thinking",    thinking: string }
 *   { type: "text",        text: string }
 *   { type: "tool_use",    name: string, input: object }
 *   { type: "tool_result", tool_use_id: string, content: string }
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

  for (const block of content) {
    if (block.type === 'tool_result') {
      emitToolResult(block, lines);
    } else if (block.type === 'text' && !msg.isMeta) {
      // Injected context (skill instructions, etc.) — skip unless it's
      // a genuine follow-up from the user (non-meta, non-tool-result).
      // These are typically system injections after tool_result; skip them.
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
      case 'text':
        emitText(block, lines);
        break;
      case 'tool_use':
        emitToolUse(block, lines);
        break;
    }
  }
}

function emitThinking(block: any, lines: string[]): void {
  const thinking = block.thinking;
  if (!thinking?.trim()) return;

  lines.push('<details>');
  lines.push('<summary>Thinking</summary>');
  lines.push('');
  lines.push(thinking.trim());
  lines.push('');
  lines.push('</details>');
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
    case 'Write':
      lines.push(`Wrote \`${input.file_path || input.path || '?'}\``);
      break;
    case 'Edit':
      lines.push(`Edited \`${input.file_path || input.path || '?'}\``);
      break;
    case 'Read':
      lines.push(`Read \`${input.file_path || input.path || '?'}\``);
      break;
    case 'Bash':
      lines.push('Ran command');
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
    case 'TodoWrite':
      emitTodoWrite(input, lines);
      return;
    default:
      if (name.startsWith('mcp__')) {
        const shortName = name.replace(/^mcp__\w+__/, '');
        lines.push(`MCP: ${shortName}`);
      } else {
        lines.push(`Tool: ${name}`);
      }
      break;
  }
  lines.push('');
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

function emitToolResult(block: any, lines: string[]): void {
  const content = block.content;
  if (!content || typeof content !== 'string') return;

  const trimmed = content.trim();
  if (!trimmed) return;

  if (trimmed.length > 2000) {
    lines.push(`<details>`);
    lines.push(`<summary>Tool output (${formatSize(trimmed.length)})</summary>`);
    lines.push('');
    lines.push(trimmed);
    lines.push('');
    lines.push('</details>');
  } else {
    lines.push(trimmed);
  }
  lines.push('');
}

function formatSize(chars: number): string {
  if (chars < 1024) return `${chars} chars`;
  return `${(chars / 1024).toFixed(1)} KB`;
}
