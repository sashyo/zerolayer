#!/usr/bin/env npx tsx
/**
 * ZeroLayer Init Script
 * Run once to set up everything: config, npm deps, TideCloak realm, and the database.
 *
 *   npx tsx scripts/init.ts
 *
 * What it does:
 *   1. Prompt for configuration
 *   2. Write .env
 *   3. npm install
 *   4. Start Docker (postgres + tidecloak)
 *   5. TideCloak realm setup — canonical flow:
 *        a. Import realm from template
 *        b. setUpTideRealm (VRK generation + license)
 *        c. Enable IGA
 *        d. Approve + commit client change requests
 *        e. Create E2EE voucher-gate roles and assign to default composite
 *        f. Approve + commit role change requests
 *        g. Create realm admin user
 *        h. Approve + commit user change requests
 *        i. Assign tide-realm-admin (client role on realm-management)
 *        j. Generate Tide account invite link (interactive — open in browser)
 *        k. Poll until admin links Tide account
 *        l. Approve + commit user change requests again
 *        m. Update CustomAdminUIDomain + sign IdP settings
 *        n. Export adapter.json → public/adapter.json
 *   6. PostgreSQL: prisma db push
 *   7. Print launch instructions
 */

import { createInterface } from "readline/promises";
import { stdin, stdout, exit } from "process";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const REALM_TEMPLATE = resolve(__dirname, "realm.json.template");

// ── ANSI colours ─────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m",
};

const ok   = (msg: string) => console.log(`${c.green}  ✓${c.reset}  ${msg}`);
const skip = (msg: string) => console.log(`${c.dim}  –  ${msg}${c.reset}`);
const warn = (msg: string) => console.log(`${c.yellow}  ⚠${c.reset}  ${msg}`);
const fail = (msg: string) => console.error(`${c.red}  ✗  ${msg}${c.reset}`);
const step = (n: number, msg: string) =>
  console.log(`\n${c.bgBlue}${c.bold} ${n} ${c.reset} ${c.bold}${msg}${c.reset}`);
const info = (msg: string) => console.log(`${c.dim}     ${msg}${c.reset}`);

// ── Shell helpers ─────────────────────────────────────────────────────────────

function run(cmd: string, opts: { cwd?: string; silent?: boolean } = {}) {
  const result = spawnSync(cmd, {
    shell: true,
    cwd: opts.cwd ?? ROOT,
    stdio: opts.silent ? "pipe" : "inherit",
    encoding: "utf-8",
  });
  if (result.status !== 0) throw new Error(`Command failed: ${cmd}`);
  return result.stdout ?? "";
}

