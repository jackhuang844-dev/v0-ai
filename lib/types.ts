export type UserRole = "teacher" | "student"

export interface AppUser {
  id: string
  name: string
  role: UserRole
  /** 学科：仅老师有意义（"数学" / "英语"…），学生为 null。 */
  subject?: string | null
  class_id: string | null
  student_no: string | null
  avatar_color: string
  display_order: number
  created_at?: string
}

export interface ClassInfo {
  id: string
  name: string
  grade: string
  student_count: number
  display_order: number
}

export type TaskStatus = "draft" | "active" | "closed"

export interface Task {
  id: string
  title: string
  subject: string
  class_ids: string[]
  requirements: string
  notes: string | null
  due_at: string
  estimated_minutes: number
  teacher_id: string
  teacher_name: string
  status: TaskStatus
  target_student_count: number
  created_at: string
  /** 软删除时间戳。null 或缺失 = 活跃；非空 = 回收站内。 */
  deleted_at?: string | null
}

export type SubmissionStatus = "submitted" | "grading" | "graded"

/** v1 legacy annotation shape (kept for backward compatibility) */
export interface AIIssueAnnotation {
  id: string
  x: number
  y: number
  w: number
  h: number
  type: "error" | "warning"
  message: string
}

/** v2 — bounding box returned by the real AI (4 类型 + 置信度) */
export type AIBboxType = "error" | "partial" | "highlight" | "missing"

export interface AICorrectionDetail {
  id: number
  type: AIBboxType
  question_text: string
  process_analysis: string
  correct_answer?: string
  score_delta?: number
  bounding_box: [number, number, number, number] // [y, x, h, w]
  confidence: number
}

export interface AIRadarAnalysis {
  basics: number
  logic: number
  knowledge: number
  application: number
  presentation: number
}

export interface AIGradingV2 {
  version: 2
  model: string
  graded_subject: "math" | "chinese" | "english" | "generic"
  summary: {
    total_score: number
    correct_count: number
    wrong_count: number
    total_detected_questions: number
    weak_points: string[]
  }
  correction_details: AICorrectionDetail[]
  radar_analysis: AIRadarAnalysis
}

/** ai_issues 字段在 DB 中可以是 v1 数组或 v2 对象 */
export type AIIssuesField = AIIssueAnnotation[] | AIGradingV2

/** weak_points 字段历史上既存过短语，也存过结构化对象，做并集 */
export interface WeakPointObject {
  name?: string
  knowledge?: string
  myScore?: number
  classAverage?: number
  lostPoints?: number
  reason?: string
  mastery?: number
}
export type WeakPointField = string | WeakPointObject

export interface Submission {
  id: string
  task_id: string
  student_id: string
  student_name: string
  class_id: string
  image_urls: string[]
  note: string | null
  status: SubmissionStatus
  score: number | null
  total_score: number
  ai_comment: string | null
  teacher_comment: string | null
  ai_issues: AIIssuesField
  weak_points: WeakPointField[]
  submitted_at: string
  graded_at: string | null
  /**
   * 腾讯云 OCR 转录缓存。
   * 结构见 lib/ocr/tencent.ts:OcrData。重批改时直接复用，避免重复 OCR 调用。
   * 旧数据可能为 null。
   */
  ocr_data?: unknown
}

/* ---- helpers (pure, can be imported from server & client) ---- */

/** v2 判别 */
export function isAIGradingV2(v: unknown): v is AIGradingV2 {
  return (
    !!v && typeof v === "object" && (v as any).version === 2 && Array.isArray((v as any).correction_details)
  )
}

/** 把 v2 的 correction_details 转成 viewer 用的简单 bbox 列表 */
export interface ViewerBox {
  id: string
  /** 0~100 相对坐标 */
  x: number
  y: number
  w: number
  h: number
  type: AIBboxType | "warning" | "error"
  message: string
  /** v2 才有的字段 */
  index?: number
  confidence?: number
  correct_answer?: string
  question_text?: string
}

export function toViewerBoxes(field: AIIssuesField | null | undefined): ViewerBox[] {
  if (!field) return []
  if (isAIGradingV2(field)) {
    return field.correction_details
      .filter((d) => d.confidence >= 0.55 && d.bounding_box?.length === 4)
      .map((d, i) => {
        const [y, x, h, w] = d.bounding_box
        return {
          id: `v2-${d.id ?? i}`,
          x,
          y,
          w,
          h,
          type: d.type,
          index: i + 1,
          confidence: d.confidence,
          correct_answer: d.correct_answer,
          question_text: d.question_text,
          message: d.process_analysis,
        }
      })
  }
  if (Array.isArray(field)) {
    return field.map((d) => ({
      id: d.id,
      x: d.x,
      y: d.y,
      w: d.w,
      h: d.h,
      type: d.type,
      message: d.message,
    }))
  }
  return []
}

/** 归一化 weak_points 到字符串数组 */
export function normalizeWeakPoints(field: WeakPointField[] | null | undefined): string[] {
  if (!field) return []
  return field
    .map((w) => (typeof w === "string" ? w : w?.knowledge ?? w?.name ?? ""))
    .filter(Boolean)
    .slice(0, 3) as string[]
}

export type NotificationType =
  | "new_homework"
  | "reminder"
  | "submission_received"
  | "graded"
  | "system"

export interface AppNotification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  content: string
  related_task_id: string | null
  related_submission_id: string | null
  read: boolean
  urgent: boolean
  created_at: string
}

export type ActivityType =
  | "submit"
  | "view"
  | "graded"
  | "reminder_sent"
  | "new_task"
  | "late_warning"

export interface ActivityEvent {
  id: string
  class_id: string | null
  type: ActivityType
  actor_id: string | null
  actor_name: string | null
  target_id: string | null
  target_name: string | null
  task_id: string | null
  description: string
  metadata: Record<string, any>
  created_at: string
}
