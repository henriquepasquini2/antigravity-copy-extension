/**
 * Formats the full Antigravity conversation trajectory as markdown,
 * including the AI's thought process from each planner response.
 *
 * Trajectory step types:
 *   CORTEX_STEP_TYPE_USER_INPUT        -> userInput
 *   CORTEX_STEP_TYPE_PLANNER_RESPONSE  -> plannerResponse (has .thinking, .thinkingDuration)
 *   CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE -> ephemeralMessage (system prompts)
 *   CORTEX_STEP_TYPE_LIST_DIRECTORY    -> listDirectory
 *   CORTEX_STEP_TYPE_VIEW_FILE         -> viewFile
 *   CORTEX_STEP_TYPE_RUN_COMMAND       -> runCommand
 *   CORTEX_STEP_TYPE_COMMAND_STATUS    -> commandStatus
 *   CORTEX_STEP_TYPE_CODE_ACTION       -> codeAction
 *   CORTEX_STEP_TYPE_CHECKPOINT        -> checkpoint
 */

export interface FormatOptions {
  includeThoughts: boolean;
  includeEphemeral: boolean;
  includeMetadata: boolean;
  collapsibleThoughts: boolean;
}

const defaultOptions: FormatOptions = {
  includeThoughts: true,
  includeEphemeral: false,
  includeMetadata: false,
  collapsibleThoughts: true,
};

export function formatTrajectoryAsMarkdown(
  trajectoryResponse: any,
  conversationId: string,
  opts: Partial<FormatOptions> = {},
): string {
  const options = { ...defaultOptions, ...opts };
  const lines: string[] = [];

  lines.push(`# Antigravity Conversation`);
  lines.push('');
  lines.push(`**Conversation ID:** \`${conversationId}\``);
  lines.push(`**Exported at:** ${new Date().toISOString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  const steps = trajectoryResponse?.trajectory?.steps || [];
  if (steps.length === 0) {
    lines.push('*No steps found in this conversation.*');
    return lines.join('\n');
  }

  let turnNumber = 0;

  for (const step of steps) {
    const type = step.type || '';

    switch (type) {
      case 'CORTEX_STEP_TYPE_USER_INPUT':
        turnNumber++;
        formatUserInput(step, turnNumber, lines);
        break;

      case 'CORTEX_STEP_TYPE_PLANNER_RESPONSE':
        formatPlannerResponse(step, lines, options);
        break;

      case 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE':
        if (options.includeEphemeral) {
          formatEphemeralMessage(step, lines);
        }
        break;

      case 'CORTEX_STEP_TYPE_LIST_DIRECTORY':
        formatListDirectory(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_VIEW_FILE':
        formatViewFile(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_RUN_COMMAND':
        formatRunCommand(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_COMMAND_STATUS':
        formatCommandStatus(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_CODE_ACTION':
        formatCodeAction(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_CHECKPOINT':
        break;

      default:
        if (options.includeMetadata) {
          lines.push(`> *Step type: ${type}*`);
          lines.push('');
        }
    }
  }

  return lines.join('\n');
}

function formatUserInput(step: any, turnNumber: number, lines: string[]): void {
  const input = step.userInput;
  if (!input) return;

  const text = input.userResponse || input.items?.map((i: any) => i.text).join('\n') || '';
  if (!text) return;

  lines.push(`## Turn ${turnNumber} — User`);
  lines.push('');
  lines.push(text);
  lines.push('');
}

function formatPlannerResponse(step: any, lines: string[], options: FormatOptions): void {
  const response = step.plannerResponse;
  if (!response) return;

  // Thought process
  if (options.includeThoughts && response.thinking) {
    const duration = response.thinkingDuration
      ? ` (${parseDuration(response.thinkingDuration)})`
      : '';

    if (options.collapsibleThoughts) {
      lines.push(`<details>`);
      lines.push(`<summary><strong>Thought Process${duration}</strong></summary>`);
      lines.push('');
      lines.push(response.thinking);
      lines.push('');
      lines.push(`</details>`);
    } else {
      lines.push(`### Thought Process${duration}`);
      lines.push('');
      lines.push(response.thinking);
    }
    lines.push('');
  }

  // Main response text
  if (response.text || response.content || response.markdown) {
    lines.push('### Assistant Response');
    lines.push('');
    lines.push(response.text || response.content || response.markdown);
    lines.push('');
  }

  // Tool calls within the planner response
  if (response.toolCalls && response.toolCalls.length > 0) {
    for (const tc of response.toolCalls) {
      lines.push(`**Tool Call:** \`${tc.name || tc.toolName || 'unknown'}\``);
      if (tc.arguments) {
        lines.push('```json');
        lines.push(typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments, null, 2));
        lines.push('```');
      }
      lines.push('');
    }
  }
}

