# Antigravity Copy Full Conversation

Copy the **complete** trace of **Antigravity**, **Claude Cowork**, and **Claude Code** conversations — including the AI's **thought process** / **extended thinking**, web searches, image prompts, command outputs, code edits, and full responses — to your clipboard as Markdown.

## The Problem

Antigravity's built-in Export and Copy buttons only include the visible output text. Claude Desktop's Cowork mode and Claude Code CLI have no export at all. The AI's internal reasoning (the "thinking" / "thought process") is stripped out, and many details like web search results, command outputs, and file contents are omitted or summarized. If you want the full, unabridged conversation trace, there's no native way to get it.

## The Solution

This extension provides three integrations:

- **Antigravity** — connects directly to the running language server and fetches the full conversation trajectory at **DEBUG verbosity**, which includes everything the standard UI omits.
- **Claude Cowork** — reads the JSONL session files that Claude Desktop writes to disk, extracting extended thinking blocks, tool calls, and responses that the UI doesn't let you copy.
- **Claude Code** — reads the JSONL session files from `~/.claude/projects/`, capturing the same extended thinking, tool calls, and responses from Claude Code CLI sessions.

The output is a clean Markdown trace in chat order — no HTML, no metadata, no truncation.

## Features

### Antigravity
- **Full thought process** — Every thinking block the AI produced, inline in chat order
- **Complete tool trace** — Web searches (with full results), directory listings, file views, command executions with output, code edits, image generation prompts, grep searches, browser actions, and more
- **All 18+ step types** — `SEARCH_WEB`, `RUN_COMMAND`, `COMMAND_STATUS`, `LIST_DIRECTORY`, `VIEW_FILE`, `CODE_ACTION`, `GENERATE_IMAGE`, `GREP_SEARCH`, `BROWSER_SUBAGENT`, `NOTIFY_USER`, `ERROR_MESSAGE`, `READ_RESOURCE`, and others
- **Full assistant responses** — The actual AI text response, not just tool call summaries

### Claude Cowork & Claude Code
- **Extended thinking blocks** — Full reasoning from Claude's extended thinking, formatted as collapsible sections
- **Complete tool trace** — Bash commands, file reads/writes/edits, web searches, web fetches, glob/grep searches, MCP tool calls, and more
- **Todo lists** — TodoWrite calls rendered as checkbox lists
- **Large output handling** — Tool outputs over 2 KB are wrapped in collapsible sections

### Shared
- **Two copy modes** — Response-only (default) or with user prompts included
- **Conversation picker** — Select from all active conversations with titles, sorted by recency
- **Zero configuration** — Automatically discovers data sources (language server for Antigravity, session files for Claude)

## Usage

### Antigravity

1. Make sure **Antigravity is running** with at least one chat conversation
2. Open the Command Palette (`Ctrl+Shift+P`)
3. Run one of:
   - **Antigravity: Copy Full Conversation** — AI response only (thoughts, tools, output)
   - **Antigravity: Copy Full Conversation with Prompts** — Same, but also includes user messages
4. Pick the conversation from the list
5. Done — the full Markdown is on your clipboard

### Claude Cowork

1. Use **Claude Desktop** in Cowork mode for at least one session
2. Open the Command Palette (`Ctrl+Shift+P`)
3. Run one of:
   - **Claude Cowork: Copy Full Session** — Extended thinking, tools, and responses
   - **Claude Cowork: Copy Full Session with Prompts** — Same, plus user messages
4. Pick the session from the list (shows first prompt, model, and size)
5. Done — the full Markdown is on your clipboard

### Claude Code

1. Use **Claude Code** CLI for at least one session
2. Open the Command Palette (`Ctrl+Shift+P`)
3. Run one of:
   - **Claude Code: Copy Full Session** — Extended thinking, tools, and responses
   - **Claude Code: Copy Full Session with Prompts** — Same, plus user messages
4. Pick the session from the list (shows first prompt, model, and size)
5. Done — the full Markdown is on your clipboard

### Keyboard Shortcuts

| Shortcut              | Command                                              |
|-----------------------|------------------------------------------------------|
| `Ctrl+Shift+Alt+C`   | Antigravity: Copy Full Conversation                   |
| `Ctrl+Shift+Alt+P`   | Antigravity: Copy Full Conversation with Prompts      |
| `Ctrl+Shift+Alt+L`   | Claude Cowork: Copy Full Session                      |
| `Ctrl+Shift+Alt+K`   | Claude Cowork: Copy Full Session with Prompts         |
| `Ctrl+Shift+Alt+J`   | Claude Code: Copy Full Session                        |

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
- Works on **Windows**, **macOS**, and **Linux**
- No API keys or configuration needed

## How It Works

### Antigravity

1. Finds the `language_server` process and extracts the CSRF token + HTTPS port from its command line
2. Loads the self-signed certificate from the Antigravity installation
3. Connects via **ConnectRPC** (HTTP/2 + JSON) to the language server
4. Calls `GetCascadeTrajectory` with `trajectoryVerbosity: DEBUG` to fetch the full trace including thoughts
5. Formats everything as clean Markdown and copies to clipboard

### Claude Cowork

1. Scans Claude Desktop's local data directory for JSONL session files (handles MSIX and standard Windows paths, macOS, Linux)
2. Parses each session file to extract first prompt, model, and timestamps for the picker
3. On selection, reads all messages from the JSONL file
4. Extracts thinking blocks, text responses, tool calls, and tool results
5. Formats everything as clean Markdown and copies to clipboard

### Claude Code

1. Scans `~/.claude/projects/` for JSONL session files and enriches with metadata from `~/.claude/sessions/` index
2. Parses each session file to extract first prompt, model, and timestamps for the picker
3. On selection, reads all messages from the JSONL file
4. Extracts thinking blocks, text responses, tool calls, and tool results
5. Formats everything as clean Markdown and copies to clipboard

## License

[MIT](LICENSE)
