/**
 * Phase 39 (Family Billing & FTC Compliance Documents). The CENTRAL,
 * SYSTEM-CONTROLLED compliance-content registry for the FTC Funeral Rule
 * (16 CFR Part 453). This module is the single source of truth for:
 *   - the machine-readable FTC classification keys;
 *   - the mandatory federal disclosure text (versioned, non-editable,
 *     non-deletable — organizations may add *optional supplemental* language
 *     elsewhere, but can never edit, remove, or override what is here);
 *   - the mandatory structural requirements per compliance document.
 *
 * D6: mandatory federal wording is system-locked. It is defined ONLY here —
 * never inlined in a UI component, a route, a template, or org config — so
 * Beacon can update the federal wording deliberately (bump
 * `FTC_DISCLOSURE_VERSION`, add a new versioned block) if the Rule changes,
 * and every historical document can record exactly which disclosure version
 * it was rendered against.
 *
 * ⚠️ LEGAL-REVIEW BOUNDARY (do not remove): the disclosure strings below are
 * Beacon's rendering of the FTC Funeral Rule's required model language, each
 * tagged with its `citation`. They MUST be verified verbatim against the
 * current text of 16 CFR Part 453 by qualified counsel before production use.
 * Beacon assists with structured FTC documents; it does NOT provide a
 * legal-compliance guarantee, and state/local/cemetery/crematory requirements
 * are out of scope of this federal registry. See docs/COMPLIANCE_BOUNDARY.md.
 */

/** Bump this (and add a new versioned block) whenever the mandated federal
    wording changes. Every generated compliance document records the version
    it rendered against, so historical documents are never silently restated. */
export const FTC_DISCLOSURE_VERSION = 'ftc-funeral-rule-2024-09-16';

/** Machine-readable FTC line classification. Display names never determine
    classification (D3). `unclassified` is an explicit "not yet classified"
    state — it NEVER silently acquires compliance meaning; the renderer
    surfaces it in a distinct, flagged section rather than folding it into a
    mandated bucket. */
export const FTC_CLASS = {
  /** The funeral provider's non-declinable basic services & overhead fee.
      For a provider whose basic-services fee is bundled into another priced
      item (e.g. direct cremation), that item is classified here and the
      document states the fee is included, not separately charged (D10). */
  BASIC_SERVICES_FEE: 'basic_services_fee',
  /** Declinable funeral-home goods and services (add-ons, merchandise). */
  GOODS_AND_SERVICES: 'goods_and_services',
  /** Items the provider pays third parties for on the family's behalf
      (death certificates, obituaries, honoraria). Non-GL, display-only in
      Phase 39 (D4). */
  CASH_ADVANCE: 'cash_advance',
  /** Explicit not-yet-classified — flagged, never treated as compliant. */
  UNCLASSIFIED: 'unclassified',
} as const;

export type FtcClass = (typeof FTC_CLASS)[keyof typeof FTC_CLASS];

const FTC_CLASS_VALUES: ReadonlySet<string> = new Set(Object.values(FTC_CLASS));

export function isFtcClass(value: unknown): value is FtcClass {
  return typeof value === 'string' && FTC_CLASS_VALUES.has(value);
}

/** A single system-locked mandatory disclosure. `citation` records the Rule
    provision; `appliesWhen` narrows applicability so a provider that does not
    offer a category never renders that category's disclosure (D7 — do not
    imply offerings that are not configured). */
export type FtcDisclosure = {
  /** Stable machine id — referenced by the renderers, never the display text. */
  key: string;
  /** The Rule provision this renders (audit/provenance). */
  citation: string;
  /** Exact mandated wording (pending legal verification — see boundary note). */
  text: string;
  /** Which compliance documents must carry it. */
  documents: ReadonlyArray<'general_price_list' | 'statement_of_goods_and_services'>;
  /** Conditional applicability: 'always', or gated on a provider offering. */
  appliesWhen: 'always' | 'offers_direct_cremation' | 'offers_embalming' | 'offers_caskets' | 'offers_outer_burial_containers';
};

/**
 * The mandatory federal disclosures. SYSTEM-LOCKED — no org edit path exists.
 * Applicability is intentionally conditional so a direct-cremation-only
 * provider (Manor) renders exactly the disclosures its offerings require, and
 * never implies it sells caskets/burial containers/embalming it does not.
 */
