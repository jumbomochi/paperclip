export class BudgetExceededError extends Error {
  constructor(public kind: string, public cap: number) {
    super(`monthly ${kind} budget exceeded (cap=${cap})`);
  }
}

interface BudgetState {
  used: number;
  monthKey: string;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export class MonthlyBudget {
  private state: BudgetState;
  private now: () => Date = () => new Date();

  constructor(private readonly opts: { kind: string; cap: number }) {
    this.state = { used: 0, monthKey: monthKey(this.now()) };
  }

  setNow(d: Date) {
    this.now = () => d;
    this.rollIfNeeded();
  }

  private rollIfNeeded() {
    const m = monthKey(this.now());
    if (m !== this.state.monthKey) this.state = { used: 0, monthKey: m };
  }

  consume(n: number): void {
    this.rollIfNeeded();
    if (this.state.used + n > this.opts.cap) {
      throw new BudgetExceededError(this.opts.kind, this.opts.cap);
    }
    this.state.used += n;
  }

  remaining(): number {
    this.rollIfNeeded();
    return Math.max(0, this.opts.cap - this.state.used);
  }
}
