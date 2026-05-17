import { NextResponse, type NextRequest } from "next/server"
import { SESSION_COOKIE, LEGACY_COOKIE_NAMES, deserializeUser } from "@/lib/auth"

const PUBLIC_PATHS = ["/login", "/api/auth"]

/**
 * 单 session 路由策略：
 *
 * - 当前浏览器只有一个 session（cookie），中间件按 session.role 强制路由：
 *   - session 是 teacher → 只能进 /dashboard/**；进 /student/** 直接跳 /dashboard
 *   - session 是 student → 只能进 /student/**；进 /dashboard/** 直接跳 /student
 *
 * - /                  → 未登录跳 /login，已登录按 role 跳对应首页
 * - /login             → 已登录直接跳对应首页（除非 ?switch=1）
 *
 * 旧 cookie 仍兼容读取，避免老用户被卡死。
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 读 session：新 cookie 优先，旧 cookie 兜底
  let user = deserializeUser(request.cookies.get(SESSION_COOKIE)?.value)
  if (!user) {
    for (const legacy of LEGACY_COOKIE_NAMES) {
      const u = deserializeUser(request.cookies.get(legacy)?.value)
      if (u) {
        user = u
        break
      }
    }
  }

  // Root redirect
  if (pathname === "/") {
    const url = request.nextUrl.clone()
    if (!user) url.pathname = "/login"
    else url.pathname = user.role === "teacher" ? "/dashboard" : "/student"
    return NextResponse.redirect(url)
  }

  // 公共路径：/login + /api/auth/*
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const isSwitchIntent =
      request.nextUrl.searchParams.get("switch") === "1" ||
      request.nextUrl.searchParams.has("redirect")
    if (user && pathname === "/login" && !isSwitchIntent) {
      const url = request.nextUrl.clone()
      url.pathname = user.role === "teacher" ? "/dashboard" : "/student"
      return NextResponse.redirect(url)
    }
    return NextResponse.next()
  }

  // 老师区
  if (pathname.startsWith("/dashboard")) {
    if (!user) {
      const url = request.nextUrl.clone()
      url.pathname = "/login"
      url.searchParams.set("redirect", pathname)
      url.searchParams.set("role", "teacher")
      return NextResponse.redirect(url)
    }
    if (user.role !== "teacher") {
      // 当前 session 是学生 → 强制踢到学生区，避免身份串台
      const url = request.nextUrl.clone()
      url.pathname = "/student"
      return NextResponse.redirect(url)
    }
    return NextResponse.next()
  }

  // 学生区
  if (pathname.startsWith("/student")) {
    if (!user) {
      const url = request.nextUrl.clone()
      url.pathname = "/login"
      url.searchParams.set("redirect", pathname)
      url.searchParams.set("role", "student")
      return NextResponse.redirect(url)
    }
    if (user.role !== "student") {
      const url = request.nextUrl.clone()
      url.pathname = "/dashboard"
      return NextResponse.redirect(url)
    }
    return NextResponse.next()
  }

  // 其它路径需登录
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("redirect", pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|images|manifest.webmanifest|icon-|api/health).*)",
  ],
}
