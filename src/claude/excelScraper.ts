import * as http from 'http';
import * as crypto from 'crypto';
import * as cp from 'child_process';
import * as os from 'os';

interface CdpTarget {
  id: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

/**
 * Finds the host address where a specific Office app's WebView2 is listening.
 * Uses netstat + process tree to match the CDP port to the right Office exe.
 */
async function findHostForApp(port: number, appExe: string): Promise<string | null> {
  if (os.platform() !== 'win32') return null;

  try {
    const wv2Pids = await new Promise<number[]>((resolve, reject) => {
      cp.exec(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match '${appExe}' -and $_.CommandLine -match 'embedded-browser-webview=1' } | Select-Object -ExpandProperty ProcessId"`,
        (err, stdout) => {
          if (err) return resolve([]);
          resolve(stdout.trim().split(/\r?\n/).map(Number).filter(Boolean));
        },
      );
    });

    if (wv2Pids.length === 0) return null;

    const netstatOut = await new Promise<string>((resolve, reject) => {
      cp.exec('netstat -ano', (err, stdout) => err ? resolve('') : resolve(stdout));
    });

    for (const line of netstatOut.split('\n')) {
      if (!line.includes('LISTENING') || !line.includes(String(port))) continue;
      const cols = line.trim().split(/\s+/);
      const pid = parseInt(cols[cols.length - 1], 10);
      if (wv2Pids.includes(pid)) {
        if (line.includes('127.0.0.1')) return '127.0.0.1';
        if (line.includes('[::1]') || line.includes('::1')) return '::1';
      }
    }
  } catch { /* fallback to scanning */ }

  return null;
}

/**
 * Finds the Claude Office add-in CDP target for a specific Office app.
 * If appExe is provided, uses process tree matching to find the right host.
 * Falls back to scanning both IPv4 and IPv6.
 */
export async function findClaudeOfficeTarget(port = 9242, appExe?: string): Promise<CdpTarget | null> {
  const hosts: string[] = [];

  if (appExe) {
    const preferred = await findHostForApp(port, appExe);
    if (preferred) {
      hosts.push(preferred);
    } else {
      return null;
    }
  } else {
    hosts.push('127.0.0.1');
    hosts.push('::1');
  }

  for (const host of hosts) {
    const hostForHttp = host === '::1' ? '[::1]' : host;
    const targets = await cdpHttpGet<CdpTarget[]>(port, '/json/list', hostForHttp);
    if (!targets) continue;
    const match = targets.find(t =>
      t.url.includes('pivot.claude.ai') || t.title.includes('Claude in Microsoft')
    );
    if (match) {
      match.webSocketDebuggerUrl = match.webSocketDebuggerUrl
        .replace('localhost', host)
        .replace('127.0.0.1', host);
      return match;
    }
  }
  return null;
}

/**
 * Checks CDP availability and returns a status.
 */
export async function checkCdpStatus(port = 9242, appExe?: string): Promise<'ready' | 'no-claude' | 'no-cdp'> {
  const hosts = ['127.0.0.1', '[::1]'];
  let anyReachable = false;

  for (const host of hosts) {
    const targets = await cdpHttpGet<CdpTarget[]>(port, '/json/list', host);
    if (targets && targets.length > 0) {
      anyReachable = true;
    }
  }

  if (!anyReachable) return 'no-cdp';

  const target = await findClaudeOfficeTarget(port, appExe);
  return target ? 'ready' : 'no-claude';
}

/**
 * Checks whether the CDP debug port is available with a Claude target.
 */
export async function isCdpAvailable(port = 9242): Promise<boolean> {
  return (await checkCdpStatus(port)) === 'ready';
}

/**
 * Connects to the Claude Excel WebView2 via CDP, expands all collapsed
 * tool pills, and scrapes the full conversation text from the DOM.
 */
