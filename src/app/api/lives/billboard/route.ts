import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// 스포츠식 공동등수: 동점이면 같은 rank, 다음은 건너뜀 (1,1,3,4...)
function assignRanks(entries: { id: string; name: string; lives: number }[]) {
  return entries.map((e, i) => {
    const rank = entries.findIndex(x => x.lives === e.lives) + 1
    return { rank, name: e.name, lives: e.lives }
  })
}

// GET /api/lives/billboard?classId=xxx
// 선생님: 전체 순위 반환 / 학생: 상위 5개 항목 반환
export async function GET(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const { searchParams } = new URL(req.url)
  const classId = searchParams.get('classId')
  if (!classId) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })

  // 토큰 → 사용자 확인
  const { data: { user }, error: authErr } = await db.auth.getUser(token)
  if (authErr || !user) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  // 반 소속 academy 조회
  const { data: cls } = await db.from('classes').select('academy_id').eq('id', classId).single()
  if (!cls?.academy_id) return NextResponse.json({ error: '반을 찾을 수 없어요.' }, { status: 404 })
  const academyId = cls.academy_id

  // 선생님 여부 확인
  const { data: teacherRow } = await db.from('academy_teachers')
    .select('academy_id').eq('teacher_id', user.id).eq('academy_id', academyId).maybeSingle()
  const isTeacher = !!teacherRow

  // 빌보드 설정 조회
  const { data: academy } = await db.from('academies')
    .select('lives_billboard_enabled, lives_billboard_show_last, lives_default')
    .eq('id', academyId).single()

  // 선생님은 빌보드 설정 무관하게 항상 전체 순위 반환
  if (!isTeacher && !academy?.lives_billboard_enabled)
    return NextResponse.json({ billboardEnabled: false })

  // 반 소속 학생 목록
  const { data: cs } = await db.from('class_students')
    .select('student_id').eq('class_id', classId)
  if (!cs?.length) return NextResponse.json({
    billboardEnabled: true, isTeacher,
    billboard: [], minLives: null,
    showLast: academy?.lives_billboard_show_last ?? true,
  })

  const studentIds = cs.map(r => r.student_id)

  // 학생 이름 조회
  const { data: studentRows } = await db.from('students')
    .select('id, name').in('id', studentIds)
  const nameMap: Record<string, string> = {}
  for (const s of (studentRows ?? [])) nameMap[s.id] = s.name

  // 목숨 조회
  const { data: livesRows } = await db.from('student_lives')
    .select('student_id, lives').eq('academy_id', academyId).in('student_id', studentIds)
  const livesMap: Record<string, number> = {}
  for (const r of (livesRows ?? [])) livesMap[r.student_id] = r.lives

  const livesDefault = academy?.lives_default ?? 3
  const allEntries = studentIds.map(id => ({
    id,
    name: nameMap[id] ?? '?',
    lives: livesMap[id] ?? livesDefault,
  }))

  // 내림차순 정렬 후 공동등수 계산
  allEntries.sort((a, b) => b.lives - a.lives)
  const ranked = assignRanks(allEntries)

  // 선생님: 전체 / 학생: 상위 5개 항목
  const billboard = isTeacher ? ranked : ranked.slice(0, 5)

  // 꼴찌 목숨 수
  const minLives = allEntries.length > 0 ? allEntries[allEntries.length - 1].lives : null

  return NextResponse.json({
    billboardEnabled: true,
    isTeacher,
    billboard,
    minLives,
    showLast: academy?.lives_billboard_show_last ?? true,
    livesDefault,
  })
}
