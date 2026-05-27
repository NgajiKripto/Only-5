import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import dns from "dns";
import { validateUrlNotInternal } from "../../src/core/url-validator.js";

vi.mock("dns", () => ({
  default: {
    promises: {
      lookup: vi.fn(),
    },
  },
}));

describe("validateUrlNotInternal", () => {
  const mockLookup = dns.promises.lookup as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLookup.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("blocks private IPv4 ranges", () => {
    it("should block 127.0.0.1 (loopback)", async () => {
      await expect(validateUrlNotInternal("http://127.0.0.1/admin")).rejects.toThrow(
        "blocked internal address"
      );
    });

    it("should block 10.x.x.x (private)", async () => {
      await expect(validateUrlNotInternal("http://10.0.0.1/api")).rejects.toThrow(
        "blocked internal address"
      );
    });

    it("should block 10.255.255.255 (private)", async () => {
      await expect(validateUrlNotInternal("http://10.255.255.255/")).rejects.toThrow(
        "blocked internal address"
      );
    });

    it("should block 172.16.x.x (private)", async () => {
      await expect(validateUrlNotInternal("http://172.16.0.1/")).rejects.toThrow(
        "blocked internal address"
      );
    });

    it("should block 172.31.x.x (private)", async () => {
      await expect(validateUrlNotInternal("http://172.31.255.255/")).rejects.toThrow(
        "blocked internal address"
      );
    });

    it("should block 192.168.x.x (private)", async () => {
      await expect(validateUrlNotInternal("http://192.168.1.1/")).rejects.toThrow(
        "blocked internal address"
      );
    });

    it("should block 169.254.169.254 (cloud metadata)", async () => {
      await expect(validateUrlNotInternal("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
        "blocked internal address"
      );
    });

    it("should block 169.254.x.x (link-local)", async () => {
      await expect(validateUrlNotInternal("http://169.254.1.1/")).rejects.toThrow(
        "blocked internal address"
      );
    });
  });

  describe("blocks IPv6 private addresses", () => {
    it("should block ::1 (loopback)", async () => {
      await expect(validateUrlNotInternal("http://[::1]/")).rejects.toThrow(
        "blocked internal address"
      );
    });

    it("should block fe80:: (link-local)", async () => {
      await expect(validateUrlNotInternal("http://[fe80::1]/")).rejects.toThrow(
        "blocked internal address"
      );
    });
  });

  describe("allows valid public IPs", () => {
    it("should allow 8.8.8.8", async () => {
      mockLookup.mockResolvedValue({ address: "8.8.8.8", family: 4 });
      await expect(validateUrlNotInternal("http://8.8.8.8/")).resolves.toBeUndefined();
    });

    it("should allow 1.1.1.1", async () => {
      mockLookup.mockResolvedValue({ address: "1.1.1.1", family: 4 });
      await expect(validateUrlNotInternal("http://1.1.1.1/")).resolves.toBeUndefined();
    });

    it("should allow 172.15.0.1 (not in 172.16-31 range)", async () => {
      mockLookup.mockResolvedValue({ address: "172.15.0.1", family: 4 });
      await expect(validateUrlNotInternal("http://172.15.0.1/")).resolves.toBeUndefined();
    });

    it("should allow 172.32.0.1 (not in 172.16-31 range)", async () => {
      mockLookup.mockResolvedValue({ address: "172.32.0.1", family: 4 });
      await expect(validateUrlNotInternal("http://172.32.0.1/")).resolves.toBeUndefined();
    });
  });

  describe("hostname resolution to private IPs", () => {
    it("should block hostname resolving to 127.0.0.1", async () => {
      mockLookup.mockResolvedValue({ address: "127.0.0.1", family: 4 });
      await expect(validateUrlNotInternal("http://evil.example.com/")).rejects.toThrow(
        "blocked internal address"
      );
    });

    it("should block hostname resolving to 10.0.0.1", async () => {
      mockLookup.mockResolvedValue({ address: "10.0.0.1", family: 4 });
      await expect(validateUrlNotInternal("http://internal.example.com/")).rejects.toThrow(
        "blocked internal address"
      );
    });

    it("should block hostname resolving to 192.168.1.1", async () => {
      mockLookup.mockResolvedValue({ address: "192.168.1.1", family: 4 });
      await expect(validateUrlNotInternal("http://router.local/")).rejects.toThrow(
        "blocked internal address"
      );
    });

    it("should block hostname resolving to 172.16.0.5", async () => {
      mockLookup.mockResolvedValue({ address: "172.16.0.5", family: 4 });
      await expect(validateUrlNotInternal("http://private.example.com/")).rejects.toThrow(
        "blocked internal address"
      );
    });

    it("should allow hostname resolving to public IP", async () => {
      mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 });
      await expect(validateUrlNotInternal("http://example.com/")).resolves.toBeUndefined();
    });

    it("should handle DNS lookup failure gracefully", async () => {
      mockLookup.mockRejectedValue(new Error("ENOTFOUND"));
      await expect(validateUrlNotInternal("http://nonexistent.invalid/")).resolves.toBeUndefined();
    });
  });

  describe("invalid URLs", () => {
    it("should throw on invalid URL", async () => {
      await expect(validateUrlNotInternal("not-a-url")).rejects.toThrow("Invalid URL");
    });
  });
});
