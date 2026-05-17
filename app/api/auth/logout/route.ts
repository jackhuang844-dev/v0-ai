import { NextResponse } from "next/server"
import { SESSION_COOKIE, LEGACY_COOKIE_NAMES } from "@/lib/auth"

/**
 * POST /api/auth/logout
 * 清掉新旧所有会话 cookie。
 */
export async function POST() {
  const res = NextResponse.json({ ok: true })
  for (const name of [SESSION_COOKIE, ...LEGACY_COOKIE_NAMES]) {
    res.cookies.set(name, "", { path: "/", maxAge: 0 })
  }
  return res
}
