import { useEffect, useState } from 'react'
import { UNAUTHORIZED_EVENT, clearToken, getToken } from './api/client'
import { fetchMe, logout, type UserSummary } from './api/auth'
import ChangePasswordPage from './pages/ChangePasswordPage'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'

/**
 * P0 阶段用三态路由（登录 / 强制改密 / 主页），页面多了再引入路由库。
 */
export default function App() {
  const [user, setUser] = useState<UserSummary | null>(null)
  const [restoring, setRestoring] = useState(true)

  // 冷启动：有 token 就尝试恢复会话
  useEffect(() => {
    if (!getToken()) {
      setRestoring(false)
      return
    }
    fetchMe()
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setRestoring(false))
  }, [])

  // 任意请求 401 → 回到登录态
  useEffect(() => {
    const handle = () => setUser(null)
    window.addEventListener(UNAUTHORIZED_EVENT, handle)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handle)
  }, [])

  async function handleLogout() {
    try {
      await logout()
    } catch {
      /* 登出失败也要清本地态 */
    }
    clearToken()
    setUser(null)
  }

  if (restoring) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-400">
        加载中…
      </div>
    )
  }

  if (!user) return <LoginPage onAuthenticated={setUser} />

  if (user.must_change_password) {
    return <ChangePasswordPage user={user} forced onDone={setUser} />
  }

  return <HomePage user={user} onLogout={handleLogout} />
}
