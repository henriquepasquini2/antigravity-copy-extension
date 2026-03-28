import * as vscode from 'vscode';
import { discoverLanguageServer, LanguageServerInfo } from './discovery';
import { AntigravityLsClient, CascadeSummary } from './lsClient';
import { formatTrajectoryAsMarkdown, formatTrajectoryClean, injectThoughtsIntoMarkdown } from './formatter';

let cachedLsInfo: LanguageServerInfo | null = null;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'antigravity-copy-full.copyConversation',
      () => copyConversation('standard'),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.copyConversationFull',
      () => copyConversation('detailed'),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.copyConversationClean',
      () => copyConversation('clean'),
    ),
  );
}

export function deactivate() {
  cachedLsInfo = null;
}

type CopyMode = 'standard' | 'detailed' | 'clean';

async function copyConversation(mode: CopyMode) {
  try {
    const lsInfo = await discoverWithProgress();
    if (!lsInfo) return;

    const client = new AntigravityLsClient(lsInfo);

    const items = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Loading conversations...',
        cancellable: false,
      },
      async () => buildConversationItems(client),
    );

    if (items.length === 0) {
      vscode.window.showWarningMessage('No Antigravity conversations found in the current session.');
      return;
    }

    const titles: Record<CopyMode, string> = {
      standard: 'Antigravity: Copy Conversation with Thoughts',
      detailed: 'Antigravity: Copy Full Conversation Trace (Detailed)',
      clean: 'Antigravity: Copy Clean Conversation Trace',
    };

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a conversation to copy',
      title: titles[mode],
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
        progress.report({ message: 'Fetching trajectory with thoughts...' });
        let markdown: string;

        try {
          const trajectory = await client.getCascadeTrajectory(selected.conversationId, 1);

          if (mode === 'clean') {
            markdown = formatTrajectoryClean(trajectory);
          } else if (mode === 'detailed') {
            markdown = formatTrajectoryAsMarkdown(trajectory, selected.conversationId);
          } else {
            progress.report({ message: 'Getting formatted conversation...' });
            try {
              const baseMarkdown = await client.convertTrajectoryToMarkdown(selected.conversationId);
              markdown = injectThoughtsIntoMarkdown(baseMarkdown, trajectory);
            } catch {
              markdown = formatTrajectoryAsMarkdown(trajectory, selected.conversationId);
            }
          }
        } catch (err: any) {
          progress.report({ message: 'Falling back to standard copy...' });
          try {
            markdown = await client.convertTrajectoryToMarkdown(selected.conversationId);
            vscode.window.showInformationMessage(
              'Copied standard conversation (thought data was unavailable).'
            );
          } catch {
            throw new Error(`Failed to retrieve conversation: ${err?.message}`);
          }
        }

        await vscode.env.clipboard.writeText(markdown);

        const thoughtCount = countThoughts(markdown);
        const sizeStr = formatSize(markdown.length);
        vscode.window.showInformationMessage(
          `Conversation copied to clipboard (${sizeStr}, ${thoughtCount} thought blocks)`
        );
      }
    );
  } catch (err: any) {
    handleError(err);
  }
}

async function discoverWithProgress(): Promise<LanguageServerInfo | null> {
  if (cachedLsInfo) return cachedLsInfo;

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Finding Antigravity language server...',
      cancellable: false,
    },
    async () => {
      const info = await discoverLanguageServer();
      cachedLsInfo = info;
      return info;
    }
  );
}

interface ConversationPickItem extends vscode.QuickPickItem {
  conversationId: string;
}

async function buildConversationItems(client: AntigravityLsClient): Promise<ConversationPickItem[]> {
  const summaries = await client.getAllCascadeTrajectories();
  const entries = Object.entries(summaries);

  entries.sort((a, b) => {
    const tA = new Date(a[1].lastModifiedTime || a[1].createdTime).getTime();
    const tB = new Date(b[1].lastModifiedTime || b[1].createdTime).getTime();
    return tB - tA;
  });

  return entries.map(([cascadeId, info]) => {
    const modified = new Date(info.lastModifiedTime || info.createdTime);
    const timeStr = formatRelativeTime(modified);
    const label = info.summary
      ? truncate(info.summary, 80)
      : `Conversation ${cascadeId.substring(0, 8)}…`;
    const steps = info.stepCount ? `${info.stepCount} steps` : '';
    const workspace = extractWorkspaceName(info);

    const detailParts = [`ID: ${cascadeId}`, steps, workspace].filter(Boolean);

    return {
      label,
      description: timeStr,
      detail: detailParts.join(' · '),
      conversationId: cascadeId,
    };
  });
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

function countThoughts(markdown: string): number {
  return (markdown.match(/Thought Process/g) || []).length;
}

function handleError(err: any) {
  const msg = err?.message || String(err);

  if (msg.includes('Could not find')) {
    vscode.window.showErrorMessage(
      'Antigravity language server not found. Is Antigravity running?',
      'Retry'
    ).then(action => {
      if (action === 'Retry') {
        cachedLsInfo = null;
        copyConversation('standard');
      }
    });
  } else {
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
