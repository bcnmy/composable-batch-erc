import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  context,
  trace,
} from "@opentelemetry/api";
import { AxiosError, isAxiosError } from "axios";
import { stringify } from "viem";
import { sanitizeUrl } from "./sanitize-url";

// Singleton tracer instance
let tracerInstance: ReturnType<typeof trace.getTracer> | null = null;

/**
 * Get the OpenTelemetry tracer singleton
 */
export function getTracer() {
  if (!tracerInstance) {
    tracerInstance = trace.getTracer(
      process.env.OTEL_SERVICE_NAME || "mee-node",
      "1.0.0",
    );
  }
  return tracerInstance;
}

/**
 * Pure function to wrap async operations with OpenTelemetry tracing
 *
 * @example
 * const result = await traceOperation('user.fetch', async () => {
 *   return await fetchUser(userId);
 * }, { userId });
 */
export async function traceOperation<T>(
  operationName: string,
  fn: () => Promise<T>,
  tags?: Record<string, string | number | boolean>,
): Promise<T> {
  const span = getTracer().startSpan(operationName, {
    kind: SpanKind.INTERNAL,
    attributes: {
      component: process.env.OTEL_SERVICE_NAME || "mee-node",
      ...tags,
    },
  });

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      span.setAttributes({ success: true });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: formatError(error),
      });
      span.setAttributes({
        success: false,
        error: true,
        "error.message": formatError(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Create a custom span for manual tracking
 */
export function createSpan(
  operationName: string,
  tags?: Record<string, string | number | boolean>,
) {
  return getTracer().startSpan(operationName, {
    kind: SpanKind.INTERNAL,
    attributes: {
      component: process.env.OTEL_SERVICE_NAME || "mee-node",
      ...tags,
    },
  });
}

/**
 * Add tags to the current active span
 */
export function addSpanTags(tags: Record<string, string | number | boolean>) {
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttributes(tags);
  }
}

/**
 * Create an independent trace (not nested within current trace context)
 * This is useful for operations that should be tracked separately from the main request flow
 *
 * @example
 * const result = await traceIndependent('provider.getQuote', async () => {
 *   return await provider.getQuote(request);
 * }, { provider: 'lifi' });
 */
export async function traceIndependent<T>(
  operationName: string,
  fn: () => Promise<T>,
  tags?: Record<string, string | number | boolean>,
): Promise<T> {
  // Create a new root span by using ROOT_CONTEXT
  return context.with(ROOT_CONTEXT, () => {
    const span = getTracer().startSpan(operationName, {
      kind: SpanKind.CLIENT, // Use CLIENT kind for external service calls
      attributes: {
        component: process.env.OTEL_SERVICE_NAME || "mee-node",
        ...tags,
      },
    });

    return context.with(trace.setSpan(ROOT_CONTEXT, span), async () => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        span.setAttributes({ success: true });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: formatError(error),
        });
        span.setAttributes({
          success: false,
          error: true,
          "error.message": formatError(error),
        });
        throw error;
      } finally {
        span.end();
      }
    });
  });
}

export function formatError(err: unknown): string {
  let errMsg = "Internal Server Error";

  if (isAxiosError(err)) {
    const { message, code, config } = err.toJSON() as AxiosError;
    errMsg = `Axios Error [${code}]: ${message} - ${stringify(config)}`;
  } else if (err instanceof Error) {
    errMsg = err.message;
  } else if (typeof err === "string") {
    errMsg = err;
  }

  return sanitizeUrl(errMsg);
}
