#!/usr/bin/env node
// chalky: starts Chalky from the installed package. Its home (app/, state/, workspace/) is CHALKY_HOME, else
// ~/.chalky; the first run copies the package's app/ there. Node won't run TypeScript under node_modules
// (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so server.ts loads through jiti, as pi loads extensions.
//   MODEL_BASE_URL=... MODEL_API_KEY=... [MODEL_NAME=...] chalky
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

process.env.CHALKY_HOME ??= path.join(os.homedir(), ".chalky");
await createJiti(import.meta.url).import(path.join(import.meta.dirname, "../server.ts"));
