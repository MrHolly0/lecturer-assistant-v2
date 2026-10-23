/** One logical form submission retains its key until the response is confirmed. */
export class PendingOperationKey {
  private current: { fingerprint: string; key: string } | null = null;

  forPayload(payload: unknown): string {
    const fingerprint = JSON.stringify(payload);
    if (!this.current || this.current.fingerprint !== fingerprint) {
      this.current = { fingerprint, key: newOperationKey() };
    }
    return this.current.key;
  }

  clear(confirmedKey?: string): void {
    if (confirmedKey === undefined || this.current?.key === confirmedKey) this.current = null;
  }

  async run<T>(payload: unknown, command: (key: string) => Promise<T>): Promise<T> {
    const key = this.forPayload(payload);
    const result = await command(key);
    this.clear(key);
    return result;
  }
}

export function newOperationKey(): string {
  return crypto.randomUUID();
}
