# Changelog

## [1.8.0] - 2026-04-05

### Added
- **Claude PowerPoint session support** — same scraping approach as Excel, reusing the same CDP connection to `pivot.claude.ai`.
- Two new commands under the **Claude PowerPoint** category:
  - **Claude PowerPoint: Copy Full Session** — copies the assistant's response with all tool content expanded.
  - **Claude PowerPoint: Copy Full Session with Prompts** — same, plus user messages with `## User` / `## Assistant` headers.
- Uses the same one-time debug port setup as Excel (the `Claude Excel: Setup Debug Port` command applies to all Office WebView2 instances).

## [1.7.0] - 2026-04-05

### Added
- **Claude Excel session support** — copy the full conversation from Claude's Excel add-in, including all tool calls, code blocks, parameters, results, and search outputs that are normally hidden behind expandable pills.
- Three new commands under the **Claude Excel** category:
  - **Claude Excel: Copy Full Session** — copies the assistant's response with all tool content expanded.
  - **Claude Excel: Copy Full Session with Prompts** — same, plus user messages with `## User` / `## Assistant` headers.
  - **Claude Excel: Setup Debug Port** — one-time setup that enables the WebView2 debug port (requires Excel restart).
- Auto-expands all collapsed tool pills, inner tool rows, "Show more" buttons, and "Result" toggles before scraping.
- Connects to the Excel WebView2 via Chrome DevTools Protocol on port 9222.
- Handles IPv4/IPv6 port conflicts when multiple WebView2 apps (e.g. WhatsApp) share the same port.

### Changed
- Removed HTML `<details>` wrappers from thinking blocks and large tool outputs. All content now emits as plain text for a cleaner clipboard, consistent with the Antigravity formatter.

## [1.6.1] - 2026-04-03

### Changed
- Removed HTML `<details>` wrappers from thinking blocks and large tool outputs. All content now emits as plain text for a cleaner clipboard, consistent with the Antigravity formatter.

## [1.6.0] - 2026-04-03

### Added
- **Claude Code session support** — copy the full conversation trace from Claude Code CLI sessions, including extended thinking blocks, tool calls, and responses.
- Three new commands under the **Claude Code** category:
  - **Claude Code: Copy Full Session** (`Ctrl+Shift+Alt+J`) — copies reasoning, tools, and responses as Markdown.
  - **Claude Code: Copy Full Session with Prompts** — same, plus user messages.
  - **Claude Code: Dump Raw Session (Debug)** — exports the parsed session as JSON for inspection.
- Session discovery reads `~/.claude/projects/` and enriches with metadata from `~/.claude/sessions/` index files.

### Changed
- Command categories renamed from `Claude` to `Claude Cowork` and `Claude Code` for clarity in the command palette.

## [1.5.0] - 2026-04-03

### Added
- **Claude Cowork session support** — copy the full conversation trace from Claude Desktop's Cowork mode, including extended thinking blocks, tool calls, web searches, file operations, and assistant responses.
- Three new commands under the **Claude Cowork** category:
  - **Claude Cowork: Copy Full Session** (`Ctrl+Shift+Alt+L`) — copies reasoning, tools, and responses as Markdown.
  - **Claude Cowork: Copy Full Session with Prompts** (`Ctrl+Shift+Alt+K`) — same, plus user messages.
  - **Claude Cowork: Dump Raw Session (Debug)** — exports the parsed session as JSON for inspection.
- Session discovery automatically finds Claude Desktop's JSONL session files across Windows (MSIX and standard), macOS, and Linux.
- Session picker shows the first user prompt, session name, model, file size, and relative time.
- Thinking blocks are formatted as collapsible `<details>` sections in Markdown.
- Tool calls formatted per type: Bash commands in code blocks, file operations with paths, web searches with queries, todo lists with checkboxes.
- Large tool outputs (>2 KB) are wrapped in collapsible sections to keep the Markdown readable.

## [1.4.0] - 2026-03-31

### Added
- **Full browser sub-agent support** — conversations that use the browser sub-agent now include the task name, goal, all internal thinking/scratchpad blocks, browser actions (navigation, clicks, key presses), the sub-agent's result, and playback availability. Previously only the initial instruction was captured.
- New step type handlers: `OPEN_BROWSER_URL`, `CLICK_BROWSER_PIXEL`, `BROWSER_PRESS_KEY`, `WAIT`.
- Generic fallback for unknown step types that carry a `subtrajectory` — future sub-agent types will automatically have their nested steps formatted instead of silently dropped.

### Changed
- Refactored step processing into a reusable `emitSteps()` function that supports recursive formatting of nested subtrajectories.

### Fixed
- Browser sub-agent result no longer appears duplicated when the subtrajectory's last planner response already contains the same text.

## [1.3.1] - 2026-03-28

