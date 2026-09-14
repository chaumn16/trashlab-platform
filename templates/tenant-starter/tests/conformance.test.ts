import { test } from "node:test";
import { conformanceTests } from "@trashlab/core/conformance";
import tenant from "../tenant.config.ts";

/**
 * Required. The fleet controller refuses to bump a repo's core version if this
 * file is missing or modified to skip checks — verified server-side, not here.
 *
 * Add your own tests below; this call only asserts the core contract.
 */
conformanceTests(test, tenant);
