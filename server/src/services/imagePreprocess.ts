import sharp from "sharp";
import { AppError } from "../errors.js";

/**
 * sharp 이미지 전처리.
 * - rotate(): EXIF 방향을 반영해 자동 회전 보정.
 * - resize(): 장변 1600px 이내로 축소(확대 안 함) → 업로드/토큰 비용 절감.
 * - normalize()+sharpen(): 대비 향상 + 윤곽 강화로 OCR/LLM 인식률 개선.
 * - jpeg(): 표준 포맷으로 재인코딩.
 */

const MAX_EDGE = 1600;

export interface PreprocessedImage {
  jpeg: Buffer;
  base64: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
}

export async function preprocessImage(input: Buffer): Promise<PreprocessedImage> {
  try {
    const jpeg = await sharp(input, { failOn: "none" })
      .rotate() // EXIF 기반 자동 회전
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .normalize() // 명암 대비 스트레칭
      .sharpen() // 윤곽 강화
      .jpeg({ quality: 90 })
      .toBuffer();

    const meta = await sharp(jpeg).metadata();
    return {
      jpeg,
      base64: jpeg.toString("base64"),
      mediaType: "image/jpeg",
      width: meta.width ?? 0,
      height: meta.height ?? 0,
    };
  } catch {
    throw new AppError(
      "IMAGE_PROCESS_FAILED",
      400,
      "이미지를 처리하지 못했습니다. 다른 사진으로 다시 시도해 주세요.",
    );
  }
}
