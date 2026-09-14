import { CoreApp } from "@trashlab/core/app";
import tenant from "../../tenant.config";
import { getStore } from "../../lib/store";

/**
 * Catch-all mount for core routes. Identical to the template except for the
 * demo store — in production core resolves the database from DATABASE_URL and
 * this file is the template's two-liner.
 */
export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  return <CoreApp config={tenant} slug={slug ?? []} store={await getStore()} />;
}
