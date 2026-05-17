import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/client"
import {
  SESSION_COOKIE,
  LEGACY_COOKIE_NAMES,
  serializeUser,
  type Role,
} from "@/lib/auth"
import type { AppUser } from "@/lib/types"

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 天

/**
 * POST /api/auth/login
 * Body: { id: string, password: string, role: "teacher" | "student" }
 *
 * 强校验三件事：
 *   1. id 存在于 app_users
 *   2. 行的 role 与请求 role 完全一致（杜绝学生用老师 id 反之亦然）
 *   3. password 与表内 password 完全一致（demo 模式存明文，生产请换 bcrypt）
 *
 * 校验通过后写入唯一 session cookie 并清除所有历史 cookie。
 */
export async function POST(request: NextRequest) {
  let body: { id?: string; password?: string; role?: Role }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 })
  }

  const { id, password, role } = body
  if (!id || !password || (role !== "teacher" && role !== "student")) {
    return NextResponse.json({ error: "缺少必要字段" }, { status: 400 })
  }

  // 直连 supabase（公开 readable，但密码字段也只对登录场景临时取出后立即比对）
  const sb = createClient()
  const { data, error } = await sb
    .from("app_users")
    .select("id, name, role, subject, class_id, student_no, avatar_color, display_order, password")
    .eq("id", id)
    .maybeSingle()

  if (error) {
    console.error("[v0] login: supabase select failed", error)
    return NextResponse.json({ error: "服务器错误，请稍后重试" }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: "账号不存在" }, { status: 401 })
  }
  if (data.role !== role) {
    return NextResponse.json({ error: "该账号身份不匹配，请切换标签页" }, { status: 401 })
  }
  if (data.password !== password) {
    return NextResponse.json({ error: "密码错误" }, { status: 401 })
  }

  // 不把 password 回写到 cookie / 客户端
  const safeUser: AppUser = {
    id: data.id,
    name: data.name,
    role: data.role,
    subject: data.subject ?? null,
    class_id: data.class_id ?? null,
    student_no: data.student_no ?? null,
    avatar_color: data.avatar_color ?? "#888",
    display_order: data.display_order ?? 0,
  }

  const res = NextResponse.json({ user: safeUser })

  // 写新 cookie
  res.cookies.set(SESSION_COOKIE, serializeUser(safeUser), {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: false, // AuthProvider 客户端会照镜子写 localStorage；非敏感 demo 数据
  })
  // 清掉所有旧 cookie，避免老用户残留干扰中间件
  for (const legacy of LEGACY_COOKIE_NAMES) {
    res.cookies.set(legacy, "", { path: "/", maxAge: 0 })
  }

  return res
}
