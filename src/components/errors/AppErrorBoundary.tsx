import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, House, RotateCcw } from 'lucide-react'

import { reportClientError } from '../../services/clientTelemetry'

type Props = { children: ReactNode }
type State = { failed: boolean }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void reportClientError(error, {
      eventType: 'react_error_boundary',
      componentStack: info.componentStack,
    })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="app-error-boundary" role="alert">
        <AlertTriangle aria-hidden="true" size={28} />
        <h1>页面暂时无法显示</h1>
        <p>系统已记录匿名故障指纹，未上传提示词或页面内容。请重新加载，或返回首页继续操作。</p>
        <div>
          <button type="button" onClick={() => window.location.reload()}>
            <RotateCcw size={16} />
            重新加载
          </button>
          <button type="button" onClick={() => { window.location.hash = 'home'; window.location.reload() }}>
            <House size={16} />
            返回首页
          </button>
        </div>
      </main>
    )
  }
}
