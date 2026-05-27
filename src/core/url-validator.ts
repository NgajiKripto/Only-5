import dns from "dns";
import { createLogger } from "./logger.js";

const logger = createLogger("url-validator");

const BLOCKED_IPV4_RANGES = [
  { prefix: "127.", description: "loopback" },
  { prefix: "10.", description: "private (10.0.0.0/8)" },
  { prefix: "192.168.", description: "private (192.168.0.0/16)" },
  { prefix: "169.254.", description: "link-local" },
];

function isPrivate172(ip: string): boolean {
  if (!ip.startsWith("172.")) return false;
  const parts = ip.split(".");
  const second = parseInt(parts[1], 10);
  return second >= 16 && second <= 31;
}

function isBlockedIPv4(ip: string): boolean {
  for (const range of BLOCKED_IPV4_RANGES) {
    if (ip.startsWith(range.prefix)) return true;
  }
  if (isPrivate172(ip)) return true;
  if (ip === "169.254.169.254") return true;
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fe80")) return true;
  return false;
}

export async function validateUrlNotInternal(url: string): Promise<void> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  const hostname = parsedUrl.hostname;

  // Remove brackets from IPv6 literal
  const cleanHostname = hostname.replace(/^\[|\]$/g, "");

  // Check if hostname is already an IP
  if (isBlockedIPv4(cleanHostname) || isBlockedIPv6(cleanHostname)) {
    logger.warn("SSRF blocked: direct IP in blocked range", { url, ip: cleanHostname });
    throw new Error(`URL resolves to a blocked internal address: ${cleanHostname}`);
  }

  // Resolve hostname to check the actual IP
  try {
    const { address } = await dns.promises.lookup(cleanHostname);
    if (isBlockedIPv4(address) || isBlockedIPv6(address)) {
      logger.warn("SSRF blocked: hostname resolves to internal IP", { url, hostname, resolvedIp: address });
      throw new Error(`URL resolves to a blocked internal address: ${address}`);
    }
  } catch (error) {
    if ((error as Error).message.includes("blocked internal address")) {
      throw error;
    }
    // DNS resolution failure - let the caller handle connection errors
    logger.debug("DNS lookup failed for URL validation", { url, error: (error as Error).message });
  }
}
