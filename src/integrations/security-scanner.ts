import * as tls from "tls";
import * as net from "net";
import { z } from "zod";
import { createLogger } from "../core/logger.js";
import { validateUrlNotInternal } from "../core/url-validator.js";
import type { LLMMessage, LLMResponse } from "../types/index.js";

const logger = createLogger("security-scanner");

export enum SeverityLevel {
  INFO = "INFO",
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
  CRITICAL = "CRITICAL",
}

export interface Finding {
  type: string;
  severity: SeverityLevel;
  title: string;
  description: string;
  evidence?: string;
  recommendation?: string;
}

export interface ScanResult {
  target: string;
  scanType: string;
  timestamp: number;
  findings: Finding[];
  score: number;
  summary: string;
}

interface ScannerConfig {
  timeoutMs?: number;
}

type ChatFunction = (
  messages: LLMMessage[],
  options?: { model?: string; temperature?: number; maxTokens?: number }
) => Promise<LLMResponse>;

const SECURITY_HEADERS: Array<{
  name: string;
  severity: SeverityLevel;
  recommendation: string;
}> = [
  {
    name: "x-frame-options",
    severity: SeverityLevel.MEDIUM,
    recommendation:
      "Add X-Frame-Options header with value DENY or SAMEORIGIN to prevent clickjacking attacks.",
  },
  {
    name: "content-security-policy",
    severity: SeverityLevel.HIGH,
    recommendation:
      "Implement a Content-Security-Policy header to mitigate XSS and data injection attacks.",
  },
  {
    name: "strict-transport-security",
    severity: SeverityLevel.HIGH,
    recommendation:
      "Add Strict-Transport-Security header to enforce HTTPS connections.",
  },
  {
    name: "x-content-type-options",
    severity: SeverityLevel.LOW,
    recommendation:
      "Add X-Content-Type-Options: nosniff to prevent MIME type sniffing.",
  },
  {
    name: "x-xss-protection",
    severity: SeverityLevel.LOW,
    recommendation:
      "Add X-XSS-Protection header for legacy browser XSS filtering.",
  },
  {
    name: "referrer-policy",
    severity: SeverityLevel.LOW,
    recommendation:
      "Add Referrer-Policy header to control referrer information leakage.",
  },
  {
    name: "permissions-policy",
    severity: SeverityLevel.MEDIUM,
    recommendation:
      "Add Permissions-Policy header to restrict browser feature access.",
  },
];

const SENSITIVE_PATHS = [
  "/.env",
  "/.git/config",
  "/wp-admin",
  "/.htaccess",
  "/server-status",
  "/.DS_Store",
  "/phpinfo.php",
  "/admin",
  "/backup.sql",
  "/.svn/entries",
];

const DEFAULT_SCAN_PORTS = [
  21, 22, 80, 443, 3306, 5432, 6379, 8080, 8443, 27017,
];

const DATABASE_PORTS = new Set([3306, 5432, 6379, 27017]);

export class SecurityScanner {
  private timeoutMs: number;

  constructor(config?: ScannerConfig) {
    this.timeoutMs = config?.timeoutMs ?? 10000;
  }

  async analyzeHeaders(url: string): Promise<Finding[]> {
    const findings: Finding[] = [];

    try {
      await validateUrlNotInternal(url);
    } catch {
      findings.push({
        type: "ssrf_blocked",
        severity: SeverityLevel.INFO,
        title: "Internal URL blocked",
        description: `The URL ${url} resolves to an internal/private address and was blocked.`,
      });
      return findings;
    }

    try {
      const response = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      for (const header of SECURITY_HEADERS) {
        const value = response.headers.get(header.name);
        if (!value) {
          findings.push({
            type: "missing_header",
            severity: header.severity,
            title: `Missing ${header.name} header`,
            description: `The response does not include the ${header.name} security header.`,
            recommendation: header.recommendation,
          });
        }
      }
    } catch (error) {
      logger.warn(`Failed to analyze headers for ${url}`, {
        error: (error as Error).message,
      });
      findings.push({
        type: "scan_error",
        severity: SeverityLevel.INFO,
        title: "Header analysis failed",
        description: `Could not fetch headers from ${url}: ${(error as Error).message}`,
      });
    }

    return findings;
  }