function loadExistingEnv(): Record<string, string> {
  const envPath = resolve(ROOT, ".env");
  if (!existsSync(envPath)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

// ── TideCloak Admin API ───────────────────────────────────────────────────────

class TideCloakAdmin {
  private token: string = "";

  constructor(
    private baseUrl: string,
    private adminUser: string,
    private adminPass: string,
  ) {}

  async refreshToken() {
    const res = await fetch(
      `${this.baseUrl}/realms/master/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "password",
          client_id: "admin-cli",
          username: this.adminUser,
          password: this.adminPass,
        }),
      },
    );
    if (!res.ok)
      throw new Error(`Auth failed (${res.status}): wrong admin credentials?`);
    this.token = (await res.json()).access_token;
  }

  // Alias for first call
  async authenticate() {
    await this.refreshToken();
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  private async json(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch { /* keep as string */ }
    return { status: res.status, data };
  }

  private async form(
    method: string,
    path: string,
    params: Record<string, string>,
  ): Promise<{ status: number; data: unknown }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch { /* keep as string */ }
    return { status: res.status, data };
  }

  // ── Realm bootstrap ──────────────────────────────────────────────────────

  async checkRealmExists(realm: string): Promise<boolean> {
    await this.refreshToken();
    const { status } = await this.json("GET", `/admin/realms/${realm}`);
    return status === 200;
  }

  async importRealm(realm: string, clientName: string, appUrl: string) {
    if (!existsSync(REALM_TEMPLATE)) {
      throw new Error(
        `Realm template not found: ${REALM_TEMPLATE}\n` +
        "Ensure scripts/realm.json.template is present.",
      );
    }
    const body = readFileSync(REALM_TEMPLATE, "utf-8")
      .replaceAll("REALM_NAME", realm)
      .replaceAll("CLIENT_NAME", clientName)
      .replaceAll("CLIENT_APP_URL", appUrl.replace(/\/$/, ""));

    await this.refreshToken();
    const res = await fetch(`${this.baseUrl}/admin/realms`, {
      method: "POST",
      headers: this.headers,
      body,
    });
    if (res.status === 201) ok(`Realm '${realm}' imported from template`);
    else if (res.status === 409) skip(`Realm '${realm}' already exists`);
    else throw new Error(`importRealm → ${res.status}: ${await res.text()}`);
  }

  async setUpTideRealm(realm: string, email: string) {
    await this.refreshToken();
    const { status, data } = await this.form(
      "POST",
      `/admin/realms/${realm}/vendorResources/setUpTideRealm`,
      { email, isRagnarokEnabled: "true" },
    );
    if (status === 200 || status === 204) ok("Tide realm initialized (VRK generated)");
    else throw new Error(`setUpTideRealm → ${status}: ${JSON.stringify(data)}`);
  }

  async enableIGA(realm: string) {
    await this.refreshToken();
    const { status, data } = await this.form(
      "POST",
      `/admin/realms/${realm}/tide-admin/toggle-iga`,
      { isIGAEnabled: "true" },
    );
    if (status === 200 || status === 204) ok("IGA enabled");
    else throw new Error(`toggle-iga → ${status}: ${JSON.stringify(data)}`);
  }

  // ── Change request approval ──────────────────────────────────────────────

  async approveAndCommit(realm: string, type: string) {
    await this.refreshToken();
    const { status, data } = await this.json(
      "GET",
      `/admin/realms/${realm}/tide-admin/change-set/${type}/requests`,
    );
    if (status !== 200) {
      warn(`Could not fetch ${type} change requests (${status})`);
      return;
    }
    const requests = data as Array<{
      draftRecordId: string;
      changeSetType: string;
      actionType: string;
    }>;
    if (!Array.isArray(requests) || requests.length === 0) {
      skip(`No pending ${type} change requests`);
      return;
    }
    info(`Approving ${requests.length} ${type} change request(s)…`);
    for (const req of requests) {
      const payload = {
        changeSetId: req.draftRecordId,
        changeSetType: req.changeSetType,
        actionType: req.actionType,
      };
      await this.refreshToken();
      await fetch(`${this.baseUrl}/admin/realms/${realm}/tide-admin/change-set/sign`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(payload),
      });
      await this.refreshToken();
      await fetch(`${this.baseUrl}/admin/realms/${realm}/tide-admin/change-set/commit`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(payload),
      });
    }
    ok(`${type} change requests approved`);
  }

  // ── Roles ────────────────────────────────────────────────────────────────

  async createRole(realm: string, name: string, description: string) {
    await this.refreshToken();
    const { status } = await this.json("POST", `/admin/realms/${realm}/roles`, {
      name,
      description,
    });
    if (status === 201) ok(`Role '${name}' created`);
    else if (status === 409) skip(`Role '${name}' already exists`);
    else throw new Error(`createRole '${name}' → ${status}`);
  }

  async getRoleByName(
    realm: string,
    name: string,
  ): Promise<{ id: string; name: string } | null> {
    await this.refreshToken();
    const { status, data } = await this.json(
      "GET",
      `/admin/realms/${realm}/roles/${encodeURIComponent(name)}`,
    );
    if (status === 404) return null;
    if (status === 200) return data as { id: string; name: string };
    throw new Error(`getRoleByName '${name}' → ${status}`);
  }

  async addRolesToComposite(
    realm: string,
    compositeRoleId: string,
    roles: Array<{ id: string; name: string }>,
  ) {
    await this.refreshToken();
    const { status } = await this.json(
      "POST",
      `/admin/realms/${realm}/roles-by-id/${compositeRoleId}/composites`,
      roles,
    );
    if (status === 204 || status === 200)
      ok("Voucher-gate roles added to default composite");
    else throw new Error(`addRolesToComposite → ${status}`);
  }

  // ── Users ────────────────────────────────────────────────────────────────

  async createUser(realm: string, username: string, email: string) {
    await this.refreshToken();
    const { status } = await this.json("POST", `/admin/realms/${realm}/users`, {
      username,
      email,
      enabled: true,
    });
    if (status === 201) ok(`User '${username}' created in realm`);
    else if (status === 409) skip(`User '${username}' already exists`);
    else throw new Error(`createUser → ${status}`);
  }

  async getUserId(realm: string, username: string): Promise<string | null> {
    await this.refreshToken();
    const { status, data } = await this.json(
      "GET",
      `/admin/realms/${realm}/users?username=${encodeURIComponent(username)}`,
    );
    if (status !== 200) return null;
    const users = data as Array<{ id: string }>;
    return users[0]?.id ?? null;
  }

  async getUserTideKey(realm: string, username: string): Promise<string | null> {
    await this.refreshToken();
    const { status, data } = await this.json(
      "GET",
      `/admin/realms/${realm}/users?username=${encodeURIComponent(username)}`,
    );
    if (status !== 200) return null;
    const users = data as Array<{
      attributes?: { tideUserKey?: string[] };
    }>;
    return users[0]?.attributes?.tideUserKey?.[0] ?? null;
  }

  // ── Client roles ─────────────────────────────────────────────────────────

  async getClientUUID(realm: string, clientId: string): Promise<string | null> {
    await this.refreshToken();
    const { status, data } = await this.json(
      "GET",
      `/admin/realms/${realm}/clients?clientId=${encodeURIComponent(clientId)}`,
    );
    if (status !== 200) return null;
    return (data as Array<{ id: string }>)[0]?.id ?? null;
  }

  async getClientRole(
    realm: string,
    clientUUID: string,
    roleName: string,
  ): Promise<{ id: string; name: string } | null> {
    await this.refreshToken();
    const { status, data } = await this.json(
      "GET",
      `/admin/realms/${realm}/clients/${clientUUID}/roles/${encodeURIComponent(roleName)}`,
    );
    if (status === 404) return null;
    if (status !== 200)
      throw new Error(
        `getClientRole '${roleName}' → ${status}: ${JSON.stringify(data)}`,
      );
    const role = data as { error?: string; id: string; name: string };
    if (role.error) throw new Error(`tide-realm-admin role not found: ${role.error}`);
    return role;
  }

  async assignClientRole(
    realm: string,
    userId: string,
    clientUUID: string,
    role: { id: string; name: string },
  ) {
    await this.refreshToken();
    const { status } = await this.json(
      "POST",
      `/admin/realms/${realm}/users/${userId}/role-mappings/clients/${clientUUID}`,
      [role],
    );
    if (status === 204 || status === 200) ok("tide-realm-admin assigned to admin user");
    else throw new Error(`assignClientRole → ${status}`);
  }

  // ── Invite link ──────────────────────────────────────────────────────────

  async generateInviteLink(realm: string, userId: string): Promise<string> {
    await this.refreshToken();
    const res = await fetch(
      `${this.baseUrl}/admin/realms/${realm}/tideAdminResources/get-required-action-link` +
        `?userId=${userId}&lifespan=43200`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(["link-tide-account-action"]),
      },
    );
    if (!res.ok)
      throw new Error(`generateInviteLink → ${res.status}: ${await res.text()}`);
    const text = await res.text();
    return text.replace(/^"|"$/g, ""); // strip JSON-encoded quotes if present
  }

  // ── IdP + adapter ────────────────────────────────────────────────────────

  async updateCustomAdminUIDomain(realm: string, appUrl: string) {
    await this.refreshToken();
    const { status: getStatus, data: idpData } = await this.json(
      "GET",
      `/admin/realms/${realm}/identity-provider/instances/tide`,
    );
    if (getStatus !== 200)
      throw new Error(`Could not GET tide IdP (${getStatus})`);

    const idp = idpData as Record<string, unknown>;
    (idp.config as Record<string, unknown>).CustomAdminUIDomain =
      appUrl.replace(/\/$/, "");

    await this.refreshToken();
    const { status: putStatus } = await this.json(
      "PUT",
      `/admin/realms/${realm}/identity-provider/instances/tide`,
      idp,
    );
    if (putStatus !== 204 && putStatus !== 200)
      throw new Error(`PUT tide IdP → ${putStatus}`);

    await this.refreshToken();
    const { status: signStatus } = await this.json(
      "POST",
      `/admin/realms/${realm}/vendorResources/sign-idp-settings`,
    );
    if (signStatus !== 200 && signStatus !== 204)
      throw new Error(`sign-idp-settings → ${signStatus}`);

    ok("CustomAdminUIDomain updated and IdP settings signed");
  }

  async exportAdapterJson(
    realm: string,
    clientName: string,
    outputPath: string,
  ) {
    const clientUUID = await this.getClientUUID(realm, clientName);
    if (!clientUUID) throw new Error(`Client '${clientName}' not found`);

    await this.refreshToken();
    const res = await fetch(
      `${this.baseUrl}/admin/realms/${realm}/vendorResources/get-installations-provider` +
        `?clientId=${clientUUID}&providerId=keycloak-oidc-keycloak-json`,
      { headers: { Authorization: `Bearer ${this.token}` } },
    );
    if (!res.ok)
      throw new Error(`get-installations-provider → ${res.status}`);

    const adapterJson = await res.text();
    writeFileSync(outputPath, adapterJson);
    ok(`Adapter JSON saved → ${outputPath}`);

    try {
      const parsed = JSON.parse(adapterJson);
      if (!parsed.jwk) warn("adapter.json missing 'jwk' — IGA may not be fully on");
      if (!parsed.vendorId) warn("adapter.json missing 'vendorId' — Tide realm setup incomplete");
    } catch {
      warn("Could not parse exported adapter JSON");
    }
  }
}

// ── Docker helpers ────────────────────────────────────────────────────────────

function dockerAvailable(): boolean {
  return spawnSync("docker", ["info"], { stdio: "pipe" }).status === 0;
}

function containerRunning(name: string): boolean {
  const r = spawnSync(
    "docker",
    ["inspect", "--format", "{{.State.Running}}", name],
    { stdio: "pipe", encoding: "utf-8" },
  );
  return r.status === 0 && r.stdout.trim() === "true";
}

function ensureDockerUp() {
  if (!dockerAvailable()) {
    warn("Docker not found — skipping container startup.");
    warn("Install Docker and re-run, or start TideCloak/PostgreSQL manually.");
    return false;
  }
  if (containerRunning("zerolayer-tidecloak") && containerRunning("zerolayer-postgres")) {
    skip("Docker containers already running");
    return true;
  }
  info("Starting containers (first run pulls images — may take ~60 s)…");
  const r = spawnSync("docker", ["compose", "up", "-d", "--wait"], {
    cwd: ROOT,
    stdio: "inherit",
    encoding: "utf-8",
  });
  if (r.status !== 0) {
    fail("docker compose up failed — check that Docker is running and ports 8080/5432 are free.");
    return false;
  }
  ok("Containers started");
  return true;
}

async function waitForTideCloak(
  url: string,
  timeoutMs = 120_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`     Waiting for TideCloak at ${url} `);
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/realms/master`, {
        signal: AbortSignal.timeout(4_000),
      });
      if (res.ok || res.status < 500) {
        console.log(` ${c.green}ready${c.reset}`);
        return true;
      }
    } catch { /* still starting */ }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 3_000));
  }
  console.log(` ${c.red}timed out${c.reset}`);
  return false;
}

