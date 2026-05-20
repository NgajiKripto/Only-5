import winston from "winston";
import { config } from "../config.js";
import { mkdirSync } from "fs";

// Ensure logs directory exists
mkdirSync("logs", { recursive: true });

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "YYYY-MM-DDTHH:mm:ss.SSSZ" }),
  winston.format.printf(({ timestamp, level, message, module, ...meta }) => {
    const mod = module ? `[${module}]` : "";
    const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} ${level} ${mod} ${message}${extra}`;
  })
);

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DDTHH:mm:ss.SSSZ" }),
  winston.format.json()
);

const baseLogger = winston.createLogger({
  level: config.LOG_LEVEL,
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.File({
      filename: "logs/agent.log",
      format: fileFormat,
    }),
  ],
});

export function createLogger(module: string): winston.Logger {
  return baseLogger.child({ module });
}

export { baseLogger as logger };
