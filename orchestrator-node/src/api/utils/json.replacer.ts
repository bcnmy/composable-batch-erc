export function jsonReplacer(_key: unknown, value: unknown) {
  switch (typeof value) {
    case "bigint":
      return value.toString(10);

    default:
      return value;
  }
}
