import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, "../../../fixtures/bridge");

export async function loadFixture<T>(name: string): Promise<T> {
  const contents = await readFile(path.join(fixturesDir, name), "utf8");
  return JSON.parse(contents) as T;
}
