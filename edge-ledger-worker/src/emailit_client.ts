export interface EmailAttachment {
  filename: string;
  content?: string; // Base64 string
  url?: string;     // Remote resource URL
  content_type?: string;
  content_id?: string;
}

export interface EmailOptions {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  template?: string;
  variables?: Record<string, any>;
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  meta?: Record<string, string>;
  idempotencyKey?: string;
}

export interface DispatchResult {
  success: boolean;
  provider: 'emailit' | 'resend';
  messageId?: string;
  rawResponse?: any;
  error?: string;
}

export interface EmailItTelemetry {
  rateLimitRemaining: number;
  dailyRemaining: number;
  dailyResetSeconds: number;
}

export class EmailDispatchManager {
  private emailitApiKey: string;
  private resendApiKey: string;
  private primaryBaseUrl = 'https://api.emailit.com/v2';
  private secondaryBaseUrl = 'https://api.resend.com';

  private isCircuitOpen = false;
  private circuitCooldownUntil = 0;
  private latestTelemetry: EmailItTelemetry | null = null;
  private env: any;
  private ctx: any;

  constructor(emailitApiKey: string, resendApiKey: string, env: any, ctx?: any) {
    this.emailitApiKey = emailitApiKey;
    this.resendApiKey = resendApiKey;
    this.env = env;
    this.ctx = ctx;
  }

  public async init() {
     try {
         const cb = await this.env.GREEN_STATE.get("emailit_circuit_breaker");
         if (cb === "open") {
             this.isCircuitOpen = true;
             this.circuitCooldownUntil = Date.now() + (5 * 60 * 1000);
         }

         const dr = await this.env.GREEN_STATE.get("emailit_daily_remaining");
         if (dr !== null) {
             this.latestTelemetry = {
                 rateLimitRemaining: 0,
                 dailyRemaining: parseInt(dr, 10),
                 dailyResetSeconds: 0
             }
         }
     } catch (e) {
         console.error("Failed to init EmailDispatchManager from KV", e);
     }
  }

  /**
   * Main send call: Routes to primary or secondary provider based on system health
   */
  public async send(options: EmailOptions): Promise<DispatchResult> {
    const now = Date.now();

    if (this.isCircuitOpen) {
      if (now > this.circuitCooldownUntil) {
        this.isCircuitOpen = false;
        if (this.ctx && this.ctx.waitUntil) {
            this.ctx.waitUntil(this.env.GREEN_STATE.delete("emailit_circuit_breaker"));
        } else {
            await this.env.GREEN_STATE.delete("emailit_circuit_breaker");
        }
      } else {
        return this.sendViaResend(options, 'Circuit breaker active for EmailIt');
      }
    }

    if (this.latestTelemetry && this.latestTelemetry.dailyRemaining <= 0) {
      return this.sendViaResend(options, 'EmailIt daily sending quota exhausted');
    }

    try {
      return await this.sendViaEmailIt(options);
    } catch (error: any) {
      // Trip circuit breaker for 5 minutes on server errors or failures
      this.tripCircuitBreaker(5 * 60 * 1000);
      return await this.sendViaResend(options, error.message);
    }
  }

