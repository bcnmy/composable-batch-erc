export function parseBool(value: string | undefined, defaults = false) {
  let result: boolean;

  if (!value) {
    result = defaults;
  } else {
    switch (value.toLowerCase().trim()[0]) {
      case "t":
      case "y":
      case "1":
        result = true;
        break;

      case "f":
      case "n":
      case "0":
        result = false;
        break;

      default:
        result = defaults;
    }
  }

  return result;
}
