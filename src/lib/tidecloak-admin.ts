/**
 * TideCloak Admin API wrapper.
 *
 * Responsibilities:
 *  - Mint/refresh an admin access token (client credentials)
 *  - Create realm roles for channel access (Forseti "ch_<channelId>" role)
 *  - Assign / revoke roles from users
 *  - Sync new TideCloak users into the local User table on first login
 *
 * Every channel in ZeroLayer maps to two TideCloak realm roles:
 *   _tide_x.selfencrypt   — voucher gate (generic, assigned once to all users)
 *   _tide_x.selfdecrypt   — voucher gate (generic, assigned once to all users)
 *   ch_<channelId>        — Forseti contract role; controls who can decrypt
 *
 * When a user joins a channel, they receive `ch_<channelId>`.
 * When they leave, it is revoked.  The ORK enforces this cryptographically.
 */

const TIDECLOAK_URL = (process.env.TIDECLOAK_URL || "").replace(/\/+$/, "");
const REALM = process.env.TIDECLOAK_REALM || "zerolayer";
const CLIENT_ID = process.env.TIDECLOAK_CLIENT_ID || "zerolayer-app";
const ADMIN_USER = process.env.TIDECLOAK_ADMIN_USER || "admin";
const ADMIN_PASS = process.env.TIDECLOAK_ADMIN_PASSWORD || "admin";

interface AdminToken {
  access_token: string;
  expires_at: number; // ms epoch
}

let cachedToken: AdminToken | null = null;

// ── Token management ──────────────────────────────────────────────────────────

async function getAdminToken(): Promise<string> {
  if (cachedToken && cachedToken.expires_at > Date.now() + 5_000) {
    return cachedToken.access_token;
  }

  const res = await fetch(
    `${TIDECLOAK_URL}/realms/master/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: ADMIN_USER,
        password: ADMIN_PASS,
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to obtain admin token: ${res.status}`);
  }

  const data = await res.json();
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1_000,
  };
  return cachedToken.access_token;
}

async function adminFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAdminToken();
  return fetch(`${TIDECLOAK_URL}/admin/realms/${REALM}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

// ── Realm role helpers ────────────────────────────────────────────────────────

export async function createChannelRole(channelId: string): Promise<void> {
  const roleName = channelRoleName(channelId);
  const res = await adminFetch("/roles", {
    method: "POST",
    body: JSON.stringify({
      name: roleName,
      description: `ZeroLayer channel access: ${channelId}`,
    }),
  });
  // 409 = already exists — idempotent
  if (!res.ok && res.status !== 409) {
    throw new Error(`Failed to create role ${roleName}: ${res.status}`);
  }
}

export async function deleteChannelRole(channelId: string): Promise<void> {
  const roleName = channelRoleName(channelId);
  const res = await adminFetch(`/roles/${roleName}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete role ${roleName}: ${res.status}`);
  }
}

export async function assignChannelRole(
  userId: string,
  channelId: string,
): Promise<void> {
  const role = await getRole(channelRoleName(channelId));
  if (!role) throw new Error(`Role for channel ${channelId} not found in TideCloak`);

  const keycloakUserId = await getKeycloakUserId(userId);
  const res = await adminFetch(`/users/${keycloakUserId}/role-mappings/realm`, {
    method: "POST",
    body: JSON.stringify([{ id: role.id, name: role.name }]),
  });
  if (!res.ok) throw new Error(`Failed to assign channel role: ${res.status}`);
}

export async function revokeChannelRole(
  userId: string,
  channelId: string,
): Promise<void> {
  const role = await getRole(channelRoleName(channelId));
  if (!role) return; // already gone

  const keycloakUserId = await getKeycloakUserId(userId);
  const res = await adminFetch(`/users/${keycloakUserId}/role-mappings/realm`, {
    method: "DELETE",
    body: JSON.stringify([{ id: role.id, name: role.name }]),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to revoke channel role: ${res.status}`);
  }
}

// ── Voucher gate roles (assigned once at user registration) ──────────────────

export async function ensureVoucherGateRoles(userId: string): Promise<void> {
  const GATE_ROLES = ["_tide_x.selfencrypt", "_tide_x.selfdecrypt"];
  const keycloakUserId = await getKeycloakUserId(userId);

  for (const roleName of GATE_ROLES) {
    const role = await getRole(roleName);
    if (!role) continue; // role may not exist yet — admin must set it up
    await adminFetch(`/users/${keycloakUserId}/role-mappings/realm`, {
      method: "POST",
      body: JSON.stringify([{ id: role.id, name: role.name }]),
    });
  }
}

// ── User lookup ───────────────────────────────────────────────────────────────

/**
 * Map our app user ID (TideCloak `sub`) to the Keycloak internal user ID
 * used in Admin API paths.  They differ: `sub` is the external OIDC identifier.
 */
async function getKeycloakUserId(sub: string): Promise<string> {
  // In TideCloak/Keycloak the JWT 'sub' claim == the Admin API user UUID.
  // Validate the user exists before using the ID in role-mapping paths.
  const res = await adminFetch(`/users/${sub}`);
  if (!res.ok) throw new Error(`User ${sub} not found in TideCloak (${res.status})`);
  return sub;
}

