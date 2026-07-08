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

/** CLOVA OCR 설정 여부 */
export function isClovaConfigured(): boolean {
  return Boolean(env.CLOVA_OCR_INVOKE_URL && env.CLOVA_OCR_SECRET_KEY);
}

export async function extractWithClova(jpeg: Buffer): Promise<OcrResult> {
  if (!env.CLOVA_OCR_INVOKE_URL || !env.CLOVA_OCR_SECRET_KEY) {
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
