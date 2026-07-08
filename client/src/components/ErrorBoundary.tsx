import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * 기본 에러 바운더리.
 * 렌더 트리에서 예기치 못한 예외가 나면 앱 전체가 흰 화면이 되는 대신
 * 복구 안내 화면을 보여줍니다.
 */

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 운영 환경에서는 여기서 원격 로깅으로 전송
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="app-shell" role="alert">
          <h1>문제가 발생했어요</h1>
          <p className="subtitle">
            일시적인 오류일 수 있어요. 아래 버튼으로 다시 시작해 주세요.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            새로고침
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
