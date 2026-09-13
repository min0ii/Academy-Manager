'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { gradeLabel } from '@/lib/utils'
import { dbErrorMessage } from '@/lib/db-error'
import { useDialog } from '@/components/AppDialog'
import { writeHomeworkStatus, writeClinicStatus, writeHomeworkNote } from '@/lib/record-status'
import {
  Search, X, ChevronDown, MessageSquare, ClipboardList, Beaker, CalendarDays,
} from 'lucide-react'

const PAGE_SIZE = 20

const HW_LABEL  = { partial: '오답(완벽) 완료', done: '완료', none: '미완료' } as const
const HW_ACTIVE = {
  partial: 'bg-teal-500 text-white border-teal-500 ring-2 ring-teal-300 ring-offset-1',
  done:    'bg-green-500 text-white border-green-500',
  none:    'bg-red-500 text-white border-red-500',
} as const

type Cls     = { id: string; name: string }
type Student = { id: string; name: string; grade: string | null; school_name: string | null }

// 과제와 클리닉을 한 목록에 섞어서 다루기 위한 공통 모양
type RecordItem = {
  key: string                        // 'hw:<id>' | 'cl:<id>' — 확장 상태를 구분하는 열쇠
  kind: 'homework' | 'clinic'
  id: string
  title: string
  date: string
  classId: string
  className: string
  recorded: number                   // 처음 불러올 때 집계한 기록 수
  total: number                      // 반의 활동 학생 수
}

type Row = { id: string | null; student_id: string; status: string | null; note: string | null }

// .in() 에 한 번에 너무 많은 id를 넣으면 요청 URL이 길어져 실패한다
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const DAYS = ['일', '월', '화', '수', '목', '금', '토']
function fmtDate(d: string) {
  const dt = new Date(d + 'T00:00:00')
  return `${dt.getMonth() + 1}/${dt.getDate()}(${DAYS[dt.getDay()]})`
}

