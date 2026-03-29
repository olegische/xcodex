import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const distDir = new URL("../dist/", import.meta.url);
const distTypesDir = new URL("../dist-types/", import.meta.url);
const packageTypesDir = new URL("../dist-types/wasm/ts/xcodex-sdk/src/", import.meta.url);
const protocolTypesDir = new URL("../dist-types/app-server-protocol/", import.meta.url);
const distProtocolDir = new URL("../dist/app-server-protocol/", import.meta.url);

if (!existsSync(packageTypesDir)) {
  throw new Error("Expected generated declarations under dist-types/wasm/ts/xcodex-sdk/src.");
}

if (!existsSync(protocolTypesDir)) {
  throw new Error("Expected generated app-server protocol declarations under dist-types/app-server-protocol.");
}

mkdirSync(distDir, { recursive: true });
rmSync(distProtocolDir, { recursive: true, force: true });
cpSync(protocolTypesDir, distProtocolDir, { recursive: true });

for (const entry of readdirSync(packageTypesDir)) {
  if (!entry.endsWith(".d.ts")) {
    continue;
  }
  const sourcePath = join(packageTypesDir.pathname, entry);
  const targetPath = join(distDir.pathname, entry);
  const contents = readFileSync(sourcePath, "utf8")
    .replaceAll(/(\.\/[^"']+)\.ts(["'])/g, "$1$2")
    .replaceAll("../../../../app-server-protocol/", "./app-server-protocol/");
  writeFileSync(targetPath, contents);
}

rmSync(distTypesDir, { recursive: true, force: true });
