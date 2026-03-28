import * as cp from 'child_process';
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
 */
export async function discoverLanguageServer(): Promise<LanguageServerInfo> {
  const lsProcess = await findLanguageServerProcess();

  const csrfToken = extractArg(lsProcess.commandLine, '--csrf_token');
  const workspaceId = extractArg(lsProcess.commandLine, '--workspace_id');

  if (!csrfToken) {
    throw new Error('Could not extract CSRF token from language server process');
  }

  const ports = await findListeningPorts(lsProcess.pid);
  if (ports.length < 2) {
    throw new Error(`Expected at least 2 listening ports, found ${ports.length}`);
  }

  // The LS typically binds ports sequentially:
  // smallest = httpsPort, next = httpPort, largest = lspPort
  ports.sort((a, b) => a - b);
  const [httpsPort, httpPort, ...rest] = ports;
  const lspPort = rest.length > 0 ? rest[rest.length - 1] : httpPort + 1;

  const certPath = findCertPath();

  return {
    csrfToken,
    httpsPort,
    httpPort,
    lspPort,
    pid: lsProcess.pid,
    workspaceId: workspaceId || '',
    certPath,
  };
}

interface ProcessInfo {
  pid: number;
  commandLine: string;
}

async function findLanguageServerProcess(): Promise<ProcessInfo> {
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

        try {
          let processes = JSON.parse(stdout.trim());
          if (!Array.isArray(processes)) processes = [processes];

          for (const proc of processes) {
            const cmdLine = proc.CommandLine || '';
            const pid = proc.ProcessId;
            if (cmdLine.includes('--csrf_token') && typeof pid === 'number') {
              resolve({ pid, commandLine: cmdLine });
              return;
            }
          }
        } catch {
          // JSON parse failed — no matching processes
        }

        reject(new Error(
          'Could not find the Antigravity language server process. ' +
          'Make sure Antigravity is running with an active chat session.'
        ));
      });
    } else {
      cp.exec('ps aux', { maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
        if (err) {
          reject(new Error(`Failed to list processes: ${err.message}`));
          return;
        }

        for (const line of stdout.split('\n')) {
          if (line.includes('language_server') && line.includes('--csrf_token') && !line.includes('grep')) {
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[1], 10);
            resolve({ pid, commandLine: line });
            return;
          }
        }

        reject(new Error(
          'Could not find the Antigravity language server process. ' +
          'Make sure Antigravity is running with an active chat session.'
        ));
      });
    }
  });
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
      ? `netstat -ano | findstr "LISTENING" | findstr "${pid}"`
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
          const match = line.match(/127\.0\.0\.1:(\d+)/);
          if (match) {
            ports.push(parseInt(match[1], 10));
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
