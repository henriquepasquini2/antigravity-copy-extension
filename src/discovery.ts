import * as cp from 'child_process';
import * as tls from 'tls';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export interface LanguageServerInfo {
  csrfToken: string;
  httpsPort: number;
  httpPort: number;
  lspPort: number;
  pid: number;
  workspaceId: string;
  certPath: string;
}

/**
 * Discovers the running Antigravity language server by inspecting process
 * command lines. Extracts the CSRF token and finds the listening ports.
 *
 * When multiple language servers are running (multiple Antigravity windows),
 * pass workspaceFolderPath so we can match the correct one via --workspace_id.
 */
export async function discoverLanguageServer(workspaceFolderPath?: string): Promise<LanguageServerInfo> {
  const allProcesses = await findAllLanguageServerProcesses();
  const certPath = findCertPath();

  const ranked = rankProcessesByWorkspace(allProcesses, workspaceFolderPath);

  let lastError: Error | undefined;
  for (const proc of ranked) {
    try {
      return await buildLsInfo(proc, certPath);
    } catch (err: any) {
      lastError = err;
    }
  }

  throw lastError ?? new Error(
    'Could not find the Antigravity language server process. ' +
    'Make sure Antigravity is running with an active chat session.'
  );
}

async function buildLsInfo(proc: ProcessInfo, certPath: string): Promise<LanguageServerInfo> {
  const csrfToken = extractArg(proc.commandLine, '--csrf_token');
  const workspaceId = extractArg(proc.commandLine, '--workspace_id');

  if (!csrfToken) {
    throw new Error('Could not extract CSRF token from language server process');
  }

  const ports = await findListeningPorts(proc.pid);
  if (ports.length < 2) {
    throw new Error(`Expected at least 2 listening ports, found ${ports.length}`);
  }

  const httpsPort = await probeForHttpsPort(ports, certPath);
  const nonHttps = ports.filter(p => p !== httpsPort);
  nonHttps.sort((a, b) => a - b);
  const httpPort = nonHttps[0] ?? httpsPort + 1;
  const lspPort = nonHttps.length > 1 ? nonHttps[nonHttps.length - 1] : httpPort + 1;

  return {
    csrfToken,
    httpsPort,
    httpPort,
    lspPort,
    pid: proc.pid,
    workspaceId: workspaceId || '',
    certPath,
  };
}

interface ProcessInfo {
  pid: number;
  commandLine: string;
}

async function findAllLanguageServerProcesses(): Promise<ProcessInfo[]> {
  return new Promise((resolve, reject) => {
    const isWindows = os.platform() === 'win32';

    if (isWindows) {
      const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*language_server*' } | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress`;
      const psCmd = `powershell -NoProfile -Command "${script}"`;

      cp.exec(psCmd, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
        if (err) {
          reject(new Error(`Failed to list processes: ${err.message}`));
          return;
        }

        const results: ProcessInfo[] = [];
        try {
          let processes = JSON.parse(stdout.trim());
          if (!Array.isArray(processes)) processes = [processes];

          for (const proc of processes) {
            const cmdLine = proc.CommandLine || '';
            const pid = proc.ProcessId;
            if (cmdLine.includes('--csrf_token') && typeof pid === 'number') {
              results.push({ pid, commandLine: cmdLine });
            }
          }
        } catch {
          // JSON parse failed — no matching processes
        }

        if (results.length === 0) {
          reject(new Error(
            'Could not find the Antigravity language server process. ' +
            'Make sure Antigravity is running with an active chat session.'
          ));
        } else {
          resolve(results);
        }
      });
    } else {
      cp.exec('ps aux', { maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
        if (err) {
          reject(new Error(`Failed to list processes: ${err.message}`));
          return;
        }

        const results: ProcessInfo[] = [];
        for (const line of stdout.split('\n')) {
          if (line.includes('language_server') && line.includes('--csrf_token') && !line.includes('grep')) {
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[1], 10);
            results.push({ pid, commandLine: line });
          }
        }

        if (results.length === 0) {
          reject(new Error(
            'Could not find the Antigravity language server process. ' +
            'Make sure Antigravity is running with an active chat session.'
          ));
        } else {
          resolve(results);
        }
      });
    }
  });
}

/**
 * Sorts processes so the one matching the current workspace comes first.
 * workspace_id encodes the path by replacing : → _3A, / and - → _.
 * We encode our workspace path the same way for a reliable comparison.
 */
