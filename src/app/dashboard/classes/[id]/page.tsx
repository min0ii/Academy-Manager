'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Plus, X, Trash2, Clock, Users, CalendarDays,
  Search, ChevronLeft, ChevronRight, Check, BarChart2, CheckCheck, FileText,
  BookOpen, Activity, TrendingUp, AlertTriangle, ChevronDown, Heart, Skull, MessageSquare, Loader2,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatPhone } from '@/lib/auth'
import { todayKST } from '@/lib/date'
import { useDialog } from '@/components/AppDialog'

type GradePoint = { name: string; 내점수: number | null; 반평균: number | null }

const DAYS = ['일', '월', '화', '수', '목', '금', '토']

type Schedule        = { id: string; day_of_week: number; start_time: string; end_time: string }
type ClinicSchedule  = { id: string; day_of_week: number; start_time: string; end_time: string; name: string | null }
type Student = {
  id: string; name: string; school_name: string | null
  grade: string; phone: string; parent_phone: string | null
  parent_relation: string | null; memo: string | null; enrolled_at: string | null
}
type Session      = { id: string; date: string; start_time: string; end_time: string; status: string }
type ClinicSession = { id: string; class_id: string; date: string; note: string | null; name: string | null; start_time: string | null; end_time: string | null }
type AttendanceRecord = {
  id: string | null; student_id: string
  status: 'present' | 'absent' | 'late' | 'early_leave' | null; note: string | null
}
type ClinicAttRecord = {
  id: string | null; student_id: string; status: 'done' | 'not_done' | null
}
type Homework = {
  id: string; title: string; description: string | null
  assigned_date: string; due_date: string | null
}
type HomeworkStatusRecord = {
  id: string | null; student_id: string; status: 'done' | 'partial' | 'none' | null; note: string | null
}

type Tab      = 'schedule' | 'students' | 'calendar' | 'stats' | 'lives'

type StatSession = {
  id: string; date: string; start_time: string; end_time: string
  present: number; late: number; early_leave: number; absent: number; total: number
}
type StatStudent = {
  id: string; name: string
  present: number; late: number; early_leave: number; absent: number; sessions: number
}
type PanelTab = 'attendance' | 'homework' | 'clinic'

const ATT_LABEL  = { present: '출석', late: '지각', early_leave: '조퇴', absent: '결석' } as const
const ATT_ACTIVE = {
  present:     'bg-green-500 text-white border-green-500',
  late:        'bg-amber-400 text-white border-amber-400',
  early_leave: 'bg-purple-500 text-white border-purple-500',
  absent:      'bg-red-500 text-white border-red-500',
} as const
const HW_LABEL  = { partial: '오답(완벽) 완료', done: '완료', none: '미완료' } as const
const HW_ACTIVE = {
  partial: 'bg-teal-500 text-white border-teal-500 ring-2 ring-teal-300 ring-offset-1',
  done:    'bg-green-500 text-white border-green-500',
  none:    'bg-red-500 text-white border-red-500',
} as const

