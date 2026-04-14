export function validateUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
