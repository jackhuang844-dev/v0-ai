"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { Sparkles, Activity as ActivityIcon } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { KpiCards, type KpiData } from "./kpi-cards"
import { TaskTable, type TaskRowData } from "./task-table"
import { ClassSwitcher } from "./class-switcher"
import { NewTaskDialog } from "./new-task-dialog"
import { ActivityFeed } from "./activity-feed"
import { useAuth } from "@/components/auth/auth-provider"
import { createClient } from "@/lib/supabase/client"
import { listClasses, listTasksByTeacher, listActivitiesByClass } from "@/lib/db"
import type { ClassInfo, Task, Submission, ActivityEvent } from "@/lib/types"

export function DashboardContent() {
  const { user } = useAuth()
  const [classes, setClasses] = useState<ClassInfo[]>([])
  const [currentClassId, setCurrentClassId] = useState<string>("")
  const [tasks, setTasks] = useState<Task[]>([])
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [activities, setActivities] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)

  // Bootstrap: load classes
  useEffect(() => {
    ;(async () => {
      try {
        const list = await listClasses()
        setClasses(list)
        setCurrentClassId(user?.class_id ?? list[0]?.id ?? "")
      } catch (err) {
        console.error("[v0] list classes error:", err)
      }
    })()
  }, [user])

  // Load tasks for teacher
  const loadTasks = useCallback(async () => {
    if (!user) return
    const list = await listTasksByTeacher(user.id)
    setTasks(list)
    // Load submissions for all of these tasks in one query
    if (list.length > 0) {
      const supabase = createClient()
      const { data } = await supabase
        .from("submissions")
        .select("*")
        .in(
          "task_id",
          list.map((t) => t.id),
        )
      setSubmissions((data ?? []) as Submission[])
    } else {
      setSubmissions([])
    }
    setLoading(false)
  }, [user])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  // Load activities by class
  const loadActivities = useCallback(async () => {
    if (!currentClassId) return
    try {
      const acts = await listActivitiesByClass(currentClassId, 15)
      setActivities(acts)
    } catch (err) {
      console.error("[v0] load activities error:", err)
    }
  }, [currentClassId])

  useEffect(() => {
    loadActivities()
  }, [loadActivities])

  // Realtime: tasks, submissions, activities
  useEffect(() => {
    if (!user) return
    const supabase = createClient()
    const channel = supabase
      .channel(`teacher-feed:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `teacher_id=eq.${user.id}` },
        () => loadTasks(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "submissions" },
        () => loadTasks(),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activities" },
        () => loadActivities(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, loadTasks, loadActivities])

  // Filter tasks to current class
  const taskRows = useMemo<TaskRowData[]>(() => {
    const filtered = currentClassId
      ? tasks.filter((t) => t.class_ids.includes(currentClassId))
      : tasks
    return filtered.map((t) => ({
      task: t,
      submissions: submissions.filter(
        (s) => s.task_id === t.id && (s.class_id === currentClassId || !currentClassId),
      ),
    }))
  }, [tasks, submissions, currentClassId])

  const kpi = useMemo<KpiData>(() => {
    const expected = taskRows.reduce((acc, r) => {
      // For current class only: count students of that class
      const cls = classes.find((c) => c.id === currentClassId)
      if (currentClassId && cls && r.task.class_ids.includes(currentClassId)) {
        return acc + cls.student_count
      }
      return acc + r.task.target_student_count
    }, 0)
    const submittedCount = taskRows.reduce((acc, r) => acc + r.submissions.length, 0)
    const graded = taskRows.reduce(
      (acc, r) => acc + r.submissions.filter((s) => s.status === "graded").length,
      0,
    )
    const gradedSubs = taskRows.flatMap((r) =>
      r.submissions.filter((s) => s.status === "graded" && s.score != null),
    )
    const average =
      gradedSubs.length > 0
        ? gradedSubs.reduce((a, s) => a + (s.score ?? 0), 0) / gradedSubs.length
        : null
    return {
      expected,
      submitted: submittedCount,
      graded,
      averageScore: average,
    }
  }, [taskRows, classes, currentClassId])

  if (!user) return null

  return (
    <div className="px-6 py-6 max-w-[1600px] mx-auto space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">AI 智能学情看板</h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent text-accent-foreground text-[11px] font-medium">
              <Sparkles className="w-3 h-3" />
              AI 驱动
            </span>
          </div>
          <p className="text-sm text-muted-foreground text-pretty">
            {user.name}，欢迎回来。所有数据通过 Supabase 实时同步至学生端
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ClassSwitcher classes={classes} value={currentClassId} onChange={setCurrentClassId} />
          <NewTaskDialog teacher={user} classes={classes} />
        </div>
      </div>

      <KpiCards data={kpi} />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]" id="recent-tasks">
        <TaskTable rows={taskRows} teacherName={user.name} teacherId={user.id} />
        <Card className="self-start">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-1.5">
                  <ActivityIcon className="w-4 h-4 text-primary" />
                  实时动态
                </CardTitle>
                <CardDescription>
                  {classes.find((c) => c.id === currentClassId)?.name ?? "全部班级"} · 实时同步
                </CardDescription>
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] text-[color:var(--success)]">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[color:var(--success)] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[color:var(--success)]"></span>
                </span>
                LIVE
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <ActivityFeed events={activities} loading={loading} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
