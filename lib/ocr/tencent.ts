/**
 * 腾讯云 OCR 客户端
 * -------------------------------------------------------------
 * 用途：把学生作业图片转写成"行级文本 + 行级真实坐标"列表，
 *      给批改 pipeline 提供两样东西：
 *        1) 行号化纯文本（喂给 LLM，让 LLM 只判断"哪一行有错"）
 *        2) 每一行在原图上的真实 bbox（前端画框时直接用，避免 VLM 估坐标）
 *
 * 接口：GeneralHandwritingOCR（通用印刷体 + 中文手写体识别）
 *      文档 https://cloud.tencent.com/document/product/866/36212
 *      每月 1000 次免费额度，¥0.025/次。
 *
 * 限制：单张图片 base64 ≤ 7MB、像素 ≤ 8192×8192。
 *      上传链路前端已经把图压到 ≤ 4MB / 长边 2400px，不会超限。
 */

import { ocr } from "tencentcloud-sdk-nodejs-ocr"
import { imageSize } from "image-size"
import { head } from "@vercel/blob"

const OcrClient = ocr.v20181119.Client

/* ----------------------------- 类型 ----------------------------- */

export interface OcrLine {
  /** 全局行号，从 1 开始（多张图片跨页连续递增） */
  index: number
  text: string
  /** [y, x, h, w]，每个值为 0~100 整数百分比 */
  bbox: [number, number, number, number]
  /** 0~1 置信度 */
  confidence: number
}

export interface OcrPage {
  image_url: string
  /** 原图像素宽 */
  width: number
  /** 原图像素高 */
  height: number
  /** 整图相对于水平方向的旋转角（腾讯云返回值，单位度，正负表示方向） */
  angle?: number
  lines: OcrLine[]
}

export interface OcrData {
  version: 1
  provider: "tencent"
  ocrd_at: string
  pages: OcrPage[]
}

/* ----------------------------- 单例 client ----------------------------- */

let _client: InstanceType<typeof OcrClient> | null = null

function getClient(): InstanceType<typeof OcrClient> {
  if (_client) return _client
  const SecretId = process.env.TENCENT_SECRET_ID
  const SecretKey = process.env.TENCENT_SECRET_KEY
  if (!SecretId || !SecretKey) {
    throw new Error(
      "[ocr] 缺少环境变量 TENCENT_SECRET_ID / TENCENT_SECRET_KEY，请在项目设置 Vars 里配置",
    )
  }
  _client = new OcrClient({
    credential: { secretId: SecretId, secretKey: SecretKey },
    region: "ap-shanghai",
    profile: { httpProfile: { reqTimeout: 60 } },
  })
  return _client
}

/* ----------------------------- 工具函数 ----------------------------- */

function clampPct(v: number, min = 0, max = 100): number {
  const n = Math.round(v)
  if (n < min) return min
  if (n > max) return max
  return n
}

/**
 * 抓图字节 — 用于解析像素尺寸 + 转 base64。
 * 兼容两种输入：
 *  - Blob pathname（项目里的常规情况）：走 head() 拿真实 url 后 fetch
 *  - 公网 HTTPS URL（历史数据或外部链接）：直接 fetch
 */
