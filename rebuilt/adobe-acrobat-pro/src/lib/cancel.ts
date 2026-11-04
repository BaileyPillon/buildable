/** Cooperative cancellation for long jobs (compress, OCR). */
export class CancelToken {
  cancelled = false;
  private waiters: Array<() => void> = [];

  cancel() {
    this.cancelled = true;
    this.waiters.splice(0).forEach((w) => w());
  }

  /** Resolve `p`, unless the token is cancelled first (then reject with "Cancelled"). */
  race<T>(p: Promise<T>): Promise<T> {
    if (this.cancelled) return Promise.reject(new Error('Cancelled'));
    return new Promise<T>((resolve, reject) => {
      this.waiters.push(() => reject(new Error('Cancelled')));
      p.then(resolve, reject);
    });
  }
}