async function getRole(
  roleName: string,
): Promise<{ id: string; name: string } | null> {
  const res = await adminFetch(`/roles/${encodeURIComponent(roleName)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to get role ${roleName}: ${res.status}`);
  return res.json();
}

// ── Naming convention ─────────────────────────────────────────────────────────

export function channelRoleName(channelId: string): string {
  return `ch_${channelId}`;
}

export function serverAdminRoleName(serverId: string): string {
  return `srv_admin_${serverId}`;
}

export function serverMemberRoleName(serverId: string): string {
  return `srv_member_${serverId}`;
}

// ── Role lookup ──────────────────────────────────────────────────────────────

export async function getRoleByName(
  roleName: string,
): Promise<{ id: string; name: string } | null> {
  return getRole(roleName);
}

// ── Server-scoped role provisioning ──────────────────────────────────────────

/**
 * Idempotent: creates `srv_admin_<S>` and `srv_member_<S>` realm roles for the
 * given server. Returns the TideCloak role UUIDs needed for `policyRoleId`
 * and `init-cert` calls. The IGA change-sets created by role *creation* are
 * auto-ACTIVE (per canon GAP-041) — no sign/commit needed for these two.
 */
export async function createServerRoles(
  serverId: string,
): Promise<{ srvAdminRoleId: string; srvMemberRoleId: string }> {
  const adminName = serverAdminRoleName(serverId);
  const memberName = serverMemberRoleName(serverId);

  for (const [name, description] of [
    [adminName, `ZeroLayer server owner: ${serverId}`],
    [memberName, `ZeroLayer server member: ${serverId}`],
  ] as const) {
    const res = await adminFetch("/roles", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    });
    if (!res.ok && res.status !== 409) {
      throw new Error(`Failed to create role ${name}: ${res.status}`);
    }
  }

  const [adminRole, memberRole] = await Promise.all([
    getRole(adminName),
    getRole(memberName),
  ]);
  if (!adminRole || !memberRole) {
    throw new Error("Server role lookup failed after creation");
  }
  return { srvAdminRoleId: adminRole.id, srvMemberRoleId: memberRole.id };
}

/** Best-effort: delete the per-server realm roles. Idempotent (404 is fine).
 *  Deleting a role removes it from every user that holds it; in IGA mode this
 *  may produce DRAFT change-sets that we ignore — they cancel out when the role
 *  is gone. */
