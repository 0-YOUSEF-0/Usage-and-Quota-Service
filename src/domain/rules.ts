export type Level = "account" | "user";
export type Rule = "max_units_per_request" | "monthly_allowance";

// The numbers that matter for one level (account or user) at decision time.
export interface LevelState {
  planId: string;
  planName: string;
  monthlyLimit: number;
  maxUnitsPerRequest: number;
  unitsUsed: number;
}

export interface Rejection {
  level: Level;
  rule: Rule;
}

// Never negative, even if the limit was lowered below usage.
export function remainingOf(state: LevelState): number {
  return Math.max(0, state.monthlyLimit - state.unitsUsed);
}

// Runs the four checks in a fixed order and returns the FIRST one that fails.
export function evaluate(
  units: number,
  user: LevelState,
  account: LevelState
): Rejection | null {
  if (units > user.maxUnitsPerRequest) {
    return { level: "user", rule: "max_units_per_request" };
  }
  if (units > account.maxUnitsPerRequest) {
    return { level: "account", rule: "max_units_per_request" };
  }
  if (units > remainingOf(user)) {
    return { level: "user", rule: "monthly_allowance" };
  }
  if (units > remainingOf(account)) {
    return { level: "account", rule: "monthly_allowance" };
  }
  return null;
}

export function describeRejection(
  rejection: Rejection,
  units: number,
  user: LevelState,
  account: LevelState
): string {
  const state = rejection.level === "user" ? user : account;

  if (rejection.rule === "max_units_per_request") {
    return `Requested ${units} units, but the ${rejection.level} plan "${state.planName}" allows at most ${state.maxUnitsPerRequest} per request.`;
  }
  return `Requested ${units} units, but only ${remainingOf(state)} remain in the ${rejection.level} monthly allowance (plan "${state.planName}", limit ${state.monthlyLimit}).`;
}