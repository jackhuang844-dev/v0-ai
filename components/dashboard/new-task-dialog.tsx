"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Plus, Sparkles, Clock, Users } from "lucide-react"
import { toast } from "sonner"
import type { ClassInfo, AppUser } from "@/lib/types"

const SUBJECTS = ["数学", "语文", "英语", "物理", "化学", "生物"]

export function NewTaskDialog({
  teacher,
  classes,
}: {
  teacher: AppUser
  classes: ClassInfo[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [title, setTitle] = useState("")
  const [subject, setSubject] = useState("数学")
  const [classIds, setClassIds] = useState<string[]>(() => {
    const initial = teacher.class_id ?? classes[0]?.id
    return initial ? [initial] : []
  })
  const [requirements, setRequirements] = useState("")
  const [notes, setNotes] = useState("")
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  })
  const [dueTime, setDueTime] = useState("22:00")
  const [estimatedMinutes, setEstimatedMinutes] = useState(30)

  const titleError = title.length === 0 ? "请填写作业标题" : title.length > 40 ? "标题最多 40 字" : null
  const reqError = requirements.length === 0 ? "请填写作业要求" : requirements.length > 500 ? "要求最多 500 字" : null
  const classError = classIds.length === 0 ? "至少选择 1 个班级" : null
  const dueDateError = (() => {
    const dueAt = new Date(`${dueDate}T${dueTime}:00`).getTime()
    if (Number.isNaN(dueAt)) return "截止时间无效"
    if (dueAt <= Date.now()) return "截止时间不能早于现在"
    return null
  })()

  const canSubmit = !titleError && !reqError && !classError && !dueDateError && !submitting

  function toggleClass(id: string) {
    setClassIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const dueAt = new Date(`${dueDate}T${dueTime}:00`).toISOString()
      const cleanClassIds = classIds.filter((id): id is string => Boolean(id))
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          subject,
          class_ids: cleanClassIds,
          requirements: requirements.trim(),
          notes: notes.trim() || null,
          due_at: dueAt,
          estimated_minutes: estimatedMinutes,
          teacher_id: teacher.id,
          teacher_name: teacher.name,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "请求失败")
      const totalStudents = classes
        .filter((c) => classIds.includes(c.id))
        .reduce((s, c) => s + c.student_count, 0)
      toast.success("作业已布置", {
        description: `已发送至 ${classIds.length} 个班级 · ${totalStudents} 名学生`,
      })
      // Reset
      setTitle("")
      setRequirements("")
      setNotes("")
      setOpen(false)
      router.refresh()
    } catch (err) {
      console.error("[v0] createTask error:", err)
      toast.error("布置失败，请重试")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-primary hover:bg-primary/90 gap-1.5">
          <Plus className="w-4 h-4" />
          布置新作业
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            布置新作业
          </DialogTitle>
          <DialogDescription>
            作业将自动下发至选定班级所有学生，并通过实时通知触达学习机端
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Title + Subject */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="task-title" className="text-xs">
                作业标题 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="如：三角函数练习题"
                maxLength={40}
              />
              <div className="flex justify-between text-[10px]">
                <span className="text-destructive">{titleError ?? ""}</span>
                <span className="text-muted-foreground tabular-nums">{title.length}/40</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">学科</Label>
              <Select value={subject} onValueChange={setSubject}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBJECTS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Classes */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1">
              <Users className="w-3 h-3" />
              布置班级 <span className="text-destructive">*</span>
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {classes.map((c) => {
                const selected = classIds.includes(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleClass(c.id)}
                    className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                      selected
                        ? "bg-primary/10 border-primary text-primary font-medium"
                        : "bg-background border-border hover:border-primary/40"
                    }`}
                  >
                    {c.name}
                    <span className="ml-1 text-[10px] opacity-70">{c.student_count}人</span>
                  </button>
                )
              })}
            </div>
            {classError && <p className="text-[10px] text-destructive">{classError}</p>}
          </div>

          {/* Requirements */}
          <div className="space-y-1.5">
            <Label htmlFor="task-req" className="text-xs">
              作业要求 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="task-req"
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder="请详细描述作业内容、范围和要求（如：完成教材 P78 第 1-10 题，独立完成）"
              rows={4}
              maxLength={500}
            />
            <div className="flex justify-between text-[10px]">
              <span className="text-destructive">{reqError ?? ""}</span>
              <span className="text-muted-foreground tabular-nums">{requirements.length}/500</span>
            </div>
          </div>

          {/* Due date + time + duration */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">
                截止日期 <span className="text-destructive">*</span>
              </Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">截止时间</Label>
              <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                <Clock className="w-3 h-3" />
                预计时长（分钟）
              </Label>
              <Input
                type="number"
                min={5}
                max={240}
                step={5}
                value={estimatedMinutes}
                onChange={(e) => setEstimatedMinutes(Number(e.target.value) || 30)}
              />
            </div>
          </div>
          {dueDateError && <p className="text-[10px] text-destructive -mt-2">{dueDateError}</p>}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="task-notes" className="text-xs">
              备注 <span className="text-muted-foreground font-normal">（选填，给学生的额外说明）</span>
            </Label>
            <Textarea
              id="task-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="如：第 3 题为附加题，不计入总分；不会的题目可呼出 AI 老师讲解"
              rows={2}
              maxLength={200}
            />
          </div>

          {/* Preview */}
          <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3 text-xs space-y-1">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-3 h-3 text-primary" />
              <span className="font-medium text-primary">下发预览</span>
            </div>
            <p className="text-muted-foreground leading-relaxed">
              将向{" "}
              <span className="text-foreground font-medium">
                {classes
                  .filter((c) => classIds.includes(c.id))
                  .map((c) => c.name)
                  .join("、") || "（请选择班级）"}
              </span>
              {" "}共{" "}
              <span className="text-foreground font-medium">
                {classes
                  .filter((c) => classIds.includes(c.id))
                  .reduce((s, c) => s + c.student_count, 0)}
              </span>{" "}
              名学生下发作业，学习机会实时弹窗通知。
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? "正在下发..." : "确认布置"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
