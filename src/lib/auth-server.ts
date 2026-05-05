/**
 * Server-side JWT verification against TideCloak's JWKS endpoint.
 * Used in both API routes and the Socket.IO auth middleware.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const TIDECLOAK_URL = (process.env.TIDECLOAK_URL || "").replace(/\/+$/, "");
const REALM = process.env.TIDECLOAK_REALM || "zerolayer";

// JWKS is cached automatically by jose — one fetch per key rotation
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwks) {
    const url = `${TIDECLOAK_URL}/realms/${REALM}/protocol/openid-connect/certs`;
    jwks = createRemoteJWKSet(new URL(url));
  }
  return jwks;
}

export interface TokenPayload extends JWTPayload {
  sub: string;
  preferred_username: string;
  email?: string;
  name?: string;
  picture?: string;
  realm_access?: { roles: string[] };
  resource_access?: Record<string, { roles: string[] }>;
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, getJWKS(), {
    issuer: `${TIDECLOAK_URL}/realms/${REALM}`,
  });
  return payload as TokenPayload;
}

export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

export async function requireAuth(request: Request): Promise<TokenPayload> {
  const token = extractBearerToken(request);
  if (!token) throw new ApiError("Authorization required", 401);
  try {
    return await verifyToken(token);
  } catch {
    throw new ApiError("Invalid or expired token", 401);
  }
}

export function hasRealmRole(user: TokenPayload, role: string): boolean {
  return user.realm_access?.roles?.includes(role) ?? false;
}

/**
 * `tide-realm-admin` is mapped under the `realm-management` client by default.
 * Some setups also surface it on realm_access — check both.
 */
export function isRealmAdmin(user: TokenPayload): boolean {
  if (user.realm_access?.roles?.includes("tide-realm-admin")) return true;
  return user.resource_access?.["realm-management"]?.roles?.includes("tide-realm-admin") ?? false;
}

export async function requireRealmAdmin(request: Request): Promise<TokenPayload> {
  const user = await requireAuth(request);
  if (!isRealmAdmin(user)) {
    throw new ApiError("tide-realm-admin role required", 403);
  }
  return user;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function jsonError(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  console.error("[API Error]", err);
  // Surface the underlying message in development so we can diagnose 500s.
  // Production behaviour (`Internal server error`) is preserved.
  const dev = process.env.NODE_ENV !== "production";
  const message =
    dev && err instanceof Error ? err.message : "Internal server error";
  return Response.json({ error: message }, { status: 500 });
}
