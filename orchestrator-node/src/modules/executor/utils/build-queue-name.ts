export function buildQueueName(chainId: string) {
  return `executor/${chainId}`;
}
