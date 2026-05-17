import { type NextRequest, NextResponse } from "next/server"
import { head } from "@vercel/blob"
import { getCurrentUser } from "@/lib/auth-server"

export async function GET(request: NextRequest) {
  // 文件服务对老师 / 学生都开放（缩略图、原图渲染都要用）
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const pathname = request.nextUrl.searchParams.get("pathname")
  if (!pathname) {
    return NextResponse.json({ error: "Missing pathname" }, { status: 400 })
  }

  try {
    // Blob store 当前为 public：用 head() 拿到带 token 的真实 url，
    // 然后 fetch 后转发给浏览器。这样仍然保留 /api/file 这一层登录鉴权
    // 和路径隐藏（前端代码里只出现 pathname，不暴露 blob 域名）。
    const meta = await head(pathname)
    if (!meta?.url) {
      return new NextResponse("Not found", { status: 404 })
    }
    const ifNoneMatch = request.headers.get("if-none-match")
    const upstream = await fetch(meta.url, {
      headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : {},
    })
    if (upstream.status === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: upstream.headers.get("etag") ?? "",
          "Cache-Control": "private, no-cache",
        },
      })
    }
    if (!upstream.ok || !upstream.body) {
      return new NextResponse("Not found", { status: 404 })
    }
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type":
          meta.contentType ?? upstream.headers.get("content-type") ?? "application/octet-stream",
        ETag: upstream.headers.get("etag") ?? "",
        "Cache-Control": "private, no-cache",
      },
    })
  } catch (error) {
    console.error("[v0] file serve error:", error)
    return NextResponse.json({ error: "Failed to serve file" }, { status: 500 })
  }
}
