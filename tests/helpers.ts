import request from "supertest";
import app from "../src/app";

export const PLANS = {
  starter: "00000000-0000-0000-0000-000000000001",
  pro: "00000000-0000-0000-0000-000000000002",
  basic: "00000000-0000-0000-0000-000000000003",
  premium: "00000000-0000-0000-0000-000000000004",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withKey(req: any, key?: string) {
  if (key) req.set("X-API-Key", key);
  return req;
}

export const get = (path: string, key?: string) => withKey(request(app).get(path), key);
export const post = (path: string, key: string | undefined, body: object) =>
  withKey(request(app).post(path), key).send(body);
export const put = (path: string, key: string | undefined, body: object) =>
  withKey(request(app).put(path), key).send(body);
export const patch = (path: string, key: string | undefined, body: object) =>
  withKey(request(app).patch(path), key).send(body);

let counter = 0;
export const rid = () => `req-${Date.now()}-${counter++}`;

export async function createAccount(name = "Test Co") {
  const res = await post("/accounts", undefined, { name });
  return { id: res.body.account.id as string, key: res.body.apiKey as string };
}

export async function createUser(key: string, externalId: string, planId?: string) {
  const res = await post("/users", key, { externalId, planId });
  if (res.status !== 201) throw new Error(`createUser failed: ${JSON.stringify(res.body)}`);
}

export async function createPlan(
  key: string,
  name: string,
  monthlyLimit: number,
  maxUnitsPerRequest: number
): Promise<string> {
  const res = await post("/plans", key, { name, monthlyLimit, maxUnitsPerRequest });
  if (res.status !== 201) throw new Error(`createPlan failed: ${JSON.stringify(res.body)}`);
  return res.body.plan.id as string;
}

export async function setAccountPlan(key: string, planId: string) {
  const res = await put("/account/plan", key, { planId });
  if (res.status !== 200) throw new Error(`setAccountPlan failed: ${JSON.stringify(res.body)}`);
}

export const consume = (key: string, externalId: string, units: unknown, requestId: unknown) =>
  post("/consume", key, { externalId, units, requestId });

// A ready-made account with custom plans and one user, "sara".
export async function setup(accountMonthly = 1000, accountMax = 100, userMonthly = 100, userMax = 20) {
  const acct = await createAccount();
  const accountPlan = await createPlan(acct.key, "acct-plan", accountMonthly, accountMax);
  await setAccountPlan(acct.key, accountPlan);
  const userPlan = await createPlan(acct.key, "user-plan", userMonthly, userMax);
  await createUser(acct.key, "sara", userPlan);
  return { ...acct, accountPlan, userPlan };
}

export async function usageOf(key: string) {
  const res = await get("/usage", key);
  return {
    account: res.body.account.unitsUsed as number,
    users: res.body.usersUnitsTotal as number,
  };
}