import { Component, type ErrorInfo, type ReactNode } from 'react';
import { BrandMark } from '../shell/BrandMark';

/** Keep a rendering failure recoverable without clearing sessions or chat drafts. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Crewly could not render the workspace', error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="onboarding"><div className="onboarding-body"><div className="onboarding-card auth-card form" role="alert">
      <div className="auth-brand"><BrandMark />Crewly</div>
      <h1>Let’s reopen your workspace</h1>
      <p>This screen ran into a problem. Reload to try again. Your saved conversations stay on the server.</p>
      <button className="primary-button" onClick={() => window.location.reload()}>Reload Crewly</button>
    </div></div></main>;
  }
}
