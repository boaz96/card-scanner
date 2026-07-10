import Anthropic from "@anthropic-ai/sdk";
import { llmRawCardSchema, type LlmRawCard } from "@card-scanner/shared";
import { env } from "../env.js";
import { AppError } from "../errors.js";
import {
  SYSTEM_PROMPT,
  USER_INSTRUCTION,
} from "../../prompts/businessCardExtraction.js";

/**
 * 1차 추출: Claude Vision 에 명함 이미지를 넘겨 표준 JSON(BusinessCard 원본형)으로 구조화.
 * - API 키는 서버 환경변수에서만 로드합니다.
 */

/** LLM 응답 텍스트에서 첫 번째 JSON 객체만 안전하게 파싱 */
function parseFirstJsonObject(text: string): unknown {
  // 코드펜스 제거
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new AppError(
      "LLM_PARSE_FAILED",
      502,
      "AI 응답에서 정보를 해석하지 못했습니다. 다시 시도해 주세요.",
    );
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new AppError(
      "LLM_PARSE_FAILED",
      502,
      "AI 응답에서 정보를 해석하지 못했습니다. 다시 시도해 주세요.",
    );
  }
}

export async function extractWithLLM(
  imageBase64: string,
  mediaType: "image/jpeg",
): Promise<LlmRawCard> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AppError(
      "LLM_NOT_CONFIGURED",
      500,
      "AI 인식이 설정되지 않았습니다. 관리자에게 문의해 주세요.",
    );
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 1024,
      // 참고: 최신 모델(claude-sonnet-5 등)은 temperature 파라미터를 지원하지 않아 넣지 않습니다.
      // 일관성은 프롬프트의 명시적 규칙·예시로 확보합니다.
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: imageBase64,
              },
            },
            { type: "text", text: USER_INSTRUCTION },
          ],
        },
      ],
    });
  } catch (err) {
    // 실제 원인을 서버 로그에 남겨 디버깅 가능하게 함
    const status = err instanceof Anthropic.APIError ? err.status : undefined;
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[llmVision] Anthropic 호출 실패 (status=${status ?? "n/a"}):`, detail);

    if (status === 401) {
      throw new AppError("LLM_AUTH", 502, "AI 인식 API 키가 유효하지 않습니다. 키를 확인해 주세요.");
    }
    if (status === 403) {
      throw new AppError("LLM_FORBIDDEN", 502, "AI 인식 권한/크레딧이 없습니다. Anthropic 콘솔에서 결제·크레딧을 확인해 주세요.");
    }
    if (status === 404) {
      throw new AppError("LLM_MODEL", 502, "지정한 AI 모델을 찾을 수 없습니다. ANTHROPIC_MODEL 값을 확인해 주세요.");
    }
    if (status === 429) {
      throw new AppError("LLM_RATE", 502, "AI 인식 요청이 많습니다. 잠시 후 다시 시도해 주세요.");
    }
    throw new AppError(
      "LLM_FAILED",
      502,
      "AI 인식 서버 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }

  // 텍스트 블록만 모으기(타입 안전)
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const json = parseFirstJsonObject(text);
  const parsed = llmRawCardSchema.safeParse(json);
  if (!parsed.success) {
    throw new AppError(
      "LLM_PARSE_FAILED",
      502,
      "AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.",
    );
  }
  return parsed.data;
}
