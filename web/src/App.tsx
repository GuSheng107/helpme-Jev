import { useEffect, useState } from 'react'
import { UNAUTHORIZED_EVENT, ApiError, clearToken, getToken } from './api/client'
import { fetchMe, logout, type UserSummary } from './api/auth'
import AppShell, { type AppPage } from './components/AppShell'
import { ConfirmHost } from './components/confirm'
import { ToastHost } from './components/toast'
import ChangePasswordPage from './pages/ChangePasswordPage'
import ChatPage from './pages/ChatPage'
import DecisionPage from './pages/DecisionPage'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import LogsPage from './pages/LogsPage'
import InvitationsPage from './pages/InvitationsPage'
import PersonaPage from './pages/PersonaPage'
import ScenarioPage from './pages/ScenarioPage'
import SettingsPage from './pages/SettingsPage'
import UsersPage from './pages/UsersPage'

/**
 * 轻量路由（状态机）；页面多了再引入路由库。
 * 登录后统一走左侧导航，默认进首页。
 */
export default function App() {
  const [user, setUser] = useState<UserSummary | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [page, setPage] = useState<AppPage>('home')
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null)

  // 冷启动：有 token 就尝试恢复会话
  useEffect(() => {
    if (!getToken()) {
      setRestoring(false)
      return
    }
    fetchMe()
      .then(setUser)
      .catch((err) => {
        // **只有 401（token 真的失效）才清除本地 token**。
        // 网络抖动 / 后端未起 / 5xx 时保留 token，避免把用户无谓登出。
        if (err instanceof ApiError && err.status === 401) {
          clearToken()
        }
      })
      .finally(() => setRestoring(false))
  }, [])

  // 任意请求 401 → 回到登录态
  useEffect(() => {
    const handle = () => {
      setUser(null)
      setCurrentConversationId(null)
      setPage('home')
    }
    window.addEventListener(UNAUTHORIZED_EVENT, handle)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handle)
  }, [])

  // 这次登录之前的会话没有注册时间，补拉一次
  useEffect(() => {
    if (!user || user.created_at) return
    fetchMe().then(setUser).catch(() => undefined)
  }, [user])

  async function handleLogout() {
    try {
      await logout()
    } catch {
      /* 登出失败也要清本地态 */
    }
    clearToken()
    setUser(null)
    setCurrentConversationId(null)
    setPage('home')
  }

  const shell = (
    <>
      <ToastHost />
      <ConfirmHost />
      {body()}
    </>
  )

  return shell

  function body() {
  if (restoring) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-400">
        加载中…
      </div>
    )
  }

  if (!user) return <LoginPage onAuthenticated={(nextUser) => {
    setPage('home')
    setCurrentConversationId(null)
    setUser(nextUser)
  }} />

  if (user.must_change_password) {
    return <ChangePasswordPage user={user} forced onDone={setUser} />
  }

  return (
    <AppShell page={page} user={user} onNavigate={setPage} onLogout={handleLogout}>
      {page === 'home' && (
        <HomePage
          user={user}
          onNavigate={setPage}
          onOpenConversation={(id) => {
            setCurrentConversationId(id)
            setPage('chat')
          }}
        />
      )}
      {page === 'chat' && (
        <ChatPage
          currentId={currentConversationId}
          setCurrentId={setCurrentConversationId}
          onOpenSettings={() => setPage('settings')}
        />
      )}
      {page === 'decide' && <DecisionPage />}
      {page === 'personas' && <PersonaPage />}
      {page === 'scenarios' && <ScenarioPage />}
      {page === 'logs' && <LogsPage />}
      {page === 'users' && user.role === 'admin' && <UsersPage />}
      {page === 'invitations' && user.role === 'admin' && <InvitationsPage />}
      {page === 'settings' && (
        <SettingsPage user={user} onUserChange={setUser} onLogout={handleLogout} />
      )}
    </AppShell>
  )
  }
}