export async function deleteServerRoles(serverId: string): Promise<void> {
  for (const name of [serverAdminRoleName(serverId), serverMemberRoleName(serverId)]) {
    try {
      const res = await adminFetch(`/roles/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 404) {
        console.warn(`[TideCloak] delete role ${name} failed: ${res.status}`);
      }
    } catch (e) {
      console.warn(`[TideCloak] delete role ${name} threw`, e);
    }
  }
}

export async function assignServerRole(
  userId: string,
  roleId: string,
  roleName: string,
): Promise<void> {
  const keycloakUserId = await getKeycloakUserId(userId);
  const res = await adminFetch(`/users/${keycloakUserId}/role-mappings/realm`, {
    method: "POST",
    body: JSON.stringify([{ id: roleId, name: roleName }]),
  });
  if (!res.ok) {
    throw new Error(`Failed to assign role ${roleName}: ${res.status}`);
  }
}

// ── Init-cert (delegated approval policy) ────────────────────────────────────

/**
 * Stores a VVK-signed Forseti policy on a role. After this, IGA change-sets
 * referencing this role via `policyRoleId` will gate approval through the
 * stored policy's contract.
 *
 * `initCert` is base64-encoded `policy.toBytes()` from the browser signing flow.
 * `initCertSig` is optional — the raw VVK signature (base64). Most flows omit it.
 *
 * Endpoint path is `tide-iga-provider`, not `tide-admin` (per canon).
 */
export async function storeRoleInitCert(
  roleId: string,
  initCert: string,
  initCertSig?: string,
): Promise<void> {
  const token = await getAdminToken();
  const body: Record<string, string> = { initCert };
  if (initCertSig) body.initCertSig = initCertSig;

  const res = await fetch(
    `${TIDECLOAK_URL}/admin/realms/${REALM}/tide-iga-provider/role-policy/${roleId}/init-cert`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`init-cert ${res.status}: ${text}`);
  }
}

// ── User lookup by username ──────────────────────────────────────────────────

export async function getUserByUsername(
  username: string,
): Promise<{ id: string; username: string; email?: string } | null> {
  const res = await adminFetch(
    `/users?username=${encodeURIComponent(username)}&exact=true`,
  );
  if (!res.ok) return null;
  const arr = await res.json();
  return Array.isArray(arr) && arr.length > 0
    ? { id: arr[0].id, username: arr[0].username, email: arr[0].email }
    : null;
}

// ── IGA change-set proxy helpers ─────────────────────────────────────────────

export interface PendingChangeSet {
  draftRecordId: string;
  changeSetType: string;
  actionType: string;
  userId?: string;
  roleName?: string;
  // raw entry, kept for debugging
  raw: any;
}

/**
 * Fetch all pending USER_ROLE change-sets that target a specific role.
 * Used after creating a role assignment to find the just-created draft.
 */
export async function findPendingUserRoleChangeSet(
  targetUserId: string,
  targetRoleName: string,
): Promise<PendingChangeSet | null> {
  const res = await adminFetch("/tide-admin/change-set/users/requests");
  if (!res.ok) return null;
  const arr = await res.json();
  if (!Array.isArray(arr)) return null;

  // Match by user id + role name. Different TideCloak versions surface these
  // fields under different keys, so check the obvious ones.
  for (const req of arr) {
    const userMatch =
      req.userId === targetUserId ||
      req.affectedUserId === targetUserId ||
      req.user?.id === targetUserId;
    const roleMatch =
      req.roleName === targetRoleName ||
      req.role?.name === targetRoleName ||
      req.affectedRoleName === targetRoleName ||
      // Fallback: scan stringified payload
      JSON.stringify(req).includes(targetRoleName);
    if (userMatch && roleMatch) {
      return {
        draftRecordId: req.draftRecordId,
        changeSetType: req.changeSetType,
        actionType: req.actionType,
        userId: targetUserId,
        roleName: targetRoleName,
        raw: req,
      };
    }
  }
  return null;
}

export interface SignBatchResult {
  changesetId: string;
  requiresApprovalPopup: boolean;
  /** base64 — must be decoded and presented to the user's enclave */
  changeSetDraftRequests?: string;
}

export async function signChangeSetBatch(
  changeSets: Array<{
    changeSetId: string;
    changeSetType: string;
    actionType: string;
    policyRoleId?: string;
  }>,
): Promise<SignBatchResult[]> {
  const token = await getAdminToken();
  const res = await fetch(
    `${TIDECLOAK_URL}/admin/realms/${REALM}/tide-admin/change-set/sign/batch`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ changeSets }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`sign/batch ${res.status}: ${text}`);
  }
  const data = await res.json();
  // Some versions return { results: [...] }, others a bare array
  const results = Array.isArray(data) ? data : (data.results ?? []);
  return results;
}

/**
 * Submit the user-enclave-signed review payload. Endpoint requires
 * multipart/form-data (NOT JSON) per canon.
 */
export async function submitChangeSetReview(args: {
  changeSetId: string;
  changeSetType: string;
  actionType: string;
  /** base64-encoded enclave-signed bytes */
  signedRequestB64: string;
}): Promise<void> {
  const token = await getAdminToken();
  const fd = new FormData();
  fd.append("changeSetId", args.changeSetId);
  fd.append("changeSetType", args.changeSetType);
  fd.append("actionType", args.actionType);
  fd.append("requests", args.signedRequestB64);

  const res = await fetch(
    `${TIDECLOAK_URL}/admin/realms/${REALM}/tideAdminResources/add-review`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      // DO NOT set Content-Type — browser/Node sets the multipart boundary
      body: fd,
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`add-review ${res.status}: ${text}`);
  }
}

export async function commitChangeSetBatch(
  changeSets: Array<{
    changeSetId: string;
    changeSetType: string;
    actionType: string;
  }>,
): Promise<void> {
  const token = await getAdminToken();
  const res = await fetch(
    `${TIDECLOAK_URL}/admin/realms/${REALM}/tide-admin/change-set/commit/batch`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ changeSets }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`commit/batch ${res.status}: ${text}`);
  }
}

// ── JWT inspection helpers ───────────────────────────────────────────────────

/**
 * Quick check on a verified JWT payload: does this user hold `tide-realm-admin`?
 * The role lives under `realm-management` client roles in Keycloak's standard
 * mapping. Falls back to checking realm_access too.
 */
export function jwtHasRealmAdmin(payload: any): boolean {
  if (!payload) return false;
  const realmRoles: string[] = payload?.realm_access?.roles ?? [];
  if (realmRoles.includes("tide-realm-admin")) return true;
  const rmRoles: string[] = payload?.resource_access?.["realm-management"]?.roles ?? [];
  return rmRoles.includes("tide-realm-admin");
}

// ── IGA change-request approval ───────────────────────────────────────────────

export async function approveRoleChangeRequests(): Promise<void> {
  try {
    const res = await adminFetch("/tide-admin/change-set/roles/requests");
    if (!res.ok) return;
    const requests: Array<{ draftRecordId: string; changeSetType: string; actionType: string }> = await res.json();
    if (!Array.isArray(requests) || requests.length === 0) return;
    for (const req of requests) {
      const payload = { changeSetId: req.draftRecordId, changeSetType: req.changeSetType, actionType: req.actionType };
      const token = await getAdminToken();
      await fetch(`${TIDECLOAK_URL}/admin/realms/${REALM}/tide-admin/change-set/sign`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const token2 = await getAdminToken();
      await fetch(`${TIDECLOAK_URL}/admin/realms/${REALM}/tide-admin/change-set/commit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token2}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
  } catch (e) {
    console.warn("[TideCloak] approveRoleChangeRequests failed:", e);
  }
}
