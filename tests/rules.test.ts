import { describe, expect, it } from "vitest";
import { evaluate, remainingOf, type LevelState } from "../src/domain/rules";

const state = (monthly: number, max: number, used = 0): LevelState => ({
  planId: "p", planName: "plan", monthlyLimit: monthly, maxUnitsPerRequest: max, unitsUsed: used,
});

describe("rules from the brief", () => {
  // account: 10,000/month and 100/request. user: 1,000/month and 20/request
  const account = state(10_000, 100);
  const user = state(1_000, 20);

  it("rejects 25 units because of the USER per-request limit", () => {
    expect(evaluate(25, user, account)).toEqual({ level: "user", rule: "max_units_per_request" });
  });

  it("accepts 10 units when both have enough", () => {
    expect(evaluate(10, user, account)).toBeNull();
  });

  it("rejects 10 units when the account has only 5 left", () => {
    expect(evaluate(10, user, state(10_000, 100, 9_995))).toEqual({
      level: "account",
      rule: "monthly_allowance",
    });
  });

  it("never reports negative remaining when the limit is below usage", () => {
    expect(remainingOf(state(300, 20, 400))).toBe(0);
    expect(evaluate(1, state(300, 20, 400), account)).toEqual({
      level: "user",
      rule: "monthly_allowance",
    });
  });
});