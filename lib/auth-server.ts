import "server-only"
import { cookies } from "next/headers"
import { SESSION_COOKIE, LEGACY_COOKIE_NAMES, deserializeUser } from "./auth"
import type { AppUser } from "./types"

/**
 * 服务端读取登录用户。
 *
 * 单 cookie 设计：一个浏览器只允许一个会话。`getCurrentUser(prefer)` 仅在 prefer 与
 * 当前 session 角色不匹配时返回 null —— 这样老师页/学生页能各自精准卡住自己的角色，
 * 防止"老师页面突然变学生"的串台问题。
 */

async function readSession(): Promise<AppUser | null> {
  const store = await cookies()
  // 优先读新 cookie；旧 cookie 仅在老用户尚未重新登录时兜底
  const fresh = deserializeUser(store.get(SESSION_COOKIE)?.value)
  if (fresh) return fresh
  for (const legacy of LEGACY_COOKIE_NAMES) {
    const u = deserializeUser(store.get(legacy)?.value)
    if (u) return u
  }
  return null
}

export async function getCurrentTeacher(): Promise<AppUser | null> {
  const u = await readSession()
  return u && u.role === "teacher" ? u : null
}

export async function getCurrentStudent(): Promise<AppUser | null> {
  const u = await readSession()
  return u && u.role === "student" ? u : null
}

/**
 * `prefer` 在单 session 模式下变成"严格筛选"：
 *   - 不传 → 返回当前 session 用户（任意角色）
 *   - 传 → 仅当 session 角色匹配时返回，否则返回 null
 */
export async function getCurrentUser(
  prefer?: "teacher" | "student",
): Promise<AppUser | null> {
  const u = await readSession()
  if (!u) return null
  if (prefer && u.role !== prefer) return null
  return u
}
