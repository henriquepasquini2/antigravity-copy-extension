# Changelog

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
