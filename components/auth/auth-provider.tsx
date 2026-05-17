"use client"

import { createContext, useContext, useState, useCallback } from "react"
import { SESSION_COOKIE, LEGACY_COOKIE_NAMES, AUTH_STORAGE_KEY, type Role } from "@/lib/auth"
import type { AppUser } from "@/lib/types"

interface AuthContextValue {
  user: AppUser | null
  /** 当前页面 layout 锁定的角色（仅用于 UI 判断；权威是 cookie）。 */
  role: Role
  loading: boolean
  /** 客户端 logout：调 /api/auth/logout 让服务端清 cookie，再跳 /login。 */
  logout: () => Promise<void>
  /** 切换账号：等价于 logout，但跳转到 /login?switch=1。 */
  switchAccount: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function clearClientCookies() {
  if (typeof document === "undefined") return
  for (const name of [SESSION_COOKIE, ...LEGACY_COOKIE_NAMES]) {
    document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`
    document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`
  }
}

export function AuthProvider({
  initialUser,
  role,
  children,
}: {
  initialUser: AppUser | null
  /**
   * 当前页面所属的角色作用域：
   * - dashboard layout 传 "teacher"
   * - student layout 传 "student"
   */
  role?: Role
  children: React.ReactNode
}) {
  const resolvedRole: Role = role ?? initialUser?.role ?? "teacher"
  const [user] = useState<AppUser | null>(initialUser)

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } catch {
      // ignore network errors — 客户端清掉 cookie + localStorage 也能登出
    }
    if (typeof window !== "undefined") {
      localStorage.removeItem(AUTH_STORAGE_KEY)
      clearClientCookies()
      window.location.href = "/login"
    }
  }, [])

  const switchAccount = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } catch {}
    if (typeof window !== "undefined") {
      localStorage.removeItem(AUTH_STORAGE_KEY)
      clearClientCookies()
      window.location.href = `/login?switch=1`
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, role: resolvedRole, loading: false, logout, switchAccount }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider")
  return ctx
}