async function fetchImageBuffer(pathnameOrUrl: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(pathnameOrUrl)) {
    const res = await fetch(pathnameOrUrl)
    if (!res.ok) throw new Error(`fetch image failed: ${res.status} ${pathnameOrUrl}`)
    return Buffer.from(await res.arrayBuffer())
  }

  const meta = await head(pathnameOrUrl)
  if (!meta?.url) {
    throw new Error(`blob not found: ${pathnameOrUrl}`)
  }
  const res = await fetch(meta.url)
  if (!res.ok) throw new Error(`fetch blob failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/* ----------------------------- 单页 OCR ----------------------------- */

/**
 * 对单张图做手写体 OCR。
 * @param imageUrl  公网可访问的图片 URL（Vercel Blob 即可）
 * @param baseLineIndex 多页时上一页结束的行号，本页从 baseLineIndex+1 开始编号
 * @returns 单页结果 + 全局下一个起点
 */
export async function ocrOnePage(
  imageUrl: string,
  baseLineIndex: number,
): Promise<{ page: OcrPage; nextBaseIndex: number }> {
  const buf = await fetchImageBuffer(imageUrl)
  const dim = imageSize(buf)
  const imgW = dim.width ?? 1
  const imgH = dim.height ?? 1

  const client = getClient()
  /**
   * 选用 GeneralAccurateOCR（通用文字识别 · 高精度版）：
   *  - 已开通 + 后付费，每月 1000 次免费额度。
   *  - 对手写中文、混合排版、算式识别精度显著高于 BasicOCR。
   *  - 返回 ItemCoord {X,Y,Width,Height}（像素，左上原点）+ 行级 Confidence。
   * 备选：BasicOCR（更便宜，清晰印刷体首选）、HandwritingOCR（专攻手写，独立计费）。
   */
  const resp = await client.GeneralAccurateOCR({
    ImageBase64: buf.toString("base64"),
  })

  const detections = resp.TextDetections ?? []
  // 腾讯云返回字段名历史上有过拼写差异（Angel / Angle），两个都兼容
  const respAny = resp as any
  const angle: number | undefined =
    typeof respAny.Angel === "number"
      ? respAny.Angel
      : typeof respAny.Angle === "number"
        ? respAny.Angle
        : undefined
  let idx = baseLineIndex
  const lines: OcrLine[] = []

  for (const d of detections) {
    const text = (d.DetectedText ?? "").trim()
    if (!text) continue
    // 字段差异：GeneralAccurateOCR 返回 ItemPolygon；BasicOCR 返回 ItemCoord。兼容两者。
    const dAny = d as any
    const item = (dAny.ItemPolygon ?? dAny.ItemCoord) as
      | { X: number; Y: number; Width: number; Height: number }
      | undefined
    if (!item || item.Width <= 0 || item.Height <= 0) continue
    const conf = typeof d.Confidence === "number" ? d.Confidence / 100 : 0.9
    idx += 1
    lines.push({
      index: idx,
      text,
      bbox: [
        clampPct((item.Y / imgH) * 100),
        clampPct((item.X / imgW) * 100),
        clampPct((item.Height / imgH) * 100, 1),
        clampPct((item.Width / imgW) * 100, 1),
      ],
      confidence: Math.max(0, Math.min(1, conf)),
    })
  }

  return {
    page: { image_url: imageUrl, width: imgW, height: imgH, angle, lines },
    nextBaseIndex: idx,
  }
}

/* ----------------------------- 整份提交 OCR ----------------------------- */

/**
 * 对一份提交（多张图片）做全量 OCR。
 * 任意一页 OCR 失败不会让整份失败，失败页留空 lines。
 */
export async function ocrSubmission(imageUrls: string[]): Promise<OcrData> {
  const pages: OcrPage[] = []
  let nextIndex = 0
  for (const url of imageUrls) {
    try {
      const { page, nextBaseIndex } = await ocrOnePage(url, nextIndex)
      pages.push(page)
      nextIndex = nextBaseIndex
      console.log(`[v0] OCR page done: ${url} → ${page.lines.length} lines`)
    } catch (e: any) {
      console.error("[v0] OCR page failed:", url, e?.message)
      pages.push({ image_url: url, width: 1, height: 1, lines: [] })
    }
  }
  return {
    version: 1,
    provider: "tencent",
    ocrd_at: new Date().toISOString(),
    pages,
  }
}

/* ----------------------------- 给 LLM 用的转录文本 ----------------------------- */

/**
 * 把 OcrData 渲染成带页号、带全局行号的纯文本，喂给 VLM 当"事实底稿"。
 *
 * 【第 1 页】
 * L1: 你我之梦，中国之梦
 * L2: 十八年前，废寝忘食...
 *
 * 【第 2 页】
 * L23: ...
 */
export function buildTranscriptForLLM(ocrData: OcrData): string {
  const out: string[] = []
  ocrData.pages.forEach((p, pi) => {
    out.push(`【第 ${pi + 1} 页】`)
    if (p.lines.length === 0) {
      out.push("(本页 OCR 未识别到文字，请直接参考图片本身)")
    } else {
      for (const ln of p.lines) {
        out.push(`L${ln.index}: ${ln.text}`)
      }
    }
    out.push("")
  })
  return out.join("\n")
}

/** 按全局行号定位行所在的页和坐标 */
export function findLineByIndex(
  data: OcrData,
  index: number,
): { pageIndex: number; line: OcrLine } | null {
  for (let pi = 0; pi < data.pages.length; pi++) {
    const ln = data.pages[pi].lines.find((l) => l.index === index)
    if (ln) return { pageIndex: pi, line: ln }
  }
  return null
}
