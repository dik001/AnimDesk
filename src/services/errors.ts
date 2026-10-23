import type { AppError } from "../types/result";

export function toAppError(error: unknown): AppError {
  if (error instanceof TypeError) {
    return {
      code: "network",
      message:
        "Не удалось связаться с источником данных. Проверьте подключение к сети.",
      cause: error,
    };
  }

  if (error instanceof Error) {
    return {
      code: "unknown",
      message: error.message || "Произошла неизвестная ошибка.",
      cause: error,
    };
  }

  return {
    code: "unknown",
    message: "Произошла неизвестная ошибка.",
    cause: error,
  };
}
