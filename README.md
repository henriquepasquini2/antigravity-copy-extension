# Antigravity Copy Full Conversation

Copy the **complete** trace of **Antigravity**, **Claude Cowork**, **Claude Code**, **Claude Excel**, and **OpenAI Codex** conversations — including the AI's **thought process** / **extended thinking**, web searches, tool calls, code blocks, and full responses — to your clipboard as Markdown.

## The Problem

Antigravity's built-in Export and Copy buttons only include the visible output text. Claude Desktop's Cowork mode, Claude Code CLI, and OpenAI Codex CLI have no export at all. Claude's Excel add-in hides most of its work behind collapsed pills ("Used a tool", "Ran 3 scripts") that you can't easily copy. If you want the full, unabridged conversation trace, there's no native way to get it.

## The Solution

This extension provides five integrations:

- **Antigravity** — connects directly to the running language server and fetches the full conversation trajectory at **DEBUG verbosity**, which includes everything the standard UI omits.
- **Claude Cowork** — reads the JSONL session files that Claude Desktop writes to disk, extracting extended thinking blocks, tool calls, and responses that the UI doesn't let you copy.
- **Claude Code** — reads the JSONL session files from `~/.claude/projects/`, capturing the same extended thinking, tool calls, and responses from Claude Code CLI sessions.
- **Claude Excel / PowerPoint** — connects to the Office add-in's WebView2 via Chrome DevTools Protocol, auto-expands all collapsed tool pills, and scrapes the full conversation including code blocks, parameters, and results.
- **OpenAI Codex** — reads the JSONL rollout files from `~/.codex/sessions/` and `~/.codex/archived_sessions/`, capturing shell commands, `apply_patch` diffs, MCP tool calls, generated images, and message content. Codex's chain-of-thought is server-side encrypted, so reasoning blocks emit an `[encrypted thinking]` placeholder.

The output is a clean Markdown trace in chat order — no HTML, no metadata, no truncation.

## Features

### Antigravity
- **Full thought process** — Every thinking block the AI produced, inline in chat order
- **Complete tool trace** — Web searches (with full results), directory listings, file views, command executions with output, code edits, image generation prompts, grep searches, browser actions, and more
- **All 18+ step types** — `SEARCH_WEB`, `RUN_COMMAND`, `COMMAND_STATUS`, `LIST_DIRECTORY`, `VIEW_FILE`, `CODE_ACTION`, `GENERATE_IMAGE`, `GREP_SEARCH`, `BROWSER_SUBAGENT`, `NOTIFY_USER`, `ERROR_MESSAGE`, `READ_RESOURCE`, and others
- **Full assistant responses** — The actual AI text response, not just tool call summaries
- **Multiple windows** — If several Antigravity windows are open, copy and dump commands discover every running language server, merge all conversations into one picker (newest first), and fetch each chat from the correct server
- **Session stats** — **Show Session Execution Time and Tokens** estimates wall-clock span from step timestamps and sums reported input/output tokens (modal dialog)

