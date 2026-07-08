import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 후면 카메라(getUserMedia, facingMode:"environment") 생명주기 관리 훅.
 * - 지원 여부/권한 거부를 상태로 구분해, 화면에서 파일 업로드 폴백으로 전환할 수 있게 합니다.
 * - 언마운트 시 스트림 트랙을 반드시 정리합니다.
 */

export type CameraStatus =
  | "idle" // 아직 시작 안 함
  | "starting" // 권한 요청/스트림 준비 중
  | "ready" // 프리뷰 재생 중
  | "denied" // 사용자가 권한 거부
  | "unsupported" // 브라우저/기기 미지원 또는 카메라 없음
  | "error"; // 기타 오류

export interface UseCamera {
  videoRef: React.RefObject<HTMLVideoElement>;
  status: CameraStatus;
  errorMessage: string | null;
  start: () => Promise<void>;
  stop: () => void;
  /** 현재 프리뷰 프레임을 원본 해상도 JPEG Blob 으로 캡처 */
  capture: () => Promise<Blob>;
}

export function useCamera(): UseCamera {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    setErrorMessage(null);

    // 비보안 컨텍스트(HTTP)에서는 getUserMedia 가 막혀 카메라를 쓸 수 없음(localhost 제외)
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setStatus("unsupported");
      setErrorMessage(
        "보안 연결(HTTPS)에서만 카메라를 사용할 수 있어요. 사진 업로드를 이용하거나 https 로 접속해 주세요.",
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      setErrorMessage("이 브라우저는 카메라를 지원하지 않습니다. 파일로 업로드해 주세요.");
      return;
    }

    setStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" }, // 후면 카메라 우선
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute("playsinline", "true"); // iOS 인라인 재생
        // play()는 best-effort: muted+playsinline 이라 대개 성공하지만,
        // 실패하더라도 스트림은 붙어있으므로 카메라를 error 로 떨구지 않음
        void video.play().catch(() => undefined);
      }
      setStatus("ready");
    } catch (err: unknown) {
      // 권한 거부 / 카메라 없음 등 구분
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setStatus("denied");
        setErrorMessage("카메라 접근이 거부되었습니다. 파일 업로드로 진행하거나 권한을 허용해 주세요.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setStatus("unsupported");
        setErrorMessage("사용 가능한 카메라를 찾지 못했습니다. 파일로 업로드해 주세요.");
      } else {
        setStatus("error");
        setErrorMessage("카메라를 시작하지 못했습니다. 파일로 업로드해 주세요.");
      }
    }
  }, []);

  const capture = useCallback(async (): Promise<Blob> => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      throw new Error("카메라 프리뷰가 준비되지 않았습니다.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D 컨텍스트를 생성할 수 없습니다.");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("캡처 이미지 생성에 실패했습니다.")),
        "image/jpeg",
        0.95,
      );
    });
  }, []);

  // 언마운트 시 스트림 정리
  useEffect(() => stop, [stop]);

  return { videoRef, status, errorMessage, start, stop, capture };
}