function formatEphemeralMessage(step: any, lines: string[]): void {
  const msg = step.ephemeralMessage;
  if (!msg?.content) return;

  lines.push('<details>');
  lines.push('<summary><em>System Message</em></summary>');
  lines.push('');
  lines.push(msg.content);
  lines.push('');
  lines.push('</details>');
  lines.push('');
}

function formatListDirectory(step: any, lines: string[]): void {
  const dir = step.listDirectory;
  if (!dir) return;

  const dirPath = dir.directoryPath || dir.directory_path || dir.path || '';
  lines.push(`*Listed directory \`${dirPath}\`*`);

  if (dir.entries && dir.entries.length > 0) {
    const maxShow = 20;
    const entries = dir.entries.slice(0, maxShow);
    lines.push('');
    lines.push('<details>');
    lines.push(`<summary>Directory contents (${dir.entries.length} items)</summary>`);
    lines.push('');
    for (const entry of entries) {
      const name = entry.name || entry.fileName || '';
      const isDir = entry.isDirectory || entry.type === 'directory';
      lines.push(`- ${isDir ? '📁' : '📄'} ${name}`);
    }
    if (dir.entries.length > maxShow) {
      lines.push(`- ... and ${dir.entries.length - maxShow} more`);
    }
    lines.push('');
    lines.push('</details>');
  }
  lines.push('');
}

function formatViewFile(step: any, lines: string[]): void {
  const vf = step.viewFile;
  if (!vf) return;

  const filePath = vf.filePath || vf.file_path || vf.path || '';
  lines.push(`*Viewed file \`${filePath}\`*`);
  lines.push('');
}

function formatRunCommand(step: any, lines: string[]): void {
  const cmd = step.runCommand;
  if (!cmd) return;

  const command = cmd.command || cmd.input || '';
  if (!command) return;

  lines.push(`**Run Command:**`);
  lines.push('```bash');
  lines.push(command);
  lines.push('```');
  lines.push('');
}

