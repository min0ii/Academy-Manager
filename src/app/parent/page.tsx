'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Home, Calendar, BarChart2, BookOpen, LogOut,
  GraduationCap, User, ChevronLeft, ChevronRight,
  KeyRound, Eye, EyeOff, X, Check, MessageSquare,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'

type Tab = 'home' | 'attendance' | 'grades' | 'clinic' | 'comments'

type CommentRecord = {
  id: string
  date: string
  content: string
  teacher_name: string | null
}

type StudentInfo = {
  id: string
  name: string
  school_name: string | null
  grade: string | null
  phone: string | null
}

type ClassInfo = {
  id: string
  name: string
  teacher_name: string | null
  schedules: { day_of_week: number; start_time: string; end_time: string }[]
}

type AttendanceRecord = {
  date: string
  status: 'present' | 'absent' | 'late' | 'early_leave' | 'cancelled'
  late_minutes?: number
  early_leave_minutes?: number
}

type TestRecord = {
  name: string
  date: string
  maxScore: number
  myScore: number | null
  myPct: number | null
  avgScore: number | null
  classHigh: number | null
  classLow: number | null
  absent: boolean
}

type ClinicRecord = {
  id: string
  clinic_name: string | null
  date: string
  note: string | null
  status: 'done' | 'not_done' | null
}

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']

const ATTEND_STYLE: Record<string, { label: string; color: string; dot: string }> = {
  present:     { label: '출석', color: 'text-emerald-600', dot: 'bg-emerald-500' },
  late:        { label: '지각', color: 'text-amber-600',   dot: 'bg-amber-400' },
  early_leave: { label: '조퇴', color: 'text-blue-600',    dot: 'bg-blue-400' },
  absent:      { label: '결석', color: 'text-red-600',     dot: 'bg-red-500' },
  cancelled:   { label: '휴강', color: 'text-slate-400',   dot: 'bg-slate-300' },
}


const CLINIC_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  done:     { label: '완료',   color: 'text-emerald-700', bg: 'bg-emerald-50' },
  not_done: { label: '미완료', color: 'text-red-700',     bg: 'bg-red-50' },
}

