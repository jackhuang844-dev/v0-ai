/**
 * 服务端图片纠偏（自动旋转回正）
 *
 * 学生拍作业纸时常常会有 5~30° 的倾斜（俯拍稳定性差），
 * 这会让 OCR 行检测出来的 bbox 仍然是水平包围盒、但与"字的真实区域"严重错位，
 * 进而导致 AI 批改时 line_indexes → bbox 解算后整个错位。
 *
 * 解决方案：在 OCR 之前先把图片回正，方法是用 sharp 按腾讯云 OCR 返回的
 * 整图旋转角度 Angle/Angel 字段做一次平面旋转 + 自动裁掉黑边。
 *
 * - 阈值 2°：低于此就不旋转，避免对原本正放的图做无谓 re-encode；
 * - 旋转后图重新上传到 Blob，并把新 pathname 返回给调用方覆盖原 image_urls；
 * - 失败安全：sharp 抛异常时返回 null，调用方继续用原图（最坏情况就是 bbox 偏）。
 */
import "server-only"
import sharp from "sharp"
import { put, head } from "@vercel/blob"

/** 低于此角度认为已经基本水平，不做处理。 */
export const SKEW_THRESHOLD_DEG = 2

async function fetchBuffer(pathnameOrUrl: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(pathnameOrUrl)) {
    const res = await fetch(pathnameOrUrl)
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }
  // public store 下用 head() 取真实 url，再 fetch 字节
  const meta = await head(pathnameOrUrl)
  if (!meta?.url) throw new Error(`blob not found: ${pathnameOrUrl}`)
  const res = await fetch(meta.url)
  if (!res.ok) throw new Error(`fetch blob failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * 把整张图旋转指定角度。
 * - 正数 = 顺时针；OCR 返回的 Angle 通常表示"内容相对水平偏了多少度"，
 *   把它取反就是把内容转回水平。
 * - 自动 limitInputPixels=false：手机大图常超 24Mpx，要放开限制。
 * - 输出统一 JPEG quality=88：体积合理、清晰度满足后续 VLM。
 *
 * @returns 新 blob pathname；失败返回 null。
 */
export async function rotateImageBlob(
  pathnameOrUrl: string,
  angleDeg: number,
): Promise<string | null> {
  if (Math.abs(angleDeg) < SKEW_THRESHOLD_DEG) return null
  try {
    const buf = await fetchBuffer(pathnameOrUrl)
    // sharp.rotate(angle, background): 正角度为顺时针；把 -OCR角度传进去即可"回正"
    const rotated = await sharp(buf, { limitInputPixels: false })
      .rotate(-angleDeg, { background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer()

    // 用同前缀目录 + deskewed 后缀，方便识别
    const base = /^https?:\/\//i.test(pathnameOrUrl)
      ? `submissions/external/${Date.now()}`
      : pathnameOrUrl.replace(/\.[a-z]+$/i, "")
    const newPath = `${base}.deskewed-${Math.round(angleDeg)}.jpg`

    const result = await put(newPath, rotated, {
      access: "public",
      contentType: "image/jpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
    })
    return result.pathname
  } catch (e: any) {
    console.error("[v0] deskew rotate failed:", pathnameOrUrl, e?.message)
    return null
  }
}

/**
 * 批量纠偏：每张图按对应角度独立处理。
 * 角度低于阈值的图不旋转，但为了保持下标对齐，仍然返回原 pathname。
 * 任何一张失败就返回原图（保证下标长度始终等于输入）。
 */
export async function autoDeskewSubmissionImages(
  pathnames: string[],
  angles: number[],
): Promise<string[]> {
  const out = await Promise.all(
    pathnames.map(async (p, i) => {
      const a = angles[i] ?? 0
      if (Math.abs(a) < SKEW_THRESHOLD_DEG) return p
      const rotated = await rotateImageBlob(p, a)
      return rotated ?? p
    }),
  )
  return out
}
