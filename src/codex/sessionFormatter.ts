/**
 * Formats Codex rollout JSONL files as clean Markdown.
 *
 * Each line has the shape:
 *   { timestamp, type, payload }
 *
 * Top-level `type` is one of:
 *   - "session_meta"   — metadata header (cwd, model, cli version)
 *   - "turn_context"   — per-turn context dump (skipped)
 *   - "event_msg"      — runtime events; we keep patch_apply_end,
 *                        mcp_tool_call_end, image_generation_end and drop the
 *                        rest (user_message / agent_message duplicate the
 *                        response_item versions; token_count / task_started /
 *                        task_complete are pure metadata)
 *   - "response_item"  — main content stream:
 *       payload.type =
 *         "message"                   role: user|assistant|developer
 *         "reasoning"                 encrypted thinking (placeholder only)
 *         "function_call"             tool call (shell_command, view_image, ...)
 *         "function_call_output"      paired tool result
 *         "custom_tool_call"          non-OpenAI tools (apply_patch, ...)
 *         "custom_tool_call_output"   paired result
 */

export function formatCodexSession(
  messages: any[],
  includeUserInput: boolean,
): string {
  const lines: string[] = [];

  // Patch results are richer in event_msg/patch_apply_end. Index them by
  // call_id so we can render the verified per-file diffs when we reach the
  // matching custom_tool_call/apply_patch in chat order.
  const patchEventsByCallId = indexPatchEvents(messages);

  // MCP calls show up THREE times: response_item/function_call (with
  // mcp__ namespace), event_msg/mcp_tool_call_end (richer, has the result),
  // and response_item/function_call_output. We render the mcp_tool_call_end
  // and skip the other two to avoid triple-printing the same call.
  const mcpCallIds = indexMcpCallIds(messages);

  for (const msg of messages) {
    if (msg?.type !== 'response_item' && msg?.type !== 'event_msg') continue;

    if (msg.type === 'event_msg') {
      emitEvent(msg, lines);
      continue;
    }

    emitResponseItem(msg, lines, includeUserInput, patchEventsByCallId, mcpCallIds);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------------------------------------------------------------------------
// response_item dispatch
// ---------------------------------------------------------------------------

function emitResponseItem(
  msg: any,
  lines: string[],
  includeUserInput: boolean,
  patchEventsByCallId: Map<string, any>,
  mcpCallIds: Set<string>,
): void {
  const p = msg.payload;
  if (!p) return;

  switch (p.type) {
    case 'message':
      emitMessage(p, lines, includeUserInput);
      break;
    case 'reasoning':
      emitReasoning(lines);
      break;
    case 'function_call':
      // Skip MCP function calls — event_msg/mcp_tool_call_end will render them
      // with the result attached, so showing this would just duplicate args.
      if (p.call_id && mcpCallIds.has(p.call_id)) break;
      emitFunctionCall(p, lines);
      break;
    case 'function_call_output':
      // Same reasoning — the mcp_tool_call_end already carries the result.
      if (p.call_id && mcpCallIds.has(p.call_id)) break;
      emitFunctionCallOutput(p, lines);
      break;
    case 'custom_tool_call':
      emitCustomToolCall(p, lines, patchEventsByCallId);
      break;
    case 'custom_tool_call_output':
      emitCustomToolCallOutput(p, lines);
      break;
    default:
      // Unknown subtype — drop silently rather than dump JSON noise.
      break;
  }
}

function emitMessage(p: any, lines: string[], includeUserInput: boolean): void {
  const role: string = p.role || '';
  const text = extractContentText(p.content);
  if (!text) return;

  if (role === 'developer') {
    // System bootstrap (permissions / base instructions). Always skip.
    return;
  }

  if (role === 'user') {
    if (!includeUserInput) return;
    // Skip the auto-injected environment_context wrapper.
    if (
      text.includes('<environment_context>') ||
      text.includes('<permissions instructions>')
    ) {
      return;
    }
    lines.push('## User');
    lines.push('');
    lines.push(text);
    lines.push('');
    return;
  }

  if (role === 'assistant') {
    lines.push(text);
    lines.push('');
    return;
  }
}

function emitReasoning(lines: string[]): void {
  // Codex encrypts its chain-of-thought (encrypted_content blob). The plaintext
  // summary[] is essentially always empty. Emit a placeholder so the reader
  // sees the model reasoned at this point.
  lines.push('[encrypted thinking]');
  lines.push('');
}

// ---------------------------------------------------------------------------
// function_call (built-in tools)
// ---------------------------------------------------------------------------

function emitFunctionCall(p: any, lines: string[]): void {
  const name: string = p.name || 'unknown';
  const args = parseJson(p.arguments);

  if (name === 'shell_command') {
    emitShellCommand(args, lines);
    return;
  }

  if (name === 'view_image') {
    const file = args?.path || '?';
    lines.push(`Viewed image: \`${file}\``);
    lines.push('');
    return;
  }

  // MCP-namespaced or generic function call. Show name + arguments.
  const label = p.namespace ? `${p.namespace}${name}` : name;
  lines.push(`Used ${label}`);
  emitArgs(args, lines);
}

function emitShellCommand(args: any, lines: string[]): void {
  const cmd = args?.command;
  const workdir = args?.workdir;
  lines.push('Ran command');
  if (workdir) {
    lines.push(`cwd: ${workdir}`);
  }
  if (typeof cmd === 'string' && cmd.length > 0) {
    lines.push('```bash');
    lines.push(cmd);
    lines.push('```');
  } else if (Array.isArray(cmd)) {
    lines.push('```bash');
    lines.push(cmd.join(' '));
    lines.push('```');
  }
}

function emitFunctionCallOutput(p: any, lines: string[]): void {
  const output = typeof p.output === 'string' ? stripAnsi(p.output).trim() : '';
  if (!output) return;
  lines.push(output);
  lines.push('');
}

// ---------------------------------------------------------------------------
// custom_tool_call (apply_patch and friends)
// ---------------------------------------------------------------------------

function emitCustomToolCall(
  p: any,
  lines: string[],
  patchEventsByCallId: Map<string, any>,
): void {
  const name: string = p.name || 'unknown';

  if (name === 'apply_patch') {
    const event = patchEventsByCallId.get(p.call_id);
    if (event) {
      emitPatchEvent(event.payload, lines);
      return;
    }
    // No paired event — fall back to the raw patch input so we don't drop
    // edits silently.
    lines.push('Applied patch');
    if (typeof p.input === 'string' && p.input.length > 0) {
      lines.push('```diff');
      lines.push(p.input);
      lines.push('```');
    }
    lines.push('');
    return;
  }

  // Other custom tools — emit name + input.
  lines.push(`Used ${name}`);
  if (typeof p.input === 'string') {
    lines.push('```');
    lines.push(p.input);
    lines.push('```');
  }
  lines.push('');
}

function emitCustomToolCallOutput(p: any, lines: string[]): void {
  const output = typeof p.output === 'string' ? stripAnsi(p.output).trim() : '';
  if (!output) return;
  // The apply_patch output is just "Success. Updated the following files: ..."
  // — useful but short, so emit as-is.
  lines.push(output);
  lines.push('');
}

// ---------------------------------------------------------------------------
// event_msg dispatch (only the ones with content worth emitting)
// ---------------------------------------------------------------------------

function emitEvent(msg: any, lines: string[]): void {
  const p = msg.payload;
  if (!p) return;

  switch (p.type) {
    case 'mcp_tool_call_end':
      emitMcpToolCallEnd(p, lines);
      break;
    case 'image_generation_end':
      emitImageGenerationEnd(p, lines);
      break;
    // patch_apply_end is consumed at the custom_tool_call site (above) — we
    // don't render it standalone or it'd duplicate the apply_patch entry.
    case 'patch_apply_end':
    case 'task_started':
    case 'task_complete':
    case 'token_count':
    case 'agent_message':   // duplicates response_item/message (assistant)
    case 'user_message':    // duplicates response_item/message (user)
    default:
      break;
  }
}

function emitMcpToolCallEnd(p: any, lines: string[]): void {
  const inv = p.invocation || {};
  const server = inv.server || '';
  const tool = inv.tool || 'unknown';
  const label = server ? `${server}/${tool}` : tool;

  lines.push(`MCP: ${label}`);
  emitArgs(inv.arguments, lines);

  // Result can live in a few shapes — content array, string, or nested object.
  const resultText = extractMcpResult(p);
  if (resultText) {
    lines.push(resultText);
    lines.push('');
  }
}

function extractMcpResult(p: any): string {
  const result = p?.result;
  if (!result) return '';
  if (typeof result === 'string') return stripAnsi(result).trim();
  if (Array.isArray(result?.content)) {
    return result.content
      .map((c: any) => (typeof c?.text === 'string' ? stripAnsi(c.text) : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (typeof result?.text === 'string') return stripAnsi(result.text).trim();
  return '';
}

function emitImageGenerationEnd(p: any, lines: string[]): void {
  lines.push('Generated image');
  if (p.revised_prompt) {
    lines.push('```');
    lines.push(String(p.revised_prompt));
    lines.push('```');
  }
  if (p.call_id) {
    lines.push(`call_id: ${p.call_id}`);
  }
  lines.push('');
}

// ---------------------------------------------------------------------------
// patch rendering (shared by apply_patch via patch_apply_end)
// ---------------------------------------------------------------------------

function emitPatchEvent(payload: any, lines: string[]): void {
  const success = payload?.success !== false;
  const changes = payload?.changes || {};
  const files = Object.keys(changes);

  if (files.length === 0) {
    lines.push(success ? 'Applied patch' : 'Patch failed');
    if (payload?.stderr) {
      lines.push('```');
      lines.push(String(payload.stderr));
      lines.push('```');
    }
    lines.push('');
    return;
  }

  lines.push(success ? 'Applied patch' : 'Patch failed');
  for (const filePath of files) {
    const change = changes[filePath] || {};
    const kind = (change.type || 'update').toLowerCase();
    const verb =
      kind === 'add' ? 'Added' :
      kind === 'delete' ? 'Deleted' :
      kind === 'move' ? 'Renamed' : 'Edited';

    if (change.move_path) {
      lines.push(`${verb} \`${filePath}\` → \`${change.move_path}\``);
    } else {
      lines.push(`${verb} \`${filePath}\``);
    }

    // Adds carry the new file body in `content`; updates carry a unified_diff;
    // deletes carry neither. Pick whichever is present so we don't drop file
    // contents on add operations.
    const diff = typeof change.unified_diff === 'string' ? change.unified_diff : '';
    const content = typeof change.content === 'string' ? change.content : '';

    if (diff.length > 0) {
      lines.push('');
      lines.push('```diff');
      lines.push(diff.replace(/\n+$/, ''));
      lines.push('```');
    } else if (content.length > 0) {
      lines.push('');
      lines.push('```' + languageFromPath(filePath));
      lines.push(content.replace(/\n+$/, ''));
      lines.push('```');
    }
    lines.push('');
  }

  if (!success && payload?.stderr) {
    lines.push('```');
    lines.push(String(payload.stderr));
    lines.push('```');
    lines.push('');
  }
}

function indexPatchEvents(messages: any[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const msg of messages) {
    if (
      msg?.type === 'event_msg' &&
      msg.payload?.type === 'patch_apply_end' &&
      msg.payload?.call_id
    ) {
      map.set(msg.payload.call_id, msg);
    }
  }
  return map;
}

function indexMcpCallIds(messages: any[]): Set<string> {
  const set = new Set<string>();
  for (const msg of messages) {
    if (
      msg?.type === 'event_msg' &&
      msg.payload?.type === 'mcp_tool_call_end' &&
      msg.payload?.call_id
    ) {
      set.add(msg.payload.call_id);
    }
  }
  return set;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Codex `message.content` is always an array of `{ type, text }` blocks
 * (`input_text` for user/developer, `output_text` for assistant).
 */
function extractContentText(content: any): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
    .join('')
    .trim();
}

function parseJson(s: any): any {
  if (typeof s !== 'string' || s.length === 0) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function emitArgs(args: any, lines: string[]): void {
  if (!args || typeof args !== 'object') return;
  const keys = Object.keys(args);
  if (keys.length === 0) return;
  for (const key of keys) {
    const v = args[key];
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
 * Strip ANSI color/style escape sequences from terminal output. Shared logic
 * with the Claude formatter.
 */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

/**
 * Infer the markdown code-fence language hint from a file extension. Used for
 * "Added" file bodies in patch_apply_end. Same map as the Claude formatter.
 */
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
