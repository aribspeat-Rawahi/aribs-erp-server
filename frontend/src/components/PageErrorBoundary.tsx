import { Component, ErrorInfo, ReactNode } from 'react';
import { reportCrash } from '../api/reportCrash';

// Catches a crash inside ONE page so the rest of the app (sidebar, top bar)
// keeps working instead of the whole screen going blank. Reset whenever the
// user navigates (see `resetKey`).
interface Props {
  children: ReactNode;
  resetKey: string;
}

interface State {
  error: Error | null;
}

export default class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PageErrorBoundary]', error, info.componentStack);
    reportCrash(error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="max-w-lg mx-auto mt-12 bg-white border border-black/10 rounded-xl p-6 text-center">
        <h1 className="text-lg font-semibold text-ink mb-2">This page couldn&apos;t be displayed</h1>
        <p className="text-sm text-muted mb-4">
          Something went wrong while loading this page. You can use the menu to open another page, or try again.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-brand-500 hover:bg-brand-600 text-ink text-sm font-medium px-4 py-2 rounded-lg"
        >
          Try again
        </button>
        <p className="mt-4 text-[11px] text-muted/80 break-words">Details: {this.state.error.message}</p>
      </div>
    );
  }
}
