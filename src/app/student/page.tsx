'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  Home, Calendar, BarChart2, LogOut,
  GraduationCap, User, ChevronLeft, ChevronRight,
  KeyRound, Eye, EyeOff, X, Check, FileText, ClipboardList, Settings, ShieldQuestion,
} from 'lucide-react'
import ExamTab from './ExamTab'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
} from 'recharts'

type Tab = 'home' | 'attendance' | 'grades' | 'homework-clinic' | 'exam' | 'settings'
type HwClinicSub = 'homework' | 'clinic'

type StudentInfo = {
  id: string; name: string; school_name: string | null; grade: string | null; phone: string | null
}
type ClassInfo = {
  id: string; name: string; teacher_name: string | null
  schedules: { day_of_week: number; start_time: string; end_time: string }[]
}
type AttendanceRecord = {
  date: string
  status: 'present' | 'absent' | 'late' | 'early_leave' | 'cancelled'
  late_minutes?: number; early_leave_minutes?: number
}
type TestRecord = {
  name: string; date: string; maxScore: number | null
  myScore: number | null; myPct: number | null
  avgScore: number | null; avgPct: number | null; classHigh: number | null; classLow: number | null; absent: boolean
  examId?: string; examType?: string; answerReveal?: string
}

type ExamResultQuestion = {
  id: string; order_num: number; question_text: string | null
  question_type: 'multiple_choice' | 'short_answer'; score: number
}
type ExamResultChoice = { question_id: string; choice_num: number; choice_text: string | null }
type ExamResultAnswer = { question_id: string; student_answer: string | null; is_correct: boolean | null; score_earned: number | null }
type ExamResultCorrect = { question_id: string; answer_text: string; order_num: number }
type ExamResult = {
  examType: string; title: string; maxScore: number | null; myScore: number | null
  isAbsent: boolean; answerReveal: string; canReveal: boolean
  questions: ExamResultQuestion[]
  choices: ExamResultChoice[]
  myAnswers: ExamResultAnswer[]
  correctAnswers: ExamResultCorrect[]
}
type ClinicRecord = {
  id: string; clinic_name: string | null; date: string
  note: string | null; status: 'done' | 'not_done' | null
}
type HomeworkRecord = {
  id: string; title: string; assigned_date: string
  due_date: string | null; description: string | null
  status: 'done' | 'partial' | 'none' | null
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
const HW_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  done:    { label: '완료',    color: 'text-emerald-700', bg: 'bg-emerald-50' },
  partial: { label: '부분완료', color: 'text-amber-700',  bg: 'bg-amber-50' },
  none:    { label: '미완료',  color: 'text-red-700',     bg: 'bg-red-50' },
}

