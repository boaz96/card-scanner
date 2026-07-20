import { randomUUID } from "node:crypto";
import { env } from "../env.js";
import { AppError } from "../errors.js";

/**
 * 2차 검증: Naver CLOVA OCR(General)로 순수 텍스트 추출.
 * - 인증정보는 서버 환경변수에서만 로드합니다.
 * - 인식된 필드 텍스트를 공백으로 이어 raw 텍스트를 만들고, 개별 필드 목록도 함께 반환합니다.
 */

export interface OcrResult {
  /** 인식된 전체 텍스트(공백 결합) */
  text: string;
  /** 개별 인식 필드 텍스트 */
  fields: string[];
}

/** CLOVA 응답의 필요한 부분만 최소 타입 정의 */
interface ClovaField {
  inferText?: string;
}
interface ClovaImage {
  fields?: ClovaField[];
}
interface ClovaResponse {
  images?: ClovaImage[];
}

/**
 * CLOVA OCR 사용 가능 여부.
 * - 실제 키가 있거나, 모의 모드(CLOVA_OCR_MOCK=true)면 true.
 */
export function isClovaConfigured(): boolean {
  return (
    Boolean(env.CLOVA_OCR_INVOKE_URL && env.CLOVA_OCR_SECRET_KEY) ||
    env.CLOVA_OCR_MOCK
  );
}

export async function extractWithClova(jpeg: Buffer): Promise<OcrResult> {
  // 모의 모드: 실제 키 없이 2차 OCR 경로(source:"merged")를 배선·검증하기 위한 목데이터.
  // 실제 카드 내용과 무관한 안전한 텍스트라 LLM 결과를 훼손하지 않습니다(빈 필드만 보정하는데,
  // 이메일/전화 패턴이 없어 아무 것도 덮어쓰지 않음). 실제 키 등록 시 자동으로 실호출로 전환됩니다.
  if (!env.CLOVA_OCR_INVOKE_URL || !env.CLOVA_OCR_SECRET_KEY) {
    if (env.CLOVA_OCR_MOCK) {
      return {
        text: "[MOCK OCR] CLOVA 키 등록 전 테스트용 목데이터입니다.",
        fields: ["[MOCK", "OCR]"],
      };
    }
    throw new AppError("OCR_NOT_CONFIGURED", 500, "OCR 이 설정되지 않았습니다.");
  }

  const body = {
    version: "V2",
    requestId: randomUUID(),
    timestamp: Date.now(),
    images: [{ format: "jpg", name: "card", data: jpeg.toString("base64") }],
  };

  let res: Response;
  try {
    res = await fetch(env.CLOVA_OCR_INVOKE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OCR-SECRET": env.CLOVA_OCR_SECRET_KEY,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AppError("OCR_FAILED", 502, "OCR 서버 호출에 실패했습니다.");
  }

  if (!res.ok) {
    throw new AppError("OCR_FAILED", 502, `OCR 서버 오류(${res.status})`);
  }

  const data = (await res.json()) as ClovaResponse;
  const fields: string[] = (data.images?.[0]?.fields ?? [])
    .map((f) => f.inferText?.trim() ?? "")
    .filter((t) => t.length > 0);

  return { text: fields.join(" "), fields };
}
