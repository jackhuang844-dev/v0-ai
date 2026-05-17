"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  ClipboardList,
  Sparkles,
  GraduationCap,
} from "lucide-react"
import { cn } from "@/lib/utils"

type NavItem = {
  label: string
  href: string
  icon: typeof LayoutDashboard
}

const mainNav: NavItem[] = [
  { label: "学情看板", href: "/dashboard", icon: LayoutDashboard },
]

export function AppSidebar() {
  const pathname = usePathname()

  function handleOpenAssistant() {
    if (typeof window === "undefined") return
    window.dispatchEvent(new CustomEvent("open-ai-assistant"))
  }

  function handleScrollToTasks(e: React.MouseEvent<HTMLAnchorElement>) {
    if (typeof window === "undefined") return
    if (pathname !== "/dashboard") return // 让 Link 自然导航过去
    e.preventDefault()
    const el = document.getElementById("recent-tasks")
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 border-r border-sidebar-border bg-sidebar">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-sidebar-border">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-primary-foreground">
          <GraduationCap className="w-5 h-5" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-sidebar-foreground">希沃智教</span>
          <span className="text-[11px] text-muted-foreground">AI 学情工作台</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="px-2 mb-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          主功能
        </div>
        <ul className="flex flex-col gap-0.5">
          {mainNav.map((item) => {
            const active =
              item.href === "/dashboard"
                ? pathname === "/dashboard" ||
                  pathname.startsWith("/dashboard/tasks") ||
                  pathname.startsWith("/dashboard/grading")
                : pathname.startsWith(item.href)
            return (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/60",
                  )}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>

        <div className="mt-6 px-2 mb-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          快捷操作
        </div>
        <ul className="flex flex-col gap-0.5">
          <li>
            <button
              type="button"
              onClick={handleOpenAssistant}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors text-sidebar-foreground hover:bg-sidebar-accent/60 text-left"
            >
              <Sparkles className="w-4 h-4 shrink-0 text-primary" />
              <span className="truncate">打开 AI 助教</span>
            </button>
          </li>
          <li>
            <Link
              href="/dashboard#recent-tasks"
              onClick={handleScrollToTasks}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors text-sidebar-foreground hover:bg-sidebar-accent/60"
            >
              <ClipboardList className="w-4 h-4 shrink-0" />
              <span className="truncate">跳到作业列表</span>
            </Link>
          </li>
        </ul>
      </nav>

      {/* Footer card */}
      <div className="m-3 p-3 rounded-lg border border-sidebar-border bg-sidebar-accent/40">
        <div className="flex items-center gap-2 mb-1.5">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-medium text-sidebar-foreground">AI 助教</span>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          点击右下角悬浮按钮开始智能问答，或一键生成讲评建议
        </p>
      </div>
    </aside>
  )
}
