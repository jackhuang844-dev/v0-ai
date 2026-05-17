"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  GraduationCap,
  Sparkles,
  ArrowRight,
  Users,
  BookOpen,
  ShieldCheck,
  Loader2,
  KeyRound,
  Eye,
  EyeOff,
  Check,
} from "lucide-react"
import type { AppUser } from "@/lib/types"

/**
 * 公开页面入口。
 *
 * Next.js 16 + Turbopack 要求 useSearchParams() 必须在 Suspense 内。
 *
 * UI 设计：
 *   - 顶部 Tabs 强制选择"教师端 / 学生端"，账号也只展示对应角色 → 杜绝串台
 *   - 测试账号卡片直接显示账号 ID 和密码，点击卡片自动填表
 *   - 登录走 /api/auth/login，由服务端校验 role+password 后通过 Set-Cookie 写入
 */
export function LoginCard({
  teachers,
  students,
}: {
  teachers: AppUser[]
  students: AppUser[]
}) {
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginCardInner teachers={teachers} students={students} />
    </Suspense>
  )
}

function LoginShell() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-6">
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        正在加载登录页…
      </div>
    </div>
  )
}

function LoginCardInner({
  teachers,
  students,
}: {
  teachers: AppUser[]
  students: AppUser[]
}) {
  const search = useSearchParams()
  const initialRole: "teacher" | "student" = search.get("role") === "student" ? "student" : "teacher"

  const [role, setRole] = useState<"teacher" | "student">(initialRole)
  const [accountId, setAccountId] = useState("")
  const [password, setPassword] = useState("")
  const [showPwd, setShowPwd] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 切换 tab 时清空表单 + 错误
  useEffect(() => {
    setAccountId("")
    setPassword("")
    setError(null)
  }, [role])

  const accounts = role === "teacher" ? teachers : students
  const defaultPassword = role === "teacher" ? "teacher123" : "student123"

  function pickAccount(user: AppUser) {
    setAccountId(user.id)
    setPassword(defaultPassword)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError(null)

    if (!accountId || !password) {
      setError("请选择账号并输入密码")
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: accountId, password, role }),
      })
      const json = (await res.json().catch(() => ({}))) as { user?: AppUser; error?: string }
      if (!res.ok || !json.user) {
        setError(json.error ?? "登录失败")
        setSubmitting(false)
        return
      }
      // 客户端镜像，便于 AuthProvider 立即 hydrate
      try {
        localStorage.setItem("sewise_current_user", JSON.stringify(json.user))
      } catch {
        // ignore
      }
      const redirect = search.get("redirect")
      const target =
        redirect && redirect !== "/login"
          ? redirect
          : json.user.role === "teacher"
            ? "/dashboard"
            : "/student"
      window.location.href = target
    } catch (err: any) {
      console.error("[v0] login network error:", err)
      setError("网络错误，请稍后重试")
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-6">
      <div className="w-full max-w-5xl grid lg:grid-cols-[1fr_1.2fr] gap-8 items-center">
        {/* Left: brand intro */}
        <div className="space-y-6 lg:pr-6">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5" />
            希沃魔方数字基座
          </div>
          <div>
            <h1 className="text-4xl lg:text-5xl font-bold tracking-tight text-balance leading-tight">
              AI 智能学情
              <br />
              <span className="text-primary">伴学分析系统</span>
            </h1>
            <p className="mt-4 text-muted-foreground text-pretty leading-relaxed">
              从作业布置 → 学生提交 → AI 批阅 → 个性化反馈，一站式打通教学闭环。
              所有操作通过 Supabase 实时同步，老师与学生的真实联动一目了然。
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 max-w-md">
            <FeatureChip icon={<BookOpen className="w-4 h-4" />} label="作业管理" />
            <FeatureChip icon={<Sparkles className="w-4 h-4" />} label="AI 批阅" />
            <FeatureChip icon={<Users className="w-4 h-4" />} label="学情洞察" />
          </div>
          <div className="hidden lg:flex items-start gap-2 text-xs text-muted-foreground pt-4 border-t border-border/60">
            <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span className="leading-relaxed">
              强制账号分离：一个浏览器仅允许登录一个账号。
              如需同时测试两端，请在第二个浏览器或无痕窗口登录另一端账号。
            </span>
          </div>
        </div>

        {/* Right: login card */}
        <Card className="p-6 lg:p-8 border-border/60 shadow-xl bg-card/95 backdrop-blur">
          <div className="space-y-1 mb-5">
            <h2 className="text-xl font-semibold">账号密码登录</h2>
            <p className="text-sm text-muted-foreground">
              点击下方测试账号自动填入用户名 / 密码
            </p>
          </div>

          <Tabs value={role} onValueChange={(v) => setRole(v as "teacher" | "student")}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="teacher" className="gap-1.5">
                <GraduationCap className="w-3.5 h-3.5" />
                教师端
              </TabsTrigger>
              <TabsTrigger value="student" className="gap-1.5">
                <BookOpen className="w-3.5 h-3.5" />
                学生端
              </TabsTrigger>
            </TabsList>

            <TabsContent value="teacher" className="mt-4 space-y-4">
              <DemoAccountList
                accounts={accounts}
                activeId={accountId}
                onPick={pickAccount}
                role="teacher"
              />
            </TabsContent>
            <TabsContent value="student" className="mt-4 space-y-4">
              <DemoAccountList
                accounts={accounts}
                activeId={accountId}
                onPick={pickAccount}
                role="student"
              />
            </TabsContent>
          </Tabs>

          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="account" className="text-xs">
                账号 ID
              </Label>
              <Input
                id="account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder={role === "teacher" ? "例如 teacher_b" : "例如 student_001"}
                autoComplete="username"
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs">
                密码
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={defaultPassword}
                  autoComplete="current-password"
                  disabled={submitting}
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                  aria-label={showPwd ? "隐藏密码" : "显示密码"}
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            ) : null}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  登录中…
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  登录{role === "teacher" ? "教师端" : "学生端"}
                </>
              )}
            </Button>
          </form>

          <p className="mt-5 pt-4 border-t border-border/60 text-[11px] text-muted-foreground leading-relaxed">
            所有测试账号的数据通过 Supabase 真实保存：登录后布置作业、提交、批阅会被
            另一端账号实时接收。生产环境请改用强密码 + 加盐 hash。
          </p>
        </Card>
      </div>
    </div>
  )
}

function FeatureChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border/60">
      <span className="text-primary">{icon}</span>
      <span className="text-xs font-medium">{label}</span>
    </div>
  )
}

function DemoAccountList({
  accounts,
  activeId,
  onPick,
  role,
}: {
  accounts: AppUser[]
  activeId: string
  onPick: (u: AppUser) => void
  role: "teacher" | "student"
}) {
  const password = role === "teacher" ? "teacher123" : "student123"
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] text-muted-foreground">
          测试账号 · 共 {accounts.length} 个
        </div>
        <Badge variant="outline" className="text-[10px] font-mono">
          密码: {password}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {accounts.map((u) => {
          const active = u.id === activeId
          const sub =
            role === "teacher"
              ? `${u.subject ?? "学科"}老师`
              : `学号 ${u.student_no ?? "—"}`
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => onPick(u)}
              className={`group relative h-auto py-2.5 px-3 rounded-md border text-left transition-all ${
                active
                  ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                  : "border-border hover:border-primary/40 hover:bg-muted/40"
              }`}
            >
              {active ? (
                <Check className="absolute top-1.5 right-1.5 w-3.5 h-3.5 text-primary" />
              ) : (
                <ArrowRight className="absolute top-1/2 -translate-y-1/2 right-2 w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
              <div className="flex items-center gap-2.5 pr-4">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white font-medium text-xs shrink-0"
                  style={{ backgroundColor: u.avatar_color }}
                >
                  {u.name.slice(0, 1)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{u.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{sub}</div>
                  <div className="text-[10px] font-mono text-muted-foreground/80 truncate mt-0.5">
                    {u.id}
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
