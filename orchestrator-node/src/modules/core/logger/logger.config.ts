import process from "node:process";
import { parseBool, parseOption } from "@/common";
import { registerConfigAs } from "@/core/config";
import { type Level, levels } from "pino";
import { values } from "remeda";

export const loggerConfig = registerConfigAs("logger", () => ({
  level:
    parseOption<Level>(process.env.LOG_LEVEL, values(levels.labels)) || "info",
  pretty: parseBool(process.env.PRETTY_LOGS),
  callers: (process.env.LOG_CALLERS || "").split(",").filter(Boolean),
}));
