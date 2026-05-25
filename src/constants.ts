/** Minimum SOL balance before triggering low balance alert */
export const LOW_BALANCE_THRESHOLD_SOL = 0.2;

/** Time without successful cycle before health warning (10 minutes) */
export const HEALTH_CHECK_TIMEOUT_MS = 10 * 60 * 1000;

/** Max retry attempts for Jupiter swap transactions */
export const JUPITER_MAX_RETRIES = 3;

/** Base backoff delay for Jupiter retry logic (ms) */
export const JUPITER_BASE_BACKOFF_MS = 1000;

/** Maximum pending scan requests in queue */
export const MAX_SCAN_QUEUE_SIZE = 50;

/** Data retention period for database pruning (days) */
export const PRUNE_RETENTION_DAYS = 30;

/** Rate limit window duration (ms) */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** MCP default timeout (ms) */
export const MCP_DEFAULT_TIMEOUT_MS = 30_000;

/** MCP default max rate per minute */
export const MCP_DEFAULT_RATE_PER_MINUTE = 30;
