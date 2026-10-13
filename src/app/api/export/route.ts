import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'

// 기록이 많으면 파일을 만드는 데 시간이 걸린다
export const maxDuration = 60

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function verifyTeacher(db: ReturnType<typeof admin>, token: string) {
  const { data: { user }, error } = await db.auth.getUser(token)
  if (error || !user) return null
  const { data: p } = await db.from('profiles').select('role').eq('id', user.id).single()
  if (p?.role !== 'teacher') return null
  const { data: m } = await db.from('academy_teachers').select('academy_id').eq('teacher_id', user.id).single()
  return m?.academy_id ?? null
}

// PostgREST 는 한 번에 1000행까지만 주므로 끝까지 나눠서 가져온다
async function fetchAll<T = any>(build: (from: number, to: number) => any): Promise<T[]> {
  const SIZE = 1000
  const out: T[] = []
  for (let from = 0; ; from += SIZE) {
    const { data, error } = await build(from, from + SIZE - 1)
    if (error || !data || data.length === 0) break
    out.push(...(data as T[]))
    if (data.length < SIZE) break
  }
  return out
}

// .in() 에 id를 너무 많이 넣으면 요청 URL이 길어져 실패한다
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function fetchAllIn<T = any>(ids: string[], build: (part: string[], from: number, to: number) => any): Promise<T[]> {
  const out: T[] = []
  // 하나씩 순서대로 요청하면 답안 2만 건에 13초가 걸린다. 6묶음씩 동시에 보낸다.
  for (const group of chunk(chunk(ids, 80), 6)) {
    const results = await Promise.all(group.map(part => fetchAll<T>((f, t) => build(part, f, t))))
    for (const r of results) out.push(...r)
  }
  return out
}

const KST = 'Asia/Seoul'
// sv-SE 로케일은 'YYYY-MM-DD HH:mm:ss' 로 나와서 엑셀에서 정렬도 되고 읽기도 편하다
const fmtDT = (v: string | null) => v ? new Date(v).toLocaleString('sv-SE', { timeZone: KST }).slice(0, 16) : ''
const fmtD  = (v: string | null) => v ? String(v).slice(0, 10) : ''

const ATT_LABEL: Record<string, string> = { present: '출석', late: '지각', early_leave: '조퇴', absent: '결석', cancelled: '휴강' }
const HW_LABEL:  Record<string, string> = { partial: '오답(완벽) 완료', done: '완료', none: '미완료' }
const CL_LABEL:  Record<string, string> = { done: '완료', not_done: '미완료' }
const SRC_LABEL: Record<string, string> = { rule: '자동 규칙', manual: '수동 조정', init: '기본 지급' }

