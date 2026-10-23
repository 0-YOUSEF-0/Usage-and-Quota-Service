import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../src/database/migrate";
import { pool } from "../src/database/pool";
import { consume as consumeService } from "../src/services/consume";
import {
  PLANS, consume, createAccount, createPlan, createUser, get, patch, post, put,
  rid, setAccountPlan, setup, usageOf,
} from "./helpers";

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await pool.end();
});

describe("API key authentication", () => {
  it("rejects a missing key", async () => {
    const res = await get("/account");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("missing_api_key");
  });

  it("rejects unknown and malformed keys", async () => {
    const fake = "mk_" + "A".repeat(43);
    expect((await get("/account", fake)).status).toBe(401);
    expect((await get("/account", "hello")).status).toBe(401);
  });

  it("accepts a correct key", async () => {
    const { key } = await createAccount("Acme");
    const res = await get("/account", key);
    expect(res.status).toBe(200);
    expect(res.body.account.name).toBe("Acme");
    expect(res.body.account.plan.name).toBe("Starter");
  });

  it("never stores the key in plaintext", async () => {
    const { key } = await createAccount();
    const plain = await pool.query("SELECT count(*) FROM accounts WHERE api_key_hash = $1", [key]);
    expect(plain.rows[0].count).toBe(0);
  });

  it("ignores an account id supplied by the caller", async () => {
    const a = await createAccount("A");
    const b = await createAccount("B");
    const res = await get(`/account?accountId=${b.id}`, a.key).set("X-Account-Id", b.id);
    expect(res.body.account.id).toBe(a.id);
  });
});

describe("account isolation", () => {
  it("hides other accounts' users and refuses to consume for them", async () => {
    const a = await createAccount("A");
    const b = await createAccount("B");
    await createUser(b.key, "bob");

    expect((await get("/users/bob", a.key)).status).toBe(404);
    expect((await put("/users/bob/plan", a.key, { planId: PLANS.premium })).status).toBe(404);
    expect((await consume(a.key, "bob", 1, rid())).status).toBe(404);
    expect((await get("/users", a.key)).body.total).toBe(0);
  });

  it("hides and protects other accounts' custom plans", async () => {
    const a = await createAccount("A");
    const b = await createAccount("B");
    const secret = await createPlan(b.key, "secret", 100, 10);
    await createUser(a.key, "x");

    expect((await get(`/plans/${secret}`, a.key)).status).toBe(404);
    expect((await patch(`/plans/${secret}`, a.key, { monthlyLimit: 1 })).status).toBe(404);
    expect((await put("/users/x/plan", a.key, { planId: secret })).status).toBe(400);
    expect((await put("/account/plan", a.key, { planId: secret })).status).toBe(400);
  });
});