export default function ClassDetailPage() {
  const { showAlert, showConfirm, dialog } = useDialog()
  const params   = useParams()
  const router   = useRouter()
  const classId  = params.id as string

  const [className, setClassName] = useState('')
  const [tab, setTab]             = useState<Tab>('calendar')
  const pendingDateRef            = useRef<string | null>(null)
  const [loading, setLoading]     = useState(true)

  // ── 시간표
  const [schedules, setSchedules]               = useState<Schedule[]>([])
  const [showScheduleForm, setShowScheduleForm] = useState(false)
  const [scheduleForm, setScheduleForm]         = useState({ day_of_week: 1, start_time: '15:00', end_time: '17:00' })
  const [scheduleError, setScheduleError]       = useState('')

  // ── 클리닉 일정
  const [clinicSchedules, setClinicSchedules]                   = useState<ClinicSchedule[]>([])
  const [showClinicScheduleForm, setShowClinicScheduleForm]     = useState(false)
  const [clinicScheduleForm, setClinicScheduleForm]             = useState({ name: '', day_of_week: 1, start_time: '16:00', end_time: '18:00' })
  const [clinicScheduleError, setClinicScheduleError]           = useState('')
  const [clinicNameEdits, setClinicNameEdits]   = useState<Record<string, string>>({})
  const [clinicTimeEdits, setClinicTimeEdits]   = useState<Record<string, { start: string; end: string }>>({})

  // ── 학생
  const [students, setStudents]               = useState<Student[]>([])
  const [allStudents, setAllStudents]         = useState<Student[]>([])
  const [showAddStudent, setShowAddStudent]   = useState(false)
  const [studentSearch, setStudentSearch]     = useState('')
  const [selectedNewIds, setSelectedNewIds]   = useState<Set<string>>(new Set())
  const [assigning, setAssigning]             = useState(false)
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null)

  // ── 캘린더
  const todayStr = todayKST()
  const [calYear, setCalYear]   = useState(() => Number(todayKST().slice(0, 4)))
  const [calMonth, setCalMonth] = useState(() => Number(todayKST().slice(5, 7)) - 1)

  const [sessionsInMonth, setSessionsInMonth]             = useState<Record<string, Session>>({})
  const [clinicSessionsInMonth, setClinicSessionsInMonth] = useState<Record<string, ClinicSession>>({})

  const [selectedDate, setSelectedDate]               = useState<string | null>(null)
  const [selectedSession, setSelectedSession]         = useState<Session | null>(null)
  const [selectedClinicSession, setSelectedClinicSession] = useState<ClinicSession | null>(null)

  const [attendanceList, setAttendanceList] = useState<AttendanceRecord[]>([])
  const [clinicAttList, setClinicAttList]   = useState<ClinicAttRecord[]>([])

  const [loadingAtt, setLoadingAtt]         = useState(false)
  const [detailStudent, setDetailStudent]   = useState<Student | null>(null)
  const [panelTab, setPanelTab]             = useState<PanelTab>('attendance')

  const [showAddExtra, setShowAddExtra] = useState(false)
  const [extraDate, setExtraDate]       = useState('')
  const [extraForm, setExtraForm]       = useState({ start_time: '15:00', end_time: '17:00' })
  const [savingExtra, setSavingExtra]   = useState(false)

  const [showTypeChoice, setShowTypeChoice]   = useState(false)
  const [typeChoiceDate, setTypeChoiceDate]   = useState('')

  const [showAddExtraClinic, setShowAddExtraClinic]   = useState(false)
  const [extraClinicDate, setExtraClinicDate]         = useState('')
  const [extraClinicForm, setExtraClinicForm]         = useState({ name: '', start_time: '16:00', end_time: '18:00' })
  const [savingExtraClinic, setSavingExtraClinic]     = useState(false)
  const [extraClinicError, setExtraClinicError]       = useState('')

  // ── 출결 현황
  const [statsLoading, setStatsLoading]   = useState(false)
  const [statsLoaded, setStatsLoaded]     = useState(false)
  const [statsSessions, setStatsSessions] = useState<StatSession[]>([])
  const [statsStudents, setStatsStudents] = useState<StatStudent[]>([])

  // ── 시험
  const [dateTests, setDateTests] = useState<{ id: string; name: string; max_score: number }[]>([])
  const [dayExams, setDayExams]   = useState<{ id: string; title: string; status: string; exam_type: string }[]>([])

  // ── 코멘트 입력창 토글
  const [openAttNotes, setOpenAttNotes] = useState<Set<string>>(new Set())
  const [openHwNotes, setOpenHwNotes]   = useState<Set<string>>(new Set())

  // ── 과제
  const [dateHomeworks, setDateHomeworks]       = useState<Homework[]>([])
  const [homeworkStatuses, setHomeworkStatuses] = useState<Record<string, HomeworkStatusRecord[]>>({})
  const [expandedHomeworkId, setExpandedHomeworkId] = useState<string | null>(null)
  const [hwDueDateEdits, setHwDueDateEdits]         = useState<Record<string, string>>({})
  const [showAddHomework, setShowAddHomework]   = useState(false)
  const [homeworkForm, setHomeworkForm]         = useState({ title: '', assigned_date: '', due_date: '', description: '' })
  const [savingHomework, setSavingHomework]     = useState(false)

  // ── 목숨
  const [academyId, setAcademyId]           = useState('')
  const [livesEnabled, setLivesEnabled]     = useState(false)
  const [livesDefault, setLivesDefault]     = useState(3)
  const [studentLives, setStudentLives]     = useState<Record<string, number>>({})
  const [pendingLivesMap, setPendingLivesMap] = useState<Record<string, number>>({})
  const livesTimerMap = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [studentLivesReason, setStudentLivesReason] = useState<Record<string, string>>({})
  const [savingLivesId, setSavingLivesId]   = useState<string | null>(null)
  const [livesLoading, setLivesLoading]     = useState(false)

  // ── 목숨 빌보드
  type BillboardEntry = { rank: number; name: string; lives: number }
  const [billboard, setBillboard]           = useState<BillboardEntry[]>([])
  const [billboardEnabled, setBillboardEnabled] = useState(false)
  const [billboardShowLast, setBillboardShowLast] = useState(false)
  const [billboardMinLives, setBillboardMinLives] = useState<number | null>(null)
  const [billboardLoaded, setBillboardLoaded] = useState(false)

  // ── 초기화
  const [showDangerZone, setShowDangerZone]   = useState(false)
  const [showResetModal, setShowResetModal]   = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState('')
  const [resetting, setResetting]             = useState(false)

  useEffect(() => { loadData() }, [classId])
  useEffect(() => { if (tab === 'stats' && !statsLoaded) loadAttendanceStats() }, [tab])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'lives' && academyId) loadLives() }, [tab])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (showAddHomework) { setShowAddHomework(false); return }
      if (showClinicScheduleForm) { setShowClinicScheduleForm(false); return }
      if (showTypeChoice) { setShowTypeChoice(false); return }
      if (showAddExtraClinic) { setShowAddExtraClinic(false); return }
      if (showAddExtra) { setShowAddExtra(false); return }
      if (showAddStudent) { setShowAddStudent(false); setSelectedNewIds(new Set()); setStudentSearch(''); return }
      if (showScheduleForm) { setShowScheduleForm(false); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showScheduleForm, showAddStudent, showAddExtra, showClinicScheduleForm, showAddHomework, showTypeChoice, showAddExtraClinic])

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const tabParam  = p.get('tab') as Tab | null
    const dateParam = p.get('date')
    if (tabParam === 'calendar') { pendingDateRef.current = dateParam; setTab('calendar') }
  }, [])

  useEffect(() => {
    if (tab === 'calendar') loadMonthSessions(pendingDateRef.current ?? undefined)
  }, [tab, calYear, calMonth])

  useEffect(() => {
    if (students.length > 0 && tab === 'calendar' && selectedDate &&
        attendanceList.length === 0 && clinicAttList.length === 0) {
      selectDate(selectedDate)
    }
  }, [students])

  // 과제 탭 열리거나 과제 목록 바뀔 때 모든 학생 현황 자동 로드
  useEffect(() => {
    if (panelTab === 'homework' && dateHomeworks.length > 0) {
      dateHomeworks.forEach(hw => loadHomeworkStatuses(hw.id))
    }
  }, [panelTab, dateHomeworks])

  // ── 데이터 로드
  async function loadData() {
    setLoading(true)
    const [
      { data: classData },
      { data: scheduleData },
      { data: clinicScheduleData },
      { data: csData },
    ] = await Promise.all([
      supabase.from('classes').select('name, academy_id').eq('id', classId).single(),
      supabase.from('class_schedules').select('*').eq('class_id', classId).order('day_of_week').order('start_time'),
      supabase.from('clinic_schedules').select('*').eq('class_id', classId).order('day_of_week').order('start_time'),
      supabase.from('class_students')
        .select('students(id, name, school_name, grade, phone, parent_phone, parent_relation, memo, enrolled_at)')
        .eq('class_id', classId),
    ])
    if (!classData) { router.push('/dashboard/classes'); return }
    const aId = (classData as any).academy_id
    setClassName(classData.name)
    setAcademyId(aId)
    setSchedules(scheduleData ?? [])
    setClinicSchedules(clinicScheduleData ?? [])
    setStudents(((csData ?? []) as any[]).map(r => r.students).filter(Boolean).sort((a: any, b: any) => a.name.localeCompare(b.name, 'ko')))

    const [{ data: allData }, { data: academyData }] = await Promise.all([
      supabase.from('students')
        .select('id, name, school_name, grade, phone, parent_phone, parent_relation, memo, enrolled_at')
        .eq('academy_id', aId).order('name'),
      supabase.from('academies').select('lives_enabled, lives_default').eq('id', aId).single(),
    ])
    setAllStudents(allData ?? [])
    setLivesEnabled(academyData?.lives_enabled ?? false)
    setLivesDefault(academyData?.lives_default ?? 3)
    setLoading(false)
  }

  async function loadMonthSessions(autoSelectDate?: string) {
    const y    = calYear
    const m    = String(calMonth + 1).padStart(2, '0')
    const last = new Date(calYear, calMonth + 1, 0).getDate()
    const start = `${y}-${m}-01`
    const end   = `${y}-${m}-${String(last).padStart(2, '0')}`

    const [{ data: sessData }, { data: clinicSessData }] = await Promise.all([
      supabase.from('sessions').select('*').eq('class_id', classId).gte('date', start).lte('date', end),
      supabase.from('clinic_sessions').select('*').eq('class_id', classId).gte('date', start).lte('date', end),
    ])

    const map: Record<string, Session> = {}
    for (const s of (sessData ?? [])) map[s.date] = s
    setSessionsInMonth(map)

    const cMap: Record<string, ClinicSession> = {}
    for (const s of (clinicSessData ?? [])) cMap[s.date] = s
    setClinicSessionsInMonth(cMap)

    pendingDateRef.current = null
    if (autoSelectDate) await selectDate(autoSelectDate, map, cMap)
  }

  // ── 시간표 추가/삭제
  async function addSchedule(e: React.FormEvent) {
    e.preventDefault()
    setScheduleError('')

    if (scheduleForm.end_time <= scheduleForm.start_time) {
      setScheduleError('종료 시간은 시작 시간보다 늦어야 해요.')
      return
    }
    const sameDay = schedules.filter(s => s.day_of_week === scheduleForm.day_of_week)
    const overlap = sameDay.some(s =>
      scheduleForm.start_time < s.end_time && scheduleForm.end_time > s.start_time
    )
    if (overlap) {
      setScheduleError('같은 요일에 겹치는 시간표가 이미 있어요.')
      return
    }

    await supabase.from('class_schedules').insert({ class_id: classId, ...scheduleForm })
    setShowScheduleForm(false)
    setScheduleError('')
    await loadData()
  }

  async function deleteSchedule(id: string) {
    if (!await showConfirm('이 시간표를 삭제할까요?\n오늘 이후 예정된 해당 요일 수업도 함께 삭제돼요.', { destructive: true })) return
    const schedule = schedules.find(s => s.id === id)
    if (schedule) {
      const td = todayKST()
      const { data: futureSessions } = await supabase
        .from('sessions').select('id, date').eq('class_id', classId).gt('date', td)
      const toDelete = (futureSessions ?? [])
        .filter(s => new Date(s.date + 'T00:00:00').getDay() === schedule.day_of_week)
        .map(s => s.id)
      if (toDelete.length > 0) {
        await supabase.from('attendance').delete().in('session_id', toDelete)
        await supabase.from('sessions').delete().in('id', toDelete)
      }
    }
    await supabase.from('class_schedules').delete().eq('id', id)
    await loadData()
    if (tab === 'calendar') loadMonthSessions()
  }

  // ── 클리닉 일정 추가/삭제
  async function saveClinicScheduleName(id: string, name: string) {
    await supabase.from('clinic_schedules').update({ name: name || null }).eq('id', id)
    setClinicSchedules(prev => prev.map(s => s.id === id ? { ...s, name: name || null } : s))
  }

  async function saveClinicScheduleDay(id: string, day_of_week: number) {
    await supabase.from('clinic_schedules').update({ day_of_week }).eq('id', id)
    setClinicSchedules(prev => prev.map(s => s.id === id ? { ...s, day_of_week } : s))
    if (tab === 'calendar') loadMonthSessions()
  }

  async function saveClinicScheduleTime(id: string, start: string, end: string) {
    if (end <= start) {
      void showAlert('종료 시간은 시작 시간보다 늦어야 해요.')
      return
    }
    const thisSchedule = clinicSchedules.find(s => s.id === id)
    if (thisSchedule) {
      const sameDay = clinicSchedules.filter(s => s.day_of_week === thisSchedule.day_of_week && s.id !== id)
      const overlap = sameDay.some(s => start < s.end_time && end > s.start_time)
      if (overlap) {
        void showAlert('같은 요일에 겹치는 클리닉 일정이 이미 있어요.')
        return
      }
    }
    await supabase.from('clinic_schedules').update({ start_time: start, end_time: end }).eq('id', id)
    setClinicSchedules(prev => prev.map(s => s.id === id ? { ...s, start_time: start, end_time: end } : s))
  }

  async function addClinicSchedule(e: React.FormEvent) {
    e.preventDefault()
    setClinicScheduleError('')

    if (clinicScheduleForm.end_time <= clinicScheduleForm.start_time) {
      setClinicScheduleError('종료 시간은 시작 시간보다 늦어야 해요.')
      return
    }
    const sameDay = clinicSchedules.filter(s => s.day_of_week === clinicScheduleForm.day_of_week)
    const overlap = sameDay.some(s =>
      clinicScheduleForm.start_time < s.end_time && clinicScheduleForm.end_time > s.start_time
    )
    if (overlap) {
      setClinicScheduleError('같은 요일에 겹치는 클리닉 일정이 이미 있어요.')
      return
    }

    await supabase.from('clinic_schedules').insert({
      class_id: classId,
      name: clinicScheduleForm.name || null,
      day_of_week: clinicScheduleForm.day_of_week,
      start_time: clinicScheduleForm.start_time,
      end_time: clinicScheduleForm.end_time,
    })
    setShowClinicScheduleForm(false)
    setClinicScheduleError('')
    await loadData()
    if (tab === 'calendar') loadMonthSessions()
  }

  async function deleteClinicSchedule(id: string) {
    if (!await showConfirm('이 클리닉 일정을 삭제할까요?', { destructive: true })) return
    await supabase.from('clinic_schedules').delete().eq('id', id)
    await loadData()
    if (tab === 'calendar') loadMonthSessions()
  }

  // ── 학생 배정/해제
  async function assignStudents() {
    if (selectedNewIds.size === 0) return
    setAssigning(true)
    await supabase.from('class_students').insert(
      [...selectedNewIds].map(id => ({ class_id: classId, student_id: id }))
    )
    setAssigning(false); setShowAddStudent(false)
    setSelectedNewIds(new Set()); setStudentSearch('')
    await loadData()
  }

  async function removeStudent(studentId: string, name: string) {
    if (!await showConfirm(`${name} 학생을 이 반에서 빼시겠어요?`, { destructive: true, confirmText: '제외' })) return
    await supabase.from('class_students').delete().eq('class_id', classId).eq('student_id', studentId)
    await loadData()
  }

  function toggleNewId(id: string) {
    setSelectedNewIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // ── 날짜 선택
  async function selectDate(
    dateStr: string,
    sessMap?: Record<string, Session>,
    clinicMap?: Record<string, ClinicSession>,
    forceTab?: PanelTab,
  ) {
    setSelectedDate(dateStr)
    setDetailStudent(null)
    setExpandedHomeworkId(null)
    setLoadingAtt(true)

    const url = new URL(window.location.href)
    url.searchParams.set('tab', 'calendar')
    url.searchParams.set('date', dateStr)
    window.history.replaceState({}, '', url.toString())

    const map  = sessMap   ?? sessionsInMonth
    const cMap = clinicMap ?? clinicSessionsInMonth
    const session       = map[dateStr]  ?? null
    const clinicSession = cMap[dateStr] ?? null
    setSelectedSession(session)
    setSelectedClinicSession(clinicSession)

    const dow          = new Date(dateStr + 'T00:00:00').getDay()
    const isRegularDay = !!session || schedules.some(s => s.day_of_week === dow)
    const isClinicDay  = !!clinicSession || clinicSchedules.some(s => s.day_of_week === dow)

    if (forceTab) setPanelTab(forceTab)
    else if (isRegularDay) setPanelTab('attendance')
    else if (isClinicDay) setPanelTab('clinic')
    else setPanelTab('attendance')

    const nextDay = new Date(dateStr + 'T00:00:00')
    nextDay.setDate(nextDay.getDate() + 1)
    const nextDayStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`

    const [{ data: testsOnDate }, { data: hwData }, { data: examsOnDate }] = await Promise.all([
      supabase.from('tests').select('id, name, max_score').eq('class_id', classId).eq('date', dateStr),
      supabase.from('homework').select('*').eq('class_id', classId).eq('assigned_date', dateStr).order('created_at'),
      supabase.from('exams').select('id, title, status, exam_type')
        .eq('class_id', classId)
        .in('status', ['active', 'closed'])
        .gte('start_at', dateStr + 'T00:00:00')
        .lt('start_at', nextDayStr + 'T00:00:00'),
    ])
    setDateTests(testsOnDate ?? [])
    setDayExams(examsOnDate ?? [])
    setDateHomeworks(hwData ?? [])
    setHomeworkStatuses({})

    // 해당 날짜 기준으로 등록된 학생만 (enrolled_at 이 dateStr 이하이거나 null)
    const enrolledStudents = students.filter(s => !s.enrolled_at || s.enrolled_at <= dateStr)

    if (session) {
      const { data: attData } = await supabase
        .from('attendance').select('id, student_id, status, note').eq('session_id', session.id)
      const attMap: Record<string, any> = {}
      for (const a of (attData ?? [])) attMap[a.student_id] = a
      setAttendanceList(enrolledStudents.map(s => ({
        id: attMap[s.id]?.id ?? null, student_id: s.id,
        status: attMap[s.id]?.status ?? null, note: attMap[s.id]?.note ?? null,
      })))
    } else {
      setAttendanceList(enrolledStudents.map(s => ({ id: null, student_id: s.id, status: null, note: null })))
    }

    if (clinicSession) {
      const { data: cAttData } = await supabase
        .from('clinic_attendance').select('id, student_id, status').eq('clinic_session_id', clinicSession.id)
      const cAttMap: Record<string, any> = {}
      for (const a of (cAttData ?? [])) cAttMap[a.student_id] = a
      setClinicAttList(enrolledStudents.map(s => ({
        id: cAttMap[s.id]?.id ?? null, student_id: s.id, status: cAttMap[s.id]?.status ?? null,
      })))
    } else if (clinicSchedules.some(s => s.day_of_week === dow)) {
      // 정규 클리닉 요일: 세션 없어도 학생 목록 준비
      setClinicAttList(enrolledStudents.map(s => ({ id: null, student_id: s.id, status: null })))
    } else {
      // 정규 클리닉 아닌 날: 비워서 "클리닉 추가" 버튼 표시
      setClinicAttList([])
    }

    setLoadingAtt(false)
  }

  // ── 정규 출석
  async function markAttendance(studentId: string, status: 'present' | 'absent' | 'late' | 'early_leave') {
    let session = selectedSession
    if (!session) {
      const dow = new Date(selectedDate! + 'T00:00:00').getDay()
      const sch = schedules.find(s => s.day_of_week === dow) ?? schedules[0]
      const { data: ns } = await supabase.from('sessions').insert({
        class_id: classId, date: selectedDate!,
        start_time: sch?.start_time ?? '15:00', end_time: sch?.end_time ?? '17:00', status: 'held',
      }).select().single()
      session = ns; setSelectedSession(session); await loadMonthSessions()
    }
    const rec = attendanceList.find(a => a.student_id === studentId)
    if (rec?.id) {
      if (rec.status === status) {
        await supabase.from('attendance').delete().eq('id', rec.id)
        setAttendanceList(prev => prev.map(a =>
          a.student_id === studentId ? { ...a, id: null, status: null, note: null } : a))
        applyLivesRule(studentId, 'attendance', { status: null, date: selectedDate! })
      } else {
        await supabase.from('attendance').update({ status }).eq('id', rec.id)
        setAttendanceList(prev => prev.map(a =>
          a.student_id === studentId ? { ...a, status } : a))
        applyLivesRule(studentId, 'attendance', { status, date: selectedDate! })
      }
    } else {
      const { data: na } = await supabase.from('attendance').insert({
        session_id: session!.id, student_id: studentId, status, note: null,
      }).select().single()
      setAttendanceList(prev => prev.map(a =>
        a.student_id === studentId ? { ...a, id: na?.id ?? null, status, note: null } : a))
      applyLivesRule(studentId, 'attendance', { status, date: selectedDate! })
    }
  }

  function handleNoteChange(studentId: string, note: string) {
    setAttendanceList(prev => prev.map(a => a.student_id === studentId ? { ...a, note } : a))
  }
  async function saveNote(studentId: string, note: string) {
    const rec = attendanceList.find(a => a.student_id === studentId)
    if (!rec?.id) return
    await supabase.from('attendance').update({ note: note || null }).eq('id', rec.id)
  }

  async function markAllPresent() {
    let session = selectedSession
    if (!session) {
      const dow = new Date(selectedDate! + 'T00:00:00').getDay()
      const sch = schedules.find(s => s.day_of_week === dow) ?? schedules[0]
      const { data: ns } = await supabase.from('sessions').insert({
        class_id: classId, date: selectedDate!,
        start_time: sch?.start_time ?? '15:00', end_time: sch?.end_time ?? '17:00', status: 'held',
      }).select().single()
      session = ns; setSelectedSession(session); await loadMonthSessions()
    } else {
      await supabase.from('attendance').delete().eq('session_id', session.id)
    }
    const rows = students.map(s => ({ session_id: session!.id, student_id: s.id, status: 'present', note: null }))
    const { data: ins } = await supabase.from('attendance').insert(rows).select()
    const am: Record<string, string> = {}
    for (const a of (ins ?? [])) am[a.student_id] = a.id
    setAttendanceList(students.map(s => ({ id: am[s.id] ?? null, student_id: s.id, status: 'present' as const, note: null })))
    students.forEach(s => applyLivesRule(s.id, 'attendance', { status: 'present', date: selectedDate! }))
  }

  async function deleteSession() {
    if (!selectedSession) return
    const hasAtt = attendanceList.some(a => a.status !== null)
    if (!await showConfirm(hasAtt ? '이 수업을 삭제할까요?\n출석 기록도 함께 삭제돼요.' : '이 수업을 삭제할까요?', { destructive: true })) return
    const affectedStudents = attendanceList.filter(a => a.status !== null).map(a => a.student_id)
    await supabase.from('attendance').delete().eq('session_id', selectedSession.id)
    await supabase.from('sessions').delete().eq('id', selectedSession.id)
    setSelectedSession(null)
    setAttendanceList(students.map(s => ({ id: null, student_id: s.id, status: null, note: null })))
    await loadMonthSessions()
    affectedStudents.forEach(sid => applyLivesRule(sid, 'attendance', { status: null, date: selectedDate! }))
  }

  async function addExtraSession(e: React.FormEvent) {
    e.preventDefault(); setSavingExtra(true)
    const { data: ns } = await supabase.from('sessions').insert({
      class_id: classId, date: extraDate,
      start_time: extraForm.start_time, end_time: extraForm.end_time, status: 'held',
    }).select().single()
    setSavingExtra(false); setShowAddExtra(false)
    await loadMonthSessions()
    if (ns) {
      setSelectedDate(extraDate); setSelectedSession(ns)
      setAttendanceList(students.map(s => ({ id: null, student_id: s.id, status: null, note: null })))
      setDetailStudent(null)
    }
  }

  async function addExtraClinicSession(e: React.FormEvent) {
    e.preventDefault()
    setExtraClinicError('')
    if (extraClinicForm.end_time <= extraClinicForm.start_time) {
      setExtraClinicError('종료 시간은 시작 시간보다 늦어야 해요.')
      return
    }
    setSavingExtraClinic(true)
    const { data: ns } = await supabase.from('clinic_sessions').insert({
      class_id: classId, date: extraClinicDate,
      name: extraClinicForm.name || null,
      start_time: extraClinicForm.start_time, end_time: extraClinicForm.end_time, note: null,
    }).select().single()
    setSavingExtraClinic(false)
    setShowAddExtraClinic(false)
    setExtraClinicError('')
    await loadMonthSessions()
    if (ns) {
      setSelectedDate(extraClinicDate)
      setSelectedClinicSession(ns)
      setClinicAttList(students.map(s => ({ id: null, student_id: s.id, status: null })))
      setDetailStudent(null)
      setPanelTab('clinic')
    }
  }

  // ── 클리닉 출석
  async function markClinicAttendance(studentId: string, status: 'done' | 'not_done') {
    let cs = selectedClinicSession
    if (!cs) {
      const { data: ns } = await supabase.from('clinic_sessions').insert({
        class_id: classId, date: selectedDate!, note: null,
      }).select().single()
      cs = ns; setSelectedClinicSession(cs); await loadMonthSessions()
    }
    const rec = clinicAttList.find(a => a.student_id === studentId)
    if (rec?.id) {
      if (rec.status === status) {
        await supabase.from('clinic_attendance').delete().eq('id', rec.id)
        setClinicAttList(prev => prev.map(a =>
          a.student_id === studentId ? { ...a, id: null, status: null } : a))
        applyLivesRule(studentId, 'clinic', { status: null, date: selectedDate! })
      } else {
        await supabase.from('clinic_attendance').update({ status }).eq('id', rec.id)
        setClinicAttList(prev => prev.map(a =>
          a.student_id === studentId ? { ...a, status } : a))
        applyLivesRule(studentId, 'clinic', { status, date: selectedDate! })
      }
    } else {
      const { data: na } = await supabase.from('clinic_attendance').insert({
        clinic_session_id: cs!.id, student_id: studentId, status,
      }).select().single()
      setClinicAttList(prev => prev.map(a =>
        a.student_id === studentId ? { ...a, id: na?.id ?? null, status } : a))
      applyLivesRule(studentId, 'clinic', { status, date: selectedDate! })
    }
  }

  async function markAllClinicDone() {
    let cs = selectedClinicSession
    if (!cs) {
      const { data: ns } = await supabase.from('clinic_sessions').insert({
        class_id: classId, date: selectedDate!, note: null,
      }).select().single()
      cs = ns; setSelectedClinicSession(cs); await loadMonthSessions()
    } else {
      await supabase.from('clinic_attendance').delete().eq('clinic_session_id', cs.id)
    }
    const rows = students.map(s => ({ clinic_session_id: cs!.id, student_id: s.id, status: 'done' }))
    const { data: ins } = await supabase.from('clinic_attendance').insert(rows).select()
    const am: Record<string, string> = {}
    for (const a of (ins ?? [])) am[a.student_id] = a.id
    setClinicAttList(students.map(s => ({ id: am[s.id] ?? null, student_id: s.id, status: 'done' as const })))
    students.forEach(s => applyLivesRule(s.id, 'clinic', { status: 'done', date: selectedDate! }))
  }

  async function deleteClinicSession() {
    if (!selectedClinicSession) return
    if (!await showConfirm('이 클리닉 세션을 삭제할까요?\n기록도 함께 삭제돼요.', { destructive: true })) return
    const affectedClinicStudents = clinicAttList.filter(a => a.status !== null).map(a => a.student_id)
    await supabase.from('clinic_attendance').delete().eq('clinic_session_id', selectedClinicSession.id)
    await supabase.from('clinic_sessions').delete().eq('id', selectedClinicSession.id)
    affectedClinicStudents.forEach(sid => applyLivesRule(sid, 'clinic', { status: null, date: selectedDate! }))
    setSelectedClinicSession(null)
    const _dow = new Date(selectedDate! + 'T00:00:00').getDay()
    setClinicAttList(clinicSchedules.some(s => s.day_of_week === _dow)
      ? students.map(s => ({ id: null, student_id: s.id, status: null }))
      : [])
    await loadMonthSessions()
  }

  async function saveClinicName(name: string) {
    if (!selectedClinicSession) return
    const trimmed = name.trim() || null
    await supabase.from('clinic_sessions').update({ name: trimmed }).eq('id', selectedClinicSession.id)
    setSelectedClinicSession({ ...selectedClinicSession, name: trimmed })
    await loadMonthSessions()
  }

  // ── 목숨 자동화 fire-and-forget 트리거
  function applyLivesRule(studentId: string, eventType: string, eventDetail: Record<string, unknown>) {
    if (!livesEnabled || !academyId) return
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) return
      fetch('/api/lives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'apply-rules', academyId, studentId, eventType, eventDetail }),
      }).catch(() => {})
    })
  }

  // ── 목숨
  async function loadLives() {
    if (!academyId || students.length === 0) return
    setLivesLoading(true)
    const { data } = await supabase.from('student_lives')
      .select('student_id, lives')
      .eq('academy_id', academyId)
      .in('student_id', students.map(s => s.id))
    const map: Record<string, number> = {}
    for (const r of data ?? []) map[r.student_id] = r.lives
    setStudentLives(map)
    setPendingLivesMap(map)
    setLivesLoading(false)
    // 빌보드 로드
    await loadBillboard()
  }

  async function loadBillboard() {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return
    const res = await fetch(`/api/lives/billboard?classId=${classId}`, { headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json()
    setBillboardEnabled(json.billboardEnabled ?? false)
    if (json.billboardEnabled) {
      setBillboard(json.billboard ?? [])
      setBillboardShowLast(json.showLast ?? false)
      setBillboardMinLives(json.minLives ?? null)
    }
    setBillboardLoaded(true)
  }

function adjustLivesDelta(studentId: string, delta: number) {
    const base = pendingLivesMap[studentId] ?? studentLives[studentId] ?? livesDefault
    const next = base + delta
    setPendingLivesMap(prev => ({ ...prev, [studentId]: next }))
    if (livesTimerMap.current[studentId]) clearTimeout(livesTimerMap.current[studentId])
    livesTimerMap.current[studentId] = setTimeout(() => commitLivesAdjust(studentId, next), 1500)
  }

  async function commitLivesAdjust(studentId: string, nextLives: number) {
    const committed = studentLives[studentId] ?? livesDefault
    const netDelta = nextLives - committed
    if (netDelta === 0) return
    setSavingLivesId(studentId)
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { setSavingLivesId(null); return }
    const reason = studentLivesReason[studentId] ?? ''
    const res = await fetch('/api/lives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'manual-adjust', academyId, studentId, delta: netDelta, reason }),
    })
    if (res.ok) {
      const json = await res.json()
      setStudentLives(prev => ({ ...prev, [studentId]: json.lives }))
      setPendingLivesMap(prev => ({ ...prev, [studentId]: json.lives }))
      setStudentLivesReason(prev => ({ ...prev, [studentId]: '' }))
    }
    setSavingLivesId(null)
  }

async function resetAllLives() {
    const ok = await showConfirm(`모든 학생의 목숨을 기본값(${livesDefault}개)으로 초기화할까요?`)
    if (!ok) return
    const upserts = students.map(s => ({
      academy_id: academyId, student_id: s.id,
      lives: livesDefault, updated_at: new Date().toISOString(),
    }))
    await supabase.from('student_lives').upsert(upserts, { onConflict: 'academy_id,student_id' })
    const map: Record<string, number> = {}
    for (const s of students) map[s.id] = livesDefault
    setStudentLives(map)
    setPendingLivesMap(map)
  }

  // ── 출결 현황 통계
  async function loadAttendanceStats() {
    setStatsLoading(true)
    const { data: sessData } = await supabase
      .from('sessions')
      .select('id, date, start_time, end_time')
      .eq('class_id', classId)
      .order('date', { ascending: false })

    if (!sessData || sessData.length === 0) {
      setStatsSessions([]); setStatsStudents([])
      setStatsLoading(false); setStatsLoaded(true); return
    }

    const sessIds = sessData.map((s: any) => s.id)
    const { data: attData } = await supabase
      .from('attendance')
      .select('session_id, student_id, status')
      .in('session_id', sessIds)

    // 세션별 집계 — 해당 수업일 기준 등록된 학생 수만 total에 반영
    const sessMap: Record<string, StatSession> = {}
    for (const s of sessData) {
      const enrolledCount = students.filter(st => !st.enrolled_at || st.enrolled_at <= s.date).length
      sessMap[s.id] = { id: s.id, date: s.date, start_time: s.start_time, end_time: s.end_time, present: 0, late: 0, early_leave: 0, absent: 0, total: enrolledCount }
    }
    // 학생별 집계 — 학생 등록일 이후 세션 수만 sessions에 반영
    const studentMap: Record<string, StatStudent> = {}
    for (const s of students) {
      const relevantSessions = s.enrolled_at
        ? sessData.filter((ss: any) => ss.date >= s.enrolled_at!).length
        : sessData.length
      studentMap[s.id] = { id: s.id, name: s.name, present: 0, late: 0, early_leave: 0, absent: 0, sessions: relevantSessions }
    }

    for (const a of (attData ?? []) as { session_id: string; student_id: string; status: string }[]) {
      const sm = sessMap[a.session_id]
      if (sm) {
        if (a.status === 'present') sm.present++
        else if (a.status === 'late') sm.late++
        else if (a.status === 'early_leave') sm.early_leave++
        else if (a.status === 'absent') sm.absent++
      }
      const um = studentMap[a.student_id]
      if (um) {
        if (a.status === 'present') um.present++
        else if (a.status === 'late') um.late++
        else if (a.status === 'early_leave') um.early_leave++
        else if (a.status === 'absent') um.absent++
      }
    }

    setStatsSessions(Object.values(sessMap))
    setStatsStudents(
      Object.values(studentMap).sort((a, b) => {
        const ra = a.sessions > 0 ? (a.present + a.late) / a.sessions : 0
        const rb = b.sessions > 0 ? (b.present + b.late) / b.sessions : 0
        return rb - ra
      })
    )
    setStatsLoading(false); setStatsLoaded(true)
  }

  // ── 과제
  async function addHomework(e: React.FormEvent) {
    e.preventDefault()
    if (homeworkForm.due_date && homeworkForm.due_date < homeworkForm.assigned_date) {
      void showAlert('마감일은 출제일보다 늦어야 해요.')
      return
    }
    setSavingHomework(true)
    const assignedDate = homeworkForm.assigned_date
    const { error } = await supabase.from('homework').insert({
      class_id: classId,
      title: homeworkForm.title,
      description: homeworkForm.description || null,
      assigned_date: assignedDate,
      due_date: homeworkForm.due_date || null,
    })
    setSavingHomework(false)
    if (error) { void showAlert('저장 오류: ' + error.message); return }
    setShowAddHomework(false)
    setHomeworkForm({ title: '', assigned_date: selectedDate ?? '', due_date: '', description: '' })
    // DB에서 다시 불러와서 목록 갱신
    const { data: hwData } = await supabase
      .from('homework').select('*')
      .eq('class_id', classId).eq('assigned_date', assignedDate)
      .order('created_at')
    setDateHomeworks(hwData ?? [])
  }

  async function deleteHomework(hwId: string) {
    if (!await showConfirm('이 과제를 삭제할까요?', { destructive: true })) return
    const affectedHwStudents = (homeworkStatuses[hwId] ?? []).filter(r => r.status !== null).map(r => r.student_id)
    const hwDate = dateHomeworks.find(h => h.id === hwId)?.assigned_date ?? selectedDate ?? ''
    await supabase.from('homework_status').delete().eq('homework_id', hwId)
    await supabase.from('homework').delete().eq('id', hwId)
    setDateHomeworks(prev => prev.filter(h => h.id !== hwId))
    if (expandedHomeworkId === hwId) setExpandedHomeworkId(null)
    affectedHwStudents.forEach(sid => applyLivesRule(sid, 'homework', { status: null, date: hwDate }))
  }

  async function saveHomeworkDueDate(hwId: string, dueDate: string) {
    const hw = dateHomeworks.find(h => h.id === hwId)
    if (dueDate && hw && dueDate < hw.assigned_date) {
      void showAlert('마감일은 출제일보다 늦어야 해요.')
      setHwDueDateEdits(prev => ({ ...prev, [hwId]: hw.due_date ?? '' }))
      return
    }
    const value = dueDate || null
    await supabase.from('homework').update({ due_date: value }).eq('id', hwId)
    setDateHomeworks(prev => prev.map(h => h.id === hwId ? { ...h, due_date: value } : h))
  }

  async function loadHomeworkStatuses(hwId: string) {
    if (homeworkStatuses[hwId]) return
    const { data } = await supabase.from('homework_status').select('id, student_id, status, note').eq('homework_id', hwId)
    const sm: Record<string, any> = {}
    for (const s of (data ?? [])) sm[s.student_id] = s
    setHomeworkStatuses(prev => ({
      ...prev,
      [hwId]: students.map(s => ({ id: sm[s.id]?.id ?? null, student_id: s.id, status: sm[s.id]?.status ?? null, note: sm[s.id]?.note ?? null })),
    }))
  }

  async function setHomeworkStatus(hwId: string, studentId: string, status: 'done' | 'partial' | 'none') {
    const list = homeworkStatuses[hwId] ?? []
    const rec  = list.find(r => r.student_id === studentId)
    const hwDate = dateHomeworks.find(h => h.id === hwId)?.assigned_date ?? selectedDate ?? ''
    if (rec?.id) {
      if (rec.status === status) {
        await supabase.from('homework_status').delete().eq('id', rec.id)
        setHomeworkStatuses(prev => ({
          ...prev,
          [hwId]: prev[hwId].map(r => r.student_id === studentId ? { ...r, id: null, status: null, note: null } : r),
        }))
        applyLivesRule(studentId, 'homework', { status: null, date: hwDate })
      } else {
        await supabase.from('homework_status').update({ status }).eq('id', rec.id)
        setHomeworkStatuses(prev => ({
          ...prev,
          [hwId]: prev[hwId].map(r => r.student_id === studentId ? { ...r, status } : r),
        }))
        applyLivesRule(studentId, 'homework', { status, date: hwDate })
      }
    } else {
      const { data: nr } = await supabase.from('homework_status').insert({
        homework_id: hwId, student_id: studentId, status,
      }).select().single()
      setHomeworkStatuses(prev => ({
        ...prev,
        [hwId]: (prev[hwId] ?? students.map(s => ({ id: null, student_id: s.id, status: null, note: null }))).map(r =>
          r.student_id === studentId ? { ...r, id: nr?.id ?? null, status } : r
        ),
      }))
      applyLivesRule(studentId, 'homework', { status, date: hwDate })
    }
  }

  function handleHwNoteChange(hwId: string, studentId: string, note: string) {
    setHomeworkStatuses(prev => ({
      ...prev,
      [hwId]: prev[hwId].map(r => r.student_id === studentId ? { ...r, note } : r),
    }))
  }
  async function saveHwNote(hwId: string, studentId: string, note: string) {
    const rec = (homeworkStatuses[hwId] ?? []).find(r => r.student_id === studentId)
    if (!rec?.id) return
    await supabase.from('homework_status').update({ note: note || null }).eq('id', rec.id)
  }

  // ── 캘린더 계산
  const scheduledDays       = useMemo(() => new Set(schedules.map(s => s.day_of_week)), [schedules])
  const clinicScheduledDays = useMemo(() => new Set(clinicSchedules.map(s => s.day_of_week)), [clinicSchedules])
  const { firstDow, daysInMonth } = useMemo(() => ({
    firstDow:    new Date(calYear, calMonth, 1).getDay(),
    daysInMonth: new Date(calYear, calMonth + 1, 0).getDate(),
  }), [calYear, calMonth])

  const stats = useMemo(() => {
    const present     = attendanceList.filter(a => a.status === 'present').length
    const late        = attendanceList.filter(a => a.status === 'late').length
    const early_leave = attendanceList.filter(a => a.status === 'early_leave').length
    const absent      = attendanceList.filter(a => a.status === 'absent').length
    const total       = attendanceList.length
    return { present, late, early_leave, absent, total, rate: total > 0 ? Math.round((present / total) * 100) : 0 }
  }, [attendanceList])

  const clinicDone  = useMemo(() => clinicAttList.filter(a => a.status === 'done').length, [clinicAttList])

  const enrolledIds        = new Set(students.map(s => s.id))
  const availableStudents  = allStudents.filter(s =>
    !enrolledIds.has(s.id) &&
    (s.name.includes(studentSearch) || (s.school_name ?? '').includes(studentSearch))
  )

  function prevMonth() { if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11) } else setCalMonth(m => m - 1); setSelectedDate(null) }
  function nextMonth() { if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0) } else setCalMonth(m => m + 1); setSelectedDate(null) }

  async function resetClass() {
    setResetting(true)
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { setResetting(false); return }
    const res = await fetch(`/api/classes/${classId}/reset`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    setResetting(false)
    if (res.ok) {
      setShowResetModal(false)
      setResetConfirmText('')
      setShowDangerZone(false)
      void showAlert('✅ 초기화가 완료됐어요.')
      // 캘린더 새로고침
      loadMonthSessions()
    } else {
      const err = await res.json()
      void showAlert('오류: ' + (err.error ?? '초기화 실패'))
    }
  }

  if (loading) return <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {dialog}
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/dashboard/classes')}
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{className}</h1>
          <p className="text-sm text-slate-500 mt-0.5">학생 {students.length}명</p>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl overflow-x-auto">
        {([
          { key: 'calendar' as Tab, label: '캘린더',    Icon: CalendarDays },
          { key: 'stats'    as Tab, label: '출결 현황', Icon: TrendingUp },
          { key: 'students' as Tab, label: '학생',       Icon: Users },
          { key: 'schedule' as Tab, label: '수업 설정', Icon: Clock },
          ...(livesEnabled ? [{ key: 'lives' as Tab, label: '목숨', Icon: Heart }] : []),
        ]).map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 min-w-max flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-sm font-medium transition-colors ${
              tab === key ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {/* ════════ 출결 현황 탭 ════════ */}
      {tab === 'stats' && (
        <div className="space-y-6">
          {statsLoading ? (
            <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>
          ) : statsSessions.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <TrendingUp size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">아직 수업 기록이 없어요</p>
              <p className="text-xs mt-1">캘린더에서 날짜를 선택해 출결을 기록해보세요</p>
            </div>
          ) : (() => {
            // 전체 요약
            const totalSess = statsSessions.length
            const totalPresent     = statsSessions.reduce((s, r) => s + r.present, 0)
            const totalLate        = statsSessions.reduce((s, r) => s + r.late, 0)
            const totalEarlyLeave  = statsSessions.reduce((s, r) => s + r.early_leave, 0)
            const totalAbsent      = statsSessions.reduce((s, r) => s + r.absent, 0)
            const totalSlots       = statsSessions.reduce((s, r) => s + r.total, 0)
            const avgRate = totalSlots > 0 ? Math.round((totalPresent / totalSlots) * 100) : 0

            return (
              <>
                {/* 요약 카드 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: '총 수업 횟수', val: `${totalSess}회`,    color: 'text-slate-700',   bg: 'bg-slate-50'   },
                    { label: '평균 출석률',  val: `${avgRate}%`,        color: 'text-blue-600',    bg: 'bg-blue-50'    },
                    { label: '누적 출석',    val: `${totalPresent}건`,  color: 'text-green-600',   bg: 'bg-green-50'   },
                    { label: '누적 결석',    val: `${totalAbsent}건`,   color: 'text-red-500',     bg: 'bg-red-50'     },
                  ].map(({ label, val, color, bg }) => (
                    <div key={label} className={`rounded-2xl border border-slate-200 p-4 text-center ${bg}`}>
                      <p className="text-xs text-slate-500 mb-1">{label}</p>
                      <p className={`text-2xl font-bold ${color}`}>{val}</p>
                    </div>
                  ))}
                </div>

                {/* 수업별 현황 */}
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <p className="font-semibold text-slate-800 text-sm">수업별 출결 현황</p>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {statsSessions.map(s => {
                      const recorded = s.present + s.late + s.early_leave + s.absent
                      const rate = s.total > 0 ? Math.round((s.present / s.total) * 100) : 0
                      const rateColor = rate >= 80 ? 'text-green-600' : rate >= 60 ? 'text-amber-500' : 'text-red-500'
                      return (
                        <div key={s.id} className="px-4 py-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <div>
                              <span className="text-sm font-medium text-slate-700">
                                {new Date(s.date + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' })}
                              </span>
                              <span className="text-xs text-slate-400 ml-2">{s.start_time?.slice(0,5)} ~ {s.end_time?.slice(0,5)}</span>
                            </div>
                            <span className={`text-sm font-bold ${rateColor}`}>{rate}%</span>
                          </div>
                          {/* 바 */}
                          <div className="flex h-2 rounded-full overflow-hidden bg-slate-100 mb-1.5">
                            {s.total > 0 && <>
                              <div className="bg-green-500 transition-all"  style={{ width: `${(s.present     / s.total) * 100}%` }} />
                              <div className="bg-amber-400 transition-all"  style={{ width: `${(s.late        / s.total) * 100}%` }} />
                              <div className="bg-purple-400 transition-all" style={{ width: `${(s.early_leave / s.total) * 100}%` }} />
                              <div className="bg-red-400 transition-all"    style={{ width: `${(s.absent      / s.total) * 100}%` }} />
                            </>}
                          </div>
                          <div className="flex gap-3 text-xs text-slate-500">
                            <span className="text-green-600 font-medium">출석 {s.present}</span>
                            {s.late > 0        && <span className="text-amber-500 font-medium">지각 {s.late}</span>}
                            {s.early_leave > 0 && <span className="text-purple-500 font-medium">조퇴 {s.early_leave}</span>}
                            {s.absent > 0      && <span className="text-red-500 font-medium">결석 {s.absent}</span>}
                            {recorded < s.total && <span className="text-slate-400">미기록 {s.total - recorded}</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* 학생별 현황 */}
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <p className="font-semibold text-slate-800 text-sm">학생별 출결 현황</p>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {statsStudents.map((s, i) => {
                      const recorded = s.present + s.late + s.early_leave + s.absent
                      const rate = s.sessions > 0 ? Math.round((s.present / s.sessions) * 100) : 0
                      const rateColor = rate >= 80 ? 'text-green-600' : rate >= 60 ? 'text-amber-500' : 'text-red-500'
                      return (
                        <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-bold text-blue-600">{i + 1}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800">{s.name}</p>
                            <div className="flex gap-2 text-xs mt-0.5">
                              <span className="text-green-600">출석 {s.present}</span>
                              {s.late > 0        && <span className="text-amber-500">지각 {s.late}</span>}
                              {s.early_leave > 0 && <span className="text-purple-500">조퇴 {s.early_leave}</span>}
                              {s.absent > 0      && <span className="text-red-500">결석 {s.absent}</span>}
                              {recorded < s.sessions && <span className="text-slate-400">미기록 {s.sessions - recorded}</span>}
                            </div>
                          </div>
                          <span className={`text-sm font-bold flex-shrink-0 ${rateColor}`}>{rate}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* ════════ 시간표 탭 ════════ */}
      {tab === 'schedule' && (
        <div className="space-y-8">

          {/* 정규 수업 */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-700">정규 수업 시간표</h2>
                <p className="text-xs text-slate-400 mt-0.5">일주일에 여러 번 수업도 추가할 수 있어요</p>
              </div>
              <button onClick={() => setShowScheduleForm(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors">
                <Plus size={14} /> 수업 추가
              </button>
            </div>
            {schedules.length === 0 ? (
              <div className="text-center py-10 text-slate-400">
                <Clock size={28} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">정기 수업 시간이 없어요</p>
              </div>
            ) : (
              <div className="space-y-2">
                {schedules.map(s => (
                  <div key={s.id} className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-600 font-bold text-base">{DAYS[s.day_of_week]}</span>
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-slate-800">{DAYS[s.day_of_week]}요일</p>
                      <p className="text-sm text-slate-500">{s.start_time.slice(0,5)} ~ {s.end_time.slice(0,5)}</p>
                    </div>
                    <button onClick={() => deleteSchedule(s.id)} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 클리닉 일정 */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-700">클리닉 일정</h2>
                <p className="text-xs text-slate-400 mt-0.5">클리닉 요일/시간을 설정해요. 여러 날도 가능해요 · 요일 변경은 <span className="font-medium text-slate-500">월·화 등 요일 뱃지</span>를 클릭하세요</p>
              </div>
              <button onClick={() => setShowClinicScheduleForm(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-violet-600 bg-violet-50 rounded-xl hover:bg-violet-100 transition-colors">
                <Plus size={14} /> 클리닉 추가
              </button>
            </div>
            {clinicSchedules.length === 0 ? (
              <div className="text-center py-10 text-slate-400">
                <Activity size={28} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">클리닉 일정이 없어요</p>
              </div>
            ) : (
              <div className="space-y-2">
                {clinicSchedules.map(s => {
                  const editName  = clinicNameEdits[s.id] ?? (s.name ?? '')
                  const editTimes = clinicTimeEdits[s.id] ?? { start: s.start_time.slice(0,5), end: s.end_time.slice(0,5) }
                  return (
                  <div key={s.id} className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3">
                    {/* 요일 선택 */}
                    <select
                      value={s.day_of_week}
                      onChange={e => saveClinicScheduleDay(s.id, Number(e.target.value))}
                      className="w-12 h-12 rounded-xl bg-violet-50 text-violet-600 font-bold text-base text-center border-none focus:outline-none focus:ring-2 focus:ring-violet-400 cursor-pointer flex-shrink-0 appearance-none"
                    >
                      {DAYS.map((d, i) => (
                        <option key={i} value={i}>{d}</option>
                      ))}
                    </select>

                    <div className="flex-1 min-w-0 space-y-1">
                      {/* 이름 */}
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setClinicNameEdits(prev => ({ ...prev, [s.id]: e.target.value }))}
                        onBlur={e => saveClinicScheduleName(s.id, e.target.value)}
                        placeholder={`${DAYS[s.day_of_week]}요일 클리닉`}
                        className="w-full font-semibold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-violet-400 focus:outline-none pb-0.5 placeholder-slate-300 text-sm transition-colors"
                      />
                      {/* 시간 */}
                      <div className="flex items-center gap-1">
                        <input
                          type="time"
                          value={editTimes.start}
                          onChange={e => setClinicTimeEdits(prev => ({ ...prev, [s.id]: { ...editTimes, start: e.target.value } }))}
                          onBlur={e => saveClinicScheduleTime(s.id, e.target.value, editTimes.end)}
                          className="text-xs text-slate-500 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-violet-400 focus:outline-none cursor-pointer"
                        />
                        <span className="text-xs text-slate-400">~</span>
                        <input
                          type="time"
                          value={editTimes.end}
                          onChange={e => setClinicTimeEdits(prev => ({ ...prev, [s.id]: { ...editTimes, end: e.target.value } }))}
                          onBlur={e => saveClinicScheduleTime(s.id, editTimes.start, e.target.value)}
                          className="text-xs text-slate-500 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-violet-400 focus:outline-none cursor-pointer"
                        />
                      </div>
                    </div>

                    <button onClick={() => deleteClinicSchedule(s.id)} className="p-2 text-slate-400 hover:text-red-500 transition-colors flex-shrink-0">
                      <Trash2 size={15} />
                    </button>
                  </div>
                )})}
              </div>
            )}
          </div>

          {/* ── 위험 구역 ── */}
          <div className="border border-red-200 rounded-2xl overflow-hidden">
            <button
              onClick={() => setShowDangerZone(v => !v)}
              className="w-full flex items-center justify-between px-5 py-4 bg-red-50 hover:bg-red-100 transition-colors text-left">
              <div className="flex items-center gap-2 text-red-600">
                <AlertTriangle size={16} />
                <span className="font-semibold text-sm">위험 구역</span>
              </div>
              <ChevronDown size={16} className={`text-red-400 transition-transform ${showDangerZone ? 'rotate-180' : ''}`} />
            </button>
            {showDangerZone && (
              <div className="px-5 py-4 bg-white space-y-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">반 기록 전체 초기화</p>
                  <p className="text-xs text-slate-500 mt-1">출결, 시험, 숙제, 클리닉, 성적 기록이 모두 삭제돼요.<br />학생 명단과 시간표는 유지됩니다. 새 학기 시작 시 사용하세요.</p>
                </div>
                <button
                  onClick={() => { setResetConfirmText(''); setShowResetModal(true) }}
                  className="flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 transition-colors">
                  <AlertTriangle size={14} /> 기록 초기화
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════ 학생 탭 ════════ */}
      {tab === 'students' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">소속 학생 {students.length}명</h2>
            <button onClick={() => setShowAddStudent(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors">
              <Plus size={14} /> 학생 배정
            </button>
          </div>
          {students.length === 0 ? (
            <div className="text-center py-14 text-slate-400">
              <Users size={32} className="mx-auto mb-2 opacity-30" />
              <p>배정된 학생이 없어요</p>
            </div>
          ) : (
            <div className="space-y-2">
              {students.map(s => {
                const isExpanded = expandedStudentId === s.id
                return (
                  <div key={s.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="p-4 flex items-center gap-3 cursor-pointer hover:bg-slate-50 transition-colors"
                      onClick={() => setExpandedStudentId(isExpanded ? null : s.id)}>
                      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-blue-600 font-bold text-sm">{s.name[0]}</span>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-800">{s.name}</p>
                          {s.school_name && <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">{s.school_name}</span>}
                          <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">{s.grade}학년</span>
                        </div>
                        <p className="text-sm text-slate-500">{formatPhone(s.phone)}</p>
                      </div>
                      <button onClick={e => { e.stopPropagation(); removeStudent(s.id, s.name) }}
                        className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                        <X size={15} />
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                          <div><p className="text-slate-400 mb-0.5">학교</p><p className="text-slate-700 font-medium">{s.school_name ?? '-'}</p></div>
                          <div><p className="text-slate-400 mb-0.5">학년</p><p className="text-slate-700 font-medium">{s.grade}학년</p></div>
                          <div><p className="text-slate-400 mb-0.5">학생 전화번호</p><p className="text-slate-700 font-medium">{formatPhone(s.phone)}</p></div>
                          <div>
                            <p className="text-slate-400 mb-0.5">학부모 전화번호</p>
                            <p className="text-slate-700 font-medium">
                              {s.parent_phone ? formatPhone(s.parent_phone) : '-'}
                              {s.parent_relation && <span className="text-slate-400 font-normal ml-1">({s.parent_relation})</span>}
                            </p>
                          </div>
                          {s.memo && (
                            <div className="col-span-2"><p className="text-slate-400 mb-0.5">메모</p><p className="text-slate-700 font-medium">{s.memo}</p></div>
                          )}
                        </div>
                        <button
                          onClick={() => router.push(`/dashboard/students/${s.id}?from=${encodeURIComponent(`/dashboard/classes/${classId}?tab=students`)}`)}
                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:border-blue-300 hover:text-blue-600 transition-colors">
                          <FileText size={14} /> 리포트 보기
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {showAddStudent && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
              <div className="bg-white rounded-2xl w-full max-w-md max-h-[82vh] flex flex-col">
                <div className="flex items-center justify-between p-5 border-b border-slate-100">
                  <div>
                    <h2 className="font-bold text-slate-800">학생 배정</h2>
                    <p className="text-xs text-slate-500 mt-0.5">여러 명 선택 후 한 번에 배정할 수 있어요</p>
                  </div>
                  <button onClick={() => { setShowAddStudent(false); setSelectedNewIds(new Set()); setStudentSearch('') }}
                    className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                </div>
                <div className="p-4 border-b border-slate-100">
                  <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="text" value={studentSearch} onChange={e => setStudentSearch(e.target.value)}
                      placeholder="이름 또는 학교로 검색" autoFocus
                      className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div className="overflow-y-auto flex-1 p-3 space-y-1">
                  {availableStudents.length === 0 ? (
                    <p className="text-center py-10 text-slate-400 text-sm">배정 가능한 학생이 없어요</p>
                  ) : availableStudents.map(s => {
                    const checked = selectedNewIds.has(s.id)
                    return (
                      <button key={s.id} onClick={() => toggleNewId(s.id)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors text-left ${checked ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${checked ? 'bg-blue-600 border-blue-600' : 'border-slate-300'}`}>
                          {checked && <Check size={12} className="text-white" strokeWidth={3} />}
                        </div>
                        <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-slate-600 font-bold text-sm">{s.name[0]}</span>
                        </div>
                        <div>
                          <p className="font-medium text-slate-800 text-sm">{s.name}</p>
                          <p className="text-xs text-slate-500">{[s.school_name, s.grade ? `${s.grade}학년` : ''].filter(Boolean).join(' · ')}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
                <div className="p-4 border-t border-slate-100">
                  <button onClick={assignStudents} disabled={selectedNewIds.size === 0 || assigning}
                    className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40">
                    {assigning ? '배정 중...' : selectedNewIds.size > 0 ? `${selectedNewIds.size}명 배정하기` : '학생을 선택해주세요'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════ 캘린더 탭 ════════ */}
      {tab === 'calendar' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button onClick={prevMonth} className="p-2 text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"><ChevronLeft size={20} /></button>
            <h2 className="font-bold text-slate-800 text-lg">{calYear}년 {calMonth + 1}월</h2>
            <button onClick={nextMonth} className="p-2 text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"><ChevronRight size={20} /></button>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="grid grid-cols-7 border-b border-slate-100">
              {DAYS.map((d, i) => (
                <div key={i} className={`py-2.5 text-center text-xs font-semibold ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-slate-400'}`}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} className="h-14" />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day     = i + 1
                const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                const dow     = new Date(dateStr + 'T00:00:00').getDay()
                const isClassDay   = scheduledDays.has(dow)
                const isClinicDay  = clinicScheduledDays.has(dow)
                const hasSession      = !!sessionsInMonth[dateStr]
                const hasClinicSess   = !!clinicSessionsInMonth[dateStr]
                const isToday    = dateStr === todayStr
                const isSelected = dateStr === selectedDate
                const col = (firstDow + i) % 7

                function handleDayClick() {
                  if (hasSession || isClassDay || hasClinicSess || isClinicDay) {
                    selectDate(dateStr)
                  } else {
                    setTypeChoiceDate(dateStr)
                    setShowTypeChoice(true)
                  }
                }

                return (
                  <div key={day} onClick={handleDayClick}
                    className={`h-14 flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer
                      ${isSelected ? 'bg-blue-50' : isClassDay || isClinicDay ? 'hover:bg-slate-50' : 'hover:bg-slate-50'}
                    `}>
                    <span className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-medium transition-colors
                      ${isSelected ? 'bg-blue-600 text-white' : ''}
                      ${!isSelected && isToday ? 'bg-slate-200 text-slate-700' : ''}
                      ${!isSelected && !isToday && col === 0 ? 'text-red-400' : ''}
                      ${!isSelected && !isToday && col === 6 ? 'text-blue-400' : ''}
                      ${!isSelected && !isToday && col !== 0 && col !== 6 ? 'text-slate-700' : ''}
                    `}>{day}</span>
                    <div className="flex gap-0.5 items-center h-2">
                      {(hasSession || isClassDay) && (
                        <div className={`w-1.5 h-1.5 rounded-full ${hasSession ? 'bg-blue-500' : 'bg-blue-200'}`} />
                      )}
                      {(hasClinicSess || isClinicDay) && (
                        <div className={`w-1.5 h-1.5 rounded-full ${hasClinicSess ? 'bg-violet-500' : 'bg-violet-200'}`} />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 범례 */}
          <div className="flex items-center gap-4 text-xs text-slate-500 px-1 flex-wrap">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />수업 기록</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-200 inline-block" />수업 예정</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-violet-500 inline-block" />클리닉 기록</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-violet-200 inline-block" />클리닉 예정</span>
          </div>

          {/* 날짜 패널 */}
          {selectedDate && (() => {
            const canRecord  = true
            const dow        = new Date(selectedDate + 'T00:00:00').getDay()
            const isRegDay   = !!selectedSession   || schedules.some(s => s.day_of_week === dow)
            const isClinicDy = !!selectedClinicSession || clinicSchedules.some(s => s.day_of_week === dow)

            const availTabs: PanelTab[] = ['attendance', 'homework', 'clinic']

            const PTAB_LABEL: Record<PanelTab, string> = { attendance: '출결', homework: '과제', clinic: '클리닉' }

            return (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">

                {/* 패널 헤더 */}
                <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800">
                      {new Date(selectedDate + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
                    </p>
                    {selectedSession && panelTab === 'attendance' && (
                      <p className="text-sm text-slate-500 mt-0.5">{selectedSession.start_time.slice(0,5)} ~ {selectedSession.end_time.slice(0,5)}</p>
                    )}
                    {selectedClinicSession && panelTab === 'clinic' && (
                      <input
                        key={selectedClinicSession.id}
                        defaultValue={selectedClinicSession.name ?? ''}
                        onBlur={e => saveClinicName(e.target.value)}
                        placeholder="클리닉 이름 (예: 오답 클리닉)"
                        className="text-sm text-violet-600 font-medium mt-0.5 bg-transparent border-b border-transparent hover:border-violet-300 focus:border-violet-500 focus:outline-none w-full placeholder:text-slate-300"
                      />
                    )}
                    {selectedClinicSession && panelTab === 'clinic' && selectedClinicSession.start_time && (
                      <p className="text-xs text-slate-400 mt-0.5">{selectedClinicSession.start_time.slice(0,5)} ~ {selectedClinicSession.end_time?.slice(0,5)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {canRecord && !loadingAtt && panelTab === 'attendance' && attendanceList.length > 0 && (
                      <button onClick={markAllPresent}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-xl hover:bg-green-100 transition-colors">
                        <CheckCheck size={13} /> 전체 출석
                      </button>
                    )}
                    {canRecord && !loadingAtt && panelTab === 'clinic' && clinicAttList.length > 0 && (
                      <button onClick={markAllClinicDone}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-700 bg-violet-50 rounded-xl hover:bg-violet-100 transition-colors">
                        <CheckCheck size={13} /> 전체 완료
                      </button>
                    )}
                    {selectedSession && panelTab === 'attendance' && (
                      <button onClick={deleteSession}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 bg-red-50 rounded-xl hover:bg-red-100 transition-colors">
                        <Trash2 size={13} /> 수업 삭제
                      </button>
                    )}
                    {selectedClinicSession && panelTab === 'clinic' && (
                      <button onClick={deleteClinicSession}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 bg-red-50 rounded-xl hover:bg-red-100 transition-colors">
                        <Trash2 size={13} /> 클리닉 삭제
                      </button>
                    )}
                    {canRecord && !loadingAtt && panelTab === 'attendance' && stats.total > 0 && (
                      <div className="text-right">
                        <p className="text-2xl font-bold text-blue-600">{stats.rate}%</p>
                        <p className="text-xs text-slate-400">출석률</p>
                      </div>
                    )}
                    {canRecord && !loadingAtt && panelTab === 'clinic' && clinicAttList.length > 0 && (
                      <div className="text-right">
                        <p className="text-2xl font-bold text-violet-600">{clinicDone}/{clinicAttList.length}</p>
                        <p className="text-xs text-slate-400">완료</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* 패널 탭 (2개 이상일 때만) */}
                {availTabs.length > 1 && (
                  <div className="flex border-b border-slate-100">
                    {availTabs.map(t => (
                      <button key={t} onClick={() => setPanelTab(t)}
                        className={`flex-1 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                          panelTab === t ? 'text-blue-600 border-blue-600' : 'text-slate-500 border-transparent hover:text-slate-700'
                        }`}>
                        {PTAB_LABEL[t]}
                      </button>
                    ))}
                  </div>
                )}

                {loadingAtt ? (
                  <div className="py-10 text-center text-slate-400 text-sm">불러오는 중...</div>
                ) : (
                  <>
                    {/* ── 출결 탭 ── */}
                    {panelTab === 'attendance' && (
                      !canRecord ? (
                        <div className="py-10 text-center text-slate-400 text-sm">수업일에 열려요</div>
                      ) : (
                        <>
                          {stats.total > 0 && (
                            <div className="grid grid-cols-4 divide-x divide-slate-100 border-b border-slate-100">
                              {[
                                { label: '출석', val: stats.present,     color: 'text-green-600' },
                                { label: '지각', val: stats.late,        color: 'text-amber-500' },
                                { label: '조퇴', val: stats.early_leave, color: 'text-purple-500' },
                                { label: '결석', val: stats.absent,      color: 'text-red-500' },
                              ].map(({ label, val, color }) => (
                                <div key={label} className="py-3 text-center">
                                  <p className={`text-xl font-bold ${color}`}>{val}</p>
                                  <p className="text-xs text-slate-400">{label}</p>
                                </div>
                              ))}
                            </div>
                          )}

                          {(dateTests.length > 0 || dayExams.length > 0) && (
                            <div className="px-4 py-3 border-b border-slate-100 space-y-1.5">
                              <p className="text-xs font-semibold text-slate-500 mb-2">이날 시험</p>
                              {dateTests.map(t => (
                                <button key={t.id}
                                  onClick={() => router.push(`/dashboard/grades?classId=${classId}&testId=${t.id}`)}
                                  className="w-full flex items-center gap-3 p-2.5 bg-emerald-50 rounded-xl hover:bg-emerald-100 transition-colors text-left">
                                  <BarChart2 size={15} className="text-emerald-600 flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-emerald-800 truncate">{t.name}</p>
                                    <p className="text-xs text-emerald-600">만점 {t.max_score}점</p>
                                  </div>
                                  <span className="text-xs text-emerald-600 flex-shrink-0">성적 보기 →</span>
                                </button>
                              ))}
                              {dayExams.map(e => (
                                <button key={e.id}
                                  onClick={() => router.push(`/dashboard/grades?classId=${classId}&examId=${e.id}`)}
                                  className="w-full flex items-center gap-3 p-2.5 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors text-left">
                                  <BarChart2 size={15} className="text-blue-600 flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-blue-800 truncate">{e.title}</p>
                                    <p className="text-xs text-blue-500">{e.exam_type === 'auto' ? '자동채점' : '수동입력'} · {e.status === 'closed' ? '마감' : '진행중'}</p>
                                  </div>
                                  <span className="text-xs text-blue-600 flex-shrink-0">성적 보기 →</span>
                                </button>
                              ))}
                            </div>
                          )}

                          {attendanceList.length === 0 ? (
                            <p className="text-center py-8 text-slate-400 text-sm">배정된 학생이 없어요</p>
                          ) : (
                            <div className="divide-y divide-slate-50">
                              {attendanceList.map(att => {
                                const student  = students.find(s => s.id === att.student_id)
                                if (!student) return null
                                const isDetail = detailStudent?.id === student.id
                                const showAttNote = !!att.note || openAttNotes.has(att.student_id)
                                return (
                                  <div key={att.student_id}>
                                    <div className="flex items-center gap-3 px-4 py-3">
                                      <button onClick={() => setDetailStudent(isDetail ? null : student)}
                                        className="flex items-center gap-3 flex-1 text-left min-w-0">
                                        <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                                          att.status === 'present' ? 'bg-green-100' : att.status === 'late' ? 'bg-amber-100'
                                          : att.status === 'early_leave' ? 'bg-purple-100' : att.status === 'absent' ? 'bg-red-100' : 'bg-slate-100'
                                        }`}>
                                          <span className={`font-bold text-sm ${
                                            att.status === 'present' ? 'text-green-600' : att.status === 'late' ? 'text-amber-600'
                                            : att.status === 'early_leave' ? 'text-purple-600' : att.status === 'absent' ? 'text-red-500' : 'text-slate-500'
                                          }`}>{student.name[0]}</span>
                                        </div>
                                        <div className="min-w-0">
                                          <p className="font-medium text-slate-800 text-sm truncate">{student.name}</p>
                                          <p className="text-xs text-slate-400">
                                            {student.grade}학년{student.school_name ? ` · ${student.school_name}` : ''}
                                          </p>
                                        </div>
                                      </button>
                                      <div className="flex gap-1 flex-shrink-0 items-center">
                                        {(['present', 'late', 'early_leave', 'absent'] as const).map(s => (
                                          <button key={s} onClick={() => markAttendance(att.student_id, s)}
                                            className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                              att.status === s ? ATT_ACTIVE[s] : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                                            }`}>
                                            {ATT_LABEL[s]}
                                          </button>
                                        ))}
                                        {att.status !== null && (
                                          <button onClick={() => setOpenAttNotes(prev => {
                                            const next = new Set(prev)
                                            next.has(att.student_id) ? next.delete(att.student_id) : next.add(att.student_id)
                                            return next
                                          })}
                                            className={`p-1.5 rounded-lg border transition-colors ${
                                              att.note ? 'border-blue-300 text-blue-500 bg-blue-50' : showAttNote ? 'border-blue-300 text-blue-500 bg-blue-50' : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:bg-slate-50'
                                            }`}>
                                            <MessageSquare size={13} />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    {showAttNote && att.status !== null && (
                                      <div className="px-4 pb-3">
                                        <input type="text" value={att.note ?? ''}
                                          onChange={e => handleNoteChange(att.student_id, e.target.value)}
                                          onBlur={e => saveNote(att.student_id, e.target.value)}
                                          placeholder="코멘트 입력 (선택)"
                                          className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-slate-50" />
                                      </div>
                                    )}
                                    {isDetail && (
                                      <div className="mx-4 mb-3 p-4 bg-slate-50 rounded-2xl text-sm space-y-3 border border-slate-100">
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                                          <div><p className="text-slate-400 mb-0.5">학교</p><p className="text-slate-700 font-medium">{student.school_name ?? '-'}</p></div>
                                          <div><p className="text-slate-400 mb-0.5">학년</p><p className="text-slate-700 font-medium">{student.grade}학년</p></div>
                                          <div><p className="text-slate-400 mb-0.5">학생 전화번호</p><p className="text-slate-700 font-medium">{formatPhone(student.phone)}</p></div>
                                          <div>
                                            <p className="text-slate-400 mb-0.5">학부모 전화번호</p>
                                            <p className="text-slate-700 font-medium">
                                              {student.parent_phone ? formatPhone(student.parent_phone) : '-'}
                                              {student.parent_relation && <span className="text-slate-400 font-normal ml-1">({student.parent_relation})</span>}
                                            </p>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </>
                      )
                    )}

                    {/* ── 과제 탭 ── */}
                    {panelTab === 'homework' && (
                      <div className="divide-y divide-slate-50">
                        {/* 추가 버튼 */}
                        <div className="px-4 py-3">
                          <button
                            onClick={() => { setHomeworkForm({ title: '', assigned_date: selectedDate ?? '', due_date: '', description: '' }); setShowAddHomework(true) }}
                            className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-slate-300 rounded-xl text-sm text-slate-500 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-colors">
                            <Plus size={15} /> 과제 추가
                          </button>
                        </div>

                        {dateHomeworks.length === 0 ? (
                          <div className="py-10 text-center text-slate-400 text-sm">
                            <BookOpen size={28} className="mx-auto mb-2 opacity-30" />
                            이날 출제된 과제가 없어요
                          </div>
                        ) : dateHomeworks.map(hw => {
                          const statuses  = homeworkStatuses[hw.id] ?? []
                          const doneCount = statuses.filter(r => r.status === 'done').length
                          const partCount = statuses.filter(r => r.status === 'partial').length
                          const noneCount = statuses.filter(r => r.status === 'none').length

                          return (
                            <div key={hw.id} className="border-b border-slate-100 last:border-0">
                              {/* 과제 헤더 */}
                              <div className="flex items-center gap-3 px-4 py-3">
                                <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
                                  <BookOpen size={15} className="text-orange-500" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-slate-800 text-sm truncate">{hw.title}</p>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    <div className="flex items-center gap-1">
                                      <span className="text-xs text-slate-400">마감</span>
                                      <input
                                        type="date"
                                        value={hwDueDateEdits[hw.id] ?? (hw.due_date ?? '')}
                                        onChange={e => setHwDueDateEdits(prev => ({ ...prev, [hw.id]: e.target.value }))}
                                        onBlur={e => saveHomeworkDueDate(hw.id, e.target.value)}
                                        className="text-xs text-slate-500 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-400 focus:outline-none cursor-pointer"
                                      />
                                    </div>
                                    {statuses.length > 0 && (
                                      <span className="text-xs text-slate-400">
                                        {partCount > 0 && <span className="text-teal-600 font-medium">오답(완벽) 완료 {partCount} · </span>}
                                        완료 {doneCount} · 미완료 {noneCount}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <button onClick={() => deleteHomework(hw.id)}
                                  className="p-1.5 text-slate-400 hover:text-red-500 transition-colors flex-shrink-0">
                                  <Trash2 size={14} />
                                </button>
                              </div>

                              {/* 학생 현황 — 항상 표시 */}
                              <div className="divide-y divide-slate-50 bg-slate-50/50">
                                {hw.description && (
                                  <div className="px-4 py-2">
                                    <p className="text-xs text-slate-500">{hw.description}</p>
                                  </div>
                                )}
                                {students.length === 0 ? (
                                  <p className="text-center py-5 text-slate-400 text-sm">배정된 학생이 없어요</p>
                                ) : statuses.length === 0 ? (
                                  <p className="text-center py-5 text-slate-400 text-sm">불러오는 중...</p>
                                ) : statuses.map(rec => {
                                  const student = students.find(s => s.id === rec.student_id)
                                  if (!student) return null
                                  const hwNoteKey = `${hw.id}-${rec.student_id}`
                                  const showHwNote = !!rec.note || openHwNotes.has(hwNoteKey)
                                  return (
                                    <div key={rec.student_id}>
                                      <div className="flex items-center gap-3 px-4 py-2.5">
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-medium text-slate-800 truncate">{student.name}</p>
                                          <p className="text-xs text-slate-400">
                                            {student.grade}학년{student.school_name ? ` · ${student.school_name}` : ''}
                                          </p>
                                        </div>
                                        <div className="flex gap-1 flex-shrink-0 items-center">
                                          {(['partial', 'done', 'none'] as const).map(s => (
                                            <button key={s} onClick={() => setHomeworkStatus(hw.id, rec.student_id, s)}
                                              className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                                rec.status === s ? HW_ACTIVE[s] : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                                              }`}>
                                              {HW_LABEL[s]}
                                            </button>
                                          ))}
                                          {rec.status !== null && (
                                            <button onClick={() => setOpenHwNotes(prev => {
                                              const next = new Set(prev)
                                              next.has(hwNoteKey) ? next.delete(hwNoteKey) : next.add(hwNoteKey)
                                              return next
                                            })}
                                              className={`p-1.5 rounded-lg border transition-colors ${
                                                rec.note ? 'border-orange-300 text-orange-500 bg-orange-50' : showHwNote ? 'border-orange-300 text-orange-500 bg-orange-50' : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:bg-slate-50'
                                              }`}>
                                              <MessageSquare size={13} />
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                      {showHwNote && rec.status !== null && (
                                        <div className="px-4 pb-2.5">
                                          <input type="text" value={rec.note ?? ''}
                                            onChange={e => handleHwNoteChange(hw.id, rec.student_id, e.target.value)}
                                            onBlur={e => saveHwNote(hw.id, rec.student_id, e.target.value)}
                                            placeholder="코멘트 입력 (선택)"
                                            className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-orange-400 bg-slate-50" />
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* ── 클리닉 탭 ── */}
                    {panelTab === 'clinic' && (
                      !canRecord ? (
                        <div className="py-10 text-center text-slate-400 text-sm">클리닉 일에 열려요</div>
                      ) : (
                        <>
                          {clinicAttList.length === 0 ? (
                            <div className="py-10 text-center space-y-3">
                              <p className="text-slate-400 text-sm">정규 클리닉 일정이 아닌 날이에요</p>
                              <button
                                onClick={() => { setExtraClinicDate(selectedDate!); setExtraClinicForm({ name: '', start_time: '16:00', end_time: '18:00' }); setShowAddExtraClinic(true) }}
                                className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition-colors mx-auto">
                                <Plus size={14} /> 클리닉 추가
                              </button>
                            </div>
                          ) : (
                          <>
                            {/* 클리닉 이름 표시 */}
                            {(() => {
                              const dow = new Date(selectedDate + 'T00:00:00').getDay()
                              const cs  = clinicSchedules.find(s => s.day_of_week === dow)
                              const title = selectedClinicSession?.name || cs?.name || `${DAYS[dow]}요일 클리닉`
                              return (
                                <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                                  <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                                    <Activity size={13} className="text-violet-600" />
                                  </div>
                                  <p className="font-semibold text-slate-800 text-sm">{title}</p>
                                </div>
                              )
                            })()}
                            <div className="divide-y divide-slate-50">
                              {clinicAttList.map(att => {
                                const student = students.find(s => s.id === att.student_id)
                                if (!student) return null
                                return (
                                  <div key={att.student_id} className="flex items-center gap-3 px-4 py-3">
                                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                                      att.status === 'done' ? 'bg-green-100' : att.status === 'not_done' ? 'bg-red-100' : 'bg-slate-100'
                                    }`}>
                                      <span className={`font-bold text-sm ${
                                        att.status === 'done' ? 'text-green-600' : att.status === 'not_done' ? 'text-red-500' : 'text-slate-500'
                                      }`}>{student.name[0]}</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="font-medium text-slate-800 text-sm truncate">{student.name}</p>
                                      <p className="text-xs text-slate-400">{student.grade}학년{student.school_name ? ` · ${student.school_name}` : ''}</p>
                                    </div>
                                    <div className="flex gap-1.5 flex-shrink-0">
                                      <button onClick={() => markClinicAttendance(att.student_id, 'done')}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                          att.status === 'done' ? 'bg-green-500 text-white border-green-500' : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                                        }`}>완료</button>
                                      <button onClick={() => markClinicAttendance(att.student_id, 'not_done')}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                          att.status === 'not_done' ? 'bg-red-500 text-white border-red-500' : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                                        }`}>미완료</button>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </>
                          )}
                        </>
                      )
                    )}
                  </>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* ════════ 수업/클리닉 선택 모달 ════════ */}
      {showTypeChoice && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h2 className="font-bold text-slate-800">무엇을 추가할까요?</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {new Date(typeChoiceDate + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
                </p>
              </div>
              <button onClick={() => setShowTypeChoice(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setShowTypeChoice(false)
                  setExtraDate(typeChoiceDate)
                  setExtraForm({ start_time: '15:00', end_time: '17:00' })
                  setShowAddExtra(true)
                }}
                className="flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-all group"
              >
                <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                  <CalendarDays size={22} className="text-blue-600" />
                </div>
                <span className="text-sm font-semibold text-slate-700">수업</span>
              </button>
              <button
                onClick={() => {
                  setShowTypeChoice(false)
                  setExtraClinicDate(typeChoiceDate)
                  setExtraClinicForm({ name: '', start_time: '16:00', end_time: '18:00' })
                  setShowAddExtraClinic(true)
                }}
                className="flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-slate-200 hover:border-violet-400 hover:bg-violet-50 transition-all group"
              >
                <div className="w-12 h-12 bg-violet-100 rounded-2xl flex items-center justify-center group-hover:bg-violet-200 transition-colors">
                  <Activity size={22} className="text-violet-600" />
                </div>
                <span className="text-sm font-semibold text-slate-700">클리닉</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════ 수업 없는 날 추가 모달 ════════ */}
      {showAddExtra && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h2 className="font-bold text-slate-800">수업 추가</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {new Date(extraDate + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
                </p>
              </div>
              <button onClick={() => setShowAddExtra(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <form onSubmit={addExtraSession} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">시작 시간</label>
                  <input type="time" value={extraForm.start_time}
                    onChange={e => setExtraForm({ ...extraForm, start_time: e.target.value })} required
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">종료 시간</label>
                  <input type="time" value={extraForm.end_time}
                    onChange={e => setExtraForm({ ...extraForm, end_time: e.target.value })} required
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowAddExtra(false)}
                  className="flex-1 py-3 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors">취소</button>
                <button type="submit" disabled={savingExtra}
                  className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50">
                  {savingExtra ? '추가 중...' : '수업 추가'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════════ 클리닉 추가 모달 ════════ */}
      {showAddExtraClinic && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h2 className="font-bold text-slate-800">클리닉 추가</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {new Date(extraClinicDate + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
                </p>
              </div>
              <button onClick={() => setShowAddExtraClinic(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <form onSubmit={addExtraClinicSession} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">클리닉 이름 (선택)</label>
                <input type="text" value={extraClinicForm.name}
                  onChange={e => setExtraClinicForm({ ...extraClinicForm, name: e.target.value })}
                  placeholder="예: 오답 클리닉, 개념 보충" autoFocus
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">시작 시간</label>
                  <input type="time" value={extraClinicForm.start_time}
                    onChange={e => setExtraClinicForm({ ...extraClinicForm, start_time: e.target.value })} required
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">종료 시간</label>
                  <input type="time" value={extraClinicForm.end_time}
                    onChange={e => setExtraClinicForm({ ...extraClinicForm, end_time: e.target.value })} required
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                </div>
              </div>
              {extraClinicError && <p className="text-red-500 text-sm bg-red-50 px-3 py-2 rounded-lg">{extraClinicError}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setShowAddExtraClinic(false); setExtraClinicError('') }}
                  className="flex-1 py-3 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors">취소</button>
                <button type="submit" disabled={savingExtraClinic}
                  className="flex-1 py-3 bg-violet-600 text-white font-semibold rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-50">
                  {savingExtraClinic ? '추가 중...' : '클리닉 추가'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════════ 수업 시간 추가 모달 ════════ */}
      {showScheduleForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="font-bold text-slate-800">수업 시간 추가</h2>
              <button onClick={() => setShowScheduleForm(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <form onSubmit={addSchedule} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">요일</label>
                <div className="flex gap-1.5">
                  {DAYS.map((d, i) => (
                    <button key={i} type="button" onClick={() => setScheduleForm({ ...scheduleForm, day_of_week: i })}
                      className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                        scheduleForm.day_of_week === i ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-600 hover:border-blue-300'
                      }`}>{d}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">시작 시간</label>
                  <input type="time" value={scheduleForm.start_time}
                    onChange={e => setScheduleForm({ ...scheduleForm, start_time: e.target.value })} required
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">종료 시간</label>
                  <input type="time" value={scheduleForm.end_time}
                    onChange={e => setScheduleForm({ ...scheduleForm, end_time: e.target.value })} required
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              {scheduleError && (
                <p className="text-red-500 text-sm bg-red-50 px-3 py-2 rounded-lg">{scheduleError}</p>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setShowScheduleForm(false); setScheduleError('') }}
                  className="flex-1 py-3 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors">취소</button>
                <button type="submit" className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors">추가</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════════ 클리닉 일정 추가 모달 ════════ */}
      {showClinicScheduleForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="font-bold text-slate-800">클리닉 일정 추가</h2>
              <button onClick={() => setShowClinicScheduleForm(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <form onSubmit={addClinicSchedule} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">이름 (선택)</label>
                <input type="text" value={clinicScheduleForm.name}
                  onChange={e => setClinicScheduleForm({ ...clinicScheduleForm, name: e.target.value })}
                  placeholder="예: 오답 클리닉, 개념 보충"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">요일</label>
                <div className="flex gap-1.5">
                  {DAYS.map((d, i) => (
                    <button key={i} type="button" onClick={() => setClinicScheduleForm({ ...clinicScheduleForm, day_of_week: i })}
                      className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                        clinicScheduleForm.day_of_week === i ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-200 text-slate-600 hover:border-violet-300'
                      }`}>{d}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">시작 시간</label>
                  <input type="time" value={clinicScheduleForm.start_time}
                    onChange={e => setClinicScheduleForm({ ...clinicScheduleForm, start_time: e.target.value })} required
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">종료 시간</label>
                  <input type="time" value={clinicScheduleForm.end_time}
                    onChange={e => setClinicScheduleForm({ ...clinicScheduleForm, end_time: e.target.value })} required
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                </div>
              </div>
              {clinicScheduleError && (
                <p className="text-red-500 text-sm bg-red-50 px-3 py-2 rounded-lg">{clinicScheduleError}</p>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setShowClinicScheduleForm(false); setClinicScheduleError('') }}
                  className="flex-1 py-3 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors">취소</button>
                <button type="submit" className="flex-1 py-3 bg-violet-600 text-white font-semibold rounded-xl hover:bg-violet-700 transition-colors">추가</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════════ 과제 추가 모달 ════════ */}
      {showAddHomework && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="font-bold text-slate-800">과제 추가</h2>
              <button onClick={() => setShowAddHomework(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <form onSubmit={addHomework} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">제목 *</label>
                <input type="text" value={homeworkForm.title}
                  onChange={e => setHomeworkForm({ ...homeworkForm, title: e.target.value })}
                  placeholder="과제 제목을 입력해주세요" required autoFocus
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">출제일 *</label>
                  <input type="date" value={homeworkForm.assigned_date}
                    onChange={e => setHomeworkForm({ ...homeworkForm, assigned_date: e.target.value })} required
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">마감일 (선택)</label>
                  <input type="date" value={homeworkForm.due_date}
                    min={homeworkForm.assigned_date || undefined}
                    onChange={e => setHomeworkForm({ ...homeworkForm, due_date: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">설명 (선택)</label>
                <textarea value={homeworkForm.description}
                  onChange={e => setHomeworkForm({ ...homeworkForm, description: e.target.value })}
                  placeholder="과제 내용이나 참고사항을 적어주세요" rows={2}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowAddHomework(false)}
                  className="flex-1 py-3 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors">취소</button>
                <button type="submit" disabled={savingHomework}
                  className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50">
                  {savingHomework ? '추가 중...' : '추가'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════════ 목숨 탭 ════════ */}
      {tab === 'lives' && (
        <div className="space-y-4">

          {/* 빌보드 카드 */}
          {billboardEnabled && billboardLoaded && (
            <BillboardCard billboard={billboard} minLives={billboardMinLives} showLast={billboardShowLast} />
          )}

          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-700">학생 목숨</h2>
              <p className="text-xs text-slate-400 mt-0.5">기본 목숨 {livesDefault}개 · 하트를 조정해 주세요</p>
            </div>
            <button
              onClick={resetAllLives}
              className="text-xs px-3 py-1.5 border border-slate-200 text-slate-500 rounded-xl hover:bg-slate-50 transition-colors"
            >
              전체 초기화
            </button>
          </div>

          {livesLoading ? (
            <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>
          ) : students.length === 0 ? (
            <div className="text-center py-14 text-slate-400">
              <Heart size={32} className="mx-auto mb-2 opacity-20" />
              <p className="text-sm">배정된 학생이 없어요</p>
            </div>
          ) : (
            <div className="space-y-2">
              {students.map(s => {
                const lives    = pendingLivesMap[s.id] ?? studentLives[s.id] ?? livesDefault
                const isSaving = savingLivesId === s.id
                const isNeg    = lives < 0
                const filledCount   = isNeg ? 0 : Math.min(lives, Math.min(livesDefault, 10))
                const emptyCount    = Math.min(livesDefault, 10) - filledCount
                const skullCount    = isNeg ? Math.min(Math.abs(lives), 10) : 0
                const skullOverflow = isNeg && Math.abs(lives) > 10 ? Math.abs(lives) - 10 : 0
                const bonusOverflow = !isNeg && lives > 10 ? lives - 10 : 0
                return (
                  <div key={s.id} className={`rounded-2xl border p-4 flex items-center gap-3 transition-colors ${
                    isNeg ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'
                  }`}>
                    {/* 아바타 */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isNeg ? 'bg-red-200' : 'bg-red-100'
                    }`}>
                      {isNeg
                        ? <Skull size={18} className="text-red-700" />
                        : <span className="text-red-600 font-bold text-sm">{s.name[0]}</span>
                      }
                    </div>

                    {/* 이름 + 하트/해골 */}
                    <div className="flex-1 min-w-0">
                      <p className={`font-semibold text-sm ${isNeg ? 'text-red-800' : 'text-slate-800'}`}>{s.name}</p>
                      <div className="flex items-center gap-0.5 mt-1 flex-wrap">
                        {Array.from({ length: filledCount }).map((_, i) => (
                          <Heart key={`f${i}`} size={13} className="text-red-500 fill-red-500" />
                        ))}
                        {Array.from({ length: emptyCount }).map((_, i) => (
                          <Heart key={`e${i}`} size={13} className={isNeg ? 'text-red-200 fill-red-200' : 'text-slate-200 fill-slate-200'} />
                        ))}
                        {Array.from({ length: skullCount }).map((_, i) => (
                          <Skull key={`s${i}`} size={13} className="text-gray-900 fill-gray-900" />
                        ))}
                        {skullOverflow > 0 && <span className="text-xs font-bold text-gray-900 ml-0.5">+{skullOverflow}</span>}
                        {bonusOverflow > 0 && <span className="text-xs font-bold text-red-500 ml-0.5">+{bonusOverflow}</span>}
                        {lives === 0 && <span className="text-xs text-slate-400 ml-1">목숨 없음</span>}
                      </div>
                    </div>

                    {/* 조정 버튼 */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => adjustLivesDelta(s.id, -1)}
                        disabled={isSaving}
                        className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-red-50 hover:border-red-300 hover:text-red-500 transition-colors disabled:opacity-30 text-lg font-bold leading-none"
                      >−</button>
                      <span className={`text-base font-bold min-w-[28px] text-center ${
                        isNeg ? 'text-red-600' : lives === 0 ? 'text-slate-300' : 'text-slate-800'
                      }`}>
                        {isSaving ? <Loader2 size={14} className="animate-spin inline" /> : lives}
                      </span>
                      <button
                        onClick={() => adjustLivesDelta(s.id, 1)}
                        disabled={isSaving}
                        className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-green-50 hover:border-green-300 hover:text-green-600 transition-colors disabled:opacity-30 font-bold text-lg leading-none"
                      >+</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 초기화 확인 모달 ── */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl space-y-4 p-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={18} className="text-red-600" />
              </div>
              <div>
                <p className="font-bold text-slate-800">정말 초기화할까요?</p>
                <p className="text-xs text-slate-500 mt-0.5">이 작업은 되돌릴 수 없어요</p>
              </div>
            </div>
            <div className="bg-red-50 rounded-xl p-3 text-xs text-red-700 space-y-1">
              <p className="font-semibold mb-1">삭제되는 항목:</p>
              <p>• 출결 기록 (수업 세션 포함)</p>
              <p>• 클리닉 기록</p>
              <p>• 숙제 및 숙제 현황</p>
              <p>• 시험 전체 (문제·제출·결과)</p>
              <p>• 성적 기록</p>
              <p className="font-semibold text-emerald-700 mt-2">✓ 학생 명단·시간표는 유지됩니다</p>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-slate-600">확인을 위해 반 이름 <span className="font-bold text-slate-800">"{className}"</span>을 입력해 주세요</p>
              <input
                value={resetConfirmText}
                onChange={e => setResetConfirmText(e.target.value)}
                placeholder={className}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setShowResetModal(false); setResetConfirmText('') }}
                className="flex-1 py-3 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors text-sm">
                취소
              </button>
              <button
                onClick={resetClass}
                disabled={resetConfirmText !== className || resetting}
                className="flex-1 py-3 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-40 text-sm">
                {resetting ? '초기화 중...' : '초기화'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 빌보드 컴포넌트 ──────────────────────────────────────────────────────────

function LivesIcons({ lives, max = 5 }: { lives: number; max?: number }) {
  if (lives === 0) return <span className="text-xs text-slate-400">0개</span>
  if (lives > 0) {
    const count = Math.min(lives, max)
    const overflow = lives > max ? lives - max : 0
    return (
      <span className="flex items-center gap-0.5 flex-wrap">
        {Array.from({ length: count }).map((_, i) => <Heart key={i} size={13} className="text-red-500 fill-red-500" />)}
        {overflow > 0 && <span className="text-xs font-bold text-red-500 ml-0.5">+{overflow}</span>}
      </span>
    )
  }
  // 음수 → 해골
  const count = Math.min(Math.abs(lives), max)
  const overflow = Math.abs(lives) > max ? Math.abs(lives) - max : 0
  return (
    <span className="flex items-center gap-0.5 flex-wrap">
      {Array.from({ length: count }).map((_, i) => <Skull key={i} size={13} className="text-slate-700 fill-slate-700" />)}
      {overflow > 0 && <span className="text-xs font-bold text-slate-700 ml-0.5">+{overflow}</span>}
    </span>
  )
}

const RANK_MEDAL = ['🥇', '🥈', '🥉', '', '']

function BillboardCard({ billboard, minLives, showLast }: {
  billboard: { rank: number; name: string; lives: number }[]
  minLives: number | null
  showLast: boolean
}) {
  return (
    <div className="bg-white rounded-2xl border border-amber-200 overflow-hidden">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-amber-50 to-yellow-50 px-4 py-3 border-b border-amber-100 flex items-center gap-2">
        <span className="text-lg">🏅</span>
        <p className="font-bold text-amber-800 text-sm">목숨 빌보드</p>
        <p className="text-xs text-amber-500 ml-auto">1~5위</p>
      </div>

      {/* 순위 목록 */}
      {billboard.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-slate-400">학생 데이터가 없어요</div>
      ) : (
        <div className="divide-y divide-slate-50">
          {billboard.map(entry => (
            <div key={entry.rank} className={`flex items-center gap-3 px-4 py-3 ${entry.rank === 1 ? 'bg-amber-50/50' : ''}`}>
              <span className="text-base w-6 text-center flex-shrink-0">{RANK_MEDAL[entry.rank - 1] || entry.rank}</span>
              <span className={`flex-1 text-sm font-semibold ${entry.rank === 1 ? 'text-amber-700' : 'text-slate-700'}`}>{entry.name}</span>
              <LivesIcons lives={entry.lives} />
            </div>
          ))}
        </div>
      )}

      {/* 꼴찌 섹션 */}
      {showLast && minLives !== null && (
        <div className="border-t border-dashed border-slate-200 px-4 py-3 bg-slate-50/50">
          <p className="text-xs text-slate-500">
            가장 목숨이 적은 학생은&nbsp;
            <span className="font-semibold text-slate-700 inline-flex items-center gap-1">
              <LivesIcons lives={minLives} max={10} />
              &nbsp;{minLives}개
            </span>
            &nbsp;예요.
          </p>
        </div>
      )}
    </div>
  )
}
