import {
  USEROP_MAX_EXEC_WINDOW_DURATION,
  USEROP_MAX_WAIT_BEFORE_EXEC_START,
  USEROP_MIN_EXEC_WINDOW_DURATION,
} from "@/user-ops/userop.config";
import { BadRequestException } from "../exceptions";
import { unixTimestamp } from "./unix-timestamp";

export const validateTimestamps = (
  lowerBoundTimestamp: number,
  upperBoundTimestamp: number,
) => {
  if (lowerBoundTimestamp > unixTimestamp(USEROP_MAX_WAIT_BEFORE_EXEC_START)) {
    throw new BadRequestException(
      "Some of your supertransaction instructions are scheduled too far in the future.",
    );
  }
  const delta = upperBoundTimestamp - lowerBoundTimestamp;
  if (delta > USEROP_MAX_EXEC_WINDOW_DURATION) {
    throw new BadRequestException(
      `Received upper bound unix timestamp ${upperBoundTimestamp} and lower bound unix timestamp ${lowerBoundTimestamp}. Time window is greater than the maximum allowed execution window of ${USEROP_MAX_EXEC_WINDOW_DURATION}s. Please reduce the execution time by adjusting the lower and upper bound timestamps.`,
    );
  }
  if (delta < USEROP_MIN_EXEC_WINDOW_DURATION) {
    throw new BadRequestException(
      `Received upper bound unix timestamp ${upperBoundTimestamp} and lower bound unix timestamp ${lowerBoundTimestamp}. Time window is less than the minimum allowed execution window of ${USEROP_MIN_EXEC_WINDOW_DURATION}s. Please increase the execution time by adjusting the lower and upper bound timestamps.`,
    );
  }
};
