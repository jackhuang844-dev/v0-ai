import { LoginCard } from "./login-card"
import { listAllUsers } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function LoginPage() {
  const users = await listAllUsers()
  // 测试账号面板：老师只展示数学 + 英语 2 位；学生展示前 4 位
  const teachers = users.filter((u) => u.role === "teacher").slice(0, 2)
  const students = users.filter((u) => u.role === "student").slice(0, 4)
  return <LoginCard teachers={teachers} students={students} />
}
