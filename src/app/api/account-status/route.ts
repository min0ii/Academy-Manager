import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
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
    const authHeader = req.headers.get('Authorization')
    const token = authHeader?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

    const { data: { user: requester }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !requester) return NextResponse.json({ error: '인증 오류.' }, { status: 401 })

    // 학원 소속 확인
    const { data: membership } = await supabaseAdmin
      .from('academy_teachers')
      .select('academy_id')
      .eq('teacher_id', requester.id)
      .single()

    if (!membership) return NextResponse.json({ error: '학원 정보를 찾을 수 없어요.' }, { status: 403 })

    // 학원의 재원 학생 전체 조회
    const { data: students, error: studentsError } = await supabaseAdmin
      .from('students')
      .select('id, phone, parent_phone')
      .eq('academy_id', membership.academy_id)
      .eq('status', 'active')

    if (studentsError) return NextResponse.json({ error: studentsError.message }, { status: 500 })

    // 전화번호 모음 (학생 + 학부모)
    const studentPhones = new Map<string, string>() // phone → student_id
    const parentPhones = new Map<string, string>()  // phone → student_id

    for (const s of students ?? []) {
      if (s.phone) {
        const digits = String(s.phone).replace(/\D/g, '')
        if (digits) studentPhones.set(digits, s.id)
      }
      if (s.parent_phone) {
        const digits = String(s.parent_phone).replace(/\D/g, '')
        if (digits) parentPhones.set(digits, s.id)
      }
    }

    const allPhones = [...new Set([...studentPhones.keys(), ...parentPhones.keys()])]

    // service role로 profiles 전체 조회 (RLS 우회)
    const existingPhones = new Set<string>()
    if (allPhones.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('phone')
        .in('phone', allPhones)

      for (const p of profiles ?? []) {
        if (p.phone) existingPhones.add(p.phone)
      }
    }

    // 각 학생별 계정 여부 계산
    const result = (students ?? []).map(s => {
      const sDigits = s.phone ? String(s.phone).replace(/\D/g, '') : ''
      const pDigits = s.parent_phone ? String(s.parent_phone).replace(/\D/g, '') : ''
      return {
        studentId: s.id,
        studentHasAccount: sDigits ? existingPhones.has(sDigits) : false,
        parentHasAccount: pDigits ? existingPhones.has(pDigits) : false,
      }
    })

    return NextResponse.json({ success: true, data: result })
  } catch {
    return NextResponse.json({ error: '서버 오류가 발생했어요.' }, { status: 500 })
  }
}
