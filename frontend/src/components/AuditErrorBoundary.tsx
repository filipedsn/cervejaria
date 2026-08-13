import { Component, type ErrorInfo, type ReactNode } from 'react';
import { trackUiError } from '../lib/audit-tracker';

type Props = { children: ReactNode; fallback?: ReactNode };

type State = { error: Error | null };

export class AuditErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    trackUiError(error.message, error.stack, {
      componentStack: info.componentStack?.slice(0, 1500),
      boundary: true,
    });
  }

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="p-6 text-center text-red-700" role="alert">
          <p className="font-medium">Algo deu errado nesta tela.</p>
          <p className="mt-2 text-sm text-gray-600">Recarregue a página ou volte ao menu.</p>
          <button
            type="button"
            className="mt-4 rounded bg-gray-800 px-4 py-2 text-white"
            data-audit="error-boundary-reload"
            onClick={() => window.location.reload()}
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
