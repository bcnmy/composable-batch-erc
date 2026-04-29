import type { Address, Hex } from "viem";

export type TokenStorageSlotResponse =
  | {
      success: true;
      msg: {
        token: Address;
        contract: Address;
        slot: Hex;
        updateRatio: number;
        lang: string;
      };
    }
  | {
      success: false;
      error: string;
    };
