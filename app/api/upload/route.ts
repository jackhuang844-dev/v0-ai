import { put } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
/**
 * 服务端最大单文件 10MB：浏览器端 `lib/image/compress.ts` 已经会把图片压到 ≤4MB，
 * 这里 10MB 是双保险，防止极端浏览器（如旧版 Safari）压缩失败把原图直传上来。
 */
const MAX_SIZE = 10 * 1024 * 1024

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
      return NextResponse.json({ error: "文件过大（限 8MB）" }, { status: 400 })
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg"
    const safeTask = (taskId ?? "misc").replace(/[^a-zA-Z0-9_-]/g, "_")
    const pathname = `submissions/${safeTask}/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    // Blob store 当前为 public —— 上传时使用 access:"public"。
    // 学号/作业 ID 已经在路径里做了路径混淆，前端只保存 pathname，渲染走 /api/file 代理一层（仍可统一鉴权 + 缓存控制）。
    const blob = await put(pathname, file, {
      access: "public",
      contentType: file.type || "image/jpeg",
      addRandomSuffix: false,
    })

    // 同时返回 pathname 和 url，前端优先用 pathname 走代理；老客户端用 url 也兼容
    return NextResponse.json({ pathname: blob.pathname, url: blob.url, size: file.size })
  } catch (error: any) {
    console.error("[v0] upload error:", error)
    return NextResponse.json(
      { error: error?.message ?? "上传失败，请重试" },
      { status: 500 },
    )
  }
}
