import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// POST /api/delete-self
// 학생·학부모가 본인 계정을 직접 삭제
export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const { data: { user }, error } = await db.auth.getUser(token)
  if (error || !user) return NextResponse.json({ error: '인증 오류' }, { status: 401 })

  const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: '계정을 찾을 수 없어요.' }, { status: 404 })

  // 선생님 계정은 이 API로 탈퇴 불가
  if (profile.role === 'teacher')
    return NextResponse.json({ error: '선생님 계정은 대시보드 설정에서 처리해 주세요.' }, { status: 403 })

  // 학생이면 students.user_id 초기화 (학습 기록은 보존)
  if (profile.role === 'student')
    await db.from('students').update({ user_id: null }).eq('user_id', user.id)

  // profiles 삭제 → auth user 삭제
  await db.from('profiles').delete().eq('id', user.id)
  const { error: deleteError } = await db.auth.admin.deleteUser(user.id)
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 400 })

  return NextResponse.json({ success: true })
}
