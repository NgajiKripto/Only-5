import { describe, it, expect, vi, beforeEach } from "vitest";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { WalletManager } from "../../src/core/wallet.js";
import { MemorySystem } from "../../src/core/memory.js";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

// Mock connection
function createMockConnection(balance: number = 5 * LAMPORTS_PER_SOL) {
  return {
    getBalance: vi.fn().mockResolvedValue(balance),
    getParsedTokenAccountsByOwner: vi.fn().mockResolvedValue({
      value: [
        {
          pubkey: { toBase58: () => "tokenAccount1" },
          account: {
            data: {
              parsed: {
                info: {
                  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                  tokenAmount: {
                    uiAmount: 100.5,
                    decimals: 6,
                  },
                },
              },
            },
          },
        },
      ],
    }),
  } as any;
}

describe("WalletManager", () => {
  let wallet: WalletManager;
  let memory: MemorySystem;
  let mockConnection: any;
  let keypair: Keypair;

  beforeEach(() => {
    const dir = join(tmpdir(), "only5-wallet-test-" + randomUUID());
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "test.db");
    memory = new MemorySystem(dbPath);
    mockConnection = createMockConnection();
    keypair = Keypair.generate();
    wallet = new WalletManager(memory, mockConnection, keypair);
  });

  describe("initialization", () => {
    it("should initialize with provided keypair", () => {
      expect(wallet.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
    });

    it("should expose connection and keypair", () => {
      expect(wallet.getConnection()).toBe(mockConnection);
      expect(wallet.getKeypair()).toBe(keypair);
    });
  });

  describe("getBalance", () => {
    it("should return balance in SOL", async () => {
      const balance = await wallet.getBalance();
      expect(balance).toBe(5);
      expect(mockConnection.getBalance).toHaveBeenCalledWith(keypair.publicKey);
    });

    it("should return correct fractional balance", async () => {
      mockConnection.getBalance.mockResolvedValue(1.5 * LAMPORTS_PER_SOL);
      const balance = await wallet.getBalance();
      expect(balance).toBe(1.5);
    });
  });

  describe("getTokenBalances", () => {
    it("should return token balances", async () => {
      const balances = await wallet.getTokenBalances();
      expect(balances).toHaveLength(1);
      expect(balances[0].mint).toBe(
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
      );
      expect(balances[0].amount).toBe(100.5);
      expect(balances[0].decimals).toBe(6);
    });
  });

  describe("P&L tracking", () => {
    it("should track P&L in memory", async () => {
      await wallet.trackPnL("swap", 5.0, 5.3);

      const records = memory.recall("pnl");
      expect(records).toHaveLength(1);

      const data = JSON.parse(records[0].content);
      expect(data.action).toBe("swap");
      expect(data.balanceBefore).toBe(5.0);
      expect(data.balanceAfter).toBe(5.3);
      expect(data.pnl).toBeCloseTo(0.3);
    });

    it("should track negative P&L", async () => {
      await wallet.trackPnL("failed-trade", 10.0, 9.5);

      const records = memory.recall("pnl");
      const data = JSON.parse(records[0].content);
      expect(data.pnl).toBeCloseTo(-0.5);
    });
  });
});
