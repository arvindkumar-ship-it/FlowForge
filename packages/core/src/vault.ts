import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { FlowError } from './model';
/** AES-256-GCM envelope binding ciphertext to its credential identifier. */
export class Vault {
  private key: Buffer;
  constructor(hexKey: string) {
    if (!/^[a-f0-9]{64}$/i.test(hexKey)) throw new FlowError('VAULT_KEY', 'VAULT_KEY must be exactly 32 bytes encoded as hex', 500);
    this.key = Buffer.from(hexKey, 'hex');
  }
  /** Encrypt a secret with a fresh nonce and authenticated resource identity. */
  encrypt(id: string, secret: string): string {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv); cipher.setAAD(Buffer.from(id));
    const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), body].map(b => b.toString('base64')).join('.');
  }
  /** Decrypt only when both the identity and envelope authentication agree. */
  decrypt(id: string, envelope: string): string {
    try {
      const [iv, tag, body] = envelope.split('.').map(s => Buffer.from(s, 'base64'));
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv!); decipher.setAAD(Buffer.from(id)); decipher.setAuthTag(tag!);
      return Buffer.concat([decipher.update(body!), decipher.final()]).toString('utf8');
    } catch { throw new FlowError('VAULT_DECRYPT', 'Credential could not be decrypted', 500); }
  }
}
