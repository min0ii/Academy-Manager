import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았어요. Vercel 환경변수를 확인해주세요.' },
      { status: 500 }
    )
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    // 요청자 인증 확인
    const authHeader = req.headers.get('Authorization')
    const token = authHeader?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

    const { data: { user: requester }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !requester) return NextResponse.json({ error: '인증 오류.' }, { status: 401 })

    // 원장 여부 확인
    const { data: membership } = await supabaseAdmin
      .from('academy_teachers')
      .select('role, academy_id, title')
      .eq('teacher_id', requester.id)
      .single()

    const isAdmin = membership?.role === 'owner' || (membership as any)?.title === '관리자'
    if (!membership || !isAdmin) {
      return NextResponse.json({ error: '원장 또는 관리자만 선생님을 추가할 수 있어요.' }, { status: 403 })
    }

    const { name, phone, password, title } = await req.json()
    if (!name || !phone || !password) {
      return NextResponse.json({ error: '이름, 전화번호, 비밀번호를 모두 입력해주세요.' }, { status: 400 })
    }
    const validTitles = ['원장', '관리자', '강사']
    const teacherTitle = validTitles.includes(title) ? title : '강사'

    const digits = String(phone).replace(/\D/g, '')
    const email = `${digits}@academy.local`

    // Auth 유저 생성
    const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (createError) {
      const msg = createError.message.toLowerCase().includes('already')
        ? '이미 등록된 전화번호예요.'
        : createError.message
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    const userId = authData.user.id

    // 프로필 생성
    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: userId,
      phone: digits,
      name,
      role: 'teacher',
    })

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: profileError.message }, { status: 400 })
    }

    // 학원 팀에 교사로 추가
    const { error: memberError } = await supabaseAdmin.from('academy_teachers').insert({
      academy_id: membership.academy_id,
      teacher_id: userId,
      role: 'staff',
      title: teacherTitle,
    })

    if (memberError) {
      await supabaseAdmin.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: memberError.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: '서버 오류가 발생했어요.' }, { status: 500 })
  }
}
