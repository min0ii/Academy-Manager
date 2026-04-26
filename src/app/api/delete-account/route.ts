import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY 환경변수가 없어요.' }, { status: 500 })
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    // 요청자 인증
    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

    const { data: { user: requester }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !requester) return NextResponse.json({ error: '인증 오류.' }, { status: 401 })

    // 선생님 권한 확인
    const { data: membership } = await supabaseAdmin
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

    // 학원 소속 학생 한 번에 조회
    const { data: studentRows } = await supabaseAdmin
      .from('students')
      .select('id, name, phone, parent_phone')
      .in('id', studentIds)
      .eq('academy_id', membership.academy_id)

    if (!studentRows || studentRows.length === 0) {
      return NextResponse.json({ error: '학생을 찾을 수 없어요.' }, { status: 404 })
    }

    // 삭제할 전화번호 목록 수집
    const phonesToDelete: { digits: string; studentId: string; isStudent: boolean }[] = []
    for (const student of studentRows) {
      if (targetType === 'student' || targetType === 'both') {
        if (student.phone) {
          phonesToDelete.push({ digits: String(student.phone).replace(/\D/g, ''), studentId: student.id, isStudent: true })
        }
      }
      if (targetType === 'parent' || targetType === 'both') {
        if (student.parent_phone) {
          phonesToDelete.push({ digits: String(student.parent_phone).replace(/\D/g, ''), studentId: student.id, isStudent: false })
        }
      }
    }

    // profiles 테이블에서 전화번호로 user id 한 번에 조회 (listUsers() 대신)
    const allDigits = phonesToDelete.map(p => p.digits)
    const { data: profileRows } = await supabaseAdmin
      .from('profiles')
      .select('id, phone')
      .in('phone', allDigits)

    const phoneToUserId = new Map((profileRows ?? []).map((p: any) => [p.phone, p.id]))

    const errors: string[] = []

    // 각 계정 삭제 — auth 삭제 + profiles 삭제 + user_id 초기화 병렬 처리
    await Promise.all(phonesToDelete.map(async ({ digits, studentId, isStudent }) => {
      const userId = phoneToUserId.get(digits)
      if (!userId) return  // 이미 계정 없음

      const student = studentRows.find(s => s.id === studentId)

      const [{ error: deleteError }] = await Promise.all([
        supabaseAdmin.auth.admin.deleteUser(userId),
        supabaseAdmin.from('profiles').delete().eq('id', userId),
        // 학생 계정이면 students.user_id 초기화
        ...(isStudent
          ? [supabaseAdmin.from('students').update({ user_id: null }).eq('id', studentId)]
          : []
        ),
      ])

      if (deleteError) {
        errors.push(`${student?.name ?? ''} ${isStudent ? '' : '학부모'}: ${deleteError.message}`.trim())
      }
    }))

    return NextResponse.json({ success: true, errors })
  } catch {
    return NextResponse.json({ error: '서버 오류가 발생했어요.' }, { status: 500 })
  }
}
