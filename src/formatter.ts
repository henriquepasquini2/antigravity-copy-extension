/**
 * Formats the full Antigravity conversation trajectory as clean markdown.
 * Captures every detail in chat order: thoughts, tool results, assistant
 * responses, web searches, images, commands, edits, browser sub-agent
 * trajectories.
 *
 * Field mappings (from raw trajectory inspection):
 *   userInput.userResponse / userInput.items[].text
 *   plannerResponse.thinking / .modifiedResponse / .response
 *   listDirectory.directoryPathUri / .results[]{name, isDir}
 *   viewFile.absolutePathUri / .endLine / .numLines
 *   runCommand.commandLine / .cwd / .exitCode / .combinedOutput.full
 *   commandStatus.combined / .delta / .exitCode / .status
 *   codeAction.description / metadata.toolCall.argumentsJson.TargetFile
 *   searchWeb.query / .summary
 *   generateImage.prompt / .imageName / .generatedMedia.uri
 *   grepSearch.query / .searchPathUri
 *   notifyUser.notificationContent
 *   error.userErrorMessage
 *   browserSubagent.taskName / .task / .result / .taskSummary
 *   subtrajectory.steps (recursive)
 *   openBrowserUrl.url
 *   clickBrowserPixel (coordinates)
 *   browserPressKey.key
 *   wait (duration)
 */

