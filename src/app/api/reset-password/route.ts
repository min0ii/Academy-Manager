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

    const { student_id, target } = await req.json() as { student_id: string; target: 'student' | 'parent' }
    if (!student_id || !target) return NextResponse.json({ error: '잘못된 요청이에요.' }, { status: 400 })

    // 학생 조회 (학원 소속 확인)
    const { data: student } = await supabaseAdmin
      .from('students')
      .select('id, name, phone, parent_phone')
      .eq('id', student_id)
      .eq('academy_id', membership.academy_id)
      .single()

    if (!student) return NextResponse.json({ error: '학생을 찾을 수 없어요.' }, { status: 404 })

    // 전화번호 → 초기 비밀번호
    const rawPhone = target === 'student' ? student.phone : student.parent_phone
    if (!rawPhone) return NextResponse.json({ error: '전화번호 정보가 없어요.' }, { status: 400 })

    const digits = String(rawPhone).replace(/\D/g, '')
    const newPassword = digits.slice(-8)

    // profiles 테이블에서 전화번호로 유저 ID 직접 조회 (listUsers() 대신)
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('phone', digits)
      .single()

    if (!profile) return NextResponse.json({ error: '계정을 찾을 수 없어요.' }, { status: 404 })

    // 비밀번호 초기화 + must_change_password 병렬 처리
    const [{ error: resetError }] = await Promise.all([
      supabaseAdmin.auth.admin.updateUserById(profile.id, { password: newPassword }),
      supabaseAdmin.from('profiles').update({ must_change_password: true }).eq('id', profile.id),
    ])
    if (resetError) return NextResponse.json({ error: resetError.message }, { status: 400 })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: '서버 오류가 발생했어요.' }, { status: 500 })
  }
}
