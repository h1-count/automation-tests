export interface ProcessLockRecord {
  owner?: string;
  expiresAt?: number;
}

/**
 * A timeout alone never fences a lock owner whose process is still alive.
 * Expiry is only a fallback for malformed records without a
 * verifiable PID.
 */
export function processLockCanBeRecovered(
  record: ProcessLockRecord,
  fallbackExpired: boolean,
  now = Date.now()
): boolean {
  const owner = typeof record?.owner === "string" ? record.owner : undefined;
  const expiresAt = typeof record?.expiresAt === "number"
    ? record.expiresAt
    : undefined;
  const pid = Number(owner?.split(":", 1)[0]);
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
  }
  return (
    (typeof expiresAt === "number" && expiresAt <= now)
    || fallbackExpired
  );
}
