import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { discoverLanguageServer, discoverAllLanguageServers, LanguageServerInfo } from './discovery';
import { AntigravityLsClient, CascadeSummary } from './lsClient';
import { formatTrajectoryClean } from './formatter';
import { discoverClaudeSessions, discoverClaudeCodeSessions, readSessionMessages, ClaudeSession } from './claude/sessionDiscovery';
import { formatClaudeSession } from './claude/sessionFormatter';
import { scrapeExcelConversation, isCdpAvailable, checkCdpStatus } from './claude/excelScraper';

let cachedLsInfo: LanguageServerInfo | null = null;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'antigravity-copy-full.copyConversation',
      () => copyConversation(false),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.copyConversationWithPrompts',
      () => copyConversation(true),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.dumpTrajectory',
      () => dumpTrajectory(),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.antigravityExecutionTime',
      () => antigravityExecutionTime(),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.claudeCopySession',
      () => claudeCopySession(false),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.claudeCopySessionWithPrompts',
      () => claudeCopySession(true),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.claudeDumpSession',
      () => claudeDumpSession(),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.claudeExecutionTime',
      () => claudeExecutionTime(),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.claudeCodeCopySession',
      () => claudeCodeCopySession(false),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.claudeCodeCopySessionWithPrompts',
      () => claudeCodeCopySession(true),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.claudeCodeDumpSession',
      () => claudeCodeDumpSession(),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.claudeCodeExecutionTime',
      () => claudeCodeExecutionTime(),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.claudeExcelCopy',
      () => claudeOfficeCopy(false, 'Excel', 'EXCEL.EXE'),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.claudeExcelCopyWithPrompts',
      () => claudeOfficeCopy(true, 'Excel', 'EXCEL.EXE'),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.claudeExcelSetup',
      () => claudeExcelSetup(),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.claudePptCopy',
      () => claudeOfficeCopy(false, 'PowerPoint', 'POWERPNT.EXE'),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.claudePptCopyWithPrompts',
      () => claudeOfficeCopy(true, 'PowerPoint', 'POWERPNT.EXE'),
    ),
  );
}

export function deactivate() {
  cachedLsInfo = null;
}

async function copyConversation(includePrompts: boolean) {
  try {
    const items = await discoverAndBuildConversationItems();
    if (!items) return;

    if (items.length === 0) {
      vscode.window.showWarningMessage('No Antigravity conversations found in the current session.');
      return;
    }

    const title = includePrompts
      ? 'Antigravity: Copy Full Conversation with Prompts'
      : 'Antigravity: Copy Full Conversation';

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a conversation to copy',
      title,
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) return;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Fetching conversation...',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Retrieving full trace with thoughts...' });

        const trajectory = await selected.client.getCascadeTrajectory(selected.conversationId, 1);
        const markdown = formatTrajectoryClean(trajectory, includePrompts);

        await vscode.env.clipboard.writeText(markdown);

        const sizeStr = formatSize(markdown.length);
        vscode.window.showInformationMessage(
          `Conversation copied to clipboard (${sizeStr})`
        );
      }
    );
  } catch (err: any) {
    handleError(err, includePrompts);
  }
}

async function dumpTrajectory() {
  try {
    const items = await discoverAndBuildConversationItems();
    if (!items) return;

    if (items.length === 0) {
      vscode.window.showWarningMessage('No Antigravity conversations found.');
      return;
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a conversation to dump',
      title: 'Antigravity: Dump Raw Trajectory (Debug)',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) return;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Dumping trajectory...',
        cancellable: false,
      },
      async () => {
        const trajectory = await selected.client.getCascadeTrajectory(selected.conversationId, 1);
        const json = JSON.stringify(trajectory, null, 2);

        const defaultName = `trajectory-${selected.conversationId.substring(0, 8)}.json`;
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(
            path.join(
              vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || require('os').homedir(),
              defaultName
            )
          ),
          filters: { 'JSON': ['json'] },
        });

        if (!saveUri) return;

        fs.writeFileSync(saveUri.fsPath, json, 'utf-8');

        const sizeKb = (json.length / 1024).toFixed(1);
        const action = await vscode.window.showInformationMessage(
          `Trajectory dumped (${sizeKb} KB): ${saveUri.fsPath}`,
          'Open File'
        );
        if (action === 'Open File') {
          const doc = await vscode.workspace.openTextDocument(saveUri);
          await vscode.window.showTextDocument(doc);
        }
      }
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(`Antigravity Dump: ${err?.message || String(err)}`);
  }
}

