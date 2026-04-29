import cluster from "node:cluster";
import { setupEnvs } from "@/common/setup";

setupEnvs();

// Initialize OpenTelemetry tracing first, before any other imports
if (process.env.OTEL_TRACE_ENABLED === "true") {
  (async () => {
    const tracingModule = await import("./tracing-opentelemetry");
    tracingModule.initialize(
      cluster.isPrimary ? "master-worker" : "api-worker",
    );
  })();
}

async function main() {
  if (cluster.isPrimary) {
    await import("./master").then(({ bootstrap }) => bootstrap());
  } else {
    await import("./api").then(({ bootstrap }) => bootstrap());
  }
}

main().catch(console.error);
