'use client'

import { useEffect, useState, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, BookOpen, Activity, LogOut, RotateCcw, ArrowRightLeft, X, Heart, ChevronDown, ChevronUp, Check, Loader2, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatPhone } from '@/lib/auth'
import { useAcademy } from '@/lib/academy-context'
import { useDialog } from '@/components/AppDialog'
import { PageLoading, ListSkeleton } from '@/components/Skeleton'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

type Student = {
  id: string; name: string; school_name: string | null
  grade: string; phone: string; parent_phone: string | null
  parent_relation: string | null; memo: string | null; enrolled_at: string
  status: 'active' | 'inactive'; withdrawn_at: string | null
}
type AllClass = { id: string; name: string }
type ClassInfo = { id: string; name: string }
type AttendanceRow = {
  date: string
  status: 'present' | 'absent' | 'late' | 'early_leave' | null
  note: string | null
}
type GradePoint = { name: string; 내점수: number | null; 반평균: number | null }
type GradeRecord = {
  name: string; date: string; maxScore: number | null
  myScore: number | null; myPct: number | null
  avgScore: number | null; avgPct: number | null
  absent: boolean
  category?: string | null
}
type HomeworkRow = {
  id: string; title: string; assigned_date: string; due_date: string | null
  status: 'done' | 'partial' | 'none' | null
}
type ClinicRow = {
  id: string; date: string; clinic_name: string | null
  status: 'done' | 'not_done' | null
}

const ATT_STYLE = {
  present:     { bg: 'bg-green-100',  text: 'text-green-700',  label: '출석' },
  late:        { bg: 'bg-amber-100',  text: 'text-amber-700',  label: '지각' },
  early_leave: { bg: 'bg-purple-100', text: 'text-purple-700', label: '조퇴' },
  absent:      { bg: 'bg-red-100',    text: 'text-red-600',    label: '결석' },
} as const

const DAYS = ['일', '월', '화', '수', '목', '금', '토']

