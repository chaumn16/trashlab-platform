import { CoreApp } from "@trashlab/core/app";
import tenant from "../../tenant.config";

/**
 * Catch-all mount for every core route.
 *
 * Tenant-specific pages are ordinary Next.js routes elsewhere in app/ — e.g.
 * app/manifest/page.tsx. Next resolves more specific segments before this
 * optional catch-all, so custom routes win automatically with no registration
 * and no risk of shadowing core.
 */
export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  return <CoreApp config={tenant} slug={slug ?? []} />;
}