export async function scrapeExcelConversation(port = 9242, includeUserInput = false, appExe?: string): Promise<string> {
  const target = await findClaudeOfficeTarget(port, appExe);
  if (!target) {
    throw new Error(
      'Claude Excel add-in not found. Make sure:\n' +
      '1. Excel is open with the Claude add-in visible\n' +
      '2. The environment variable WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS is set to --remote-debugging-port=9222\n' +
      '3. Excel was restarted after setting the variable'
    );
  }

  const wsUrl = target.webSocketDebuggerUrl;

  const expandJs = `
    (async () => {
      let count = 0;
      const delay = ms => new Promise(r => setTimeout(r, ms));

      // Level 1: top-level pills (aria-expanded)
      const pills = document.querySelectorAll('button[aria-expanded="false"]');
      for (const btn of pills) {
        const text = (btn.innerText || '').trim();
        if (!text || text.length > 200) continue;
        btn.click();
        count++;
        await delay(100);
      }

      await delay(300);

      // Level 2: inner tool rows (group/row buttons) - only expand collapsed ones
      const toolRows = document.querySelectorAll('button[class*="group/row"]');
      for (const btn of toolRows) {
        const sibling = btn.nextElementSibling;
        const isCollapsed = !sibling
          || sibling.offsetHeight === 0
          || sibling.style.display === 'none'
          || sibling.children.length === 0;
        if (isCollapsed) {
          btn.click();
          count++;
          await delay(50);
        }
      }

      await delay(300);

      // Level 3: "Show more" buttons to expand truncated content
      const showMoreBtns = document.querySelectorAll('button');
      for (const btn of showMoreBtns) {
        if ((btn.innerText || '').trim() === 'Show more') {
          btn.click();
          count++;
          await delay(50);
        }
      }

      await delay(300);

      // Level 4: "Result" toggle buttons - only expand collapsed ones
      const resultBtns = document.querySelectorAll('button');
      for (const btn of resultBtns) {
        const text = (btn.innerText || '').trim();
        if (text === 'Result' && btn.className.includes('inline-flex')) {
          const parent = btn.closest('div');
          const contentDiv = parent ? parent.nextElementSibling : null;
          const isCollapsed = !contentDiv || contentDiv.offsetHeight === 0;
          if (isCollapsed) {
            btn.click();
            count++;
            await delay(50);
          }
        }
      }

      return count;
    })()
  `;
  const expandedCount = await cdpEvaluate(wsUrl, expandJs);

  if (expandedCount > 0) {
    await sleep(1500);
  }

  const scrapeJs = `
    (() => {
      const container = document.querySelector('.flex-1.overflow-y-auto');
      if (!container) return JSON.stringify({ error: 'No conversation container found' });

      const blocks = [];
      const children = container.children;

      for (const child of children) {
        const text = (child.innerText || '').trim();
        if (!text) continue;

        const userBubble = child.querySelector('.bg-bg-300');
        const isUser = userBubble !== null
          && child.className.includes('items-end')
          && !child.querySelector('.font-claude-response-small')
          && !child.querySelector('[aria-expanded]');

        blocks.push({
          role: isUser ? 'user' : 'assistant',
          text: text,
        });
      }

      return JSON.stringify(blocks);
    })()
  `;

  const raw = await cdpEvaluate(wsUrl, scrapeJs);

  let blocks: any[];
  try {
    blocks = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new Error('Failed to parse scraped conversation data');
  }

  if (!Array.isArray(blocks) && (blocks as any).error) {
    throw new Error((blocks as any).error);
  }

  return formatScrapedBlocks(blocks, includeUserInput);
}

