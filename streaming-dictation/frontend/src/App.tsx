import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import { api } from './api/client'
import { LoginPage } from './pages/LoginPage'
import { RecordPage } from './pages/RecordPage'
import { HistoryPage } from './pages/HistoryPage'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'
import { Layout } from './components/Layout'
import { LoadingSpinner } from './components/LoadingSpinner'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const authenticated = useAuthStore(s => s.authenticated)

  if (authenticated === null) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />
  }

  return <Layout>{children}</Layout>
}

export default function App() {
  const setAuthenticated = useAuthStore(s => s.setAuthenticated)

  useEffect(() => {
    api.checkSession()
      .then(data => setAuthenticated(data.authenticated))
      .catch(() => setAuthenticated(false))
  }, [setAuthenticated])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <RecordPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/history"
          element={
            <ProtectedRoute>
              <HistoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/search"
          element={
            <ProtectedRoute>
              <SearchPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