function formatCommandStatus(step: any, lines: string[]): void {
  const cs = step.commandStatus;
  if (!cs) return;

  if (cs.output) {
    lines.push('<details>');
    lines.push('<summary>Command Output</summary>');
    lines.push('');
    lines.push('```');
    const output = cs.output.length > 5000
      ? cs.output.substring(0, 5000) + '\n... (truncated)'
      : cs.output;
    lines.push(output);
    lines.push('```');
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
}

function formatCodeAction(step: any, lines: string[]): void {
  const ca = step.codeAction;
  if (!ca) return;

  const filePath = ca.filePath || ca.file_path || ca.uri || '';
  const description = ca.description || ca.title || '';

  lines.push(`**Code Edit:** \`${filePath}\``);
  if (description) {
    lines.push(`*${description}*`);
  }

  if (ca.unifiedDiff || ca.diff) {
    const diff = ca.unifiedDiff || ca.diff;
    const diffStr = typeof diff === 'string' ? diff : (diff.diff || JSON.stringify(diff, null, 2));
    lines.push('');
    lines.push('```diff');
    const truncated = diffStr.length > 5000
      ? diffStr.substring(0, 5000) + '\n... (truncated)'
      : diffStr;
    lines.push(truncated);
    lines.push('```');
  }
  lines.push('');
}

/**
 * Clean trace format with minimal markup.
 * No generated metadata, no HTML, no truncation, no decorative markup.
 * Every step preserved, thoughts inline, role-annotated.
 */
export function formatTrajectoryClean(trajectoryResponse: any): string {
  const steps = trajectoryResponse?.trajectory?.steps || [];
  if (steps.length === 0) return '';

  const lines: string[] = [];

  for (const step of steps) {
    const type = step.type || '';

    switch (type) {
      case 'CORTEX_STEP_TYPE_USER_INPUT': {
        const input = step.userInput;
        if (!input) break;
        const text = input.userResponse || input.items?.map((i: any) => i.text).join('\n') || '';
        if (text.trim()) {
          lines.push('## User');
          lines.push('');
          lines.push(text.trim());
          lines.push('');
        }
        break;
      }

      case 'CORTEX_STEP_TYPE_PLANNER_RESPONSE': {
        const pr = step.plannerResponse;
        if (!pr) break;

        if (pr.thinking) {
          lines.push('## Thinking');
          lines.push('');
          lines.push(pr.thinking);
          lines.push('');
        }

        const responseText = pr.text || pr.content || pr.markdown || '';
        if (responseText) {
          lines.push('## Assistant');
          lines.push('');
          lines.push(responseText);
          lines.push('');
        }

        if (pr.toolCalls && pr.toolCalls.length > 0) {
          for (const tc of pr.toolCalls) {
            const name = tc.name || tc.toolName || 'unknown';
            lines.push(`## Tool Call: ${name}`);
            lines.push('');
            if (tc.arguments) {
              lines.push('```json');
              lines.push(typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments, null, 2));
              lines.push('```');
            }
            lines.push('');
          }
        }
        break;
      }

      case 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE': {
        const msg = step.ephemeralMessage;
        if (msg?.content) {
          lines.push('## System');
          lines.push('');
          lines.push(msg.content);
          lines.push('');
        }
        break;
      }

      case 'CORTEX_STEP_TYPE_LIST_DIRECTORY': {
        const dir = step.listDirectory;
        if (!dir) break;
        const dirPath = dir.directoryPath || dir.directory_path || dir.path || '';
        lines.push(`## Tool Result: list_dir`);
        lines.push('');
        lines.push(`Directory: ${dirPath}`);
        if (dir.entries && dir.entries.length > 0) {
          lines.push('');
          for (const entry of dir.entries) {
            const name = entry.name || entry.fileName || '';
            const isDir = entry.isDirectory || entry.type === 'directory';
            lines.push(`${isDir ? '[dir]' : '[file]'} ${name}`);
          }
        }
        lines.push('');
        break;
      }

      case 'CORTEX_STEP_TYPE_VIEW_FILE': {
        const vf = step.viewFile;
        if (!vf) break;
        const filePath = vf.filePath || vf.file_path || vf.path || '';
        lines.push(`## Tool Result: view_file`);
        lines.push('');
        lines.push(`File: ${filePath}`);
        if (vf.content || vf.contents) {
          lines.push('');
          lines.push('```');
          lines.push(vf.content || vf.contents);
          lines.push('```');
        }
        lines.push('');
        break;
      }

      case 'CORTEX_STEP_TYPE_RUN_COMMAND': {
        const cmd = step.runCommand;
        if (!cmd) break;
        const command = cmd.command || cmd.input || '';
        if (command) {
          lines.push('## Tool Call: run_command');
          lines.push('');
          lines.push('```bash');
          lines.push(command);
          lines.push('```');
          lines.push('');
        }
        break;
      }

      case 'CORTEX_STEP_TYPE_COMMAND_STATUS': {
        const cs = step.commandStatus;
        if (!cs) break;
        if (cs.output) {
          lines.push('## Tool Result: command_output');
          lines.push('');
          lines.push('```');
          lines.push(cs.output);
          lines.push('```');
          lines.push('');
        }
        break;
      }

      case 'CORTEX_STEP_TYPE_CODE_ACTION': {
        const ca = step.codeAction;
        if (!ca) break;
        const filePath = ca.filePath || ca.file_path || ca.uri || '';
        lines.push(`## Tool Call: code_edit`);
        lines.push('');
        lines.push(`File: ${filePath}`);
        if (ca.description || ca.title) {
          lines.push(ca.description || ca.title);
        }
        if (ca.unifiedDiff || ca.diff) {
          const diff = ca.unifiedDiff || ca.diff;
          const diffStr = typeof diff === 'string' ? diff : (diff.diff || JSON.stringify(diff, null, 2));
          lines.push('');
          lines.push('```diff');
          lines.push(diffStr);
          lines.push('```');
        }
        lines.push('');
        break;
      }

      case 'CORTEX_STEP_TYPE_CHECKPOINT':
        break;

      default:
        break;
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function parseDuration(duration: string): string {
  const match = duration.match(/^(\d+(?:\.\d+)?)s$/);
  if (match) {
    const seconds = parseFloat(match[1]);
    if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
    return `${seconds.toFixed(1)}s`;
  }
  return duration;
}

/**
 * Combine the standard ConvertTrajectoryToMarkdown output with
 * thought process data extracted from GetCascadeTrajectory.
 */
export function injectThoughtsIntoMarkdown(
  baseMarkdown: string,
  trajectoryResponse: any,
): string {
  if (!trajectoryResponse || !baseMarkdown) {
    return baseMarkdown || '';
  }

  const steps = trajectoryResponse?.trajectory?.steps || [];
  const thoughts: { thinking: string; duration: string }[] = [];

  for (const step of steps) {
    const pr = step.plannerResponse;
    if (pr?.thinking) {
      thoughts.push({
        thinking: pr.thinking,
        duration: pr.thinkingDuration ? parseDuration(pr.thinkingDuration) : '',
      });
    }
  }

  if (thoughts.length === 0) {
    return baseMarkdown;
  }

  const thoughtSections = thoughts.map((t, i) => {
    const dur = t.duration ? ` (${t.duration})` : '';
    return [
      '<details>',
      `<summary><strong>Thought Process ${i + 1}${dur}</strong></summary>`,
      '',
      t.thinking,
      '',
      '</details>',
    ].join('\n');
  }).join('\n\n');

  return [
    '# Full Conversation with Thoughts',
    '',
    '## Thought Processes',
    '',
    thoughtSections,
    '',
    '---',
    '',
    '## Conversation',
    '',
    baseMarkdown,
  ].join('\n');
}
