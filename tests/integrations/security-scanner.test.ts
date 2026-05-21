import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SecurityScanner,
  SeverityLevel,
} from "../../src/integrations/security-scanner.js";
import type { Finding } from "../../src/integrations/security-scanner.js";
import type { LLMResponse } from "../../src/types/index.js";
import * as net from "net";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock tls module
vi.mock("tls", () => ({
  connect: vi.fn(),
}));

// Mock net module
vi.mock("net", () => ({
  Socket: vi.fn(),
}));

describe("SecurityScanner", () => {
  let scanner: SecurityScanner;

  beforeEach(() => {
    scanner = new SecurityScanner({ timeoutMs: 5000 });
    vi.clearAllMocks();
  });

  describe("analyzeHeaders", () => {
    it("should detect missing security headers", async () => {
      mockFetch.mockResolvedValueOnce({
        headers: new Headers({}),
      });

      const findings = await scanner.analyzeHeaders("https://example.com");

      expect(findings.length).toBe(7);
      expect(findings.every((f) => f.type === "missing_header")).toBe(true);
    });

    it("should not report present headers", async () => {
      mockFetch.mockResolvedValueOnce({
        headers: new Headers({
          "x-frame-options": "DENY",
          "content-security-policy": "default-src 'self'",
          "strict-transport-security": "max-age=31536000",
          "x-content-type-options": "nosniff",
          "x-xss-protection": "1; mode=block",
          "referrer-policy": "strict-origin",
          "permissions-policy": "camera=()",
        }),
      });

      const findings = await scanner.analyzeHeaders("https://secure.com");
      expect(findings.length).toBe(0);
    });

    it("should report partially missing headers", async () => {
      mockFetch.mockResolvedValueOnce({
        headers: new Headers({
          "x-frame-options": "DENY",
          "strict-transport-security": "max-age=31536000",
        }),
      });

      const findings = await scanner.analyzeHeaders("https://partial.com");
      expect(findings.length).toBe(5);

      const missingCSP = findings.find((f) =>
        f.title.includes("content-security-policy")
      );
      expect(missingCSP).toBeDefined();
      expect(missingCSP!.severity).toBe(SeverityLevel.HIGH);
    });

    it("should handle fetch errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const findings = await scanner.analyzeHeaders("https://unreachable.com");
      expect(findings.length).toBe(1);
      expect(findings[0].type).toBe("scan_error");
      expect(findings[0].severity).toBe(SeverityLevel.INFO);
    });

    it("should produce findings with correct structure", async () => {
      mockFetch.mockResolvedValueOnce({
        headers: new Headers({}),
      });

      const findings = await scanner.analyzeHeaders("https://example.com");

      for (const finding of findings) {
        expect(finding).toHaveProperty("type");
        expect(finding).toHaveProperty("severity");
        expect(finding).toHaveProperty("title");
        expect(finding).toHaveProperty("description");
        expect(Object.values(SeverityLevel)).toContain(finding.severity);
      }
    });
  });

  describe("checkSSL", () => {
    it("should detect expiring certificates", async () => {
      const tls = await import("tls");
      const mockSocket = {
        getPeerCertificate: vi.fn().mockReturnValue({
          valid_to: new Date(
            Date.now() + 15 * 24 * 60 * 60 * 1000
          ).toISOString(),
          issuer: { O: "Test CA" },
        }),
        getProtocol: vi.fn().mockReturnValue("TLSv1.3"),
        destroy: vi.fn(),
        on: vi.fn(),
      };

      (tls.connect as ReturnType<typeof vi.fn>).mockImplementation(
        (_options: unknown, callback: () => void) => {
          setTimeout(() => callback(), 0);
          return mockSocket;
        }
      );

      const findings = await scanner.checkSSL("example.com");

      const expiryFinding = findings.find((f) => f.type === "ssl_expiry");
      expect(expiryFinding).toBeDefined();
      expect(expiryFinding!.severity).toBe(SeverityLevel.HIGH);
      expect(expiryFinding!.title).toContain("expiring soon");
    });

    it("should detect expired certificates", async () => {
      const tls = await import("tls");
      const mockSocket = {
        getPeerCertificate: vi.fn().mockReturnValue({
          valid_to: new Date(
            Date.now() - 5 * 24 * 60 * 60 * 1000
          ).toISOString(),
          issuer: { O: "Test CA" },
        }),
        getProtocol: vi.fn().mockReturnValue("TLSv1.3"),
        destroy: vi.fn(),
        on: vi.fn(),
      };

      (tls.connect as ReturnType<typeof vi.fn>).mockImplementation(
        (_options: unknown, callback: () => void) => {
          setTimeout(() => callback(), 0);
          return mockSocket;
        }
      );

      const findings = await scanner.checkSSL("expired.com");

      const expiryFinding = findings.find((f) => f.type === "ssl_expiry");
      expect(expiryFinding).toBeDefined();
      expect(expiryFinding!.severity).toBe(SeverityLevel.CRITICAL);
      expect(expiryFinding!.title).toContain("expired");
    });

    it("should handle SSL connection errors", async () => {
      const tls = await import("tls");
      const mockSocket = {
        on: vi.fn((event: string, handler: (err?: Error) => void) => {
          if (event === "error") {
            setTimeout(() => handler(new Error("Connection refused")), 0);
          }
          return mockSocket;
        }),
        destroy: vi.fn(),
      };

      (tls.connect as ReturnType<typeof vi.fn>).mockImplementation(() => {
        return mockSocket;
      });

      const findings = await scanner.checkSSL("nossl.com");

      expect(findings.length).toBeGreaterThan(0);
      const errorFinding = findings.find((f) => f.type === "ssl_error");
      expect(errorFinding).toBeDefined();
      expect(errorFinding!.severity).toBe(SeverityLevel.HIGH);
    });
  });

  describe("detectVulnerabilities", () => {
    it("should detect CORS wildcard misconfiguration", async () => {
      // First call is for redirect check
      mockFetch.mockResolvedValueOnce({
        headers: new Headers({}),
      });
      // Second call is for CORS check
      mockFetch.mockResolvedValueOnce({
        headers: new Headers({
          "access-control-allow-origin": "*",
        }),
      });
      // Remaining calls for sensitive paths - return 404
      for (let i = 0; i < 10; i++) {
        mockFetch.mockResolvedValueOnce({ status: 404 });
      }

      const findings = await scanner.detectVulnerabilities(
        "https://example.com"
      );

      const corsFinding = findings.find(
        (f) => f.type === "cors_misconfiguration"
      );
      expect(corsFinding).toBeDefined();
      expect(corsFinding!.severity).toBe(SeverityLevel.MEDIUM);
    });

    it("should detect exposed sensitive paths", async () => {
      // Redirect check
      mockFetch.mockResolvedValueOnce({
        headers: new Headers({}),
      });
      // CORS check
      mockFetch.mockResolvedValueOnce({
        headers: new Headers({}),
      });
      // First sensitive path (.env) returns 200
      mockFetch.mockResolvedValueOnce({ status: 200 });
      // Remaining sensitive paths return 404
      for (let i = 0; i < 9; i++) {
        mockFetch.mockResolvedValueOnce({ status: 404 });
      }

      const findings = await scanner.detectVulnerabilities(
        "https://example.com"
      );

      const pathFinding = findings.find((f) => f.type === "exposed_path");
      expect(pathFinding).toBeDefined();
      expect(pathFinding!.severity).toBe(SeverityLevel.HIGH);
      expect(pathFinding!.title).toContain(".env");
    });

    it("should detect open redirects", async () => {
      mockFetch.mockResolvedValueOnce({
        headers: new Headers({ location: "http://evil.com/malicious" }),
      });
      // CORS check
      mockFetch.mockResolvedValueOnce({
        headers: new Headers({}),
      });
      // Sensitive paths return 404
      for (let i = 0; i < 10; i++) {
        mockFetch.mockResolvedValueOnce({ status: 404 });
      }

      const findings = await scanner.detectVulnerabilities(
        "https://example.com"
      );

      const redirectFinding = findings.find((f) => f.type === "open_redirect");
      expect(redirectFinding).toBeDefined();
      expect(redirectFinding!.severity).toBe(SeverityLevel.MEDIUM);
    });
  });

  describe("scanPorts", () => {
    it("should detect open ports", async () => {
      const MockSocket = vi.fn().mockImplementation(() => {
        const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
        return {
          setTimeout: vi.fn(),
          on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            handlers[event] = handlers[event] || [];
            handlers[event].push(handler);
          }),
          connect: vi.fn((_port: number, _host: string) => {
            setTimeout(() => {
              if (handlers["connect"]) {
                handlers["connect"].forEach((h) => h());
              }
            }, 0);
          }),
          destroy: vi.fn(),
        };
      });

      (net.Socket as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        MockSocket
      );

      const findings = await scanner.scanPorts("example.com", [80, 443]);

      expect(findings.length).toBe(2);
      expect(findings[0].type).toBe("open_port");
      expect(findings[0].severity).toBe(SeverityLevel.INFO);
    });

    it("should mark database ports as medium severity", async () => {
      const MockSocket = vi.fn().mockImplementation(() => {
        const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
        return {
          setTimeout: vi.fn(),
          on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            handlers[event] = handlers[event] || [];
            handlers[event].push(handler);
          }),
          connect: vi.fn((_port: number, _host: string) => {
            setTimeout(() => {
              if (handlers["connect"]) {
                handlers["connect"].forEach((h) => h());
              }
            }, 0);
          }),
          destroy: vi.fn(),
        };
      });

      (net.Socket as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        MockSocket
      );

      const findings = await scanner.scanPorts("example.com", [3306]);

      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe(SeverityLevel.MEDIUM);
      expect(findings[0].title).toContain("3306");
    });

    it("should handle closed ports", async () => {
      const MockSocket = vi.fn().mockImplementation(() => {
        const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
        return {
          setTimeout: vi.fn(),
          on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            handlers[event] = handlers[event] || [];
            handlers[event].push(handler);
          }),
          connect: vi.fn((_port: number, _host: string) => {
            setTimeout(() => {
              if (handlers["error"]) {
                handlers["error"].forEach((h) => h(new Error("ECONNREFUSED")));
              }
            }, 0);
          }),
          destroy: vi.fn(),
        };
      });

      (net.Socket as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        MockSocket
      );

      const findings = await scanner.scanPorts("example.com", [9999]);
      expect(findings.length).toBe(0);
    });
  });

  describe("analyzeSolanaProgram", () => {
    it("should parse LLM findings", async () => {
      const mockLLM = vi.fn().mockResolvedValue({
        content: JSON.stringify([
          {
            type: "missing_signer_check",
            severity: "HIGH",
            title: "Missing signer validation",
            description: "The instruction handler does not verify the signer.",
            recommendation: "Add a signer check before processing.",
          },
        ]),
        model: "test-model",
        tokensUsed: 100,
      } as LLMResponse);

      const findings = await scanner.analyzeSolanaProgram(
        "pub fn process_instruction() { /* ... */ }",
        mockLLM
      );

      expect(findings.length).toBe(1);
      expect(findings[0].type).toBe("missing_signer_check");
      expect(findings[0].severity).toBe(SeverityLevel.HIGH);
      expect(findings[0].title).toBe("Missing signer validation");
    });

    it("should handle LLM errors gracefully", async () => {
      const mockLLM = vi.fn().mockRejectedValue(new Error("LLM unavailable"));

      const findings = await scanner.analyzeSolanaProgram(
        "pub fn process() {}",
        mockLLM
      );

      expect(findings.length).toBe(1);
      expect(findings[0].type).toBe("analysis_error");
      expect(findings[0].severity).toBe(SeverityLevel.INFO);
    });

    it("should handle non-JSON LLM responses", async () => {
      const mockLLM = vi.fn().mockResolvedValue({
        content: "I could not analyze this program properly.",
        model: "test-model",
        tokensUsed: 50,
      } as LLMResponse);

      const findings = await scanner.analyzeSolanaProgram(
        "pub fn process() {}",
        mockLLM
      );

      expect(findings.length).toBe(0);
    });
  });

  describe("aggregateResults", () => {
    it("should calculate score correctly", () => {
      const findings: Finding[] = [
        {
          type: "test",
          severity: SeverityLevel.HIGH,
          title: "High issue",
          description: "A high severity issue",
        },
        {
          type: "test",
          severity: SeverityLevel.MEDIUM,
          title: "Medium issue",
          description: "A medium severity issue",
        },
        {
          type: "test",
          severity: SeverityLevel.LOW,
          title: "Low issue",
          description: "A low severity issue",
        },
      ];

      const result = scanner.aggregateResults(
        "https://example.com",
        "full_scan",
        findings
      );

      // 100 - 15 (HIGH) - 10 (MEDIUM) - 5 (LOW) = 70
      expect(result.score).toBe(70);
      expect(result.findings).toHaveLength(3);
      expect(result.target).toBe("https://example.com");
      expect(result.scanType).toBe("full_scan");
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("should not go below 0 score", () => {
      const findings: Finding[] = [];
      for (let i = 0; i < 5; i++) {
        findings.push({
          type: "test",
          severity: SeverityLevel.CRITICAL,
          title: `Critical ${i}`,
          description: "Critical issue",
        });
      }

      const result = scanner.aggregateResults("target", "scan", findings);
      // 100 - (5 * 25) = -25, clamped to 0
      expect(result.score).toBe(0);
    });

    it("should return 100 for no findings", () => {
      const result = scanner.aggregateResults("target", "scan", []);
      expect(result.score).toBe(100);
      expect(result.summary).toContain("CLEAN");
    });

    it("should generate appropriate summary for critical findings", () => {
      const findings: Finding[] = [
        {
          type: "test",
          severity: SeverityLevel.CRITICAL,
          title: "Critical",
          description: "Critical issue",
        },
      ];

      const result = scanner.aggregateResults("target", "scan", findings);
      expect(result.summary).toContain("CRITICAL");
      expect(result.summary).toContain("Immediate action required");
    });

    it("should generate appropriate summary for high findings", () => {
      const findings: Finding[] = [
        {
          type: "test",
          severity: SeverityLevel.HIGH,
          title: "High",
          description: "High issue",
        },
      ];

      const result = scanner.aggregateResults("target", "scan", findings);
      expect(result.summary).toContain("WARNING");
    });

    it("should generate appropriate summary for medium findings", () => {
      const findings: Finding[] = [
        {
          type: "test",
          severity: SeverityLevel.MEDIUM,
          title: "Medium",
          description: "Medium issue",
        },
      ];

      const result = scanner.aggregateResults("target", "scan", findings);
      expect(result.summary).toContain("MODERATE");
    });

    it("should generate appropriate summary for low/info findings", () => {
      const findings: Finding[] = [
        {
          type: "test",
          severity: SeverityLevel.INFO,
          title: "Info",
          description: "Info finding",
        },
      ];

      const result = scanner.aggregateResults("target", "scan", findings);
      expect(result.summary).toContain("LOW RISK");
    });

    it("should have correct result structure", () => {
      const findings: Finding[] = [
        {
          type: "test",
          severity: SeverityLevel.MEDIUM,
          title: "Test",
          description: "Test finding",
        },
      ];

      const result = scanner.aggregateResults(
        "https://target.com",
        "header_scan",
        findings
      );

      expect(result).toHaveProperty("target", "https://target.com");
      expect(result).toHaveProperty("scanType", "header_scan");
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("findings");
      expect(result).toHaveProperty("score");
      expect(result).toHaveProperty("summary");
    });
  });
});
