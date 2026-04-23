import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'

const NAV_ITEMS = [
  { path: '/', label: 'Record' },
  { path: '/history', label: 'History' },
  { path: '/search', label: 'Search' },
  { path: '/settings', label: 'Settings' }
]

function NavLink({ path, label, active }: { path: string; label: string; active: boolean }) {
  return (
    <Link
      to={path}
      className={`flex items-center justify-center min-h-[48px] px-2 text-sm font-medium transition-colors ${
        active
          ? 'text-blue-600 border-b-2 border-blue-600 md:border-b-0 md:border-l-2 md:border-blue-400 md:bg-slate-700 md:text-white'
          : 'text-slate-500 hover:text-slate-800 md:text-slate-300 md:hover:bg-slate-700 md:hover:text-white'
      }`}
    >
      {label}
    </Link>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const setAuthenticated = useAuthStore(s => s.setAuthenticated)

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)

  const handleLogout = async () => {
    try { await api.logout() } catch { /* ignore */ }
    setAuthenticated(false)
    navigate('/login')
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-slate-50">
      {/* ── Top bar ── */}
      <header className="bg-slate-800 text-white px-4 py-3 flex items-center justify-between sticky top-0 z-40 shadow-md">
        <h1 className="text-base font-semibold tracking-tight">Voice Dictation</h1>
        {/* Desktop nav in header area */}
        <nav className="hidden md:flex items-center gap-1" aria-label="Main navigation">
          {NAV_ITEMS.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                isActive(item.path)
                  ? 'bg-slate-600 text-white'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              {item.label}
            </Link>
          ))}
          <button
            onClick={handleLogout}
            className="ml-2 px-3 py-1.5 text-sm text-slate-300 hover:text-white transition-colors"
          >
            Logout
          </button>
        </nav>
        {/* Mobile logout */}
        <button
          onClick={handleLogout}
          className="md:hidden text-xs text-slate-300 hover:text-white px-2 py-1 rounded min-h-[44px] flex items-center"
        >
          Logout
        </button>
      </header>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
        {children}
      </main>

      {/* ── Bottom nav (mobile only) ── */}
      <nav
        className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex md:hidden z-40 safe-bottom"
        aria-label="Mobile navigation"
      >
        {NAV_ITEMS.map(item => (
          <NavLink key={item.path} path={item.path} label={item.label} active={isActive(item.path)} />
        ))}
      </nav>
    </div>
  )
}