export default function RecordTab({ academyId, classes }: { academyId: string; classes: Cls[] }) {
  const { showAlert, dialog } = useDialog()

  const [items, setItems]   = useState<RecordItem[]>([])
  const [loading, setLoading] = useState(true)
  const [studentsByClass, setStudentsByClass] = useState<Record<string, Student[]>>({})

  // 필터
  const [q, setQ] = useState('')
  const [classFilter, setClassFilter] = useState<string>('all')
  const [dateFilter, setDateFilter]   = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)

  // 카드 확장 / 학생별 기록
  const [expanded, setExpanded] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<string, Row[]>>({})
  const [rowsLoading, setRowsLoading] = useState<string | null>(null)

  // 코멘트 디바운스 자동 저장 (반 상세 화면과 동일하게 1초)
  const noteTimerMap = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  function scheduleNoteSave(key: string, save: () => void) {
    if (noteTimerMap.current[key]) clearTimeout(noteTimerMap.current[key])
    noteTimerMap.current[key] = setTimeout(() => { delete noteTimerMap.current[key]; save() }, 1000)
  }
  function cancelNoteSave(key: string) {
    if (noteTimerMap.current[key]) clearTimeout(noteTimerMap.current[key])
    delete noteTimerMap.current[key]
  }
  useEffect(() => () => { for (const t of Object.values(noteTimerMap.current)) clearTimeout(t) }, [])

  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set())

  // ── 전체 과제·클리닉 로드
  const loadAll = useCallback(async () => {
    const classIds = classes.map(c => c.id)
    if (classIds.length === 0) { setItems([]); setLoading(false); return }
    setLoading(true)

    const nameOf: Record<string, string> = {}
    for (const c of classes) nameOf[c.id] = c.name

    const [{ data: hwList }, { data: clList }, { data: csList }] = await Promise.all([
      supabase.from('homework').select('id, title, assigned_date, class_id')
        .in('class_id', classIds).order('assigned_date', { ascending: false }),
      supabase.from('clinic_sessions').select('id, date, name, class_id')
        .in('class_id', classIds).order('date', { ascending: false }),
      supabase.from('class_students').select('class_id, students!inner(id, name, grade, school_name)')
        .in('class_id', classIds).eq('students.status', 'active'),
    ])

    // 반별 학생 목록 (가나다순)
    const byClass: Record<string, Student[]> = {}
    for (const r of (csList ?? []) as any[]) {
      const s = r.students
      if (!s) continue
      ;(byClass[r.class_id] ??= []).push(s)
    }
    for (const list of Object.values(byClass)) list.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    setStudentsByClass(byClass)

    // 기록 수 집계 — id가 많으면 나눠서 요청
    const hwIds = (hwList ?? []).map((h: any) => h.id)
    const clIds = (clList ?? []).map((c: any) => c.id)
    const hwCount: Record<string, number> = {}
    const clCount: Record<string, number> = {}
    await Promise.all([
      ...chunk(hwIds, 60).map(async ids => {
        const { data } = await supabase.from('homework_status').select('homework_id').in('homework_id', ids)
        for (const r of (data ?? []) as any[]) hwCount[r.homework_id] = (hwCount[r.homework_id] ?? 0) + 1
      }),
      ...chunk(clIds, 60).map(async ids => {
        const { data } = await supabase.from('clinic_attendance').select('clinic_session_id').in('clinic_session_id', ids)
        for (const r of (data ?? []) as any[]) clCount[r.clinic_session_id] = (clCount[r.clinic_session_id] ?? 0) + 1
      }),
    ])

    const merged: RecordItem[] = [
      ...(hwList ?? []).map((h: any) => ({
        key: `hw:${h.id}`, kind: 'homework' as const, id: h.id,
        title: h.title, date: h.assigned_date,
        classId: h.class_id, className: nameOf[h.class_id] ?? '',
        recorded: hwCount[h.id] ?? 0, total: (byClass[h.class_id] ?? []).length,
      })),
      ...(clList ?? []).map((c: any) => ({
        key: `cl:${c.id}`, kind: 'clinic' as const, id: c.id,
        title: c.name || '클리닉', date: c.date,
        classId: c.class_id, className: nameOf[c.class_id] ?? '',
        recorded: clCount[c.id] ?? 0, total: (byClass[c.class_id] ?? []).length,
      })),
    ].sort((a, b) => b.date.localeCompare(a.date) || a.className.localeCompare(b.className, 'ko'))

    setItems(merged)
    setLoading(false)
  }, [classes])

  useEffect(() => { void loadAll() }, [loadAll])

  // 필터가 바뀌면 다시 처음부터 보여준다
  useEffect(() => { setVisible(PAGE_SIZE) }, [q, classFilter, dateFilter])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return items.filter(it => {
      if (classFilter !== 'all' && it.classId !== classFilter) return false
      if (dateFilter && it.date !== dateFilter) return false
      if (kw && !it.title.toLowerCase().includes(kw)) return false
      return true
    })
  }, [items, q, classFilter, dateFilter])

  // ── 카드 펼치기 (펼칠 때 그 항목의 학생별 기록만 불러온다)
  async function toggleExpand(it: RecordItem) {
    if (expanded === it.key) { setExpanded(null); return }
    setExpanded(it.key)
    if (rows[it.key]) return

    setRowsLoading(it.key)
    const studs = studentsByClass[it.classId] ?? []
    const map: Record<string, { id: string; status: string; note: string | null }> = {}
    if (it.kind === 'homework') {
      const { data } = await supabase.from('homework_status')
        .select('id, student_id, status, note').eq('homework_id', it.id)
      for (const r of (data ?? []) as any[]) map[r.student_id] = { id: r.id, status: r.status, note: r.note }
    } else {
      const { data } = await supabase.from('clinic_attendance')
        .select('id, student_id, status').eq('clinic_session_id', it.id)
      for (const r of (data ?? []) as any[]) map[r.student_id] = { id: r.id, status: r.status, note: null }
    }
    setRows(prev => ({
      ...prev,
      [it.key]: studs.map(s => ({
        id: map[s.id]?.id ?? null, student_id: s.id,
        status: map[s.id]?.status ?? null, note: map[s.id]?.note ?? null,
      })),
    }))
    setRowsLoading(null)
  }

  // ── 상태 버튼
  async function onSetStatus(it: RecordItem, studentId: string, status: string) {
    const rec = (rows[it.key] ?? []).find(r => r.student_id === studentId)
    const res = it.kind === 'homework'
      ? await writeHomeworkStatus(rec, it.id, studentId, status as 'done' | 'partial' | 'none', { academyId, date: it.date })
      : await writeClinicStatus(rec, it.id, studentId, status as 'done' | 'not_done', { academyId, date: it.date })

    if (!res.ok) { void showAlert(dbErrorMessage(res.error, '저장')); return }
    setRows(prev => ({
      ...prev,
      [it.key]: (prev[it.key] ?? []).map(r => r.student_id === studentId
        ? (res.cleared ? { ...r, id: null, status: null, note: null } : { ...r, id: res.newId, status })
        : r),
    }))
  }

  // ── 코멘트 (과제만 — clinic_attendance 에는 note 칸이 없다)
  function onNoteChange(it: RecordItem, studentId: string, note: string) {
    setRows(prev => ({
      ...prev,
      [it.key]: (prev[it.key] ?? []).map(r => r.student_id === studentId ? { ...r, note } : r),
    }))
    scheduleNoteSave(`${it.key}:${studentId}`, () => void saveNote(it, studentId, note))
  }
  async function saveNote(it: RecordItem, studentId: string, note: string) {
    const rec = (rows[it.key] ?? []).find(r => r.student_id === studentId)
    if (!rec?.id) { void showAlert('과제 완료 여부를 먼저 선택해야 코멘트를 저장할 수 있어요.'); return }
    const { error } = await writeHomeworkNote(rec.id, note)
    if (error) void showAlert(dbErrorMessage(error, '저장'))
  }

  // ────────────────────────── 렌더
  return (
    <div>
      {dialog}

      {/* 검색 */}
      <div className="relative mb-2.5">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="과제·클리닉 제목으로 검색"
          className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent" />
        {q && (
          <button onClick={() => setQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        )}
      </div>

      {/* 날짜 */}
      <div className="flex items-center gap-2 mb-2.5">
        <CalendarDays size={15} className="text-slate-400 flex-shrink-0" />
        <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
          className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent" />
        {dateFilter && (
          <button onClick={() => setDateFilter('')}
            className="px-2.5 py-2 text-xs font-medium text-slate-500 bg-slate-100 rounded-xl hover:bg-slate-200 flex-shrink-0">
            날짜 해제
          </button>
        )}
      </div>

      {/* 반 카테고리 */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
        {[{ id: 'all', name: '전체 반' }, ...classes].map(c => (
          <button key={c.id} onClick={() => setClassFilter(c.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex-shrink-0 ${
              classFilter === c.id ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}>
            {c.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400 text-sm">
          {items.length === 0 ? '등록된 과제·클리닉이 없어요' : '조건에 맞는 과제·클리닉이 없어요'}
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-400 mb-2">{filtered.length}개</p>
          <div className="space-y-2">
            {filtered.slice(0, visible).map(it => {
              const list = rows[it.key]
              const recorded = list ? list.filter(r => r.status !== null).length : it.recorded
              const isOpen = expanded === it.key
              const isHw = it.kind === 'homework'
              return (
                <div key={it.key} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <button onClick={() => void toggleExpand(it)} className="w-full px-4 py-3 text-left hover:bg-slate-50/70 transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded ${
                        isHw ? 'bg-blue-50 text-blue-600' : 'bg-violet-50 text-violet-600'
                      }`}>
                        {isHw ? <ClipboardList size={10} /> : <Beaker size={10} />}
                        {isHw ? '과제' : '클리닉'}
                      </span>
                      <span className="text-xs font-medium text-slate-600 truncate">{it.className}</span>
                      <span className="text-xs text-slate-400 flex-shrink-0">· {fmtDate(it.date)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="flex-1 text-sm font-semibold text-slate-800 truncate">{it.title}</p>
                      <span className={`text-xs font-bold flex-shrink-0 ${
                        it.total > 0 && recorded >= it.total ? 'text-emerald-600' : 'text-slate-400'
                      }`}>
                        기록 {recorded}/{it.total}
                      </span>
                      <ChevronDown size={16} className={`text-slate-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-50/50 divide-y divide-slate-100">
                      {rowsLoading === it.key ? (
                        <p className="text-center py-5 text-slate-400 text-sm">불러오는 중...</p>
                      ) : (list ?? []).length === 0 ? (
                        <p className="text-center py-5 text-slate-400 text-sm">배정된 학생이 없어요</p>
                      ) : (list ?? []).map(rec => {
                        const student = (studentsByClass[it.classId] ?? []).find(s => s.id === rec.student_id)
                        if (!student) return null
                        const noteKey  = `${it.key}:${rec.student_id}`
                        const showNote = isHw && rec.status !== null && (!!rec.note || openNotes.has(noteKey))
                        return (
                          <div key={rec.student_id}>
                            <div className="flex items-center gap-3 px-4 py-2.5">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-800 truncate">{student.name}</p>
                                <p className="text-xs text-slate-400">
                                  {gradeLabel(student.grade)}{student.school_name ? ` · ${student.school_name}` : ''}
                                </p>
                              </div>
                              <div className="flex gap-1 flex-shrink-0 items-center">
                                {isHw ? (
                                  (['partial', 'done', 'none'] as const).map(s => (
                                    <button key={s} onClick={() => void onSetStatus(it, rec.student_id, s)}
                                      className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                        rec.status === s ? HW_ACTIVE[s] : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                                      }`}>
                                      {HW_LABEL[s]}
                                    </button>
                                  ))
                                ) : (
                                  <>
                                    <button onClick={() => void onSetStatus(it, rec.student_id, 'done')}
                                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                        rec.status === 'done' ? 'bg-green-500 text-white border-green-500' : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                                      }`}>완료</button>
                                    <button onClick={() => void onSetStatus(it, rec.student_id, 'not_done')}
                                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                        rec.status === 'not_done' ? 'bg-red-500 text-white border-red-500' : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                                      }`}>미완료</button>
                                  </>
                                )}
                                {isHw && rec.status !== null && (
                                  <button onClick={() => setOpenNotes(prev => {
                                    const next = new Set(prev)
                                    next.has(noteKey) ? next.delete(noteKey) : next.add(noteKey)
                                    return next
                                  })}
                                    className={`p-1.5 rounded-lg border transition-colors ${
                                      rec.note || openNotes.has(noteKey)
                                        ? 'border-orange-300 text-orange-500 bg-orange-50'
                                        : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:bg-slate-50'
                                    }`}>
                                    <MessageSquare size={13} />
                                  </button>
                                )}
                              </div>
                            </div>
                            {showNote && (
                              <div className="px-4 pb-2.5">
                                <input type="text" value={rec.note ?? ''}
                                  onChange={e => onNoteChange(it, rec.student_id, e.target.value)}
                                  onBlur={e => { cancelNoteSave(noteKey); void saveNote(it, rec.student_id, e.target.value) }}
                                  placeholder="코멘트 입력 (선택)"
                                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white" />
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {visible < filtered.length && (
            <button onClick={() => setVisible(v => v + PAGE_SIZE)}
              className="w-full mt-3 py-2.5 text-sm font-semibold text-slate-500 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors">
              더보기 ({filtered.length - visible}개 남음)
            </button>
          )}
        </>
      )}
    </div>
  )
}
