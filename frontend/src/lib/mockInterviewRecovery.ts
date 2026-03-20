import type {
  MockInterviewDeveloperTraceEvent,
  MockInterviewPendingSession,
  MockInterviewSessionSnapshot,
} from "@/types/mockInterview";
import { legacyStorageKey, readStorageWithLegacyFallback } from "@/store/persistStorage";

const STORAGE_KEY = "face-tamato-mock-interview-recoverable-sessions";
const LEGACY_STORAGE_KEYS = [legacyStorageKey("mock", "interview", "recoverable", "sessions")];
const PENDING_STORAGE_KEY = "face-tamato-mock-interview-pending-sessions";
const LEGACY_PENDING_STORAGE_KEYS = [legacyStorageKey("mock", "interview", "pending", "sessions")];
export const MOCK_INTERVIEW_RECOVERY_EVENT = "face-tamato:mock-interview-recovery-changed";

export interface RecoverableSessionRecord {
  snapshot: MockInterviewSessionSnapshot;
}

export interface PendingSessionRecord {
  pending: MockInterviewPendingSession;
}

type LegacySnapshotV2 = Omit<MockInterviewSessionSnapshot, "snapshotVersion" | "developerContext" | "developerTrace"> & {
  snapshotVersion: 2;
  developerContext?: null;
  developerTrace?: MockInterviewDeveloperTraceEvent[];
};

function isSnapshotV2(snapshot: unknown): snapshot is LegacySnapshotV2 {
  if (!snapshot || typeof snapshot !== "object") {
    return false;
  }

  const candidate = snapshot as Partial<LegacySnapshotV2> & {
    interviewPlan?: unknown;
    interviewState?: unknown;
    snapshotVersion?: unknown;
  };

  return (
    candidate.snapshotVersion === 2 &&
    typeof candidate.sessionId === "string" &&
    !!candidate.interviewPlan &&
    !!candidate.interviewState
  );
}

function isSnapshotV3(snapshot: unknown): snapshot is MockInterviewSessionSnapshot {
  if (!snapshot || typeof snapshot !== "object") {
    return false;
  }

  const candidate = snapshot as Partial<MockInterviewSessionSnapshot> & {
    interviewPlan?: unknown;
    interviewState?: unknown;
    snapshotVersion?: unknown;
    developerTrace?: unknown;
  };

  return (
    candidate.snapshotVersion === 3 &&
    typeof candidate.sessionId === "string" &&
    !!candidate.interviewPlan &&
    !!candidate.interviewState &&
    Array.isArray(candidate.developerTrace)
  );
}

function upgradeSnapshot(snapshot: LegacySnapshotV2 | MockInterviewSessionSnapshot): MockInterviewSessionSnapshot {
  if (snapshot.snapshotVersion === 3) {
    return snapshot;
  }

  return {
    ...snapshot,
    snapshotVersion: 3,
    developerContext: snapshot.developerContext ?? null,
    developerTrace: snapshot.developerTrace ?? [],
  };
}

function readRecords(): RecoverableSessionRecord[] {
  try {
    const raw = readStorageWithLegacyFallback("local", STORAGE_KEY, LEGACY_STORAGE_KEYS);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item && (isSnapshotV2(item.snapshot) || isSnapshotV3(item.snapshot)))
      .map((item) => ({ snapshot: upgradeSnapshot(item.snapshot) }));
  } catch {
    return [];
  }
}

function writeRecords(records: RecoverableSessionRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(MOCK_INTERVIEW_RECOVERY_EVENT));
  }
}

function readPendingRecords(): PendingSessionRecord[] {
  try {
    const raw = readStorageWithLegacyFallback("local", PENDING_STORAGE_KEY, LEGACY_PENDING_STORAGE_KEYS);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item) => {
      const pending = item?.pending;
      return (
        pending &&
        typeof pending.pendingId === "string" &&
        (pending.sessionId == null || typeof pending.sessionId === "string") &&
        typeof pending.interviewType === "string" &&
        typeof pending.category === "string" &&
        typeof pending.creatingStep === "string" &&
        typeof pending.startedAt === "string" &&
        typeof pending.lastActiveAt === "string"
      );
    });
  } catch {
    return [];
  }
}

function writePendingRecords(records: PendingSessionRecord[]) {
  localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(records));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(MOCK_INTERVIEW_RECOVERY_EVENT));
  }
}

export function upsertRecoverableSession(record: RecoverableSessionRecord) {
  const records = readRecords().filter((item) => item.snapshot.sessionId !== record.snapshot.sessionId);
  records.unshift(record);
  writeRecords(records.slice(0, 10));
}

export function removeRecoverableSession(sessionId: string) {
  const records = readRecords().filter((item) => item.snapshot.sessionId !== sessionId);
  writeRecords(records);
}

export function upsertPendingSession(pending: MockInterviewPendingSession) {
  const records = readPendingRecords().filter((item) => item.pending.pendingId !== pending.pendingId);
  records.unshift({ pending });
  writePendingRecords(records.slice(0, 10));
}

export function updatePendingSession(
  pendingId: string,
  updates: Partial<Pick<MockInterviewPendingSession, "sessionId" | "creatingStep" | "lastActiveAt">>
) {
  const records = readPendingRecords();
  writePendingRecords(
    records.map((item) =>
      item.pending.pendingId === pendingId ? { pending: { ...item.pending, ...updates } } : item
    )
  );
}

export function removePendingSession(pendingId: string) {
  const records = readPendingRecords().filter((item) => item.pending.pendingId !== pendingId);
  writePendingRecords(records);
}

export function clearRecoverableSessions() {
  writeRecords([]);
  writePendingRecords([]);
}

export function clearLegacyRecoverableSessions() {
  const raw = readStorageWithLegacyFallback("local", STORAGE_KEY, LEGACY_STORAGE_KEYS);
  if (!raw) {
    return false;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      writeRecords([]);
      return true;
    }

    const nextRecords = parsed
      .filter((item) => item && (isSnapshotV2(item.snapshot) || isSnapshotV3(item.snapshot)))
      .map((item) => ({ snapshot: upgradeSnapshot(item.snapshot) }));
    const changed = nextRecords.length !== parsed.length || nextRecords.some((item) => item.snapshot.snapshotVersion !== parsed.find((entry) => entry?.snapshot?.sessionId === item.snapshot.sessionId)?.snapshot?.snapshotVersion);
    if (changed) {
      writeRecords(nextRecords);
    }
    return changed;
  } catch {
    writeRecords([]);
    return true;
  }
}

export function getRecoverableSessions(): RecoverableSessionRecord[] {
  const nowMs = Date.now();
  const records = readRecords().filter((item) => {
    const expiresMs = new Date(item.snapshot.expiresAt).getTime();
    return Number.isFinite(expiresMs) && expiresMs > nowMs;
  });
  if (records.length !== readRecords().length) {
    writeRecords(records);
  }
  return records;
}

export function getRecoverableSessionById(sessionId: string): RecoverableSessionRecord | null {
  const records = getRecoverableSessions();
  return records.find((item) => item.snapshot.sessionId === sessionId) ?? null;
}

export function getPendingSessions(): PendingSessionRecord[] {
  return readPendingRecords().sort(
    (a, b) => +new Date(b.pending.lastActiveAt) - +new Date(a.pending.lastActiveAt)
  );
}

export function getPendingSessionById(pendingId: string): PendingSessionRecord | null {
  return readPendingRecords().find((item) => item.pending.pendingId === pendingId) ?? null;
}
