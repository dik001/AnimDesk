export type AppResult<T> =
  { ok: true; data: T } | { ok: false; error: AppError };

export interface AppError {
  code:
    | "network"
    | "invalid_response"
    | "validation"
    | "identity_conflict"
    | "storage"
    | "unknown";
  message: string;
  cause?: unknown;
}
