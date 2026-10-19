import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { Agent, request } from 'undici';
import { FlowError } from '../../../packages/core/src/model';
const scrypt = promisify(scryptCallback);
/** Hash session tokens before storing them. */
export const tokenHash = (s: string) => createHash('sha256').update(s).digest('hex');
/** Memory-hard salted password derivation. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex'); const hash = await scrypt(password, salt, 64) as Buffer; return `${salt}:${hash.toString('hex')}`;
}
/** Compare password hashes in constant time. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [salt, expected] = encoded.split(':'); const actual = await scrypt(password, salt!, 64) as Buffer;
  const b = Buffer.from(expected!, 'hex'); return b.length === actual.length && timingSafeEqual(b, actual);
}
/** Conservatively permit globally routable IPv4 only; IPv6 is denied in v0.1. */
export function publicIPv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split('.').map(Number) as [number, number, number];
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
/** Pin DNS at connect time, forbid redirects, and bound response size and duration. */
export async function safeHttp(p: Record<string, unknown>, signal: AbortSignal, key: string, secret?: string): Promise<Record<string, unknown>> {
  let url: URL;
  try { url = new URL(String(p.url)); } catch { throw new FlowError('INVALID_URL', 'HTTP node requires an absolute URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new FlowError('SSRF_BLOCKED', 'Only public HTTP(S) on ports 80/443 is allowed');
  if (secret && url.protocol !== 'https:') throw new FlowError('CREDENTIAL_TLS', 'Credentials require an HTTPS destination');
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([lookup(url.hostname, { all: true, family: 4 }), new Promise<never>((_resolve, reject) => { dnsTimer = setTimeout(() => reject(new FlowError('DNS_TIMEOUT', 'DNS lookup timed out')), 5000); })]).finally(() => clearTimeout(dnsTimer));
  if (!addresses.length || addresses.some(a => !publicIPv4(a.address))) throw new FlowError('SSRF_BLOCKED', 'Private or reserved network addresses are forbidden');
  const address = addresses[0]!;
  const dispatcher = new Agent({ connect: { lookup: (_host, _opts, callback) => callback(null, [{ address: address.address, family: 4 }]) } });
  try {
    const method = String(p.method ?? 'GET').toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new FlowError('HTTP_METHOD', 'Unsupported HTTP method');
    const response = await request(url, { method: method as 'GET', dispatcher, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), headersTimeout: 15_000, bodyTimeout: 15_000, headers: { 'content-type': 'application/json', 'idempotency-key': key, ...(secret ? { authorization: `Bearer ${secret}` } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(p.body ?? {}) });
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk); size += bytes.length;
      if (size > 1024 * 1024) { response.body.destroy(); throw new FlowError('HTTP_SIZE', 'HTTP response exceeds 1 MiB'); }
      chunks.push(bytes);
    }
    if (response.statusCode >= 300) throw new FlowError('HTTP_STATUS', `Remote endpoint returned HTTP ${response.statusCode}`);
    let text = Buffer.concat(chunks).toString('utf8');
    if (secret) text = text.split(secret).join('[REDACTED]');
    let body: unknown = text; try { body = JSON.parse(text); } catch { /* Text responses remain text. */ }
    return { statusCode: response.statusCode, body };
  } finally { await dispatcher.close(); }
}