// ── Docker credential detection ───────────────────────────────────────────────

function detectDockerCreds(): {
  dbUrl: string;
  tcAdminUser: string;
  tcAdminPass: string;
} | null {
  try {
    const pgOut =
      spawnSync("docker", ["ps", "--format", "{{.Names}}"], {
        encoding: "utf-8",
        stdio: "pipe",
      }).stdout ?? "";
    const all = pgOut.split("\n").filter(Boolean);
    const containers = [
      ...all.filter((n) => n.startsWith("zerolayer-")),
      ...all.filter((n) => !n.startsWith("zerolayer-")),
    ];

    let dbUrl: string | null = null;
    let tcAdminUser = "admin";
    let tcAdminPass: string | null = null;

    for (const name of containers) {
      const envOut =
        spawnSync(
          "docker",
          ["inspect", name, "--format", "{{range .Config.Env}}{{println .}}{{end}}"],
          { encoding: "utf-8", stdio: "pipe" },
        ).stdout ?? "";
      const env: Record<string, string> = {};
      for (const line of envOut.split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
      }
      if (env.POSTGRES_USER && env.POSTGRES_PASSWORD)
        dbUrl = `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@localhost:5432/zerolayer_db`;
      if (env.KC_BOOTSTRAP_ADMIN_USERNAME)
        tcAdminUser = env.KC_BOOTSTRAP_ADMIN_USERNAME;
      if (env.KC_BOOTSTRAP_ADMIN_PASSWORD)
        tcAdminPass = env.KC_BOOTSTRAP_ADMIN_PASSWORD;
    }
    if (dbUrl && tcAdminPass) return { dbUrl, tcAdminUser, tcAdminPass };
  } catch { /* docker not available */ }
  return null;
}

