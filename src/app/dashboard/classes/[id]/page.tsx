'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Plus, X, Trash2, Clock, Users, CalendarDays,
  Search, ChevronLeft, ChevronRight, Check, BarChart2, CheckCheck, FileText,
  BookOpen, Activity,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatPhone } from '@/lib/auth'

type GradePoint = { name: string; 내점수: number | null; 반평균: number | null }

const DAYS = ['일', '월', '화', '수', '목', '금', '토']

type Schedule        = { id: string; day_of_week: number; start_time: string; end_time: string }
type ClinicSchedule  = { id: string; day_of_week: number; start_time: string; end_time: string; name: string | null }
type Student = {
  id: string; name: string; school_name: string | null
  grade: string; phone: string; parent_phone: string | null
  parent_relation: string | null; memo: string | null
}
type Session      = { id: string; date: string; start_time: string; end_time: string; status: string }
type ClinicSession = { id: string; class_id: string; date: string; note: string | null }
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
  id: string | null; student_id: string; status: 'done' | 'partial' | 'none' | null
}

type Tab      = 'schedule' | 'students' | 'calendar'
type PanelTab = 'attendance' | 'homework' | 'clinic'

const ATT_LABEL  = { present: '출석', late: '지각', early_leave: '조퇴', absent: '결석' } as const
const ATT_ACTIVE = {
  present:     'bg-green-500 text-white border-green-500',
  late:        'bg-amber-400 text-white border-amber-400',
  early_leave: 'bg-purple-500 text-white border-purple-500',
  absent:      'bg-red-500 text-white border-red-500',
} as const
const HW_LABEL  = { done: '완료', partial: '오답', none: '미제출' } as const
const HW_ACTIVE = {
  done:    'bg-green-500 text-white border-green-500',
  partial: 'bg-amber-400 text-white border-amber-400',
  none:    'bg-red-500 text-white border-red-500',
} as const

