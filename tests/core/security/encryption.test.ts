import { describe, it, expect, beforeEach } from "vitest";
import { EncryptionService, AuditTrail } from "../../../src/core/security/encryption.js";

describe("EncryptionService", () => {
  let service: EncryptionService;

  beforeEach(() => {
    service = new EncryptionService();
  });

  describe("encrypt/decrypt roundtrip", () => {
    it("should encrypt and decrypt a string correctly", () => {
      const salt = service.generateSalt();
      const key = service.deriveKey("my-passphrase", salt);
      const plaintext = "Hello, World! This is secret data.";

      const encrypted = service.encrypt(plaintext, key);
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();
      expect(encrypted.ciphertext).not.toBe(plaintext);

      const decrypted = service.decrypt(
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        key,
      );
      expect(decrypted).toBe(plaintext);
    });

    it("should produce different ciphertext for same plaintext", () => {
      const salt = service.generateSalt();
      const key = service.deriveKey("passphrase", salt);
      const plaintext = "same text";

      const enc1 = service.encrypt(plaintext, key);
      const enc2 = service.encrypt(plaintext, key);

      expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
      expect(enc1.iv).not.toBe(enc2.iv);
    });

    it("should handle empty string", () => {
      const salt = service.generateSalt();
      const key = service.deriveKey("pass", salt);
      const encrypted = service.encrypt("", key);
      const decrypted = service.decrypt(
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        key,
      );
      expect(decrypted).toBe("");
    });

    it("should handle unicode characters", () => {
      const salt = service.generateSalt();
      const key = service.deriveKey("pass", salt);
      const plaintext = "Hello 🌍! Encrypted: \u00e9\u00e0\u00fc";
      const encrypted = service.encrypt(plaintext, key);
      const decrypted = service.decrypt(
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        key,
      );
      expect(decrypted).toBe(plaintext);
    });

    it("should fail to decrypt with wrong key", () => {
      const salt = service.generateSalt();
      const key1 = service.deriveKey("correct-pass", salt);
      const key2 = service.deriveKey("wrong-pass", salt);
      const encrypted = service.encrypt("secret", key1);

      expect(() =>
        service.decrypt(encrypted.ciphertext, encrypted.iv, encrypted.authTag, key2),
      ).toThrow();
    });
  });

  describe("deriveKey", () => {
    it("should produce consistent output for same inputs", () => {
      const key1 = service.deriveKey("passphrase", "salt123");
      const key2 = service.deriveKey("passphrase", "salt123");
      expect(key1.equals(key2)).toBe(true);
    });

    it("should produce different keys for different salts", () => {
      const key1 = service.deriveKey("passphrase", "salt1");
      const key2 = service.deriveKey("passphrase", "salt2");
      expect(key1.equals(key2)).toBe(false);
    });

    it("should produce different keys for different passphrases", () => {
      const key1 = service.deriveKey("pass1", "same-salt");
      const key2 = service.deriveKey("pass2", "same-salt");
      expect(key1.equals(key2)).toBe(false);
    });

    it("should produce a 32-byte key", () => {
      const key = service.deriveKey("pass", "salt");
      expect(key.length).toBe(32);
    });
  });

  describe("rotateKey", () => {
    it("should re-encrypt data with new passphrase", () => {
      const oldPass = "old-passphrase";
      const newPass = "new-passphrase";
      const salt = service.generateSalt();
      const oldKey = service.deriveKey(oldPass, salt);
      const plaintext = "sensitive data for rotation";

      const encrypted = service.encrypt(plaintext, oldKey);
      const rotated = service.rotateKey(oldPass, newPass, encrypted, salt);

      expect(rotated.newSalt).toBeDefined();
      expect(rotated.ciphertext).not.toBe(encrypted.ciphertext);

      const newKey = service.deriveKey(newPass, rotated.newSalt);
      const decrypted = service.decrypt(
        rotated.ciphertext,
        rotated.iv,
        rotated.authTag,
        newKey,
      );
      expect(decrypted).toBe(plaintext);
    });

    it("should generate a new salt during rotation", () => {
      const salt = service.generateSalt();
      const oldKey = service.deriveKey("old", salt);
      const encrypted = service.encrypt("data", oldKey);
      const rotated = service.rotateKey("old", "new", encrypted, salt);
      expect(rotated.newSalt).not.toBe(salt);
    });
  });

  describe("generateSalt", () => {
    it("should produce a 32-character hex string", () => {
      const salt = service.generateSalt();
      expect(salt).toHaveLength(32);
      expect(/^[0-9a-f]+$/.test(salt)).toBe(true);
    });

    it("should produce unique salts", () => {
      const salt1 = service.generateSalt();
      const salt2 = service.generateSalt();
      expect(salt1).not.toBe(salt2);
    });
  });
});

describe("AuditTrail", () => {
  let audit: AuditTrail;

  beforeEach(() => {
    audit = new AuditTrail();
  });

  describe("log", () => {
    it("should add an entry with timestamp", () => {
      audit.log("encrypt", "user-1", { file: "test.txt" });
      const entries = audit.export();
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("encrypt");
      expect(entries[0].actor).toBe("user-1");
      expect(entries[0].metadata).toEqual({ file: "test.txt" });
      expect(entries[0].timestamp).toBeDefined();
    });

    it("should add entries in order", () => {
      audit.log("action-1", "actor-a");
      audit.log("action-2", "actor-b");
      const entries = audit.export();
      expect(entries).toHaveLength(2);
      expect(entries[0].action).toBe("action-1");
      expect(entries[1].action).toBe("action-2");
    });
  });

  describe("export", () => {
    it("should return a copy of entries", () => {
      audit.log("test", "user");
      const entries = audit.export();
      entries.push({ timestamp: "fake", action: "fake", actor: "fake" });
      expect(audit.export()).toHaveLength(1);
    });

    it("should return empty array when no entries", () => {
      expect(audit.export()).toEqual([]);
    });
  });

  describe("getByAction", () => {
    it("should filter entries by action", () => {
      audit.log("encrypt", "user-1");
      audit.log("decrypt", "user-2");
      audit.log("encrypt", "user-3");
      const encrypts = audit.getByAction("encrypt");
      expect(encrypts).toHaveLength(2);
      expect(encrypts[0].actor).toBe("user-1");
      expect(encrypts[1].actor).toBe("user-3");
    });

    it("should return empty array for unknown action", () => {
      audit.log("encrypt", "user");
      expect(audit.getByAction("unknown")).toEqual([]);
    });
  });

  describe("clear", () => {
    it("should remove all entries", () => {
      audit.log("a", "x");
      audit.log("b", "y");
      audit.clear();
      expect(audit.export()).toEqual([]);
    });
  });
});
