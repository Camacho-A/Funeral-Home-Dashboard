import type { PaymentIntegration, PaymentRecord } from '../../types/payment';
import type { WebhookEventRecord } from '../../types/webhookEvent';
import { DEFAULT_ORGANIZATION_ID } from './organizationIds';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Mock-mode fixtures for
 * `paymentIntegrations`/`paymentRecords` — mutated in place by
 * services/paymentsService.ts's mock branch exactly the way
 * services/__mocks__/fixtures.ts's caseFixtures is mutated by
 * casesService.create/update, so mock mode's payment flow behaves
 * consistently with every other mock-mode entity.
 *
 * `isEnabled: true` in sandbox lets the mock-mode UI/tests exercise the
 * full "Collect with Clover" flow end-to-end without ever reaching a real
 * Clover API — see paymentsService.ts's mock branch, which never calls
 * lib/clover/* at all. This is not a real Clover merchant; no credential
 * reference here resolves to an actual secret.
 */
export const CLOVER_INTEGRATION_MOCK_ID = `${DEFAULT_ORGANIZATION_ID}-clover`;

export const paymentIntegrationFixtures: PaymentIntegration[] = [
  {
    id: CLOVER_INTEGRATION_MOCK_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    provider: 'clover',
    environment: 'sandbox',
    merchantIdReference: 'CLOVER_MOCK_MERCHANT_ID',
    credentialReference: 'CLOVER_MOCK_PRIVATE_KEY',
    webhookSecretReference: 'CLOVER_MOCK_WEBHOOK_SECRET',
    isEnabled: true,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
  },
];

/** No seeded payment records — every mock-mode test/demo case starts with
    an empty payment history, matching every other mock entity's "start
    from a clean, explicit fixture" convention. */
export const paymentRecordFixtures: PaymentRecord[] = [];

/**
 * Mock-mode-only webhook event lifecycle tracking — a plain in-memory
 * Map (fingerprint → record), reset whenever the dev/test process
 * restarts. This is intentionally NOT durable; mock mode never claims
 * durability for anything it stores (see caseFixtures/paymentRecordFixtures
 * above). The durability guarantee this phase's correction passes call
 * for lives entirely in wix mode, backed by the real `webhookEvents` Wix
 * collection — see services/paymentsService.ts's claimWebhookEvent/
 * markWebhookEventCompleted/markWebhookEventFailed and
 * lib/wixWebhookEventMapper.ts.
 */
export const webhookEventFixtures: Map<string, WebhookEventRecord> = new Map();
