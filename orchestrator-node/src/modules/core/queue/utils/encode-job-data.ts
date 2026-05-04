import { isArray, isPlainObject, map, mapValues } from "remeda";

export function encodeJobData<T = unknown>(data: T): T {
  switch (typeof data) {
    case "bigint":
      return `${data.toString(10)}n` as unknown as T;

    case "object":
      if (isArray(data)) {
        return map(data, encodeJobData) as T;
      }

      if (isPlainObject(data)) {
        return mapValues(data, encodeJobData) as T;
      }
      break;
  }

  return data;
}
