# Antigravity Copy Full Conversation

Copy the **complete** trace of Antigravity chat conversations — including the AI's **thought process and reasoning** — to your clipboard as Markdown.

## The Problem

Antigravity's built-in Export and Copy buttons only include the visible output text. The AI's internal reasoning (the "thinking" / "thought process") is stripped out entirely. If you want to review, share, or archive the full conversation — thoughts included — there's no native way to do it.

## The Solution

This extension connects directly to the running Antigravity language server and fetches the full conversation trajectory at **DEBUG verbosity**, which includes the thought/reasoning data that the standard UI omits.

## Features

- **Full thought process** — Every thinking block the AI produced, with duration
- **Complete tool trace** — File reads, directory listings, command executions, code edits with diffs
- **Two output modes:**
  - *Copy Conversation with Thoughts* — Antigravity's standard markdown + thought blocks prepended
  - *Copy Full Conversation Trace* — Detailed custom format with inline thoughts, tool calls, and code actions
- **Collapsible sections** — Thoughts wrapped in `<details>` tags for clean Markdown
- **Conversation picker** — Select from all your conversations, sorted by recency
- **Zero configuration** — Automatically discovers the language server, ports, and auth tokens

## Usage

1. Make sure **Antigravity is running** with at least one chat conversation
2. Open the Command Palette (`Ctrl+Shift+P`)
3. Run one of:
   - **Antigravity: Copy Conversation with Thoughts**
   - **Antigravity: Copy Full Conversation Trace (Detailed)**
4. Pick the conversation from the list
5. Done — the full Markdown is on your clipboard

### Keyboard Shortcuts

| Shortcut              | Command                                    |
|-----------------------|--------------------------------------------|
| `Ctrl+Shift+Alt+C`   | Copy Conversation with Thoughts            |
| `Ctrl+Shift+Alt+T`   | Copy Full Conversation Trace (Detailed)    |

On macOS, replace `Ctrl` with `Cmd`.

## Example Output

The copied Markdown includes sections like:

```markdown
## Turn 1 — User

Build a REST API for user management.

<details>
<summary><strong>Thought Process (3.9s)</strong></summary>

I need to set up a Node.js project with Express. Let me first
check the current directory structure and existing dependencies...

</details>

### Assistant Response

I'll create a REST API with the following endpoints...
```

## Requirements

- **Antigravity** must be running with an active session
- Works on **Windows**, **macOS**, and **Linux**
- No API keys or configuration needed

## How It Works

1. Finds the `language_server` process and extracts the CSRF token + HTTPS port from its command line
2. Loads the self-signed certificate from the Antigravity installation
3. Connects via **ConnectRPC** (HTTP/2 + JSON) to the language server
4. Calls `GetCascadeTrajectory` with `trajectoryVerbosity: DEBUG` to fetch the full trace including thoughts
5. Formats everything as clean Markdown and copies to clipboard

## License

[MIT](LICENSE)