export const FTC_MANDATORY_DISCLOSURES: readonly FtcDisclosure[] = [
  {
    key: 'gpl.itemization_right',
    citation: '16 CFR 453.2(b)(4)(i)(A)',
    text:
      'The goods and services shown below are those we can provide to our customers. ' +
      'You may choose only the items you desire. However, any funeral arrangements you select will include a charge for our basic services and overhead. ' +
      'If legal or other requirements mean you must buy any items you did not specifically ask for, we will explain the reason in writing on the statement we provide describing the funeral goods and services you selected.',
    documents: ['general_price_list'],
    appliesWhen: 'always',
  },
  {
    key: 'gpl.embalming',
    citation: '16 CFR 453.3(a)(2) / 453.2(b)(4)(iii)(B)',
    text:
      'Except in certain special cases, embalming is not required by law. Embalming may be necessary, however, if you select certain funeral arrangements, such as a funeral with viewing. ' +
      'If you do not want embalming, you usually have the right to choose an arrangement that does not require you to pay for it, such as direct cremation or immediate burial.',
    documents: ['general_price_list'],
    appliesWhen: 'offers_embalming',
  },
  {
    key: 'gpl.direct_cremation_alternative_container',
    citation: '16 CFR 453.2(b)(4)(iii)(C)',
    text:
      'If you want to arrange a direct cremation, you can use an alternative container. Alternative containers encase the body and can be made of materials like heavy cardboard or composition materials (with or without an outside covering), or pouches of canvas or other materials. ' +
      'The containers we provide are described in this price list.',
    documents: ['general_price_list'],
    appliesWhen: 'offers_direct_cremation',
  },
  {
    key: 'gpl.casket_price_list',
    citation: '16 CFR 453.2(b)(2)',
    text: 'A complete price list of the caskets we offer for sale will be provided to you for your review before you view any caskets.',
    documents: ['general_price_list'],
    appliesWhen: 'offers_caskets',
  },
  {
    key: 'gpl.outer_burial_container_price_list',
    citation: '16 CFR 453.2(b)(3)',
    text:
      'In most areas of the country, state or local law does not require that you buy a container to surround the casket in the grave. However, many cemeteries require that you have such a container so that the grave will not sink in. ' +
      'A complete price list of the outer burial containers we offer will be provided to you for your review.',
    documents: ['general_price_list'],
    appliesWhen: 'offers_outer_burial_containers',
  },
  {
    key: 'statement.required_purchase_explanation',
    citation: '16 CFR 453.2(b)(5)(i)',
    text:
      'Charges are only for those items that you selected or that are required. If we are required by law or by a cemetery or crematory to use any items, we will explain the reasons in writing below.',
    documents: ['statement_of_goods_and_services'],
    appliesWhen: 'always',
  },
  {
    key: 'statement.embalming',
    citation: '16 CFR 453.5(b)',
    text:
      'If you selected a funeral that may require embalming, such as a funeral with viewing, you may have to pay for embalming. You do not have to pay for embalming you did not approve if you selected arrangements such as a direct cremation or immediate burial. ' +
      'If we charged for embalming, we will explain why below.',
    documents: ['statement_of_goods_and_services'],
    appliesWhen: 'offers_embalming',
  },
  {
    key: 'statement.cash_advance_markup',
    citation: '16 CFR 453.3(f)(2)',
    text:
      'We charge you for our services in obtaining certain items on your behalf (cash advance items). Where a cash advance item is marked as such, the amount we charge you is greater than the actual cost to us of that item.',
    documents: ['statement_of_goods_and_services'],
    appliesWhen: 'always',
  },
] as const;

/** Mandatory structural sections each compliance document must render, in
    order. The renderer asserts every required section is present (a missing
    section is a build error, never a silently-incomplete document). */
export const FTC_REQUIRED_SECTIONS = {
  general_price_list: ['provider_identification', 'effective_date', 'itemized_prices', 'mandatory_disclosures'],
  statement_of_goods_and_services: [
    'provider_identification',
    'decedent_identification',
    'selected_goods_and_services',
    'cash_advance_items',
    'total_of_arrangements',
    'required_purchase_explanations',
    'mandatory_disclosures',
  ],
} as const;

export type FtcComplianceDocument = keyof typeof FTC_REQUIRED_SECTIONS;

/** Provider offering flags — which conditional disclosures apply. Derived from
    the org's actual catalog/config, never assumed. A direct-cremation-only
    provider sets only `offersDirectCremation`. */
export type ProviderOfferings = {
  offersDirectCremation: boolean;
  offersEmbalming: boolean;
  offersCaskets: boolean;
  offersOuterBurialContainers: boolean;
};

export function disclosuresFor(document: FtcComplianceDocument, offerings: ProviderOfferings): FtcDisclosure[] {
  return FTC_MANDATORY_DISCLOSURES.filter((d) => {
    if (!d.documents.includes(document)) return false;
    switch (d.appliesWhen) {
      case 'always':
        return true;
      case 'offers_direct_cremation':
        return offerings.offersDirectCremation;
      case 'offers_embalming':
        return offerings.offersEmbalming;
      case 'offers_caskets':
        return offerings.offersCaskets;
      case 'offers_outer_burial_containers':
        return offerings.offersOuterBurialContainers;
    }
  });
}