function uriToPath(uri: string): string {
  if (!uri) return '';
  try {
    if (uri.startsWith('file:///')) {
      return decodeURIComponent(uri.slice(8)).replace(/\//g, '\\');
    }
    return uri;
  } catch {
    return uri;
  }
}

function shortPath(fullPath: string): string {
  if (!fullPath) return '';
  const parts = fullPath.replace(/\//g, '\\').split('\\');
  return parts.pop() || fullPath;
}

function parseToolArgs(json: string | undefined): Record<string, any> | null {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

export function formatTrajectoryClean(
  trajectoryResponse: any,
  includeUserInput = false,
): string {
  const steps = trajectoryResponse?.trajectory?.steps || [];
  if (steps.length === 0) return '';

  const lines: string[] = [];
  emitSteps(steps, lines, includeUserInput);

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function emitSteps(steps: any[], lines: string[], includeUserInput: boolean): void {
  let lastCommandOutput = '';

  for (const step of steps) {
    const type: string = step.type || '';

    switch (type) {
      case 'CORTEX_STEP_TYPE_USER_INPUT':
        if (includeUserInput) emitUserInput(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_PLANNER_RESPONSE':
        emitPlannerResponse(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_SEARCH_WEB':
        emitSearchWeb(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_LIST_DIRECTORY':
        emitListDirectory(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_VIEW_FILE':
        emitViewFile(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_RUN_COMMAND':
        lastCommandOutput = emitRunCommand(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_COMMAND_STATUS':
        emitCommandStatus(step, lines, lastCommandOutput);
        break;

      case 'CORTEX_STEP_TYPE_CODE_ACTION':
        emitCodeAction(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_GENERATE_IMAGE':
        emitGenerateImage(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_GREP_SEARCH':
        emitGrepSearch(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_NOTIFY_USER':
        emitNotifyUser(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_ERROR_MESSAGE':
        emitErrorMessage(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_BROWSER_SUBAGENT':
        emitBrowserSubagent(step, lines, includeUserInput);
        break;

      case 'CORTEX_STEP_TYPE_READ_RESOURCE':
        emitReadResource(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_OPEN_BROWSER_URL':
        emitOpenBrowserUrl(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_CLICK_BROWSER_PIXEL':
        emitClickBrowserPixel(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_BROWSER_PRESS_KEY':
        emitBrowserPressKey(step, lines);
        break;

      case 'CORTEX_STEP_TYPE_WAIT':
        break;

      case 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE':
      case 'CORTEX_STEP_TYPE_CHECKPOINT':
      case 'CORTEX_STEP_TYPE_CONVERSATION_HISTORY':
      case 'CORTEX_STEP_TYPE_TASK_BOUNDARY':
      case 'CORTEX_STEP_TYPE_CODE_ACKNOWLEDGEMENT':
        break;

      default:
        emitGenericSubagentStep(step, lines, includeUserInput);
        break;
    }
  }
}

function emitUserInput(step: any, lines: string[]): void {
  const input = step.userInput;
  if (!input) return;
  const text = input.userResponse || input.items?.map((i: any) => i.text).join('\n') || '';
  if (!text.trim()) return;

  lines.push('## User');
  lines.push('');
  lines.push(text.trim());
  lines.push('');
}

/**
 * Planner responses contain thinking, text responses, and tool call declarations.
 * We only emit thinking and text here — the actual tool results come from
 * their dedicated step types (LIST_DIRECTORY, RUN_COMMAND, etc.) to avoid duplicates.
 */
function emitPlannerResponse(step: any, lines: string[]): void {
  const pr = step.plannerResponse;
  if (!pr) return;

  if (pr.thinking) {
    lines.push(pr.thinking);
    lines.push('');
  }

  const responseText = pr.modifiedResponse || pr.response || '';
  if (responseText) {
    lines.push(responseText);
    lines.push('');
  }
}

function emitSearchWeb(step: any, lines: string[]): void {
  const sw = step.searchWeb;
  if (!sw) return;

  if (sw.query) {
    lines.push(`Searched web: "${sw.query}"`);
    lines.push('');
  }

  if (sw.summary) {
    lines.push(sw.summary);
    lines.push('');
  }
}

function emitListDirectory(step: any, lines: string[]): void {
  const dir = step.listDirectory;
  if (!dir) return;

  const dirPath = uriToPath(dir.directoryPathUri);
  if (dirPath) lines.push(dirPath);

  if (dir.results?.length) {
    for (const entry of dir.results) {
      if (entry.name) lines.push(entry.name);
    }
  }
  lines.push('');
}

function emitViewFile(step: any, lines: string[]): void {
  const vf = step.viewFile;
  if (!vf) return;

  const filePath = uriToPath(vf.absolutePathUri);
  const name = shortPath(filePath);
  const range = vf.endLine ? `#L1-${vf.endLine}` : '';
  if (name) {
    lines.push(`${name}${range}`);
    lines.push('');
  }
}

function emitRunCommand(step: any, lines: string[]): string {
  const cmd = step.runCommand;
  if (!cmd) return '';

  const commandLine = cmd.commandLine || cmd.proposedCommandLine || '';
  const cwd = cmd.cwd || '';

  if (commandLine) {
    const cwdShort = cwd ? `…${cwd.substring(cwd.lastIndexOf('\\'))} > ` : '';
    lines.push(`Ran command`);
    lines.push(`${cwdShort}${commandLine}`);
  }

  const output = cmd.combinedOutput?.full || '';
  if (output) lines.push(output);

  if (cmd.exitCode !== undefined && cmd.exitCode !== null) {
    lines.push(`Exit code ${cmd.exitCode}`);
  }
  lines.push('');
  return output;
}

function emitCommandStatus(step: any, lines: string[], lastCmdOutput: string): void {
  const cs = step.commandStatus;
  if (!cs) return;

  const output = cs.combined || cs.delta || '';
  if (output && output !== lastCmdOutput) {
    lines.push(output);
    if (cs.exitCode !== undefined && cs.exitCode !== null) {
      lines.push(`Exit code ${cs.exitCode}`);
    }
    lines.push('');
  }
}

function emitCodeAction(step: any, lines: string[]): void {
  const ca = step.codeAction;
  if (!ca) return;

  const toolCall = step.metadata?.toolCall;
  const toolName = toolCall?.name || '';
  const args = parseToolArgs(toolCall?.argumentsJson);

  let filePath = '';
  if (args?.TargetFile) {
    filePath = args.TargetFile;
  } else if (ca.actionSpec?.createFile?.path?.absoluteUri) {
    filePath = uriToPath(ca.actionSpec.createFile.path.absoluteUri);
  } else if (ca.actionSpec?.editFile?.path?.absoluteUri) {
    filePath = uriToPath(ca.actionSpec.editFile.path.absoluteUri);
  } else if (args?.FilePath || args?.AbsolutePath) {
    filePath = args.FilePath || args.AbsolutePath;
  }

  const name = shortPath(filePath);
  const status = step.status === 'CORTEX_STEP_STATUS_ERROR' ? ' (failed)' : '';

  if (toolName === 'write_to_file') {
    lines.push(`Wrote ${name}${status}`);
  } else {
    lines.push(`Edited ${name}${status}`);
  }

  if (ca.description) {
    lines.push(ca.description);
  }
  lines.push('');
}

function emitGenerateImage(step: any, lines: string[]): void {
  const gi = step.generateImage;
  if (!gi) return;

  if (gi.prompt) {
    lines.push('Prompt');
    lines.push(gi.prompt);
  }

  if (gi.generatedMedia?.uri) {
    const imgPath = uriToPath(gi.generatedMedia.uri);
    if (imgPath) lines.push(`Image: ${imgPath}`);
  }
  lines.push('');
}

function emitGrepSearch(step: any, lines: string[]): void {
  const gs = step.grepSearch;
  if (!gs) return;

  const searchPath = uriToPath(gs.searchPathUri);
  lines.push(`Searched for "${gs.query}" in ${searchPath}`);
  lines.push('');
}

function emitNotifyUser(step: any, lines: string[]): void {
  const nu = step.notifyUser;
  if (!nu) return;

  if (nu.notificationContent) {
    lines.push(nu.notificationContent);
    lines.push('');
  }
}

function emitErrorMessage(step: any, lines: string[]): void {
  const err = step.errorMessage || step.error;
  if (!err) return;

  const msg = err.userErrorMessage || err.shortError || err.fullError || '';
  if (msg) {
    lines.push(`Error: ${msg}`);
    lines.push('');
  }
}

function emitBrowserSubagent(step: any, lines: string[], includeUserInput: boolean): void {
  const bs = step.browserSubagent;
  const args = parseToolArgs(step.metadata?.toolCall?.argumentsJson);

  const taskName = bs?.taskName || args?.TaskName || 'Browser Sub-agent';
  const task = bs?.task || args?.Task || args?.Instruction || args?.instruction || '';
  const result = bs?.result || '';
  const taskSummary = bs?.taskSummary || args?.TaskSummary || '';

  lines.push(taskName);
  if (taskSummary) {
    lines.push(taskSummary);
  }
  if (task) {
    lines.push('Goal');
    lines.push(task);
  }
  lines.push('');

  const subSteps = step.subtrajectory?.steps;
  if (subSteps?.length) {
    emitSteps(subSteps, lines, includeUserInput);

    // The last planner response in the subtrajectory usually duplicates the
    // top-level result field, so only emit result when there's no subtrajectory
    // or the texts differ.
    if (result && !lastPlannerResponseMatches(subSteps, result)) {
      lines.push(result);
      lines.push('');
    }
  } else if (result) {
    lines.push(result);
    lines.push('');
  }

  if (bs?.recordingName) {
    lines.push('Playback available');
    lines.push('');
  }
}

function lastPlannerResponseMatches(steps: any[], result: string): boolean {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
      const pr = steps[i].plannerResponse;
      const text = pr?.modifiedResponse || pr?.response || '';
      return text.trim() === result.trim();
    }
  }
  return false;
}

function emitOpenBrowserUrl(step: any, lines: string[]): void {
  const ob = step.openBrowserUrl;
  if (!ob) return;

  const url = ob.url || ob.uri || '';
  if (url) {
    lines.push(`Navigated to ${url}`);
    lines.push('');
  }
}

function emitClickBrowserPixel(step: any, lines: string[]): void {
  const cb = step.clickBrowserPixel;
  if (!cb) return;

  const x = cb.x ?? cb.pixelX ?? '';
  const y = cb.y ?? cb.pixelY ?? '';
  if (x !== '' && y !== '') {
    lines.push(`Clicked at (${x}, ${y})`);
    lines.push('');
  }
}

function emitBrowserPressKey(step: any, lines: string[]): void {
  const pk = step.browserPressKey;
  if (!pk) return;

  const key = pk.key || '';
  if (key) {
    lines.push(`Pressed key: ${key}`);
    lines.push('');
  }
}

function emitReadResource(step: any, lines: string[]): void {
  const rr = step.readResource;
  if (!rr) return;

  if (rr.uri) {
    lines.push(`Read resource: ${rr.uri}`);
    lines.push('');
  }
}

/**
 * Fallback for unknown step types that may carry a subtrajectory.
 * Extracts any available metadata/result and recursively formats nested steps.
 */
function emitGenericSubagentStep(step: any, lines: string[], includeUserInput: boolean): void {
  if (!step.subtrajectory?.steps?.length) return;

  const args = parseToolArgs(step.metadata?.toolCall?.argumentsJson);
  const name = args?.TaskName || args?.taskName || step.metadata?.toolCall?.name || '';
  const task = args?.Task || args?.task || args?.Instruction || args?.instruction || '';
  const result = args?.result || '';

  if (name) {
    lines.push(name);
  }
  if (task) {
    lines.push('Goal');
    lines.push(task);
    lines.push('');
  }

  emitSteps(step.subtrajectory.steps, lines, includeUserInput);

  if (result) {
    lines.push(result);
    lines.push('');
  }
}
