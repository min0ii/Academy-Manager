import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았어요.' },
      { status: 500 }
    )
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    const authHeader = req.headers.get('Authorization')
    const token = authHeader?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

    const { data: { user: requester }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !requester) return NextResponse.json({ error: '인증 오류.' }, { status: 401 })

    // 원장·관리자 확인
    const { data: membership } = await supabaseAdmin
      .from('academy_teachers')
      .select('role, academy_id, title')
      .eq('teacher_id', requester.id)
      .single()

    const isAdmin = membership?.role === 'owner' || (membership as any)?.title === '관리자'
    if (!membership || !isAdmin) {
      return NextResponse.json({ error: '원장 또는 관리자만 계정을 생성할 수 있어요.' }, { status: 403 })
    }

    // { student_id, target: 'student' | 'parent' }
    const { student_id, target } = await req.json()
    if (!student_id || !target) {
      return NextResponse.json({ error: '잘못된 요청이에요.' }, { status: 400 })
    }

    // 학생 정보 조회 (학원 소속 확인 포함)
    const { data: student } = await supabaseAdmin
      .from('students')
      .select('id, name, phone, parent_phone, user_id, academy_id')
      .eq('id', student_id)
      .eq('academy_id', membership.academy_id)
      .single()

    if (!student) {
      return NextResponse.json({ error: '학생을 찾을 수 없어요.' }, { status: 404 })
    }

    // ── 학생 계정 생성 ──
    if (target === 'student') {
      if (student.user_id) {
        return NextResponse.json({ error: '이미 계정이 있어요.' }, { status: 409 })
      }
      if (!student.phone) {
        return NextResponse.json({ error: '전화번호가 없어 계정을 만들 수 없어요.' }, { status: 400 })
      }

      const digits = String(student.phone).replace(/\D/g, '')
      if (digits.length < 6) {
        return NextResponse.json({ error: '전화번호가 너무 짧아요.' }, { status: 400 })
      }

      const email = `${digits}@academy.local`
      const password = digits.slice(-8)

      const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })

      if (createError) {
        if (createError.message.toLowerCase().includes('already')) {
          // Auth에 이미 있음 → profile 조회해서 students.user_id 연결
          const { data: existing } = await supabaseAdmin
            .from('profiles').select('id').eq('phone', digits).single()
          if (existing) {
            await supabaseAdmin.from('students').update({ user_id: existing.id }).eq('id', student_id)
            return NextResponse.json({ success: true, message: '이미 존재하는 계정과 연결했어요.' })
          }
        }
        return NextResponse.json({ error: createError.message }, { status: 400 })
      }

      const userId = authData.user.id
      const { error: profileError } = await supabaseAdmin.from('profiles').insert({
        id: userId, phone: digits, name: student.name, role: 'student',
      })

      if (profileError) {
        await supabaseAdmin.auth.admin.deleteUser(userId)
        return NextResponse.json({ error: profileError.message }, { status: 400 })
      }

      await supabaseAdmin.from('students').update({ user_id: userId }).eq('id', student_id)
      return NextResponse.json({ success: true })
    }

    // ── 학부모 계정 생성 ──
    if (target === 'parent') {
      if (!student.parent_phone) {
        return NextResponse.json({ error: '학부모 연락처가 없어요.' }, { status: 400 })
      }

      const digits = String(student.parent_phone).replace(/\D/g, '')
      if (digits.length < 6) {
        return NextResponse.json({ error: '학부모 전화번호가 너무 짧아요.' }, { status: 400 })
      }

      // 이미 profile 있는지 확인
      const { data: existing } = await supabaseAdmin
        .from('profiles').select('id').eq('phone', digits).single()
      if (existing) {
        return NextResponse.json({ error: '이미 계정이 있어요.' }, { status: 409 })
      }

      const email = `${digits}@academy.local`
      const password = digits.slice(-8)

      const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })

      if (createError) {
        return NextResponse.json({ error: createError.message }, { status: 400 })
      }

      const userId = authData.user.id
      const { error: profileError } = await supabaseAdmin.from('profiles').insert({
        id: userId,
        phone: digits,
        name: `${student.name} 학부모`,
        role: 'parent',
      })

      if (profileError) {
        await supabaseAdmin.auth.admin.deleteUser(userId)
        return NextResponse.json({ error: profileError.message }, { status: 400 })
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: '잘못된 target 값이에요.' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: '서버 오류가 발생했어요.' }, { status: 500 })
  }
}
