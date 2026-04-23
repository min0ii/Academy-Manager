'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  BookOpen, ChevronRight, ChevronLeft, CheckCircle2,
  Circle, MinusCircle, AlertCircle, Users, Calendar,
  ClipboardList, Beaker
} from 'lucide-react'

type ClassItem = { id: string; name: string }

type HomeworkItem = {
  id: string
  title: string
  assigned_date: string
  due_date: string | null
  description: string | null
  done: number
  partial: number
  none: number
  total: number
}

type ClinicItem = {
  id: string
  date: string
  clinic_name: string | null
  done: number
  not_done: number
  total: number
}

type StudentStatus = {
  student_id: string
  name: string
  status: string | null
}

type ViewTab = 'homework' | 'clinic'
type DetailType = { kind: 'homework'; item: HomeworkItem } | { kind: 'clinic'; item: ClinicItem }

// ──────────────────────────────────────────────
export default function HomeworkPage() {
  const [classes, setClasses] = useState<ClassItem[]>([])
  const [selectedClass, setSelectedClass] = useState<ClassItem | null>(null)
  const [viewTab, setViewTab] = useState<ViewTab>('homework')

  const [homeworks, setHomeworks] = useState<HomeworkItem[]>([])
  const [clinics, setClinics] = useState<ClinicItem[]>([])
  const [loading, setLoading] = useState(false)

  const [detail, setDetail] = useState<DetailType | null>(null)
  const [detailStudents, setDetailStudents] = useState<StudentStatus[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  // 반 목록 로드
  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: membership } = await supabase
        .from('academy_teachers').select('academy_id').eq('teacher_id', user.id).single()
      if (!membership) return
      const { data } = await supabase.from('classes').select('id, name').eq('academy_id', membership.academy_id).order('name')
      setClasses(data ?? [])
    })()
  }, [])

  // 반 선택 시 숙제·클리닉 로드
  const loadClassData = useCallback(async (cls: ClassItem) => {
    setSelectedClass(cls)
    setDetail(null)
    setLoading(true)

    // 소속 학생 수
    const { data: csData } = await supabase
      .from('class_students')
      .select('student_id')
      .eq('class_id', cls.id)
    const totalStudents = (csData ?? []).length

    // 숙제 목록
    const { data: hwList } = await supabase
      .from('homework')
      .select('id, title, assigned_date, due_date, description')
      .eq('class_id', cls.id)
      .order('assigned_date', { ascending: false })

    // 클리닉 세션 목록
    const { data: clinicList } = await supabase
      .from('clinic_sessions')
      .select('id, date, note')
      .eq('class_id', cls.id)
      .order('date', { ascending: false })

    // 클리닉 일정 이름 맵 (day_of_week → name)
    const { data: clinicScheds } = await supabase
      .from('clinic_schedules')
      .select('day_of_week, name')
      .eq('class_id', cls.id)
    const schedNameMap: Record<number, string> = {}
    for (const s of clinicScheds ?? []) {
      if (s.name) schedNameMap[s.day_of_week] = s.name
    }

    // 숙제별 완료 현황 집계
    const hwIds = (hwList ?? []).map((h: { id: string }) => h.id)
    let hwStatusMap: Record<string, { done: number; partial: number; none: number }> = {}
    if (hwIds.length > 0) {
      const { data: hwStatuses } = await supabase
        .from('homework_status')
        .select('homework_id, status')
        .in('homework_id', hwIds)
      for (const r of (hwStatuses ?? []) as { homework_id: string; status: string }[]) {
        if (!hwStatusMap[r.homework_id]) hwStatusMap[r.homework_id] = { done: 0, partial: 0, none: 0 }
        if (r.status === 'done') hwStatusMap[r.homework_id].done++
        else if (r.status === 'partial') hwStatusMap[r.homework_id].partial++
        else hwStatusMap[r.homework_id].none++
      }
    }

    const hwFormatted: HomeworkItem[] = (hwList ?? []).map((h: { id: string; title: string; assigned_date: string; due_date: string | null; description: string | null }) => {
      const s = hwStatusMap[h.id] ?? { done: 0, partial: 0, none: 0 }
      return { ...h, ...s, total: totalStudents }
    })

    // 클리닉별 완료 현황 집계
    const clinicIds = (clinicList ?? []).map((c: { id: string }) => c.id)
    let clinicStatusMap: Record<string, { done: number; not_done: number }> = {}
    if (clinicIds.length > 0) {
      const { data: clinicStatuses } = await supabase
        .from('clinic_attendance')
        .select('clinic_session_id, status')
        .in('clinic_session_id', clinicIds)
      for (const r of (clinicStatuses ?? []) as { clinic_session_id: string; status: string }[]) {
        if (!clinicStatusMap[r.clinic_session_id]) clinicStatusMap[r.clinic_session_id] = { done: 0, not_done: 0 }
        if (r.status === 'done') clinicStatusMap[r.clinic_session_id].done++
        else clinicStatusMap[r.clinic_session_id].not_done++
      }
    }

    const clinicFormatted: ClinicItem[] = (clinicList ?? []).map((c: { id: string; date: string; note: string | null }) => {
      const dow = new Date(c.date + 'T00:00:00').getDay()
      const DAYS = ['일', '월', '화', '수', '목', '금', '토']
      const clinicName = schedNameMap[dow] ?? `${DAYS[dow]}요일 클리닉`
      const s = clinicStatusMap[c.id] ?? { done: 0, not_done: 0 }
      return { id: c.id, date: c.date, clinic_name: clinicName, ...s, total: totalStudents }
    })

    setHomeworks(hwFormatted)
    setClinics(clinicFormatted)
    setLoading(false)
  }, [])

  // 상세 조회 (학생별 현황)
  const openDetail = useCallback(async (d: DetailType) => {
    setDetail(d)
    setDetailLoading(true)

    // 이 반 학생 목록
    const { data: csData } = await supabase
      .from('class_students')
      .select('students(id, name)')
      .eq('class_id', selectedClass!.id)

    const students: { id: string; name: string }[] = (csData ?? [])
      .map((r: any) => r.students)
      .filter(Boolean)
      .sort((a: any, b: any) => a.name.localeCompare(b.name, 'ko'))

    if (d.kind === 'homework') {
      const { data: statuses } = await supabase
        .from('homework_status')
        .select('student_id, status')
        .eq('homework_id', d.item.id)
      const statusMap: Record<string, string> = {}
      for (const r of statuses ?? []) statusMap[r.student_id] = r.status

      setDetailStudents(students.map(s => ({
        student_id: s.id,
        name: s.name,
        status: statusMap[s.id] ?? null,
      })))
    } else {
      const { data: statuses } = await supabase
        .from('clinic_attendance')
        .select('student_id, status')
        .eq('clinic_session_id', d.item.id)
      const statusMap: Record<string, string> = {}
      for (const r of statuses ?? []) statusMap[r.student_id] = r.status

      setDetailStudents(students.map(s => ({
        student_id: s.id,
        name: s.name,
        status: statusMap[s.id] ?? null,
      })))
    }

    setDetailLoading(false)
  }, [selectedClass])

  // ──────────── 렌더 헬퍼 ────────────
  const fmtDate = (d: string) => {
    const dt = new Date(d + 'T00:00:00')
    const DAYS = ['일', '월', '화', '수', '목', '금', '토']
    return `${dt.getMonth() + 1}/${dt.getDate()}(${DAYS[dt.getDay()]})`
  }

  const HwStatusBadge = ({ status }: { status: string | null }) => {
    if (status === 'done') return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
        <CheckCircle2 size={11} /> 완료
      </span>
    )
    if (status === 'partial') return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
        <MinusCircle size={11} /> 오답
      </span>
    )
    if (status === 'none') return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
        <AlertCircle size={11} /> 미제출
      </span>
    )
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">
        <Circle size={11} /> 미기록
      </span>
    )
  }

  const ClinicStatusBadge = ({ status }: { status: string | null }) => {
    if (status === 'done') return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">
        <CheckCircle2 size={11} /> 완료
      </span>
    )
    if (status === 'not_done') return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
        <AlertCircle size={11} /> 미완료
      </span>
    )
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">
        <Circle size={11} /> 미기록
      </span>
    )
  }

  const RateBar = ({ done, total, color = 'bg-blue-500' }: { done: number; total: number; color?: string }) => {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs font-bold text-slate-600 w-8 text-right">{pct}%</span>
      </div>
    )
  }

  // ──────────── Level 1: 반 선택 ────────────
  if (!selectedClass) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center">
            <BookOpen size={20} className="text-orange-500" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">숙제·클리닉</h1>
            <p className="text-xs text-slate-500">반을 선택하면 전체 기록을 볼 수 있어요</p>
          </div>
        </div>

        {classes.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Users size={32} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">등록된 반이 없습니다</p>
          </div>
        ) : (
          <div className="space-y-2">
            {classes.map(cls => (
              <button
                key={cls.id}
                onClick={() => loadClassData(cls)}
                className="w-full flex items-center justify-between px-4 py-4 bg-white border border-slate-200 rounded-xl hover:border-blue-300 hover:bg-blue-50/40 transition-all text-left group"
              >
                <span className="font-semibold text-slate-800 group-hover:text-blue-700">{cls.name}</span>
                <ChevronRight size={18} className="text-slate-400 group-hover:text-blue-500" />
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ──────────── Level 2: 목록 or 상세 ────────────
  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => { if (detail) { setDetail(null) } else { setSelectedClass(null) } }}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
        >
          <ChevronLeft size={20} className="text-slate-600" />
        </button>
        <div className="flex-1">
          <p className="text-xs text-slate-500">{selectedClass.name}</p>
          <h1 className="text-base font-bold text-slate-800 leading-tight">
            {detail
              ? detail.kind === 'homework'
                ? detail.item.title
                : (detail.item.clinic_name ?? '클리닉')
              : '숙제·클리닉 기록'}
          </h1>
        </div>
      </div>

      {/* 상세 뷰 */}
      {detail ? (
        <div>
          {/* 요약 카드 */}
          {detail.kind === 'homework' ? (() => {
            const hw = detail.item
            const doneRate = hw.total > 0 ? Math.round((hw.done / hw.total) * 100) : 0
            return (
              <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Calendar size={14} />
                    <span>출제일 {fmtDate(hw.assigned_date)}</span>
                    {hw.due_date && <span>· 마감 {fmtDate(hw.due_date)}</span>}
                  </div>
                  <span className="text-xl font-bold text-blue-600">{doneRate}%</span>
                </div>
                <RateBar done={hw.done} total={hw.total} color="bg-blue-500" />
                <div className="flex gap-3 text-xs text-center">
                  <div className="flex-1 bg-emerald-50 rounded-lg py-2">
                    <div className="font-bold text-emerald-600">{hw.done}</div>
                    <div className="text-slate-500">완료</div>
                  </div>
                  <div className="flex-1 bg-amber-50 rounded-lg py-2">
                    <div className="font-bold text-amber-600">{hw.partial}</div>
                    <div className="text-slate-500">오답</div>
                  </div>
                  <div className="flex-1 bg-red-50 rounded-lg py-2">
                    <div className="font-bold text-red-500">{hw.none}</div>
                    <div className="text-slate-500">미제출</div>
                  </div>
                  <div className="flex-1 bg-slate-50 rounded-lg py-2">
                    <div className="font-bold text-slate-500">{hw.total - hw.done - hw.partial - hw.none}</div>
                    <div className="text-slate-500">미기록</div>
                  </div>
                </div>
                {hw.description && (
                  <p className="text-xs text-slate-500 border-t border-slate-100 pt-3">{hw.description}</p>
                )}
              </div>
            )
          })() : (() => {
            const cl = detail.item
            const doneRate = cl.total > 0 ? Math.round((cl.done / cl.total) * 100) : 0
            return (
              <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Calendar size={14} />
                    <span>{fmtDate(cl.date)}</span>
                  </div>
                  <span className="text-xl font-bold text-violet-600">{doneRate}%</span>
                </div>
                <RateBar done={cl.done} total={cl.total} color="bg-violet-500" />
                <div className="flex gap-3 text-xs text-center">
                  <div className="flex-1 bg-violet-50 rounded-lg py-2">
                    <div className="font-bold text-violet-600">{cl.done}</div>
                    <div className="text-slate-500">완료</div>
                  </div>
                  <div className="flex-1 bg-red-50 rounded-lg py-2">
                    <div className="font-bold text-red-500">{cl.not_done}</div>
                    <div className="text-slate-500">미완료</div>
                  </div>
                  <div className="flex-1 bg-slate-50 rounded-lg py-2">
                    <div className="font-bold text-slate-500">{cl.total - cl.done - cl.not_done}</div>
                    <div className="text-slate-500">미기록</div>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* 학생 목록 */}
          {detailLoading ? (
            <div className="text-center py-10 text-slate-400 text-sm">불러오는 중...</div>
          ) : (
            <div className="space-y-1.5">
              {detailStudents.map(s => (
                <div key={s.student_id} className="flex items-center justify-between bg-white border border-slate-100 rounded-xl px-4 py-3">
                  <span className="text-sm font-medium text-slate-800">{s.name}</span>
                  {detail.kind === 'homework'
                    ? <HwStatusBadge status={s.status} />
                    : <ClinicStatusBadge status={s.status} />
                  }
                </div>
              ))}
              {detailStudents.length === 0 && (
                <div className="text-center py-10 text-slate-400 text-sm">학생 정보가 없습니다</div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* ──── 목록 뷰 ──── */
        <>
          {/* 탭 */}
          <div className="flex bg-slate-100 rounded-xl p-1 mb-4">
            <button
              onClick={() => setViewTab('homework')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-all ${
                viewTab === 'homework' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'
              }`}
            >
              <ClipboardList size={15} />
              숙제 {homeworks.length > 0 && <span className="text-xs opacity-70">({homeworks.length})</span>}
            </button>
            <button
              onClick={() => setViewTab('clinic')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-all ${
                viewTab === 'clinic' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'
              }`}
            >
              <Beaker size={15} />
              클리닉 {clinics.length > 0 && <span className="text-xs opacity-70">({clinics.length})</span>}
            </button>
          </div>

          {loading ? (
            <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>
          ) : viewTab === 'homework' ? (
            homeworks.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <ClipboardList size={32} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm">출제된 숙제가 없습니다</p>
                <p className="text-xs mt-1 text-slate-400">수업 관리 → 캘린더에서 날짜를 선택해 숙제를 추가하세요</p>
              </div>
            ) : (
              <div className="space-y-2">
                {homeworks.map(hw => {
                  const doneRate = hw.total > 0 ? Math.round((hw.done / hw.total) * 100) : 0
                  return (
                    <button
                      key={hw.id}
                      onClick={() => openDetail({ kind: 'homework', item: hw })}
                      className="w-full bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 hover:bg-blue-50/30 transition-all text-left group"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 pr-3">
                          <p className="font-semibold text-slate-800 group-hover:text-blue-700 text-sm leading-snug">{hw.title}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            출제 {fmtDate(hw.assigned_date)}
                            {hw.due_date && ` · 마감 ${fmtDate(hw.due_date)}`}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-lg font-bold text-blue-600">{doneRate}%</span>
                          <p className="text-xs text-slate-400">{hw.done}/{hw.total}명 완료</p>
                        </div>
                      </div>
                      <RateBar done={hw.done} total={hw.total} color="bg-blue-500" />
                      <div className="flex gap-2 mt-2.5 text-xs">
                        <span className="text-emerald-600 font-medium">완료 {hw.done}</span>
                        <span className="text-slate-300">·</span>
                        <span className="text-amber-600 font-medium">오답 {hw.partial}</span>
                        <span className="text-slate-300">·</span>
                        <span className="text-red-500 font-medium">미제출 {hw.none}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          ) : (
            clinics.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <Beaker size={32} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm">클리닉 기록이 없습니다</p>
                <p className="text-xs mt-1 text-slate-400">수업 관리 → 캘린더에서 클리닉 날짜를 선택해 기록하세요</p>
              </div>
            ) : (
              <div className="space-y-2">
                {clinics.map(cl => {
                  const doneRate = cl.total > 0 ? Math.round((cl.done / cl.total) * 100) : 0
                  return (
                    <button
                      key={cl.id}
                      onClick={() => openDetail({ kind: 'clinic', item: cl })}
                      className="w-full bg-white border border-slate-200 rounded-xl p-4 hover:border-violet-300 hover:bg-violet-50/30 transition-all text-left group"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 pr-3">
                          <p className="font-semibold text-slate-800 group-hover:text-violet-700 text-sm">{cl.clinic_name ?? '클리닉'}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{fmtDate(cl.date)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-lg font-bold text-violet-600">{doneRate}%</span>
                          <p className="text-xs text-slate-400">{cl.done}/{cl.total}명 완료</p>
                        </div>
                      </div>
                      <RateBar done={cl.done} total={cl.total} color="bg-violet-500" />
                      <div className="flex gap-2 mt-2.5 text-xs">
                        <span className="text-violet-600 font-medium">완료 {cl.done}</span>
                        <span className="text-slate-300">·</span>
                        <span className="text-red-500 font-medium">미완료 {cl.not_done}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          )}
        </>
      )}
    </div>
  )
}