async function antigravityExecutionTime() {
  try {
    const items = await discoverAndBuildConversationItems();
    if (!items) return;

    if (items.length === 0) {
      vscode.window.showWarningMessage('No Antigravity conversations found.');
      return;
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a conversation to analyze',
      title: 'Antigravity: Show Session Execution Time and Tokens',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) return;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Analyzing trajectory...',
        cancellable: false,
      },
      async () => {
        const trajectory = await selected.client.getCascadeTrajectory(selected.conversationId, 1);
        const steps = trajectory?.trajectory?.steps || [];
        
        let firstTime = 0;
        let lastTime = 0;
        let inputTokens = 0;
        let outputTokens = 0;

        for (const step of steps) {
          const meta = step.metadata;
          if (meta) {
            if (meta.createdAt) {
              const t = new Date(meta.createdAt).getTime();
              if (!firstTime || t < firstTime) firstTime = t;
              if (!lastTime || t > lastTime) lastTime = t;
            }
            if (meta.startedAt) {
              const t = new Date(meta.startedAt).getTime();
               if (!firstTime || t < firstTime) firstTime = t;
               if (!lastTime || t > lastTime) lastTime = t;
            }
            if (meta.completedAt) {
              const t = new Date(meta.completedAt).getTime();
               if (!firstTime || t < firstTime) firstTime = t;
               if (!lastTime || t > lastTime) lastTime = t;
            }
            
            if (meta.modelUsage) {
                inputTokens += parseInt(meta.modelUsage.inputTokens || '0', 10);
                outputTokens += parseInt(meta.modelUsage.outputTokens || '0', 10);
            }
          }
        }

        if (!firstTime || !lastTime || firstTime === lastTime) {
            vscode.window.showInformationMessage('Could not calculate duration from timestamps in this trajectory.');
            return;
        }

        const durationMs = lastTime - firstTime;
        const durationStr = formatDuration(durationMs);

        vscode.window.showInformationMessage(
          `Total execution time: ${durationStr}\nTotal Input Tokens: ${inputTokens}\nTotal Output Tokens: ${outputTokens}`,
          { modal: true }
        );
      }
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(`Antigravity Execution Time: ${err?.message || String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Claude Cowork commands
// ---------------------------------------------------------------------------

async function claudeCopySession(includePrompts: boolean) {
  try {
    const session = await pickClaudeSession(
      includePrompts
        ? 'Claude: Copy Full Session with Prompts'
        : 'Claude: Copy Full Session',
    );
    if (!session) return;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Reading Claude session...',
        cancellable: false,
      },
      async () => {
        const messages = readSessionMessages(session.filePath);
        const markdown = formatClaudeSession(messages, includePrompts);

        await vscode.env.clipboard.writeText(markdown);

        const sizeStr = formatSize(markdown.length);
        vscode.window.showInformationMessage(
          `Claude session copied to clipboard (${sizeStr})`
        );
      },
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(
      `Claude Copy: ${err?.message || String(err)}`
    );
  }
}

async function claudeDumpSession() {
  try {
    const session = await pickClaudeSession('Claude: Dump Raw Session (Debug)');
    if (!session) return;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Dumping Claude session...',
        cancellable: false,
      },
      async () => {
        const messages = readSessionMessages(session.filePath);
        const json = JSON.stringify(messages, null, 2);

        const defaultName = `claude-session-${path.basename(session.filePath, '.jsonl').substring(0, 8)}.json`;
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(
            path.join(
              vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || require('os').homedir(),
              defaultName,
            ),
          ),
          filters: { 'JSON': ['json'] },
        });

        if (!saveUri) return;

        fs.writeFileSync(saveUri.fsPath, json, 'utf-8');

        const sizeKb = (json.length / 1024).toFixed(1);
        const action = await vscode.window.showInformationMessage(
          `Session dumped (${sizeKb} KB): ${saveUri.fsPath}`,
          'Open File',
        );
        if (action === 'Open File') {
          const doc = await vscode.workspace.openTextDocument(saveUri);
          await vscode.window.showTextDocument(doc);
        }
      },
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(
      `Claude Dump: ${err?.message || String(err)}`
    );
  }
}

async function claudeExecutionTime() {
  try {
    const session = await pickClaudeSession('Claude Cowork: Show Session Execution Time and Tokens');
    if (!session) return;
    await analyzeClaudeSessionTimeAndTokens(session, 'Claude Cowork Execution Time');
  } catch (err: any) {
    vscode.window.showErrorMessage(`Claude Cowork Execution Time: ${err?.message || String(err)}`);
  }
}

interface ClaudeSessionPickItem extends vscode.QuickPickItem {
  session: ClaudeSession;
}

async function pickClaudeSession(title: string): Promise<ClaudeSession | undefined> {
  const sessions = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Scanning for Claude Cowork sessions...',
      cancellable: false,
    },
    async () => discoverClaudeSessions(),
  );

  if (sessions.length === 0) {
    vscode.window.showWarningMessage(
      'No Claude Cowork sessions found. Make sure Claude Desktop has been used with Cowork mode.'
    );
    return undefined;
  }

  const items: ClaudeSessionPickItem[] = sessions.map(s => {
    const timeStr = formatRelativeTime(s.modified);
    const label = s.firstPrompt
      ? truncate(s.firstPrompt, 80)
      : s.sessionName;
    const sizeStr = s.sizeBytes < 1024
      ? `${s.sizeBytes} B`
      : `${(s.sizeBytes / 1024).toFixed(0)} KB`;
    const model = s.model || '';
    const detailParts = [s.sessionName, model, sizeStr].filter(Boolean);

    return {
      label,
      description: timeStr,
      detail: detailParts.join(' · '),
      session: s,
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a Claude session to copy',
    title,
    matchOnDescription: true,
    matchOnDetail: true,
  });

  return selected?.session;
}

// ---------------------------------------------------------------------------
// Claude Code commands
// ---------------------------------------------------------------------------

async function claudeCodeCopySession(includePrompts: boolean) {
  try {
    const session = await pickClaudeCodeSession(
      includePrompts
        ? 'Claude Code: Copy Full Session with Prompts'
        : 'Claude Code: Copy Full Session',
    );
    if (!session) return;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Reading Claude Code session...',
        cancellable: false,
      },
      async () => {
        const messages = readSessionMessages(session.filePath);
        const markdown = formatClaudeSession(messages, includePrompts);

        await vscode.env.clipboard.writeText(markdown);

        const sizeStr = formatSize(markdown.length);
        vscode.window.showInformationMessage(
          `Claude Code session copied to clipboard (${sizeStr})`
        );
      },
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(
      `Claude Code Copy: ${err?.message || String(err)}`
    );
  }
}

async function claudeCodeDumpSession() {
  try {
    const session = await pickClaudeCodeSession('Claude Code: Dump Raw Session (Debug)');
    if (!session) return;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Dumping Claude Code session...',
        cancellable: false,
      },
      async () => {
        const messages = readSessionMessages(session.filePath);
        const json = JSON.stringify(messages, null, 2);

        const defaultName = `claude-code-session-${path.basename(session.filePath, '.jsonl').substring(0, 8)}.json`;
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(
            path.join(
              vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || require('os').homedir(),
              defaultName,
            ),
          ),
          filters: { 'JSON': ['json'] },
        });

        if (!saveUri) return;

        fs.writeFileSync(saveUri.fsPath, json, 'utf-8');

        const sizeKb = (json.length / 1024).toFixed(1);
        const action = await vscode.window.showInformationMessage(
          `Session dumped (${sizeKb} KB): ${saveUri.fsPath}`,
          'Open File',
        );
        if (action === 'Open File') {
          const doc = await vscode.workspace.openTextDocument(saveUri);
          await vscode.window.showTextDocument(doc);
        }
      },
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(
      `Claude Code Dump: ${err?.message || String(err)}`
    );
  }
}

async function analyzeClaudeSessionTimeAndTokens(session: ClaudeSession, title: string) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Calculating execution time and tokens...',
      cancellable: false,
    },
    async () => {
      const messages = readSessionMessages(session.filePath);
      if (messages.length === 0) {
        vscode.window.showInformationMessage('Session has no messages.');
        return;
      }

      let firstTime = 0;
      let lastTime = 0;
      let inputTokens = 0;
      let outputTokens = 0;

      for (const msg of messages) {
          if (msg.timestamp) {
              const t = new Date(msg.timestamp).getTime();
              if (!firstTime || t < firstTime) firstTime = t;
              if (!lastTime || t > lastTime) lastTime = t;
          }
          if (msg.type === 'assistant') {
              const usage = msg.message?.usage || msg.usage;
              if (usage) {
                  inputTokens += usage.input_tokens || 0;
                  outputTokens += usage.output_tokens || 0;
              }
          }
      }

      if (!firstTime || !lastTime || firstTime === lastTime) {
          vscode.window.showInformationMessage('Could not calculate duration from timestamps in this session.');
          return;
      }

      const durationMs = lastTime - firstTime;
      const durationStr = formatDuration(durationMs);

      vscode.window.showInformationMessage(
        `Total execution time: ${durationStr}\nTotal Input Tokens: ${inputTokens}\nTotal Output Tokens: ${outputTokens}`,
        { modal: true }
      );
    },
  );
}

async function claudeCodeExecutionTime() {
  try {
    const session = await pickClaudeCodeSession('Claude Code: Show Session Execution Time and Tokens');
    if (!session) return;
    await analyzeClaudeSessionTimeAndTokens(session, 'Claude Code Execution Time');
  } catch (err: any) {
    vscode.window.showErrorMessage(
      `Claude Code Execution Time: ${err?.message || String(err)}`
    );
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remainingSec = sec % 60;
  if (min < 60) return `${min}m ${remainingSec}s`;
  const hr = Math.floor(min / 60);
  const remainingMin = min % 60;
  return `${hr}h ${remainingMin}m ${remainingSec}s`;
}

async function pickClaudeCodeSession(title: string): Promise<ClaudeSession | undefined> {
  const sessions = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Scanning for Claude Code sessions...',
      cancellable: false,
    },
    async () => discoverClaudeCodeSessions(),
  );

  if (sessions.length === 0) {
    vscode.window.showWarningMessage(
      'No Claude Code sessions found. Make sure you have used Claude Code at least once.'
    );
    return undefined;
  }

  const items: ClaudeSessionPickItem[] = sessions.map(s => {
    const timeStr = formatRelativeTime(s.modified);
    const label = s.firstPrompt
      ? truncate(s.firstPrompt, 80)
      : s.sessionName;
    const sizeStr = s.sizeBytes < 1024
      ? `${s.sizeBytes} B`
      : `${(s.sizeBytes / 1024).toFixed(0)} KB`;
    const model = s.model || '';
    const detailParts = [s.sessionName, model, sizeStr].filter(Boolean);

    return {
      label,
      description: timeStr,
      detail: detailParts.join(' · '),
      session: s,
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a Claude Code session to copy',
    title,
    matchOnDescription: true,
    matchOnDetail: true,
  });

  return selected?.session;
}

// ---------------------------------------------------------------------------
// Claude Excel commands
// ---------------------------------------------------------------------------

async function claudeOfficeCopy(includePrompts: boolean, appName: string, appExe?: string) {
  try {
    const status = await checkCdpStatus(9242, appExe);
    if (status === 'no-cdp') {
      const action = await vscode.window.showErrorMessage(
        `Cannot connect to the WebView2 debug port. Run "Claude Excel: Setup Debug Port" first, then restart ${appName}.`,
        'Run Setup',
      );
      if (action === 'Run Setup') {
        await claudeExcelSetup();
      }
      return;
    }
    if (status === 'no-claude') {
      vscode.window.showErrorMessage(
        `Debug port is active but the Claude add-in was not found. Make sure ${appName} is open with the Claude add-in visible.`
      );
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Scraping Claude ${appName} conversation...`,
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Expanding tool sections...' });
        const markdown = await scrapeExcelConversation(9242, includePrompts, appExe);

        await vscode.env.clipboard.writeText(markdown);

        const sizeStr = formatSize(markdown.length);
        vscode.window.showInformationMessage(
          `Claude ${appName} conversation copied to clipboard (${sizeStr})`
        );
      },
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(
      `Claude ${appName} Copy: ${err?.message || String(err)}`
    );
  }
}

