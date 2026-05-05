import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY 환경변수가 없어요.' }, { status: 500 })
  }

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    // 요청자 인증
    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

    const { data: { user: requester }, error: authError } = await db.auth.getUser(token)
    if (authError || !requester) return NextResponse.json({ error: '인증 오류.' }, { status: 401 })

    // 선생님 권한 확인
    const { data: membership } = await db
      .from('academy_teachers')
      .select('academy_id, title')
      .eq('teacher_id', requester.id)
      .single()

    if (!membership || membership.title === '조교') {
      return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })
    }

    // 요청 파싱
    const body = await req.json()
    const studentIds: string[] = body.student_ids ?? (body.student_id ? [body.student_id] : [])
    const targetType: 'student' | 'parent' | 'both' = body.target ?? 'student'

    if (studentIds.length === 0) return NextResponse.json({ error: '잘못된 요청이에요.' }, { status: 400 })

    // 학원 소속 학생 조회 (user_id 포함)
    const { data: studentRows } = await db
      .from('students')
      .select('id, name, user_id')
      .in('id', studentIds)
      .eq('academy_id', membership.academy_id)

    if (!studentRows || studentRows.length === 0) {
      return NextResponse.json({ error: '학생을 찾을 수 없어요.' }, { status: 404 })
    }

    const userIdsToDelete: string[] = []
    const errors: string[] = []

    // ── 학생 계정: students.user_id 직접 사용 ──
    if (targetType === 'student' || targetType === 'both') {
      for (const s of studentRows) {
        if (s.user_id) userIdsToDelete.push(s.user_id)
      }
    }

    // ── 학부모 계정: parent_students 테이블에서 parent_id 조회 ──
    if (targetType === 'parent' || targetType === 'both') {
      const { data: parentLinks } = await db
        .from('parent_students')
        .select('parent_id')
        .in('student_id', studentIds)

      for (const link of (parentLinks ?? [])) {
        if (link.parent_id && !userIdsToDelete.includes(link.parent_id)) {
          userIdsToDelete.push(link.parent_id)
        }
      }
    }

    // ── 계정 삭제 ──
    await Promise.all(userIdsToDelete.map(async (userId) => {
      const [{ error: deleteError }] = await Promise.all([
        db.auth.admin.deleteUser(userId),
        db.from('profiles').delete().eq('id', userId),
      ])
      if (deleteError) errors.push(deleteError.message)
    }))

    // ── 학생 user_id 초기화 (학생 계정 삭제 시) ──
    if (targetType === 'student' || targetType === 'both') {
      await db.from('students').update({ user_id: null }).in('id', studentIds)
    }

    return NextResponse.json({ success: true, errors })
  } catch {
    return NextResponse.json({ error: '서버 오류가 발생했어요.' }, { status: 500 })
  }
}