### Claude Cowork & Claude Code
- **Extended thinking blocks** — Full reasoning from Claude's extended thinking
- **Complete tool trace** — Bash commands (with the assistant's description and ANSI codes stripped from output), file reads, web searches, web fetches, glob/grep searches, MCP tool calls, and more (including tool results stored as text blocks or arrays, e.g. MCP previews and file read output)
- **Full Write / Edit content** — `Write` calls emit the entire file body in a fenced code block; `Edit` and `MultiEdit` emit a `diff`-style block with removed (`-`) and added (`+`) lines; `+N` / `-N` line counts match Claude's UI
- **AskUserQuestion** — question text, headers, and every option label with description
- **Generic tool inputs** — tools without a dedicated renderer (e.g. `ToolSearch`) dump their `key: value` parameters
- **Todo lists** — TodoWrite calls rendered as checkbox lists
- **Session stats** — **Show Session Execution Time and Tokens** uses JSONL message timestamps and per-assistant `usage` fields when present

### Claude Excel & PowerPoint
- **Auto-expand all pills** — "Used a tool", "Ran 3 scripts", "Fetched 5 pages", inner tool rows, "Show more", and "Result" toggles are all expanded automatically before copying
- **Full tool content** — Office.js code blocks, tool parameters (JSON), tool results, search queries, and fetched pages
- **One-time setup** — A single command sets the WebView2 debug port; after restarting Office, it works forever

### OpenAI Codex
- **Shell commands** — `shell_command` calls rendered as `Ran command` with `cwd`, paired output, and ANSI codes stripped
- **Patches** — `apply_patch` results rendered per-file with `Added` / `Edited` / `Deleted` / `Renamed` headers, unified diffs for updates, full file body for adds (language inferred from path), and files sorted to match the order Codex's UI displays them
- **MCP tool calls** — rendered once as `MCP: <server>/<tool>` with arguments and result. Codex's Rust `Result<T,E>` envelope is unwrapped so the actual MCP output appears; `isError: true` payloads are prefixed with `Error:`. The duplicate `function_call` + `function_call_output` pair Codex writes for the same call is suppressed
- **WebSearch** — `web_search_end` events render inline as `Searched web: "<query>"` for `search` actions or `Opened page: <url>` for `open_page` actions
- **Browser MCP labeling** — calls with `result.Ok._meta["codex/browserUse"]` get the friendly *"the browser"* label; everything else under `node_repl` shows as *"Node Repl"* (matching Cursor's UI)
- **Rollup banners** — *"Created N files, edited M files, ran X commands, searched web Y times, used the browser and Node Repl"* emitted before each cluster of tool activity, matching what Codex's UI shows. Clusters split at every `view_image` inside a section that produced tangible output (a patch or a generated image)
- **Images** — `image_generation_end` emits the revised prompt; `view_image` emits `Viewed image: <path>`
- **Bootstrap filtered** — the auto-injected `<environment_context>` and `<permissions instructions>` blocks are never copied, even with `--with-prompts`
- **Reasoning** — Codex CoT is server-side encrypted, so reasoning blocks are skipped silently to match what Codex's UI shows (any plaintext `summary[]` is still emitted on the rare occasions Codex populates it)
- **Session stats** — wall-clock span and token totals summed from `event_msg/token_count` entries

### Shared
- **Two copy modes** — Response-only (default) or with user prompts included
- **Conversation picker** — Select from all active conversations with titles, sorted by recency
- **Zero configuration** — Automatically discovers data sources (language server for Antigravity, session files for Claude)

## Usage

### Antigravity

1. Make sure **Antigravity is running** with at least one chat conversation (any number of windows is fine)
2. Open the Command Palette (`Ctrl+Shift+P`)
3. Run one of:
   - **Antigravity: Copy Full Conversation** — AI response only (thoughts, tools, output)
   - **Antigravity: Copy Full Conversation with Prompts** — Same, but also includes user messages
   - **Antigravity: Show Session Execution Time and Tokens** — Wall-clock span and token totals for the selected conversation (from trajectory metadata)
4. Pick the conversation from the list
5. Done — copy/dump puts Markdown on the clipboard; execution time shows a modal summary

### Claude Cowork

1. Use **Claude Desktop** in Cowork mode for at least one session
2. Open the Command Palette (`Ctrl+Shift+P`)
3. Run one of:
   - **Claude Cowork: Copy Full Session** — Extended thinking, tools, and responses
   - **Claude Cowork: Copy Full Session with Prompts** — Same, plus user messages
   - **Claude Cowork: Show Session Execution Time and Tokens** — Duration and token totals from the session JSONL
4. Pick the session from the list (shows first prompt, model, and size)
5. Done — copy puts Markdown on the clipboard; execution time shows a modal summary

### Claude Code

1. Use **Claude Code** CLI for at least one session
2. Open the Command Palette (`Ctrl+Shift+P`)
3. Run one of:
   - **Claude Code: Copy Full Session** — Extended thinking, tools, and responses
   - **Claude Code: Copy Full Session with Prompts** — Same, plus user messages
   - **Claude Code: Show Session Execution Time and Tokens** — Duration and token totals from the session JSONL
4. Pick the session from the list (shows first prompt, model, and size)
5. Done — copy puts Markdown on the clipboard; execution time shows a modal summary

### Claude Excel & PowerPoint

#### First-time setup (once per machine, applies to both)

1. Open the Command Palette (`Ctrl+Shift+P`)
2. Run **Claude Excel: Setup Debug Port** — this sets a user environment variable to enable the WebView2 debug port
3. **Close and reopen Excel/PowerPoint**, then open the Claude add-in
4. That's it — the setup persists across reboots

#### Copying conversations

1. Use **Claude** inside Excel or PowerPoint with the add-in open
2. Open the Command Palette (`Ctrl+Shift+P`)
3. Run one of:
   - **Claude Excel: Copy Full Session** or **Claude PowerPoint: Copy Full Session**
   - **Claude Excel: Copy Full Session with Prompts** or **Claude PowerPoint: Copy Full Session with Prompts**
4. Done — the full Markdown is on your clipboard

> **Note:** The extension auto-expands all collapsed pills before scraping, so you get the complete content even if you haven't manually expanded anything.

### OpenAI Codex

1. Run at least one Codex session so `~/.codex/sessions/` has rollout files (Codex writes them automatically)
2. Open the Command Palette (`Ctrl+Shift+P`)
3. Run one of:
   - **Codex: Copy Full Session** (`Ctrl+Shift+Alt+X`)
   - **Codex: Copy Full Session with Prompts**
   - **Codex: Show Session Execution Time and Tokens** — wall-clock span and token totals
4. Pick a session from the list (sorted by most recent; both `sessions/` and `archived_sessions/` are included)

### Keyboard Shortcuts

| Shortcut              | Command                                              |
|-----------------------|------------------------------------------------------|
| `Ctrl+Shift+Alt+C`   | Antigravity: Copy Full Conversation                   |
| `Ctrl+Shift+Alt+P`   | Antigravity: Copy Full Conversation with Prompts      |
| `Ctrl+Shift+Alt+L`   | Claude Cowork: Copy Full Session                      |
| `Ctrl+Shift+Alt+K`   | Claude Cowork: Copy Full Session with Prompts         |
| `Ctrl+Shift+Alt+J`   | Claude Code: Copy Full Session                        |
| `Ctrl+Shift+Alt+X`   | Codex: Copy Full Session                              |

On macOS, replace `Ctrl` with `Cmd`.

## Example Output

The copied Markdown reads like a natural transcript of the full session:

```markdown
**Crafting the Landing Page**

I'm currently focused on the hero section. It needs to be impactful!
I'm brainstorming visuals and headlines to capture attention...

Searched web: "Cellares IDMO Cell Shuttle branding colors and design"

The branding and color palette reflect a "sleek, smart, and refined"
aesthetic, balancing technical innovation with a futuristic vision...

Ran command
…\project > npx -y create-vite@latest ./ --template react
Exit code 0

index.css#L1-120

Prompt
Futuristic biotech manufacturing facility with glowing cyan
and aqua light trails, robotic arms, dark navy atmosphere...

Edited App.tsx
Implement the landing page with Hero, IDMO, and Stats sections.

I've completely redesigned the home page, creating a premium
landing page that showcases the IDMO platform and Cell Shuttle...
```

With the **"with Prompts"** mode, user messages appear as well:

```markdown
## User

Build a landing page for Cellares showcasing IDMO and Cell Shuttle.

**Crafting the Landing Page**

I'm currently focused on the hero section...
```

## Requirements

- **Antigravity** must be running with an active session (for Antigravity commands)
- **Claude Desktop** must have been used in Cowork mode (for Cowork commands)
- **Claude Code** CLI must have been used at least once (for Code commands)
- **Excel or PowerPoint** with the Claude add-in open + one-time debug port setup (for Office commands, Windows only)
- Works on **Windows**, **macOS**, and **Linux** (Excel scraping is Windows-only)
- No API keys or configuration needed

## How It Works

### Antigravity

1. Finds **all** `language_server` processes, ranks them by workspace match when possible, and tries to connect to each
2. Loads the self-signed certificate from the Antigravity installation
3. For each reachable server, connects via **ConnectRPC** (HTTP/2 + JSON) and calls `GetAllCascadeTrajectories`
4. Merges trajectory summaries into one list (deduplicated by conversation id), sorted by recency; each picker item remembers which server owns that chat
5. On your selection, calls `GetCascadeTrajectory` with `trajectoryVerbosity: DEBUG` on **that** server's client
6. Formats everything as clean Markdown and copies to clipboard (or analyzes step metadata for execution time / tokens)

### Claude Cowork

1. Scans Claude Desktop's local data directory for JSONL session files (handles MSIX and standard Windows paths, macOS, Linux)
2. Parses each session file to extract first prompt, model, and timestamps for the picker
3. On selection, reads all messages from the JSONL file
4. Extracts thinking blocks, text responses, tool calls, and tool results (string or structured array content)
5. Formats everything as clean Markdown and copies to clipboard (or aggregates timestamps and `usage` for stats)

### Claude Code

1. Scans `~/.claude/projects/` for JSONL session files and enriches with metadata from `~/.claude/sessions/` index
2. Parses each session file to extract first prompt, model, and timestamps for the picker
3. On selection, reads all messages from the JSONL file
4. Extracts thinking blocks, text responses, tool calls, and tool results (string or structured array content)
5. Formats everything as clean Markdown and copies to clipboard (or aggregates timestamps and `usage` for stats)

### Claude Excel & PowerPoint

1. Uses Windows process tree inspection (`Get-CimInstance Win32_Process` + `netstat`) to find the correct Office app's WebView2 process and its CDP address
2. Connects to `http://127.0.0.1:9242/json/list` or `http://[::1]:9242/json/list` to find the `pivot.claude.ai` target for the right app
3. Opens a WebSocket to the target's Chrome DevTools Protocol endpoint
4. Sends `Runtime.evaluate` to programmatically click all collapsed pills, inner tool rows, "Show more" buttons, and "Result" toggles
5. Waits for content to render, then scrapes the full `innerText` of each conversation block
6. Classifies blocks as user or assistant based on DOM structure (right-aligned gray bubbles vs. everything else)
7. Formats as clean Markdown and copies to clipboard

**One-time setup:** The `Claude Excel: Setup Debug Port` command sets the `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` user environment variable to `--remote-debugging-port=9242`. This tells all WebView2 instances (including Office add-ins) to open a CDP debug port on localhost. The variable persists across reboots. Office apps must be restarted once after setting it.

> **Note:** Port 9242 is used instead of the common 9222 to avoid conflicts with Chrome, WhatsApp, and other WebView2 apps. When both Excel and PowerPoint are open, the extension uses process tree matching to connect to the correct app.

### OpenAI Codex

1. Scans `~/.codex/sessions/YYYY/MM/DD/` and `~/.codex/archived_sessions/` for `rollout-*.jsonl` files
2. Parses each rollout to extract the session id (from the filename), `cwd` and CLI version (from `session_meta`), and the first real user prompt (skipping the auto-injected `<environment_context>` and `<permissions instructions>` blocks)
3. On selection, reads every line and classifies by `type`:
   - `response_item/message` (user/assistant) — emitted as text; developer + bootstrap user messages skipped
   - `response_item/reasoning` — skipped (Codex CoT is server-side encrypted and Codex's UI shows nothing for these); if the plaintext `summary[]` is populated, that text is emitted instead
   - `response_item/function_call` (`shell_command` / `view_image` / generic) — rendered with the matching `function_call_output` paired by `call_id` so each command appears directly above its output
   - `response_item/custom_tool_call` (`apply_patch`) — rendered via the paired `event_msg/patch_apply_end` for richer per-file output, with files sorted to match Codex's UI display order
   - `event_msg/mcp_tool_call_end` — rendered as `MCP: <server>/<tool>` with Rust `Result<T,E>` envelope unwrapped; the duplicate `function_call` + `function_call_output` pair for the same call is suppressed
   - `event_msg/web_search_end` — rendered inline as `Searched web: "<query>"` or `Opened page: <url>` based on `action.type`
   - `event_msg/image_generation_end` — emits revised prompt + call id
   - All other `event_msg` subtypes (`token_count`, `task_started`, `agent_message`, etc.) are dropped to avoid duplicates and noise
4. A pre-scan computes per-cluster rollup banners (e.g. *"Created 7 files, edited 2 files, ran 2 commands, searched web 3 times, used the browser and Node Repl"*) and injects them before the first tool of each section. Clusters split at `view_image` when the surrounding section produced tangible output (`patch_apply_end` or `image_generation_end`)
5. Formats everything as clean Markdown and copies to clipboard (or aggregates `event_msg/token_count` for stats)

## License

[MIT](LICENSE)