  /**
   * Dispatches outbound email using primary provider (EmailIt API v2)
   */
  private async sendViaEmailIt(options: EmailOptions): Promise<DispatchResult> {
    const endpoint = `${this.primaryBaseUrl}/emails`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.emailitApiKey}`,
      'Content-Type': 'application/json'
    };

    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    const payload = {
      from: options.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      reply_to: options.reply_to,
      cc: options.cc,
      bcc: options.bcc,
      template: options.template,
      variables: options.variables,
      attachments: options.attachments,
      headers: options.headers,
      meta: options.meta
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal as any
      });

      this.extractTelemetryHeaders(response);

      if (response.status === 429) {
        throw new Error('EmailIt Rate Limit Exceeded (HTTP 429)');
      }

      if (!response.ok) {
        let errorData = {};
        try {
            errorData = await response.json();
        } catch(e) {}
        throw new Error(`EmailIt API Error [HTTP ${response.status}]: ${JSON.stringify(errorData)}`);
      }

      const data = await (response.json() as any);
      return {
        success: true,
        provider: 'emailit',
        messageId: data.id,
        rawResponse: data
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Dispatches outbound email using fallback provider (Resend API v1)
   */
  private async sendViaResend(options: EmailOptions, reason: string): Promise<DispatchResult> {
    if (!this.resendApiKey) {
        return {
            success: false,
            provider: 'resend',
            error: `Failed to fallback to Resend: API key missing. Reason for failover: ${reason}`
        }
    }

    const endpoint = `${this.secondaryBaseUrl}/emails`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.resendApiKey}`,
      'Content-Type': 'application/json'
    };

    if (options.idempotencyKey) {
      headers['X-Idempotency-Key'] = options.idempotencyKey;
    }

    const processedAttachments = await this.resolveAttachmentsForResend(options.attachments);

    const payload: Record<string, any> = {
      from: options.from,
      to: Array.isArray(options.to) ? options.to : [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
      cc: options.cc ? (Array.isArray(options.cc) ? options.cc : [options.cc]) : undefined,
      bcc: options.bcc ? (Array.isArray(options.bcc) ? options.bcc : [options.bcc]) : undefined,
      reply_to: options.reply_to ? (Array.isArray(options.reply_to) ? options.reply_to : [options.reply_to]) : undefined,
      headers: options.headers,
      attachments: processedAttachments
    };

    if (options.meta) {
      payload.tags = Object.entries(options.meta).map(([name, value]) => ({ name, value }));
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      let errorBody = {};
      try {
          errorBody = await response.json();
      } catch (e) {}
      return {
          success: false,
          provider: 'resend',
          error: `Critical Secondary Provider Failure (Resend) [HTTP ${response.status}]: ${JSON.stringify(errorBody)}`
      };
    }

    const data = await (response.json() as any);
    return {
      success: true,
      provider: 'resend',
      messageId: data.id,
      rawResponse: data
    };
  }

  /**
   * Extracts rate limit and telemetry headers from EmailIt API responses
   */
  private extractTelemetryHeaders(response: Response): void {
    const remaining = response.headers.get('ratelimit-remaining');
    const dailyRemaining = response.headers.get('ratelimit-daily-remaining');
    const dailyReset = response.headers.get('ratelimit-daily-reset');

    if (dailyRemaining !== null) {
      this.latestTelemetry = {
        rateLimitRemaining: remaining ? parseInt(remaining, 10) : 0,
        dailyRemaining: parseInt(dailyRemaining, 10),
        dailyResetSeconds: dailyReset ? parseInt(dailyReset, 10) : 0
      };

      const p = this.env.GREEN_STATE.put("emailit_daily_remaining", dailyRemaining);
      if (this.ctx && this.ctx.waitUntil) {
          this.ctx.waitUntil(p);
      }
    }
  }

  /**
   * Converts URL-based attachments into Base64 strings for Resend compatibility
   */
  private async resolveAttachmentsForResend(attachments?: EmailAttachment[]): Promise<any[] | undefined> {
    if (!attachments || attachments.length === 0) return undefined;

    const resolved = [];
    for (const att of attachments) {
      if (att.content) {
        resolved.push({ filename: att.filename, content: att.content });
      } else if (att.url) {
        const res = await fetch(att.url);
        const buffer = await res.arrayBuffer();

        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        resolved.push({ filename: att.filename, content: btoa(binary) });
      }
    }
    return resolved;
  }

  private tripCircuitBreaker(durationMs: number): void {
    this.isCircuitOpen = true;
    this.circuitCooldownUntil = Date.now() + durationMs;
    const p = this.env.GREEN_STATE.put("emailit_circuit_breaker", "open", { expirationTtl: durationMs / 1000 });
    if (this.ctx && this.ctx.waitUntil) {
        this.ctx.waitUntil(p);
    }
  }

  public async verifyEmailConnection(): Promise<boolean> {
     const endpoint = `${this.primaryBaseUrl}/emails`;

     try {
         // Perform a simple invalid payload request to verify auth without burning daily limits
         const response = await fetch(endpoint, {
             method: 'POST',
             headers: {
                 'Authorization': `Bearer ${this.emailitApiKey}`,
                 'Content-Type': 'application/json'
             },
             body: JSON.stringify({})
         });

         // 400 Bad Request indicates auth succeeded but payload is bad.
         // 401 Unauthorized indicates auth failed.
         if (response.status === 401 || response.status === 403) {
             return false;
         }
         return true;
     } catch (e) {
         return false;
     }
  }
}
