/**
 * 클라이언트 이미지 전처리.
 * - 업로드 전에 장변 기준 1600px 로 리사이즈해 업로드 용량을 최적화합니다.
 * - 밝기(저조도)·선명도(흐림)를 간단히 분석해 사용자 경고를 생성합니다.
 * - 모든 계산은 canvas 에서 수행하며, 분석은 성능을 위해 축소본에서 진행합니다.
 * - createImageBitmap 미지원(구형 iOS Safari 등) 시 HTMLImageElement 로 폴백합니다.
 */

/** 업로드 이미지 장변 최대 픽셀 */
export const MAX_EDGE = 1600;
/** JPEG 업로드 품질 */
const UPLOAD_QUALITY = 0.9;
/** 품질 분석용 축소본 장변(작을수록 빠름) */
const ANALYZE_EDGE = 320;

/** 경고 임계값(휴리스틱, 실사용 데이터로 튜닝 권장) */
const BRIGHTNESS_MIN = 70; // 0~255 평균 밝기. 미만이면 저조도
const SHARPNESS_MIN = 80; // 라플라시안 분산. 미만이면 흐림 의심

export interface ImageQuality {
  /** 0~255 평균 밝기 */
  brightness: number;
  /** 라플라시안 분산(선명도 지표, 클수록 선명) */
  sharpness: number;
}

export interface ProcessedImage {
  /** 서버 업로드용 리사이즈 JPEG */
  blob: Blob;
  /** 화면 미리보기용 data URL */
  previewUrl: string;
  width: number;
  height: number;
  quality: ImageQuality;
  /** 사용자에게 보여줄 경고 메시지(저조도/흐림 등) */
  warnings: string[];
}

/** canvas 에 그릴 수 있는 이미지 소스 래퍼(ImageBitmap 또는 HTMLImageElement) */
interface Drawable {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/** Blob/File → Drawable. createImageBitmap 우선, 미지원 시 <img> 폴백 */
async function loadDrawable(blob: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob, {
        imageOrientation: "from-image",
      });
      return {
        source: bmp,
        width: bmp.width,
        height: bmp.height,
        close: () => bmp.close(),
      };
    } catch {
      // 옵션 미지원 등 → 폴백으로 진행
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
      image.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** 장변 maxEdge 로 축소한 캔버스를 반환(확대는 하지 않음) */
function drawResized(
  d: Drawable,
  maxEdge: number,
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const longEdge = Math.max(d.width, d.height);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  const width = Math.max(1, Math.round(d.width * scale));
  const height = Math.max(1, Math.round(d.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D 컨텍스트를 생성할 수 없습니다.");
  ctx.drawImage(d.source, 0, 0, width, height);
  return { canvas, width, height };
}

/** 캔버스 → Blob(Promise 래핑) */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("이미지 인코딩에 실패했습니다.")),
      type,
      quality,
    );
  });
}

/** 밝기 + 선명도 분석 (축소본 기준) */
function analyzeQuality(d: Drawable): ImageQuality {
  const { canvas } = drawResized(d, ANALYZE_EDGE);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D 컨텍스트를 생성할 수 없습니다.");
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);

  // 1) 그레이스케일 + 평균 밝기
  const gray = new Float32Array(width * height);
  let brightnessSum = 0;
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4] ?? 0;
    const g = data[i * 4 + 1] ?? 0;
    const b = data[i * 4 + 2] ?? 0;
    // Rec.601 루마
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = luma;
    brightnessSum += luma;
  }
  const brightness = brightnessSum / (width * height);

  // 2) 라플라시안 분산(선명도). 커널 [0,1,0; 1,-4,1; 0,1,0]
  let lapSum = 0;
  let lapSqSum = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const c = gray[idx] ?? 0;
      const up = gray[idx - width] ?? 0;
      const down = gray[idx + width] ?? 0;
      const left = gray[idx - 1] ?? 0;
      const right = gray[idx + 1] ?? 0;
      const lap = up + down + left + right - 4 * c;
      lapSum += lap;
      lapSqSum += lap * lap;
      count++;
    }
  }
  const mean = count > 0 ? lapSum / count : 0;
  const sharpness = count > 0 ? lapSqSum / count - mean * mean : 0;

  return { brightness, sharpness };
}

/** 품질 지표 → 사용자 경고 메시지 */
function buildWarnings(quality: ImageQuality): string[] {
  const warnings: string[] = [];
  if (quality.brightness < BRIGHTNESS_MIN) {
    warnings.push("조명이 어두워요. 더 밝은 곳에서 다시 촬영하면 인식률이 올라갑니다.");
  }
  if (quality.sharpness < SHARPNESS_MIN) {
    warnings.push("이미지가 흐릿할 수 있어요. 초점을 맞추고 흔들리지 않게 다시 촬영해 보세요.");
  }
  return warnings;
}

/**
 * 촬영/선택된 이미지를 업로드용으로 전처리.
 * @param source 카메라 캡처 Blob 또는 업로드 File
 */
export async function processImage(source: Blob): Promise<ProcessedImage> {
  const drawable = await loadDrawable(source);
  try {
    const { canvas, width, height } = drawResized(drawable, MAX_EDGE);
    const blob = await canvasToBlob(canvas, "image/jpeg", UPLOAD_QUALITY);
    const previewUrl = canvas.toDataURL("image/jpeg", 0.7);
    const quality = analyzeQuality(drawable);
    const warnings = buildWarnings(quality);
    return { blob, previewUrl, width, height, quality, warnings };
  } finally {
    drawable.close();
  }
}
