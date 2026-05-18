import { generateObject } from "ai"
import { head } from "@vercel/blob"
import type { Submission, Task } from "@/lib/types"
import {
  buildGradeSystemPrompt,
  buildGradeUserPrompt,
  resolveSubject,
} from "./prompts"
import { GradingResultSchema, type GradingResult } from "./schemas"
import { AI_MODELS, GRADING_TIMEOUT_MS, GRADING_MAX_OUTPUT_TOKENS } from "./config"
import { resolveModel } from "./gateway"
import {
  ocrSubmission,
  buildTranscriptForLLM,
  findLineByIndex,
  type OcrData,
} from "@/lib/ocr/tencent"
import { autoDeskewSubmissionImages } from "@/lib/image/deskew"

/**
 * 从 Blob 拉取图片字节，转成 AI SDK 6 可以直接喂的 data URL。
 * 即使是 public store，仍然集中走 fetch + base64，这样:
 *  1) 可以保证图片字节稳定存在再送 LLM（提交后立即批改也不会 race）；
 *  2) 不暴露 blob 域名到 LLM provider 的访问日志里。
 */
async function fetchBlobAsDataUrl(pathnameOrUrl: string): Promise<string> {
  // 兼容历史 public URL：直接返回，让 AI SDK 自己抓
  if (/^https?:\/\//i.test(pathnameOrUrl)) return pathnameOrUrl

  const meta = await head(pathnameOrUrl)
  if (!meta?.url) throw new Error(`图片不存在: ${pathnameOrUrl}`)
  const res = await fetch(meta.url)
  if (!res.ok) throw new Error(`图片读取失败: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const base64 = buf.toString("base64")
  const mime = meta.contentType || "image/jpeg"
  return `data:${mime};base64,${base64}`
}

export interface AIGradePayload {
  /** 0~100 归一化得分 */
  score: number
  /** 评语（来自 AI） */
  ai_comment: string
  /** weak_points 短语数组 */
  weak_points: string[]
  /** 完整 AI 结果（视觉框 + radar + summary） */
  ai_issues: {
    version: 2
    model: string
    graded_subject: ReturnType<typeof resolveSubject>
    summary: GradingResult["summary"]
    correction_details: GradingResult["correction_details"]
    radar_analysis: GradingResult["radar_analysis"]
  }
  /**
   * 本次批改使用的 OCR 数据。
   * 调用方应把它写入 submissions.ocr_data 字段，下次重批改可复用避免重复 OCR。
   * 当 OCR 服务调用失败时为 null（仍能跑通批改，只是 bbox 退化到 VLM fallback）。
   */
  ocr_data: OcrData | null
  /**
   * 若发生了纠偏（|检测角| > 阈值），返回旋转回正后的新图 Blob 路径。
   * 调用方应将其写回 submissions.image_urls，让前端展示与 bbox 完全对齐。
   * 没纠偏则为 null。
   */
  rotated_image_urls: string[] | null
}

/**
 * 调用 AI Gateway 进行真实批改。
 * 单卷批改与批量批改共用此函数。
 *
 * - System 提示词稳定不变，便于 Anthropic prompt caching。
 * - 用 generateObject + Zod schema 强制结构化输出，避免 JSON 解析失败。
 * - 内置超时控制，防止模型卡死阻塞批量任务。
 */
export async function gradeSubmissionWithAI(
  submission: Submission,
  task: Task,
  options?: {
    /** 已有的 OCR 缓存。提供则跳过 OCR 调用直接复用，省钱省时。 */
    cachedOcrData?: OcrData | null
  },
): Promise<AIGradePayload> {
  const subject = resolveSubject(task.subject)
  let imageUrls = (submission.image_urls ?? []).slice(0, 9)
  if (imageUrls.length === 0) {
    throw new Error("学生未上传任何作业图片，无法批改")
  }

  /* ----------------- 阶段 1：OCR 转录（或复用缓存） ----------------- */
  let ocrData: OcrData | null = options?.cachedOcrData ?? null
  let rotatedImageUrls: string[] | null = null

  if (!ocrData) {
    try {
      console.log("[v0] grade: running OCR on", imageUrls.length, "image(s)")
      ocrData = await ocrSubmission(imageUrls)
      const totalLines = ocrData.pages.reduce((s, p) => s + p.lines.length, 0)
      const maxAbsAngle = Math.max(
        ...ocrData.pages.map((p) => Math.abs(p.angle ?? 0)),
        0,
      )
      console.log(
        "[v0] grade: OCR done, total lines =",
        totalLines,
        "max |angle| =",
        maxAbsAngle.toFixed(2),
      )

      /* ---------- 自动纠偏：|角度| > 2° 时旋转回正再重新 OCR ---------- */
      if (maxAbsAngle > 2) {
        try {
          console.log("[v0] grade: image is skewed, running deskew pipeline")
          const deskewed = await autoDeskewSubmissionImages(
            imageUrls,
            ocrData.pages.map((p) => p.angle ?? 0),
          )
          if (deskewed.length === imageUrls.length) {
            rotatedImageUrls = deskewed
            imageUrls = deskewed
            console.log("[v0] grade: re-running OCR on deskewed images")
            ocrData = await ocrSubmission(imageUrls)
            const totalLines2 = ocrData.pages.reduce((s, p) => s + p.lines.length, 0)
            console.log("[v0] grade: post-deskew OCR done, lines =", totalLines2)
          }
        } catch (e: any) {
          console.error(
            "[v0] grade: deskew failed, continuing with original tilted image:",
            e?.message,
          )
        }
      }
    } catch (e: any) {
      console.error("[v0] grade: OCR failed, falling back to VLM-only:", e?.message)
      ocrData = null
    }
  } else {
    console.log("[v0] grade: using cached OCR data")
  }
  const ocrTranscript = ocrData ? buildTranscriptForLLM(ocrData) : ""

  /* ----------------- 阶段 2：构造 prompt ----------------- */
  const system = buildGradeSystemPrompt(subject)
  const userText = buildGradeUserPrompt({
    subject,
    taskTitle: task.title,
    taskRequirements: task.requirements,
    taskNotes: task.notes,
    totalScore: 100,
    studentName: submission.student_name,
    studentNote: submission.note,
    imageCount: imageUrls.length,
    ocrTranscript,
  })

  // 把每张私有图片转成 base64 data URL，再喂给视觉模型
  const dataUrls = await Promise.all(imageUrls.map((p) => fetchBlobAsDataUrl(p)))

  const userContent: Array<
    { type: "text"; text: string } | { type: "image"; image: URL | string }
  > = [{ type: "text", text: userText }]
  for (const u of dataUrls) userContent.push({ type: "image", image: u })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GRADING_TIMEOUT_MS)

  try {
    const gradingModel = resolveModel(AI_MODELS.grading)
    let object: GradingResult
    try {
      const result = await generateObject({
        model: gradingModel,
        schema: GradingResultSchema,
        maxOutputTokens: GRADING_MAX_OUTPUT_TOKENS,
        system,
        messages: [
          {
            role: "user",
            content: userContent,
            // providerOptions 由 AI Gateway 透传到 Anthropic 实现 prompt caching
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral" } },
            },
          },
        ],
        abortSignal: controller.signal,
        maxRetries: 1,
      })
      object = result.object
    } catch (e: any) {
      // generateObject 不会跑我们 schema 上的 z.preprocess（它直接调底层 validate）。
      // Claude 在输出长 JSON 时偶尔会把嵌套数组序列化为字符串，导致 AI_TypeValidationError。
      // 此时从 e.cause.value 拿到原始对象，用 schema.parse() 走我们的 preprocess 修复。
      const rawValue =
        e?.cause?.value ?? e?.value ?? e?.cause?.text ?? e?.text ?? null
      const looksLikeValidationError =
        e?.name === "AI_TypeValidationError" ||
        e?.cause?.name === "ZodError" ||
        (e?.message ?? "").includes("response did not match schema")
      if (!looksLikeValidationError || rawValue == null) {
        throw e
      }
      console.warn("[v0] grade: AI returned stringified nested JSON, recovering via Zod preprocess")
      const candidate = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue
      const parsed = GradingResultSchema.safeParse(candidate)
      if (!parsed.success) {
        console.error("[v0] grade: manual reparse also failed:", parsed.error.issues)
        throw e
      }
      object = parsed.data
    }

    const scaledScore = Math.max(0, Math.min(100, object.summary.total_score))

    /* ----------------- 阶段 3：把 line_indexes 解析成真实 bbox ----------------- */
    const resolvedDetails = resolveCorrectionBboxes(object.correction_details, ocrData)

    return {
      score: scaledScore,
      ai_comment: object.teacher_comment,
      weak_points: object.summary.weak_points,
      ai_issues: {
        version: 2,
        model: AI_MODELS.grading,
        graded_subject: subject,
        summary: object.summary,
        correction_details: resolvedDetails,
        radar_analysis: object.radar_analysis,
      },
      ocr_data: ocrData,
      rotated_image_urls: rotatedImageUrls,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 把 LLM 返回的 line_indexes（OCR 行号数组）解析成真实 bbox。
 *
 * 规则：
 * 1. 若 line_indexes 至少有 1 个有效行号 → bbox = 这些行 OCR bbox 的并集（取外接矩形）+ 4% 内边距，让框稍微贴一点四周；
 * 2. 若 line_indexes 全部无效但 fallback bounding_box 存在 → 用 fallback，并跑老的"超大框"过滤；
 * 3. 否则丢弃该条批注。
 *
 * 同时为每条 detail 补齐 page_index（取首个命中行所在页）。
 */
function resolveCorrectionBboxes(
  details: GradingResult["correction_details"],
  ocrData: OcrData | null,
): GradingResult["correction_details"] {
  const MAX_W = 90
  const MAX_H = 25
  const PADDING = 1 // 百分比内边距

  const out: GradingResult["correction_details"] = []
  for (const d of details) {
    let bbox: [number, number, number, number] | null = null
    let pageIndex: number | undefined = d.page_index

    // ---- 优先：line_indexes 路径 ----
    if (ocrData && d.line_indexes && d.line_indexes.length > 0) {
      const hits = d.line_indexes
        .map((i) => findLineByIndex(ocrData, i))
        .filter((x): x is NonNullable<typeof x> => x !== null)

      if (hits.length > 0) {
        const firstPage = hits[0]!.pageIndex
        const samePageHits = hits.filter((h) => h.pageIndex === firstPage)

        let yMin = 100,
          yMax = 0,
          xMin = 100,
          xMax = 0
        for (const h of samePageHits) {
          const [y, x, hh, w] = h.line.bbox
          yMin = Math.min(yMin, y)
          yMax = Math.max(yMax, y + hh)
          xMin = Math.min(xMin, x)
          xMax = Math.max(xMax, x + w)
        }
        yMin = Math.max(0, Math.round(yMin - PADDING))
        xMin = Math.max(0, Math.round(xMin - PADDING))
        const h = Math.min(100 - yMin, Math.round(yMax - yMin + PADDING * 2))
        const w = Math.min(100 - xMin, Math.round(xMax - xMin + PADDING * 2))
        if (h > 0 && w > 0) {
          bbox = [yMin, xMin, h, w]
          pageIndex = firstPage
        }
      }
    }

    // ---- 备选：fallback bounding_box ----
    if (!bbox && d.bounding_box && d.bounding_box.length === 4) {
      const [yy, xx, hh, w] = d.bounding_box
      if (hh > 0 && w > 0 && w <= MAX_W && hh <= MAX_H) {
        bbox = [yy, xx, hh, w] as [number, number, number, number]
        if (pageIndex === undefined) pageIndex = 0
      }
    }

    if (!bbox) {
      console.log("[v0] grade: drop detail (no resolvable bbox), id=", d.id)
      continue
    }

    out.push({
      ...d,
      bounding_box: bbox,
      page_index: pageIndex ?? 0,
    })
  }
  return out
}

/**
 * 简单的并发限流：limit 个 worker 并行处理 items。
 * 抛错的 item 会作为 { ok: false, error } 进入结果，不会中断整个批次。
 */
export async function pMapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: Error }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: Error }> = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) break
      try {
        const value = await worker(items[idx]!, idx)
        results[idx] = { ok: true, value }
      } catch (e: any) {
        results[idx] = { ok: false, error: e instanceof Error ? e : new Error(String(e)) }
      }
    }
  })
  await Promise.all(runners)
  return results
}
