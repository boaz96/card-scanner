import { useState } from "react";
import type { ExtractionResult } from "@card-scanner/shared";
import { CameraCapture } from "./components/CameraCapture.js";
import { ReviewForm } from "./components/ReviewForm.js";

/**
 * 앱 루트. 흐름: 촬영/업로드 → 인식(/api/scan) → 검수·수정 폼 → 저장(/api/save).
 */
export function App() {
  const [result, setResult] = useState<ExtractionResult | null>(null);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>명함 스캐너</h1>
        <p className="subtitle">명함을 촬영하면 자동으로 정보를 인식합니다.</p>
      </header>

      {!result ? (
        <CameraCapture onResult={setResult} />
      ) : (
        <ReviewForm result={result} onReset={() => setResult(null)} />
      )}
    </div>
  );
}
