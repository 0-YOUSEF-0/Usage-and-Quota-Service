// demo client  pretends to be the document-processing application
  //  it talks to the metering service ONLY through its HTTP API

const API_URL = process.env.API_URL ?? "http://localhost:3000";

const runId = Date.now().toString(36);
let sequence = 0;
let failures = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const newRequestId = () => `demo-${runId}-${++sequence}`;

async function call(method, path, { key, body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(key ? { "X-API-Key": key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${data.error?.code}: ${data.error?.message}`);
  }
  return data;
}

async function waitForService() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${API_URL}/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  throw new Error(`The service is not reachable at ${API_URL}`);
}

function section(title) {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

function check(description, condition) {
  console.log(`   [${condition ? "PASS" : "FAIL"}] ${description}`);
  if (!condition) failures++;
}

function allowanceLine(label, name, view) {
  console.log(
    `     ${label.padEnd(8)} ${String(name).padEnd(8)} used ${String(view.unitsUsed).padStart(5)}` +
      ` of ${String(view.monthlyLimit).padEnd(6)} remaining ${String(view.remaining).padEnd(6)} (plan: ${view.planName})`
  );
}

// The ONLY business action of this client: ask the service for permission.
async function processDocument(key, userId, units, requestId = newRequestId()) {
  const d = await call("POST", "/consume", { key, body: { externalId: userId, units, requestId } });

  console.log(
    `\n   ${userId} wants to process a document costing ${units} units -> ` +
      `${d.accepted ? "ACCEPTED" : "REJECTED"}${d.replayed ? " (same request ID: original answer, nothing counted again)" : ""}`
  );
  if (d.rejection) {
    console.log(`     blocked by the ${d.rejection.level.toUpperCase()} rule "${d.rejection.rule}"`);
    console.log(`     ${d.rejection.message}`);
  }
  allowanceLine("user", userId, d.user);
  allowanceLine("account", "company", d.account);
  return d;
}

async function main() {
  await waitForService();

  // ---------- 1. Setup ----------
  section("1. SETUP: one company, two users on different plans");
  const created = await call("POST", "/accounts", { body: { name: `Acme Corp ${runId}` } });
  const key = created.apiKey;
  console.log(`   Account created. API key (shown once): ${key.slice(0, 10)}...`);

  const { plans } = await call("GET", "/plans", { key });
  const planId = (name) => plans.find((plan) => plan.name === name).id;

  // A small shared pool, so the demo reaches the account limit quickly.
  const { plan: team } = await call("POST", "/plans", {
    key,
    body: { name: "Demo Team", monthlyLimit: 100, maxUnitsPerRequest: 50 },
  });
  await call("PUT", "/account/plan", { key, body: { planId: team.id } });
  await call("POST", "/users", { key, body: { externalId: "sara", name: "Sara", planId: planId("Basic") } });
  await call("POST", "/users", { key, body: { externalId: "omar", name: "Omar", planId: planId("Premium") } });

  const { users } = await call("GET", "/users", { key });
  console.log(`   Company plan: Demo Team (100 units/month shared, max 50 per request)`);
  for (const u of users) {
    console.log(`   User ${u.externalId.padEnd(5)} plan ${u.plan.name.padEnd(8)} (${u.plan.monthlyLimit}/month, max ${u.plan.maxUnitsPerRequest} per request)`);
  }

  // ---------- 2. Accepted ----------
  section("2. AN ACCEPTED ACTION");
  const accepted = await processDocument(key, "sara", 10);
  check("Sara's request of 10 units is accepted", accepted.accepted === true);

  // ---------- 3. User limit ----------
  section("3. A REJECTION CAUSED BY A USER LIMIT");
  const userBlocked = await processDocument(key, "sara", 25);
  check("Sara (Basic, max 20 per request) is blocked by the USER rule", userBlocked.rejection?.level === "user");
  check("Nothing was counted for the rejected request", userBlocked.user.unitsUsed === 10);

  // ---------- 4. Account limit ----------
  section("4. A REJECTION CAUSED BY THE SHARED ACCOUNT LIMIT");
  await processDocument(key, "omar", 50);
  const accountBlocked = await processDocument(key, "omar", 45);
  check("Omar still has thousands of units, but the company pool is nearly empty", accountBlocked.user.remaining > 1000);
  check("Omar is blocked by the ACCOUNT rule", accountBlocked.rejection?.level === "account");

  // ---------- 5. Plan change ----------
  section("5. CHANGE PLANS: same client code, different result");

  console.log("\n   The company moves from Demo Team to the Pro plan (no client change, no restart):");
  await call("PUT", "/account/plan", { key, body: { planId: planId("Pro") } });
  const nowAccepted = await processDocument(key, "omar", 45);
  check("The same request that was blocked is now ACCEPTED", nowAccepted.accepted === true);

  console.log("\n   Sara is upgraded from Basic to Premium:");
  await call("PUT", "/users/sara/plan", { key, body: { planId: planId("Premium") } });
  const saraNow = await processDocument(key, "sara", 25);
  check("Sara's 25-unit request, rejected before, is now ACCEPTED", saraNow.accepted === true);
  check("Her earlier usage was kept (10 + 25 = 35)", saraNow.user.unitsUsed === 35);

  // ---------- 6. Retry ----------
  section("6. SAFE RETRIES: the same request sent twice");
  const retryId = newRequestId();
  const first = await processDocument(key, "sara", 5, retryId);
  const second = await processDocument(key, "sara", 5, retryId);
  check("The retry returns the original answer", second.replayed === true && second.accepted === first.accepted);
  check("The units were counted only once", second.user.unitsUsed === first.user.unitsUsed);

  // ---------- 7. History ----------
  section("7. HISTORY (newest first)");
  const history = await call("GET", "/history?pageSize=10", { key });
  for (const item of history.items) {
    const outcome = item.accepted
      ? "accepted"
      : `rejected by ${item.rejection.level} (${item.rejection.rule})`;
    console.log(`   #${item.id}  ${item.externalId.padEnd(5)} ${String(item.units).padStart(3)} units  ${outcome}`);
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nDemo failed:", error.message);
  process.exit(1);
});