import {
  businessCardSchema,
  extractionResultSchema,
  type ExtractionResult,
} from "@card-scanner/shared";
import { env } from "../env.js";
import { AppError } from "../errors.js";
import { preprocessImage } from "./imagePreprocess.js";
import { extractWithLLM } from "./llmVision.js";
import { extractWithClova, isClovaConfigured, type OcrResult } from "./clovaOcr.js";
import { reconcile } from "./reconcile.js";

/**
 * 명함 추출 파이프라인 오케스트레이터.
 * sharp 전처리 → Claude Vision(1차) → CLOVA OCR(2차, 비치명적) → 대조·보정 → Zod 검증.
 */
export async function extractCard(imageBuffer: Buffer): Promise<ExtractionResult> {
  // 1) 전처리
  const pre = await preprocessImage(imageBuffer);

  // 2) 1차 LLM 추출(실패 시 AppError throw)
  const llm = await extractWithLLM(pre.base64, pre.mediaType);

  // 3) 2차 OCR 대조(설정 + 활성화 시에만, 실패는 비치명적)
  let ocr: OcrResult | null = null;
  if (env.USE_OCR_FALLBACK && isClovaConfigured()) {
    try {
      ocr = await extractWithClova(pre.jpeg);
    } catch {
      ocr = null; // OCR 실패해도 LLM 결과로 진행
    }
  }

  // 4) 대조·보정 + confidence
  const { draft, confidence, source, warnings, lowConfidenceFields } =
    reconcile(llm, ocr);

  // 5) 최종 스키마 검증(이름/회사 최소 요건 포함)
  const validated = businessCardSchema.safeParse(draft);
  if (!validated.success) {
    throw new AppError(
      "VALIDATION_FAILED",
      422,
      "명함에서 이름 또는 회사명을 찾지 못했습니다. 더 선명하게 다시 촬영해 주세요.",
    );
  }

  return extractionResultSchema.parse({
    card: validated.data,
    confidence,
    source,
    rawText: ocr?.text,
    warnings,
    lowConfidenceFields,
  } satisfies ExtractionResult);
}
