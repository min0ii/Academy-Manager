'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Plus, X, ChevronRight, ChevronLeft, BarChart2, Trash2, AlertTriangle, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAcademy } from '@/lib/academy-context'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

type ClassItem = { id: string; name: string; test_count: number }
type Test = { id: string; name: string; max_score: number; date: string; takers: number; avgScore: number | null }
type TestScore = { student_id: string; student_name: string; score: number | null }

function pct(score: number | null, max: number): number | null {
  if (score === null || max === 0) return null
  return Math.round((score / max) * 100)
}

function scoreColor(p: number | null) {
  if (p === null) return 'text-slate-400'
  if (p >= 80) return 'text-emerald-600'
  if (p >= 60) return 'text-amber-600'
  return 'text-red-500'
}

function scoreBg(p: number | null) {
  if (p === null) return 'bg-slate-50'
  if (p >= 80) return 'bg-emerald-50'
  if (p >= 60) return 'bg-amber-50'
  return 'bg-red-50'
}

function computeAvg(testScores: { score: number; absent: boolean }[], maxScore: number): number | null {
  const valid = testScores.filter(s => !s.absent && s.score !== null).map(s => s.score)
  if (valid.length === 0) return null
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
}

function GradesContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const ctx = useAcademy()

  const [classes, setClasses] = useState<ClassItem[]>([])
  const [selectedClass, setSelectedClass] = useState<ClassItem | null>(null)
  const [tests, setTests] = useState<Test[]>([])
  const [selectedTest, setSelectedTest] = useState<Test | null>(null)
  const [scores, setScores] = useState<TestScore[]>([])
  const [editScores, setEditScores] = useState<Record<string, string>>({})
  const [absentIds, setAbsentIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingTests, setLoadingTests] = useState(false)
  const [loadingScores, setLoadingScores] = useState(false)

  const [showAddTest, setShowAddTest] = useState(false)
  const [testName, setTestName] = useState('')
  const [testMaxScore, setTestMaxScore] = useState('100')
  const [testDate, setTestDate] = useState(new Date().toISOString().slice(0, 10))
  const [addingTest, setAddingTest] = useState(false)
  const [testDateHasSession, setTestDateHasSession] = useState<boolean | null>(null)

  const from = searchParams.get('from')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && showAddTest) { setShowAddTest(false); setTestDateHasSession(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showAddTest])

  function setUrl(classId?: string, testId?: string) {
    const url = new URL(window.location.href)
    url.searchParams.delete('classId')
    url.searchParams.delete('testId')
    if (classId) url.searchParams.set('classId', classId)
    if (testId) url.searchParams.set('testId', testId)
    window.history.replaceState({}, '', url.toString())
  }

  useEffect(() => {
    if (!ctx) return
    const classIdParam = searchParams.get('classId')
    const testIdParam = searchParams.get('testId')
    if (classIdParam && testIdParam) {
      autoSelectFromUrl(classIdParam, testIdParam)
    } else if (classIdParam) {
      autoSelectFromUrl(classIdParam, '')
    } else {
      loadClasses(ctx.academyId)
    }
  }, [ctx])

  async function autoSelectFromUrl(classIdParam: string, testIdParam: string) {
    setLoading(true)
    const { data: classData } = await supabase
      .from('classes').select('id, name').eq('id', classIdParam).single()
    if (!classData) { setLoading(false); if (ctx) loadClasses(ctx.academyId); return }

    const classItem: ClassItem = { id: classData.id, name: classData.name, test_count: 0 }
    setSelectedClass(classItem)
    setLoading(false)
    setLoadingTests(true)

    const { data: testsData } = await supabase
      .from('tests')
      .select('id, name, max_score, date')
      .eq('class_id', classIdParam)
      .order('date', { ascending: true })

    let testsList: Test[] = []
    if (testsData?.length) {
      const { data: scoresData } = await supabase
        .from('test_scores').select('test_id, student_id, score, absent')
        .in('test_id', testsData.map(t => t.id))
      const byTest = new Map<string, any[]>()
      for (const s of (scoresData ?? [])) {
        if (!byTest.has(s.test_id)) byTest.set(s.test_id, [])
        byTest.get(s.test_id)!.push(s)
      }
      testsList = testsData.map(t => ({
        id: t.id, name: t.name, max_score: t.max_score, date: t.date,
        takers: (byTest.get(t.id) ?? []).length,
        avgScore: computeAvg(byTest.get(t.id) ?? [], t.max_score),
      }))
    }
    setTests(testsList)
    setLoadingTests(false)

    if (!testIdParam) return
    const target = testsList.find(t => t.id === testIdParam)
    if (target) {
      setSelectedTest(target)
      await loadScoresForTest(target, classIdParam)
    }
  }

  async function loadClasses(academyId: string) {
    setLoading(true)

    const { data: classData } = await supabase
      .from('classes').select('id, name').eq('academy_id', academyId).order('name')

    if (!classData?.length) { setClasses([]); setLoading(false); return }

    // 시험 수를 한 번에 조회 (N+1 방지 + embed FK 오류 방지)
    const { data: testsData } = await supabase
      .from('tests').select('class_id').in('class_id', classData.map(c => c.id))

    const countByClass = new Map<string, number>()
    for (const t of (testsData ?? [])) {
      countByClass.set(t.class_id, (countByClass.get(t.class_id) ?? 0) + 1)
    }

    setClasses(classData.map(c => ({
      id: c.id, name: c.name, test_count: countByClass.get(c.id) ?? 0,
    })))
    setLoading(false)
  }

  async function selectClass(c: ClassItem) {
    setSelectedClass(c)
    setSelectedTest(null)
    setUrl(c.id)
    setLoadingTests(true)

    // test_scores embed 대신 별도 조회 (FK 없어도 동작, RLS 오류 방지)
    const { data: testsData } = await supabase
      .from('tests')
      .select('id, name, max_score, date')
      .eq('class_id', c.id)
      .order('date', { ascending: true })

    if (!testsData?.length) { setTests([]); setLoadingTests(false); return }

    const { data: scoresData } = await supabase
      .from('test_scores').select('test_id, student_id, score, absent')
      .in('test_id', testsData.map(t => t.id))

    const byTest = new Map<string, { student_id: string; score: number; absent: boolean }[]>()
    for (const s of (scoresData ?? [])) {
      if (!byTest.has(s.test_id)) byTest.set(s.test_id, [])
      byTest.get(s.test_id)!.push(s)
    }

    const formatted: Test[] = testsData.map(t => {
      const scores = byTest.get(t.id) ?? []
      return {
        id: t.id, name: t.name, max_score: t.max_score, date: t.date,
        takers: scores.length,
        avgScore: computeAvg(scores, t.max_score),
      }
    })

    setTests(formatted)
    setLoadingTests(false)
  }

  async function loadScoresForTest(t: Test, classId: string) {
    setLoadingScores(true)
    // 두 쿼리 병렬 실행
    const [{ data: classStudents }, { data: scoreData }] = await Promise.all([
      supabase.from('class_students').select('students(id, name)').eq('class_id', classId),
      supabase.from('test_scores').select('student_id, score, absent').eq('test_id', t.id),
    ])

    const scoreMap: Record<string, number> = {}
    const absentSet = new Set<string>()
    for (const s of (scoreData ?? [])) {
      if (s.absent) absentSet.add(s.student_id)
      else scoreMap[s.student_id] = s.score
    }

    const list: TestScore[] = ((classStudents ?? []) as any[])
      .map(cs => ({
        student_id: cs.students.id,
        student_name: cs.students.name,
        score: scoreMap[cs.students.id] ?? null,
      }))
      .sort((a, b) => a.student_name.localeCompare(b.student_name))

    setScores(list)
    setAbsentIds(absentSet)
    const initial: Record<string, string> = {}
    for (const s of list) initial[s.student_id] = s.score !== null ? String(s.score) : ''
    setEditScores(initial)
    setLoadingScores(false)
  }

  async function selectTest(t: Test) {
    setSelectedTest(t)
    setUrl(selectedClass!.id, t.id)
    await loadScoresForTest(t, selectedClass!.id)
  }

  function toggleAbsent(studentId: string) {
    setSaved(false)
    setAbsentIds(prev => {
      const next = new Set(prev)
      if (next.has(studentId)) next.delete(studentId)
      else { next.add(studentId); setEditScores(e => ({ ...e, [studentId]: '' })) }
      return next
    })
  }

  async function saveScores() {
    if (!selectedTest) return
    setSaving(true)

    const rows = Object.entries(editScores)
      .filter(([id, v]) => v !== '' && !absentIds.has(id))
      .map(([student_id, v]) => ({ test_id: selectedTest.id, student_id, score: Number(v), absent: false }))
    if (rows.length > 0)
      await supabase.from('test_scores').upsert(rows, { onConflict: 'test_id,student_id' })

    const absentRows = [...absentIds].map(student_id => ({
      test_id: selectedTest.id, student_id, score: 0, absent: true,
    }))
    if (absentRows.length > 0)
      await supabase.from('test_scores').upsert(absentRows, { onConflict: 'test_id,student_id' })

    const clearIds = Object.entries(editScores)
      .filter(([id, v]) => v === '' && !absentIds.has(id))
      .map(([id]) => id)
    if (clearIds.length > 0)
      await supabase.from('test_scores').delete()
        .eq('test_id', selectedTest.id).in('student_id', clearIds)

    await loadScoresForTest(selectedTest, selectedClass!.id)
    setSaving(false); setSaved(true)
  }

  async function checkTestDate(date: string) {
    if (!selectedClass || !date) { setTestDateHasSession(null); return }
    const { data } = await supabase
      .from('sessions')
      .select('id')
      .eq('class_id', selectedClass.id)
      .eq('date', date)
      .limit(1)
    setTestDateHasSession((data ?? []).length > 0)
  }

  async function addTest(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedClass || !testName.trim()) return
    setAddingTest(true)

    await supabase.from('tests').insert({
      class_id: selectedClass.id,
      name: testName.trim(),
      max_score: Number(testMaxScore),
      date: testDate,
    })

    setTestName(''); setTestMaxScore('100')
    setTestDate(new Date().toISOString().slice(0, 10))
    setShowAddTest(false); setAddingTest(false)
    await selectClass(selectedClass)
  }

  async function deleteTest(testId: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('이 시험을 삭제할까요? 모든 점수 데이터가 삭제돼요.')) return
    await supabase.from('tests').delete().eq('id', testId)
    if (selectedTest?.id === testId) setSelectedTest(null)
    await selectClass(selectedClass!)
  }

  const filledNums = scores
    .filter(s => !absentIds.has(s.student_id) && editScores[s.student_id] !== '' && editScores[s.student_id] !== undefined)
    .map(s => Number(editScores[s.student_id]))
  const avg    = filledNums.length > 0 ? filledNums.reduce((a, b) => a + b, 0) / filledNums.length : null
  const maxVal = filledNums.length > 0 ? Math.max(...filledNums) : null
  const minVal = filledNums.length > 0 ? Math.min(...filledNums) : null

  // 취약 학생 (입력된 점수 기준 60% 미만)
  const weakStudents = selectedTest ? scores.filter(s => {
    if (absentIds.has(s.student_id)) return false
    const v = editScores[s.student_id]
    if (!v || v === '') return false
    const p = pct(Number(v), selectedTest.max_score)
    return p !== null && p < 60
  }) : []

  // 차트 데이터 (오름차순 날짜)
  const chartData = tests
    .filter(t => t.avgScore !== null)
    .map(t => ({
      name: t.name.length > 7 ? t.name.slice(0, 7) + '…' : t.name,
      평균: pct(t.avgScore, t.max_score),
    }))

  // ── LEVEL 1: 반 목록 ──
  if (!selectedClass) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          {from && (
            <button onClick={() => router.push(decodeURIComponent(from))}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
              <ChevronLeft size={20} />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-slate-800">성적 관리</h1>
            <p className="text-sm text-slate-500 mt-0.5">반을 선택해서 시험 성적을 관리해요</p>
          </div>
        </div>
        {loading ? (
          <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>
        ) : classes.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-lg mb-1">등록된 반이 없어요</p>
            <p className="text-sm">수업 관리에서 반을 먼저 만들어주세요</p>
          </div>
        ) : (
          <div className="space-y-2">
            {classes.map(c => (
              <button key={c.id} onClick={() => selectClass(c)}
                className="w-full flex items-center gap-4 bg-white rounded-2xl border border-slate-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all text-left">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-emerald-600 font-bold text-lg">{c.name[0]}</span>
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-slate-800">{c.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">시험 {c.test_count}개</p>
                </div>
                <ChevronRight size={16} className="text-slate-300" />
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── LEVEL 2: 시험 목록 ──
  if (!selectedTest) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => { setSelectedClass(null); setUrl(); if (classes.length === 0 && ctx) loadClasses(ctx.academyId) }}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            <ChevronLeft size={20} />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-slate-800">{selectedClass.name}</h1>
            <p className="text-sm text-slate-500 mt-0.5">시험 목록</p>
          </div>
          <button onClick={() => { setTestDateHasSession(null); setShowAddTest(true); checkTestDate(testDate) }}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors text-sm">
            <Plus size={16} /> 시험 추가
          </button>
        </div>

        {loadingTests ? (
          <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>
        ) : tests.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-lg mb-1">아직 시험이 없어요</p>
            <p className="text-sm">시험을 추가하고 학생별 점수를 입력해보세요</p>
          </div>
        ) : (
          <>
            {/* 평균 추이 그래프 */}
            {chartData.length >= 2 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp size={16} className="text-blue-500" />
                  <p className="text-sm font-semibold text-slate-700">시험 평균 추이</p>
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} unit="%" />
                    <Tooltip
                      formatter={(v: any) => [`${v}%`, '평균']}
                      contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                    />
                    <Line
                      type="monotone" dataKey="평균" stroke="#3b82f6" strokeWidth={2.5}
                      dot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* 시험 목록 */}
            <div className="space-y-2">
              {[...tests].reverse().map(t => {
                const avgP = pct(t.avgScore, t.max_score)
                return (
                  <div key={t.id} onClick={() => selectTest(t)}
                    className="flex items-center gap-4 bg-white rounded-2xl border border-slate-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${avgP !== null ? scoreBg(avgP) : 'bg-emerald-50'}`}>
                      <BarChart2 size={20} className={avgP !== null ? scoreColor(avgP) : 'text-emerald-600'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-800">{t.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {t.date} · 만점 {t.max_score}점 · {t.takers}명 입력됨
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {t.avgScore !== null && (
                        <div className="text-right">
                          <p className={`text-base font-bold ${scoreColor(avgP)}`}>{t.avgScore}점</p>
                          {avgP !== null && <p className={`text-xs font-medium ${scoreColor(avgP)}`}>{avgP}%</p>}
                        </div>
                      )}
                      <button onClick={e => deleteTest(t.id, e)}
                        className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                        <Trash2 size={15} />
                      </button>
                      <ChevronRight size={16} className="text-slate-300" />
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {showAddTest && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
            <div className="bg-white rounded-2xl w-full max-w-sm">
              <div className="flex items-center justify-between p-5 border-b border-slate-100">
                <h2 className="font-bold text-slate-800">시험 추가</h2>
                <button onClick={() => setShowAddTest(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
              </div>
              <form onSubmit={addTest} className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">시험 이름 *</label>
                  <input type="text" value={testName} onChange={e => setTestName(e.target.value)}
                    placeholder="예: 4월 단원평가" required autoFocus
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">만점 *</label>
                  <input type="number" value={testMaxScore} onChange={e => setTestMaxScore(e.target.value)}
                    min="1" required
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">날짜</label>
                  <input type="date" value={testDate}
                    onChange={e => { setTestDate(e.target.value); checkTestDate(e.target.value) }}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
                {testDateHasSession === false && (
                  <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                    <span className="text-amber-500 mt-0.5 flex-shrink-0">⚠️</span>
                    <p className="text-xs text-amber-700 leading-relaxed">
                      이날은 등록된 수업이 없어요.<br />
                      추가는 가능하지만, 수업일과 다른 날짜예요.
                    </p>
                  </div>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setShowAddTest(false); setTestDateHasSession(null) }}
                    className="flex-1 py-3 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors">취소</button>
                  <button type="submit" disabled={addingTest}
                    className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50">
                    {addingTest ? '추가 중...' : '추가'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── LEVEL 3: 점수 입력 ──
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => { setSelectedTest(null); setUrl(selectedClass!.id) }}
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-slate-800 truncate">{selectedTest.name}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{selectedTest.date} · 만점 {selectedTest.max_score}점</p>
        </div>
        <button onClick={saveScores} disabled={saving || saved}
          className={`px-4 py-2.5 font-semibold rounded-xl transition-colors text-sm flex-shrink-0 ${saved ? 'bg-emerald-100 text-emerald-700 cursor-default' : saving ? 'bg-blue-600 text-white opacity-50 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
          {saving ? '저장 중...' : saved ? '저장됨 ✓' : '저장'}
        </button>
      </div>

      {/* 통계 카드 */}
      {filledNums.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: '평균', val: avg !== null ? Math.round(avg) : null },
            { label: '최고', val: maxVal },
            { label: '최저', val: minVal },
          ].map(({ label, val }) => {
            const p = pct(val, selectedTest.max_score)
            return (
              <div key={label} className={`rounded-2xl border border-slate-200 p-4 text-center ${scoreBg(p)}`}>
                <p className="text-xs text-slate-400 mb-1">{label}</p>
                <p className={`text-2xl font-bold ${scoreColor(p)}`}>
                  {val ?? '-'}<span className="text-sm font-normal text-slate-400">점</span>
                </p>
                {p !== null && <p className={`text-xs mt-0.5 font-medium ${scoreColor(p)}`}>{p}%</p>}
              </div>
            )
          })}
        </div>
      )}

      {/* 취약 학생 배너 */}
      {weakStudents.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={15} className="text-red-500 flex-shrink-0" />
            <p className="text-sm font-semibold text-red-700">성적 취약 학생 — 60% 미만 ({weakStudents.length}명)</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {weakStudents.map(s => {
              const v = editScores[s.student_id]
              const p = pct(Number(v), selectedTest.max_score)
              return (
                <div key={s.student_id} className="flex items-center justify-between bg-white rounded-xl px-3 py-2 border border-red-100">
                  <span className="text-sm text-slate-700 font-medium truncate">{s.student_name}</span>
                  <span className="text-sm font-bold text-red-500 ml-2 flex-shrink-0">{p}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 점수 미입력 경고 */}
      {(() => {
        const missingCount = scores.filter(s => !absentIds.has(s.student_id) && (editScores[s.student_id] ?? '') === '').length
        return missingCount > 0 ? (
          <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-2xl text-sm text-amber-700">
            <AlertTriangle size={16} className="flex-shrink-0" />
            <span>응시 학생 중 <strong>{missingCount}명</strong>의 점수가 입력되지 않았어요</span>
          </div>
        ) : null
      })()}

      {/* 점수 목록 */}
      {loadingScores ? (
        <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>
      ) : scores.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-lg mb-1">배정된 학생이 없어요</p>
          <p className="text-sm">수업 관리에서 학생을 먼저 배정해주세요</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="divide-y divide-slate-100">
            {scores.map(s => {
              const v = editScores[s.student_id] ?? ''
              const isAbsent = absentIds.has(s.student_id)
              const p = !isAbsent && v !== '' ? pct(Number(v), selectedTest.max_score) : null
              return (
                <div key={s.student_id} className={`flex items-center gap-3 px-4 py-3 ${isAbsent ? 'bg-slate-50' : ''}`}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${isAbsent ? 'bg-slate-100' : p !== null ? scoreBg(p) : 'bg-emerald-50'}`}>
                    <span className={`font-bold text-sm ${isAbsent ? 'text-slate-400' : p !== null ? scoreColor(p) : 'text-emerald-600'}`}>{s.student_name[0]}</span>
                  </div>
                  <p className={`flex-1 font-medium text-sm ${isAbsent ? 'text-slate-400' : 'text-slate-800'}`}>{s.student_name}</p>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
                      <button
                        onClick={() => isAbsent && toggleAbsent(s.student_id)}
                        className={`px-2.5 py-1.5 font-medium transition-colors ${!isAbsent ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-50'}`}
                      >응시</button>
                      <button
                        onClick={() => !isAbsent && toggleAbsent(s.student_id)}
                        className={`px-2.5 py-1.5 font-medium transition-colors border-l border-slate-200 ${isAbsent ? 'bg-slate-400 text-white' : 'text-slate-400 hover:bg-slate-50'}`}
                      >미응시</button>
                    </div>
                    {!isAbsent ? (
                      <div className="flex items-center gap-1">
                        {p !== null && (
                          <span className={`text-xs font-semibold w-10 text-right ${scoreColor(p)}`}>{p}%</span>
                        )}
                        <input
                          type="number"
                          value={v}
                          onChange={e => {
                            const val = e.target.value
                            if (val !== '' && (Number(val) > selectedTest.max_score || Number(val) < 0)) return
                            setSaved(false)
                            setEditScores(prev => ({ ...prev, [s.student_id]: val }))
                          }}
                          placeholder="-"
                          min="0"
                          max={selectedTest.max_score}
                          className={`w-16 px-2 py-1.5 rounded-lg border text-sm text-slate-800 text-center focus:outline-none focus:ring-2 focus:border-transparent ${v === '' ? 'border-amber-300 bg-amber-50 focus:ring-amber-400' : 'border-slate-200 focus:ring-blue-500'}`}
                        />
                        <span className="text-xs text-slate-400">/ {selectedTest.max_score}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 w-28 text-right">미응시</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function GradesPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="text-slate-400 text-sm">불러오는 중...</div></div>}>
      <GradesContent />
    </Suspense>
  )
}