describe("consume: the four rules", () => {
  it("accepts and counts at both levels", async () => {
    const { key } = await setup();
    const res = await consume(key, "sara", 10, rid());
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(true);
    expect(res.body.rejection).toBeNull();
    expect(res.body.user.unitsUsed).toBe(10);
    expect(res.body.user.remaining).toBe(90);
    expect(res.body.account.unitsUsed).toBe(10);
    expect(res.body.account.remaining).toBe(990);
  });

  it("rejects by the USER per-request limit and consumes nothing", async () => {
    const { key } = await setup();
    const res = await consume(key, "sara", 25, rid());
    expect(res.body.accepted).toBe(false);
    expect(res.body.rejection).toMatchObject({ level: "user", rule: "max_units_per_request" });
    expect(await usageOf(key)).toEqual({ account: 0, users: 0 });
  });

  it("rejects by the ACCOUNT per-request limit", async () => {
    const { key } = await setup(1000, 5, 100, 20);
    const res = await consume(key, "sara", 10, rid());
    expect(res.body.rejection).toMatchObject({ level: "account", rule: "max_units_per_request" });
  });

  it("rejects by the USER monthly allowance", async () => {
    const { key } = await setup(1000, 100, 30, 20);
    expect((await consume(key, "sara", 20, rid())).body.accepted).toBe(true);
    const res = await consume(key, "sara", 15, rid());
    expect(res.body.rejection).toMatchObject({ level: "user", rule: "monthly_allowance" });
    expect(await usageOf(key)).toEqual({ account: 20, users: 20 });
  });

  it("rejects by the shared ACCOUNT allowance even if the user has plenty left", async () => {
    const { key } = await setup(15, 100, 1000, 100);
    expect((await consume(key, "sara", 10, rid())).body.accepted).toBe(true);
    const res = await consume(key, "sara", 10, rid());
    expect(res.body.rejection).toMatchObject({ level: "account", rule: "monthly_allowance" });
    expect(res.body.user.remaining).toBe(990);
    expect(res.body.account.remaining).toBe(5);
  });

  it.each([0, -1, 2.5, "5", null])("rejects invalid units: %s", async (units) => {
    const { key } = await setup();
    const res = await consume(key, "sara", units, rid());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("requires a request id and a known user", async () => {
    const { key } = await setup();
    expect((await consume(key, "sara", 1, undefined)).status).toBe(400);
    expect((await consume(key, "nobody", 1, rid())).status).toBe(404);
  });
});

describe("retries", () => {
  it("counts a repeated request only once and returns the original answer", async () => {
    const { key } = await setup();
    const id = rid();
    const first = await consume(key, "sara", 10, id);
    const second = await consume(key, "sara", 10, id);
    expect(first.body.replayed).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.accepted).toBe(true);
    expect(await usageOf(key)).toEqual({ account: 10, users: 10 });
  });

  it("replays a rejection as a rejection", async () => {
    const { key } = await setup();
    const id = rid();
    await consume(key, "sara", 25, id);
    const second = await consume(key, "sara", 25, id);
    expect(second.body.accepted).toBe(false);
    expect(second.body.replayed).toBe(true);
  });

  it("returns 409 when the same id is reused with different details", async () => {
    const { key } = await setup();
    const id = rid();
    await consume(key, "sara", 10, id);
    const res = await consume(key, "sara", 11, id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("request_id_conflict");
  });

  it("treats the same id in different accounts independently", async () => {
    const a = await setup();
    const b = await setup();
    const r1 = await consume(a.key, "sara", 1, "shared-id");
    const r2 = await consume(b.key, "sara", 1, "shared-id");
    expect(r1.body.replayed).toBe(false);
    expect(r2.body.replayed).toBe(false);
  });
});

describe("simultaneous requests", () => {
  it("never lets parallel requests exceed the account limit", async () => {
    const { key } = await setup(20, 20, 1000, 100);
    const results = await Promise.all(
      Array.from({ length: 50 }, () => consume(key, "sara", 1, rid()))
    );
    const accepted = results.filter((r) => r.body.accepted).length;
    expect(accepted).toBe(20);
    expect(await usageOf(key)).toEqual({ account: 20, users: 20 });
  });

  it("counts parallel retries of one request id only once", async () => {
    const { key } = await setup();
    const id = rid();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consume(key, "sara", 5, id))
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => !r.body.replayed).length).toBe(1);
    expect(await usageOf(key)).toEqual({ account: 5, users: 5 });
  });
});

