import { put } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
/**
 * 服务端最大单文件 10MB：浏览器端 `lib/image/compress.ts` 已经会把图片压到 ≤4MB，
 * 这里 10MB 是双保险，防止极端浏览器（如旧版 Safari）压缩失败把原图直传上来。
 */
const MAX_SIZE = 10 * 1024 * 1024

/**
 * Blob store 在 Vercel 仪表盘可能被切换为 public / private。
 * 为了让代码在两种 store 类型下都能跑通（避免比赛演示前还要查后台）：
 *   - 先用 ENV 指定（BLOB_ACCESS_MODE）
 *   - 否则按"public 优先"策略：先试 public，遇到"private store"错误再 fallback 到 private
 *   - 反之亦然
 * 这样无论 main 分支还是 head 分支被部署到生产、无论 store 是哪种类型，
 * 上传都能成功，根治 "Cannot use private/public access on a (public/private) store" 错误。
 */
type AccessMode = "public" | "private"

const PRIMARY_ACCESS: AccessMode =
  process.env.BLOB_ACCESS_MODE === "private" ? "private" : "public"
const FALLBACK_ACCESS: AccessMode = PRIMARY_ACCESS === "public" ? "private" : "public"

function isAccessMismatchError(err: any): boolean {
  const msg = String(err?.message ?? "")
  return (
    /Cannot use private access on a public store/i.test(msg) ||
    /Cannot use public access on a private store/i.test(msg) ||
    /must be configured with (public|private) access/i.test(msg)
  )
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const taskId = (formData.get("taskId") as string | null) ?? (formData.get("scope") as string | null)

    if (!file) {
      return NextResponse.json({ error: "未上传文件" }, { status: 400 })
    }
    if (file.type && !ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: `不支持的文件类型: ${file.type}` }, { status: 400 })
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "文件过大（限 10MB）" }, { status: 400 })
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg"
    const safeTask = (taskId ?? "misc").replace(/[^a-zA-Z0-9_-]/g, "_")
    const pathname = `submissions/${safeTask}/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    // 先用主 access 模式尝试；命中 mismatch 错误再用 fallback 重试一次。
    // 这一段日志会在生产 Function Logs 里精确告诉你"线上代码当前用的是哪种 access" —
    // 演示前可以拉一次日志快速验证部署是否到了最新版本。
    console.log(
      `[v0] upload: file=${file.name} size=${file.size} primaryAccess=${PRIMARY_ACCESS}`,
    )

    let blob
    try {
      blob = await put(pathname, file, {
        access: PRIMARY_ACCESS,
        contentType: file.type || "image/jpeg",
        addRandomSuffix: false,
      })
    } catch (err: any) {
      if (!isAccessMismatchError(err)) throw err
      console.warn(
        `[v0] upload: store/access mismatch on ${PRIMARY_ACCESS}, retrying with ${FALLBACK_ACCESS}`,
      )
      blob = await put(pathname, file, {
        access: FALLBACK_ACCESS,
        contentType: file.type || "image/jpeg",
        addRandomSuffix: false,
      })
    }

    return NextResponse.json({ pathname: blob.pathname, url: blob.url, size: file.size })
  } catch (error: any) {
    const msg = String(error?.message ?? "")
    if (isAccessMismatchError(error)) {
      console.error("[v0] upload: access mismatch even after fallback", error)
      return NextResponse.json(
        {
          error:
            "上传失败：Blob Store 的 access 类型与代码不匹配。请在 Vercel 项目 → Storage 中确认该 Store 的 access mode，并确保生产部署的是 main 分支最新 commit（包含 Blob 修复）。",
        },
        { status: 500 },
      )
    }
    console.error("[v0] upload error:", error)
    return NextResponse.json(
      { error: error?.message ?? "上传失败，请重试" },
      { status: 500 },
    )
  }
}