// GET /api/export — 학원 전체 기록을 엑셀 한 파일로
export async function GET(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: '서버 설정이 올바르지 않아요.' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const academyId = await verifyTeacher(db, token)
  if (!academyId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  // ── 1. 기준 데이터
  const { data: academy } = await db.from('academies').select('name').eq('id', academyId).single()
  const classes  = await fetchAll((f, t) => db.from('classes')
    .select('id, name').eq('academy_id', academyId).order('name').range(f, t))
  const students = await fetchAll((f, t) => db.from('students')
    .select('id, name, grade, school_name, phone, parent_phone, parent_relation, status, enrolled_at, withdrawn_at, memo')
    .eq('academy_id', academyId).order('name').range(f, t))

  const classIds   = classes.map(c => c.id)
  const classOf: Record<string, string>   = {}
  for (const c of classes) classOf[c.id] = c.name
  const studentOf: Record<string, string> = {}
  for (const s of students) studentOf[s.id] = s.name

  // ── 2. 반 구성 · 시간표
  const classStudents = classIds.length ? await fetchAllIn(classIds, (p, f, t) =>
    db.from('class_students').select('class_id, student_id').in('class_id', p).range(f, t)) : []
  const schedules = classIds.length ? await fetchAllIn(classIds, (p, f, t) =>
    db.from('class_schedules').select('class_id, day_of_week, start_time, end_time').in('class_id', p).range(f, t)) : []

  const classesOfStudent: Record<string, string[]> = {}
  for (const cs of classStudents) (classesOfStudent[cs.student_id] ??= []).push(classOf[cs.class_id] ?? '')

  // ── 3. 출결
  const sessions = classIds.length ? await fetchAllIn(classIds, (p, f, t) =>
    db.from('sessions').select('id, class_id, date, start_time, end_time, status, note').in('class_id', p).range(f, t)) : []
  const sessIds = sessions.map(s => s.id)
  const sessOf: Record<string, any> = {}
  for (const s of sessions) sessOf[s.id] = s
  const attendance = sessIds.length ? await fetchAllIn(sessIds, (p, f, t) =>
    db.from('attendance').select('session_id, student_id, status, late_minutes, early_leave_minutes, note').in('session_id', p).range(f, t)) : []

  // ── 4. 과제
  const homework = classIds.length ? await fetchAllIn(classIds, (p, f, t) =>
    db.from('homework').select('id, class_id, title, assigned_date, due_date, description').in('class_id', p).range(f, t)) : []
  const hwIds = homework.map(h => h.id)
  const hwOf: Record<string, any> = {}
  for (const h of homework) hwOf[h.id] = h
  const hwStatus = hwIds.length ? await fetchAllIn(hwIds, (p, f, t) =>
    db.from('homework_status').select('homework_id, student_id, status, note').in('homework_id', p).range(f, t)) : []

  // ── 5. 클리닉
  const clinicSessions = classIds.length ? await fetchAllIn(classIds, (p, f, t) =>
    db.from('clinic_sessions').select('id, class_id, date, name, note').in('class_id', p).range(f, t)) : []
  const csIds = clinicSessions.map(c => c.id)
  const csOf: Record<string, any> = {}
  for (const c of clinicSessions) csOf[c.id] = c
  const clinicAtt = csIds.length ? await fetchAllIn(csIds, (p, f, t) =>
    db.from('clinic_attendance').select('clinic_session_id, student_id, status').in('clinic_session_id', p).range(f, t)) : []

  // ── 6. 시험
  const exams = classIds.length ? await fetchAllIn(classIds, (p, f, t) =>
    db.from('exams').select('id, class_id, title, exam_type, category, status, start_at, max_score').in('class_id', p).range(f, t)) : []
  const examIds = exams.map(e => e.id)
  const examOf: Record<string, any> = {}
  for (const e of exams) examOf[e.id] = e
  const submissions = examIds.length ? await fetchAllIn(examIds, (p, f, t) =>
    db.from('exam_submissions').select('id, exam_id, student_id, submitted_at, is_submitted, auto_score, adjusted_score, is_forfeited, note').in('exam_id', p).range(f, t)) : []
  const subOf: Record<string, any> = {}
  for (const s of submissions) subOf[s.id] = s
  const questions = examIds.length ? await fetchAllIn(examIds, (p, f, t) =>
    db.from('exam_questions').select('id, exam_id, order_num, question_label, question_type, score').in('exam_id', p).range(f, t)) : []
  const qOf: Record<string, any> = {}
  for (const q of questions) qOf[q.id] = q
  const subIds = submissions.map(s => s.id)
  const answers = subIds.length ? await fetchAllIn(subIds, (p, f, t) =>
    db.from('exam_student_answers').select('submission_id, question_id, student_answer, is_correct, score_earned, manually_overridden').in('submission_id', p).range(f, t)) : []

  // ── 7. 목숨 · 선생님
  const livesLog = await fetchAll((f, t) => db.from('student_lives_log')
    .select('student_id, delta, reason, source, lives_after, created_at, hidden')
    .eq('academy_id', academyId).order('created_at').range(f, t))
  const teachers = await fetchAll((f, t) => db.from('academy_teachers')
    .select('role, title, profiles(name, phone)').eq('academy_id', academyId).range(f, t))

  // ──────────────────────────── 엑셀 만들기
  const wb = new ExcelJS.Workbook()
  wb.created = new Date()

  // 요약 시트를 가장 먼저 만들어 둔다 (엑셀은 추가한 순서대로 탭이 놓인다).
  // 내용은 다른 시트를 다 만든 뒤 채운다.
  const summaryWs = wb.addWorksheet('요약')

  function fill(ws: ExcelJS.Worksheet, headers: string[], rows: (string | number | null)[][], widths?: number[], filter = true) {
    ws.addRow(headers)
    ws.getRow(1).font = { bold: true }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    ws.columns = headers.map((h, i) => ({ width: widths?.[i] ?? Math.max(10, h.length * 2 + 4) }))
    for (const r of rows) ws.addRow(r)
    if (filter) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } }
    return ws
  }
  const sheet = (name: string, headers: string[], rows: (string | number | null)[][], widths?: number[]) =>
    fill(wb.addWorksheet(name), headers, rows, widths)

  // 만점 — 앱 화면과 같은 방식으로 문항 점수를 더해서 구한다.
  // 문항이 없는 수기 입력 시험만 exams.max_score 를 쓴다.
  const qSumByExam: Record<string, number> = {}
  for (const q of questions) qSumByExam[q.exam_id] = (qSumByExam[q.exam_id] ?? 0) + Number(q.score ?? 0)
  const maxScoreOf = (ex: any) => {
    if (!ex) return ''
    const sum = qSumByExam[ex.id] ?? 0
    return sum > 0 ? Math.round(sum * 100) / 100 : (ex.max_score ?? '')
  }

  const DOW = ['일', '월', '화', '수', '목', '금', '토']

  // 학생 명단
  sheet('학생 명단',
    ['이름', '학년', '학교', '상태', '소속 반', '학생 연락처', '학부모 연락처', '관계', '등록일', '퇴원일', '메모'],
    students.map(s => [
      s.name, s.grade ?? '', s.school_name ?? '',
      s.status === 'active' ? '재원' : '퇴원',
      (classesOfStudent[s.id] ?? []).join(', '),
      s.phone ?? '', s.parent_phone ?? '', s.parent_relation ?? '',
      fmtD(s.enrolled_at), fmtD(s.withdrawn_at), s.memo ?? '',
    ]),
    [12, 8, 16, 8, 24, 16, 16, 8, 12, 12, 30])

  // 반
  sheet('반',
    ['반 이름', '학생 수', '시간표'],
    classes.map(c => [
      c.name,
      classStudents.filter(cs => cs.class_id === c.id).length,
      schedules.filter(sc => sc.class_id === c.id)
        .sort((a, b) => a.day_of_week - b.day_of_week)
        .map(sc => `${DOW[sc.day_of_week]} ${String(sc.start_time).slice(0, 5)}~${String(sc.end_time).slice(0, 5)}`)
        .join(', '),
    ]),
    [20, 10, 50])

  // 출결
  sheet('출결',
    ['날짜', '반', '학생', '상태', '지각(분)', '조퇴(분)', '코멘트'],
    attendance.map(a => {
      const ss = sessOf[a.session_id]
      return [
        fmtD(ss?.date), classOf[ss?.class_id] ?? '', studentOf[a.student_id] ?? '',
        ATT_LABEL[a.status] ?? a.status,
        a.late_minutes ?? '', a.early_leave_minutes ?? '', a.note ?? '',
      ]
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    [12, 16, 12, 10, 10, 10, 30])

  // 과제
  sheet('과제',
    ['출제일', '반', '과제명', '학생', '수행', '코멘트'],
    hwStatus.map(h => {
      const hw = hwOf[h.homework_id]
      return [
        fmtD(hw?.assigned_date), classOf[hw?.class_id] ?? '', hw?.title ?? '',
        studentOf[h.student_id] ?? '', HW_LABEL[h.status] ?? h.status, h.note ?? '',
      ]
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    [12, 16, 36, 12, 16, 30])

  // 클리닉
  sheet('클리닉',
    ['날짜', '반', '클리닉명', '학생', '수행'],
    clinicAtt.map(c => {
      const cs = csOf[c.clinic_session_id]
      return [
        fmtD(cs?.date), classOf[cs?.class_id] ?? '', cs?.name ?? '클리닉',
        studentOf[c.student_id] ?? '', CL_LABEL[c.status] ?? c.status,
      ]
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    [12, 16, 24, 12, 10])

  // 시험 점수
  sheet('시험 점수',
    ['시험일', '반', '시험명', '분류', '학생', '제출', '자동 채점', '조정 점수', '최종 점수', '만점', '코멘트'],
    submissions.map(s => {
      const ex = examOf[s.exam_id]
      const final = s.adjusted_score ?? s.auto_score
      return [
        fmtD(ex?.start_at), classOf[ex?.class_id] ?? '', ex?.title ?? '', ex?.category ?? '',
        studentOf[s.student_id] ?? '',
        s.is_forfeited ? '시험 포기' : s.is_submitted ? '제출' : '미제출',
        s.auto_score ?? '', s.adjusted_score ?? '', final ?? '', maxScoreOf(ex), s.note ?? '',
      ]
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    [12, 16, 36, 12, 12, 10, 10, 10, 10, 8, 30])

  // 시험 문항별 답안
  sheet('시험 문항별 답안',
    ['시험명', '반', '학생', '문항', '제출 답안', '정답 여부', '획득 점수', '배점', '수동 정답처리'],
    answers.map(a => {
      const sub = subOf[a.submission_id]
      const ex  = sub ? examOf[sub.exam_id] : null
      const q   = qOf[a.question_id]
      return [
        ex?.title ?? '', classOf[ex?.class_id] ?? '', studentOf[sub?.student_id] ?? '',
        q?.question_label ?? (q?.order_num != null ? String(q.order_num) : ''),
        a.student_answer ?? '',
        a.is_correct === true ? 'O' : a.is_correct === false ? 'X' : '',
        a.score_earned ?? '', q?.score ?? '', a.manually_overridden ? 'O' : '',
      ]
    }),
    [36, 16, 12, 8, 20, 10, 10, 8, 12])

  // 목숨 내역
  sheet('목숨 내역',
    ['일시', '학생', '증감', '이후 목숨', '사유', '종류', '숨김'],
    livesLog.map(l => [
      fmtDT(l.created_at), studentOf[l.student_id] ?? '',
      l.delta, l.lives_after ?? '', l.reason ?? '',
      SRC_LABEL[l.source] ?? l.source, l.hidden ? 'O' : '',
    ]),
    [20, 12, 8, 10, 36, 12, 8])

  // 선생님
  sheet('선생님',
    ['이름', '직함', '권한', '연락처'],
    teachers.map((t: any) => [
      t.profiles?.name ?? '', t.title ?? '',
      t.role === 'owner' ? '원장' : '강사', t.profiles?.phone ?? '',
    ]),
    [12, 16, 10, 16])

  // 요약 — 맨 앞에 만들어 둔 시트를 이제 채운다
  fill(summaryWs,
    ['항목', '건수'],
    [
      ['내보낸 시각', new Date().toLocaleString('sv-SE', { timeZone: KST }).slice(0, 16)],
      ['학원', academy?.name ?? ''],
      ['반', classes.length],
      ['학생', students.length],
      ['수업', sessions.length],
      ['출결 기록', attendance.length],
      ['과제', homework.length],
      ['과제 수행 기록', hwStatus.length],
      ['클리닉', clinicSessions.length],
      ['클리닉 기록', clinicAtt.length],
      ['시험', exams.length],
      ['시험 제출', submissions.length],
      ['문항별 답안', answers.length],
      ['목숨 내역', livesLog.length],
      ['선생님', teachers.length],
    ],
    [20, 40], false)

  const buf = await wb.xlsx.writeBuffer()
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: KST })   // YYYY-MM-DD
  const korName = `${academy?.name ?? '학원'}_전체기록_${today}.xlsx`

  return new NextResponse(buf as any, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="linkademy-export-${today}.xlsx"; filename*=UTF-8''${encodeURIComponent(korName)}`,
      'Cache-Control': 'no-store',
    },
  })
}
