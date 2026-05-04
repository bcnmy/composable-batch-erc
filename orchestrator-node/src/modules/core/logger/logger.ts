import process from "node:process";
import { threadId } from "node:worker_threads";
import { type ConfigType, InjectConfig } from "@/core/config";
import pino, {
  levels,
  type Bindings,
  type Logger as BaseLogger,
  type LevelWithSilent,
} from "pino";
import { values } from "remeda";
import { Service } from "typedi";
import { loggerConfig } from "./logger.config";

@Service({
  transient: true,
})
export class Logger implements Pick<BaseLogger, LevelWithSilent> {
  private static bindings: Bindings = {};

  static setName(name: string) {
    Logger.bindings.name = name;
  }

  private pinoInstance: BaseLogger | undefined;

  constructor(
    @InjectConfig(loggerConfig)
    private readonly config: ConfigType<typeof loggerConfig>,
  ) {
    //
  }

  setCaller(callerLike: string | { name: string }) {
    const caller =
      typeof callerLike === "string" ? callerLike : callerLike.name;

    this.pino.setBindings({
      caller,
    });

    return this;
  }

  get fatal() {
    return this.proxyLog("fatal");
  }

  get error() {
    return this.proxyLog("error");
  }

  get warn() {
    return this.proxyLog("warn");
  }

  get info() {
    return this.proxyLog("info");
  }

  get debug() {
    return this.proxyLog("debug");
  }

  get trace() {
    return this.proxyLog("trace");
  }

  get silent() {
    return this.pino.silent;
  }

  private proxyLog(level: LevelWithSilent) {
    const { callers } = this.config;
    const { caller } = this.pino.bindings() as { caller: string };

    if (caller && callers.length && !callers.includes(caller)) {
      return this.pino.silent;
    }

    return this.pino[level];
  }

  private get pino(): BaseLogger {
    if (!this.pinoInstance) {
      const { level, pretty } = this.config;
      const { pid } = process;

      if (pretty) {
        this.pinoInstance = pino({
          base: {
            pid: `${pid}${threadId ? `/${threadId}` : ""}`,
            ...Logger.bindings,
          },
          level,
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "HH:MM:ss",
              colorizeObjects: true,
            },
          },
        });
      } else {
        this.pinoInstance = pino(
          {
            base: {
              pid,
              threadId: threadId || undefined,
            },
            level,
          },
          pino.destination({
            sync: false,
          }),
        );
      }

      for (const level of values(levels.labels) as LevelWithSilent[]) {
        this.pinoInstance[level] = this.pinoInstance[level].bind(this.pino);
      }
    }

    return this.pinoInstance;
  }
}
