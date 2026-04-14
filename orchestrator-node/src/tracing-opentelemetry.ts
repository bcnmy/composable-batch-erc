import { NodeService } from "@/node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import Container from "typedi";

export const initialize = (serviceName: string) => {
  // Only initialize tracing if enabled
  if (process.env.OTEL_TRACE_ENABLED === "true") {
    console.log(`OpenTelemetry tracing initializing for ${serviceName}`);

    const nodeService = Container.get(NodeService);

    const traceExporter = new OTLPTraceExporter({
      url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318"}/v1/traces`,
      headers: process.env.OTEL_EXPORTER_OTLP_HEADERS
        ? JSON.parse(process.env.OTEL_EXPORTER_OTLP_HEADERS)
        : {},
    });

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        "service.name": process.env.OTEL_SERVICE_NAME || "mee-node",
        "service.version": nodeService.info.version || "1.2.0", // Default to 1.2.0
        "deployment.environment":
          process.env.OTEL_ENV || process.env.NODE_ENV || "development",
      }),
      traceExporter: traceExporter,
      instrumentations: [getNodeAutoInstrumentations()],
    });

    // Initialize the SDK and register with the OpenTelemetry API
    sdk.start();

    console.log(`OpenTelemetry tracing initialized for ${serviceName}`);
  }
};
