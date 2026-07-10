import { useEffect, useRef, useState } from "react";
import type { ExtractionResult } from "@card-scanner/shared";
import { useCamera } from "../hooks/useCamera.js";
import { processImage, type ProcessedImage } from "../lib/imageProcessing.js";
import { scanCard } from "../lib/api.js";

/**
 * 명함 촬영/업로드 화면.
 * 흐름: (live) 카메라 프리뷰 또는 파일 업로드 → 촬영/선택 → (preview) 미리보기·경고
 *        → "재촬영" 또는 "인식하기"(→ /api/scan) → onResult 로 결과 전달.
 */

type Phase = "live" | "preview";

interface Props {
  onResult: (result: ExtractionResult) => void;
}

export function CameraCapture({ onResult }: Props) {
  const { videoRef, status, errorMessage, start, stop, capture } = useCamera();
  const [phase, setPhase] = useState<Phase>("live");
  const [processed, setProcessed] = useState<ProcessedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 마운트 시 카메라 시작(권한 요청). 언마운트 시 useCamera 가 정리.
  useEffect(() => {
    void start();
    return () => stop();
    // start/stop 은 useCallback 으로 안정적
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toMessage(e: unknown): string {
    return e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
  }

  async function ingest(source: Blob) {
    setBusy(true);
    setErrorText(null);
    try {
      const result = await processImage(source);
      setProcessed(result);
      setPhase("preview");
      stop(); // 미리보기 동안 카메라 해제(배터리/발열 절감)
    } catch (e) {
      setErrorText(toMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleCapture() {
    try {
      const raw = await capture();
      await ingest(raw);
    } catch (e) {
      setErrorText(toMessage(e));
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void ingest(file);
    e.target.value = ""; // 같은 파일 재선택 허용
  }

  function handleRetake() {
    setProcessed(null);
    setErrorText(null);
    setPhase("live");
    void start();
  }

  async function handleRecognize() {
    if (!processed) return;
    setBusy(true);
    setErrorText(null);
    try {
      const result = await scanCard(processed.blob);
      onResult(result);
      console.log(result);
    } catch (e) {
      setErrorText(toMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const cameraUnavailable = status === "denied" || status === "unsupported" || status === "error";

  return (
    <div className="capture">
      {phase === "live" && (
        <>
          <div className="camera-frame">
            {/* 비디오는 카메라 사용 가능 시 항상 마운트해 두어야 videoRef 가 존재하고
                start() 가 스트림(srcObject)을 붙일 수 있음(검은 화면 방지). */}
            {!cameraUnavailable && (
              <video
                ref={videoRef}
                className="camera-video"
                autoPlay
                muted
                playsInline
              />
            )}
            {(status === "idle" || status === "starting") && (
              <p className="hint">카메라를 준비하는 중…</p>
            )}
            {cameraUnavailable && (
              <div className="camera-fallback-msg">
                <p>{errorMessage}</p>
              </div>
            )}
            {/* 명함 정렬 가이드 프레임 */}
            {status === "ready" && <div className="guide-box" aria-hidden />}
          </div>

          <div className="actions">
            {status === "ready" && (
              <button
                type="button"
                className="btn btn-primary btn-shutter"
                onClick={handleCapture}
                disabled={busy}
              >
                {busy ? "처리 중…" : "촬영"}
              </button>
            )}

            {/* 파일 업로드 폴백 — 항상 제공(카메라 불가 시 강조) */}
            <label className={cameraUnavailable ? "btn btn-primary" : "btn btn-ghost"}>
              사진 업로드
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
                hidden
              />
            </label>
          </div>
        </>
      )}

      {phase === "preview" && processed && (
        <>
          <div className="preview-frame">
            <img className="preview-img" src={processed.previewUrl} alt="촬영한 명함 미리보기" />
          </div>

          {processed.warnings.length > 0 && (
            <ul className="warnings" role="alert">
              {processed.warnings.map((w) => (
                <li key={w} className="warning">⚠️ {w}</li>
              ))}
            </ul>
          )}

          <p className="meta">
            {processed.width}×{processed.height}px · 밝기 {Math.round(processed.quality.brightness)} ·
            선명도 {Math.round(processed.quality.sharpness)}
          </p>

          <div className="actions">
            <button type="button" className="btn btn-ghost" onClick={handleRetake} disabled={busy}>
              재촬영
            </button>
            <button type="button" className="btn btn-primary" onClick={handleRecognize} disabled={busy}>
              {busy ? "인식 중…" : "인식하기"}
            </button>
          </div>
        </>
      )}

      {errorText && <p className="error-text" role="alert">{errorText}</p>}
    </div>
  );
}
