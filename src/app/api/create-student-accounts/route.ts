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
    // 요청자 인증 확인
    const authHeader = req.headers.get('Authorization')
    const token = authHeader?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

    const { data: { user: requester }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !requester) return NextResponse.json({ error: '인증 오류.' }, { status: 401 })

    // 원장 또는 관리자 여부 확인
    const { data: membership } = await supabaseAdmin
      .from('academy_teachers')
      .select('role, academy_id, title')
      .eq('teacher_id', requester.id)
      .single()

    const isAdmin = (membership as any)?.title !== '조교'
    if (!membership || !isAdmin) {
      return NextResponse.json({ error: '원장·관리자·강사만 계정을 일괄 생성할 수 있어요.' }, { status: 403 })
    }

    const academyId = membership.academy_id

    // 학원의 모든 학생 조회
    const { data: students, error: studentsError } = await supabaseAdmin
      .from('students')
      .select('id, name, phone, parent_phone, user_id')
      .eq('academy_id', academyId)

    if (studentsError) {
      return NextResponse.json({ error: studentsError.message }, { status: 500 })
    }

    let studentCreated = 0
    let studentSkipped = 0
    let parentCreated = 0
    let parentSkipped = 0
    const errors: string[] = []

    for (const student of students ?? []) {
      // ── 학생 계정 생성 ──
      if (student.user_id) {
        // 이미 계정 있음 → 건너뜀
        studentSkipped++
      } else if (student.phone) {
        const digits = String(student.phone).replace(/\D/g, '')
        if (digits.length >= 6) {
          const email = `${digits}@academy.local`
          const password = digits.slice(-8) // 010 제외 뒤 8자리

          const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
          })

          if (createError) {
            if (createError.message.toLowerCase().includes('already')) {
              // Auth에는 있지만 students.user_id가 없는 경우 → profile 조회해서 연결
              const { data: existingProfile } = await supabaseAdmin
                .from('profiles')
                .select('id')
                .eq('phone', digits)
                .single()
              if (existingProfile) {
                await supabaseAdmin
                  .from('students')
                  .update({ user_id: existingProfile.id })
                  .eq('id', student.id)
                studentSkipped++
              } else {
                errors.push(`${student.name}: 이미 등록된 전화번호`)
                studentSkipped++
              }
            } else {
              errors.push(`${student.name}: ${createError.message}`)
              studentSkipped++
            }
          } else {
            const userId = authData.user.id
            // 프로필 생성
            const { error: profileError } = await supabaseAdmin.from('profiles').insert({
              id: userId,
              phone: digits,
              name: student.name,
              role: 'student',
            })
            if (profileError) {
              await supabaseAdmin.auth.admin.deleteUser(userId)
              errors.push(`${student.name}: 프로필 생성 실패`)
              studentSkipped++
            } else {
              // students 테이블에 user_id 연결
              await supabaseAdmin
                .from('students')
                .update({ user_id: userId })
                .eq('id', student.id)
              studentCreated++
            }
          }
        } else {
          studentSkipped++
        }
      } else {
        studentSkipped++
      }

      // ── 학부모 계정 생성 ──
      if (!student.parent_phone) continue

      const parentDigits = String(student.parent_phone).replace(/\D/g, '')
      if (parentDigits.length < 4) continue

      // 이미 profile이 있는지 확인
      const { data: existingParent } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('phone', parentDigits)
        .single()

      if (existingParent) {
        parentSkipped++
        continue
      }

      const parentEmail = `${parentDigits}@academy.local`
      const parentPassword = parentDigits.slice(-8)

      const { data: parentAuthData, error: parentCreateError } = await supabaseAdmin.auth.admin.createUser({
        email: parentEmail,
        password: parentPassword,
        email_confirm: true,
      })

      if (parentCreateError) {
        if (parentCreateError.message.toLowerCase().includes('already')) {
          parentSkipped++
        } else {
          errors.push(`${student.name} 학부모: ${parentCreateError.message}`)
          parentSkipped++
        }
        continue
      }

      const parentUserId = parentAuthData.user.id
      const { error: parentProfileError } = await supabaseAdmin.from('profiles').insert({
        id: parentUserId,
        phone: parentDigits,
        name: `${student.name} 학부모`,
        role: 'parent',
      })

      if (parentProfileError) {
        await supabaseAdmin.auth.admin.deleteUser(parentUserId)
        errors.push(`${student.name} 학부모: 프로필 생성 실패`)
        parentSkipped++
      } else {
        parentCreated++
      }
    }

    return NextResponse.json({
      success: true,
      studentCreated,
      studentSkipped,
      parentCreated,
      parentSkipped,
      errors,
    })
  } catch {
    return NextResponse.json({ error: '서버 오류가 발생했어요.' }, { status: 500 })
  }
}
