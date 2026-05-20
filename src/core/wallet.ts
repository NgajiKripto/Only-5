import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { config } from "../config.js";
import { createLogger } from "./logger.js";
import type { MemorySystem } from "./memory.js";

const logger = createLogger("wallet");

export interface TokenBalance {
  mint: string;
  amount: number;
  decimals: number;
}

export class WalletManager {
  private connection: Connection;
  private keypair: Keypair;
  private memory: MemorySystem | null;

  constructor(memory?: MemorySystem, connection?: Connection, keypair?: Keypair) {
    this.memory = memory ?? null;

    if (connection) {
      this.connection = connection;
    } else {
      this.connection = new Connection(config.SOLANA_RPC_URL, "confirmed");
    }

    if (keypair) {
      this.keypair = keypair;
    } else {
      const privateKeyBytes = bs58.decode(config.SOLANA_PRIVATE_KEY);
      this.keypair = Keypair.fromSecretKey(privateKeyBytes);
    }

    logger.info(`Wallet initialized: ${this.keypair.publicKey.toBase58()}`);
  }

  get publicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  getConnection(): Connection {
    return this.connection;
  }

  async getBalance(): Promise<number> {
    const lamports = await this.connection.getBalance(this.keypair.publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  async getTokenBalances(): Promise<TokenBalance[]> {
    const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
      this.keypair.publicKey,
      { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
    );

    return tokenAccounts.value.map((account) => {
      const data = account.account.data.parsed.info;
      return {
        mint: data.mint as string,
        amount: Number(data.tokenAmount.uiAmount),
        decimals: data.tokenAmount.decimals as number,
      };
    });
  }

  async sendSol(to: string, amount: number): Promise<string> {
    const balanceBefore = await this.getBalance();

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.keypair.publicKey,
        toPubkey: new PublicKey(to),
        lamports: Math.round(amount * LAMPORTS_PER_SOL),
      })
    );

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.keypair]
    );

    const balanceAfter = await this.getBalance();

    logger.info(`Sent ${amount} SOL to ${to}`, { signature });

    if (this.memory) {
      this.memory.remember(
        "transaction",
        JSON.stringify({
          type: "send_sol",
          to,
          amount,
          signature,
          balanceBefore,
          balanceAfter,
          pnl: balanceAfter - balanceBefore + amount,
        })
      );
    }

    return signature;
  }

  /**
   * Signs a legacy Transaction internally without exposing the keypair.
   */
  async signTransaction(tx: Transaction): Promise<Transaction> {
    tx.sign(this.keypair);
    return tx;
  }

  /**
   * Signs a VersionedTransaction internally and submits it to the network.
   * Returns the transaction signature.
   */
  async signAndSendVersionedTransaction(
    serializedTransaction: Buffer
  ): Promise<string> {
    const transaction = VersionedTransaction.deserialize(serializedTransaction);
    transaction.sign([this.keypair]);

    const rawTransaction = transaction.serialize();
    const signature = await this.connection.sendRawTransaction(rawTransaction, {
      skipPreflight: false,
      maxRetries: 2,
    });

    return signature;
  }

  async trackPnL(
    action: string,
    balanceBefore: number,
    balanceAfter: number
  ): Promise<void> {
    const pnl = balanceAfter - balanceBefore;
    logger.info(`P&L for ${action}: ${pnl} SOL`, {
      balanceBefore,
      balanceAfter,
    });

    if (this.memory) {
      this.memory.remember(
        "pnl",
        JSON.stringify({
          action,
          balanceBefore,
          balanceAfter,
          pnl,
          timestamp: Date.now(),
        })
      );
    }
  }
}
