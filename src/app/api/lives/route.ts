import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// GET /api/lives?action=my-lives&studentId=X
// 학생 앱용 — 내 목숨 조회
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  if (action === 'my-lives') {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

    const db = admin()
    const { data: { user } } = await db.auth.getUser(token)
    if (!user) return NextResponse.json({ error: '인증 실패' }, { status: 401 })

    const studentId = searchParams.get('studentId')
    if (!studentId) return NextResponse.json({ error: '학생 ID 필요' }, { status: 400 })

    // 이 학생이 본인 계정 소유인지 확인
    const { data: studentRow } = await db
      .from('students').select('id, academy_id').eq('id', studentId).eq('user_id', user.id).single()
    if (!studentRow) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const academyId = studentRow.academy_id

    // 학원 목숨 설정 조회
    const { data: academy } = await db
      .from('academies').select('lives_enabled, lives_default').eq('id', academyId).single()
    if (!academy?.lives_enabled) return NextResponse.json({ enabled: false, lives: 0 })

    // 학생 개인 목숨 조회
    const { data: rec } = await db
      .from('student_lives').select('lives').eq('academy_id', academyId).eq('student_id', studentId).single()

    const lives = rec?.lives ?? (academy.lives_default ?? 3)
    return NextResponse.json({ enabled: true, lives, livesDefault: academy.lives_default ?? 3 })
  }

  return NextResponse.json({ error: '잘못된 action' }, { status: 400 })
}
