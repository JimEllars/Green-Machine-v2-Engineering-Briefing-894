import React from 'react';
import SafeIcon from './SafeIcon';

class ComponentErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // You can also log the error to an error reporting service
    console.error("ErrorBoundary caught an error", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleRetry() {
    this.setState({ hasError: false, error: null, errorInfo: null });
  }

  render() {
    if (this.state.hasError) {
      // Sleek fallback card showing error telemetry
      return (
        <div className="bg-zinc-900/80 backdrop-blur-xl border border-rose-500/50 shadow-2xl rounded-xl p-6 h-full flex flex-col items-center justify-center text-center">
          <div className="bg-rose-500/10 p-4 rounded-full mb-4">
             <SafeIcon name="AlertTriangle" className="w-8 h-8 text-rose-500" />
          </div>
          <h3 className="text-white font-bold text-lg mb-2">Component Fault</h3>
          <p className="text-zinc-400 text-sm mb-4 max-w-md">
            An internal error occurred in this diagnostic module. Background telemetry has logged the failure.
          </p>

          {this.state.error && (
            <div className="w-full text-left bg-black/50 border border-rose-900 rounded p-3 mb-6 max-h-32 overflow-y-auto">
               <pre className="text-rose-400 text-[10px] font-mono break-all whitespace-pre-wrap">
                 {this.state.error.toString()}
               </pre>
            </div>
          )}

          <button
            onClick={this.handleRetry}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold transition-colors flex items-center gap-2"
          >
            <SafeIcon name="RefreshCw" className="w-4 h-4" />
            Retry Component
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ComponentErrorBoundary;
