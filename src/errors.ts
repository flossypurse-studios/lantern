/** A parse or usage failure that should be reported with file and line context. */
export class LanternError extends Error {
  readonly file: string | undefined;
  readonly line: number | undefined;

  constructor(message: string, opts?: { file?: string; line?: number }) {
    super(message);
    this.name = 'LanternError';
    this.file = opts?.file;
    this.line = opts?.line;
  }

  /** "ledger.md:42: message", degrading gracefully when context is absent. */
  format(): string {
    const where =
      this.file === undefined
        ? ''
        : this.line === undefined
          ? `${this.file}: `
          : `${this.file}:${this.line}: `;
    return `${where}${this.message}`;
  }
}
