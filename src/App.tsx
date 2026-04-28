import { ToastProvider } from './components/ui/Toast'
import { AppShell } from './components/layout/AppShell'

export default function App() {
  return (
    <ToastProvider>
      <AppShell/>
    </ToastProvider>
  )
}
