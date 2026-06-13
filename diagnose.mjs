// 사용법: node diagnose.mjs <SERVICE_ROLE_KEY> <USER_ID>
// 예시:   node diagnose.mjs eyJhb... 8a0956e3-7781-43ca-b27d-ee1b763953c5

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://avjlmhmwkogmvxmaqskv.supabase.co'
const SERVICE_ROLE_KEY = process.argv[2]
const USER_ID = process.argv[3]

if (!SERVICE_ROLE_KEY || !USER_ID) {
  console.error('사용법: node diagnose.mjs <SERVICE_ROLE_KEY> <USER_ID>')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

console.log('=== 목숨 시스템 진단 ===\n')
console.log(`대상 user_id: ${USER_ID}\n`)

// 1. 학생 기본 정보
const { data: students } = await db.from('students').select('id, name, academy_id, user_id, status').eq('user_id', USER_ID)
if (!students?.length) {
  console.error('❌ students 테이블에 이 user_id를 가진 학생이 없음!')
  process.exit(1)
}
console.log('[1] 학생 기본 정보:')
for (const s of students) {
  console.log(`  student_id(DB): ${s.id}`)
  console.log(`  이름: ${s.name}, 학원ID: ${s.academy_id}, 상태: ${s.status}`)
}

const student = students[0]
const studentId = student.id
const academyId = student.academy_id

// 2. 반 등록 현황
const { data: classStudents } = await db.from('class_students').select('class_id').eq('student_id', studentId)
const classIds = (classStudents ?? []).map(c => c.class_id)
console.log(`\n[2] 반 등록 현황: ${classIds.length}개 반`)
if (classIds.length > 0) {
  const { data: classInfo } = await db.from('classes').select('id, name').in('id', classIds)
  for (const c of classInfo ?? []) console.log(`  - ${c.name} (${c.id})`)
} else {
  console.log('  ❌ 등록된 반 없음!')
}

// 3. 학원 자동화 설정
const { data: academy } = await db.from('academies')
  .select('lives_enabled, lives_default, lives_auto_enabled, lives_auto_from')
  .eq('id', academyId).single()
console.log('\n[3] 학원 설정:')
console.log(`  lives_enabled: ${academy?.lives_enabled}`)
console.log(`  lives_auto_enabled: ${academy?.lives_auto_enabled}`)
console.log(`  lives_auto_from: ${academy?.lives_auto_from}`)
console.log(`  lives_default: ${academy?.lives_default}`)

// 4. 활성 규칙
const { data: rules } = await db.from('lives_rules')
  .select('id, name, condition_type, condition_detail, delta, enabled, order_num')
  .eq('academy_id', academyId).eq('enabled', true)
  .order('order_num').order('created_at')
console.log(`\n[4] 활성 규칙 (${rules?.length ?? 0}개):`)
for (const r of rules ?? []) {
  console.log(`  [${r.order_num}] ${r.name} | ${r.condition_type} | delta:${r.delta}`)
  console.log(`       detail: ${JSON.stringify(r.condition_detail)}`)
}

// 5. 반의 시험 목록 (auto_from 이후)
const autoFrom = academy?.lives_auto_from
console.log(`\n[5] 반의 시험 목록 (${autoFrom} 이후):`)
if (classIds.length > 0) {
  const { data: exams } = await db.from('exams')
    .select('id, name, category, exam_type, exam_format, max_score, start_at, created_at, class_id')
    .in('class_id', classIds)
    .order('start_at', { ascending: false })
    .limit(30)

  const filteredExams = (exams ?? []).filter(e => {
    const dateStr = e.start_at ? e.start_at.slice(0, 10) : e.created_at.slice(0, 10)
    return !autoFrom || dateStr >= autoFrom
  })

  // 각 시험의 제출 현황
  for (const exam of filteredExams) {
    const examDate = exam.start_at ? exam.start_at.slice(0, 10) : exam.created_at.slice(0, 10)
    const { data: sub } = await db.from('exam_submissions')
      .select('auto_score, adjusted_score, is_submitted, is_forfeited, submitted_at')
      .eq('exam_id', exam.id)
      .eq('student_id', studentId)
      .maybeSingle()

    // 만점 계산
    let maxScore = exam.max_score
    if (exam.exam_type === 'auto') {
      const { data: qRows } = await db.from('exam_questions').select('score').eq('exam_id', exam.id)
      maxScore = (qRows ?? []).reduce((s, q) => s + Number(q.score), 0)
    }

    const submissionStr = sub
      ? `is_submitted:${sub.is_submitted}, is_forfeited:${sub.is_forfeited}, score:${sub.auto_score ?? sub.adjusted_score}/${maxScore}`
      : '❌ 제출 기록 없음 → 미제출로 처리됨!'

    console.log(`  [${examDate}] ${exam.name ?? exam.category} (${exam.id.slice(0,8)})`)
    console.log(`    반:${exam.class_id.slice(0,8)}, type:${exam.exam_type}, maxScore:${maxScore}`)
    console.log(`    제출: ${submissionStr}`)
  }
} else {
  console.log('  반이 없으므로 시험 없음')
}

// 6. 최근 목숨 로그
const { data: logs } = await db.from('student_lives_log')
  .select('id, delta, reason, source, lives_after, created_at')
  .eq('student_id', studentId)
  .eq('academy_id', academyId)
  .order('created_at', { ascending: false })
  .limit(15)
console.log(`\n[6] 최근 목숨 로그 (${logs?.length ?? 0}개):`)
for (const l of logs ?? []) {
  console.log(`  [${l.created_at.slice(0,10)}] ${l.delta > 0 ? '+' : ''}${l.delta} | ${l.reason} | source:${l.source} | 누적:${l.lives_after}`)
}

// 7. 현재 목숨
const { data: livesRow } = await db.from('student_lives')
  .select('lives, updated_at')
  .eq('student_id', studentId)
  .eq('academy_id', academyId)
  .maybeSingle()
console.log(`\n[7] 현재 목숨: ${livesRow?.lives ?? '기록 없음'} (업데이트: ${livesRow?.updated_at ?? '-'})`)
