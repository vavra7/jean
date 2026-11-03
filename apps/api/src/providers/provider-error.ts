export class ProviderError extends Error {
  readonly status: number;
  readonly hint?: string;

  constructor(status: number, message: string, hint?: string) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.hint = hint;
  }
}