describe("plan changes", () => {
  it("applies edits immediately and never shows negative remaining", async () => {
    const { key, userPlan } = await setup();
    await consume(key, "sara", 10, rid());

    await patch(`/plans/${userPlan}`, key, { monthlyLimit: 5 });
    const user = await get("/users/sara", key);
    expect(user.body.user.usage.unitsUsed).toBe(10);
    expect(user.body.user.usage.remaining).toBe(0);

    const blocked = await consume(key, "sara", 1, rid());
    expect(blocked.body.rejection).toMatchObject({ level: "user", rule: "monthly_allowance" });

    await patch(`/plans/${userPlan}`, key, { monthlyLimit: 100 });
    expect((await consume(key, "sara", 1, rid())).body.accepted).toBe(true);
  });

  it("keeps used units when a user or the account switches plans", async () => {
    const { key } = await setup();
    await consume(key, "sara", 10, rid());

    const user = await put("/users/sara/plan", key, { planId: PLANS.premium });
    expect(user.body.user.usage.unitsUsed).toBe(10);
    expect(user.body.user.usage.remaining).toBe(4990);

    const account = await put("/account/plan", key, { planId: PLANS.pro });
    expect(account.body.account.usage.unitsUsed).toBe(10);
  });

  it("refuses to edit predefined plans", async () => {
    const { key } = await setup();
    const res = await patch(`/plans/${PLANS.pro}`, key, { monthlyLimit: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("plan_read_only");
  });

  it("does not rewrite past history when a plan changes", async () => {
    const { key, userPlan } = await setup();
    await consume(key, "sara", 10, "old-decision");
    await patch(`/plans/${userPlan}`, key, { monthlyLimit: 5 });

    const history = await get("/history", key);
    expect(history.body.items[0].requestId).toBe("old-decision");
    expect(history.body.items[0].accepted).toBe(true);
    expect(history.body.items[0].details.user.monthlyLimit).toBe(100);
  });
});

describe("usage and history", () => {
  it("lists history newest first with pagination and filters", async () => {
    const { key } = await setup();
    await consume(key, "sara", 1, "h-1");
    await consume(key, "sara", 1, "h-2");
    await consume(key, "sara", 25, "h-3"); // rejected: user max is 20

    const page1 = await get("/history?pageSize=2", key);
    expect(page1.body.total).toBe(3);
    expect(page1.body.items.map((i: { requestId: string }) => i.requestId)).toEqual(["h-3", "h-2"]);

    const page2 = await get("/history?pageSize=2&page=2", key);
    expect(page2.body.items.map((i: { requestId: string }) => i.requestId)).toEqual(["h-1"]);

    const rejected = await get("/history?accepted=false", key);
    expect(rejected.body.total).toBe(1);
    expect(rejected.body.items[0].rejection).toMatchObject({
      level: "user",
      rule: "max_units_per_request",
    });
  });

  it("makes the account total equal the sum of its users", async () => {
    const { key, userPlan } = await setup();
    await createUser(key, "omar", userPlan);
    await consume(key, "sara", 7, rid());
    await consume(key, "omar", 5, rid());

    const usage = await get("/usage", key);
    expect(usage.body.account.unitsUsed).toBe(12);
    expect(usage.body.usersUnitsTotal).toBe(12);
  });

  it("starts each UTC month at zero and keeps old months", async () => {
    const { id, key } = await setup(10, 10, 100, 20);
    const base = { accountId: id, externalId: "sara" };

    const jan = await consumeService({ ...base, units: 10, requestId: rid() }, new Date("2026-01-15T12:00:00Z"));
    const janAgain = await consumeService({ ...base, units: 1, requestId: rid() }, new Date("2026-01-31T23:59:59Z"));
    const feb = await consumeService({ ...base, units: 10, requestId: rid() }, new Date("2026-02-01T00:00:00Z"));

    expect(jan.accepted).toBe(true);
    expect(janAgain.accepted).toBe(false);
    expect(feb.accepted).toBe(true);
    expect(feb.month).toBe("2026-02-01");

    expect((await get("/usage?month=2026-01", key)).body.account.unitsUsed).toBe(10);
    expect((await get("/usage?month=2026-02", key)).body.account.unitsUsed).toBe(10);
  });
});

describe("plan validation", () => {
  it("rejects invalid limits and duplicate names", async () => {
    const { key } = await createAccount();
    for (const body of [
      { name: "a", monthlyLimit: 0, maxUnitsPerRequest: 1 },
      { name: "a", monthlyLimit: -5, maxUnitsPerRequest: 1 },
      { name: "a", monthlyLimit: 2.5, maxUnitsPerRequest: 1 },
      { name: "a", monthlyLimit: "100", maxUnitsPerRequest: 1 },
      { name: "a", monthlyLimit: 100 },
    ]) {
      expect((await post("/plans", key, body)).status).toBe(400);
    }

    await createPlan(key, "Student", 100, 10);
    expect((await post("/plans", key, { name: "student", monthlyLimit: 5, maxUnitsPerRequest: 1 })).status).toBe(409);
    expect((await post("/plans", key, { name: "Pro", monthlyLimit: 5, maxUnitsPerRequest: 1 })).status).toBe(409);
  });
});