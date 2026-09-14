import { CoreLayout } from "@trashlab/core/app";
import { CORE_VERSION } from "@trashlab/core";
import tenant from "../tenant.config";

export const metadata = { title: tenant.displayName };

/**
 * The entire wiring of core into this tenant app. Two files, this one and
 * app/[[...slug]]/page.tsx. Everything else in app/ is tenant-specific pages.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <CoreLayout config={tenant} coreVersion={CORE_VERSION}>
          {children}
        </CoreLayout>
      </body>
    </html>
  );
}