function StudentReportContent() {
  const { showConfirm, dialog } = useDialog()
  const params       = useParams()
  const router       = useRouter()
  const searchParams = useSearchParams()
  const studentId    = params.id as string
  const from         = searchParams.get('from')
  const ctx          = useAcademy()

  const [student, setStudent]           = useState<Student | null>(null)
  const [classes, setClasses]           = useState<ClassInfo[]>([])
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null)
  const [loading, setLoading]           = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [attendance, setAttendance]     = useState<AttendanceRow[]>([])
  const [grades, setGrades]             = useState<GradePoint[]>([])
  const [gradeRecords, setGradeRecords] = useState<GradeRecord[]>([])
  const [gradeCategoryFilter, setGradeCategoryFilter] = useState<string | null>(null)
  const [homeworks, setHomeworks]       = useState<HomeworkRow[]>([])
  const [clinicData, setClinicData]     = useState<ClinicRow[]>([])
  const [showAllHomework, setShowAllHomework] = useState(false)
  const [showAllClinic, setShowAllClinic]     = useState(false)
  const [showAllGrades, setShowAllGrades]     = useState(false)
  const [allClasses, setAllClasses]           = useState<AllClass[]>([])
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [transferClassIds, setTransferClassIds]   = useState<string[]>([])
  const [transferring, setTransferring]           = useState(false)
  const [actionLoading, setActionLoading]         = useState(false)

  // 정보 수정
  const [isEditing, setIsEditing]   = useState(false)
  const [editForm, setEditForm]     = useState({ name: '', phone: '', school_name: '', grade: '', parent_phone: '', parent_relation: '', enrolled_at: '', memo: '' })
  const [savingInfo, setSavingInfo] = useState(false)

  // 목숨
  const [livesEnabled, setLivesEnabled]   = useState(false)
  const [livesDefault, setLivesDefault]   = useState(3)
  const [currentLives, setCurrentLives]   = useState(0)
  const [showLivesLog, setShowLivesLog]   = useState(false)
  const [livesLog, setLivesLog]           = useState<{ id: string; delta: number; reason: string; source: string; lives_after: number; created_at: string; triggered_at: string }[]>([])
  const [livesLogLoading, setLivesLogLoading] = useState(false)
  // 수동 조정 (디바운스)
  const [pendingLives, setPendingLives]   = useState<number | null>(null)
  const [livesSaveTimer, setLivesSaveTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [livesReason, setLivesReason]     = useState('')
  const [savingLives, setSavingLives]     = useState(false)
  const [livesSaved, setLivesSaved]       = useState(false)

  useEffect(() => { if (ctx) loadStudent(ctx.academyId) }, [studentId, ctx])
  useEffect(() => { if (selectedClassId) loadClassDetail(selectedClassId) }, [selectedClassId])

  async function loadStudent(academyId: string) {
    setLoading(true)

    // 학생 정보 + 소속 반 + 전체 반 목록을 동시에 조회
    const [{ data }, { data: csData }, { data: ac }] = await Promise.all([
      supabase.from('students')
        .select('id, name, school_name, grade, phone, parent_phone, parent_relation, memo, enrolled_at, status, withdrawn_at')
        .eq('id', studentId).single(),
      supabase.from('class_students').select('classes(id, name)').eq('student_id', studentId),
      supabase.from('classes').select('id, name').eq('academy_id', academyId).order('name'),
    ])

    if (!data) { router.push('/dashboard/students'); return }
    setStudent(data as Student)

    const classList: ClassInfo[] = ((csData ?? []) as any[]).map(cs => cs.classes).filter(Boolean)
    setClasses(classList)
    setAllClasses(ac ?? [])
    if (classList.length > 0) setSelectedClassId(classList[0].id)

    // 목숨 로드
    const token = await getToken()
    if (token) loadLivesData(academyId, studentId, token)

    setLoading(false)
  }

  async function loadLivesData(academyId: string, sid: string, token: string) {
    const { data: academy } = await supabase.from('academies').select('lives_enabled, lives_default').eq('id', academyId).single()
    if (!academy?.lives_enabled) return
    setLivesEnabled(true)
    setLivesDefault(academy.lives_default ?? 3)
    const { data: rec } = await supabase.from('student_lives').select('lives').eq('academy_id', academyId).eq('student_id', sid).maybeSingle()
    setCurrentLives(rec?.lives ?? (academy.lives_default ?? 3))
    setPendingLives(rec?.lives ?? (academy.lives_default ?? 3))
  }

  async function loadLivesLog() {
    if (!ctx) return
    setLivesLogLoading(true)
    const token = await getToken()
    if (!token) { setLivesLogLoading(false); return }
    const res = await fetch(`/api/lives?action=lives-log&studentId=${studentId}&academyId=${ctx.academyId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) setLivesLog((await res.json()).logs ?? [])
    setLivesLogLoading(false)
  }

  function adjustLives(delta: number) {
    if (pendingLives === null) return
    const next = pendingLives + delta
    setPendingLives(next)
    if (livesSaveTimer) clearTimeout(livesSaveTimer)
    const t = setTimeout(() => saveLivesAdjust(next), 1500)
    setLivesSaveTimer(t)
  }

  async function saveLivesAdjust(nextLives: number) {
    if (!ctx) return
    const netDelta = nextLives - currentLives
    if (netDelta === 0) return
    setSavingLives(true)
    const token = await getToken()
    if (!token) { setSavingLives(false); return }
    const res = await fetch('/api/lives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'manual-adjust', academyId: ctx.academyId, studentId, delta: netDelta, reason: livesReason }),
    })
    if (res.ok) {
      const json = await res.json()
      setCurrentLives(json.lives)
      setLivesSaved(true)
      setLivesReason('')
      if (showLivesLog) loadLivesLog()
      setTimeout(() => setLivesSaved(false), 2000)
    }
    setSavingLives(false)
  }

  // ── 정보 수정 ──
  function openEdit() {
    if (!student) return
    setEditForm({
      name:           student.name,
      phone:          student.phone ?? '',
      school_name:    student.school_name ?? '',
      grade:          student.grade ?? '',
      parent_phone:   student.parent_phone ?? '',
      parent_relation: student.parent_relation ?? '',
      enrolled_at:    student.enrolled_at?.slice(0, 10) ?? '',
      memo:           student.memo ?? '',
    })
    setIsEditing(true)
  }

  async function saveStudentInfo() {
    if (!student) return
    const phone        = editForm.phone.replace(/\D/g, '')
    const parent_phone = editForm.parent_phone.replace(/\D/g, '') || null
    if (!editForm.name.trim()) return
    setSavingInfo(true)
    await supabase.from('students').update({
      name:            editForm.name.trim(),
      phone,
      school_name:     editForm.school_name.trim() || null,
      grade:           editForm.grade.trim(),
      parent_phone,
      parent_relation: editForm.parent_relation.trim() || null,
      enrolled_at:     editForm.enrolled_at || student.enrolled_at,
      memo:            editForm.memo.trim() || null,
    }).eq('id', studentId)
    setStudent(prev => prev ? {
      ...prev,
      name:            editForm.name.trim(),
      phone,
      school_name:     editForm.school_name.trim() || null,
      grade:           editForm.grade.trim(),
      parent_phone,
      parent_relation: editForm.parent_relation.trim() || null,
      enrolled_at:     editForm.enrolled_at || prev.enrolled_at,
      memo:            editForm.memo.trim() || null,
    } : null)
    setSavingInfo(false)
    setIsEditing(false)
  }

  // ── 퇴원 처리 ──
  async function withdrawStudent() {
    if (!student) return
    if (!await showConfirm(`${student.name} 학생을 퇴원 처리할까요?\n\n반 배정이 해제되고 학생·학부모 계정이 모두 삭제돼요.\n성적·과제·출결 등 모든 기록은 그대로 보존돼요.`, { destructive: true, confirmText: '퇴원' })) return
    setActionLoading(true)

    // 1. 반 배정 해제 + 퇴원 상태 변경
    await Promise.all([
      supabase.from('students').update({ status: 'inactive', withdrawn_at: new Date().toISOString() }).eq('id', studentId),
      supabase.from('class_students').delete().eq('student_id', studentId),
    ])

    // 2. 학생·학부모 Auth 계정 삭제
    const token = await getToken()
    if (token) {
      const res = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ student_id: studentId, target: 'both' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.warn('계정 삭제 오류:', err.error)
      }
    }

    await loadStudent(ctx!.academyId)
    router.refresh()  // 반 페이지 캐시 무효화 (퇴원 후 출석부에서 즉시 제거)
    setActionLoading(false)
  }

  // ── 완전 삭제 ──
  async function hardDeleteStudent() {
    if (!student) return
    if (!await showConfirm(
      `${student.name} 학생을 완전 삭제할까요?\n\n출결·성적·과제 등 모든 데이터가 영구 삭제돼요.\n되돌릴 수 없어요.`,
      { destructive: true, confirmText: '완전 삭제' }
    )) return
    setActionLoading(true)

    // 1. 앱 계정 삭제 (학생 + 학부모)
    const token = await getToken()
    if (token) {
      await fetch('/api/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ student_ids: [studentId], target: 'both' }),
      })
    }

    // 2. exam_student_answers는 submission_id 기준이므로 먼저 조회
    const { data: subs } = await supabase.from('exam_submissions').select('id').eq('student_id', studentId)
    const subIds = (subs ?? []).map((s: any) => s.id)
    if (subIds.length > 0) {
      await supabase.from('exam_student_answers').delete().in('submission_id', subIds)
    }

    // 3. 관련 데이터 전체 삭제
    await Promise.all([
      supabase.from('attendance').delete().eq('student_id', studentId),
      supabase.from('grades').delete().eq('student_id', studentId),
      supabase.from('homework_status').delete().eq('student_id', studentId),
      supabase.from('clinic_attendance').delete().eq('student_id', studentId),
      supabase.from('test_scores').delete().eq('student_id', studentId),
      supabase.from('exam_submissions').delete().eq('student_id', studentId),
      supabase.from('student_lives').delete().eq('student_id', studentId),
      supabase.from('student_lives_log').delete().eq('student_id', studentId),
      supabase.from('class_students').delete().eq('student_id', studentId),
      supabase.from('parent_students').delete().eq('student_id', studentId),
      supabase.from('comments').delete().eq('student_id', studentId),
    ])

    // 4. 학생 row 삭제
    await supabase.from('students').delete().eq('id', studentId)

    setActionLoading(false)
    router.push('/dashboard/students')
  }

  // ── 재원 복귀 ──
  async function restoreStudent() {
    if (!student) return
    if (!await showConfirm(`${student.name} 학생을 재원으로 복귀할까요?\n반 배정은 학생 관리에서 다시 설정해주세요.`, { confirmText: '복귀' })) return
    setActionLoading(true)
    await supabase.from('students').update({ status: 'active', withdrawn_at: null }).eq('id', studentId)
    await loadStudent(ctx!.academyId)
    setActionLoading(false)
  }

  // ── 전반 처리 ──
  function openTransferModal() {
    setTransferClassIds(classes.map(c => c.id))
    setShowTransferModal(true)
  }

  async function handleTransfer() {
    setTransferring(true)
    await supabase.from('class_students').delete().eq('student_id', studentId)
    if (transferClassIds.length > 0) {
      await supabase.from('class_students').insert(transferClassIds.map(cid => ({ class_id: cid, student_id: studentId })))
    }
    setShowTransferModal(false)
    await loadStudent(ctx!.academyId)
    setTransferring(false)
  }

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }

  async function loadClassDetail(classId: string) {
    setLoadingDetail(true)
    setShowAllHomework(false)
    setShowAllClinic(false)

    const token = await getToken()

    // 등록일 이후 세션만 표시 (등록 전 수업은 "기록 없음"으로 표시되지 않도록)
    const enrolledAt = student?.enrolled_at?.slice(0, 10) ?? '2000-01-01'

    // ── 1단계: 출결·과제·클리닉 메타 + 성적 그래프 전부 동시에 조회
    const [
      { data: sessions },
      { data: hwData },
      { data: clinicSessions },
      { data: clinicScheds },
      gradesJson,
    ] = await Promise.all([
      supabase.from('sessions').select('id, date').eq('class_id', classId).gte('date', enrolledAt).order('date', { ascending: false }),
      supabase.from('homework').select('id, title, assigned_date, due_date').eq('class_id', classId).gte('assigned_date', enrolledAt).order('assigned_date'),
      supabase.from('clinic_sessions').select('id, date, name').eq('class_id', classId).gte('date', enrolledAt).order('date', { ascending: false }),
      supabase.from('clinic_schedules').select('day_of_week, name').eq('class_id', classId),
      // test_scores RLS 우회 — 서비스 롤 API로 직접 호출
      token
        ? fetch(`/api/grades?action=student-chart&classId=${classId}&studentId=${studentId}`, {
            headers: { Authorization: `Bearer ${token}` },
          }).then(r => r.json())
        : Promise.resolve({ points: [], records: [] }),
    ])

    // 성적 그래프 + 점수 목록 세팅
    setGrades(gradesJson.points ?? [])
    setGradeRecords((gradesJson.records ?? []).slice().reverse()) // 최신순

    const sessionIds = (sessions       ?? []).map(s => s.id)
    const hwIds      = (hwData         ?? []).map(h => h.id)
    const csIds      = (clinicSessions ?? []).map(s => s.id)

    // ── 2단계: 출결·과제·클리닉 상세 동시에 조회
    const [attData, hwStatuses, clinicAtts] = await Promise.all([
      sessionIds.length > 0
        ? supabase.from('attendance').select('session_id, status, note').eq('student_id', studentId).in('session_id', sessionIds).then(r => r.data ?? [])
        : Promise.resolve([] as any[]),
      hwIds.length > 0
        ? supabase.from('homework_status').select('homework_id, status').eq('student_id', studentId).in('homework_id', hwIds).then(r => r.data ?? [])
        : Promise.resolve([] as any[]),
      csIds.length > 0
        ? supabase.from('clinic_attendance').select('clinic_session_id, status').eq('student_id', studentId).in('clinic_session_id', csIds).then(r => r.data ?? [])
        : Promise.resolve([] as any[]),
    ])

    // ── 출석 조합
    const attMap: Record<string, any> = {}
    for (const a of attData) attMap[a.session_id] = a
    setAttendance((sessions ?? []).map(s => ({
      date: s.date,
      status: attMap[s.id]?.status ?? null,
      note:   attMap[s.id]?.note   ?? null,
    })))

    // ── 과제 조합
    const hwStatusMap: Record<string, string> = {}
    for (const s of hwStatuses) hwStatusMap[s.homework_id] = s.status
    setHomeworks((hwData ?? []).map(h => ({ ...h, status: (hwStatusMap[h.id] as any) ?? null })))

    // ── 클리닉 조합
    const clinicAttMap: Record<string, string> = {}
    for (const a of clinicAtts) clinicAttMap[a.clinic_session_id] = a.status
    const schedNameMap: Record<number, string | null> = {}
    for (const sc of (clinicScheds ?? [])) schedNameMap[sc.day_of_week] = sc.name
    setClinicData((clinicSessions ?? []).map(s => {
      const dow = new Date(s.date + 'T00:00:00').getDay()
      return { id: s.id, date: s.date, clinic_name: s.name || schedNameMap[dow] || `${DAYS[dow]}요일 클리닉`, status: (clinicAttMap[s.id] as any) ?? null }
    }))

    setLoadingDetail(false)
  }

  // ── 통계 계산
  const presentCount    = attendance.filter(a => a.status === 'present').length
  const lateCount       = attendance.filter(a => a.status === 'late').length
  const earlyLeaveCount = attendance.filter(a => a.status === 'early_leave').length
  const absentCount     = attendance.filter(a => a.status === 'absent').length
  const totalSessions   = attendance.length
  const attRate = totalSessions > 0 ? Math.round((presentCount / totalSessions) * 100) : null

  const hwDone    = homeworks.filter(h => h.status === 'done').length
  const hwPartial = homeworks.filter(h => h.status === 'partial').length
  const hwNone    = homeworks.filter(h => h.status === 'none').length
  const hwTotal   = homeworks.length
  const hwRate    = hwTotal > 0 ? Math.round(((hwDone + hwPartial) / hwTotal) * 100) : null

  const clinicDone  = clinicData.filter(c => c.status === 'done').length
  const clinicTotal = clinicData.length
  const clinicRate  = clinicTotal > 0 ? Math.round((clinicDone / clinicTotal) * 100) : null

  // 동일 이름 시험 탐지 (목록에서 구분 표시용)
  const _allGradeNames = gradeRecords.map(r => r.name)
  const duplicateGradeNames = new Set(_allGradeNames.filter((n, i) => _allGradeNames.indexOf(n) !== i))

  if (loading) return <PageLoading />
  if (!student) return null

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {dialog}
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push(from ? decodeURIComponent(from) : '/dashboard/students')}
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-slate-800">학생 상세정보</h1>
      </div>

      {/* 기본 정보 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        {isEditing ? (
          /* ── 편집 모드 ── */
          <div className="space-y-3">
            <h3 className="font-bold text-slate-800 text-sm">학생 정보 수정</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-slate-400 mb-1 block">이름</label>
                <input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">학생 전화번호</label>
                <input value={editForm.phone} onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))}
                  placeholder="01012345678" inputMode="numeric"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">학년</label>
                <input value={editForm.grade} onChange={e => setEditForm(p => ({ ...p, grade: e.target.value }))}
                  placeholder="예: 2" inputMode="numeric"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400 mb-1 block">학교</label>
                <input value={editForm.school_name} onChange={e => setEditForm(p => ({ ...p, school_name: e.target.value }))}
                  placeholder="○○고등학교"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">학부모 전화번호</label>
                <input value={editForm.parent_phone} onChange={e => setEditForm(p => ({ ...p, parent_phone: e.target.value }))}
                  placeholder="01012345678" inputMode="numeric"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">관계</label>
                <input value={editForm.parent_relation} onChange={e => setEditForm(p => ({ ...p, parent_relation: e.target.value }))}
                  placeholder="예: 어머니"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400 mb-1 block">등록일</label>
                <input type="date" value={editForm.enrolled_at} onChange={e => setEditForm(p => ({ ...p, enrolled_at: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400 mb-1 block">메모</label>
                <textarea value={editForm.memo} onChange={e => setEditForm(p => ({ ...p, memo: e.target.value }))}
                  rows={2} placeholder="메모 (선택)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setIsEditing(false)}
                className="flex-1 py-2 rounded-xl text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                취소
              </button>
              <button onClick={saveStudentInfo} disabled={savingInfo || !editForm.name.trim()}
                className="flex-1 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {savingInfo ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        ) : (
          /* ── 보기 모드 ── */
          <>
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <span className="text-blue-600 font-bold text-xl">{student.name[0]}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold text-slate-800">{student.name}</h2>
                  {student.status === 'inactive' && (
                    <span className="text-xs px-2 py-0.5 bg-slate-200 text-slate-500 rounded-full font-medium">퇴원</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {student.school_name && (
                    <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">{student.school_name}</span>
                  )}
                  <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">{student.grade}학년</span>
                  {classes.map(c => (
                    <span key={c.id} className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full">{c.name}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-400 mb-0.5">학생 전화번호</p>
                <p className="text-slate-700 font-medium">{formatPhone(student.phone)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">학부모 전화번호</p>
                <p className="text-slate-700 font-medium">
                  {student.parent_phone ? formatPhone(student.parent_phone) : '-'}
                  {student.parent_relation && (
                    <span className="text-slate-400 font-normal ml-1">({student.parent_relation})</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">등록일</p>
                <p className="text-slate-700 font-medium">{student.enrolled_at?.slice(0, 10) ?? '-'}</p>
              </div>
              {student.memo && (
                <div className="col-span-2">
                  <p className="text-xs text-slate-400 mb-0.5">메모</p>
                  <p className="text-slate-700 font-medium">{student.memo}</p>
                </div>
              )}
              {student.withdrawn_at && (
                <div className="col-span-2">
                  <p className="text-xs text-slate-400 mb-0.5">퇴원일</p>
                  <p className="text-slate-500 font-medium">{student.withdrawn_at.slice(0, 10)}</p>
                </div>
              )}
            </div>

            {/* 액션 버튼 */}
            <div className="flex gap-2 mt-4 pt-4 border-t border-slate-100 flex-wrap">
              <button onClick={openEdit}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                ✏️ 정보 수정
              </button>
              {student.status === 'active' ? (
                <>
                  <button
                    onClick={openTransferModal}
                    disabled={actionLoading}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <ArrowRightLeft size={14} /> 소속반 변경
                  </button>
                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      onClick={withdrawStudent}
                      disabled={actionLoading}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <LogOut size={14} /> 퇴원 처리
                    </button>
                    <button
                      onClick={hardDeleteStudent}
                      disabled={actionLoading}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-red-300 bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                    >
                      <Trash2 size={14} /> 완전 삭제
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    onClick={restoreStudent}
                    disabled={actionLoading}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-emerald-200 text-emerald-600 hover:bg-emerald-50 transition-colors"
                  >
                    <RotateCcw size={14} /> 재원 복귀
                  </button>
                  <button
                    onClick={hardDeleteStudent}
                    disabled={actionLoading}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-red-300 bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                  >
                    <Trash2 size={14} /> 완전 삭제
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* 목숨 카드 */}
      {livesEnabled && pendingLives !== null && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Heart size={16} className="text-red-500 fill-red-500" />
              <h3 className="font-bold text-slate-800">목숨</h3>
            </div>
            <div className="flex items-center gap-2">
              {savingLives && <Loader2 size={14} className="animate-spin text-slate-400" />}
              {livesSaved && <Check size={14} className="text-emerald-500" />}
              <span className={`text-2xl font-bold ${pendingLives < 0 ? 'text-red-600' : pendingLives === 0 ? 'text-slate-400' : 'text-red-500'}`}>
                {pendingLives}
              </span>
              <span className="text-sm text-slate-400">/ {livesDefault}</span>
            </div>
          </div>

          {/* +/- 조정 */}
          <div className="flex items-center gap-2">
            <button onClick={() => adjustLives(-1)}
              className="w-9 h-9 rounded-xl bg-red-50 border border-red-100 text-red-500 font-bold text-lg flex items-center justify-center hover:bg-red-100 transition-colors">−</button>
            <button onClick={() => adjustLives(1)}
              className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 font-bold text-lg flex items-center justify-center hover:bg-emerald-100 transition-colors">+</button>
            <input
              type="text"
              value={livesReason}
              onChange={e => setLivesReason(e.target.value)}
              placeholder="사유 입력 (선택)"
              className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
            />
          </div>

          {/* 내역 토글 */}
          <button
            onClick={() => { if (!showLivesLog) loadLivesLog(); setShowLivesLog(v => !v) }}
            className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700"
          >
            {showLivesLog ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            목숨 내역 보기
          </button>

          {showLivesLog && (
            <div className="border border-slate-100 rounded-xl overflow-hidden">
              {livesLogLoading ? (
                <div className="p-4 text-center text-xs text-slate-400">불러오는 중...</div>
              ) : livesLog.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400">변동 내역이 없어요</div>
              ) : (
                <div className="divide-y divide-slate-50 max-h-60 overflow-y-auto">
                  {livesLog.map(log => (
                    <div key={log.id} className="flex items-center gap-3 px-3 py-2">
                      <span className={`text-sm font-bold flex-shrink-0 w-10 text-right ${log.delta > 0 ? 'text-emerald-600' : log.delta < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                        {log.delta > 0 ? `+${log.delta}` : log.delta === 0 ? '기준' : log.delta}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-700 truncate">{log.reason}</p>
                        <p className="text-xs text-slate-400">{new Date(log.triggered_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      <span className="text-xs text-slate-400 flex-shrink-0">→ {log.lives_after}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 반 없으면 안내 */}
      {classes.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <p>아직 배정된 반이 없어요</p>
          <p className="text-sm mt-1">수업 관리에서 반에 학생을 배정해주세요</p>
        </div>
      ) : (
        <>
          {/* 반 선택 탭 */}
          {classes.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {classes.map(c => (
                <button key={c.id} onClick={() => setSelectedClassId(c.id)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                    selectedClassId === c.id
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                  }`}>
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {loadingDetail ? (
            <ListSkeleton cards={3} rows={3} />
          ) : (
            <div key={selectedClassId ?? 'none'} className="animate-fade-in-up space-y-5">
              {/* ── 출결 현황 ── */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="font-bold text-slate-800">출결 현황</h3>
                  {attRate !== null && (
                    <div className="text-right">
                      <span className="text-2xl font-bold text-blue-600">{attRate}%</span>
                      <p className="text-xs text-slate-400">출석률 ({totalSessions}회 기준)</p>
                    </div>
                  )}
                </div>
                {totalSessions === 0 ? (
                  <p className="text-center py-8 text-slate-400 text-sm">수업 기록이 없어요</p>
                ) : (
                  <>
                    <div className="grid grid-cols-4 divide-x divide-slate-100 border-b border-slate-100">
                      {[
                        { label: '출석', val: presentCount,    color: 'text-green-600' },
                        { label: '지각', val: lateCount,       color: 'text-amber-500' },
                        { label: '조퇴', val: earlyLeaveCount, color: 'text-purple-500' },
                        { label: '결석', val: absentCount,     color: 'text-red-500' },
                      ].map(({ label, val, color }) => (
                        <div key={label} className="py-3 text-center">
                          <p className={`text-xl font-bold ${color}`}>{val}</p>
                          <p className="text-xs text-slate-400">{label}</p>
                        </div>
                      ))}
                    </div>
                    <div className="divide-y divide-slate-50 max-h-60 overflow-y-auto">
                      {attendance.map(a => {
                        const style = a.status ? ATT_STYLE[a.status] : null
                        return (
                          <div key={a.date} className="flex items-center gap-3 px-4 py-2.5">
                            <p className="text-sm text-slate-500 w-28 flex-shrink-0">
                              {new Date(a.date + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
                            </p>
                            {style ? (
                              <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${style.bg} ${style.text}`}>
                                {style.label}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-300">기록 없음</span>
                            )}
                            {a.note && <span className="text-xs text-slate-400 truncate">{a.note}</span>}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* ── 시험 성적 그래프 ── */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100">
                  <h3 className="font-bold text-slate-800">시험 성적 추이</h3>
                  <p className="text-xs text-slate-400 mt-0.5">모든 점수는 백분율(%)로 환산돼요</p>
                </div>
                {grades.length === 0 ? (
                  <p className="text-center py-8 text-slate-400 text-sm">시험 기록이 없어요</p>
                ) : (
                  <div className="p-4">
                    <div className="overflow-x-auto">
                      <div style={{ width: Math.max(320, grades.length * 64) }}>
                        <LineChart width={Math.max(320, grades.length * 64)} height={200} data={grades} margin={{ top: 5, right: 8, left: -20, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }}
                            tickFormatter={(v: string) => v.length > 10 ? v.slice(0, 9) + '…' : v} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => `${v}%`} />
                          <Tooltip
                            formatter={(value, name) => [`${value}%`, name]}
                            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                          />
                          <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                          <Line type="monotone" dataKey="내점수" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} connectNulls />
                          <Line type="monotone" dataKey="반평균" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
                        </LineChart>
                      </div>
                    </div>
                    {grades.length > 6 && (
                      <p className="text-xs text-slate-400 text-center mt-2">← 스크롤해서 전체 보기</p>
                    )}
                  </div>
                )}
              </div>

              {/* ── 시험 점수 목록 ── */}
              {gradeRecords.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="p-4 border-b border-slate-100">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <h3 className="font-bold text-slate-800">시험 점수 내역</h3>
                        <p className="text-xs text-slate-400 mt-0.5">최신순 · 반평균과 비교</p>
                      </div>
                      {/* 카테고리 필터 */}
                      {(() => {
                        const cats = Array.from(new Set(gradeRecords.map(r => r.category).filter(Boolean) as string[]))
                        if (cats.length === 0) return null
                        return (
                          <div className="flex gap-1.5 flex-wrap">
                            <button onClick={() => setGradeCategoryFilter(null)}
                              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${gradeCategoryFilter === null ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                              전체
                            </button>
                            {cats.map(cat => (
                              <button key={cat} onClick={() => setGradeCategoryFilter(cat === gradeCategoryFilter ? null : cat)}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${gradeCategoryFilter === cat ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                                {cat}
                              </button>
                            ))}
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {(() => {
                      const filtered = gradeRecords.filter(r => !gradeCategoryFilter || r.category === gradeCategoryFilter)
                      const visible  = showAllGrades ? filtered : filtered.slice(0, 5)
                      const hidden   = filtered.length - 5
                      return (
                        <>
                          {visible.map((r, i) => {
                            const myColor = r.myPct === null ? 'text-slate-400'
                              : r.myPct >= 80 ? 'text-emerald-600'
                              : r.myPct >= 60 ? 'text-amber-600'
                              : 'text-red-500'
                            const diff = (r.myPct !== null && r.avgPct !== null) ? r.myPct - r.avgPct : null
                            return (
                              <div key={i} className="flex items-center gap-3 px-4 py-3">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-slate-800 truncate" title={r.name}>
                                    {duplicateGradeNames.has(r.name) ? `${r.name} (${r.date.slice(5).replace('-', '/')})` : r.name}
                                  </p>
                                  <p className="text-xs text-slate-400 mt-0.5">{r.date}</p>
                                </div>
                                {r.absent ? (
                                  <span className="text-xs px-2.5 py-1 bg-slate-100 text-slate-400 rounded-lg font-medium flex-shrink-0">미응시</span>
                                ) : r.myScore === null ? (
                                  <span className="text-xs text-slate-300 flex-shrink-0">미입력</span>
                                ) : (
                                  <div className="flex items-center gap-3 flex-shrink-0">
                                    <div className="text-right hidden sm:block">
                                      <p className="text-xs text-slate-400">반평균</p>
                                      <p className="text-sm font-medium text-slate-500">
                                        {r.avgScore ?? '-'}{r.maxScore !== null && <span className="text-xs text-slate-300">/{r.maxScore}</span>}
                                      </p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-xs text-slate-400">내 점수</p>
                                      <p className={`text-base font-bold ${myColor}`}>
                                        {r.myScore}{r.maxScore !== null && <span className="text-xs font-normal text-slate-300">/{r.maxScore}</span>}
                                      </p>
                                    </div>
                                    {diff !== null && (
                                      <div className={`text-xs font-semibold px-2 py-1 rounded-lg flex-shrink-0 ${
                                        diff > 0 ? 'bg-emerald-50 text-emerald-600' :
                                        diff < 0 ? 'bg-red-50 text-red-500' :
                                        'bg-slate-100 text-slate-400'
                                      }`}>
                                        {diff > 0 ? `+${diff}%` : diff < 0 ? `${diff}%` : '평균'}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                          {filtered.length > 5 && (
                            <button
                              onClick={() => setShowAllGrades(v => !v)}
                              className="w-full py-2.5 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors font-medium">
                              {showAllGrades ? '접기 ▲' : `더보기 (${hidden}개 더) ▼`}
                            </button>
                          )}
                        </>
                      )
                    })()}
                  </div>
                </div>
              )}

              {/* ── 과제 현황 ── */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen size={16} className="text-orange-500" />
                    <h3 className="font-bold text-slate-800">과제 현황</h3>
                  </div>
                  {hwRate !== null && (
                    <div className="text-right">
                      <span className="text-2xl font-bold text-orange-500">{hwRate}%</span>
                      <p className="text-xs text-slate-400">완료율 ({hwTotal}개 기준)</p>
                    </div>
                  )}
                </div>
                {hwTotal === 0 ? (
                  <p className="text-center py-8 text-slate-400 text-sm">과제 기록이 없어요</p>
                ) : (
                  <>
                    <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
                      <div className="py-3 text-center bg-teal-50/60">
                        <p className="text-xl font-bold text-teal-600">{hwPartial}</p>
                        <p className="text-xs text-teal-500 font-medium">오답(완벽) 완료</p>
                      </div>
                      <div className="py-3 text-center">
                        <p className="text-xl font-bold text-green-600">{hwDone}</p>
                        <p className="text-xs text-slate-400">완료</p>
                      </div>
                      <div className="py-3 text-center">
                        <p className="text-xl font-bold text-red-500">{hwNone}</p>
                        <p className="text-xs text-slate-400">미완료</p>
                      </div>
                    </div>
                    <div className="divide-y divide-slate-50">
                      {(showAllHomework ? homeworks : homeworks.slice(0, 5)).map(h => (
                        <div key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-700 font-medium truncate">{h.title}</p>
                            <p className="text-xs text-slate-400">
                              {h.assigned_date}
                              {h.due_date && <span className="ml-1">· 마감 {h.due_date}</span>}
                            </p>
                          </div>
                          {h.status === 'partial' && <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-teal-50 text-teal-600 ring-1 ring-teal-200 flex-shrink-0">오답(완벽) 완료</span>}
                          {h.status === 'done'    && <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-green-100 text-green-700 flex-shrink-0">완료</span>}
                          {h.status === 'none'    && <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-red-100 text-red-600 flex-shrink-0">미완료</span>}
                          {!h.status && <span className="text-xs text-slate-300 flex-shrink-0">기록 없음</span>}
                        </div>
                      ))}
                    </div>
                    {homeworks.length > 5 && (
                      <button
                        onClick={() => setShowAllHomework(v => !v)}
                        className="w-full py-2.5 text-xs font-medium text-blue-500 hover:bg-blue-50 transition-colors border-t border-slate-100"
                      >
                        {showAllHomework ? '접기 ▲' : `더보기 (${homeworks.length - 5}개 더) ▼`}
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* ── 클리닉 현황 ── */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity size={16} className="text-violet-500" />
                    <h3 className="font-bold text-slate-800">클리닉 현황</h3>
                  </div>
                  {clinicRate !== null && (
                    <div className="text-right">
                      <span className="text-2xl font-bold text-violet-600">{clinicRate}%</span>
                      <p className="text-xs text-slate-400">완료율 ({clinicTotal}회 기준)</p>
                    </div>
                  )}
                </div>
                {clinicTotal === 0 ? (
                  <p className="text-center py-8 text-slate-400 text-sm">클리닉 기록이 없어요</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-100">
                      <div className="py-3 text-center">
                        <p className="text-xl font-bold text-green-600">{clinicDone}</p>
                        <p className="text-xs text-slate-400">완료</p>
                      </div>
                      <div className="py-3 text-center">
                        <p className="text-xl font-bold text-red-500">{clinicTotal - clinicDone}</p>
                        <p className="text-xs text-slate-400">미완료</p>
                      </div>
                    </div>
                    <div className="divide-y divide-slate-50">
                      {(showAllClinic ? clinicData : clinicData.slice(0, 5)).map(c => (
                        <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-700 font-medium truncate">{c.clinic_name}</p>
                            <p className="text-xs text-slate-400">
                              {new Date(c.date + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
                            </p>
                          </div>
                          {c.status === 'done'
                            ? <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-green-100 text-green-700 flex-shrink-0">완료</span>
                            : c.status === 'not_done'
                            ? <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-red-100 text-red-600 flex-shrink-0">미완료</span>
                            : <span className="text-xs text-slate-300 flex-shrink-0">기록 없음</span>
                          }
                        </div>
                      ))}
                    </div>
                    {clinicData.length > 5 && (
                      <button
                        onClick={() => setShowAllClinic(v => !v)}
                        className="w-full py-2.5 text-xs font-medium text-violet-500 hover:bg-violet-50 transition-colors border-t border-slate-100"
                      >
                        {showAllClinic ? '접기 ▲' : `더보기 (${clinicData.length - 5}개 더) ▼`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
      {/* ── 전반 모달 ── */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h2 className="font-bold text-slate-800">소속반 변경</h2>
                <p className="text-xs text-slate-400 mt-0.5">여러 반 동시 배정 가능 · 이전 기록은 보존돼요</p>
              </div>
              <button onClick={() => setShowTransferModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">소속 반 선택</p>
              <div className="flex flex-wrap gap-2">
                {allClasses.map(c => {
                  const selected = transferClassIds.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      onClick={() => setTransferClassIds(prev =>
                        selected ? prev.filter(id => id !== c.id) : [...prev, c.id]
                      )}
                      className={`px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${
                        selected
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                      }`}
                    >
                      {c.name}
                    </button>
                  )
                })}
              </div>
              {transferClassIds.length === 0 && (
                <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                  반을 선택하지 않으면 미배정 상태가 돼요
                </p>
              )}
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <button
                onClick={() => setShowTransferModal(false)}
                className="flex-1 py-3 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 text-sm transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleTransfer}
                disabled={transferring}
                className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 text-sm transition-colors disabled:opacity-50"
              >
                {transferring ? '변경 중...' : '변경 완료'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function StudentReportPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <StudentReportContent />
    </Suspense>
  )
}
