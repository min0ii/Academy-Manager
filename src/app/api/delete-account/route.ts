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

    // { student_id, target: 'student' | 'parent' } 또는
    // { student_ids: string[], target: 'student' | 'parent' | 'both' } (일괄)
    const body = await req.json()
    const targets: { student_id: string; target: 'student' | 'parent' }[] = []

    if (body.student_ids && Array.isArray(body.student_ids)) {
      // 일괄 처리
      for (const sid of body.student_ids) {
        if (body.target === 'both') {
          targets.push({ student_id: sid, target: 'student' })
          targets.push({ student_id: sid, target: 'parent' })
        } else {
          targets.push({ student_id: sid, target: body.target })
        }
      }
    } else {
      targets.push({ student_id: body.student_id, target: body.target })
    }

    const errors: string[] = []

    for (const { student_id, target } of targets) {
      // 학생 조회 (학원 소속 확인)
      const { data: student } = await supabaseAdmin
        .from('students')
        .select('id, name, phone, parent_phone')
        .eq('id', student_id)
        .eq('academy_id', membership.academy_id)
        .single()

      if (!student) { errors.push(`학생을 찾을 수 없어요 (${student_id})`); continue }

      const rawPhone = target === 'student' ? student.phone : student.parent_phone
      if (!rawPhone) continue  // 전화번호 없으면 스킵

      const digits = String(rawPhone).replace(/\D/g, '')
      const email = `${digits}@academy.local`

      // auth 유저 조회
      const { data: { users } } = await supabaseAdmin.auth.admin.listUsers()
      const authUser = users.find(u => u.email === email)
      if (!authUser) continue  // 계정 없으면 스킵 (이미 없는 것)

      // auth 유저 삭제
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(authUser.id)
      if (deleteError) { errors.push(`${student.name} ${target === 'parent' ? '학부모' : ''}: ${deleteError.message}`); continue }

      // profiles 삭제 (auth 삭제 시 cascade 안 될 경우 대비)
      await supabaseAdmin.from('profiles').delete().eq('id', authUser.id)

      // 학생 계정이면 students.user_id 초기화
      if (target === 'student') {
        await supabaseAdmin.from('students').update({ user_id: null }).eq('id', student_id)
      }
    }

    return NextResponse.json({ success: true, errors })
  } catch {
    return NextResponse.json({ error: '서버 오류가 발생했어요.' }, { status: 500 })
  }
}
