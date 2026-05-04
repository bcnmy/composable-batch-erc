import { ServiceUnavailableException } from "@/common";
import { withTrace } from "@/common/utils/trace-wrapper";
import { HealthCheckService } from "@/health-check";
import { type RequestHandler } from "express";
import { Container } from "typedi";

export const healthHandler: RequestHandler<
  never,
  unknown,
  never,
  {
    detailed?: unknown;
  }
> = await withTrace("/health", async (req, res) => {
  const { query } = req;

  const detailed = typeof query.detailed !== "undefined"; // `/health?detailed`

  const { result } = Container.get(HealthCheckService);

  if (result?.status !== "healthy") {
    throw new ServiceUnavailableException(
      result && detailed ? result : undefined,
    );
  }

  res.send(
    detailed
      ? result
      : {
          healthy: true,
        },
  );
});
