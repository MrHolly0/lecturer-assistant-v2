export interface VersionedStudentSnapshot {
  version: number;
}

/** Rejects older session revisions and HTTP responses overtaken while in flight. */
export class StudentSnapshotGate<T extends VersionedStudentSnapshot> {
  private latest: T | null = null;
  private revision = 0;

  get current(): T | null {
    return this.latest;
  }

  get generation(): number {
    return this.revision;
  }

  accept(next: T): boolean {
    if (this.latest && next.version < this.latest.version) return false;
    this.latest = next;
    this.revision += 1;
    return true;
  }

  acceptRequest(next: T, startedAt: number): boolean {
    if (this.latest && startedAt !== this.revision) return false;
    return this.accept(next);
  }
}
