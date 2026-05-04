export function round(decimalNumber: string, decimalPlaces: number) {
  const factor = 10 ** decimalPlaces;

  return (
    Math.round(Number.parseFloat(decimalNumber) * factor) / factor
  ).toFixed(decimalPlaces);
}
