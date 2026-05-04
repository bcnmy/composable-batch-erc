import { SafeJSON } from "@/common";
import { type UserOpEntity } from "@/user-ops";
import { mapValues } from "remeda";

export function decodeUserOpEntity(
  rawData: unknown | undefined,
  customFields?: unknown,
) {
  if (!rawData) {
    return null;
  }

  const entity = SafeJSON.parse<UserOpEntity>(rawData as string);

  if (customFields) {
    Object.assign(
      entity,
      mapValues(customFields as Record<string, string>, (value) =>
        SafeJSON.parse(value),
      ),
    );
  }

  return entity;
}
