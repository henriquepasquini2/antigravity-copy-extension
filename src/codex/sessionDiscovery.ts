import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CodexSession {
  /** Absolute path to the .jsonl rollout file */
  filePath: string;
  /** Session id (UUIDv7 from the rollout filename) */
  sessionId: string;
  /** Workspace cwd from session_meta */
  cwd?: string;
  /** Working-directory basename used as a friendly label */
  sessionName: string;
  /** File modification time */
  modified: Date;
  /** File size in bytes */
  sizeBytes: number;
  /** First non-bootstrap user prompt (extracted lazily) */
  firstPrompt?: string;
  /** Model provider (e.g. "openai") */
  modelProvider?: string;
  /** Codex CLI version */
  cliVersion?: string;
  /** Timestamp of session_meta */
  startTime?: string;
  /** Whether the session came from sessions/ or archived_sessions/ */
  archived: boolean;
}

/**
 * Codex stores rollout JSONL files on disk at:
 *   - %USERPROFILE%\.codex\sessions\YYYY\MM\DD\rollout-<ts>-<uuid>.jsonl  (current)
 *   - %USERPROFILE%\.codex\archived_sessions\rollout-<ts>-<uuid>.jsonl   (archived)
 * Same layout on macOS/Linux under ~/.codex.
 */
function codexDataRoot(): string {
  return path.join(os.homedir(), '.codex');
}

/**
 * Recursively collect all rollout-*.jsonl files under a directory.
 */
function findRolloutFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const queue = [dir];

  while (queue.length > 0) {
    const current = queue.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
      } else if (
        entry.isFile() &&
        entry.name.startsWith('rollout-') &&
        entry.name.endsWith('.jsonl')
      ) {
        results.push(full);
      }
    }
  }

  return results;
}

/**
 * Extracts the session id from a rollout filename like
 * `rollout-2026-05-22T21-37-04-019e5243-8ecb-7c93-89e6-1393978d3aa4.jsonl`.
 * Falls back to the basename when the pattern doesn't match.
 */
function sessionIdFromFilename(filePath: string): string {
  const base = path.basename(filePath, '.jsonl');
  // Last 5 dash-separated groups form the UUID.
  const parts = base.split('-');
  if (parts.length >= 5) {
    return parts.slice(-5).join('-');
  }
  return base;
}

/**
 * Reads enough of the rollout file to populate metadata fields. Stops as soon
 * as session_meta and the first real user prompt are both found.
 */
function extractSessionMeta(
  filePath: string,
): Pick<CodexSession, 'cwd' | 'firstPrompt' | 'modelProvider' | 'cliVersion' | 'startTime'> {
  const meta: ReturnType<typeof extractSessionMeta> = {};

  try {
    const stat = fs.statSync(filePath);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(Math.min(stat.size, 96 * 1024));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);

    const chunk = buf.toString('utf-8');
    const lines = chunk.split('\n').filter((l) => l.trim());

    for (const line of lines) {
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        // The buffer might cut a line mid-JSON — skip silently.
        continue;
      }

      if (obj.type === 'session_meta' && obj.payload) {
        meta.cwd = obj.payload.cwd || meta.cwd;
        meta.modelProvider = obj.payload.model_provider || meta.modelProvider;
        meta.cliVersion = obj.payload.cli_version || meta.cliVersion;
        meta.startTime = obj.payload.timestamp || obj.timestamp || meta.startTime;
      }

      if (!meta.firstPrompt && isRealUserPrompt(obj)) {
        meta.firstPrompt = extractMessageText(obj);
      }

      if (meta.cwd && meta.firstPrompt) break;
    }
  } catch {
    /* file read error — return what we have */
  }

  return meta;
}

/**
 * A "real" user prompt is a response_item/message with role=user whose content
 * isn't the auto-injected `<environment_context>` bootstrap block.
 */
function isRealUserPrompt(obj: any): boolean {
  if (obj.type !== 'response_item') return false;
  const p = obj.payload;
  if (p?.type !== 'message' || p.role !== 'user') return false;
  const text = extractMessageText(obj);
  if (!text) return false;
  return !text.includes('<environment_context>') &&
    !text.includes('<permissions instructions>');
}

function extractMessageText(obj: any): string {
  const content = obj?.payload?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
    .join('')
    .trim();
}

/**
 * Friendly session label: the workspace folder basename when we know the cwd,
 * otherwise the short session id.
 */
function deriveSessionName(cwd: string | undefined, sessionId: string): string {
  if (cwd) {
    const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return sessionId.substring(0, 8);
}

/**
 * Discovers every Codex rollout file under ~/.codex/sessions and
 * ~/.codex/archived_sessions. Returns them sorted by mtime (newest first).
 */
export function discoverCodexSessions(): CodexSession[] {
  const root = codexDataRoot();
  if (!fs.existsSync(root)) return [];

  const sessionsDir = path.join(root, 'sessions');
  const archivedDir = path.join(root, 'archived_sessions');

  const sessions: CodexSession[] = [];

  const addFrom = (dir: string, archived: boolean) => {
    for (const filePath of findRolloutFiles(dir)) {
      try {
        const stat = fs.statSync(filePath);
        const sessionId = sessionIdFromFilename(filePath);
        const meta = extractSessionMeta(filePath);
        sessions.push({
          filePath,
          sessionId,
          archived,
          modified: stat.mtime,
          sizeBytes: stat.size,
          sessionName: deriveSessionName(meta.cwd, sessionId),
          ...meta,
        });
      } catch {
        /* skip unreadable files */
      }
    }
  };

  addFrom(sessionsDir, false);
  addFrom(archivedDir, true);

  sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return sessions;
}

/**
 * Reads and parses every line of a Codex rollout file. Returns the raw line
 * objects so the formatter can decide what to keep — discovery doesn't filter.
 */
export function readCodexMessages(filePath: string): any[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const messages: any[] = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line));
    } catch {
      /* skip malformed lines */
    }
  }

  return messages;
}
