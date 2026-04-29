export function parseOption<T = string>(
  value: string | undefined,
  options: string[],
): T | undefined {
  if (!value) {
    return;
  }

  return options.includes(value) ? (value as unknown as T) : undefined;
}
