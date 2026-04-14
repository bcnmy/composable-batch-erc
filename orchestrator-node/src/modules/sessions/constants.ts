import { Hex } from "viem";

export const SmartSessionMode = {
  USE: "0x00" as Hex,
  ENABLE: "0x01" as Hex,
  UNSAFE_ENABLE: "0x02" as Hex,
} as const;
