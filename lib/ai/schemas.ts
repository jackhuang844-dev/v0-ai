import { z } from "zod"

/**
 * 兼容 LLM 偶尔把数组/对象序列化成字符串的情形（Claude 在输出长 JSON 时偶发，
 * 尤其是 Opus 4.7 在 max_output_tokens 较高时也观察到该现象）。
 * 把 `[ {...}, {...} ]` 这种字符串自动解析为真实数组；其它情况原样返回。
 */
function parseMaybeJsonString<T>(val: unknown): unknown {
  if (typeof val !== "string") return val
  const trimmed = val.trim()
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return val
  try {
    return JSON.parse(trimmed)
  } catch {
    return val
  }
}

/* ============================== 单卷批改结果 ============================== */

export const BboxTypeEnum = z.enum(["error", "partial", "highlight", "missing"])
export type BboxType = z.infer<typeof BboxTypeEnum>

/**
 * Visual Grounding 框
 * bounding_box = [y, x, h, w]，单位是图片 0~100 相对坐标
 */
export const CorrectionDetailSchema = z.object({
  id: z.number().int().describe("从 1 开始递增"),
  type: BboxTypeEnum.describe("error=错；partial=半对；highlight=亮点；missing=漏做"),
  question_text: z.string().min(1).max(200).describe("简要题干或学生原句，不要超过 100 字"),
  process_analysis: z.string().min(1).max(600).describe("名师解析。要具体到步骤 / 公式 / 词汇"),
  correct_answer: z.string().max(400).optional().describe("正确做法 / 正确答案 / 正确句子；可选"),
  score_delta: z
    .number()
    .int()
    .min(-100)
    .max(100)
    .optional()
    .describe("该项相对满分的扣分或加分（错题给负数，亮点给 0 或正数）"),
  /**
   * 该批注覆盖的 OCR 行号（全局唯一，对应 buildTranscriptForLLM 输出里的 L1/L2/...）。
   * 服务端会把这些行号对应的真实 OCR bbox 取并集，得到该批注的最终位置框。
   */
  line_indexes: z.preprocess(
    parseMaybeJsonString,
    z
      .array(z.number().int().min(1))
      .min(1)
      .max(20)
      .describe("批注命中的 OCR 行号数组，至少 1 个；服务端据此合成 bbox"),
  ),
  /**
   * （可选）模型自行估算的 fallback bbox，仅当 line_indexes 全部找不到时使用。
   * [y, x, h, w] 单位 0~100。
   *
   * 注意这里**故意不用 z.tuple**：tuple 在 JSON Schema 里会变成
   * `items: [obj, obj, obj, obj]` 的数组形式，而 Anthropic 直连 API 强制要求
   * `items` 必须是单个 object schema，否则报
   * `output_config.format.schema: Invalid schema: Array types must be specified
   * with a single object schema for 'items'`。改用定长 array 即可两边都通过。
   */
  bounding_box: z
    .array(z.number())
    .length(4)
    .optional()
    .describe("可选 fallback bbox [y,x,h,w]，单位 0~100（line_indexes 优先）"),
  /** （可选）页码索引，0-based；默认 0，多页提交时模型必须明确 */
  page_index: z.number().int().min(0).optional().describe("0-based 页码"),
  confidence: z.number().min(0).max(1).describe("整体置信度"),
})
export type CorrectionDetail = z.infer<typeof CorrectionDetailSchema>

export const RadarAnalysisSchema = z
  .object({
    basics: z.number().int().min(0).max(100).describe("计算与基础"),
    logic: z.number().int().min(0).max(100).describe("逻辑思维"),
    knowledge: z.number().int().min(0).max(100).describe("知识掌握"),
    application: z.number().int().min(0).max(100).describe("应用能力"),
    presentation: z.number().int().min(0).max(100).describe("书写规范"),
  })
  .describe("五维度评分")
export type RadarAnalysis = z.infer<typeof RadarAnalysisSchema>

export const GradingSummarySchema = z.object({
  total_score: z.number().int().min(0).max(100).describe("学生最终得分（满分按 100 归一）"),
  correct_count: z.number().int().min(0),
  wrong_count: z.number().int().min(0),
  total_detected_questions: z.number().int().min(0),
  weak_points: z.preprocess(
    parseMaybeJsonString,
    z.array(z.string().min(2).max(30)).min(0).max(3).describe("1~3 个核心薄弱知识点短语"),
  ),
})
export type GradingSummary = z.infer<typeof GradingSummarySchema>

export const GradingResultSchema = z.object({
  summary: z.preprocess(parseMaybeJsonString, GradingSummarySchema),
  correction_details: z.preprocess(
    parseMaybeJsonString,
    z.array(CorrectionDetailSchema).max(40),
  ),
  teacher_comment: z
    .string()
    .min(60)
    .max(2400)
    .describe(
      "整体学情评语，单一字符串、不含换行。必须严格按四段式结构串联，且必须完整收尾（绝对不能在句子中途结束）：" +
        "(1) 开头用 [姓名]同学，… 一句温暖肯定（约 60-100 字）； " +
        "(2) 用'但目前存在 N 个核心问题需要重点突破：'起头，然后用'第一，xxx。…'、'第二，xxx。…'、'第三，xxx。…'分别列出 2~3 条核心问题（每条 80-150 字，先一句短标题再展开）； " +
        "(3) 用'建议接下来这样做：'起头给出 1~3 条可执行行动（每条 30-60 字）； " +
        "(4) 必须以一句完整的鼓励收尾，例如'相信下次作业一定会有明显进步！'。" +
        "禁止省略'第一/第二/第三'这类序号词，禁止用'第1题/第2题'代替（题号请放进具体描述里）。" +
        "总字数控制在 500-900 字之间，绝对不要在第二、第三个核心问题中途因长度截断 — " +
        "若内容过多，应主动精简每条问题的展开描述，但四段结构与鼓励收尾必须完整存在。",
    ),
  radar_analysis: z.preprocess(parseMaybeJsonString, RadarAnalysisSchema),
})
export type GradingResult = z.infer<typeof GradingResultSchema>

/* ============================== 班级学情报告 ============================== */

export const ScoreDistributionSchema = z.object({
  excellent: z.number().int().min(0).describe("90~100 分人数"),
  good: z.number().int().min(0).describe("75~89 分人数"),
  pass: z.number().int().min(0).describe("60~74 分人数"),
  fail: z.number().int().min(0).describe("0~59 分人数"),
})

export const TopWeakPointSchema = z.object({
  name: z.string().min(2).max(30),
  student_count: z.number().int().min(0),
  severity: z.enum(["high", "mid", "low"]),
  intervention: z.string().min(10).max(300),
})

export const TieredAdviceSchema = z.object({
  top_tier: z.string().min(10).max(400).describe("优等生拔高建议"),
  mid_tier: z.string().min(10).max(400).describe("中等生巩固建议"),
  need_help: z.string().min(10).max(400).describe("后进生帮扶建议，列出具体学生姓名"),
})

export const ClassReportSchema = z.object({
  summary: z.string().min(20).max(500),
  score_distribution: ScoreDistributionSchema,
  top_weak_points: z.array(TopWeakPointSchema).min(0).max(3),
  tiered_advice: TieredAdviceSchema,
  next_action: z.string().min(5).max(60),
})
export type ClassReport = z.infer<typeof ClassReportSchema>
