// Separate metrics class for atomic-like updates
export class ProviderMetrics {
  private _consecutiveFailures = 0;
  private _lastFailureTimestamp = 0;
  private _totalRequests = 0;
  private _successfulRequests = 0;
  private _averageResponseTime = 0;
  private _responseTimes: number[] = [];
  private readonly maxResponseTimeSamples = 100;

  // Getters for safe concurrent reads
  get consecutiveFailures(): number {
    return this._consecutiveFailures;
  }
  get lastFailureTimestamp(): number {
    return this._lastFailureTimestamp;
  }
  get totalRequests(): number {
    return this._totalRequests;
  }
  get successfulRequests(): number {
    return this._successfulRequests;
  }
  get averageResponseTime(): number {
    return this._averageResponseTime;
  }
  get successRate(): number {
    return this._totalRequests > 0
      ? this._successfulRequests / this._totalRequests
      : 0;
  }

  // Atomic-like increment operations (JS is single-threaded, these are safe)
  incrementTotal(): void {
    this._totalRequests++;
  }

  recordSuccess(responseTime: number): void {
    this._totalRequests++;
    this._successfulRequests++;
    this._consecutiveFailures = 0;

    // Update rolling average efficiently
    this._responseTimes.push(responseTime);
    if (this._responseTimes.length > this.maxResponseTimeSamples) {
      this._responseTimes.shift();
    }

    // Calculate average from samples
    const sum = this._responseTimes.reduce((a, b) => a + b, 0);
    this._averageResponseTime = sum / this._responseTimes.length;
  }

  recordFailure(): void {
    this._totalRequests++;
    this._consecutiveFailures++;
    this._lastFailureTimestamp = Date.now();
  }

  reset(): void {
    this._consecutiveFailures = 0;
    this._totalRequests = 0;
    this._successfulRequests = 0;
    this._averageResponseTime = 0;
    this._responseTimes = [];
  }

  snapshot(): {
    consecutiveFailures: number;
    totalRequests: number;
    successfulRequests: number;
    averageResponseTime: number;
    successRate: number;
  } {
    return {
      consecutiveFailures: this._consecutiveFailures,
      totalRequests: this._totalRequests,
      successfulRequests: this._successfulRequests,
      averageResponseTime: this._averageResponseTime,
      successRate: this.successRate,
    };
  }
}
