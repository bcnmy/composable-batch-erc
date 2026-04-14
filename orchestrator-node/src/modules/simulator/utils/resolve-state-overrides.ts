import { type StateOverride } from "viem";

export function resolveStateOverrides(
  stateOverrides: StateOverride,
): StateOverride {
  type StateOverrideEntry = (typeof stateOverrides)[number];
  const map = new Map<string, StateOverrideEntry>();

  for (const entry of stateOverrides) {
    if (!map.has(entry.address)) {
      map.set(entry.address, { ...entry });
    } else {
      const existing = map.get(entry.address);

      // This should never happen
      if (!existing) {
        throw new Error("Failed to resolved state overrides");
      }

      // Merge stateDiff if present
      if (entry.stateDiff && existing.stateDiff) {
        existing.stateDiff = existing.stateDiff.concat(entry.stateDiff);
      } else if (entry.stateDiff && !existing.stateDiff) {
        existing.stateDiff = entry.stateDiff.slice();
      }

      // Merge balance if present
      if ("balance" in entry && entry.balance !== undefined) {
        if ("balance" in existing && existing.balance !== undefined) {
          existing.balance = existing.balance + entry.balance;
        } else {
          existing.balance = entry.balance;
        }
      }

      // Merge code if present. Last one in the array will override the previous ones.
      if ("code" in entry) {
        existing.code = entry.code;
      }
    }
  }

  return Array.from(map.values());
}
