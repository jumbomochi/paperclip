import { describe, it, expect, beforeEach } from 'vitest';
import { MonthlyBudget, BudgetExceededError } from '../src/rateLimit.js';

describe('MonthlyBudget', () => {
  let budget: MonthlyBudget;
  beforeEach(() => {
    budget = new MonthlyBudget({ kind: 'reads', cap: 5 });
  });

  it('records consumption and reports remaining', () => {
    budget.consume(2);
    expect(budget.remaining()).toBe(3);
  });

  it('throws when about to exceed cap', () => {
    budget.consume(4);
    expect(() => budget.consume(2)).toThrow(BudgetExceededError);
  });

  it('does not throw on exactly hitting the cap', () => {
    expect(() => budget.consume(5)).not.toThrow();
    expect(budget.remaining()).toBe(0);
  });

  it('resets on month rollover', () => {
    budget.consume(5);
    budget.setNow(new Date('2030-01-01'));
    expect(budget.remaining()).toBe(5);
  });
});
