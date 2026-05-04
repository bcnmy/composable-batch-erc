function replacer(_key: unknown, value: unknown) {
  switch (typeof value) {
    case "bigint":
      return `${value.toString(10)}n`;

    default:
      return value;
  }
}

function reviver(_key: string, value: unknown) {
  if (typeof value === "string" && /^\d+n$/.test(value)) {
    return BigInt(value.slice(0, -1));
  }

  return value;
}

export function stringify(data: unknown) {
  return JSON.stringify(data, replacer);
}

export function parse<T>(data: string): T {
  return JSON.parse(data, reviver) as T;
}