### Fixed
- Fixed netstat PID matching on Windows using exact column comparison instead of substring search, which could match ports from unrelated processes and cause 403 or SSL errors.
- On 403, the extension now logs full discovery diagnostics (PID, port, CSRF token prefix, workspace ID) to the "Antigravity Copy" Output panel to help debug persistent issues.

## [1.3.0] - 2026-03-28

### Added
- **Dump Raw Trajectory (Debug)** command (`Ctrl+Shift+P` → "Antigravity: Dump Raw Trajectory") — exports the full raw trajectory JSON for a selected conversation to a file. Useful for debugging formatting issues across different Antigravity versions.

## [1.2.0] - 2026-03-28

### Fixed
- **403 CSRF mismatch** when multiple Antigravity windows are open. Discovery now finds all language server processes and matches the correct one by workspace path.
- Automatic retry on 403: clears the cached server info and rediscovers the correct language server.

### Changed
- Discovery now encodes the current workspace folder path and compares it against each language server's `--workspace_id` argument to pick the right process.
- If workspace matching fails, falls back to trying each process sequentially.

## [1.1.1] - 2026-03-28

### Fixed
- Fixed SSL `WRONG_VERSION_NUMBER` error on some systems where the HTTPS port wasn't the lowest-numbered port. Discovery now probes each candidate port with a TLS handshake instead of guessing by port number order.

## [1.1.0] - 2026-03-28

### Added
- **Copy Full Conversation with Prompts** command (`Ctrl+Shift+Alt+P`) — includes user messages with `## User` headers in addition to the full AI trace.

## [1.0.2] - 2026-03-28

### Fixed
- Removed ephemeral system messages (internal Antigravity prompts like `bash_command_reminder`, `artifact_reminder`, `active_task_reminder`) that were polluting the output with large repeated blocks.

## [1.0.1] - 2026-03-28

### Fixed
- Updated README to reflect the single-mode design.
- Removed dead code (`emitUserInput` function that was no longer called).
- Added `*.vsix` to `.vscodeignore`.

## [1.0.0] - 2026-03-28

### Changed
- **Breaking:** Consolidated three commands (Standard, Detailed, Clean) into a single **Copy Full Conversation** command.
- Completely rewrote the formatter by inspecting raw trajectory data to fix all field name mappings.
- User input is no longer included in the default output (response-only).

### Fixed
- `listDirectory.directoryPathUri` was mapped as `directoryPath` — directories showed empty paths.
- `viewFile.absolutePathUri` was mapped as `filePath` — file views showed empty paths.
- `runCommand.commandLine` was mapped as `command` — commands were missing.
- `commandStatus.combined` was mapped as `output` — command outputs were missing.
- `codeAction` file path was not extracted from `metadata.toolCall.argumentsJson.TargetFile` — code edits showed empty filenames.
- `plannerResponse.modifiedResponse` (the actual AI text) was not being read — final assistant responses were missing entirely.
- Duplicate output from `RUN_COMMAND` and `COMMAND_STATUS` steps for the same command.

### Added
- Support for all 18+ trajectory step types: `SEARCH_WEB`, `GENERATE_IMAGE`, `GREP_SEARCH`, `BROWSER_SUBAGENT`, `NOTIFY_USER`, `ERROR_MESSAGE`, `READ_RESOURCE`, `COMMAND_STATUS`, `CODE_ACKNOWLEDGEMENT`, `CONVERSATION_HISTORY`, `TASK_BOUNDARY`.
- Web search results now include the full summary with sources.
- Image generation steps now show the prompt and local file path.
- Command execution steps now show the command line, working directory, output, and exit code.
- Code edit steps now show the filename and description.

## [0.4.0] - 2026-03-28

### Fixed
- Conversations are now listed using `GetAllCascadeTrajectories` RPC, showing server-generated titles instead of unreadable UUIDs.
- Fixed "trajectory not found" errors caused by listing disk-based `.pb` files that weren't loaded in the current language server session.
- Quick pick title now updates dynamically based on the selected copy mode.

## [0.3.1] - 2026-03-28

### Changed
- Removed explicit AI training references from the Clean trace command name and descriptions.

## [0.3.0] - 2026-03-28

### Added
- **Copy Clean Conversation Trace** command — minimal role-annotated format for structured export.

## [0.2.0] - 2026-03-28

### Added
- Conversation picker now shows the first user message as a preview instead of raw UUIDs.

## [0.1.0] - 2026-03-28

### Added
- Initial release with three copy modes: Standard, Detailed, and Clean.
- Automatic language server discovery (CSRF token, HTTPS port, certificate).
- ConnectRPC client for `GetCascadeTrajectory` and `ConvertTrajectoryToMarkdown`.
- Thought process extraction via `trajectoryVerbosity: DEBUG`.
