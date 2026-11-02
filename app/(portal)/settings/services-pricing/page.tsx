import { redirect } from 'next/navigation';

/** Gus Phase 5C-3: Settings › Services & Pricing became Settings › Price
    Catalog; this keeps old links and bookmarks working. */
export default function ServicesPricingSettingsPage() {
  redirect('/settings/price-catalog');
}
