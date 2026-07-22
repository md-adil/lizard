"use client";

// A real React error boundary — still has to be a class component, there is
// no hook-based equivalent. Use this to isolate a failure to one item in a
// list (e.g. one dashboard panel) instead of letting it crash the whole
// route; Next's file-based error.tsx is segment-level and can't do that.
import { Component, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: (error: Error, reset: () => void) => ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div className="flex flex-col items-center justify-center gap-2 h-full p-4 text-center">
        <TriangleAlert className="size-5" style={{ color: "var(--destructive)" }} />
        <p className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
          Something went wrong rendering this.
        </p>
        <button className="tag" style={{ color: "var(--primary)", borderColor: "var(--primary)" }} onClick={this.reset}>
          Retry
        </button>
      </div>
    );
  }
}
