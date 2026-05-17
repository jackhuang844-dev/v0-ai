import type { AppUser } from "./types"

/**
 * 强制单会话：一个浏览器只允许登录一个账号。
 *
 * 历史上为了"老师/学生在同一浏览器并存演示"用过双 cookie（teacher/student 各一），
 * 但路由切换瞬间会出现读到另一边 cookie → 老师页面突然变成学生（或反之）。
 * 现在统一回归单 cookie，多端测试时请用两个浏览器/无痕窗口。
 */
export const SESSION_COOKIE = "sewise_session"

/** 历史 cookie 名，登录时一并清掉，避免老 cookie 干扰服务端读取。 */
export const LEGACY_COOKIE_NAMES = [
  "sewise_session_user",
  "sewise_session_teacher",
  "sewise_session_student",
] as const

/** 客户端镜像（仅做即时 hydrate；权威来源是 cookie）。 */
export const AUTH_STORAGE_KEY = "sewise_current_user"

export type Role = "teacher" | "student"

/* ----------------------------- 序列化 ----------------------------- */

export function serializeUser(user: AppUser): string {
  return encodeURIComponent(JSON.stringify(user))
}

export function deserializeUser(raw: string | undefined | null): AppUser | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(decodeURIComponent(raw))
    if (parsed && typeof parsed === "object" && parsed.id && parsed.role) {
      return parsed as AppUser
    }
  } catch {
    // ignore
  }
  return null
}
