'use client'

import { useEffect, useState, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, BookOpen, Activity, LogOut, RotateCcw, ArrowRightLeft, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatPhone } from '@/lib/auth'
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
  const params       = useParams()
  const router       = useRouter()
  const searchParams = useSearchParams()
  const studentId    = params.id as string
  const from         = searchParams.get('from')

  const [student, setStudent]           = useState<Student | null>(null)
  const [classes, setClasses]           = useState<ClassInfo[]>([])
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null)
  const [loading, setLoading]           = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [attendance, setAttendance]     = useState<AttendanceRow[]>([])
  const [grades, setGrades]             = useState<GradePoint[]>([])
  const [homeworks, setHomeworks]       = useState<HomeworkRow[]>([])
  const [clinicData, setClinicData]     = useState<ClinicRow[]>([])
  const [showAllHomework, setShowAllHomework] = useState(false)
  const [showAllClinic, setShowAllClinic]     = useState(false)
  const [allClasses, setAllClasses]           = useState<AllClass[]>([])
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [transferClassIds, setTransferClassIds]   = useState<string[]>([])
  const [transferring, setTransferring]           = useState(false)
  const [actionLoading, setActionLoading]         = useState(false)

  useEffect(() => { loadStudent() }, [studentId])
  useEffect(() => { if (selectedClassId) loadClassDetail(selectedClassId) }, [selectedClassId])

  async function loadStudent() {
    setLoading(true)
    const { data } = await supabase
      .from('students')
      .select('id, name, school_name, grade, phone, parent_phone, parent_relation, memo, enrolled_at, status, withdrawn_at')
      .eq('id', studentId).single()
    if (!data) { router.push('/dashboard/students'); return }
    setStudent(data as Student)

    const [{ data: csData }, { data: membership }] = await Promise.all([
      supabase.from('class_students').select('classes(id, name)').eq('student_id', studentId),
      supabase.from('academy_teachers').select('academy_id').eq('teacher_id', (await supabase.auth.getUser()).data.user?.id ?? '').single(),
    ])
    const classList: ClassInfo[] = ((csData ?? []) as any[]).map(cs => cs.classes).filter(Boolean)
    setClasses(classList)
    if (classList.length > 0) setSelectedClassId(classList[0].id)

    if (membership) {
      const { data: ac } = await supabase.from('classes').select('id, name').eq('academy_id', membership.academy_id).order('name')
      setAllClasses(ac ?? [])
    }
    setLoading(false)
  }

  // ── 퇴원 처리 ──
  async function withdrawStudent() {
    if (!student) return
    if (!confirm(`${student.name} 학생을 퇴원 처리할까요?\n\n반 배정이 해제되고 출석·수업에서 제외돼요.\n성적·숙제·출결 등 모든 기록은 그대로 보존돼요.`)) return
    setActionLoading(true)
    await supabase.from('students').update({ status: 'inactive', withdrawn_at: new Date().toISOString() }).eq('id', studentId)
    await supabase.from('class_students').delete().eq('student_id', studentId)
    await loadStudent()
    setActionLoading(false)
  }

  // ── 재원 복귀 ──
  async function restoreStudent() {
    if (!student) return
    if (!confirm(`${student.name} 학생을 재원으로 복귀할까요?\n반 배정은 학생 관리에서 다시 설정해주세요.`)) return
    setActionLoading(true)
    await supabase.from('students').update({ status: 'active', withdrawn_at: null }).eq('id', studentId)
    await loadStudent()
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
    await loadStudent()
    setTransferring(false)
  }

  async function loadClassDetail(classId: string) {
    setLoadingDetail(true)
    setShowAllHomework(false)
    setShowAllClinic(false)

    // 출석 + 시험 + 숙제 + 클리닉 병렬 로드
    const [
      { data: sessions },
      { data: tests },
      { data: hwData },
      { data: clinicSessions },
      { data: clinicScheds },
    ] = await Promise.all([
      supabase.from('sessions').select('id, date').eq('class_id', classId).order('date', { ascending: false }),
      supabase.from('tests').select('id, name, max_score').eq('class_id', classId).order('date'),
      supabase.from('homework').select('id, title, assigned_date, due_date').eq('class_id', classId).order('assigned_date'),
      supabase.from('clinic_sessions').select('id, date').eq('class_id', classId).order('date', { ascending: false }),
      supabase.from('clinic_schedules').select('day_of_week, name').eq('class_id', classId),
    ])

    // ── 출석
    const sessionIds = (sessions ?? []).map(s => s.id)
    let attMap: Record<string, any> = {}
    if (sessionIds.length > 0) {
      const { data: attData } = await supabase
        .from('attendance').select('session_id, status, note')
        .eq('student_id', studentId).in('session_id', sessionIds)
      for (const a of (attData ?? [])) attMap[a.session_id] = a
    }
    setAttendance((sessions ?? []).map(s => ({
      date: s.date,
      status: attMap[s.id]?.status ?? null,
      note:   attMap[s.id]?.note   ?? null,
    })))

    // ── 시험 성적
    let gradePoints: GradePoint[] = []
    if (tests && tests.length > 0) {
      const testIds = tests.map(t => t.id)
      const [{ data: myScores }, { data: allScores }] = await Promise.all([
        supabase.from('test_scores').select('test_id, score').eq('student_id', studentId).in('test_id', testIds),
        supabase.from('test_scores').select('test_id, score').in('test_id', testIds),
      ])
      const myMap: Record<string, number> = {}
      for (const s of (myScores ?? [])) myMap[s.test_id] = s.score
      const allMap: Record<string, number[]> = {}
      for (const s of (allScores ?? [])) {
        if (!allMap[s.test_id]) allMap[s.test_id] = []
        allMap[s.test_id].push(s.score)
      }
      gradePoints = tests.map(t => {
        const myRaw  = myMap[t.id] ?? null
        const myPct  = myRaw !== null ? Math.round((myRaw / t.max_score) * 100) : null
        const arr    = allMap[t.id] ?? []
        const avgPct = arr.length > 0
          ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length / t.max_score * 100)
          : null
        return { name: t.name, 내점수: myPct, 반평균: avgPct }
      })
    }
    setGrades(gradePoints)

    // ── 숙제 현황
    let hwRows: HomeworkRow[] = []
    if (hwData && hwData.length > 0) {
      const hwIds = hwData.map(h => h.id)
      const { data: hwStatuses } = await supabase
        .from('homework_status').select('homework_id, status')
        .eq('student_id', studentId).in('homework_id', hwIds)
      const statusMap: Record<string, string> = {}
      for (const s of (hwStatuses ?? [])) statusMap[s.homework_id] = s.status
      hwRows = hwData.map(h => ({ ...h, status: (statusMap[h.id] as any) ?? null }))
    }
    setHomeworks(hwRows)

    // ── 클리닉 현황
    let clinicRows: ClinicRow[] = []
    if (clinicSessions && clinicSessions.length > 0) {
      const csIds = clinicSessions.map(s => s.id)
      const { data: clinicAtts } = await supabase
        .from('clinic_attendance').select('clinic_session_id, status')
        .eq('student_id', studentId).in('clinic_session_id', csIds)
      const attMap2: Record<string, string> = {}
      for (const a of (clinicAtts ?? [])) attMap2[a.clinic_session_id] = a.status
      // 클리닉 일정 이름 맵 (요일 → 이름)
      const schedNameMap: Record<number, string | null> = {}
      for (const sc of (clinicScheds ?? [])) schedNameMap[sc.day_of_week] = sc.name
      clinicRows = clinicSessions.map(s => {
        const dow  = new Date(s.date + 'T00:00:00').getDay()
        const name = schedNameMap[dow] ?? `${DAYS[dow]}요일 클리닉`
        return { id: s.id, date: s.date, clinic_name: name, status: (attMap2[s.id] as any) ?? null }
      })
    }
    setClinicData(clinicRows)

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
  const hwRate    = hwTotal > 0 ? Math.round((hwDone / hwTotal) * 100) : null

  const clinicDone  = clinicData.filter(c => c.status === 'done').length
  const clinicTotal = clinicData.length
  const clinicRate  = clinicTotal > 0 ? Math.round((clinicDone / clinicTotal) * 100) : null

  if (loading) return <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>
  if (!student) return null

  return (
    <div className="max-w-2xl mx-auto space-y-5">
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
        <div className="flex items-center gap-4 mb-4">
          <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <span className="text-blue-600 font-bold text-xl">{student.name[0]}</span>
          </div>
          <div>
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
        <div className="flex gap-2 mt-4 pt-4 border-t border-slate-100">
          {student.status === 'active' ? (
            <>
              <button
                onClick={openTransferModal}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <ArrowRightLeft size={14} /> 소속반 변경
              </button>
              <button
                onClick={withdrawStudent}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-red-200 text-red-500 hover:bg-red-50 transition-colors ml-auto"
              >
                <LogOut size={14} /> 퇴원 처리
              </button>
            </>
          ) : (
            <button
              onClick={restoreStudent}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-emerald-200 text-emerald-600 hover:bg-emerald-50 transition-colors"
            >
              <RotateCcw size={14} /> 재원 복귀
            </button>
          )}
        </div>
      </div>

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
            <div className="text-center py-10 text-slate-400 text-sm">불러오는 중...</div>
          ) : (
            <>
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
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={grades} margin={{ top: 5, right: 8, left: -20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => `${v}%`} />
                        <Tooltip
                          formatter={(value, name) => [`${value}%`, name]}
                          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                        />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="내점수" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} connectNulls />
                        <Line type="monotone" dataKey="반평균" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* ── 숙제 현황 ── */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen size={16} className="text-orange-500" />
                    <h3 className="font-bold text-slate-800">숙제 현황</h3>
                  </div>
                  {hwRate !== null && (
                    <div className="text-right">
                      <span className="text-2xl font-bold text-orange-500">{hwRate}%</span>
                      <p className="text-xs text-slate-400">완료율 ({hwTotal}개 기준)</p>
                    </div>
                  )}
                </div>
                {hwTotal === 0 ? (
                  <p className="text-center py-8 text-slate-400 text-sm">숙제 기록이 없어요</p>
                ) : (
                  <>
                    <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
                      <div className="py-3 text-center bg-teal-50/60">
                        <p className="text-xl font-bold text-teal-600">{hwPartial}</p>
                        <p className="text-xs text-teal-500 font-medium">★ 오답 완료</p>
                      </div>
                      <div className="py-3 text-center">
                        <p className="text-xl font-bold text-green-600">{hwDone}</p>
                        <p className="text-xs text-slate-400">완료</p>
                      </div>
                      <div className="py-3 text-center">
                        <p className="text-xl font-bold text-red-500">{hwNone}</p>
                        <p className="text-xs text-slate-400">미제출</p>
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
                          {h.status === 'partial' && <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-teal-50 text-teal-600 ring-1 ring-teal-200 flex-shrink-0">★ 오답 완료</span>}
                          {h.status === 'done'    && <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-green-100 text-green-700 flex-shrink-0">완료</span>}
                          {h.status === 'none'    && <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-red-100 text-red-600 flex-shrink-0">미제출</span>}
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
            </>
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
    <Suspense fallback={<div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>}>
      <StudentReportContent />
    </Suspense>
  )
}