function formatScrapedBlocks(blocks: any[], includeUserInput: boolean): string {
  const lines: string[] = [];
  let lastRole = '';

  for (const block of blocks) {
    if (block.role === 'user') {
      if (!includeUserInput) continue;
      lines.push('## User');
      lines.push('');
    } else if (includeUserInput && lastRole !== 'assistant') {
      lines.push('## Assistant');
      lines.push('');
    }
    lines.push(block.text);
    lines.push('');
    lastRole = block.role;
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------------------------------------------------------------------------
// CDP helpers using only built-in Node.js modules
// ---------------------------------------------------------------------------

function cdpHttpGet<T>(port: number, path: string, host = '127.0.0.1'): Promise<T | null> {
  return new Promise((resolve) => {
    const req = http.get({ hostname: host.replace(/[[\]]/g, ''), port, path, timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * Minimal WebSocket client using raw TCP + HTTP upgrade.
 * Sends a single CDP Runtime.evaluate command and returns the result.
 */
function cdpEvaluate(wsUrl: string, expression: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CDP evaluate timed out')), 30000);

    const parsed = new URL(wsUrl);
    const host = parsed.hostname;
    const port = parseInt(parsed.port, 10);
    const path = parsed.pathname;

    const key = crypto.randomBytes(16).toString('base64');

    const upgradeReq =
      `GET ${path} HTTP/1.1\r\n` +
      `Host: ${host}:${port}\r\n` +
      `Upgrade: websocket\r\n` +
      `Connection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\n` +
      `Sec-WebSocket-Version: 13\r\n` +
      `\r\n`;

    const net = require('net') as typeof import('net');
    const socket = net.createConnection({ host, port }, () => {
      socket.write(upgradeReq);
    });

    let upgraded = false;
    let recvBuffer = Buffer.alloc(0);

    socket.on('data', (chunk: Buffer) => {
      recvBuffer = Buffer.concat([recvBuffer, chunk]);

      if (!upgraded) {
        const headerEnd = recvBuffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        upgraded = true;
        recvBuffer = recvBuffer.subarray(headerEnd + 4);

        const payload = JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        });
        socket.write(wsEncode(payload));
      }

      processFrames();
    });

    function processFrames() {
      while (recvBuffer.length >= 2) {
        const frame = wsDecode(recvBuffer);
        if (!frame) break;
        recvBuffer = recvBuffer.subarray(frame.totalLength);

        if (frame.opcode === 0x1) {
          try {
            const msg = JSON.parse(frame.payload);
            if (msg.id === 1) {
              clearTimeout(timeout);
              socket.destroy();
              const val = msg.result?.result?.value;
              resolve(val !== undefined ? val : msg.result);
            }
          } catch { /* partial frame, keep reading */ }
        } else if (frame.opcode === 0x9) {
          socket.write(wsEncode('', 0xA));
        } else if (frame.opcode === 0x8) {
          clearTimeout(timeout);
          socket.destroy();
          reject(new Error('WebSocket closed by server'));
        }
      }
    }

    socket.on('error', (err: Error) => {
      clearTimeout(timeout);
      reject(new Error(`CDP connection error: ${err.message}`));
    });

    socket.on('close', () => {
      clearTimeout(timeout);
    });
  });
}

function wsEncode(data: string, opcode = 0x1): Buffer {
  const payload = Buffer.from(data, 'utf-8');
  const mask = crypto.randomBytes(4);
  let header: Buffer;

  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) {
    masked[i] = payload[i] ^ mask[i % 4];
  }

  return Buffer.concat([header, mask, masked]);
}

function wsDecode(buf: Buffer): { opcode: number; payload: string; totalLength: number } | null {
  if (buf.length < 2) return null;

  const opcode = buf[0] & 0x0f;
  const isMasked = (buf[1] & 0x80) !== 0;
  let payloadLen = buf[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    payloadLen = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  if (isMasked) offset += 4;

  if (buf.length < offset + payloadLen) return null;

  let payload = buf.subarray(offset, offset + payloadLen);
  if (isMasked) {
    const maskKey = buf.subarray(offset - 4, offset);
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskKey[i % 4];
    }
  }

  return { opcode, payload: payload.toString('utf-8'), totalLength: offset + payloadLen };
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