export default function ClassDetailPage() {
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
  const today    = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const [calYear, setCalYear]   = useState(today.getFullYear())
  const [calMonth, setCalMonth] = useState(today.getMonth())

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

  // ── 시험
  const [dateTests, setDateTests] = useState<{ id: string; name: string; max_score: number }[]>([])

  // ── 숙제
  const [dateHomeworks, setDateHomeworks]       = useState<Homework[]>([])
  const [homeworkStatuses, setHomeworkStatuses] = useState<Record<string, HomeworkStatusRecord[]>>({})
  const [expandedHomeworkId, setExpandedHomeworkId] = useState<string | null>(null)
  const [hwDueDateEdits, setHwDueDateEdits]         = useState<Record<string, string>>({})
  const [showAddHomework, setShowAddHomework]   = useState(false)
  const [homeworkForm, setHomeworkForm]         = useState({ title: '', assigned_date: '', due_date: '', description: '' })
  const [savingHomework, setSavingHomework]     = useState(false)

  useEffect(() => { loadData() }, [classId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (showAddHomework) { setShowAddHomework(false); return }
      if (showClinicScheduleForm) { setShowClinicScheduleForm(false); return }
      if (showAddExtra) { setShowAddExtra(false); return }
      if (showAddStudent) { setShowAddStudent(false); setSelectedNewIds(new Set()); setStudentSearch(''); return }
      if (showScheduleForm) { setShowScheduleForm(false); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showScheduleForm, showAddStudent, showAddExtra, showClinicScheduleForm, showAddHomework])

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

  // 숙제 탭 열리거나 숙제 목록 바뀔 때 모든 학생 현황 자동 로드
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
        .select('students(id, name, school_name, grade, phone, parent_phone, parent_relation, memo)')
        .eq('class_id', classId),
    ])
    if (!classData) { router.push('/dashboard/classes'); return }
    setClassName(classData.name)
    setSchedules(scheduleData ?? [])
    setClinicSchedules(clinicScheduleData ?? [])
    setStudents(((csData ?? []) as any[]).map(r => r.students).filter(Boolean))

    const { data: allData } = await supabase
      .from('students')
      .select('id, name, school_name, grade, phone, parent_phone, parent_relation, memo')
      .eq('academy_id', (classData as any).academy_id)
      .order('name')
    setAllStudents(allData ?? [])
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
    if (!confirm('이 시간표를 삭제할까요?\n오늘 이후 예정된 해당 요일 수업도 함께 삭제돼요.')) return
    const schedule = schedules.find(s => s.id === id)
    if (schedule) {
      const td = new Date().toISOString().split('T')[0]
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
      alert('종료 시간은 시작 시간보다 늦어야 해요.')
      return
    }
    const thisSchedule = clinicSchedules.find(s => s.id === id)
    if (thisSchedule) {
      const sameDay = clinicSchedules.filter(s => s.day_of_week === thisSchedule.day_of_week && s.id !== id)
      const overlap = sameDay.some(s => start < s.end_time && end > s.start_time)
      if (overlap) {
        alert('같은 요일에 겹치는 클리닉 일정이 이미 있어요.')
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
    if (!confirm('이 클리닉 일정을 삭제할까요?')) return
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
    if (!confirm(`${name} 학생을 이 반에서 빼시겠어요?`)) return
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

    if (isRegularDay) setPanelTab('attendance')
    else if (isClinicDay) setPanelTab('clinic')
    else setPanelTab('attendance')

    const [{ data: testsOnDate }, { data: hwData }] = await Promise.all([
      supabase.from('tests').select('id, name, max_score').eq('class_id', classId).eq('date', dateStr),
      supabase.from('homework').select('*').eq('class_id', classId).eq('assigned_date', dateStr).order('created_at'),
    ])
    setDateTests(testsOnDate ?? [])
    setDateHomeworks(hwData ?? [])
    setHomeworkStatuses({})

    if (session) {
      const { data: attData } = await supabase
        .from('attendance').select('id, student_id, status, note').eq('session_id', session.id)
      const attMap: Record<string, any> = {}
      for (const a of (attData ?? [])) attMap[a.student_id] = a
      setAttendanceList(students.map(s => ({
        id: attMap[s.id]?.id ?? null, student_id: s.id,
        status: attMap[s.id]?.status ?? null, note: attMap[s.id]?.note ?? null,
      })))
    } else {
      setAttendanceList(students.map(s => ({ id: null, student_id: s.id, status: null, note: null })))
    }

    if (clinicSession) {
      const { data: cAttData } = await supabase
        .from('clinic_attendance').select('id, student_id, status').eq('clinic_session_id', clinicSession.id)
      const cAttMap: Record<string, any> = {}
      for (const a of (cAttData ?? [])) cAttMap[a.student_id] = a
      setClinicAttList(students.map(s => ({
        id: cAttMap[s.id]?.id ?? null, student_id: s.id, status: cAttMap[s.id]?.status ?? null,
      })))
    } else {
      setClinicAttList(students.map(s => ({ id: null, student_id: s.id, status: null })))
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
      } else {
        const noteToSave = status === 'present' ? null : rec.note
        await supabase.from('attendance').update({ status, note: noteToSave }).eq('id', rec.id)
        setAttendanceList(prev => prev.map(a =>
          a.student_id === studentId ? { ...a, status, note: noteToSave } : a))
      }
    } else {
      const { data: na } = await supabase.from('attendance').insert({
        session_id: session!.id, student_id: studentId, status, note: null,
      }).select().single()
      setAttendanceList(prev => prev.map(a =>
        a.student_id === studentId ? { ...a, id: na?.id ?? null, status, note: null } : a))
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
  }

  async function deleteSession() {
    if (!selectedSession) return
    const hasAtt = attendanceList.some(a => a.status !== null)
    if (!confirm(hasAtt ? '이 수업을 삭제할까요?\n출석 기록도 함께 삭제돼요.' : '이 수업을 삭제할까요?')) return
    await supabase.from('attendance').delete().eq('session_id', selectedSession.id)
    await supabase.from('sessions').delete().eq('id', selectedSession.id)
    setSelectedSession(null)
    setAttendanceList(students.map(s => ({ id: null, student_id: s.id, status: null, note: null })))
    await loadMonthSessions()
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
      } else {
        await supabase.from('clinic_attendance').update({ status }).eq('id', rec.id)
        setClinicAttList(prev => prev.map(a =>
          a.student_id === studentId ? { ...a, status } : a))
      }
    } else {
      const { data: na } = await supabase.from('clinic_attendance').insert({
        clinic_session_id: cs!.id, student_id: studentId, status,
      }).select().single()
      setClinicAttList(prev => prev.map(a =>
        a.student_id === studentId ? { ...a, id: na?.id ?? null, status } : a))
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
  }

  async function deleteClinicSession() {
    if (!selectedClinicSession) return
    if (!confirm('이 클리닉 세션을 삭제할까요?\n기록도 함께 삭제돼요.')) return
    await supabase.from('clinic_attendance').delete().eq('clinic_session_id', selectedClinicSession.id)
    await supabase.from('clinic_sessions').delete().eq('id', selectedClinicSession.id)
    setSelectedClinicSession(null)
    setClinicAttList(students.map(s => ({ id: null, student_id: s.id, status: null })))
    await loadMonthSessions()
  }

  // ── 숙제
  async function addHomework(e: React.FormEvent) {
    e.preventDefault(); setSavingHomework(true)
    const assignedDate = homeworkForm.assigned_date
    const { error } = await supabase.from('homework').insert({
      class_id: classId,
      title: homeworkForm.title,
      description: homeworkForm.description || null,
      assigned_date: assignedDate,
      due_date: homeworkForm.due_date || null,
    })
    setSavingHomework(false)
    if (error) { alert('저장 오류: ' + error.message); return }
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
    if (!confirm('이 숙제를 삭제할까요?')) return
    await supabase.from('homework_status').delete().eq('homework_id', hwId)
    await supabase.from('homework').delete().eq('id', hwId)
    setDateHomeworks(prev => prev.filter(h => h.id !== hwId))
    if (expandedHomeworkId === hwId) setExpandedHomeworkId(null)
  }

  async function saveHomeworkDueDate(hwId: string, dueDate: string) {
    const value = dueDate || null
    await supabase.from('homework').update({ due_date: value }).eq('id', hwId)
    setDateHomeworks(prev => prev.map(h => h.id === hwId ? { ...h, due_date: value } : h))
  }

  async function loadHomeworkStatuses(hwId: string) {
    if (homeworkStatuses[hwId]) return
    const { data } = await supabase.from('homework_status').select('id, student_id, status').eq('homework_id', hwId)
    const sm: Record<string, any> = {}
    for (const s of (data ?? [])) sm[s.student_id] = s
    setHomeworkStatuses(prev => ({
      ...prev,
      [hwId]: students.map(s => ({ id: sm[s.id]?.id ?? null, student_id: s.id, status: sm[s.id]?.status ?? null })),
    }))
  }

  async function setHomeworkStatus(hwId: string, studentId: string, status: 'done' | 'partial' | 'none') {
    const list = homeworkStatuses[hwId] ?? []
    const rec  = list.find(r => r.student_id === studentId)
    if (rec?.id) {
      if (rec.status === status) {
        await supabase.from('homework_status').delete().eq('id', rec.id)
        setHomeworkStatuses(prev => ({
          ...prev,
          [hwId]: prev[hwId].map(r => r.student_id === studentId ? { ...r, id: null, status: null } : r),
        }))
      } else {
        await supabase.from('homework_status').update({ status }).eq('id', rec.id)
        setHomeworkStatuses(prev => ({
          ...prev,
          [hwId]: prev[hwId].map(r => r.student_id === studentId ? { ...r, status } : r),
        }))
      }
    } else {
      const { data: nr } = await supabase.from('homework_status').insert({
        homework_id: hwId, student_id: studentId, status,
      }).select().single()
      setHomeworkStatuses(prev => ({
        ...prev,
        [hwId]: (prev[hwId] ?? students.map(s => ({ id: null, student_id: s.id, status: null }))).map(r =>
          r.student_id === studentId ? { ...r, id: nr?.id ?? null, status } : r
        ),
      }))
    }
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

  if (loading) return <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>

  return (
    <div className="max-w-4xl mx-auto space-y-6">

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
      <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl">
        {([
          { key: 'calendar' as Tab, label: '캘린더', Icon: CalendarDays },
          { key: 'students' as Tab, label: '학생',   Icon: Users },
          { key: 'schedule' as Tab, label: '수업·클리닉 일정', Icon: Clock },
        ]).map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              tab === key ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

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
                    setExtraDate(dateStr)
                    setExtraForm({ start_time: '15:00', end_time: '17:00' })
                    setShowAddExtra(true)
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
            const canRecord  = selectedDate <= todayStr
            const dow        = new Date(selectedDate + 'T00:00:00').getDay()
            const isRegDay   = !!selectedSession   || schedules.some(s => s.day_of_week === dow)
            const isClinicDy = !!selectedClinicSession || clinicSchedules.some(s => s.day_of_week === dow)

            const availTabs: PanelTab[] = []
            if (isRegDay)   { availTabs.push('attendance', 'homework') }
            if (isClinicDy) { availTabs.push('clinic') }
            if (availTabs.length === 0) availTabs.push('attendance')

            const PTAB_LABEL: Record<PanelTab, string> = { attendance: '출결', homework: '숙제', clinic: '클리닉' }

            return (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">

                {/* 패널 헤더 */}
                <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800">
                      {new Date(selectedDate + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
                    </p>
                    {selectedSession && (
                      <p className="text-sm text-slate-500 mt-0.5">{selectedSession.start_time.slice(0,5)} ~ {selectedSession.end_time.slice(0,5)}</p>
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

                          {dateTests.length > 0 && (
                            <div className="px-4 py-3 border-b border-slate-100 space-y-1.5">
                              <p className="text-xs font-semibold text-slate-500 mb-2">이날 시험</p>
                              {dateTests.map(t => (
                                <button key={t.id}
                                  onClick={() => router.push(`/dashboard/grades?classId=${classId}&testId=${t.id}&from=${encodeURIComponent(`/dashboard/classes/${classId}?tab=calendar&date=${selectedDate}`)}`)}
                                  className="w-full flex items-center gap-3 p-2.5 bg-emerald-50 rounded-xl hover:bg-emerald-100 transition-colors text-left">
                                  <BarChart2 size={15} className="text-emerald-600 flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-emerald-800 truncate">{t.name}</p>
                                    <p className="text-xs text-emerald-600">만점 {t.max_score}점</p>
                                  </div>
                                  <span className="text-xs text-emerald-600 flex-shrink-0">성적 보기 →</span>
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
                                const needsNote = att.status && att.status !== 'present'
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
                                            {att.note && att.status !== 'present' && <span className="ml-1 text-slate-500">· {att.note}</span>}
                                          </p>
                                        </div>
                                      </button>
                                      <div className="flex gap-1 flex-shrink-0">
                                        {(['present', 'late', 'early_leave', 'absent'] as const).map(s => (
                                          <button key={s} onClick={() => markAttendance(att.student_id, s)}
                                            className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                              att.status === s ? ATT_ACTIVE[s] : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                                            }`}>
                                            {ATT_LABEL[s]}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    {needsNote && (
                                      <div className="px-4 pb-3">
                                        <input type="text" value={att.note ?? ''}
                                          onChange={e => handleNoteChange(att.student_id, e.target.value)}
                                          onBlur={e => saveNote(att.student_id, e.target.value)}
                                          placeholder="사유 입력 (선택)"
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

                    {/* ── 숙제 탭 ── */}
                    {panelTab === 'homework' && (
                      <div className="divide-y divide-slate-50">
                        {/* 추가 버튼 */}
                        <div className="px-4 py-3">
                          <button
                            onClick={() => { setHomeworkForm({ title: '', assigned_date: selectedDate ?? '', due_date: '', description: '' }); setShowAddHomework(true) }}
                            className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-slate-300 rounded-xl text-sm text-slate-500 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-colors">
                            <Plus size={15} /> 숙제 추가
                          </button>
                        </div>

                        {dateHomeworks.length === 0 ? (
                          <div className="py-10 text-center text-slate-400 text-sm">
                            <BookOpen size={28} className="mx-auto mb-2 opacity-30" />
                            이날 출제된 숙제가 없어요
                          </div>
                        ) : dateHomeworks.map(hw => {
                          const statuses  = homeworkStatuses[hw.id] ?? []
                          const doneCount = statuses.filter(r => r.status === 'done').length
                          const partCount = statuses.filter(r => r.status === 'partial').length
                          const noneCount = statuses.filter(r => r.status === 'none').length

                          return (
                            <div key={hw.id} className="border-b border-slate-100 last:border-0">
                              {/* 숙제 헤더 */}
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
                                      <span className="text-xs text-slate-400">완료 {doneCount} · 오답 {partCount} · 미제출 {noneCount}</span>
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
                                  return (
                                    <div key={rec.student_id} className="flex items-center gap-3 px-4 py-2.5">
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-slate-800 truncate">{student.name}</p>
                                        <p className="text-xs text-slate-400">{student.grade}학년{student.school_name ? ` · ${student.school_name}` : ''}</p>
                                      </div>
                                      <div className="flex gap-1 flex-shrink-0">
                                        {(['done', 'partial', 'none'] as const).map(s => (
                                          <button key={s} onClick={() => setHomeworkStatus(hw.id, rec.student_id, s)}
                                            className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                              rec.status === s ? HW_ACTIVE[s] : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                                            }`}>
                                            {HW_LABEL[s]}
                                          </button>
                                        ))}
                                      </div>
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
                          {/* 클리닉 범위 입력 */}
                          {(() => {
                            const dow = new Date(selectedDate + 'T00:00:00').getDay()
                            const cs  = clinicSchedules.find(s => s.day_of_week === dow)
                            const title = cs?.name || `${DAYS[dow]}요일 클리닉`
                            return (
                              <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                                <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                                  <Activity size={13} className="text-violet-600" />
                                </div>
                                <p className="font-semibold text-slate-800 text-sm">{title}</p>
                              </div>
                            )
                          })()}
                          {clinicAttList.length === 0 ? (
                            <p className="text-center py-8 text-slate-400 text-sm">배정된 학생이 없어요</p>
                          ) : (
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

      {/* ════════ 숙제 추가 모달 ════════ */}
      {showAddHomework && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="font-bold text-slate-800">숙제 추가</h2>
              <button onClick={() => setShowAddHomework(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <form onSubmit={addHomework} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">제목 *</label>
                <input type="text" value={homeworkForm.title}
                  onChange={e => setHomeworkForm({ ...homeworkForm, title: e.target.value })}
                  placeholder="숙제 제목을 입력해주세요" required autoFocus
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
                    onChange={e => setHomeworkForm({ ...homeworkForm, due_date: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">설명 (선택)</label>
                <textarea value={homeworkForm.description}
                  onChange={e => setHomeworkForm({ ...homeworkForm, description: e.target.value })}
                  placeholder="숙제 내용이나 참고사항을 적어주세요" rows={2}
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
    </div>
  )
}