// ── .env writer ───────────────────────────────────────────────────────────────

function writeEnv(cfg: Record<string, string>) {
  writeFileSync(
    resolve(ROOT, ".env"),
    [
      "# Generated by scripts/init.ts — edit as needed",
      "",
      `PORT=${cfg.PORT}`,
      `NEXT_PUBLIC_APP_URL=${cfg.APP_URL}`,
      `NODE_ENV=development`,
      "",
      `DATABASE_URL="${cfg.DATABASE_URL}"`,
      "",
      `TIDECLOAK_URL=${cfg.TIDECLOAK_URL}`,
      `TIDECLOAK_REALM=${cfg.REALM}`,
      `TIDECLOAK_CLIENT_ID=${cfg.CLIENT_ID}`,
      `TIDECLOAK_ADMIN_USER=${cfg.ADMIN_USER}`,
      `TIDECLOAK_ADMIN_PASSWORD=${cfg.ADMIN_PASS}`,
      "",
      `NEXT_PUBLIC_TIDECLOAK_URL=${cfg.TIDECLOAK_URL}`,
      `NEXT_PUBLIC_TIDECLOAK_REALM=${cfg.REALM}`,
      `NEXT_PUBLIC_TIDECLOAK_CLIENT_ID=${cfg.CLIENT_ID}`,
      "",
      `UPLOAD_DIR=./public/uploads`,
      `NEXT_PUBLIC_UPLOAD_BASE_URL=${cfg.APP_URL}/uploads`,
      `MAX_FILE_SIZE=10485760`,
      "",
      `RATE_LIMIT_MESSAGES_PER_MINUTE=30`,
      `RATE_LIMIT_WINDOW_MS=60000`,
    ].join("\n") + "\n",
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.clear();
  console.log(`\n${c.bgBlue}${c.bold}                                          ${c.reset}`);
  console.log(`${c.bgBlue}${c.bold}   ⚡ ZeroLayer — One-command setup script  ${c.reset}`);
  console.log(`${c.bgBlue}${c.bold}                                          ${c.reset}\n`);

  const rl = createInterface({ input: stdin, output: stdout });
  const existing = loadExistingEnv();
  const dockerCreds = detectDockerCreds();

  const ask = async (question: string, def?: string) => {
    const prompt = def
      ? `${c.cyan}  ?${c.reset}  ${question} ${c.dim}[${def}]${c.reset}: `
      : `${c.cyan}  ?${c.reset}  ${question}: `;
    const ans = (await rl.question(prompt)).trim();
    return ans || def || "";
  };

  const askSecret = async (question: string, def?: string) => {
    const prompt = def
      ? `${c.cyan}  ?${c.reset}  ${question} ${c.dim}[***]${c.reset}: `
      : `${c.cyan}  ?${c.reset}  ${question}: `;
    const ans = (await rl.question(prompt)).trim();
    return ans || def || "";
  };

  // ── Step 1: Configuration ─────────────────────────────────────────────────
  step(1, "Configuration");
  console.log(`${c.dim}  Press Enter to accept defaults shown in brackets.${c.reset}\n`);
  if (dockerCreds) info("Detected Docker containers — pre-filling credentials");

  const tideCloakUrl = await ask(
    "TideCloak URL",
    existing.TIDECLOAK_URL || "http://localhost:8080",
  );
  const realm = await ask("Realm name", existing.TIDECLOAK_REALM || "zerolayer");
  const clientId = await ask("OIDC client ID", existing.TIDECLOAK_CLIENT_ID || "zerolayer-app");
  const appUrl = await ask("App URL", existing.NEXT_PUBLIC_APP_URL || "http://localhost:3000");
  const port = new URL(appUrl).port || "3000";
  const adminUser = await ask(
    "TideCloak master admin username",
    existing.TIDECLOAK_ADMIN_USER || dockerCreds?.tcAdminUser || "admin",
  );
  const adminPass = await askSecret(
    "TideCloak master admin password",
    existing.TIDECLOAK_ADMIN_PASSWORD || dockerCreds?.tcAdminPass || "",
  );
  const adminEmail = await ask(
    "Realm admin email (used for Tide account linking)",
    "admin@zerolayer.local",
  );
  const dbUrl = await ask(
    "PostgreSQL DATABASE_URL",
    existing.DATABASE_URL ||
      dockerCreds?.dbUrl ||
      "postgresql://zerolayer:zerolayer_secret@localhost:5432/zerolayer_db",
  );

  rl.close();

  // ── Step 2: Write .env ────────────────────────────────────────────────────
  step(2, "Writing .env");
  writeEnv({
    PORT: port,
    APP_URL: appUrl,
    TIDECLOAK_URL: tideCloakUrl.replace(/\/$/, ""),
    REALM: realm,
    CLIENT_ID: clientId,
    ADMIN_USER: adminUser,
    ADMIN_PASS: adminPass,
    DATABASE_URL: dbUrl,
  });
  ok(".env written");

  // ── Step 3: npm install ───────────────────────────────────────────────────
  step(3, "Installing dependencies");
  try {
    run("npm install");
    ok("npm install complete");
  } catch {
    fail("npm install failed — check Node.js version (need 20+)");
    exit(1);
  }

  // ── Step 4: Docker ────────────────────────────────────────────────────────
  step(4, "Starting Docker services");
  ensureDockerUp();

  const tc = tideCloakUrl.replace(/\/$/, "");
  const reachable = await waitForTideCloak(tc);
  if (!reachable) {
    warn("TideCloak did not become reachable in time. Skipping realm setup.");
    warn("Fix the Docker issue, then re-run: npm run init");
    console.log();
  } else {
    // ── Step 5: TideCloak realm setup ─────────────────────────────────────
    step(5, "Configuring TideCloak realm");

    const admin = new TideCloakAdmin(tc, adminUser, adminPass);

    try {
      await admin.authenticate();
      ok("Master admin token obtained");

      const realmExists = await admin.checkRealmExists(realm);

      if (realmExists) {
        skip(`Realm '${realm}' already exists — skipping import and initial setup`);
        info("Exporting adapter.json from existing realm…");
        await admin.exportAdapterJson(
          realm,
          clientId,
          resolve(ROOT, "public", "adapter.json"),
        );
      } else {
        // 5a. Import realm from template
        info("Importing realm from template…");
        await admin.importRealm(realm, clientId, appUrl);

        // 5b. Initialize Tide realm (form-urlencoded — NOT JSON)
        info("Calling setUpTideRealm…");
        await admin.setUpTideRealm(realm, adminEmail);

        // 5c. Enable IGA
        info("Enabling IGA…");
        await admin.enableIGA(realm);

        // 5d. Approve client change requests
        info("Approving client change requests…");
        await admin.approveAndCommit(realm, "clients");

        // 5e. Create E2EE voucher-gate roles (tag = "x" as used in the app)
        info("Creating E2EE voucher-gate roles…");
        await admin.createRole(
          realm,
          "_tide_x.selfencrypt",
          "Voucher gate: enables vendorsign (encrypt) for tag x",
        );
        await admin.createRole(
          realm,
          "_tide_x.selfdecrypt",
          "Voucher gate: enables vendordecrypt (decrypt) for tag x",
        );

        // Add both to default-roles-<realm> composite
        const compositeRole = await admin.getRoleByName(
          realm,
          `default-roles-${realm}`,
        );
        if (compositeRole) {
          const enc = await admin.getRoleByName(realm, "_tide_x.selfencrypt");
          const dec = await admin.getRoleByName(realm, "_tide_x.selfdecrypt");
          const toAdd = [enc, dec].filter(
            (r): r is { id: string; name: string } => r !== null,
          );
          if (toAdd.length > 0)
            await admin.addRolesToComposite(realm, compositeRole.id, toAdd);
        } else {
          warn(`default-roles-${realm} not found — add voucher roles to default composite manually`);
        }

        // 5f. Approve role change requests
        info("Approving role change requests…");
        await admin.approveAndCommit(realm, "roles");

        // 5g. Create realm admin user
        info(`Creating realm admin user 'admin'…`);
        await admin.createUser(realm, "admin", adminEmail);

        // Small delay to let IGA process the user creation
        await new Promise((r) => setTimeout(r, 2_000));

        // 5h. Approve user change requests
        info("Approving user change requests…");
        await admin.approveAndCommit(realm, "users");

        // 5i. Assign tide-realm-admin (CLIENT role on realm-management)
        info("Assigning tide-realm-admin client role…");
        const userId = await admin.getUserId(realm, "admin");
        if (!userId) {
          throw new Error(
            "Could not find admin user after approval. " +
            "Was the user change request committed?",
          );
        }
        const rmClientUUID = await admin.getClientUUID(realm, "realm-management");
        if (!rmClientUUID)
          throw new Error("realm-management client not found in realm");

        const tideRealmAdminRole = await admin.getClientRole(
          realm,
          rmClientUUID,
          "tide-realm-admin",
        );
        if (!tideRealmAdminRole)
          throw new Error("tide-realm-admin role not found on realm-management client");

        await admin.assignClientRole(realm, userId, rmClientUUID, tideRealmAdminRole);

        // 5j. Generate invite link (interactive browser step)
        info("Generating Tide account invite link…");
        const inviteLink = await admin.generateInviteLink(realm, userId);

        console.log(`\n${c.bold}${c.yellow}╔════════════════════════════════════════════════════════╗${c.reset}`);
        console.log(`${c.bold}${c.yellow}║  ACTION REQUIRED — open this link in your browser:     ║${c.reset}`);
        console.log(`${c.bold}${c.yellow}╚════════════════════════════════════════════════════════╝${c.reset}`);
        console.log(`\n  ${c.cyan}${inviteLink}${c.reset}\n`);
        console.log(`${c.dim}  Complete the Tide account linking flow in the browser.${c.reset}`);
        console.log(`${c.dim}  The script will continue automatically when done.${c.reset}\n`);

        // 5k. Poll until tideUserKey attribute appears
        process.stdout.write("     Waiting for account linking ");
        let linked = false;
        const deadline = Date.now() + 10 * 60 * 1_000; // 10-minute timeout
        while (Date.now() < deadline) {
          const key = await admin.getUserTideKey(realm, "admin");
          if (key) {
            linked = true;
            console.log(` ${c.green}linked!${c.reset}`);
            break;
          }
          process.stdout.write(".");
          await new Promise((r) => setTimeout(r, 5_000));
        }
        if (!linked) {
          console.log(` ${c.yellow}timed out${c.reset}`);
          warn("Tide account not linked within 10 minutes.");
          warn("Complete linking manually, then re-run: npm run init");
          exit(0);
        }

        // 5l. Approve user change requests (post-linking)
        info("Approving post-link user change requests…");
        await admin.approveAndCommit(realm, "users");

        // 5m. Update CustomAdminUIDomain + sign IdP settings
        info("Updating CustomAdminUIDomain…");
        await admin.updateCustomAdminUIDomain(realm, appUrl);

        // 5n. Export adapter.json → public/adapter.json
        info("Exporting adapter.json…");
        await admin.exportAdapterJson(
          realm,
          clientId,
          resolve(ROOT, "public", "adapter.json"),
        );

        ok("TideCloak realm fully configured");
      }
    } catch (err: unknown) {
      fail(`TideCloak setup failed: ${err instanceof Error ? err.message : String(err)}`);
      warn("Fix the error above and re-run: npm run init");
    }
  }

  // ── Step 6: Database ──────────────────────────────────────────────────────
  step(6, "Setting up database");
  info(`DATABASE_URL: ${dbUrl.replace(/:([^:@]+)@/, ":***@")}`);
  try {
    run("npx prisma db push");
    ok("Database schema applied");
  } catch {
    fail("Prisma db push failed.");
    warn("Ensure PostgreSQL is running and DATABASE_URL is correct.");
    warn("Re-run manually: npm run db:push");
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log(`\n${c.bgGreen}${c.bold}                               ${c.reset}`);
  console.log(`${c.bgGreen}${c.bold}   ✓  ZeroLayer setup complete!  ${c.reset}`);
  console.log(`${c.bgGreen}${c.bold}                               ${c.reset}\n`);
  console.log(`${c.bold}Next steps:${c.reset}\n`);
  console.log(
    `  ${c.green}1.${c.reset} Start the app:\n` +
    `     ${c.cyan}npm run dev${c.reset}\n`,
  );
  console.log(
    `  ${c.green}2.${c.reset} Open ${c.cyan}${appUrl}${c.reset} — sign in with your linked Tide account\n`,
  );
  console.log(
    `  ${c.green}3.${c.reset} Create a server → create a channel\n` +
    `     ${c.dim}An admin approval popup will appear to sign the Forseti E2EE policy.${c.reset}\n` +
    `     ${c.dim}Approve it — the channel will show a green "E2EE" badge when ready.${c.reset}\n`,
  );
  console.log(
    `  ${c.green}4.${c.reset} Start chatting — messages are encrypted in your browser.\n`,
  );
  console.log(`${c.dim}  Docs: SETUP.md${c.reset}\n`);
}

main().catch((err) => {
  fail(String(err));
  exit(1);
});
