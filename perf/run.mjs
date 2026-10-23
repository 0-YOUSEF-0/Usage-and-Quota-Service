// Load test for POST /consume.
// Usage: node perf/run.mjs <label>        e.g. node perf/run.mjs baseline
// Env:   API_URL, DURATION (seconds, default 15), CONNECTIONS (default 20)

import autocannon from "autocannon";
import { mkdir, writeFile } from "node:fs/promises";

const API_URL = process.env.API_URL ?? "http://localhost:3000";
const DURATION = Number(process.env.DURATION ?? 15);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 20);
const label = process.argv[2] ?? "run";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method, path, key, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(key ? { "X-API-Key": key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${JSON.stringify(data)}`);
  return data;
}

// Accounts get a huge plan, so every request is accepted and does real work.
async function createFixture(accountCount, usersPerAccount) {
  const accounts = [];
  for (let a = 0; a < accountCount; a++) {
    const created = await call("POST", "/accounts", undefined, { name: `perf-${Date.now()}-${a}` });
    const key = created.apiKey;
    const { plan } = await call("POST", "/plans", key, {
      name: "perf",
      monthlyLimit: 1_000_000_000_000,
      maxUnitsPerRequest: 1000,
    });
    await call("PUT", "/account/plan", key, { planId: plan.id });

    const users = [];
    for (let u = 0; u < usersPerAccount; u++) {
      await call("POST", "/users", key, { externalId: `user-${u}`, planId: plan.id });
      users.push(`user-${u}`);
    }
    accounts.push({ key, users });
  }
  return accounts;
}

async function runScenario(name, accountCount, usersPerAccount) {
  console.log(`\n== ${name}: ${accountCount} account(s) x ${usersPerAccount} users, ${CONNECTIONS} connections, ${DURATION}s ==`);
  const accounts = await createFixture(accountCount, usersPerAccount);

  const runId = Date.now().toString(36);
  let counter = 0;

  const result = await autocannon({
    url: API_URL,
    connections: CONNECTIONS,
    duration: DURATION,
    requests: [
      {
        method: "POST",
        path: "/consume",
        setupRequest(req) {
          const account = accounts[counter % accounts.length];
          const user = account.users[Math.floor(counter / accounts.length) % account.users.length];
          counter++;
          req.headers = { "content-type": "application/json", "x-api-key": account.key };
          req.body = JSON.stringify({ externalId: user, units: 1, requestId: `${runId}-${counter}` });
          return req;
        },
      },
    ],
  });

  await sleep(2000); // let requests that were still running finish

  // Correctness check: every request used 1 unit, so for each account
  // account usage == sum of user usage == number of accepted history rows.
  let correct = true;
  let acceptedTotal = 0;
  for (const account of accounts) {
    const usage = await call("GET", "/usage?pageSize=1", account.key);
    const accepted = await call("GET", "/history?accepted=true&pageSize=1", account.key);
    acceptedTotal += accepted.total;
    if (usage.account.unitsUsed !== usage.usersUnitsTotal || usage.account.unitsUsed !== accepted.total) {
      correct = false;
    }
  }

  const row = {
    scenario: name,
    reqPerSec: Math.round(result.requests.average),
    avgLatencyMs: result.latency.average,
    p99LatencyMs: result.latency.p99,
    ok2xx: result["2xx"],
    non2xx: result.non2xx,
    errors: result.errors,
    acceptedInDb: acceptedTotal,
    countsCorrect: correct,
  };
  console.table([row]);
  return row;
}

const rows = [
  await runScenario("many-accounts", 10, 5),
  await runScenario("single-account", 1, 50),
];

await mkdir("perf/results", { recursive: true });
const table = [
  `# Results: ${label}`,
  "",
  `Connections: ${CONNECTIONS}, duration: ${DURATION}s per scenario, date: ${new Date().toISOString()}`,
  "",
  "| Scenario | Req/sec | Avg latency (ms) | p99 latency (ms) | Non-2xx | Errors | Counts correct |",
  "|---|---|---|---|---|---|---|",
  ...rows.map(
    (r) =>
      `| ${r.scenario} | ${r.reqPerSec} | ${r.avgLatencyMs} | ${r.p99LatencyMs} | ${r.non2xx} | ${r.errors} | ${r.countsCorrect ? "yes" : "NO"} |`
  ),
  "",
].join("\n");
await writeFile(`perf/results/${label}.md`, table);
console.log(`\nSaved perf/results/${label}.md`);

process.exit(rows.every((r) => r.countsCorrect && r.non2xx === 0) ? 0 : 1);