async function claudeExcelSetup() {
  const cp = require('child_process') as typeof import('child_process');

  const already = await isCdpAvailable();
  if (already) {
    vscode.window.showInformationMessage(
      'Debug port is already active. You can use "Claude Excel: Copy Full Session" now.'
    );
    return;
  }

  const envVal = await new Promise<string | undefined>((resolve) => {
    cp.exec(
      'powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS\', \'User\')"',
      (err, stdout) => resolve(err ? undefined : stdout.trim() || undefined),
    );
  });

  if (envVal?.includes('remote-debugging-port')) {
    vscode.window.showWarningMessage(
      'Environment variable is set but the debug port is not responding. Restart Excel and/or PowerPoint to activate it.'
    );
    return;
  }

  const confirm = await vscode.window.showInformationMessage(
    'This will set a user environment variable to enable the WebView2 debug port for Office apps. ' +
    'You will need to restart Excel/PowerPoint once after this.',
    'Set Variable',
    'Cancel',
  );

  if (confirm !== 'Set Variable') return;

  await new Promise<void>((resolve, reject) => {
    cp.exec(
      'powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable(\'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS\', \'--remote-debugging-port=9242\', \'User\')"',
      (err) => err ? reject(err) : resolve(),
    );
  });

  vscode.window.showInformationMessage(
    'Environment variable set. Close and reopen Excel/PowerPoint, then open the Claude add-in. ' +
    'After that, the Claude Excel and PowerPoint copy commands will work.'
  );
}

