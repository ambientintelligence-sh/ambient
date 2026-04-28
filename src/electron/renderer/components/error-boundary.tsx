import { Component, type ErrorInfo, type ReactNode } from "react";
import { rlog } from "../lib/renderer-log";

type Props = {
  tag: string;
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    rlog("ERROR", `${this.props.tag} render error: ${error.message}`, {
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground">
        <div className="text-sm font-medium">Something went wrong</div>
        <pre className="max-h-48 max-w-full overflow-auto whitespace-pre-wrap rounded-sm border border-border bg-muted/40 px-3 py-2 text-2xs text-muted-foreground">
          {error.message}
        </pre>
        <button
          type="button"
          onClick={this.reset}
          className="h-7 rounded-md bg-foreground/[0.08] px-3 text-xs hover:bg-foreground/[0.14]"
        >
          Try again
        </button>
      </div>
    );
  }
}