function rankProcessesByWorkspace(processes: ProcessInfo[], workspacePath?: string): ProcessInfo[] {
  if (!workspacePath || processes.length <= 1) return processes;

  const encoded = encodeAsWorkspaceId(workspacePath);

  return [...processes].sort((a, b) => {
    const aWsId = (extractArg(a.commandLine, '--workspace_id') || '').toLowerCase();
    const bWsId = (extractArg(b.commandLine, '--workspace_id') || '').toLowerCase();
    const aMatch = aWsId === encoded ? 0 : 1;
    const bMatch = bWsId === encoded ? 0 : 1;
    return aMatch - bMatch;
  });
}

function encodeAsWorkspaceId(folderPath: string): string {
  let p = folderPath.replace(/\\/g, '/').replace(/\/$/, '').replace(/^\//, '');
  p = p.replace(/:/g, '_3A');
  p = p.replace(/[/\-]/g, '_');
  return ('file_' + p).toLowerCase();
}

function extractArg(commandLine: string, argName: string): string | undefined {
  const regex = new RegExp(`${argName}\\s+(\\S+)`);
  const match = commandLine.match(regex);
  return match?.[1];
}

async function findListeningPorts(pid: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const isWindows = os.platform() === 'win32';
    const cmd = isWindows
      ? `netstat -ano | findstr "LISTENING"`
      : `lsof -iTCP -sTCP:LISTEN -nP -p ${pid}`;

    cp.exec(cmd, (err, stdout) => {
      if (err) {
        reject(new Error(`Failed to find listening ports: ${err.message}`));
        return;
      }

      const ports: number[] = [];
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (isWindows) {
          const trimmed = line.trim();
          const columns = trimmed.split(/\s+/);
          const linePid = parseInt(columns[columns.length - 1], 10);
          if (linePid !== pid) continue;

          const addrMatch = trimmed.match(/127\.0\.0\.1:(\d+)/);
          if (addrMatch) {
            ports.push(parseInt(addrMatch[1], 10));
          }
        } else {
          const match = line.match(/:(\d+)\s/);
          if (match) {
            ports.push(parseInt(match[1], 10));
          }
        }
      }
      resolve([...new Set(ports)]);
    });
  });
}

/**
 * Probes each candidate port with a TLS handshake to find the HTTPS port.
 * Falls back to smallest-port heuristic if no probe succeeds.
 */
async function probeForHttpsPort(ports: number[], certPath: string): Promise<number> {
  const ca = fs.existsSync(certPath) ? fs.readFileSync(certPath) : undefined;

  const probe = (port: number): Promise<boolean> =>
    new Promise(resolve => {
      const socket = tls.connect(
        { host: '127.0.0.1', port, ca, rejectUnauthorized: false, timeout: 2000 },
        () => { socket.destroy(); resolve(true); }
      );
      socket.on('error', () => { socket.destroy(); resolve(false); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
    });

  const results = await Promise.all(ports.map(async p => ({ port: p, ok: await probe(p) })));
  const tlsPorts = results.filter(r => r.ok).map(r => r.port);

  if (tlsPorts.length > 0) {
    tlsPorts.sort((a, b) => a - b);
    return tlsPorts[0];
  }

  // Fallback: assume smallest port is HTTPS (original heuristic)
  const sorted = [...ports].sort((a, b) => a - b);
  return sorted[0];
}

function findCertPath(): string {
  const possiblePaths = [
    // Production
    path.join(
      os.homedir(),
      'AppData', 'Local', 'Programs', 'Antigravity',
      'resources', 'app', 'extensions', 'antigravity', 'dist', 'languageServer', 'cert.pem'
    ),
    // macOS
    path.join(
      '/Applications', 'Antigravity.app', 'Contents', 'Resources',
      'app', 'extensions', 'antigravity', 'dist', 'languageServer', 'cert.pem'
    ),
    // Linux
    path.join(
      '/usr', 'share', 'antigravity',
      'resources', 'app', 'extensions', 'antigravity', 'dist', 'languageServer', 'cert.pem'
    ),
    // Dev mode
    path.join(
      os.homedir(),
      'AppData', 'Local', 'Programs', 'Antigravity',
      'resources', 'app', 'extensions', 'antigravity', 'dist', 'cert.pem'
    ),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  throw new Error(
    'Could not find the Antigravity language server certificate. ' +
    'Checked paths:\n' + possiblePaths.join('\n')
  );
}

/**
 * Lists conversation IDs from the .gemini/antigravity/conversations directory.
 */
export function listConversations(): { id: string; modified: Date }[] {
  const conversationsDir = path.join(os.homedir(), '.gemini', 'antigravity', 'conversations');
  if (!fs.existsSync(conversationsDir)) {
    return [];
  }

  return fs.readdirSync(conversationsDir)
    .filter(f => f.endsWith('.pb'))
    .map(f => ({
      id: f.replace('.pb', ''),
      modified: fs.statSync(path.join(conversationsDir, f)).mtime,
    }))
    .sort((a, b) => b.modified.getTime() - a.modified.getTime());
}
