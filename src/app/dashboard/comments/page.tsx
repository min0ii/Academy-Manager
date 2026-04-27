'use client'

import { useEffect, useState, useCallback } from 'react'
import { ChevronLeft, ChevronRight, MessageSquare, Save, Check, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAcademy } from '@/lib/academy-context'

type ClassItem = { id: string; name: string }
type Session   = { id: string; date: string; start_time: string; end_time: string; status: string }
type Student   = { id: string; name: string }

const DAYS_KO = ['일', '월', '화', '수', '목', '금', '토']

function padDate(n: number) { return String(n).padStart(2, '0') }
function toDateStr(d: Date) {
  return `${d.getFullYear()}-${padDate(d.getMonth() + 1)}-${padDate(d.getDate())}`
}
function fmtDisplay(dateStr: string) {
  const [y, m, d] = dateStr.split('-')
  return `${y}년 ${Number(m)}월 ${Number(d)}일`
}

export default function CommentsPage() {
  const ctx = useAcademy()
  const [teacherId, setTeacherId] = useState<string | null>(null)

  // ── 반 목록 ──
  const [classes, setClasses]               = useState<ClassItem[]>([])
  const [classesLoading, setClassesLoading] = useState(true)
  const [selectedClass, setSelectedClass]   = useState<ClassItem | null>(null)

  // ── 캘린더 ──
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [sessions, setSessions]               = useState<Session[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)

  // ── 날짜 선택 & 코멘트 작성 ──
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [students, setStudents]               = useState<Student[]>([])
  const [comments, setComments]               = useState<Record<string, string>>({})   // 현재 편집값
  const [savedComments, setSavedComments]     = useState<Record<string, string>>({})   // 저장된 값
  const [detailLoading, setDetailLoading]     = useState(false)
  const [saving, setSaving]                   = useState<string | null>(null)
  const [savedIds, setSavedIds]               = useState<Set<string>>(new Set())

  // ── 초기: teacher_id 가져오기 + 반 목록 ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setTeacherId(session.user.id)
    })
  }, [])

  useEffect(() => {
    if (!ctx) return
    setClassesLoading(true)
    supabase.from('classes').select('id, name').eq('academy_id', ctx.academyId).order('name')
      .then(({ data }) => { setClasses(data ?? []); setClassesLoading(false) })
  }, [ctx])

  // ── 월 변경 시 세션 로드 ──
  const loadSessions = useCallback(async (cls: ClassItem, m: Date) => {
    setSessionsLoading(true)
    setSelectedSession(null)
    const y = m.getFullYear(), mo = m.getMonth()
    const from = `${y}-${padDate(mo + 1)}-01`
    const to   = toDateStr(new Date(y, mo + 1, 0))

    const { data } = await supabase
      .from('sessions')
      .select('id, date, start_time, end_time, status')
      .eq('class_id', cls.id)
      .gte('date', from).lte('date', to)
      .order('date')

    setSessions(data ?? [])
    setSessionsLoading(false)
  }, [])

  useEffect(() => {
    if (selectedClass) loadSessions(selectedClass, month)
  }, [selectedClass, month, loadSessions])

  // ── 날짜 클릭 → 학생 + 기존 코멘트 로드 ──
  async function selectSession(session: Session) {
    setSelectedSession(session)
    setDetailLoading(true)
    setComments({})
    setSavedComments({})
    setSavedIds(new Set())

    const [{ data: csData }, { data: cmData }] = await Promise.all([
      supabase.from('class_students')
        .select('students(id, name)')
        .eq('class_id', selectedClass!.id),
      supabase.from('comments')
        .select('student_id, content')
        .eq('date', session.date)
        .eq('teacher_id', teacherId ?? ''),
    ])

    const studentList: Student[] = (csData ?? [])
      .map((r: any) => r.students).filter(Boolean)
      .sort((a: Student, b: Student) => a.name.localeCompare(b.name, 'ko'))

    const commentMap: Record<string, string> = {}
    for (const c of (cmData ?? [])) commentMap[c.student_id] = c.content

    setStudents(studentList)
    setComments({ ...commentMap })
    setSavedComments({ ...commentMap })
    setDetailLoading(false)
  }

  // ── 코멘트 저장 ──
  async function saveComment(studentId: string) {
    if (!selectedSession || !teacherId) return
    setSaving(studentId)
    const content = (comments[studentId] ?? '').trim()

    // 기존 코멘트 삭제 후 재삽입 (upsert 대신 안정적인 방식)
    await supabase.from('comments')
      .delete()
      .eq('date', selectedSession.date)
      .eq('student_id', studentId)
      .eq('teacher_id', teacherId)

    if (content !== '') {
      await supabase.from('comments').insert({
        student_id: studentId,
        teacher_id: teacherId,
        date: selectedSession.date,
        content,
      })
    }

    setSavedComments(prev => ({ ...prev, [studentId]: content }))
    setSavedIds(prev => new Set(prev).add(studentId))
    setSaving(null)
    setTimeout(() => {
      setSavedIds(prev => { const s = new Set(prev); s.delete(studentId); return s })
    }, 2000)
  }

  // ── 캘린더 계산 ──
  const sessionDates    = new Set(sessions.map(s => s.date))
  const cancelledDates  = new Set(sessions.filter(s => s.status === 'cancelled').map(s => s.date))
  const year  = month.getFullYear()
  const mo    = month.getMonth()
  const firstDow    = new Date(year, mo, 1).getDay()
  const daysInMonth = new Date(year, mo + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7)
    weeks.push(cells.slice(i, i + 7).concat(Array(Math.max(0, 7 - cells.slice(i, i + 7).length)).fill(null)))

  const today = toDateStr(new Date())

  function dayToDateStr(day: number) {
    return `${year}-${padDate(mo + 1)}-${padDate(day)}`
  }

  // ══════════════════════════════════════════
  // 반 선택 화면
  // ══════════════════════════════════════════
  if (!selectedClass) {
    return (
      <div className="max-w-lg mx-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
            <MessageSquare size={20} className="text-violet-500" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">코멘트</h1>
            <p className="text-xs text-slate-500">반을 선택하면 수업별로 코멘트를 작성할 수 있어요</p>
          </div>
        </div>

        {classesLoading ? (
          <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>
        ) : classes.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-sm">등록된 반이 없어요</div>
        ) : (
          <div className="space-y-2">
            {classes.map(cls => (
              <button key={cls.id} onClick={() => setSelectedClass(cls)}
                className="w-full flex items-center justify-between px-4 py-4 bg-white border border-slate-200 rounded-xl hover:border-violet-300 hover:bg-violet-50/40 transition-all text-left group">
                <span className="font-semibold text-slate-800 group-hover:text-violet-700">{cls.name}</span>
                <ChevronRight size={18} className="text-slate-400 group-hover:text-violet-500" />
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════
  // 캘린더 + 코멘트 작성 화면
  // ══════════════════════════════════════════
  return (
    <div className="max-w-2xl mx-auto space-y-4 p-4 md:p-6">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => { setSelectedClass(null); setSelectedSession(null) }}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
        >
          <ChevronLeft size={20} className="text-slate-600" />
        </button>
        <div>
          <h1 className="text-base font-bold text-slate-800">{selectedClass.name}</h1>
          <p className="text-xs text-slate-500">수업 날짜를 선택해 코멘트를 작성하세요</p>
        </div>
      </div>

      {/* ── 캘린더 ── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {/* 월 이동 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <button onClick={() => setMonth(new Date(year, mo - 1, 1))}
            className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            <ChevronLeft size={16} className="text-slate-600" />
          </button>
          <span className="text-sm font-bold text-slate-800">{year}년 {mo + 1}월</span>
          <button onClick={() => setMonth(new Date(year, mo + 1, 1))}
            className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            <ChevronRight size={16} className="text-slate-600" />
          </button>
        </div>

        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 border-b border-slate-100">
          {DAYS_KO.map((d, i) => (
            <div key={d} className={`py-2 text-center text-xs font-semibold
              ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-slate-400'}`}>
              {d}
            </div>
          ))}
        </div>

        {/* 날짜 셀 */}
        {sessionsLoading ? (
          <div className="py-12 text-center text-slate-400 text-sm">불러오는 중...</div>
        ) : (
          <>
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 border-b border-slate-50 last:border-0">
                {week.map((day, di) => {
                  if (!day) return <div key={di} className="h-14" />
                  const ds          = dayToDateStr(day)
                  const hasSession  = sessionDates.has(ds)
                  const isCancelled = cancelledDates.has(ds)
                  const isToday     = ds === today
                  const isSelected  = selectedSession?.date === ds
                  const session     = sessions.find(s => s.date === ds)

                  return (
                    <button key={di}
                      onClick={() => hasSession && !isCancelled && session && selectSession(session)}
                      disabled={!hasSession || isCancelled}
                      className={`h-14 flex flex-col items-center justify-center gap-1 transition-all
                        ${isSelected ? 'bg-violet-600' :
                          hasSession && !isCancelled ? 'hover:bg-violet-50 cursor-pointer' :
                          'cursor-default'}`}
                    >
                      <span className={`text-sm font-medium leading-none
                        ${isSelected   ? 'text-white font-bold' :
                          isToday      ? 'text-violet-600 font-bold' :
                          di === 0     ? 'text-red-400' :
                          di === 6     ? 'text-blue-400' : 'text-slate-700'}`}>
                        {day}
                      </span>
                      {hasSession && !isCancelled && (
                        <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white/70' : 'bg-violet-400'}`} />
                      )}
                      {isCancelled && (
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
            {/* 범례 */}
            <div className="flex items-center gap-4 px-5 py-2.5 border-t border-slate-100 bg-slate-50/60">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="w-2 h-2 rounded-full bg-violet-400" /> 수업
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="w-2 h-2 rounded-full bg-slate-300" /> 휴강
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── 코멘트 작성 패널 ── */}
      {selectedSession && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {/* 패널 헤더 */}
          <div className="px-5 py-4 border-b border-slate-100 bg-violet-50/40">
            <div className="flex items-center gap-2">
              <MessageSquare size={16} className="text-violet-500" />
              <div>
                <p className="text-sm font-bold text-slate-800">
                  {fmtDisplay(selectedSession.date)} 수업
                </p>
                <p className="text-xs text-slate-400">
                  {selectedSession.start_time.slice(0, 5)} ~ {selectedSession.end_time.slice(0, 5)}
                </p>
              </div>
            </div>
          </div>

          {detailLoading ? (
            <div className="py-10 text-center text-slate-400 text-sm">불러오는 중...</div>
          ) : students.length === 0 ? (
            <div className="py-10 text-center text-slate-400">
              <Users size={28} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">배정된 학생이 없어요</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {students.map(s => {
                const current  = comments[s.id] ?? ''
                const saved    = savedComments[s.id] ?? ''
                const isDirty  = current.trim() !== saved.trim()
                const isSaved  = savedIds.has(s.id)
                const isThis   = saving === s.id
                const hasSaved = saved.trim() !== ''

                return (
                  <div key={s.id} className="p-4 space-y-2.5">
                    {/* 학생명 + 저장 버튼 */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center">
                          <span className="text-violet-700 text-xs font-bold">{s.name[0]}</span>
                        </div>
                        <span className="text-sm font-semibold text-slate-800">{s.name}</span>
                        {hasSaved && !isDirty && !isSaved && (
                          <span className="text-xs text-violet-500 bg-violet-50 px-2 py-0.5 rounded-full">저장됨</span>
                        )}
                      </div>
                      <button
                        onClick={() => saveComment(s.id)}
                        disabled={isThis || !isDirty}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all
                          ${isSaved ? 'bg-emerald-50 text-emerald-600' :
                            isDirty  ? 'bg-violet-600 text-white hover:bg-violet-700' :
                                       'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                      >
                        {isSaved   ? <><Check size={12} /> 저장 완료</> :
                         isThis    ? '저장 중...' :
                                     <><Save size={12} /> 저장</>}
                      </button>
                    </div>

                    {/* 코멘트 입력창 */}
                    <textarea
                      value={current}
                      onChange={e => {
                        setComments(prev => ({ ...prev, [s.id]: e.target.value }))
                        setSavedIds(prev => { const s2 = new Set(prev); s2.delete(s.id); return s2 })
                      }}
                      placeholder={`${s.name} 학생에 대한 코멘트를 입력하세요...`}
                      rows={3}
                      className="w-full px-3 py-2.5 text-sm text-slate-800 border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent placeholder-slate-300 transition-all"
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