export default function StudentPage() {
  const router = useRouter()
  const [tab, setTab]         = useState<Tab>('home')
  const [loading, setLoading] = useState(true)
  const [student, setStudent]     = useState<StudentInfo | null>(null)
  const [classInfo, setClassInfo] = useState<ClassInfo | null>(null)
  const [academyName, setAcademyName] = useState('')

  // 비밀번호 변경
  // pwStep: 'pw' → 비밀번호 입력, 'sq' → 보안질문 설정(mustChangePw일 때만), 'done' → 완료
  const [mustChangePw, setMustChangePw] = useState(false)
  const [showPwModal, setShowPwModal]   = useState(false)
  const [pwStep, setPwStep]             = useState<'pw' | 'sq' | 'done'>('pw')
  const [newPw, setNewPw]               = useState('')
  const [confirmPw, setConfirmPw]       = useState('')
  const [showNewPw, setShowNewPw]       = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [pwError, setPwError]   = useState('')
  const [pwSaving, setPwSaving] = useState(false)

  // 출석
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [calMonth, setCalMonth]     = useState(() => new Date())
  const [attendLoaded, setAttendLoaded] = useState(false)

  // 성적
  const [tests, setTests]             = useState<TestRecord[]>([])
  const [gradesLoaded, setGradesLoaded]   = useState(false)
  const [gradesLoading, setGradesLoading] = useState(false)

  // 시험 결과 상세 모달
  const [examResultModal, setExamResultModal] = useState<ExamResult | null>(null)
  const [loadingExamResult, setLoadingExamResult] = useState(false)

  // 설정 — 계정 탈퇴
  const [showDeleteModal, setShowDeleteModal]     = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting]                   = useState(false)
  const [deleteError, setDeleteError]             = useState('')

  // 설정 — 보안 질문
  const [currentSQ, setCurrentSQ]         = useState<string | null>(null)
  const [sqLoaded, setSqLoaded]           = useState(false)
  const [showSqModal, setShowSqModal]     = useState(false)
  const [sqQuestion, setSqQuestion]       = useState('')
  const [sqAnswer, setSqAnswer]           = useState('')
  const [sqSaving, setSqSaving]           = useState(false)
  const [sqSaved, setSqSaved]             = useState(false)
  const [sqError, setSqError]             = useState('')

  // 과제·클리닉
  const [hwClinicSub, setHwClinicSub]   = useState<HwClinicSub>('homework')
  const [homeworks, setHomeworks]       = useState<HomeworkRecord[]>([])
  const [hwLoaded, setHwLoaded]         = useState(false)
  const [hwLoading, setHwLoading]       = useState(false)
  const [clinics, setClinics]           = useState<ClinicRecord[]>([])
  const [clinicLoaded, setClinicLoaded] = useState(false)
  const [clinicLoading, setClinicLoading] = useState(false)

  useEffect(() => { loadBase() }, [])

  useEffect(() => {
    if (!student || !classInfo) return
    if (tab === 'attendance' && !attendLoaded) loadAttendance()
    if (tab === 'grades'     && !gradesLoaded) loadGrades()
    if (tab === 'homework-clinic') {
      if (hwClinicSub === 'homework' && !hwLoaded)     loadHomework()
      if (hwClinicSub === 'clinic'   && !clinicLoaded) loadClinics()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, hwClinicSub, student, classInfo])

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }

  async function loadBase() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/login'); return }

    const { data: profile } = await supabase
      .from('profiles').select('role, must_change_password, security_question').eq('id', user.id).single()

    if (!profile || profile.role !== 'student') {
      if (profile?.role === 'teacher') router.replace('/dashboard')
      else if (profile?.role === 'parent') router.replace('/parent')
      else router.replace('/login')
      return
    }

    if (profile.must_change_password) { setMustChangePw(true); setShowPwModal(true) }
    setCurrentSQ(profile.security_question ?? null)
    setSqLoaded(true)

    const token = await getToken()
    if (!token) { setLoading(false); return }

    const res = await fetch('/api/student', { headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json()

    if (json.student)    setStudent(json.student)
    if (json.classInfo)  setClassInfo(json.classInfo)
    if (json.academyName) setAcademyName(json.academyName)

    setLoading(false)
  }

  async function loadAttendance() {
    if (!student || !classInfo) return
    setAttendLoaded(true)
    const token = await getToken(); if (!token) return
    const res = await fetch(
      `/api/grades?action=my-attendance&classId=${classInfo.id}&studentId=${student.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const json = await res.json()
    setAttendance((json.records ?? []).map((r: any) => ({
      date: r.date, status: r.status as AttendanceRecord['status'],
      late_minutes: r.late_minutes ?? undefined, early_leave_minutes: r.early_leave_minutes ?? undefined,
    })))
  }

  async function loadGrades() {
    if (!student || !classInfo) return
    setGradesLoaded(true); setGradesLoading(true)
    const token = await getToken(); if (!token) { setGradesLoading(false); return }
    const res = await fetch(`/api/grades?action=my-grades&classId=${classInfo.id}&studentId=${student.id}`,
      { headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json()
    setTests(json.records ?? []); setGradesLoading(false)
  }

  async function openExamResult(examId: string) {
    if (!student) return
    setLoadingExamResult(true)
    const token = await getToken(); if (!token) { setLoadingExamResult(false); return }
    const res = await fetch(`/api/exams/${examId}/student-result?studentId=${student.id}`,
      { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      const data = await res.json()
      setExamResultModal(data)
    }
    setLoadingExamResult(false)
  }

  async function loadHomework() {
    if (!student || !classInfo) return
    setHwLoaded(true); setHwLoading(true)
    const token = await getToken(); if (!token) { setHwLoading(false); return }
    const res = await fetch(`/api/grades?action=my-homework&classId=${classInfo.id}&studentId=${student.id}`,
      { headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json()
    setHomeworks(json.records ?? []); setHwLoading(false)
  }

  async function loadClinics() {
    if (!student || !classInfo) return
    setClinicLoaded(true); setClinicLoading(true)
    const token = await getToken(); if (!token) { setClinicLoading(false); return }
    const res = await fetch(`/api/grades?action=my-clinic&classId=${classInfo.id}&studentId=${student.id}`,
      { headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json()
    setClinics(json.records ?? []); setClinicLoading(false)
  }

  async function handleChangePw(e: React.FormEvent) {
    e.preventDefault(); setPwError('')
    if (newPw.length < 6) { setPwError('비밀번호는 6자 이상이어야 해요.'); return }
    if (newPw !== confirmPw) { setPwError('비밀번호가 일치하지 않아요.'); return }
    setPwSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPw })
    if (error) { setPwError(error.message); setPwSaving(false); return }
    const { data: { user } } = await supabase.auth.getUser()
    if (user) await supabase.from('profiles').update({ must_change_password: false }).eq('id', user.id)
    setMustChangePw(false)
    setPwSaving(false)
    if (mustChangePw && !currentSQ) {
      // 초기 비번 변경 완료 → 보안 질문 설정 단계로
      setPwStep('sq')
      setSqQuestion(''); setSqAnswer(''); setSqError('')
    } else {
      // 일반 비번 변경 → 완료
      setPwStep('done')
      setTimeout(() => { setShowPwModal(false); setPwStep('pw'); setNewPw(''); setConfirmPw('') }, 1800)
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut(); router.replace('/login')
  }

  async function handleSaveSQ(e: React.FormEvent, fromPwModal = false) {
    e.preventDefault()
    setSqError('')
    if (!sqQuestion.trim()) { setSqError('질문을 입력해주세요.'); return }
    if (!sqAnswer.trim()) { setSqError('답변을 입력해주세요.'); return }
    setSqSaving(true)
    const token = await getToken()
    if (!token) { setSqSaving(false); return }
    const res = await fetch('/api/security-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ question: sqQuestion.trim(), answer: sqAnswer.trim() }),
    })
    const json = await res.json()
    setSqSaving(false)
    if (!res.ok) { setSqError(json.error ?? '오류가 발생했어요.'); return }
    setCurrentSQ(sqQuestion.trim())
    setSqSaved(true)
    if (fromPwModal) {
      // 비밀번호 모달 내 보안질문 → 완료 단계로
      setPwStep('done')
      setTimeout(() => {
        setShowPwModal(false); setPwStep('pw')
        setNewPw(''); setConfirmPw('')
        setSqSaved(false); setSqQuestion(''); setSqAnswer('')
      }, 1800)
    } else {
      setTimeout(() => {
        setShowSqModal(false); setSqSaved(false)
        setSqQuestion(''); setSqAnswer('')
      }, 1500)
    }
  }

  async function handleDeleteAccount() {
    if (deleteConfirmText !== '탈퇴') return
    setDeleting(true); setDeleteError('')
    const token = await getToken()
    if (!token) { setDeleting(false); return }
    const res = await fetch('/api/delete-self', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json()
    if (json.success) {
      await supabase.auth.signOut()
      router.replace('/login')
    } else {
      setDeleteError(json.error ?? '오류가 발생했어요.')
      setDeleting(false)
    }
  }

  function getCalendarDays() {
    const year = calMonth.getFullYear(), month = calMonth.getMonth()
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const days: (number | null)[] = []
    for (let i = 0; i < firstDay; i++) days.push(null)
    for (let d = 1; d <= daysInMonth; d++) days.push(d)
    return days
  }
  function getAttendForDay(day: number) {
    const y = calMonth.getFullYear(), m = String(calMonth.getMonth()+1).padStart(2,'0'), d = String(day).padStart(2,'0')
    return attendance.find(a => a.date === `${y}-${m}-${d}`)
  }

  // 통계
  const heldAttend = attendance.filter(a => a.status !== 'cancelled')
  const attendStats = {
    total: heldAttend.length,
    present: heldAttend.filter(a => a.status==='present').length,
    late: heldAttend.filter(a => a.status==='late').length,
    earlyLeave: heldAttend.filter(a => a.status==='early_leave').length,
    absent: heldAttend.filter(a => a.status==='absent').length,
  }
  const attendRate = attendStats.total > 0
    ? Math.round((attendStats.present + attendStats.late + attendStats.earlyLeave) / attendStats.total * 100) : null

  const scoredTests = tests.filter(t => !t.absent && t.myScore !== null && t.maxScore !== null)
  const pcts = scoredTests.map(t => (t.myScore! / t.maxScore!) * 100)
  const avgPct = pcts.length > 0 ? Math.round(pcts.reduce((a,b) => a+b, 0) / pcts.length) : null
  const maxPct = pcts.length > 0 ? Math.round(Math.max(...pcts)) : null
  const minPct = pcts.length > 0 ? Math.round(Math.min(...pcts)) : null
  const chartData = scoredTests.map(t => ({
    label: `${t.date.slice(5).replace('-','/')} ${t.name.slice(0,6)}`,
    내점수: Math.round((t.myScore! / t.maxScore!) * 100),
    반평균: t.avgScore !== null && t.maxScore ? Math.round((t.avgScore / t.maxScore) * 100) : null,
  }))

  const hwStats = {
    total:   homeworks.length,
    done:    homeworks.filter(h => h.status === 'done').length,
    partial: homeworks.filter(h => h.status === 'partial').length,
    notDone: homeworks.filter(h => h.status !== 'done' && h.status !== 'partial').length,
  }

  const statusClinics = clinics.filter(c => c.status !== null)
  const clinicDone = statusClinics.filter(c => c.status === 'done').length
  const clinicRate = statusClinics.length > 0 ? Math.round(clinicDone / statusClinics.length * 100) : null

  const TABS: { key: Tab; label: string; Icon: React.ElementType }[] = [
    { key: 'home',           label: '홈',        Icon: Home },
    { key: 'attendance',     label: '출석',      Icon: Calendar },
    { key: 'grades',         label: '성적',      Icon: BarChart2 },
    { key: 'homework-clinic',label: '과제·클리닉', Icon: ClipboardList },
    { key: 'exam',           label: '답안제출',   Icon: FileText },
    { key: 'settings',       label: '설정',      Icon: Settings },
  ]

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-slate-400 text-sm">불러오는 중...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
            <GraduationCap size={15} className="text-white" />
          </div>
          <span className="text-sm font-bold text-slate-800">{academyName || '학원'}</span>
        </div>
        <button onClick={handleSignOut}
          className="flex items-center gap-1.5 text-slate-400 hover:text-slate-600 text-sm transition-colors">
          <LogOut size={15} /><span className="hidden sm:block">로그아웃</span>
        </button>
      </header>

      {mustChangePw && !showPwModal && (
        <div onClick={() => setShowPwModal(true)}
          className="bg-amber-500 text-white text-xs text-center py-2.5 px-4 font-medium cursor-pointer hover:bg-amber-600 transition-colors">
          🔒 초기 비밀번호를 사용 중이에요. 탭하여 비밀번호를 변경해주세요.
        </div>
      )}

      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-5 pb-28 space-y-4">

        {/* ── 홈 ── */}
        {tab === 'home' && (
          <>
            <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl p-5 text-white">
              <p className="text-blue-200 text-sm">안녕하세요 👋</p>
              <h1 className="text-xl font-bold mt-1">{student ? `${student.name}님` : '학생님'}</h1>
              <p className="text-blue-200 text-xs mt-2">오늘도 열심히 해봐요!</p>
            </div>

            {student ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                <h2 className="font-bold text-slate-800 text-sm">내 정보</h2>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <User size={22} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">{student.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {[student.school_name, student.grade ? `${student.grade}학년` : null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
                {classInfo ? (
                  <div className="bg-slate-50 rounded-xl p-4 space-y-2.5">
                    <InfoRow label="소속 반" value={classInfo.name} />
                    {classInfo.teacher_name && <InfoRow label="담당 선생님" value={classInfo.teacher_name} />}
                    {classInfo.schedules.length > 0 && (
                      <div className="flex items-start gap-2.5">
                        <span className="text-xs text-slate-500 w-20 flex-shrink-0 pt-0.5">정기 수업</span>
                        <div className="space-y-0.5">
                          {classInfo.schedules.map((s, i) => (
                            <p key={i} className="text-sm text-slate-700">
                              매주 {DAY_NAMES[s.day_of_week]}요일 {s.start_time.slice(0,5)}~{s.end_time.slice(0,5)}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-slate-50 rounded-xl px-4 py-3 text-xs text-slate-400 text-center">아직 배정된 반이 없어요</div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
                <p className="text-slate-400 text-sm">학생 정보를 불러올 수 없어요.</p>
                <p className="text-slate-300 text-xs mt-1">선생님께 문의해 주세요.</p>
              </div>
            )}

            {student && classInfo && (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'attendance'       as Tab, label: '출석 확인',  colorCls: 'bg-emerald-50 text-emerald-700', Icon: Calendar },
                  { key: 'grades'           as Tab, label: '성적 확인',  colorCls: 'bg-blue-50 text-blue-700',       Icon: BarChart2 },
                  { key: 'homework-clinic'  as Tab, label: '과제·클리닉', colorCls: 'bg-amber-50 text-amber-700',     Icon: ClipboardList },
                  { key: 'exam'             as Tab, label: '답안 제출',  colorCls: 'bg-violet-50 text-violet-700',   Icon: FileText },
                ].map(({ key, label, colorCls, Icon }) => (
                  <button key={key} onClick={() => setTab(key)}
                    className={`rounded-xl p-4 text-center space-y-1.5 hover:opacity-80 transition-opacity ${colorCls}`}>
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
            {!classInfo ? <NoClass /> : (
              <>
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

                <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <button onClick={() => setCalMonth(m => { const n = new Date(m); n.setMonth(n.getMonth()-1); return n })}
                      className="p-2 rounded-lg hover:bg-slate-100"><ChevronLeft size={16} className="text-slate-500" /></button>
                    <h3 className="font-bold text-slate-800 text-sm">{calMonth.getFullYear()}년 {calMonth.getMonth()+1}월</h3>
                    <button onClick={() => setCalMonth(m => { const n = new Date(m); n.setMonth(n.getMonth()+1); return n })}
                      className="p-2 rounded-lg hover:bg-slate-100"><ChevronRight size={16} className="text-slate-500" /></button>
                  </div>
                  <div className="grid grid-cols-7 text-center text-xs font-semibold">
                    {['일','월','화','수','목','금','토'].map((d,i) => (
                      <div key={d} className={`py-1 ${i===0?'text-red-400':i===6?'text-blue-400':'text-slate-400'}`}>{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-0.5">
                    {getCalendarDays().map((day, i) => {
                      if (day === null) return <div key={i} />
                      const record = getAttendForDay(day)
                      const today = new Date()
                      const isToday = today.getFullYear()===calMonth.getFullYear() && today.getMonth()===calMonth.getMonth() && today.getDate()===day
                      const dow = i % 7
                      return (
                        <div key={i} className="flex flex-col items-center py-1.5 gap-1">
                          <span className={`text-xs font-medium leading-none ${isToday?'bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center':dow===0?'text-red-400':dow===6?'text-blue-400':'text-slate-700'}`}>{day}</span>
                          {record && <span className={`w-1.5 h-1.5 rounded-full ${ATTEND_STYLE[record.status]?.dot ?? 'bg-slate-300'}`} />}
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex flex-wrap gap-3 pt-1 border-t border-slate-100">
                    {Object.entries(ATTEND_STYLE).map(([key, val]) => (
                      <div key={key} className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${val.dot}`} /><span className="text-xs text-slate-500">{val.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100"><h2 className="font-bold text-slate-800 text-sm">출결 기록</h2></div>
                  {heldAttend.length === 0 ? (
                    <div className="px-5 py-8 text-center text-slate-400 text-sm">출결 기록이 없어요</div>
                  ) : (
                    <div className="divide-y divide-slate-50">
                      {heldAttend.slice(0, 30).map((a, i) => {
                        const style = ATTEND_STYLE[a.status]
                        return (
                          <div key={i} className="flex items-center gap-3 px-5 py-3">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
                            <span className="text-sm text-slate-700 flex-1">{a.date.replace(/-/g,'. ')}</span>
                            <span className={`text-xs font-semibold ${style.color}`}>
                              {style.label}
                              {a.status==='late' && a.late_minutes ? ` ${a.late_minutes}분` : ''}
                              {a.status==='early_leave' && a.early_leave_minutes ? ` ${a.early_leave_minutes}분` : ''}
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
            {!classInfo ? <NoClass /> : (
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
                    <h2 className="font-bold text-slate-800 text-sm">성적 추이 (반 평균 비교)</h2>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={chartData} margin={{ top:5, right:5, bottom:20, left:-10 }} barCategoryGap="30%">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="label" tick={{ fontSize:9, fill:'#94a3b8' }} angle={-30} textAnchor="end" interval={0} />
                        <YAxis domain={[0,100]} tick={{ fontSize:10, fill:'#94a3b8' }} unit="%" />
                        <Tooltip formatter={(v, name) => [`${v}%`, name]} contentStyle={{ fontSize:12, borderRadius:8 }} />
                        <Legend iconType="circle" wrapperStyle={{ fontSize:11, paddingTop:8 }} />
                        <Bar dataKey="내점수" fill="#2563eb" radius={[4,4,0,0]}>
                          {chartData.map((entry, idx) => (
                            <Cell key={idx} fill={entry.내점수 >= 80 ? '#10b981' : entry.내점수 >= 60 ? '#2563eb' : '#ef4444'} />
                          ))}
                        </Bar>
                        <Bar dataKey="반평균" fill="#94a3b8" radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100"><h2 className="font-bold text-slate-800 text-sm">전체 성적 기록</h2></div>
                  {gradesLoading ? (
                    <div className="px-5 py-8 text-center text-slate-400 text-sm">불러오는 중...</div>
                  ) : tests.length === 0 ? (
                    <div className="px-5 py-8 text-center text-slate-400 text-sm">성적 기록이 없어요</div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {[...tests].reverse().map((t, i) => {
                        const isClickable = t.examType === 'auto' && t.examId
                        return (
                          <div key={i}
                            className={`px-5 py-4 ${isClickable ? 'cursor-pointer hover:bg-slate-50 transition-colors active:bg-slate-100' : ''}`}
                            onClick={() => { if (isClickable && t.examId) openExamResult(t.examId) }}>
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-sm font-semibold text-slate-800 truncate">{t.name}</p>
                                  {isClickable && <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />}
                                </div>
                                <p className="text-xs text-slate-400 mt-0.5">{t.date.replace(/-/g,'. ')}{t.maxScore !== null ? ` · 만점 ${t.maxScore}점` : ''}</p>
                              </div>
                              {t.absent ? (
                                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-lg flex-shrink-0">결시</span>
                              ) : t.myScore !== null ? (
                                <div className="text-right flex-shrink-0">
                                  <p className={`text-base font-black ${t.myPct===null?'text-slate-700':t.myPct>=80?'text-emerald-600':t.myPct>=60?'text-blue-600':'text-red-600'}`}>{t.myScore}점</p>
                                  {t.myPct !== null && <p className="text-xs text-slate-400">{t.myPct}%</p>}
                                </div>
                              ) : <span className="text-xs text-slate-400 flex-shrink-0">미입력</span>}
                            </div>
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

        {/* ── 시험 결과 로딩 오버레이 ── */}
        {loadingExamResult && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-2xl px-8 py-6 text-center">
              <p className="text-slate-600 text-sm font-medium">불러오는 중...</p>
            </div>
          </div>
        )}

        {/* ── 시험 결과 상세 모달 ── */}
        {examResultModal && (
          <div className="fixed inset-0 z-50 flex flex-col bg-white overflow-y-auto sm:items-center sm:justify-center sm:bg-black/40 sm:px-4">
            <div className="bg-white sm:rounded-2xl w-full sm:max-w-lg sm:max-h-[90vh] sm:overflow-y-auto">
              {/* 헤더 */}
              <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center gap-3 z-10">
                <button onClick={() => setExamResultModal(null)} className="text-slate-400 hover:text-slate-600"><ChevronLeft size={20} /></button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">{examResultModal.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {examResultModal.isAbsent ? '결시' : examResultModal.myScore !== null ? `${examResultModal.myScore}점${examResultModal.maxScore ? ` / ${examResultModal.maxScore}점` : ''}` : '점수 없음'}
                  </p>
                </div>
                <button onClick={() => setExamResultModal(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
              </div>

              <div className="p-5 space-y-4">
                {/* 수동 시험 */}
                {examResultModal.examType === 'manual' && (
                  <div className="bg-slate-50 rounded-2xl p-5 text-center space-y-2">
                    <p className="text-slate-500 text-sm">수동 입력 시험은 상세 결과가 없어요.</p>
                    {examResultModal.myScore !== null && (
                      <p className="text-2xl font-black text-blue-600">{examResultModal.myScore}점</p>
                    )}
                  </div>
                )}

                {/* 자동 채점 시험 — 정답 확인 불가 (never) */}
                {examResultModal.examType === 'auto' && !examResultModal.canReveal && (
                  <>
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-start gap-2">
                      <span className="text-amber-500 mt-0.5">🔒</span>
                      <p className="text-xs text-amber-700">선생님이 정답 확인을 막아뒀어요. 맞힌 문제 수와 내 답만 확인할 수 있어요.</p>
                    </div>
                    {/* 요약 */}
                    {(() => {
                      const correct = examResultModal.myAnswers.filter(a => a.is_correct).length
                      const total = examResultModal.questions.length
                      const wrong = examResultModal.myAnswers.filter(a => a.is_correct === false).length
                      return (
                        <div className="grid grid-cols-3 gap-3">
                          <div className="bg-emerald-50 rounded-xl p-3 text-center">
                            <p className="text-xl font-black text-emerald-600">{correct}</p>
                            <p className="text-xs text-slate-500 mt-0.5">맞힌 문제</p>
                          </div>
                          <div className="bg-red-50 rounded-xl p-3 text-center">
                            <p className="text-xl font-black text-red-500">{wrong}</p>
                            <p className="text-xs text-slate-500 mt-0.5">틀린 문제</p>
                          </div>
                          <div className="bg-slate-50 rounded-xl p-3 text-center">
                            <p className="text-xl font-black text-slate-600">{total}</p>
                            <p className="text-xs text-slate-500 mt-0.5">총 문제</p>
                          </div>
                        </div>
                      )
                    })()}
                    {/* 문제별 내 답 (정답 숨김) */}
                    <div className="space-y-2">
                      {examResultModal.questions.map((q) => {
                        const myAns = examResultModal.myAnswers.find(a => a.question_id === q.id)
                        const choices = examResultModal.choices.filter(c => c.question_id === q.id).sort((a, b) => a.choice_num - b.choice_num)
                        const isCorrect = myAns?.is_correct
                        return (
                          <div key={q.id} className={`rounded-xl border p-3 ${isCorrect ? 'border-emerald-200 bg-emerald-50' : isCorrect === false ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-xs font-bold ${isCorrect ? 'text-emerald-600' : isCorrect === false ? 'text-red-500' : 'text-slate-400'}`}>
                                {q.order_num}번 {isCorrect ? '✓' : isCorrect === false ? '✗' : '—'}
                              </span>
                              <span className="text-xs text-slate-400 ml-auto">{q.score}점</span>
                            </div>
                            {q.question_text && <p className="text-xs text-slate-600 mb-2">{q.question_text}</p>}
                            <p className="text-xs text-slate-500">
                              내 답: <span className="font-semibold text-slate-700">
                                {myAns?.student_answer
                                  ? (q.question_type === 'multiple_choice'
                                    ? `${myAns.student_answer}번 — ${choices[Number(myAns.student_answer) - 1]?.choice_text ?? ''}`
                                    : myAns.student_answer)
                                  : '미제출'}
                              </span>
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}

                {/* 자동 채점 시험 — 정답 공개 (after_close 또는 revealed) */}
                {examResultModal.examType === 'auto' && examResultModal.canReveal && (
                  <>
                    {/* 요약 */}
                    {(() => {
                      const correct = examResultModal.myAnswers.filter(a => a.is_correct).length
                      const wrong = examResultModal.myAnswers.filter(a => a.is_correct === false).length
                      const total = examResultModal.questions.length
                      return (
                        <div className="grid grid-cols-3 gap-3">
                          <div className="bg-emerald-50 rounded-xl p-3 text-center">
                            <p className="text-xl font-black text-emerald-600">{correct}</p>
                            <p className="text-xs text-slate-500 mt-0.5">맞힌 문제</p>
                          </div>
                          <div className="bg-red-50 rounded-xl p-3 text-center">
                            <p className="text-xl font-black text-red-500">{wrong}</p>
                            <p className="text-xs text-slate-500 mt-0.5">틀린 문제</p>
                          </div>
                          <div className="bg-slate-50 rounded-xl p-3 text-center">
                            <p className="text-xl font-black text-slate-600">{total}</p>
                            <p className="text-xs text-slate-500 mt-0.5">총 문제</p>
                          </div>
                        </div>
                      )
                    })()}
                    {/* 문제별 정오 + 정답 */}
                    <div className="space-y-3">
                      {examResultModal.questions.map((q) => {
                        const myAns = examResultModal.myAnswers.find(a => a.question_id === q.id)
                        const choices = examResultModal.choices.filter(c => c.question_id === q.id).sort((a, b) => a.choice_num - b.choice_num)
                        const correctList = examResultModal.correctAnswers.filter(c => c.question_id === q.id).sort((a, b) => a.order_num - b.order_num)
                        const isCorrect = myAns?.is_correct
                        return (
                          <div key={q.id} className={`rounded-xl border p-4 space-y-2 ${isCorrect ? 'border-emerald-200 bg-emerald-50' : isCorrect === false ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-bold ${isCorrect ? 'text-emerald-600' : isCorrect === false ? 'text-red-500' : 'text-slate-400'}`}>
                                {q.order_num}번 {isCorrect ? '✓ 정답' : isCorrect === false ? '✗ 오답' : '—'}
                              </span>
                              <span className="text-xs text-slate-400 ml-auto">{myAns?.score_earned ?? 0} / {q.score}점</span>
                            </div>
                            {q.question_text && <p className="text-sm text-slate-700">{q.question_text}</p>}
                            {/* 객관식 선택지 */}
                            {q.question_type === 'multiple_choice' && choices.length > 0 && (
                              <div className="space-y-1 mt-1">
                                {choices.map((c) => {
                                  const isMyChoice = myAns?.student_answer === String(c.choice_num)
                                  const isCorrectChoice = correctList.some(cr => cr.answer_text === String(c.choice_num))
                                  return (
                                    <div key={c.choice_num} className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs ${isCorrectChoice ? 'bg-emerald-100 text-emerald-800 font-semibold' : isMyChoice ? 'bg-red-100 text-red-700' : 'text-slate-600'}`}>
                                      <span className="w-4 text-center font-medium">{c.choice_num}.</span>
                                      <span className="flex-1">{c.choice_text}</span>
                                      {isCorrectChoice && <span className="text-emerald-600">✓ 정답</span>}
                                      {isMyChoice && !isCorrectChoice && <span className="text-red-500">내 답</span>}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                            {/* 주관식 */}
                            {q.question_type === 'short_answer' && (
                              <div className="space-y-1 text-xs">
                                <p className="text-slate-500">내 답: <span className="font-semibold text-slate-700">{myAns?.student_answer ?? '미제출'}</span></p>
                                <p className="text-emerald-700">정답: <span className="font-semibold">{correctList.map(c => c.answer_text).join(' / ')}</span></p>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── 과제·클리닉 ── */}
        {tab === 'homework-clinic' && (
          <>
            {!classInfo ? <NoClass /> : (
              <>
                {/* 서브 토글 */}
                <div className="flex bg-white rounded-2xl border border-slate-200 p-1.5 gap-1.5">
                  {([{ key: 'homework', label: '숙제' }, { key: 'clinic', label: '클리닉' }] as const).map(({ key, label }) => (
                    <button key={key} onClick={() => setHwClinicSub(key)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                        hwClinicSub === key ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      }`}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* 숙제 */}
                {hwClinicSub === 'homework' && (
                  <>
                    {hwStats.total > 0 && (
                      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                        <h2 className="font-bold text-slate-800 text-sm">숙제 현황</h2>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: '완료',    value: hwStats.done,    color: 'text-emerald-600' },
                            { label: '부분완료', value: hwStats.partial, color: 'text-amber-600' },
                            { label: '미완료',  value: hwStats.notDone, color: 'text-red-600' },
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
                      <div className="px-5 py-4 border-b border-slate-100"><h2 className="font-bold text-slate-800 text-sm">숙제 목록</h2></div>
                      {hwLoading ? (
                        <div className="px-5 py-8 text-center text-slate-400 text-sm">불러오는 중...</div>
                      ) : homeworks.length === 0 ? (
                        <div className="px-5 py-8 text-center text-slate-400 text-sm">숙제 기록이 없어요</div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {homeworks.map(h => {
                            const style = h.status ? HW_STYLE[h.status] : null
                            return (
                              <div key={h.id} className="flex items-center gap-3 px-5 py-3.5">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-slate-800 truncate">{h.title}</p>
                                  <p className="text-xs text-slate-400 mt-0.5">
                                    {h.assigned_date.replace(/-/g,'. ')}
                                    {h.due_date && ` · 마감 ${h.due_date.replace(/-/g,'.')}`}
                                  </p>
                                </div>
                                {style ? (
                                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg flex-shrink-0 ${style.bg} ${style.color}`}>{style.label}</span>
                                ) : (
                                  <span className="text-xs text-slate-400 bg-slate-100 px-2.5 py-1 rounded-lg flex-shrink-0">미기록</span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* 클리닉 */}
                {hwClinicSub === 'clinic' && (
                  <>
                    {clinicLoading ? (
                      <div className="bg-white rounded-2xl border border-slate-200 px-5 py-10 text-center text-slate-400 text-sm">불러오는 중...</div>
                    ) : (
                      <>
                        {clinics.some(c => c.status !== null) && (
                          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                            <h2 className="font-bold text-slate-800 text-sm">클리닉 현황</h2>
                            <div className="flex items-end gap-2">
                              <span className="text-4xl font-black text-amber-600">{clinicRate ?? 0}%</span>
                              <span className="text-slate-400 text-sm pb-1">완료율</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {[
                                { label: '완료',   value: clinics.filter(c => c.status==='done').length,     color: 'text-emerald-600' },
                                { label: '미완료', value: clinics.filter(c => c.status==='not_done').length, color: 'text-red-600' },
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
                          <div className="px-5 py-4 border-b border-slate-100"><h2 className="font-bold text-slate-800 text-sm">클리닉 기록</h2></div>
                          {clinics.length === 0 ? (
                            <div className="px-5 py-8 text-center text-slate-400 text-sm">클리닉 기록이 없어요</div>
                          ) : (
                            <div className="divide-y divide-slate-50">
                              {clinics.map((c, i) => {
                                const style = c.status ? CLINIC_STYLE[c.status] : null
                                return (
                                  <div key={c.id ?? i} className="flex items-center gap-3 px-5 py-3.5">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-semibold text-slate-800 truncate">{c.clinic_name ?? '클리닉'}</p>
                                      <p className="text-xs text-slate-400 mt-0.5">{c.date.replace(/-/g,'. ')}</p>
                                      {c.note && <p className="text-xs text-slate-400 mt-0.5 truncate">{c.note}</p>}
                                    </div>
                                    {style ? (
                                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg flex-shrink-0 ${style.bg} ${style.color}`}>{style.label}</span>
                                    ) : (
                                      <span className="text-xs text-slate-400 bg-slate-100 px-2.5 py-1 rounded-lg flex-shrink-0">기록 안됨</span>
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
              </>
            )}
          </>
        )}

        {/* ── 답안 제출 ── */}
        {tab === 'exam' && (
          <ExamTab
            classId={classInfo?.id ?? null}
            studentId={student?.id ?? null}
          />
        )}

        {/* ── 설정 ── */}
        {tab === 'settings' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-bold text-slate-800 text-sm">계정</h2>
              </div>
              <button onClick={() => setShowPwModal(true)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <KeyRound size={17} className="text-slate-500" />
                  <span className="text-sm text-slate-700">비밀번호 변경</span>
                </div>
                <ChevronRight size={16} className="text-slate-400" />
              </button>
              <div className="border-t border-slate-100">
                <button onClick={handleSignOut}
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 transition-colors">
                  <LogOut size={17} className="text-slate-500" />
                  <span className="text-sm text-slate-700">로그아웃</span>
                </button>
              </div>
            </div>

            {/* 비밀번호 찾기 질문 */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-slate-800 text-sm">비밀번호 찾기 질문</h2>
                  <p className="text-xs text-slate-400 mt-0.5">비밀번호를 잊었을 때 사용해요</p>
                </div>
                {sqLoaded && (
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${currentSQ ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                    {currentSQ ? '설정됨' : '미설정'}
                  </span>
                )}
              </div>
              <div className="px-5 py-4 space-y-3">
                {currentSQ && (
                  <div className="bg-slate-50 rounded-xl px-4 py-3">
                    <p className="text-xs text-slate-500 mb-1">현재 질문</p>
                    <p className="text-sm text-slate-700 font-medium">{currentSQ}</p>
                  </div>
                )}
                {!currentSQ && (
                  <p className="text-xs text-slate-500 leading-relaxed">
                    질문과 답변을 설정해두면 비밀번호를 잊었을 때<br />스스로 재설정할 수 있어요.
                  </p>
                )}
                <button
                  onClick={() => { setSqQuestion(currentSQ ?? ''); setSqAnswer(''); setSqError(''); setSqSaved(false); setShowSqModal(true) }}
                  className="w-full py-2.5 bg-blue-50 text-blue-600 text-sm font-semibold rounded-xl hover:bg-blue-100 transition-colors flex items-center justify-center gap-1.5">
                  <ShieldQuestion size={15} />
                  {currentSQ ? '질문 변경하기' : '질문 설정하기'}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-red-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-red-100">
                <h2 className="font-bold text-red-600 text-sm">위험 구역</h2>
              </div>
              <div className="px-5 py-4 space-y-3">
                <p className="text-xs text-slate-500 leading-relaxed">
                  계정을 탈퇴하면 로그인할 수 없게 돼요.<br />
                  학습 기록은 선생님 계정에 그대로 유지됩니다.
                </p>
                <button onClick={() => { setShowDeleteModal(true); setDeleteConfirmText(''); setDeleteError('') }}
                  className="w-full py-2.5 bg-red-50 text-red-600 text-sm font-semibold rounded-xl hover:bg-red-100 transition-colors">
                  계정 탈퇴
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex z-10 safe-area-bottom">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${tab===key?'text-blue-600':'text-slate-400 hover:text-slate-600'}`}>
            <Icon size={20} /><span className="text-xs font-medium">{label}</span>
          </button>
        ))}
      </nav>

      {/* 계정 탈퇴 모달 */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-800">계정 탈퇴</h2>
              <button onClick={() => setShowDeleteModal(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                <p className="text-xs text-red-700 leading-relaxed">
                  탈퇴 후에는 로그인할 수 없어요.<br />
                  아래에 <span className="font-bold">탈퇴</span>를 입력하고 버튼을 눌러주세요.
                </p>
              </div>
              <input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="탈퇴"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
              {deleteError && <p className="text-red-500 text-xs bg-red-50 px-3 py-2 rounded-lg">{deleteError}</p>}
              <div className="flex gap-2">
                <button onClick={() => setShowDeleteModal(false)}
                  className="flex-1 py-2.5 border border-slate-200 text-slate-600 font-medium rounded-xl text-sm">취소</button>
                <button onClick={handleDeleteAccount} disabled={deleteConfirmText !== '탈퇴' || deleting}
                  className="flex-1 py-2.5 bg-red-500 text-white font-semibold rounded-xl text-sm disabled:opacity-40 hover:bg-red-600 transition-colors">
                  {deleting ? '처리 중...' : '탈퇴하기'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 보안 질문 설정 모달 */}
      {showSqModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldQuestion size={18} className="text-blue-500" />
                <h2 className="font-bold text-slate-800">비밀번호 찾기 질문</h2>
              </div>
              <button onClick={() => setShowSqModal(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            {sqSaved ? (
              <div className="p-8 flex flex-col items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center"><Check size={28} className="text-emerald-600" /></div>
                <p className="font-bold text-slate-800">저장됐어요!</p>
              </div>
            ) : (
              <form onSubmit={handleSaveSQ} className="p-5 space-y-4">
                <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                  <p className="text-xs text-blue-700 leading-relaxed">
                    본인만 알 수 있는 <span className="font-semibold">질문과 답변</span>을 만들어주세요.<br />
                    가장 잘 기억할 수 있는 것으로 설정하는 게 좋아요.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">질문</label>
                  <input
                    type="text"
                    value={sqQuestion}
                    onChange={e => setSqQuestion(e.target.value)}
                    placeholder="예: 내 첫 번째 반려동물 이름은?"
                    required
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">답변</label>
                  <input
                    type="text"
                    value={sqAnswer}
                    onChange={e => setSqAnswer(e.target.value)}
                    placeholder="가장 잘 기억할 수 있는 답변을 쓰세요"
                    required
                    autoComplete="off"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <p className="text-xs text-slate-400 mt-1.5">대·소문자 구분 없이 입력해도 돼요</p>
                </div>
                {sqError && <p className="text-red-500 text-xs bg-red-50 px-3 py-2 rounded-lg">{sqError}</p>}
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setShowSqModal(false)}
                    className="flex-1 py-2.5 border border-slate-200 text-slate-600 font-medium rounded-xl text-sm">취소</button>
                  <button type="submit" disabled={sqSaving}
                    className="flex-1 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors text-sm disabled:opacity-50">
                    {sqSaving ? '저장 중...' : '저장'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* 비밀번호 변경 모달 (초기: 2단계 / 일반: 1단계) */}
      {showPwModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {pwStep === 'sq'
                  ? <ShieldQuestion size={18} className="text-blue-500" />
                  : <KeyRound size={18} className="text-amber-500" />}
                <h2 className="font-bold text-slate-800">
                  {pwStep === 'sq' ? '비밀번호 찾기 질문 설정' : '비밀번호 변경'}
                </h2>
              </div>
              {/* mustChangePw 중엔 닫기 불가 */}
              {pwStep === 'pw' && !mustChangePw && (
                <button onClick={() => { setShowPwModal(false); setPwStep('pw') }} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
              )}
            </div>

            {/* 완료 화면 */}
            {pwStep === 'done' && (
              <div className="p-8 flex flex-col items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center"><Check size={28} className="text-emerald-600" /></div>
                <p className="font-bold text-slate-800">모두 완료됐어요!</p>
                <p className="text-xs text-slate-400 text-center">새 비밀번호와 비밀번호 찾기 질문이<br />저장됐어요.</p>
              </div>
            )}

            {/* STEP 1: 비밀번호 변경 */}
            {pwStep === 'pw' && (
              <form onSubmit={handleChangePw} className="p-5 space-y-4">
                <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                  <p className="text-xs text-amber-700 leading-relaxed">
                    현재 <span className="font-semibold">초기 비밀번호</span>(전화번호 뒤 8자리)를 사용 중이에요.<br />
                    보안을 위해 새 비밀번호로 변경해주세요.
                  </p>
                </div>
                {mustChangePw && !currentSQ && (
                  <div className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-lg">
                    <ShieldQuestion size={13} />
                    <span>변경 후 비밀번호 찾기 질문도 설정해요 (필수)</span>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">새 비밀번호</label>
                  <div className="relative">
                    <input type={showNewPw?'text':'password'} value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="6자 이상" required
                      className="w-full px-3 py-2.5 pr-10 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    <button type="button" onClick={()=>setShowNewPw(v=>!v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                      {showNewPw?<EyeOff size={15}/>:<Eye size={15}/>}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">비밀번호 확인</label>
                  <div className="relative">
                    <input type={showConfirmPw?'text':'password'} value={confirmPw} onChange={e=>setConfirmPw(e.target.value)} placeholder="비밀번호 재입력" required
                      className="w-full px-3 py-2.5 pr-10 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    <button type="button" onClick={()=>setShowConfirmPw(v=>!v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                      {showConfirmPw?<EyeOff size={15}/>:<Eye size={15}/>}
                    </button>
                  </div>
                </div>
                {pwError && <p className="text-red-500 text-xs bg-red-50 px-3 py-2 rounded-lg">{pwError}</p>}
                <div className="flex gap-2 pt-1">
                  {!mustChangePw && (
                    <button type="button" onClick={() => { setShowPwModal(false); setPwStep('pw') }}
                      className="flex-1 py-2.5 border border-slate-200 text-slate-600 font-medium rounded-xl text-sm">취소</button>
                  )}
                  <button type="submit" disabled={pwSaving}
                    className="flex-1 py-2.5 bg-amber-500 text-white font-semibold rounded-xl hover:bg-amber-600 transition-colors text-sm disabled:opacity-50">
                    {pwSaving ? '변경 중...' : mustChangePw && !currentSQ ? '다음 →' : '변경하기'}
                  </button>
                </div>
                {mustChangePw && <p className="text-xs text-slate-400 text-center">비밀번호를 변경해야 이용할 수 있어요</p>}
              </form>
            )}

            {/* STEP 2: 보안 질문 설정 (mustChangePw + 미설정일 때만) */}
            {pwStep === 'sq' && (
              <form onSubmit={e => handleSaveSQ(e, true)} className="p-5 space-y-4">
                <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                  <p className="text-xs text-blue-700 leading-relaxed">
                    비밀번호를 잊었을 때 본인 확인에 사용돼요.<br />
                    <span className="font-semibold">가장 잘 기억할 수 있는 질문과 답변</span>을 작성해주세요.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">질문</label>
                  <input type="text" value={sqQuestion} onChange={e=>setSqQuestion(e.target.value)}
                    placeholder="예: 내 첫 번째 반려동물 이름은?" required
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">답변</label>
                  <input type="text" value={sqAnswer} onChange={e=>setSqAnswer(e.target.value)}
                    placeholder="가장 잘 기억할 수 있는 답변을 쓰세요" required autoComplete="off"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  <p className="text-xs text-slate-400 mt-1.5">대·소문자 구분 없이 입력해도 돼요</p>
                </div>
                {sqError && <p className="text-red-500 text-xs bg-red-50 px-3 py-2 rounded-lg">{sqError}</p>}
                <button type="submit" disabled={sqSaving}
                  className="w-full py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors text-sm disabled:opacity-50">
                  {sqSaving ? '저장 중...' : '저장하고 완료'}
                </button>
                <p className="text-xs text-slate-400 text-center">이 단계는 건너뛸 수 없어요</p>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="text-xs text-slate-500 w-20 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm font-semibold text-slate-800">{value}</span>
    </div>
  )
}
function NoClass() {
  return <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-slate-400 text-sm">배정된 반 정보가 없어요</div>
}
