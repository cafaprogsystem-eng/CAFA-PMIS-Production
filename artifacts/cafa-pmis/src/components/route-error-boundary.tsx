import { Component, type ReactNode, type ErrorInfo } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/ui/error-state";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Functional inner component that renders the translated error UI.
 * The outer class component cannot use hooks directly, so we delegate
 * the rendered output to this pure function component.
 */
function ErrorFallback({ onReload }: { onReload: () => void }) {
  const { t } = useTranslation("errors");
  return (
    <ErrorState
      variant="server"
      title={t("crashTitle")}
      description={t("crashDesc")}
      onRetry={onReload}
      retryLabel={t("crashAction")}
      className="min-h-[60vh]"
    />
  );
}

/**
 * RouteErrorBoundary
 *
 * Wraps the authenticated route tree so a render-time crash in a single page
 * shows a recoverable error card instead of blanking the entire application.
 * The AppLayout shell (sidebar + header) remains mounted above this boundary,
 * so the user can navigate away without reloading.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the console so it's visible in dev tools / logs.
    console.error("[RouteErrorBoundary] Uncaught render error:", error, info);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onReload={this.handleReload} />;
    }

    return this.props.children;
  }
}
