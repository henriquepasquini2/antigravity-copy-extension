import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ClaudeSession {
  /** Absolute path to the .jsonl file */
  filePath: string;
  /** Human-readable session name extracted from the directory path */
  sessionName: string;
  /** File modification time */
  modified: Date;
  /** File size in bytes */
  sizeBytes: number;
  /** First user prompt (extracted lazily) */
  firstPrompt?: string;
  /** Model used (extracted lazily) */
  model?: string;
  /** Timestamp of first message */
  startTime?: string;
}

/**
 * Finds the Claude Desktop data root.
 *
 * On Windows MSIX: %LOCALAPPDATA%\Packages\Claude_<hash>\LocalCache\Roaming\Claude
 * On Windows non-MSIX: %APPDATA%\Claude
 * On macOS: ~/Library/Application Support/Claude
 * On Linux: ~/.config/Claude
 */
function findClaudeDataRoots(): string[] {
  const roots: string[] = [];
  const platform = os.platform();

  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    if (localAppData) {
      const packagesDir = path.join(localAppData, 'Packages');
      if (fs.existsSync(packagesDir)) {
        try {
          for (const entry of fs.readdirSync(packagesDir)) {
            if (entry.startsWith('Claude_')) {
              const msixRoot = path.join(
                packagesDir, entry, 'LocalCache', 'Roaming', 'Claude',
              );
              if (fs.existsSync(msixRoot)) roots.push(msixRoot);
            }
          }
        } catch { /* permission denied, etc. */ }
      }
    }

    const appData = process.env.APPDATA || '';
    if (appData) {
      const roamingRoot = path.join(appData, 'Claude');
      if (fs.existsSync(roamingRoot)) roots.push(roamingRoot);
    }
  } else if (platform === 'darwin') {
    const macRoot = path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
    if (fs.existsSync(macRoot)) roots.push(macRoot);
  } else {
    const linuxRoot = path.join(os.homedir(), '.config', 'Claude');
    if (fs.existsSync(linuxRoot)) roots.push(linuxRoot);
  }

  return roots;
}

/**
 * Recursively finds all .jsonl files under a directory, excluding audit.jsonl.
 */
function findJsonlFiles(dir: string): string[] {
  const results: string[] = [];
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
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.jsonl') &&
        entry.name !== 'audit.jsonl'
      ) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Extracts a human-readable session name from the JSONL file path.
 * Paths contain `-sessions-<adjective-adjective-name>` directories.
 */
function extractSessionName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/-sessions-([^/]+)/);
  if (match) {
    return match[1]
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  const basename = path.basename(filePath, '.jsonl');
  return basename.substring(0, 8);
}

/**
 * Reads the first few lines of a JSONL file to extract the first user prompt,
 * the model name, and the earliest timestamp.
 */
function extractSessionMeta(filePath: string): Pick<ClaudeSession, 'firstPrompt' | 'model' | 'startTime'> {
  let firstPrompt: string | undefined;
  let model: string | undefined;
  let startTime: string | undefined;

  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(Math.min(fs.statSync(filePath).size, 64 * 1024));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);

    const chunk = buf.toString('utf-8');
    const lines = chunk.split('\n').filter(l => l.trim());

    for (const line of lines.slice(0, 20)) {
      try {
        const obj = JSON.parse(line);

        if (!startTime && obj.timestamp) {
          startTime = obj.timestamp;
        }

        if (!firstPrompt && obj.type === 'user' && obj.message?.role === 'user') {
          const content = obj.message.content;
          if (typeof content === 'string') {
            firstPrompt = content;
          } else if (Array.isArray(content)) {
            const textBlock = content.find((b: any) => b.type === 'text');
            if (textBlock?.text) firstPrompt = textBlock.text;
          }
        }

        if (!model && obj.type === 'assistant' && obj.message?.model) {
          model = obj.message.model;
        }

        if (firstPrompt && model && startTime) break;
      } catch { /* skip malformed lines */ }
    }
  } catch { /* file read error */ }

  return { firstPrompt, model, startTime };
}

/**
 * Discovers all Claude Cowork session files on the local machine.
 * Returns them sorted by modification time (most recent first).
 */
export function discoverClaudeSessions(): ClaudeSession[] {
  const roots = findClaudeDataRoots();
  const sessions: ClaudeSession[] = [];

  for (const root of roots) {
    const sessionsDir = path.join(root, 'local-agent-mode-sessions');
    if (!fs.existsSync(sessionsDir)) continue;

    const jsonlFiles = findJsonlFiles(sessionsDir);

    for (const filePath of jsonlFiles) {
      try {
        const stat = fs.statSync(filePath);
        const meta = extractSessionMeta(filePath);
        sessions.push({
          filePath,
          sessionName: extractSessionName(filePath),
          modified: stat.mtime,
          sizeBytes: stat.size,
          ...meta,
        });
      } catch { /* skip unreadable files */ }
    }
  }

  sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return sessions;
}

/**
 * Reads and parses all lines from a JSONL session file.
 * Skips queue-operation and last-prompt metadata lines.
 */
export function readSessionMessages(filePath: string): any[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const messages: any[] = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'queue-operation' || obj.type === 'last-prompt') continue;
      messages.push(obj);
    } catch { /* skip malformed lines */ }
  }

  return messages;
}
