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

    const client = new AntigravityLsClient(lsInfo);

    const items = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Loading conversations...',
        cancellable: false,
      },
      async () => {
        const previews = await fetchConversationPreviews(client, conversations);
        return previews;
      }
    );

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a conversation to copy',
      title: 'Antigravity: Copy Full Conversation (with Thoughts)',
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

          if (fullFormat) {
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

async function fetchConversationPreviews(
  client: AntigravityLsClient,
  conversations: { id: string; modified: Date }[],
): Promise<ConversationPickItem[]> {
  const BATCH_SIZE = 5;
  const results: ConversationPickItem[] = [];

  for (let i = 0; i < conversations.length; i += BATCH_SIZE) {
    const batch = conversations.slice(i, i + BATCH_SIZE);
    const previews = await Promise.allSettled(
      batch.map(c => getFirstUserMessage(client, c.id))
    );

    for (let j = 0; j < batch.length; j++) {
      const c = batch[j];
      const result = previews[j];
      const preview = result.status === 'fulfilled' ? result.value : '';
      const timeStr = formatRelativeTime(c.modified);

      results.push({
        label: preview
          ? truncate(preview, 80)
          : `Conversation ${c.id.substring(0, 8)}...`,
        description: timeStr,
        detail: preview
          ? `ID: ${c.id}`
          : `ID: ${c.id} — Last modified: ${c.modified.toLocaleString()}`,
        conversationId: c.id,
      });
    }
  }

  return results;
}

async function getFirstUserMessage(client: AntigravityLsClient, cascadeId: string): Promise<string> {
  const traj = await client.getCascadeTrajectory(cascadeId, 2);
  const steps = traj?.trajectory?.steps || [];

  for (const step of steps) {
    if (step.type === 'CORTEX_STEP_TYPE_USER_INPUT') {
      const input = step.userInput;
      if (!input) continue;
      const text = input.userResponse || input.items?.map((i: any) => i.text).join(' ') || '';
      if (text.trim()) return text.trim();
    }
  }

  return '';
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
