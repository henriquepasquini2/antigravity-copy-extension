import * as http2 from 'http2';
import * as fs from 'fs';
import { LanguageServerInfo } from './discovery';

const SERVICE = 'exa.language_server_pb.LanguageServerService';

/**
 * Client for the Antigravity language server using ConnectRPC over HTTP/2.
 *
 * Unary calls:
 *   POST /<service>/<Method>
 *   Content-Type: application/json
 *   x-codeium-csrf-token: <token>
 *   connect-protocol-version: 1
 */
export class AntigravityLsClient {
  private info: LanguageServerInfo;
  private ca: Buffer;

  constructor(info: LanguageServerInfo) {
    this.info = info;
    this.ca = fs.readFileSync(info.certPath);
  }

  async heartbeat(): Promise<any> {
    return this.call('Heartbeat', {});
  }

  async convertTrajectoryToMarkdown(conversationId: string): Promise<string> {
    const response = await this.call('ConvertTrajectoryToMarkdown', { conversationId });
    return response?.markdown || '';
  }

  /**
   * Fetch the full trajectory including thought/thinking data.
   * trajectoryVerbosity: 0=UNSPECIFIED, 1=DEBUG (includes thoughts), 2=PROD_UI
   */
  async getCascadeTrajectory(cascadeId: string, verbosity = 1): Promise<any> {
    return this.call('GetCascadeTrajectory', {
      cascadeId,
      trajectoryVerbosity: verbosity,
    });
  }

  private call(method: string, body: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`RPC call ${method} timed out after 30s`));
      }, 30000);

      const client = http2.connect(`https://127.0.0.1:${this.info.httpsPort}`, {
        ca: this.ca,
        rejectUnauthorized: false,
      });

      client.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`HTTP/2 connection error calling ${method}: ${err.message}`));
      });

      const rpcPath = `/${SERVICE}/${method}`;
      const payload = JSON.stringify(body);

      const req = client.request({
        ':method': 'POST',
        ':path': rpcPath,
        'content-type': 'application/json',
        'x-codeium-csrf-token': this.info.csrfToken,
        'connect-protocol-version': '1',
      });

      let responseData = '';
      let statusCode: number | undefined;

      req.on('response', (headers: any) => {
        statusCode = headers[':status'] as number;
      });

      req.on('data', (chunk: Buffer) => {
        responseData += chunk.toString();
      });

      req.on('end', () => {
        clearTimeout(timeout);
        client.close();

        if (statusCode && statusCode >= 200 && statusCode < 300) {
          try {
            resolve(JSON.parse(responseData));
          } catch {
            resolve(responseData);
          }
        } else {
          reject(new Error(
            `RPC ${method} returned ${statusCode}: ${responseData.substring(0, 500)}`
          ));
        }
      });

      req.on('error', (err: Error) => {
        clearTimeout(timeout);
        client.close();
        reject(new Error(`RPC request error for ${method}: ${err.message}`));
      });

      req.write(payload);
      req.end();
    });
  }
}
