// src/middleware/GcpLogger.ts
import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

type GetUserIdFn = (req: Request) => string | undefined;

export type GcpLoggerOptions = {
  redactHeaders?: string[];
  captureBody?: boolean;
  maxBodyLength?: number;
  getUserId?: GetUserIdFn;
  skipPaths?: RegExp[];
  projectIdEnvVar?: string; // לזיהוי trace אוטומטי אם יש
};

export class GcpLogger {
  private opts: Required<GcpLoggerOptions>;

  constructor(options: GcpLoggerOptions = {}) {
    this.opts = {
      redactHeaders: (options.redactHeaders ?? ["authorization", "cookie"]).map(
        (h) => h.toLowerCase()
      ),
      captureBody: options.captureBody ?? false,
      maxBodyLength: options.maxBodyLength ?? 10_000,
      getUserId: options.getUserId ?? (() => undefined),
      skipPaths: options.skipPaths ?? [
        /^\/healthz$/,
        /^\/metrics$/,
        /^\/favicon\.ico$/,
      ],
      projectIdEnvVar: options.projectIdEnvVar ?? "GCP_PROJECT", // או GOOGLE_CLOUD_PROJECT
    };
  }

  private shouldSkip(path: string): boolean {
    return this.opts.skipPaths.some((rx) => rx.test(path));
  }

  private safeHeaders(
    req: Request
  ): Record<string, string | string[] | undefined> {
    const headers: Record<string, any> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      headers[k] = this.opts.redactHeaders.includes(k.toLowerCase())
        ? "[REDACTED]"
        : v;
    }
    return headers;
  }

  private safeBody(req: Request): string | undefined {
    if (!this.opts.captureBody) return undefined;
    try {
      const raw =
        typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      if (!raw) return undefined;
      return raw.length > this.opts.maxBodyLength
        ? raw.slice(0, this.opts.maxBodyLength) + "…[truncated]"
        : raw;
    } catch {
      return "[unserializable body]";
    }
  }

  /** helper ל-build של traceId (כדי שיופיע ב־Logs Explorer) */
  private buildTrace(req: Request): string | undefined {
    const projectId =
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      process.env[this.opts.projectIdEnvVar];

    // אם מגיע header של Cloud Trace (למשל מ־Load Balancer), נשתמש בו
    const traceHeader = (req.headers["x-cloud-trace-context"] as string) || "";
    const traceId = traceHeader.split("/")[0];

    if (projectId && traceId) {
      return `projects/${projectId}/traces/${traceId}`;
    }
    return undefined;
  }

  request() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (this.shouldSkip(req.path)) return next();

      const started = process.hrtime.bigint();
      const requestId =
        (req.headers["x-request-id"] as string) || crypto.randomUUID();
      (req as any).requestId = requestId;

      // כשלוגים מגיעים מה-LB של גוגל, Cloud Logging יודע לנתח httpRequest אוטומטית
      const trace = this.buildTrace(req);

      res.on("finish", () => {
        const durationMs = Number(
          (process.hrtime.bigint() - started) / BigInt(1_000_000)
        );
        const userId = this.opts.getUserId(req);

        // structured log
        const logEntry = {
          severity: this.statusToSeverity(res.statusCode), // INFO/WARNING/ERROR
          message: "HTTP request",
          httpRequest: {
            requestMethod: req.method,
            requestUrl: req.originalUrl || req.url,
            status: res.statusCode,
            userAgent: req.headers["user-agent"],
            referer: req.headers["referer"],
            protocol: req.protocol?.toUpperCase?.(),
            remoteIp: req.ip,
            latency: `${Math.max(durationMs, 0) / 1000}s`,
          },
          trace, // כדי שיתחבר ב-Logs Explorer
          // שדות מותאמים אישית:
          requestId,
          type: "request",
          path: req.path,
          query: req.query,
          durationMs,
          userId: userId ?? null,
          host: req.headers["host"],
          headers: this.safeHeaders(req),
          body: this.safeBody(req),
        };

        // שליחה ל-Cloud Logging דרך console (נאמן וקל)
        console.log(JSON.stringify(logEntry));
      });

      next();
    };
  }

  error() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return (err: any, req: Request, res: Response, next: NextFunction) => {
      const requestId = (req as any).requestId || crypto.randomUUID();
      const userId = this.opts.getUserId(req);
      const trace = this.buildTrace(req);

      const logEntry = {
        severity: "ERROR" as const,
        message: err?.message || "Unhandled error",
        trace,
        httpRequest: {
          requestMethod: req.method,
          requestUrl: req.originalUrl || req.url,
          status: res.statusCode,
          userAgent: req.headers["user-agent"],
          remoteIp: req.ip,
        },
        type: "error",
        requestId,
        path: req.path,
        userId: userId ?? null,
        stack: err?.stack?.toString?.(),
        headers: this.safeHeaders(req),
      };

      console.error(JSON.stringify(logEntry)); // משתמשים ב-console.error כדי לקבל severity גבוה
      next(err);
    };
  }

  private statusToSeverity(status: number): "INFO" | "WARNING" | "ERROR" {
    if (status >= 500) return "ERROR";
    if (status >= 400) return "WARNING";
    return "INFO";
  }
}
