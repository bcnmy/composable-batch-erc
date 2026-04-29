import { isArray, isPlainObject, map, mapValues } from "remeda";

export function decodeJobData<T = unknown>(data: T): T {
  switch (typeof data) {
    case "string": {
      if (/^\d+n$/.test(data)) {
        return BigInt(data.slice(0, -1)) as unknown as T;
      }
      break;
    }

    case "object":
      if (isArray(data)) {
        return map(data, decodeJobData) as T;
      }

      if (isPlainObject(data)) {
        return mapValues(data, decodeJobData) as T;
      }
      break;
  }

  return data;
}
