'use client'

import { useState, useEffect } from 'react'
import { ChevronDown, BarChart2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAcademy } from '@/lib/academy-context'

// ── Types ──────────────────────────────────────────────────────────────────

type ClassItem = { id: string; name: string }

type ExamInGroup = { id: string; title: string; order: number }

type StudentRow = {
  studentId: string
  name: string
  scores: (number | null)[]
  total: number | null
  rank: number | null
}

type Group = {
  date: string
  category: string | null
  exams: ExamInGroup[]
  students: StudentRow[]
}

type ApiData = {
  dates: string[]
  groups: Group[]
}

// ── 유틸 ──────────────────────────────────────────────────────────────────

function formatDate(d: string) {
  const [, m, day] = d.split('-').map(Number)
  const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(`${d}T12:00:00+09:00`).getDay()]
  return `${m}월 ${day}일 (${dow})`
}

function catLabel(c: string | null) {
  return c ?? '미설정'
}

// 부동소수점 표시 정리: 100.0000001 → 100, 33.30 → 33.3
function fmtScore(n: number): string {
  return parseFloat((Math.round(n * 100) / 100).toFixed(2)).toString()
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ExamGroupWidget() {
  const ctx = useAcademy()

  const [expanded, setExpanded] = useState(false)
  const [classes, setClasses] = useState<ClassItem[]>([])
  const [selectedClassId, setSelectedClassId] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ApiData | null>(null)
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set())

  // 처음 펼칠 때 반 목록 로드
  useEffect(() => {
    if (!expanded || !ctx || classes.length > 0) return
    ;(async () => {
      const { data: cls } = await supabase
        .from('classes')
        .select('id, name')
        .eq('academy_id', ctx.academyId)
        .order('name')
      const list = cls ?? []
      setClasses(list)
      if (list.length > 0) setSelectedClassId(list[0].id)
    })()
  }, [expanded, ctx, classes.length])

  // 반 바뀌면 데이터 로드
  useEffect(() => {
    if (!selectedClassId || !expanded) return
    ;(async () => {
      setLoading(true)
      setData(null)
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setLoading(false); return }

      const res = await fetch(`/api/dashboard/exam-groups?classId=${selectedClassId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) { setLoading(false); return }

      const json: ApiData = await res.json()
      setData(json)

      if (json.dates.length > 0) {
        const first = json.dates[0]
        setSelectedDate(first)
        setSelectedCats(new Set(
          json.groups.filter(g => g.date === first).map(g => catLabel(g.category))
        ))
      } else {
        setSelectedDate('')
        setSelectedCats(new Set())
      }
      setLoading(false)
    })()
  }, [selectedClassId, expanded])

  function handleDateSelect(date: string) {
    setSelectedDate(date)
    if (data) {
      setSelectedCats(new Set(
        data.groups.filter(g => g.date === date).map(g => catLabel(g.category))
      ))
    }
  }

  function toggleCat(cat: string) {
    setSelectedCats(prev => {
      const next = new Set(prev)
      if (next.has(cat) && next.size > 1) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  // 현재 날짜의 카테고리 목록
  const catsForDate = data?.groups
    .filter(g => g.date === selectedDate)
    .map(g => catLabel(g.category)) ?? []

  // 표시할 그룹
  const visibleGroups = data?.groups.filter(
    g => g.date === selectedDate && selectedCats.has(catLabel(g.category))
  ) ?? []

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">

      {/* ── 헤더 (항상 표시) ─────────────────────────── */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-xl flex-shrink-0">
            <BarChart2 size={18} className="text-indigo-600" />
          </div>
          <div>
            <p className="font-semibold text-slate-800 text-sm">시험 모아보기</p>
            <p className="text-xs text-slate-400 mt-0.5">같은 날 같은 카테고리 시험 합산 · 순위</p>
          </div>
        </div>
        <ChevronDown
          size={18}
          className={`text-slate-400 transition-transform duration-300 flex-shrink-0 ml-3 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* ── 확장 영역 (grid 트릭으로 부드럽게) ──────────────── */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-slate-100 px-5 pb-6 space-y-4">

            {/* 반 선택 */}
            {classes.length > 1 && (
              <div className="pt-4">
                <select
                  value={selectedClassId}
                  onChange={e => setSelectedClassId(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white w-full sm:w-auto"
                >
                  {classes.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* 로딩 */}
            {loading && (
              <div className="flex items-center justify-center py-10 pt-6">
                <div className="w-5 h-5 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
              </div>
            )}

            {/* 데이터 없음 */}
            {!loading && data && data.dates.length === 0 && (
              <div className="text-center py-10 text-slate-400 text-sm">
                모아볼 시험이 없어요
              </div>
            )}

            {/* 콘텐츠 */}
            {!loading && data && data.dates.length > 0 && (
              <>
                {/* 날짜 선택 (가로 스크롤) */}
                <div className={`flex gap-2 overflow-x-auto pb-0.5 ${classes.length > 1 ? '' : 'pt-4'}`}
                  style={{ scrollbarWidth: 'none' }}>
                  {data.dates.map(date => (
                    <button
                      key={date}
                      onClick={() => handleDateSelect(date)}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                        selectedDate === date
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {formatDate(date)}
                    </button>
                  ))}
                </div>

                {/* 카테고리 다중 선택 (2개 이상일 때만 표시) */}
                {catsForDate.length > 1 && (
                  <div className="flex flex-wrap gap-2">
                    {catsForDate.map(cat => (
                      <button
                        key={cat}
                        onClick={() => toggleCat(cat)}
                        className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors border ${
                          selectedCats.has(cat)
                            ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
                            : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                )}

                {/* 그룹별 테이블 */}
                <div className="space-y-4">
                  {visibleGroups.map(group => (
                    <div key={`${group.date}-${group.category ?? 'none'}`} className="space-y-2">

                      {/* 카테고리명 항상 표시 */}
                      <p className="text-xs font-semibold text-slate-600 px-1">
                        {catLabel(group.category)}
                        <span className="font-normal text-slate-400 ml-1">· {group.exams.length}개 시험</span>
                      </p>

                      {/* 테이블 (가로 스크롤) */}
                      <div className="overflow-x-auto rounded-xl border border-slate-200"
                        style={{ scrollbarWidth: 'none' }}>
                        <table className="text-xs min-w-full">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                              {/* 학생 열 */}
                              <th className="text-left px-3 py-2.5 font-semibold text-slate-600 whitespace-nowrap">
                                학생
                              </th>
                              {/* 회차 열 */}
                              {group.exams.map((_, i) => (
                                <th key={i} className="px-3 py-2.5 font-semibold text-slate-500 text-center whitespace-nowrap">
                                  {i + 1}회
                                </th>
                              ))}
                              {/* 합계 */}
                              <th className="px-3 py-2.5 font-bold text-indigo-700 text-center whitespace-nowrap">
                                합계
                              </th>
                              {/* 순위 */}
                              <th className="px-3 py-2.5 font-semibold text-slate-600 text-center whitespace-nowrap">
                                순위
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.students.map((s, idx) => (
                              <tr
                                key={s.studentId}
                                className={`border-b border-slate-100 last:border-0 ${
                                  idx % 2 === 1 ? 'bg-slate-50/60' : 'bg-white'
                                }`}
                              >
                                <td className="px-3 py-2.5 font-medium text-slate-700 whitespace-nowrap">
                                  {s.name}
                                </td>
                                {s.scores.map((score, i) => (
                                  <td key={i} className="px-3 py-2.5 text-center text-slate-600">
                                    {score !== null
                                      ? <span>{fmtScore(score)}</span>
                                      : <span className="text-slate-300">-</span>}
                                  </td>
                                ))}
                                <td className="px-3 py-2.5 text-center font-bold text-indigo-700">
                                  {s.total !== null
                                    ? fmtScore(s.total)
                                    : <span className="text-slate-300">-</span>}
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                  {s.rank !== null ? (
                                    <span className={`font-bold ${
                                      s.rank === 1 ? 'text-amber-500' :
                                      s.rank === 2 ? 'text-slate-500' :
                                      s.rank === 3 ? 'text-orange-400' :
                                      'text-slate-500'
                                    }`}>
                                      {s.rank}위
                                    </span>
                                  ) : (
                                    <span className="text-slate-300">-</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}
