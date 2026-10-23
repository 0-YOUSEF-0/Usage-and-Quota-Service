// ids for the default plans
export const PREDEFINED_PLAN_IDS = {
  starter: "00000000-0000-0000-0000-000000000001",
  pro: "00000000-0000-0000-0000-000000000002",
  basic: "00000000-0000-0000-0000-000000000003",
  premium: "00000000-0000-0000-0000-000000000004",
} as const;
// default plan for new accounts and users
export const DEFAULT_ACCOUNT_PLAN_ID = PREDEFINED_PLAN_IDS.starter;
export const DEFAULT_USER_PLAN_ID = PREDEFINED_PLAN_IDS.basic;