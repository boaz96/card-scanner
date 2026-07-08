import type {
  ExtractionResult,
  ApiError,
  BusinessCard,
  DuplicateAction,
  SaveCardResponse,
} from "@card-scanner/shared";

/**
 * 서버 API 호출 래퍼.
 * - 프론트는 절대 외부 API 를 직접 부르지 않고, 항상 자체 서버(/api)만 호출합니다.
 */

/** 서버가 반환한 ApiError 를 감싸는 예외 */
export class ScanApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ScanApiError";
  }
}

/**
 * 명함 이미지를 /api/scan 으로 업로드하고 추출 결과를 받습니다.
 * @param image 리사이즈된 업로드용 JPEG Blob
 */
export async function scanCard(image: Blob): Promise<ExtractionResult> {
  const form = new FormData();
  form.append("image", image, "card.jpg");

  let res: Response;
  try {
    res = await fetch("/api/scan", { method: "POST", body: form });
  } catch {
    throw new ScanApiError("NETWORK", "서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
  }

  if (!res.ok) {
    // 서버가 표준 ApiError(JSON)를 주면 그대로 사용, 아니면 상태코드 기반 메시지
    let apiError: Partial<ApiError> = {};
    try {
      apiError = (await res.json()) as Partial<ApiError>;
    } catch {
      /* 본문이 JSON 이 아님 */
    }
    throw new ScanApiError(
      apiError.code ?? `HTTP_${res.status}`,
      apiError.message ?? "명함 인식에 실패했습니다. 다시 시도해 주세요.",
    );
  }

  return (await res.json()) as ExtractionResult;
}

/**
 * 확인·보정된 명함을 /api/save 로 저장.
 * @param onDuplicate 중복 시 처리(add/skip/update). 미지정으로 호출 후
 *   status:"duplicate" 를 받으면 사용자 선택을 담아 재호출합니다.
 */
export async function saveCard(
  card: BusinessCard,
  onDuplicate?: DuplicateAction,
): Promise<SaveCardResponse> {
  let res: Response;
  try {
    res = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card, onDuplicate }),
    });
  } catch {
    throw new ScanApiError("NETWORK", "서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
  }

  if (!res.ok) {
    let apiError: Partial<ApiError> = {};
    try {
      apiError = (await res.json()) as Partial<ApiError>;
    } catch {
      /* JSON 아님 */
    }
    throw new ScanApiError(
      apiError.code ?? `HTTP_${res.status}`,
      apiError.message ?? "시트 저장에 실패했습니다. 다시 시도해 주세요.",
    );
  }

  return (await res.json()) as SaveCardResponse;
}
