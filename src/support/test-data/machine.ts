import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function getMachineId(ledgerRoot: string): Promise<string> {
  await mkdir(ledgerRoot, { recursive: true });
  const path = resolve(ledgerRoot, "machine-id");
  if (existsSync(path)) {
    const value = (await readFile(path, "utf8")).trim();
    if (/^machine-[a-f0-9-]{36}$/i.test(value)) {
      return value;
    }
    throw new Error("Local test ledger machine ID is invalid; do not reuse this ledger until it is manually reviewed.");
  }
  const machineId = `machine-${randomUUID()}`;
  await writeFile(path, `${machineId}\n`, { encoding: "utf8", mode: 0o600 });
  return machineId;
}
