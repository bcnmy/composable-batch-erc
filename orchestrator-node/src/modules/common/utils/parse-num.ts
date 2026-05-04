export function parseNum(
  value: string | undefined,
  defaults: number,
  options: {
    type?: "int" | "float";
    min?: number;
    max?: number;
  } = {},
) {
  if (!value) {
    return defaults;
  }

  const { type, min, max } = options;

  const num =
    type === "float" ? Number.parseFloat(value) : Number.parseInt(value, 10);

  if (Number.isNaN(num)) {
    return defaults;
  }

  if ((min || min === 0) && min > num) {
    return min;
  }

  if ((max || max === 0) && max < num) {
    return max;
  }

  return num;
}