// ---------------------------------------------------------------------------
// Antigravity helpers
// ---------------------------------------------------------------------------

async function discoverWithProgress(): Promise<LanguageServerInfo | null> {
  // Always re-discover to pick up new language server processes
  // (e.g. when user opens a new Antigravity chat window).
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Finding Antigravity language server...',
      cancellable: false,
    },
    async () => {
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const info = await discoverLanguageServer(workspacePath);
      cachedLsInfo = info;
      return info;
    }
  );
}

interface ConversationPickItem extends vscode.QuickPickItem {
  conversationId: string;
  client: AntigravityLsClient;
}

/**
 * Discovers all running language servers and builds a merged list of
 * conversations from all of them. Shows a single progress notification.
 */
async function discoverAndBuildConversationItems(): Promise<ConversationPickItem[] | null> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Finding Antigravity conversations...',
      cancellable: false,
    },
    async () => {
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const allServers = await discoverAllLanguageServers(workspacePath);

      // Update cached info with the first (best-ranked) server for error handling
      if (allServers.length > 0) {
        cachedLsInfo = allServers[0];
      }

      // Query all servers in parallel and merge results
      const seen = new Set<string>();
      const allItems: ConversationPickItem[] = [];

      const results = await Promise.allSettled(
        allServers.map(async (info) => {
          const client = new AntigravityLsClient(info);
          const summaries = await client.getAllCascadeTrajectories();
          return { client, summaries };
        })
      );

      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const { client, summaries } = result.value;

        for (const [cascadeId, info] of Object.entries(summaries)) {
          if (seen.has(cascadeId)) continue;
          seen.add(cascadeId);

          const modified = new Date(info.lastModifiedTime || info.createdTime);
          const timeStr = formatRelativeTime(modified);
          const label = info.summary
            ? truncate(info.summary, 80)
            : `Conversation ${cascadeId.substring(0, 8)}…`;
          const steps = info.stepCount ? `${info.stepCount} steps` : '';
          const workspace = extractWorkspaceName(info);

          const detailParts = [`ID: ${cascadeId}`, steps, workspace].filter(Boolean);

          allItems.push({
            label,
            description: timeStr,
            detail: detailParts.join(' · '),
            conversationId: cascadeId,
            client,
          });
        }
      }

      // Sort all items by most recent first
      allItems.sort((a, b) => {
        const parseTime = (item: ConversationPickItem) => {
          const desc = item.description || '';
          if (desc === 'just now') return Date.now();
          const mMatch = desc.match(/(\d+)m ago/);
          if (mMatch) return Date.now() - parseInt(mMatch[1]) * 60000;
          const hMatch = desc.match(/(\d+)h ago/);
          if (hMatch) return Date.now() - parseInt(hMatch[1]) * 3600000;
          const dMatch = desc.match(/(\d+)d ago/);
          if (dMatch) return Date.now() - parseInt(dMatch[1]) * 86400000;
          return 0;
        };
        return parseTime(b) - parseTime(a);
      });

      return allItems;
    }
  );
}

