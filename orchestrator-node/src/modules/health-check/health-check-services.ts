import { ChainsService } from "@/chains";
import { RedisService } from "@/core/redis";
import { ExecutorService } from "@/executor";
import { NodeService } from "@/node";
import { SimulatorService } from "@/simulator";
import { TokenSlotDetectionService } from "@/token-slot-detection";
import { WorkersService } from "@/workers";
import { Service } from "typedi";

@Service()
export class HealthCheckServices {
  constructor(
    readonly chainsService: ChainsService,
    readonly simulatorService: SimulatorService,
    readonly executorService: ExecutorService,
    readonly nodeService: NodeService,
    readonly workersService: WorkersService,
    readonly redisService: RedisService,
    readonly tokenSlotDetectionService: TokenSlotDetectionService,
  ) {}
}