  async checkSSL(hostname: string): Promise<Finding[]> {
    const findings: Finding[] = [];

    // SSRF protection: validate hostname does not resolve to internal network
    try {
      await validateUrlNotInternal(`https://${hostname}`);
    } catch (error) {
      findings.push({
        type: "scan_blocked",
        severity: SeverityLevel.INFO,
        title: "SSL check blocked by SSRF protection",
        description: `The hostname ${hostname} was blocked: ${(error as Error).message}`,
      });
      return findings;
    }

    try {
      const cert = await this.getSSLCertificate(hostname);

      if (cert.validTo) {
        const expiryDate = new Date(cert.validTo);
        const daysUntilExpiry = Math.floor(
          (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );

        if (daysUntilExpiry < 0) {
          findings.push({
            type: "ssl_expiry",
            severity: SeverityLevel.CRITICAL,
            title: "SSL certificate expired",
            description: `The SSL certificate expired ${Math.abs(daysUntilExpiry)} days ago.`,
            evidence: `Expiry date: ${cert.validTo}`,
            recommendation: "Renew the SSL certificate immediately.",
          });
        } else if (daysUntilExpiry < 30) {
          findings.push({
            type: "ssl_expiry",
            severity: SeverityLevel.HIGH,
            title: "SSL certificate expiring soon",
            description: `The SSL certificate will expire in ${daysUntilExpiry} days.`,
            evidence: `Expiry date: ${cert.validTo}`,
            recommendation:
              "Renew the SSL certificate before it expires.",
          });
        }
      }

      if (cert.protocol && cert.protocol < "TLSv1.2") {
        findings.push({
          type: "ssl_protocol",
          severity: SeverityLevel.HIGH,
          title: "Outdated TLS protocol version",
          description: `The server uses ${cert.protocol} which is considered insecure.`,
          evidence: `Protocol: ${cert.protocol}`,
          recommendation: "Upgrade to TLS 1.2 or higher.",
        });
      }

      if (cert.issuer) {
        findings.push({
          type: "ssl_info",
          severity: SeverityLevel.INFO,
          title: "SSL certificate issuer",
          description: `Certificate issued by: ${cert.issuer}`,
          evidence: `Issuer: ${cert.issuer}`,
        });
      }
    } catch (error) {
      findings.push({
        type: "ssl_error",
        severity: SeverityLevel.HIGH,
        title: "SSL connection failed",
        description: `Could not establish SSL connection to ${hostname}: ${(error as Error).message}`,
        recommendation:
          "Verify that the server supports HTTPS and the certificate is valid.",
      });
    }

    return findings;
  }

  async detectVulnerabilities(url: string): Promise<Finding[]> {
    // DISCLAIMER: This method performs active scanning (probing sensitive paths,
    // checking for open redirects, etc.) against the target URL. Only use this
    // against targets the operator has explicit permission to test.
    const findings: Finding[] = [];

    try {
      await validateUrlNotInternal(url);
    } catch {
      findings.push({
        type: "ssrf_blocked",
        severity: SeverityLevel.INFO,
        title: "Internal URL blocked",
        description: `The URL ${url} resolves to an internal/private address and was blocked.`,
      });
      return findings;
    }

    // Check for open redirects
    try {
      const redirectUrl = new URL(url);
      redirectUrl.searchParams.set("redirect", "http://evil.com");
      redirectUrl.searchParams.set("url", "http://evil.com");
      redirectUrl.searchParams.set("next", "http://evil.com");

      const response = await fetch(redirectUrl.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const location = response.headers.get("location");
      if (location && location.includes("evil.com")) {
        findings.push({
          type: "open_redirect",
          severity: SeverityLevel.MEDIUM,
          title: "Potential open redirect",
          description:
            "The application may redirect to arbitrary external URLs.",
          evidence: `Location header: ${location}`,
          recommendation:
            "Validate and whitelist redirect destinations.",
        });
      }
    } catch {
      // Ignore errors for redirect check
    }

    // Check CORS misconfiguration
    try {
      const response = await fetch(url, {
        headers: { Origin: "http://evil.com" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const acao = response.headers.get("access-control-allow-origin");
      if (acao === "*") {
        findings.push({
          type: "cors_misconfiguration",
          severity: SeverityLevel.MEDIUM,
          title: "Permissive CORS policy",
          description:
            "The server allows requests from any origin (Access-Control-Allow-Origin: *).",
          evidence: `Access-Control-Allow-Origin: ${acao}`,
          recommendation:
            "Restrict CORS to trusted origins only.",
        });
      } else if (acao === "http://evil.com") {
        findings.push({
          type: "cors_misconfiguration",
          severity: SeverityLevel.HIGH,
          title: "CORS reflects arbitrary origin",
          description:
            "The server reflects the Origin header in Access-Control-Allow-Origin, allowing any site to make authenticated requests.",
          evidence: `Access-Control-Allow-Origin: ${acao}`,
          recommendation:
            "Implement a whitelist of allowed origins.",
        });
      }
    } catch {
      // Ignore errors for CORS check
    }

    // Check exposed sensitive paths
    for (const path of SENSITIVE_PATHS) {
      try {
        const checkUrl = new URL(path, url).toString();
        const response = await fetch(checkUrl, {
          method: "HEAD",
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.status !== 404 && response.status < 500) {
          findings.push({
            type: "exposed_path",
            severity: SeverityLevel.HIGH,
            title: `Sensitive path accessible: ${path}`,
            description: `The path ${path} returned status ${response.status}, which may indicate exposure of sensitive files.`,
            evidence: `Status: ${response.status}`,
            recommendation: `Block access to ${path} in your web server configuration.`,
          });
        }
      } catch {
        // Ignore connection errors for path checks
      }
    }

    return findings;
  }

  async analyzeSolanaProgram(
    programSource: string,
    llm: ChatFunction
  ): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Content length guard to prevent abuse and excessive token usage
    const MAX_PROGRAM_LENGTH = 50000;
    if (programSource.length > MAX_PROGRAM_LENGTH) {
      findings.push({
        type: "input_error",
        severity: SeverityLevel.INFO,
        title: "Program source too large",
        description: `Program source exceeds maximum length of ${MAX_PROGRAM_LENGTH} characters.`,
      });
      return findings;
    }

    // Strip common prompt injection patterns and directives
    const sanitizedSource = programSource
      .replace(/```[\s\S]*?```/g, (match) => match) // keep code blocks as-is
      .replace(/^(IGNORE|DISREGARD|FORGET|OVERRIDE|SYSTEM|ASSISTANT)[\s:].*$/gim, "")
      .replace(/<\/?[a-z][^>]*>/gi, "") // strip HTML/XML tags
      .replace(/\[INST\]|\[\/INST\]|\<\|im_start\|\>|\<\|im_end\|\>/g, ""); // strip common LLM control tokens

    const messages: LLMMessage[] = [
      {
        role: "system",
        content: `You are a Solana smart contract security auditor. Analyze the following program source code for vulnerabilities. For each vulnerability found, respond with a JSON array of objects with these fields: type (string), severity (INFO|LOW|MEDIUM|HIGH|CRITICAL), title (string), description (string), recommendation (string). Common vulnerabilities to check: missing signer checks, integer overflow/underflow, reentrancy, unauthorized access, missing owner checks, unchecked arithmetic, account confusion attacks. If no vulnerabilities are found, return an empty array [].`,
      },
      {
        role: "user",
        content: sanitizedSource,
      },
    ];

    try {
      const response = await llm(messages, {
        temperature: 0.2,
        maxTokens: 2048,
      });

      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const FindingSchema = z.object({
          type: z.string().max(100),
          severity: z.string().optional(),
          title: z.string().max(200),
          description: z.string().max(2000),
          recommendation: z.string().max(1000).optional(),
        });

        const parsed = JSON.parse(jsonMatch[0]) as Array<{
          type?: string;
          severity?: string;
          title?: string;
          description?: string;
          recommendation?: string;
        }>;

        for (const item of parsed) {
          const result = FindingSchema.safeParse(item);
          if (result.success) {
            findings.push({
              type: result.data.type,
              severity: this.parseSeverity(result.data.severity),
              title: result.data.title,
              description: result.data.description,
              recommendation: result.data.recommendation,
            });
          }
        }
      }
    } catch (error) {
      logger.warn("Failed to analyze Solana program", {
        error: (error as Error).message,
      });
      findings.push({
        type: "analysis_error",
        severity: SeverityLevel.INFO,
        title: "Solana program analysis failed",
        description: `LLM analysis failed: ${(error as Error).message}`,
      });
    }

    return findings;
  }

  async scanPorts(
    hostname: string,
    ports?: number[]
  ): Promise<Finding[]> {
    const findings: Finding[] = [];

    try {
      await validateUrlNotInternal(`http://${hostname}`);
    } catch {
      findings.push({
        type: "ssrf_blocked",
        severity: SeverityLevel.INFO,
        title: "Internal hostname blocked",
        description: `The hostname ${hostname} resolves to an internal/private address and was blocked.`,
      });
      return findings;
    }

    const portsToScan = ports ?? DEFAULT_SCAN_PORTS;

    const results = await Promise.allSettled(
      portsToScan.map((port) => this.checkPort(hostname, port))
    );

    for (let i = 0; i < portsToScan.length; i++) {
      const port = portsToScan[i];
      const result = results[i];

      if (result.status === "fulfilled" && result.value) {
        const isDbPort = DATABASE_PORTS.has(port);
        findings.push({
          type: "open_port",
          severity: isDbPort ? SeverityLevel.MEDIUM : SeverityLevel.INFO,
          title: `Open port: ${port}`,
          description: isDbPort
            ? `Database port ${port} is open and accessible from external networks.`
            : `Port ${port} is open.`,
          evidence: `Port ${port} accepted TCP connection`,
          recommendation: isDbPort
            ? `Restrict access to port ${port} using firewall rules. Database ports should not be publicly accessible.`
            : undefined,
        });
      }
    }

    return findings;
  }

  aggregateResults(
    target: string,
    scanType: string,
    findings: Finding[]
  ): ScanResult {
    let score = 100;

    const severityDeductions: Record<SeverityLevel, number> = {
      [SeverityLevel.CRITICAL]: 25,
      [SeverityLevel.HIGH]: 15,
      [SeverityLevel.MEDIUM]: 10,
      [SeverityLevel.LOW]: 5,
      [SeverityLevel.INFO]: 1,
    };

    for (const finding of findings) {
      score -= severityDeductions[finding.severity];
    }

    score = Math.max(0, score);

    const criticalCount = findings.filter(
      (f) => f.severity === SeverityLevel.CRITICAL
    ).length;
    const highCount = findings.filter(
      (f) => f.severity === SeverityLevel.HIGH
    ).length;
    const mediumCount = findings.filter(
      (f) => f.severity === SeverityLevel.MEDIUM
    ).length;

    let summary: string;
    if (criticalCount > 0) {
      summary = `CRITICAL: Found ${criticalCount} critical, ${highCount} high, and ${mediumCount} medium severity issues. Immediate action required.`;
    } else if (highCount > 0) {
      summary = `WARNING: Found ${highCount} high and ${mediumCount} medium severity issues. Action recommended.`;
    } else if (mediumCount > 0) {
      summary = `MODERATE: Found ${mediumCount} medium severity issues. Review recommended.`;
    } else if (findings.length > 0) {
      summary = `LOW RISK: Found ${findings.length} low-severity or informational findings.`;
    } else {
      summary = "CLEAN: No security issues detected.";
    }

    return {
      target,
      scanType,
      timestamp: Date.now(),
      findings,
      score,
      summary,
    };
  }

  private parseSeverity(value?: string): SeverityLevel {
    if (!value) return SeverityLevel.MEDIUM;
    const upper = value.toUpperCase();
    if (upper in SeverityLevel) {
      return upper as SeverityLevel;
    }
    return SeverityLevel.MEDIUM;
  }

  private getSSLCertificate(
    hostname: string
  ): Promise<{ validTo?: string; protocol?: string; issuer?: string }> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          host: hostname,
          port: 443,
          timeout: this.timeoutMs,
          rejectUnauthorized: false,
        },
        () => {
          const cert = socket.getPeerCertificate();
          const protocol = socket.getProtocol() ?? undefined;

          socket.destroy();
          resolve({
            validTo: cert.valid_to,
            protocol,
            issuer: cert.issuer
              ? `${cert.issuer.O ?? "Unknown"}`
              : undefined,
          });
        }
      );

      socket.on("error", (err) => {
        socket.destroy();
        reject(err);
      });

      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error("SSL connection timed out"));
      });
    });
  }

  private checkPort(hostname: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(3000);

      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });

      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });

      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, hostname);
    });
  }
}
