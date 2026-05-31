import { createLogger } from "../logger.js";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  pbkdf2Sync,
} from "crypto";

const logger = createLogger("encryption");

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export interface AuditEntry {
  timestamp: string;
  action: string;
  actor: string;
  metadata?: Record<string, unknown>;
}

export class EncryptionService {
  encrypt(plaintext: string, key: Buffer): EncryptedData {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    logger.debug("Data encrypted successfully");

    return {
      ciphertext: encrypted.toString("base64"),
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
    };
  }

  decrypt(ciphertext: string, iv: string, authTag: string, key: Buffer): string {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "hex"),
    );
    decipher.setAuthTag(Buffer.from(authTag, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]);

    logger.debug("Data decrypted successfully");
    return decrypted.toString("utf8");
  }

  deriveKey(passphrase: string, salt: string): Buffer {
    return pbkdf2Sync(passphrase, salt, 100000, 32, "sha512");
  }

  rotateKey(
    oldPassphrase: string,
    newPassphrase: string,
    encryptedData: EncryptedData,
    salt: string,
  ): EncryptedData & { newSalt: string } {
    const oldKey = this.deriveKey(oldPassphrase, salt);
    const plaintext = this.decrypt(
      encryptedData.ciphertext,
      encryptedData.iv,
      encryptedData.authTag,
      oldKey,
    );

    const newSalt = this.generateSalt();
    const newKey = this.deriveKey(newPassphrase, newSalt);
    const reEncrypted = this.encrypt(plaintext, newKey);

    logger.info("Key rotation completed successfully");

    return { ...reEncrypted, newSalt };
  }

  generateSalt(): string {
    return randomBytes(16).toString("hex");
  }
}

export class AuditTrail {
  private entries: AuditEntry[] = [];

  log(action: string, actor: string, metadata?: Record<string, unknown>): void {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      action,
      actor,
      metadata,
    };
    this.entries.push(entry);
    logger.debug(`Audit: ${action} by ${actor}`);
  }

  export(): AuditEntry[] {
    return [...this.entries];
  }

  getByAction(action: string): AuditEntry[] {
    return this.entries.filter((e) => e.action === action);
  }

  clear(): void {
    this.entries = [];
    logger.debug("Audit trail cleared");
  }
}
