import * as vscode from 'vscode';
import { discoverLanguageServer, listConversations, LanguageServerInfo } from './discovery';
import { AntigravityLsClient } from './lsClient';
import { formatTrajectoryAsMarkdown, injectThoughtsIntoMarkdown } from './formatter';

let cachedLsInfo: LanguageServerInfo | null = null;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'antigravity-copy-full.copyConversation',
      () => copyConversation(false),
    ),
    vscode.commands.registerCommand(
      'antigravity-copy-full.copyConversationFull',
      () => copyConversation(true),
    ),
  );
}

export function deactivate() {
  cachedLsInfo = null;
}

async function copyConversation(fullFormat: boolean) {
  try {
    const lsInfo = await discoverWithProgress();
    if (!lsInfo) return;

    const conversations = listConversations();
    if (conversations.length === 0) {
      vscode.window.showWarningMessage(
        'No Antigravity conversations found.'
      );
      return;
    }

    const selected = await vscode.window.showQuickPick(
      conversations.map(c => ({
        label: c.id,
        description: formatRelativeTime(c.modified),
        detail: `Last modified: ${c.modified.toLocaleString()}`,
        conversationId: c.id,
      })),
      {
        placeHolder: 'Select a conversation to copy',
        title: 'Antigravity: Copy Full Conversation (with Thoughts)',
      }
    );

    if (!selected) return;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Fetching conversation...',
        cancellable: false,
      },
      async (progress) => {
        const client = new AntigravityLsClient(lsInfo);

        // Verify connection
        progress.report({ message: 'Connecting to language server...' });
        try {
          await client.heartbeat();
        } catch {
          cachedLsInfo = null;
          throw new Error(
            'Cannot connect to the Antigravity language server. ' +
            'It may have restarted. Please try again.'
          );
        }

        // Get the full trajectory with DEBUG verbosity (includes thoughts)
        progress.report({ message: 'Fetching trajectory with thoughts...' });
        let markdown: string;

        try {
          const trajectory = await client.getCascadeTrajectory(selected.conversationId, 1);

          if (fullFormat) {
            // Format the full trajectory ourselves (most detailed)
            markdown = formatTrajectoryAsMarkdown(trajectory, selected.conversationId);
          } else {
            // Get the standard markdown and inject thoughts
            progress.report({ message: 'Getting formatted conversation...' });
            try {
              const baseMarkdown = await client.convertTrajectoryToMarkdown(selected.conversationId);
              markdown = injectThoughtsIntoMarkdown(baseMarkdown, trajectory);
            } catch {
              markdown = formatTrajectoryAsMarkdown(trajectory, selected.conversationId);
            }
          }
        } catch (err: any) {
          // Fallback: standard markdown without thoughts
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
        copyConversation(false);
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