export default function ParentPage() {
  const [tab, setTab] = useState<Tab>('home')
  const [loading, setLoading] = useState(true)
  const [parentName, setParentName] = useState('')
  const [student, setStudent] = useState<StudentInfo | null>(null)
  const [classInfo, setClassInfo] = useState<ClassInfo | null>(null)
  const [academyName, setAcademyName] = useState('')

  // 비밀번호 변경 안내
  const [mustChangePw, setMustChangePw] = useState(false)
  const [showPwModal, setShowPwModal] = useState(false)
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showNewPw, setShowNewPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwDone, setPwDone] = useState(false)

  // 출석
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [calMonth, setCalMonth] = useState(() => new Date())
  const [attendLoaded, setAttendLoaded] = useState(false)

  // 성적
  const [tests, setTests] = useState<TestRecord[]>([])
  const [gradesLoaded, setGradesLoaded] = useState(false)
  const [gradesLoading, setGradesLoading] = useState(false)

  // 클리닉
  const [clinics, setClinics] = useState<ClinicRecord[]>([])
  const [clinicLoaded, setClinicLoaded] = useState(false)
  const [clinicLoading, setClinicLoading] = useState(false)

  // 코멘트
  const [commentList, setCommentList]   = useState<CommentRecord[]>([])
  const [commentsLoaded, setCommentsLoaded] = useState(false)
  const [commentsLoading, setCommentsLoading] = useState(false)

  useEffect(() => { loadBase() }, [])

  useEffect(() => {
    if (tab === 'attendance' && !attendLoaded && student && classInfo) loadAttendance()
    if (tab === 'grades' && !gradesLoaded && student && classInfo) loadGrades()
    if (tab === 'clinic' && !clinicLoaded && student && classInfo) loadClinics()
    if (tab === 'comments' && !commentsLoaded && student) loadComments()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, student, classInfo])

  async function loadBase() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const { data: profile } = await supabase
      .from('profiles')
      .select('name, phone, must_change_password')
      .eq('id', user.id)
      .single()

    if (profile) {
      setParentName(profile.name)
      if (profile.must_change_password) {
        setMustChangePw(true)
        setShowPwModal(true)
      }
    }

    const parentPhone = profile?.phone ?? ''

    // 자녀 찾기 (parent_phone 으로 연결)
    const { data: studentData } = await supabase
      .from('students')
      .select('id, name, school_name, grade, phone')
      .eq('parent_phone', parentPhone)
      .maybeSingle()

    if (studentData) {
      setStudent(studentData)
      await loadClassInfo(studentData.id)
    }

    setLoading(false)
  }

  async function loadClassInfo(studentId: string) {
    // classes.academy_id 를 통해 academies.name 을 직접 조인
    const { data: classStudents } = await supabase
      .from('class_students')
      .select(`
        class_id,
        classes(
          id, name, academy_id, teacher_id,
          academies(name),
          class_schedules(day_of_week, start_time, end_time)
        )
      `)
      .eq('student_id', studentId)

    if (!classStudents || classStudents.length === 0) return

    const cls = (classStudents[0] as any).classes
    if (!cls) return

    // 학원 이름 — classes.academy_id → academies.name (teacher_id 컬럼 불필요)
    const acName = cls.academies?.name ?? ''
    setAcademyName(acName)

    // 담당 선생님 이름 (classes.teacher_id 컬럼이 있을 때만)
    let teacherName: string | null = null
    if (cls.teacher_id) {
      const { data: tp } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', cls.teacher_id)
        .single()
      teacherName = tp?.name ?? null
    }

    setClassInfo({
      id: cls.id,
      name: cls.name,
      teacher_name: teacherName,
      schedules: cls.class_schedules ?? [],
    })
  }

  async function loadAttendance() {
    if (!student || !classInfo) return
    setAttendLoaded(true)

    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const fromDate = sixMonthsAgo.toISOString().slice(0, 10)

    const { data: sessions } = await supabase
      .from('sessions')
      .select('id, date, status, attendance(student_id, status, late_minutes, early_leave_minutes)')
      .eq('class_id', classInfo.id)
      .gte('date', fromDate)
      .order('date', { ascending: false })

    const records: AttendanceRecord[] = (sessions ?? []).map((s: any) => {
      if (s.status === 'cancelled') return { date: s.date, status: 'cancelled' as const }
      const my = (s.attendance ?? []).find((a: any) => a.student_id === student.id)
      return {
        date: s.date,
        status: (my?.status ?? 'absent') as AttendanceRecord['status'],
        late_minutes: my?.late_minutes,
        early_leave_minutes: my?.early_leave_minutes,
      }
    })

    setAttendance(records)
  }

  async function loadGrades() {
    if (!student || !classInfo) return
    setGradesLoaded(true)
    setGradesLoading(true)

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { setGradesLoading(false); return }

    const res = await fetch(
      `/api/grades?action=parent-chart&classId=${classInfo.id}&studentId=${student.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const json = await res.json()
    setTests(json.records ?? [])
    setGradesLoading(false)
  }

  async function loadComments() {
    if (!student) return
    setCommentsLoaded(true)
    setCommentsLoading(true)

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { setCommentsLoading(false); return }

    const res = await fetch(
      `/api/grades?action=parent-comments&studentId=${student.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const json = await res.json()
    setCommentList(json.records ?? [])
    setCommentsLoading(false)
  }

  async function loadClinics() {
    if (!student || !classInfo) return
    setClinicLoaded(true)
    setClinicLoading(true)

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { setClinicLoading(false); return }

    const res = await fetch(
      `/api/grades?action=parent-clinic&classId=${classInfo.id}&studentId=${student.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const json = await res.json()
    setClinics(json.records ?? [])
    setClinicLoading(false)
  }

  async function handleChangePw(e: React.FormEvent) {
    e.preventDefault()
    setPwError('')
    if (newPw.length < 6) { setPwError('비밀번호는 6자 이상이어야 해요.'); return }
    if (newPw !== confirmPw) { setPwError('비밀번호가 일치하지 않아요.'); return }
    setPwSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPw })
    if (error) { setPwError(error.message); setPwSaving(false); return }
    // must_change_password = false 로 업데이트
    const { data: { user } } = await supabase.auth.getUser()
    if (user) await supabase.from('profiles').update({ must_change_password: false }).eq('id', user.id)
    setPwSaving(false)
    setPwDone(true)
    setMustChangePw(false)
    setTimeout(() => { setShowPwModal(false); setPwDone(false); setNewPw(''); setConfirmPw('') }, 1800)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  // ── 달력 ──
  function getCalendarDays() {
    const year = calMonth.getFullYear()
    const month = calMonth.getMonth()
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const days: (number | null)[] = []
    for (let i = 0; i < firstDay; i++) days.push(null)
    for (let d = 1; d <= daysInMonth; d++) days.push(d)
    return days
  }

  function getAttendForDay(day: number): AttendanceRecord | undefined {
    const y = calMonth.getFullYear()
    const m = String(calMonth.getMonth() + 1).padStart(2, '0')
    const d = String(day).padStart(2, '0')
    return attendance.find(a => a.date === `${y}-${m}-${d}`)
  }

  // ── 출석 통계 ──
  const heldAttend = attendance.filter(a => a.status !== 'cancelled')
  const attendStats = {
    total: heldAttend.length,
    present: heldAttend.filter(a => a.status === 'present').length,
    late: heldAttend.filter(a => a.status === 'late').length,
    earlyLeave: heldAttend.filter(a => a.status === 'early_leave').length,
    absent: heldAttend.filter(a => a.status === 'absent').length,
  }
  const attendRate = attendStats.total > 0
    ? Math.round((attendStats.present + attendStats.late + attendStats.earlyLeave) / attendStats.total * 100)
    : null

  // ── 성적 통계 ──
  const scoredTests = tests.filter(t => !t.absent && t.myScore !== null)
  // 반올림 오차 방지: 개별 퍼센트 먼저 반올림 않고 합산 후 한 번만 반올림
  const pcts = scoredTests.map(t => (t.myScore! / t.maxScore) * 100)
  const avgPct = pcts.length > 0 ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null
  const maxPct = pcts.length > 0 ? Math.round(Math.max(...pcts)) : null
  const minPct = pcts.length > 0 ? Math.round(Math.min(...pcts)) : null

  const chartData = scoredTests.map(t => ({
    label: `${t.date.slice(5)} ${t.name}`,
    pct: Math.round((t.myScore! / t.maxScore) * 100),
  }))

  // ── 클리닉 통계 ──
  const statusClinics = clinics.filter(c => c.status !== null)
  const clinicDone = statusClinics.filter(c => c.status === 'done').length
  const clinicRate = statusClinics.length > 0 ? Math.round(clinicDone / statusClinics.length * 100) : null

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-400 text-sm">불러오는 중...</div>
      </div>
    )
  }

  const TABS: { key: Tab; label: string; Icon: React.ElementType }[] = [
    { key: 'home',       label: '홈',    Icon: Home },
    { key: 'attendance', label: '출석',  Icon: Calendar },
    { key: 'grades',     label: '성적',  Icon: BarChart2 },
    { key: 'clinic',     label: '클리닉', Icon: BookOpen },
    { key: 'comments',   label: '코멘트', Icon: MessageSquare },
  ]

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* 헤더 */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center">
            <GraduationCap size={15} className="text-white" />
          </div>
          <span className="text-sm font-bold text-slate-800">{academyName || '학원'}</span>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-1.5 text-slate-400 hover:text-slate-600 text-sm transition-colors"
        >
          <LogOut size={15} />
          <span className="hidden sm:block">로그아웃</span>
        </button>
      </header>

      {/* 비밀번호 변경 배너 (모달 닫은 후에도 상단에 표시) */}
      {mustChangePw && !showPwModal && (
        <div
          onClick={() => setShowPwModal(true)}
          className="bg-amber-500 text-white text-xs text-center py-2.5 px-4 font-medium cursor-pointer hover:bg-amber-600 transition-colors"
        >
          🔒 초기 비밀번호를 사용 중이에요. 탭하여 비밀번호를 변경해주세요.
        </div>
      )}

      {/* 콘텐츠 */}
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-5 pb-28 space-y-4">

        {/* ── 홈 ── */}
        {tab === 'home' && (
          <>
            <div className="bg-gradient-to-br from-violet-600 to-violet-800 rounded-2xl p-5 text-white">
              <p className="text-violet-200 text-sm">안녕하세요 👋</p>
              <h1 className="text-xl font-bold mt-1">
                {student ? `${student.name} 학부모님` : parentName || '학부모님'}
              </h1>
              <p className="text-violet-200 text-xs mt-2">환영합니다!</p>
            </div>

            {student ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                <h2 className="font-bold text-slate-800 text-sm">자녀 정보</h2>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
                    <User size={22} className="text-violet-600" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">{student.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {[student.school_name, student.grade ? `${student.grade}학년` : null]
                        .filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>

                {classInfo ? (
                  <div className="bg-slate-50 rounded-xl p-4 space-y-2.5">
                    <InfoRow label="소속 반" value={classInfo.name} />
                    {classInfo.teacher_name && (
                      <InfoRow label="담당 선생님" value={classInfo.teacher_name} />
                    )}
                    {classInfo.schedules.length > 0 && (
                      <div className="flex items-start gap-2.5">
                        <span className="text-xs text-slate-500 w-20 flex-shrink-0 pt-0.5">정기 수업</span>
                        <div className="space-y-0.5">
                          {classInfo.schedules.map((s, i) => (
                            <p key={i} className="text-sm text-slate-700">
                              매주 {DAY_NAMES[s.day_of_week]}요일&nbsp;
                              {s.start_time.slice(0, 5)}~{s.end_time.slice(0, 5)}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-slate-50 rounded-xl px-4 py-3 text-xs text-slate-400 text-center">
                    아직 배정된 반이 없어요
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
                <p className="text-slate-400 text-sm">연결된 자녀 정보를 찾을 수 없어요.</p>
                <p className="text-slate-300 text-xs mt-1">선생님께 학부모 연락처를 등록해 달라고 해주세요.</p>
              </div>
            )}

            {student && classInfo && (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'attendance' as Tab, label: '출석 확인', colorCls: 'bg-emerald-50 text-emerald-700', Icon: Calendar },
                  { key: 'grades'     as Tab, label: '성적 확인', colorCls: 'bg-blue-50 text-blue-700',     Icon: BarChart2 },
                  { key: 'clinic'     as Tab, label: '클리닉',    colorCls: 'bg-amber-50 text-amber-700',   Icon: BookOpen },
                  { key: 'comments'   as Tab, label: '코멘트',    colorCls: 'bg-violet-50 text-violet-700', Icon: MessageSquare },
                ].map(({ key, label, colorCls, Icon }) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`rounded-xl p-4 text-center space-y-1.5 hover:opacity-80 transition-opacity ${colorCls}`}
                  >
                    <Icon size={20} className="mx-auto" />
                    <p className="text-xs font-semibold">{label}</p>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── 출석 ── */}
        {tab === 'attendance' && (
          <>
            {!classInfo ? (
              <NoClass />
            ) : (
              <>
                {/* 통계 */}
                <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                  <h2 className="font-bold text-slate-800 text-sm">출석 현황</h2>
                  {attendRate !== null && (
                    <div className="flex items-end gap-2">
                      <span className="text-4xl font-black text-emerald-600">{attendRate}%</span>
                      <span className="text-slate-400 text-sm pb-1">출석률</span>
                    </div>
                  )}
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: '출석', value: attendStats.present,    color: 'text-emerald-600' },
                      { label: '지각', value: attendStats.late,       color: 'text-amber-600' },
                      { label: '조퇴', value: attendStats.earlyLeave, color: 'text-blue-600' },
                      { label: '결석', value: attendStats.absent,     color: 'text-red-600' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-slate-50 rounded-xl p-3 text-center">
                        <p className={`text-xl font-bold ${color}`}>{value}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 달력 */}
                <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => setCalMonth(m => { const n = new Date(m); n.setMonth(n.getMonth() - 1); return n })}
                      className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                      <ChevronLeft size={16} className="text-slate-500" />
                    </button>
                    <h3 className="font-bold text-slate-800 text-sm">
                      {calMonth.getFullYear()}년 {calMonth.getMonth() + 1}월
                    </h3>
                    <button
                      onClick={() => setCalMonth(m => { const n = new Date(m); n.setMonth(n.getMonth() + 1); return n })}
                      className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                      <ChevronRight size={16} className="text-slate-500" />
                    </button>
                  </div>

                  <div className="grid grid-cols-7 text-center text-xs font-semibold">
                    {['일','월','화','수','목','금','토'].map((d, i) => (
                      <div key={d} className={`py-1 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-slate-400'}`}>{d}</div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-0.5">
                    {getCalendarDays().map((day, i) => {
                      if (day === null) return <div key={i} />
                      const record = getAttendForDay(day)
                      const today = new Date()
                      const isToday = today.getFullYear() === calMonth.getFullYear() &&
                        today.getMonth() === calMonth.getMonth() &&
                        today.getDate() === day
                      const dow = i % 7
                      return (
                        <div key={i} className="flex flex-col items-center py-1.5 gap-1">
                          <span className={`text-xs font-medium leading-none ${
                            isToday
                              ? 'bg-violet-600 text-white rounded-full w-6 h-6 flex items-center justify-center'
                              : dow === 0 ? 'text-red-400'
                              : dow === 6 ? 'text-blue-400'
                              : 'text-slate-700'
                          }`}>
                            {day}
                          </span>
                          {record && (
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${ATTEND_STYLE[record.status]?.dot ?? 'bg-slate-300'}`}
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* 범례 */}
                  <div className="flex flex-wrap gap-3 pt-1 border-t border-slate-100">
                    {Object.entries(ATTEND_STYLE).map(([key, val]) => (
                      <div key={key} className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${val.dot}`} />
                        <span className="text-xs text-slate-500">{val.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 최근 기록 */}
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100">
                    <h2 className="font-bold text-slate-800 text-sm">출결 기록</h2>
                  </div>
                  {heldAttend.length === 0 ? (
                    <div className="px-5 py-8 text-center text-slate-400 text-sm">출결 기록이 없어요</div>
                  ) : (
                    <div className="divide-y divide-slate-50">
                      {heldAttend.slice(0, 30).map((a, i) => {
                        const style = ATTEND_STYLE[a.status]
                        return (
                          <div key={i} className="flex items-center gap-3 px-5 py-3">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
                            <span className="text-sm text-slate-700 flex-1">{a.date.replace(/-/g, '. ')}</span>
                            <span className={`text-xs font-semibold ${style.color}`}>
                              {style.label}
                              {a.status === 'late' && a.late_minutes ? ` ${a.late_minutes}분` : ''}
                              {a.status === 'early_leave' && a.early_leave_minutes ? ` ${a.early_leave_minutes}분` : ''}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* ── 성적 ── */}
        {tab === 'grades' && (
          <>
            {!classInfo ? (
              <NoClass />
            ) : (
              <>
                {scoredTests.length > 0 && (
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                    <h2 className="font-bold text-slate-800 text-sm">성적 요약</h2>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: '평균 득점률', value: avgPct !== null ? `${avgPct}%` : '-', color: 'text-blue-700' },
                        { label: '최고 득점률', value: maxPct !== null ? `${maxPct}%` : '-', color: 'text-emerald-700' },
                        { label: '최저 득점률', value: minPct !== null ? `${minPct}%` : '-', color: 'text-red-600' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-slate-50 rounded-xl p-3 text-center">
                          <p className={`text-2xl font-black ${color}`}>{value}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {chartData.length >= 2 && (
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                    <h2 className="font-bold text-slate-800 text-sm">성적 추이</h2>
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 10, fill: '#94a3b8' }}
                          tickFormatter={v => v.slice(0, 5)}
                        />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} unit="%" />
                        <Tooltip
                          formatter={(v) => [`${v ?? 0}%`, '점수']}
                          contentStyle={{ fontSize: 12, borderRadius: 8 }}
                        />
                        {avgPct !== null && (
                          <ReferenceLine y={avgPct} stroke="#3b82f6" strokeDasharray="4 4" />
                        )}
                        <Line
                          type="monotone"
                          dataKey="pct"
                          stroke="#7c3aed"
                          strokeWidth={2}
                          dot={{ r: 4, fill: '#7c3aed' }}
                          activeDot={{ r: 6 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                    {avgPct !== null && (
                      <p className="text-xs text-slate-400 text-center">
                        점선은 평균({avgPct}%)
                      </p>
                    )}
                  </div>
                )}

                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100">
                    <h2 className="font-bold text-slate-800 text-sm">전체 성적 기록</h2>
                  </div>
                  {gradesLoading ? (
                    <div className="px-5 py-8 text-center text-slate-400 text-sm">불러오는 중...</div>
                  ) : tests.length === 0 ? (
                    <div className="px-5 py-8 text-center text-slate-400 text-sm">성적 기록이 없어요</div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {[...tests].reverse().map((t, i) => {
                        return (
                          <div key={i} className="px-5 py-4">
                            {/* 시험명 + 날짜 */}
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-slate-800 truncate">{t.name}</p>
                                <p className="text-xs text-slate-400 mt-0.5">{t.date.replace(/-/g, '. ')} · 만점 {t.maxScore}점</p>
                              </div>
                              {t.absent ? (
                                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-lg flex-shrink-0">결시</span>
                              ) : t.myScore !== null ? (
                                <div className="text-right flex-shrink-0">
                                  <p className={`text-base font-black ${
                                    t.myPct !== null && t.myPct >= 80 ? 'text-emerald-600'
                                    : t.myPct !== null && t.myPct >= 60 ? 'text-blue-600'
                                    : 'text-red-600'
                                  }`}>
                                    {t.myScore}점
                                  </p>
                                  <p className="text-xs text-slate-400">{t.myPct}%</p>
                                </div>
                              ) : (
                                <span className="text-xs text-slate-400 flex-shrink-0">미입력</span>
                              )}
                            </div>
                            {/* 반 통계 */}
                            {(t.avgScore !== null || t.classHigh !== null) && (
                              <div className="flex gap-3 text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-2">
                                <span>반평균 <strong className="text-slate-700">{t.avgScore !== null ? `${t.avgScore}점` : '-'}</strong></span>
                                <span className="text-slate-300">|</span>
                                <span>최고 <strong className="text-emerald-600">{t.classHigh !== null ? `${t.classHigh}점` : '-'}</strong></span>
                                <span className="text-slate-300">|</span>
                                <span>최저 <strong className="text-red-500">{t.classLow !== null ? `${t.classLow}점` : '-'}</strong></span>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* ── 클리닉 ── */}
        {tab === 'clinic' && (
          <>
            {!classInfo ? (
              <NoClass />
            ) : clinicLoading ? (
              <div className="bg-white rounded-2xl border border-slate-200 px-5 py-10 text-center text-slate-400 text-sm">
                불러오는 중...
              </div>
            ) : (
              <>
                {/* 현황 요약 — 기록된 항목이 하나라도 있을 때만 */}
                {clinics.some(c => c.status !== null) && (
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                    <h2 className="font-bold text-slate-800 text-sm">클리닉 현황</h2>
                    <div className="flex items-end gap-2">
                      <span className="text-4xl font-black text-amber-600">{clinicRate ?? 0}%</span>
                      <span className="text-slate-400 text-sm pb-1">완료율</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: '완료',   value: clinics.filter(c => c.status === 'done').length,     color: 'text-emerald-600' },
                        { label: '미완료', value: clinics.filter(c => c.status === 'not_done').length, color: 'text-red-600' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-slate-50 rounded-xl p-3 text-center">
                          <p className={`text-xl font-bold ${color}`}>{value}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100">
                    <h2 className="font-bold text-slate-800 text-sm">클리닉 기록</h2>
                  </div>
                  {clinics.length === 0 ? (
                    <div className="px-5 py-8 text-center text-slate-400 text-sm">클리닉 기록이 없어요</div>
                  ) : (
                    <div className="divide-y divide-slate-50">
                      {clinics.map((c, i) => {
                        const style = c.status ? CLINIC_STYLE[c.status] : null
                        return (
                          <div key={c.id ?? i} className="flex items-center gap-3 px-5 py-3.5">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-800 truncate">
                                {c.clinic_name ?? '클리닉'}
                              </p>
                              <p className="text-xs text-slate-400 mt-0.5">{c.date.replace(/-/g, '. ')}</p>
                              {c.note && (
                                <p className="text-xs text-slate-400 mt-0.5 truncate">{c.note}</p>
                              )}
                            </div>
                            {style ? (
                              <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg flex-shrink-0 ${style.bg} ${style.color}`}>
                                {style.label}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400 bg-slate-100 px-2.5 py-1 rounded-lg flex-shrink-0">
                                기록 안됨
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* ── 코멘트 ── */}
        {tab === 'comments' && (
          <>
            {!student ? (
              <NoClass />
            ) : commentsLoading ? (
              <div className="bg-white rounded-2xl border border-slate-200 px-5 py-10 text-center text-slate-400 text-sm">
                불러오는 중...
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                  <MessageSquare size={16} className="text-violet-500" />
                  <h2 className="font-bold text-slate-800 text-sm">선생님 코멘트</h2>
                </div>
                {commentList.length === 0 ? (
                  <div className="px-5 py-12 text-center">
                    <MessageSquare size={32} className="mx-auto text-slate-200 mb-3" />
                    <p className="text-slate-400 text-sm">아직 작성된 코멘트가 없어요</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {commentList.map((c) => (
                      <div key={c.id} className="px-5 py-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-slate-400">{c.date.replace(/-/g, '. ')}</span>
                          {c.teacher_name && (
                            <span className="text-xs font-medium text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">
                              {c.teacher_name} 선생님
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{c.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* 하단 탭바 */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex z-10 safe-area-bottom">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${
              tab === key ? 'text-violet-600' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <Icon size={20} />
            <span className="text-xs font-medium">{label}</span>
          </button>
        ))}
      </nav>

      {/* 비밀번호 변경 모달 */}
      {showPwModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound size={18} className="text-amber-500" />
                <h2 className="font-bold text-slate-800">비밀번호 변경</h2>
              </div>
              {!mustChangePw && (
                <button onClick={() => setShowPwModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X size={18} />
                </button>
              )}
            </div>

            {pwDone ? (
              <div className="p-8 flex flex-col items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                  <Check size={28} className="text-emerald-600" />
                </div>
                <p className="font-bold text-slate-800">변경 완료!</p>
                <p className="text-xs text-slate-400">새 비밀번호로 로그인할 수 있어요.</p>
              </div>
            ) : (
              <form onSubmit={handleChangePw} className="p-5 space-y-4">
                <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                  <p className="text-xs text-amber-700 leading-relaxed">
                    현재 <span className="font-semibold">초기 비밀번호</span>(전화번호 뒤 8자리)를 사용 중이에요.<br />
                    보안을 위해 새 비밀번호로 변경해주세요.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">새 비밀번호</label>
                  <div className="relative">
                    <input
                      type={showNewPw ? 'text' : 'password'}
                      value={newPw}
                      onChange={e => setNewPw(e.target.value)}
                      placeholder="6자 이상"
                      required
                      className="w-full px-3 py-2.5 pr-10 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <button type="button" onClick={() => setShowNewPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                      {showNewPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">비밀번호 확인</label>
                  <div className="relative">
                    <input
                      type={showConfirmPw ? 'text' : 'password'}
                      value={confirmPw}
                      onChange={e => setConfirmPw(e.target.value)}
                      placeholder="비밀번호 재입력"
                      required
                      className="w-full px-3 py-2.5 pr-10 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <button type="button" onClick={() => setShowConfirmPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                      {showConfirmPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                {pwError && <p className="text-red-500 text-xs bg-red-50 px-3 py-2 rounded-lg">{pwError}</p>}
                <div className="flex gap-2 pt-1">
                  {!mustChangePw && (
                    <button type="button" onClick={() => setShowPwModal(false)}
                      className="flex-1 py-2.5 border border-slate-200 text-slate-600 font-medium rounded-xl text-sm">
                      나중에
                    </button>
                  )}
                  <button type="submit" disabled={pwSaving}
                    className="flex-1 py-2.5 bg-amber-500 text-white font-semibold rounded-xl hover:bg-amber-600 transition-colors text-sm disabled:opacity-50">
                    {pwSaving ? '변경 중...' : '변경하기'}
                  </button>
                </div>
                {mustChangePw && (
                  <p className="text-xs text-slate-400 text-center">
                    비밀번호를 변경해야 이용할 수 있어요
                  </p>
                )}
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 작은 공용 컴포넌트 ──
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="text-xs text-slate-500 w-20 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm font-semibold text-slate-800">{value}</span>
    </div>
  )
}

function NoClass() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-slate-400 text-sm">
      배정된 반 정보가 없어요
    </div>
  )
}
