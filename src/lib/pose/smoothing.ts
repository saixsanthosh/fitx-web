/**
 * One Euro filter (Casiez, Roussel and Vogel, CHI 2012): strong smoothing while a value is still,
 * little lag while it moves fast. Used on joint angles so jitter near a threshold cannot fake a rep.
 */
export class OneEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly derivativeCutoff: number;
  private last: number | null = null;
  private lastDerivative = 0;
  private lastTime = 0;

  /**
   * @param minCutoff Hz of smoothing when still (lower = smoother, more lag)
   * @param beta how quickly smoothing relaxes as the value speeds up (per unit/second)
   * @param derivativeCutoff Hz used to smooth the speed estimate
   */
  constructor(minCutoff = 1, beta = 0, derivativeCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
  }

  /** Filters `value` observed at `timeMs`. Out-of-order or repeated times return the last output. */
  filter(value: number, timeMs: number): number {
    if (this.last === null) {
      this.last = value;
      this.lastTime = timeMs;
      this.lastDerivative = 0;
      return value;
    }
    const dt = (timeMs - this.lastTime) / 1000;
    if (!(dt > 0)) return this.last;
    const derivative = (value - this.last) / dt;
    const smoothedDerivative = blend(derivative, this.lastDerivative, alpha(this.derivativeCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(smoothedDerivative);
    const result = blend(value, this.last, alpha(cutoff, dt));
    this.last = result;
    this.lastDerivative = smoothedDerivative;
    this.lastTime = timeMs;
    return result;
  }

  reset(): void {
    this.last = null;
    this.lastDerivative = 0;
  }
}

function alpha(cutoffHz: number, dtSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSeconds);
}

function blend(value: number, previous: number, weight: number): number {
  return weight * value + (1 - weight) * previous;
}
