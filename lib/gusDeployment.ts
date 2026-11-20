/**
 * Gus Camacho Jr. deployment preflight (2026-11). The `gus-solis` project
 * serves exactly one organization on the shared Beacon backend. These rules
 * say what its environment must and must not hold before its first
 * controlled deployment, and the server refuses to start when a Gus
 * deployment breaks them (instrumentation.ts) — fail closed.
 *
 * Only variable NAMES are inspected, plus the values of four non-secret
 * settings (adapters and organization ids). No secret value is ever read,
 * compared or logged — which is also why "never reuse a Manors secret"
 * stays a procedure (docs/GUS_DEPLOYMENT_CHECKLIST.md): generate each Gus
 * secret fresh.
 *
 * Every live channel stays unset until its own approval; enabling one
 * means changing this list in code, reviewed, on `release/gus`.
 */

export const GUS_ORGANIZATION_ID = 'gus-camacho-jr';

/** Needed for a Production deployment on shared Wix data. */
export const GUS_REQUIRED_ENV: readonly string[] = [
  'DATA_ADAPTER',
  'AUTH_ADAPTER',
  'DEPLOYMENT_ORGANIZATION_IDS',
  'LOGIN_ORGANIZATION_ID',
  'SESSION_JWT_SECRET',
  'MFA_ENCRYPTION_KEY',
  'CRON_SECRET',
  'WIX_SITE_ID',
  'WIX_API_KEY',
];

/** Needed before documents/branding are stored, and once the domain is chosen. */
export const GUS_LATER_ENV: readonly string[] = ['BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID', 'APP_BASE_URL', 'LOGIN_ORGANIZATION_HOSTS'];

/**
 * Must NOT be set on a Gus deployment: live communication channels (no email,
 * SMS, Outlook/crematory sending, calendar sync), Manors-only keys and
 * templates, the sandbox switch, platform-wide admins, and switches awaiting
 * approval.
 */
export const GUS_FORBIDDEN_ENV: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /^RESEND_/, why: 'email sending is not approved' },
  { pattern: /^TWILIO_/, why: 'SMS is not approved' },
  { pattern: /^MICROSOFT_/, why: 'Outlook / crematory sending is not approved' },
  { pattern: /^GOOGLE_/, why: 'calendar sync is not approved' },
  { pattern: /^CALENDAR_TOKEN_ENCRYPTION_KEY$/, why: 'calendar sync is not approved' },
  { pattern: /^CLOVER_/, why: 'card payments are not configured for Gus' },
  { pattern: /^JOTFORM_API_KEY$/, why: "Manors' JotForm key — Gus has its own, not yet connected" },
  { pattern: /^JOTFORM_API_KEY_GUS_CAMACHO_JR$/, why: 'Gus JotForm is not connected yet' },
  { pattern: /^CERTIFICATE_OF_CREMATION_TEMPLATE_/, why: 'Manors document template' },
  { pattern: /^MANATEE_/, why: 'Manors (Manatee County) document template' },
  { pattern: /^SSN_ENCRYPTION_KEY$/, why: 'Gus has case SSN off' },
  { pattern: /^NEXT_PUBLIC_SOLIS_SANDBOX$/, why: 'a Production deployment is never the sandbox' },
  { pattern: /^PLATFORM_ADMIN_USER_IDS$/, why: 'no platform-wide administrators on a single-organization deployment' },
  { pattern: /^WIX_OAUTH_CLIENT_ID$/, why: 'Wix OAuth sign-in is untested; Gus uses identity sign-in' },
  { pattern: /^SOLIS_FD_CREDENTIALS_STORAGE$/, why: 'live credential storage is not approved' },
];

/** The settings whose values are not secret and must be exactly these. */
const GUS_EXPECTED_VALUES: Readonly<Record<string, string>> = {
  DATA_ADAPTER: 'wix',
  AUTH_ADAPTER: 'identity',
  DEPLOYMENT_ORGANIZATION_IDS: GUS_ORGANIZATION_ID,
  LOGIN_ORGANIZATION_ID: GUS_ORGANIZATION_ID,
};

const isSet = (value: string | undefined) => value !== undefined && value.trim() !== '';

/** Whether this process is a Gus deployment (it names Gus among the organizations it serves). */
export function isGusDeployment(env: Record<string, string | undefined> = process.env): boolean {
  return (env.DEPLOYMENT_ORGANIZATION_IDS ?? '').split(',').some((id) => id.trim() === GUS_ORGANIZATION_ID);
}

/**
 * Every problem with this environment for a Gus deployment (empty = ready).
 * `requireAll` also reports missing required variables — the preflight
 * before the first build; the start-up guard only refuses what must never
 * be present or is wrong.
 */
export function gusDeploymentProblems(env: Record<string, string | undefined>, options: { requireAll?: boolean } = {}): string[] {
  const problems: string[] = [];
  if (options.requireAll) {
    for (const name of GUS_REQUIRED_ENV) if (!isSet(env[name])) problems.push(`${name} is not set`);
  }
  for (const [name, expected] of Object.entries(GUS_EXPECTED_VALUES)) {
    const value = env[name];
    if (isSet(value) && value!.trim() !== expected) problems.push(`${name} must be "${expected}"`);
  }
  for (const [name, value] of Object.entries(env)) {
    if (!isSet(value)) continue;
    const rule = GUS_FORBIDDEN_ENV.find((r) => r.pattern.test(name));
    if (rule) problems.push(`${name} must not be set (${rule.why})`);
  }
  return problems;
}

/**
 * Whether the start-up guard applies: a Gus deployment that is Production or
 * on live Wix data. The sandbox (its own, stricter isolation in
 * lib/sandbox.ts) and mock-data previews are left to their own rules.
 */
export function gusGuardApplies(env: Record<string, string | undefined> = process.env): boolean {
  if (!isGusDeployment(env) || env.NEXT_PUBLIC_SOLIS_SANDBOX === 'true') return false;
  return env.VERCEL_ENV === 'production' || (env.DATA_ADAPTER ?? '').trim().toLowerCase() === 'wix';
}

/** Called once at server start: a Gus deployment with a forbidden or wrong setting refuses to start. */
export function assertGusDeploymentSafe(env: Record<string, string | undefined> = process.env): void {
  if (!gusGuardApplies(env)) return;
  const problems = gusDeploymentProblems(env);
  if (problems.length > 0) throw new Error(`Gus deployment refused to start: ${problems.join('; ')}.`);
}
