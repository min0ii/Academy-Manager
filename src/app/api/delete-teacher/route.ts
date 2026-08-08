import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()

  const { data: { user: requester }, error: authError } = await db.auth.getUser(token)
  if (authError || !requester) return NextResponse.json({ error: '인증 오류.' }, { status: 401 })

  // 요청자 권한 확인 (조교 제외)
  const { data: membership } = await db
    .from('academy_teachers').select('academy_id, title').eq('teacher_id', requester.id).single()
  if (!membership || membership.title === '조교')
    return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { teacher_id } = await req.json() as { teacher_id: string }
  if (!teacher_id) return NextResponse.json({ error: '잘못된 요청이에요.' }, { status: 400 })

  // 자기 자신 삭제 방지
  if (teacher_id === requester.id)
    return NextResponse.json({ error: '본인 계정은 삭제할 수 없어요.' }, { status: 400 })

  // 같은 학원 소속인지 확인
  const { data: targetMembership } = await db
    .from('academy_teachers').select('id, role').eq('teacher_id', teacher_id).eq('academy_id', membership.academy_id).single()
  if (!targetMembership)
    return NextResponse.json({ error: '해당 선생님을 찾을 수 없어요.' }, { status: 404 })

  // 원장 삭제 방지
  if (targetMembership.role === 'owner')
    return NextResponse.json({ error: '원장 계정은 삭제할 수 없어요.' }, { status: 403 })

  // academy_teachers 삭제 → profiles 삭제 → auth 계정 삭제
  await db.from('academy_teachers').delete().eq('id', targetMembership.id)
  await db.from('profiles').delete().eq('id', teacher_id)
  const { error: delError } = await db.auth.admin.deleteUser(teacher_id)
  if (delError) return NextResponse.json({ error: '계정 삭제 오류: ' + delError.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
