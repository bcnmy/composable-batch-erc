export function unixTimestamp(increasedBy = 0) {
  return Math.floor(Date.now() / 1000) + increasedBy;
}
