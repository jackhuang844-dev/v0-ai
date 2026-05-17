"use client"

import { ChevronDown, LogOut, RefreshCw, User, Monitor, Moon, Sun, Palette, Check } from "lucide-react"
import { useTheme } from "next-themes"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/components/auth/auth-provider"

export function UserMenu() {
  const { user, logout, switchAccount } = useAuth()
  const { theme, setTheme } = useTheme()
  if (!user) return null
  const sub =
    user.role === "teacher"
      ? `${user.subject ?? "学科"} · 教师`
      : `学号 ${user.student_no ?? "—"}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-md hover:bg-muted transition-colors">
          <Avatar className="w-7 h-7">
            <AvatarFallback
              className="text-white text-xs"
              style={{ backgroundColor: user.avatar_color }}
            >
              {user.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="hidden md:flex flex-col leading-tight items-start">
            <span className="text-xs font-medium">{user.name}</span>
            <span className="text-[10px] text-muted-foreground">{sub}</span>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="text-xs font-medium">{user.name}</span>
            <span className="text-[10px] text-muted-foreground font-normal">
              {user.role === "teacher" ? "教师端" : "学生端"}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <User className="w-3.5 h-3.5" />
          账号设置
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette className="w-3.5 h-3.5" />
            外观
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-36">
            <DropdownMenuItem onClick={() => setTheme("light")}>
              <Sun className="w-3.5 h-3.5" />
              <span className="flex-1">浅色</span>
              {theme === "light" && <Check className="w-3.5 h-3.5" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}>
              <Moon className="w-3.5 h-3.5" />
              <span className="flex-1">深色</span>
              {theme === "dark" && <Check className="w-3.5 h-3.5" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}>
              <Monitor className="w-3.5 h-3.5" />
              <span className="flex-1">跟随系统</span>
              {theme === "system" && <Check className="w-3.5 h-3.5" />}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onClick={switchAccount}>
          <RefreshCw className="w-3.5 h-3.5" />
          切换账号
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onClick={logout}>
          <LogOut className="w-3.5 h-3.5" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
