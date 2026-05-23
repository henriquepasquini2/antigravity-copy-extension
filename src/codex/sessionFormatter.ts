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

  // Codex writes a batch of function_calls first and then a batch of
  // function_call_outputs (a single round-trip with the model can carry many
  // parallel calls). Pre-index outputs by call_id so we can render each
  // command and its result back-to-back, the way Cursor displays them.
  const outputsByCallId = indexFunctionOutputs(messages);
  // Track which outputs we've already rendered alongside their call so we
  // don't emit them a second time when we reach the raw output entry.
  const consumedOutputs = new Set<string>();

  // Pre-compute the rollup banner (e.g. "Created 7 files, edited 2 files,
  // ran 2 commands") for every cluster of tool activity. A cluster is the
  // span between two consecutive assistant messages — Codex's UI aggregates
  // all tool work in that span into a single summary banner, even when the
  // model produced multiple internal turns without surfacing any text.
  const clusterBanners = buildClusterBanners(messages, mcpCallIds);
  let cluster = 0;
  let bannerEmittedThisCluster = false;

  for (const msg of messages) {
    if (msg?.type !== 'response_item' && msg?.type !== 'event_msg') continue;

    // An assistant message ends the current cluster and starts a new one.
    if (
      msg.type === 'response_item' &&
      msg.payload?.type === 'message' &&
      msg.payload?.role === 'assistant'
    ) {
      cluster++;
      bannerEmittedThisCluster = false;
    } else if (
      !bannerEmittedThisCluster &&
      willEmitTool(msg, mcpCallIds, consumedOutputs)
    ) {
      const banner = clusterBanners.get(cluster);
      if (banner) {
        lines.push(banner);
        lines.push('');
      }
      bannerEmittedThisCluster = true;
    }

    if (msg.type === 'event_msg') {
      emitEvent(msg, lines);
      continue;
    }

    emitResponseItem(
      msg,
      lines,
      includeUserInput,
      patchEventsByCallId,
      mcpCallIds,
      outputsByCallId,
      consumedOutputs,
    );
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------------------------------------------------------------------------
// Turn rollup banners
// ---------------------------------------------------------------------------

interface TurnStats {
  adds: number;
  edits: number;
  deletes: number;
  shellCmds: number;
  /** Maps the friendly label Codex's UI uses → count of calls under that label. */
  mcpLabels: Map<string, number>;
}

/**
 * Friendly descriptions for known MCP servers, matching how Codex's CLI / the
 * Cursor UI describe them in the rollup banner. The official Codex browser
 * MCP runs through `node_repl` and the UI shows "used the browser" — but
 * only when Codex itself tagged the result with `codex/browserUse: true`.
 * Calls without that tag get labeled "Node Repl" instead.
 */
function labelForMcpCall(server: string, isBrowserCall: boolean): string {
  if (server === 'node_repl') {
    return isBrowserCall ? 'the browser' : 'Node Repl';
  }
  return server;
}

/**
 * Detect whether an mcp_tool_call_end payload represents browser MCP work.
 * Codex's client sets `result.Ok._meta["codex/browserUse"] = true` for any
 * call that drove the browser, which is the same signal Cursor uses to label
 * the call "the browser" in its rollup banner.
 */
function isBrowserMcpCall(payload: any): boolean {
  const result = payload?.result;
  if (!result || typeof result !== 'object') return false;
  const ok = (result as any).Ok;
  if (!ok || typeof ok !== 'object') return false;
  return ok._meta?.['codex/browserUse'] === true;
}

function buildClusterBanners(
  messages: any[],
  mcpCallIds: Set<string>,
): Map<number, string> {
  const banners = new Map<number, string>();
  let cluster = 0;
  let stats: TurnStats = emptyTurnStats();

  const flush = (): void => {
    const banner = formatTurnBanner(stats);
    if (banner) banners.set(cluster, banner);
    stats = emptyTurnStats();
  };

  for (const msg of messages) {
    // An assistant message closes the current cluster; the next tool starts
    // a fresh one.
    if (
      msg?.type === 'response_item' &&
      msg.payload?.type === 'message' &&
      msg.payload?.role === 'assistant'
    ) {
      flush();
      cluster++;
      continue;
    }

    if (msg?.type === 'response_item') {
      const p = msg.payload;
      if (p?.type === 'function_call' && p.name === 'shell_command' &&
          !(p.call_id && mcpCallIds.has(p.call_id))) {
        stats.shellCmds++;
      }
    } else if (msg?.type === 'event_msg') {
      const p = msg.payload;
      if (p?.type === 'patch_apply_end') {
        const changes = p.changes || {};
        for (const file of Object.keys(changes)) {
          const kind = (changes[file]?.type || 'update').toLowerCase();
          if (kind === 'add') stats.adds++;
          else if (kind === 'delete') stats.deletes++;
          else stats.edits++;
        }
      } else if (p?.type === 'mcp_tool_call_end') {
        const server = p?.invocation?.server || '?';
        const label = labelForMcpCall(server, isBrowserMcpCall(p));
        stats.mcpLabels.set(label, (stats.mcpLabels.get(label) || 0) + 1);
      }
    }
  }
  flush();
  return banners;
}

function emptyTurnStats(): TurnStats {
  return {
    adds: 0,
    edits: 0,
    deletes: 0,
    shellCmds: 0,
    mcpLabels: new Map(),
  };
}

function formatTurnBanner(stats: TurnStats): string | null {
  const mcpCount = [...stats.mcpLabels.values()].reduce((a, b) => a + b, 0);
  const total = stats.adds + stats.edits + stats.deletes + stats.shellCmds + mcpCount;
  // Codex only shows a rollup when the turn touches multiple tools — a turn
  // with a single command/edit/etc gets no banner in the UI.
  if (total < 2) return null;

  const parts: string[] = [];
  if (stats.adds === 1) parts.push('created 1 file');
  else if (stats.adds > 1) parts.push(`created ${stats.adds} files`);
  if (stats.edits === 1) parts.push('edited 1 file');
  else if (stats.edits > 1) parts.push(`edited ${stats.edits} files`);
  if (stats.deletes === 1) parts.push('deleted 1 file');
  else if (stats.deletes > 1) parts.push(`deleted ${stats.deletes} files`);
  if (stats.shellCmds === 1) parts.push('ran 1 command');
  else if (stats.shellCmds > 1) parts.push(`ran ${stats.shellCmds} commands`);

  // Codex joins multiple distinct MCP labels with "and" in a single phrase
  // ("used the browser and Node Repl"), not as separate comma-separated parts.
  if (stats.mcpLabels.size > 0) {
    const labels = [...stats.mcpLabels.keys()];
    parts.push('used ' + joinWithAnd(labels));
  }

  if (parts.length === 0) return null;
  const banner = parts.join(', ');
  // Capitalize the first letter so the line reads "Created N files, ..." etc.
  return banner.charAt(0).toUpperCase() + banner.slice(1);
}

function joinWithAnd(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return items[0] + ' and ' + items[1];
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}

/**
 * Mirror the emit logic just enough to know whether a message will actually
 * produce a tool-related line. Used to decide when to inject the turn banner.
 */
function willEmitTool(
  msg: any,
  mcpCallIds: Set<string>,
  consumedOutputs: Set<string>,
): boolean {
  if (msg?.type === 'response_item') {
    const p = msg.payload;
    if (!p) return false;
    if (p.type === 'function_call') {
      return !(p.call_id && mcpCallIds.has(p.call_id));
    }
    if (p.type === 'function_call_output') {
      if (!p.call_id) return true;
      return !(mcpCallIds.has(p.call_id) || consumedOutputs.has(p.call_id));
    }
    if (p.type === 'custom_tool_call') return true;
    if (p.type === 'custom_tool_call_output') {
      return !(p.call_id && consumedOutputs.has(p.call_id));
    }
    return false;
  }
  if (msg?.type === 'event_msg') {
    const p = msg.payload;
    if (!p) return false;
    return p.type === 'mcp_tool_call_end' || p.type === 'image_generation_end';
  }
  return false;
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
  outputsByCallId: Map<string, any>,
  consumedOutputs: Set<string>,
): void {
  const p = msg.payload;
  if (!p) return;

  switch (p.type) {
    case 'message':
      emitMessage(p, lines, includeUserInput);
      break;
    case 'reasoning':
      emitReasoning(p, lines);
      break;
    case 'function_call':
      // Skip MCP function calls — event_msg/mcp_tool_call_end will render them
      // with the result attached, so showing this would just duplicate args.
      if (p.call_id && mcpCallIds.has(p.call_id)) break;
      emitFunctionCall(p, lines);
      // Pair the matching output directly under the command so the trace
      // reads command -> output instead of dumping all outputs in a batch
      // at the bottom.
      if (p.call_id && outputsByCallId.has(p.call_id)) {
        const outputPayload = outputsByCallId.get(p.call_id);
        emitFunctionCallOutput(outputPayload, lines);
        consumedOutputs.add(p.call_id);
      }
      break;
    case 'function_call_output':
      // Already rendered inline with its function_call, or belongs to an MCP
      // call that mcp_tool_call_end will cover.
      if (p.call_id && (mcpCallIds.has(p.call_id) || consumedOutputs.has(p.call_id))) break;
      emitFunctionCallOutput(p, lines);
      break;
    case 'custom_tool_call':
      emitCustomToolCall(p, lines, patchEventsByCallId);
      // Custom tools (apply_patch) also have paired output entries — emit the
      // patched-files summary inline with the patch.
      if (p.call_id && outputsByCallId.has(p.call_id)) {
        const outputPayload = outputsByCallId.get(p.call_id);
        emitCustomToolCallOutput(outputPayload, lines);
        consumedOutputs.add(p.call_id);
      }
      break;
    case 'custom_tool_call_output':
      if (p.call_id && consumedOutputs.has(p.call_id)) break;
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

function emitReasoning(p: any, lines: string[]): void {
  // Codex encrypts its chain-of-thought (`encrypted_content` blob), so the
  // CLI / Cursor UI shows nothing for these. The `summary[]` field is almost
  // always empty, but when Codex *does* populate it (rare) it contains a
  // plaintext summary the user would see in the UI. Skip silently when
  // there's nothing readable — emitting a placeholder would add noise that
  // doesn't correspond to anything in the actual session display.
  const summary = p?.summary;
  if (!Array.isArray(summary) || summary.length === 0) return;

  const text = summary
    .map((s: any) => {
      if (typeof s === 'string') return s;
      if (typeof s?.text === 'string') return s.text;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!text) return;

  lines.push(text);
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

/**
 * Codex serializes MCP results from Rust's `Result<T, E>` enum, so the JSON
 * arrives wrapped as `{ Ok: { content: [...], isError, _meta } }` for success
 * and `{ Err: "..." }` for failures. Without unwrapping, we'd see the call but
 * lose every line of the result. The inner shape follows MCP's standard
 * { content: [{type:"text", text:"..."}], isError }.
 */
function extractMcpResult(p: any): string {
  let result = p?.result;
  if (!result) return '';

  // Unwrap Rust Result variants (Ok / Err) — Codex serializes the enum tag
  // as the JSON key.
  let isError = false;
  if (typeof result === 'object' && result !== null) {
    if ('Err' in result) {
      const err = (result as any).Err;
      const text = typeof err === 'string' ? err : JSON.stringify(err);
      return `Error: ${stripAnsi(text).trim()}`;
    }
    if ('Ok' in result) {
      result = (result as any).Ok;
    }
  }

  if (typeof result === 'string') return stripAnsi(result).trim();

  if (result && typeof result === 'object') {
    if (result.isError === true) isError = true;
    if (Array.isArray(result.content)) {
      const body = result.content
        .map((c: any) => (typeof c?.text === 'string' ? stripAnsi(c.text) : ''))
        .filter(Boolean)
        .join('\n')
        .trim();
      return isError && body ? `Error: ${body}` : body;
    }
    if (typeof result.text === 'string') {
      const body = stripAnsi(result.text).trim();
      return isError && body ? `Error: ${body}` : body;
    }
  }

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
  // Sort files the same way Codex's UI displays them: case-insensitive
  // lexicographic order by full path. The raw `changes` map iterates in
  // Codex's emission order, which doesn't match what users see in the app.
  const files = Object.keys(changes).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );

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

/**
 * Pre-index every function_call_output and custom_tool_call_output by call_id
 * so we can pair them with their originating call when we emit. Codex
 * batches all outputs together at the end of a turn — without this pairing
 * the user sees three commands in a row, then three outputs in a row.
 */
function indexFunctionOutputs(messages: any[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const msg of messages) {
    if (msg?.type !== 'response_item') continue;
    const p = msg.payload;
    if (!p?.call_id) continue;
    if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      map.set(p.call_id, p);
    }
  }
  return map;
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