function extractWorkspaceName(info: CascadeSummary): string {
  const uri = info.workspaces?.[0]?.workspaceFolderAbsoluteUri || '';
  if (!uri) return '';
  const decoded = decodeURIComponent(uri.replace('file:///', ''));
  const parts = decoded.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

function truncate(text: string, maxLen: number): string {
  const oneLine = text.replace(/[\r\n]+/g, ' ').trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.substring(0, maxLen - 1) + '…';
}

let retrying = false;
const outputChannel = vscode.window.createOutputChannel('Antigravity Copy');

function logDiagnostics(context: string) {
  if (!cachedLsInfo) {
    outputChannel.appendLine(`[${context}] No cached LS info`);
    return;
  }
  const info = cachedLsInfo;
  outputChannel.appendLine(`[${context}] PID: ${info.pid}`);
  outputChannel.appendLine(`[${context}] HTTPS port: ${info.httpsPort}`);
  outputChannel.appendLine(`[${context}] CSRF token: ${info.csrfToken.substring(0, 8)}…`);
  outputChannel.appendLine(`[${context}] Workspace ID: ${info.workspaceId}`);
  outputChannel.appendLine(`[${context}] Cert path: ${info.certPath}`);
}

function handleError(err: any, includePrompts: boolean) {
  const msg = err?.message || String(err);

  if (msg.includes('Could not find')) {
    vscode.window.showErrorMessage(
      'Antigravity language server not found. Is Antigravity running?',
      'Retry'
    ).then(action => {
      if (action === 'Retry') {
        cachedLsInfo = null;
        copyConversation(includePrompts);
      }
    });
  } else if (msg.includes('returned 403') && !retrying) {
    outputChannel.appendLine(`\n=== 403 Error at ${new Date().toISOString()} ===`);
    logDiagnostics('before-retry');
    outputChannel.show(true);

    retrying = true;
    cachedLsInfo = null;
    vscode.window.showInformationMessage(
      'Antigravity Copy: CSRF mismatch — rediscovering language server...'
    );
    copyConversation(includePrompts).finally(() => {
      logDiagnostics('after-retry');
      retrying = false;
    });
  } else {
    retrying = false;
    if (msg.includes('403')) {
      outputChannel.appendLine(`\n=== Persistent 403 at ${new Date().toISOString()} ===`);
      logDiagnostics('persistent-403');
      outputChannel.show(true);
    }
    vscode.window.showErrorMessage(`Antigravity Copy: ${msg}`);
  }
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function formatSize(chars: number): string {
  if (chars < 1024) return `${chars} chars`;
  return `${(chars / 1024).toFixed(1)} KB`;
}
