import { parseOption } from "@/common";
import { type JobBackoffType } from "../interfaces";

export function parseJobBackoffType(
  value: string | undefined,
  defaultValue: JobBackoffType,
) {
  return (
    parseOption<JobBackoffType>(value, ["fixed", "exponential"]) || defaultValue
  );
}
