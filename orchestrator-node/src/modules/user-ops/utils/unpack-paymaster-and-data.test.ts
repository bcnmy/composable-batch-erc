import { describe, expect, it } from "vitest";
import { unpackPaymasterAndData } from "./unpack-paymaster-and-data";

describe("unpackPaymasterAndData", () => {
  it("should unpack paymasterAndData ", () => {
    const input =
      "0xdb959e94db5c2b5eb8da8b7e959f04fc37cf8a13000000000000000000000000000003e8000000000000000000000000000000c8010203";

    const expected = {
      paymaster: "0xDB959E94Db5C2b5eb8DA8b7e959F04fC37cf8A13",
      paymasterVerificationGasLimit: 1000n,
      postOpGasLimit: 200n,
      paymasterData: "0x010203",
    };

    expect(unpackPaymasterAndData(input)).toEqual(expected);
  });
});
