import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ToastProvider } from './components/ui/Toast'
import { AppShell } from './components/layout/AppShell'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Register from './pages/Register'
import { isLoggedIn } from './lib/auth'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return isLoggedIn() ? <>{children}</> : <Navigate to="/login" replace/>
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Landing/>}/>
          <Route path="/login" element={<Login/>}/>
          <Route path="/register" element={<Register/>}/>
          <Route path="/app" element={
            <ProtectedRoute>
              <AppShell/>
            </ProtectedRoute>
          }/>
          <Route path="*" element={<Navigate to="/" replace/>}/>
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  )
}
