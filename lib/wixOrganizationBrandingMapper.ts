import type { OrganizationBranding } from '../types/organizationBranding';

export type WixOrganizationBrandingItem = {
  organizationId?: unknown;
  logoUrl?: unknown;
  primaryColor?: unknown;
  secondaryColor?: unknown;
  accentColor?: unknown;
  emailFromName?: unknown;
  documentFooter?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function mapWixOrganizationBrandingItem(item: WixOrganizationBrandingItem | undefined): OrganizationBranding | null {
  if (
    !item ||
    typeof item.organizationId !== 'string' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    organizationId: item.organizationId,
    logoUrl: typeof item.logoUrl === 'string' ? item.logoUrl : null,
    primaryColor: typeof item.primaryColor === 'string' ? item.primaryColor : null,
    secondaryColor: typeof item.secondaryColor === 'string' ? item.secondaryColor : null,
    accentColor: typeof item.accentColor === 'string' ? item.accentColor : null,
    emailFromName: typeof item.emailFromName === 'string' ? item.emailFromName : null,
    documentFooter: typeof item.documentFooter === 'string' ? item.documentFooter : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixOrganizationBrandingData(branding: OrganizationBranding): WixOrganizationBrandingItem {
  return {
    organizationId: branding.organizationId,
    logoUrl: branding.logoUrl,
    primaryColor: branding.primaryColor,
    secondaryColor: branding.secondaryColor,
    accentColor: branding.accentColor,
    emailFromName: branding.emailFromName,
    documentFooter: branding.documentFooter,
    createdAt: branding.createdAt,
    updatedAt: branding.updatedAt,
  };
}

/** Merges a partial patch onto the existing full Wix item — Wix Data's
    updateDataItem is a full replace, same reasoning as every other mapper
    in this codebase. */
export function applyOrganizationBrandingUpdateToWixData(
  existing: WixOrganizationBrandingItem,
  patch: Partial<OrganizationBranding>,
): WixOrganizationBrandingItem {
  const next: WixOrganizationBrandingItem = { ...existing };
  if (patch.logoUrl !== undefined) next.logoUrl = patch.logoUrl;
  if (patch.primaryColor !== undefined) next.primaryColor = patch.primaryColor;
  if (patch.secondaryColor !== undefined) next.secondaryColor = patch.secondaryColor;
  if (patch.accentColor !== undefined) next.accentColor = patch.accentColor;
  if (patch.emailFromName !== undefined) next.emailFromName = patch.emailFromName;
  if (patch.documentFooter !== undefined) next.documentFooter = patch.documentFooter;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
