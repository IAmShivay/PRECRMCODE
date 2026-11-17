import { Component, ErrorInfo, ReactNode } from 'react';

export type ErrorBoundaryVariant = 'app' | 'page' | 'section';

interface ErrorFallbackRenderProps {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  resetErrorBoundary: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((props: ErrorFallbackRenderProps) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onReset?: () => void;
  resetKeys?: unknown[];
  retryLabel?: string;
  variant?: ErrorBoundaryVariant;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

function createInitialState(): ErrorBoundaryState {
  return {
    hasError: false,
    error: null,
    errorInfo: null,
  };
}

function haveResetKeysChanged(prevResetKeys?: unknown[], nextResetKeys?: unknown[]): boolean {
  const previous = prevResetKeys ?? [];
  const next = nextResetKeys ?? [];

  if (previous.length !== next.length) {
    return true;
  }

  return previous.some((value, index) => !Object.is(value, next[index]));
}

interface DefaultFallbackProps {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  isDev: boolean;
  onRetry: () => void;
  retryLabel: string;
  variant: ErrorBoundaryVariant;
}

function DefaultFallback({
  error,
  errorInfo,
  isDev,
  onRetry,
  retryLabel,
  variant,
}: DefaultFallbackProps) {
  const containerClassName = (() => {
    switch (variant) {
      case 'app':
        return 'min-h-screen bg-white flex items-center justify-center p-6';
      case 'section':
        return 'w-full min-h-[16rem] flex items-center justify-center';
      case 'page':
      default:
        return 'w-full min-h-[50vh] flex items-center justify-center p-4';
    }
  })();

  const description = (() => {
    switch (variant) {
      case 'app':
        return 'The application hit an unexpected error. Try again or reload the page.';
      case 'section':
        return 'This section could not be displayed. Try again.';
      case 'page':
      default:
        return 'This page could not be displayed. Try again or navigate to another screen.';
    }
  })();

  return (
    <div className={containerClassName}>
      <div
        className="w-full max-w-xl rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        <h1 className="text-lg font-semibold text-gray-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-gray-600">{description}</p>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
          >
            {retryLabel}
          </button>
          {variant === 'app' && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Reload page
            </button>
          )}
        </div>

        {isDev && (
          <div className="mt-4 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="break-words font-mono text-xs text-gray-800">{error?.toString()}</p>
            {errorInfo?.componentStack && (
              <pre className="mt-3 whitespace-pre-wrap font-mono text-[11px] text-gray-600">
                {errorInfo.componentStack}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private readonly isDev = import.meta.env.DEV;

  public static defaultProps: Partial<ErrorBoundaryProps> = {
    retryLabel: 'Try again',
    variant: 'page',
  };

  public state: ErrorBoundaryState = createInitialState();

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
    this.setState({ error, errorInfo });
  }

  public componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (
      this.state.hasError &&
      haveResetKeysChanged(prevProps.resetKeys, this.props.resetKeys)
    ) {
      this.resetBoundary();
    }
  }

  private readonly resetBoundary = () => {
    this.setState(createInitialState(), () => {
      this.props.onReset?.();
    });
  };

  public render() {
    if (this.state.hasError) {
      const { fallback, retryLabel = 'Try again', variant = 'page' } = this.props;

      if (typeof fallback === 'function') {
        return fallback({
          error: this.state.error,
          errorInfo: this.state.errorInfo,
          resetErrorBoundary: this.resetBoundary,
        });
      }

      if (fallback) {
        return fallback;
      }

      return (
        <DefaultFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          isDev={this.isDev}
          onRetry={this.resetBoundary}
          retryLabel={retryLabel}
          variant={variant}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
