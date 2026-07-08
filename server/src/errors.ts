import type { ApiError } from "@card-scanner/shared";

/**
 * 애플리케이션 표준 에러.
 * - code: 프로그램용 식별자, httpStatus: 응답 코드, message: 사용자에게 보여줄 한국어 안내.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }

  toApiError(): ApiError {
    return { ok: false, code: this.code, message: this.message };
  }
}

/** 알 수 없는 예외를 표준 형태로 변환 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError(
    "INTERNAL",
    500,
    "명함 인식 중 알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  );
}
