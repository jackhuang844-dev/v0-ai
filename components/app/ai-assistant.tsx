"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"
import { Sparkles, X, Send, Loader2, BookOpen, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/components/auth/auth-provider"
import { createClient } from "@/lib/supabase/client"
import type { Task } from "@/lib/types"

const QUICK_PROMPTS_GLOBAL = [
  "本周哪些学生需要重点关注？",
  "三角函数章节哪些知识点丢分最多？",
  "给我生成一份本周班级学情周报",
  "哪些学生作业完成率连续下降？",
]

const QUICK_PROMPTS_TASK = [
  "这次作业整体表现如何？",
  "哪些学生这次需要重点辅导？",
  "总结本次作业的高频错误和薄弱知识点",
  "基于本次作业给出一份分层教学建议",
]

function getMessageText(msg: UIMessage): string {
  if (!msg.parts || !Array.isArray(msg.parts)) return ""
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
}

export function AIAssistant() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 教师可选作业列表：登录的老师创建的最近 30 个作业
  useEffect(() => {
    if (!user || user.role !== "teacher") return
    let cancelled = false
    ;(async () => {
      const sb = createClient()
      const { data } = await sb
        .from("tasks")
        .select("*")
        .eq("teacher_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30)
      if (!cancelled && data) setTasks(data as Task[])
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  // 透过 transport.body 把 taskId 传给 /api/chat。
  // selectedTaskId 变化时重建 transport，让最新值随后续 sendMessage 生效。
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({ taskId: selectedTaskId }),
      }),
    [selectedTaskId],
  )

  const { messages, sendMessage, status, error, setMessages } = useChat({ transport })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages])

  // 让侧边栏 / 其他位置可以一键打开对话框
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener("open-ai-assistant", onOpen as EventListener)
    return () => window.removeEventListener("open-ai-assistant", onOpen as EventListener)
  }, [])

  if (!user || user.role !== "teacher") return null

  const isStreaming = status === "streaming" || status === "submitted"
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null
  const quickPrompts = selectedTaskId ? QUICK_PROMPTS_TASK : QUICK_PROMPTS_GLOBAL

  function submit(text: string) {
    const t = text.trim()
    if (!t || isStreaming) return
    sendMessage({ text: t })
    setInput("")
  }

  function handleSelectTask(taskId: string | null) {
    if (taskId === selectedTaskId) return
    setSelectedTaskId(taskId)
    // 切换分析范围会让历史对话语义错配，直接清空更安全
    setMessages([])
  }

  return (
    <>
      {/* 悬浮按钮 */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="AI 教研助手"
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-primary-foreground transition-transform hover:scale-105 active:scale-95"
        style={{
          background: "linear-gradient(135deg, var(--primary), color-mix(in oklch, var(--accent) 80%, var(--primary)))",
        }}
      >
        {open ? <X className="w-5 h-5" /> : <Sparkles className="w-5 h-5 ai-pulse" />}
        {!open ? (
          <span className="absolute inset-0 rounded-full ring-2 ring-primary/30 animate-ping pointer-events-none" />
        ) : null}
      </button>

      {/* 对话窗口 */}
      {open ? (
        <div className="fixed bottom-24 right-6 z-50 w-[min(380px,calc(100vw-2rem))] h-[600px] rounded-2xl border bg-popover shadow-2xl flex flex-col overflow-hidden">
          {/* 头部 */}
          <div className="border-b px-4 py-3 flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-primary-foreground"
              style={{
                background: "linear-gradient(135deg, var(--primary), color-mix(in oklch, var(--accent) 80%, var(--primary)))",
              }}
            >
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm leading-tight">希沃 AI 教研助手</p>
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                在线 · 基于班级学情
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* 分析范围（作业筛选） */}
          <div className="border-b px-4 py-2 flex items-center gap-2 bg-muted/30">
            <span className="text-[11px] text-muted-foreground shrink-0">分析范围</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 gap-1.5 text-xs font-normal flex-1 justify-between max-w-[260px]"
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <BookOpen className="w-3 h-3 shrink-0 text-primary" />
                    <span className="truncate">
                      {selectedTask ? `《${selectedTask.title}》` : "全部作业（最近 8 次）"}
                    </span>
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[280px] max-h-[320px] overflow-y-auto">
                <DropdownMenuLabel className="text-xs">选择要分析的作业</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleSelectTask(null)}
                  className="text-xs gap-2"
                >
                  <Check
                    className={`w-3.5 h-3.5 ${selectedTaskId === null ? "opacity-100" : "opacity-0"}`}
                  />
                  <span className="flex-1">全部作业（最近 8 次聚合）</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {tasks.length === 0 ? (
                  <div className="px-2 py-2 text-[11px] text-muted-foreground">暂无作业</div>
                ) : (
                  tasks.map((t) => (
                    <DropdownMenuItem
                      key={t.id}
                      onClick={() => handleSelectTask(t.id)}
                      className="text-xs gap-2"
                    >
                      <Check
                        className={`w-3.5 h-3.5 shrink-0 ${
                          selectedTaskId === t.id ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{t.title}</div>
                        <div className="text-[10px] text-muted-foreground">{t.subject}</div>
                      </div>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* 对话区 — 原生 overflow-y-auto 让 scrollRef 能直接控制滚动；
              ScrollArea 在动态追加流式消息时会出现自动滚屏失效（实际滚动容器是 Radix 注入的 viewport），所以这里改成原生方案。 */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
            <div className="px-4 py-4 space-y-3">
              {messages.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {selectedTask
                      ? `已锁定本次作业：《${selectedTask.title}》。所有分析将限定在该作业上。`
                      : `你好，${user.name}！我是基于你班级真实学情数据训练的 AI 助手。也可以在上方选择某次作业，让我专门聚焦那次作业的学情。`}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {quickPrompts.map((q) => (
                      <button
                        key={q}
                        onClick={() => submit(q)}
                        className="text-xs px-2.5 py-1.5 rounded-full border border-border bg-muted/40 hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-colors text-left"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive leading-relaxed">
                  <p className="font-medium mb-0.5">AI 助手暂时不可用</p>
                  <p className="text-destructive/80">
                    {String(error.message || error).includes("authentication")
                      ? "未检测到有效的 AI Gateway API Key。请到 Vercel → AI Gateway 控制台创建 vck_ 开头的 Key 并加入项目 Vars。"
                      : String(error.message || error).slice(0, 200)}
                  </p>
                </div>
              ) : null}

              {messages.map((m) => {
                const text = getMessageText(m)
                if (m.role === "user") {
                  return (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-3 py-2 text-sm">
                        {text}
                      </div>
                    </div>
                  )
                }
                return (
                  <div key={m.id} className="flex gap-2">
                    <div
                      className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-primary-foreground"
                      style={{
                        background:
                          "linear-gradient(135deg, var(--primary), color-mix(in oklch, var(--accent) 80%, var(--primary)))",
                      }}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </div>
                    <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
                      {text || (isStreaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "")}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 输入区 */}
          <div className="border-t p-3 flex gap-2 items-end">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                selectedTask
                  ? `就《${selectedTask.title}》提问…  Enter 发送`
                  : "问问 AI…  Enter 发送 / Shift+Enter 换行"
              }
              rows={1}
              className="resize-none text-sm min-h-9 max-h-32"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  submit(input)
                }
              }}
              disabled={isStreaming}
            />
            <Button
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => submit(input)}
              disabled={!input.trim() || isStreaming}
            >
              {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  )
}
