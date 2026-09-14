import { CoreApp } from "@trashlab/core/app";
import tenant from "../../tenant.config";
import { getStore } from "../../lib/store";

/**
 * Catch-all mount for every core route.
 *
 * Tenant-specific pages are ordinary Next.js routes elsewhere in app/. Next
 * resolves more specific segments before this optional catch-all, so custom
 * routes win automatically with no registration and no risk of shadowing core.
 */
export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  return <CoreApp config={tenant} slug={slug ?? []} store={await getStore()} />;
}
