import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/** A broken optional view must not take the conversation and navigation down. */
export class ViewErrorBoundary extends Component<{ children: ReactNode; resetKey: string; title?: string; onClose?: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error('Crewly view failed', error); }
  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="view-recovery" role="alert">
      <span className="view-recovery-icon"><AlertTriangle size={20} /></span>
      <h3>{this.props.title ?? 'This view could not be displayed'}</h3>
      <p>Your workspace is still open. Try this view again or choose another section.</p>
      <button className="secondary-button" onClick={() => this.setState({ failed: false })}><RefreshCw size={15} />Try again</button>
      {this.props.onClose && <button className="text-button" onClick={this.props.onClose}>Close view</button>}
    </div>;
  }
}
