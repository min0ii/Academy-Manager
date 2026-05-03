'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  ChevronLeft, ChevronRight, Clock, CheckCircle2, AlertTriangle, Send,
  ClipboardList, X,
} from 'lucide-react'

type AvailableExam = {
  id: string
  title: string
  status: string   // 'scheduled' | 'active'
  start_at: string | null
  end_at: string | null
  answer_reveal: 'immediate' | 'after_close'
  no_deadline: boolean
  isSubmitted: boolean
}

type Question = {
  id: string
  order_num: number
  question_text: string | null
  question_type: 'multiple_choice' | 'short_answer'
  score: number
}
type Choice = { id: string; question_id: string; choice_num: number; choice_text: string | null }
type CorrectAnswer = { question_id: string; answer_text: string }

type ExamDetail = {
  exam: { id: string; title: string; start_at: string | null; end_at: string | null; status: string; answer_reveal: string }
  questions: Question[]
  choices: Choice[]
  answers: CorrectAnswer[]
}

type ClassStats = {
  classCount: number
  classAvg: number | null
  classHigh: number | null
  classLow: number | null
}

type SubmitResult = {
  totalScore: number
  maxScore: number
  noDeadline?: boolean
  classStats?: ClassStats | null
  answers: { questionId: string; studentAnswer: string | null; isCorrect: boolean; scoreEarned: number }[]
}

// ── Utilities ──────────────────────────────────────────────────────────────

function fmtCountdown(secs: number): string {
  if (secs <= 0) return '00:00:00'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':')
}

function fmtDT(dt: string | null): string {
  if (!dt) return '-'
  const d = new Date(dt)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${mm}/${dd} ${hh}:${min}`
}

// ── Main ExamTab Component ──────────────────────────────────────────────────

export default function ExamTab({
  classId, studentId,
}: {
  classId: string | null
  studentId: string | null
}) {
  const [examList, setExamList] = useState<AvailableExam[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listLoaded, setListLoaded] = useState(false)

  // Solving state
  const [view, setView] = useState<'list' | 'solving' | 'result'>('list')
  const [examDetail, setExamDetail] = useState<ExamDetail | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  const [loadingSolve, setLoadingSolve] = useState(false)

  // View mode: omr=grid, step=one-by-one
  const [solveMode, setSolveMode] = useState<'omr' | 'step'>('omr')
  const [stepIdx, setStepIdx] = useState(0)

  // Countdown
  const [secsLeft, setSecsLeft] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Debounce for SA
  const saDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // Submit
  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const [showForfeitModal, setShowForfeitModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [forfeiting, setForfeiting] = useState(false)
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null)

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }

  // Load exam list on mount or when classId changes
  useEffect(() => {
    if (!classId || listLoaded) return
    loadExamList()
  }, [classId])

  async function loadExamList() {
    if (!classId) return
    setListLoading(true)
    const token = await getToken()
    if (!token) { setListLoading(false); return }
    const res = await fetch(`/api/exams/student-list?classId=${classId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json()
    setExamList(json.exams ?? [])
    setListLoaded(true)
    setListLoading(false)
  }

  // Countdown timer
  useEffect(() => {
    if (!examDetail?.exam.end_at) return
    function tick() {
      const secs = Math.max(0, Math.floor((new Date(examDetail!.exam.end_at!).getTime() - Date.now()) / 1000))
      setSecsLeft(secs)
    }
    tick()
    timerRef.current = setInterval(tick, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [examDetail?.exam.end_at])

  const isExpired = secsLeft !== null && secsLeft <= 0

  async function openExam(exam: AvailableExam) {
    if (exam.status === 'scheduled') return   // 준비중이면 아무것도 안 함
    setLoadingSolve(true)
    setView('solving')
    setStepIdx(0)
    setSolveMode('omr')
    setSubmitResult(null)

    const token = await getToken()
    if (!token) { setLoadingSolve(false); return }

    // Load questions
    const [qRes, draftRes] = await Promise.all([
      fetch(`/api/exams/${exam.id}/questions`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`/api/exams/${exam.id}/draft`, { headers: { Authorization: `Bearer ${token}` } }),
    ])

    const qJson = await qRes.json()
    const draftJson = await draftRes.json()

    if (draftJson.alreadySubmitted) {
      // Already submitted, show from result side
      setView('list')
      await loadExamList()
      setLoadingSolve(false)
      return
    }

    setExamDetail(qJson)
    setAnswers(draftJson.answers ?? {})
    setSubmissionId(draftJson.submissionId ?? null)
    setLoadingSolve(false)
  }

  // Save a single answer (MC: immediate, SA: debounced 1.5s)
  const saveAnswer = useCallback(async (questionId: string, answer: string, qType: 'multiple_choice' | 'short_answer') => {
    if (!examDetail) return
    const examId = examDetail.exam.id
    const token = await getToken()
    if (!token) return

    async function doSave() {
      const res = await fetch(`/api/exams/${examId}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token!}` },
        body: JSON.stringify({ questionId, answer }),
      })
      const json = await res.json()
      if (json.submissionId && !submissionId) setSubmissionId(json.submissionId)
    }

    if (qType === 'multiple_choice') {
      await doSave()
    } else {
      // Debounce SA
      if (saDebounceRef.current[questionId]) clearTimeout(saDebounceRef.current[questionId])
      saDebounceRef.current[questionId] = setTimeout(doSave, 1500)
    }
  }, [examDetail, submissionId])

  function handleAnswer(questionId: string, answer: string, qType: 'multiple_choice' | 'short_answer') {
    setAnswers(prev => ({ ...prev, [questionId]: answer }))
    if (!isExpired) saveAnswer(questionId, answer, qType)
  }

  async function submitExam() {
    if (!examDetail) return
    setSubmitting(true)
    const token = await getToken()
    if (!token) { setSubmitting(false); return }

    const res = await fetch(`/api/exams/${examDetail.exam.id}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json()
    setSubmitting(false)

    if (res.ok) {
      setSubmitResult(json)
      setView('result')
      if (timerRef.current) clearInterval(timerRef.current)
      await loadExamList()
    }
    setShowSubmitModal(false)
  }

  async function forfeitExam() {
    if (!examDetail) return
    setForfeiting(true)
    const token = await getToken()
    if (!token) { setForfeiting(false); return }
    await fetch(`/api/exams/${examDetail.exam.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'forfeit' }),
    })
    setForfeiting(false)
    setShowForfeitModal(false)
    setView('list')
    if (timerRef.current) clearInterval(timerRef.current)
    await loadExamList()
  }

  // ── No class ──────────────────────────────────────────────────────────────
  if (!classId || !studentId) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
        <p className="text-slate-400 text-sm">아직 배정된 반이 없어요</p>
        <p className="text-slate-300 text-xs mt-1">선생님께 문의해 주세요</p>
      </div>
    )
  }

  // ── Result screen ─────────────────────────────────────────────────────────
  if (view === 'result' && submitResult && examDetail) {
    const pct = submitResult.maxScore > 0
      ? Math.round((submitResult.totalScore / submitResult.maxScore) * 100) : 0
    const color = pct >= 80 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-600' : 'text-red-500'
    const cs = submitResult.classStats

    return (
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center space-y-3">
          <CheckCircle2 size={40} className="text-emerald-500 mx-auto" />
          <div>
            <p className="font-bold text-slate-800 text-lg">{examDetail.exam.title}</p>
            <p className="text-sm text-slate-400 mt-0.5">제출 완료</p>
          </div>
          <div className="pt-2">
            <p className={`text-5xl font-black ${color}`}>{submitResult.totalScore}</p>
            <p className="text-slate-400 text-sm mt-1">/ {submitResult.maxScore}점 ({pct}%)</p>
          </div>
        </div>

        {/* 마감없는 시험: 실시간 반 통계 */}
        {submitResult.noDeadline && cs && cs.classCount > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 mb-3">현재 반 통계 ({cs.classCount}명 제출)</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { label: '평균', val: cs.classAvg !== null ? cs.classAvg.toFixed(1) : '-' },
                { label: '최고', val: cs.classHigh !== null ? String(cs.classHigh) : '-' },
                { label: '최저', val: cs.classLow !== null ? String(cs.classLow) : '-' },
              ].map(({ label, val }) => (
                <div key={label}>
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className="text-lg font-bold text-slate-800 mt-0.5">{val}<span className="text-xs font-normal text-slate-400">점</span></p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Per-question results */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-700">문항별 결과</p>
          </div>
          <div className="divide-y divide-slate-100">
            {examDetail.questions.map((q, idx) => {
              const r = submitResult.answers.find(a => a.questionId === q.id)
              const qChoices = examDetail.choices.filter(c => c.question_id === q.id)
              const choiceText = qChoices.find(c => String(c.choice_num) === r?.studentAnswer)?.choice_text
              return (
                <div key={q.id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${r?.isCorrect ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-500'}`}>
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      {q.question_text && <p className="text-xs text-slate-500 mb-1">{q.question_text}</p>}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r?.isCorrect ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                          {r?.isCorrect ? '정답' : '오답'}
                        </span>
                        {r?.studentAnswer ? (
                          <span className="text-xs text-slate-500">
                            내 답: {q.question_type === 'multiple_choice' && choiceText ? `${r.studentAnswer}번 ${choiceText}` : r.studentAnswer}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">미답</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-bold ${r?.isCorrect ? 'text-emerald-600' : 'text-slate-400'}`}>{r?.scoreEarned ?? 0}</p>
                      <p className="text-xs text-slate-400">/ {q.score}점</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <button onClick={() => setView('list')}
          className="w-full py-3 bg-slate-100 text-slate-600 font-semibold rounded-2xl hover:bg-slate-200 transition-colors">
          목록으로
        </button>
      </div>
    )
  }

  // ── Solving screen ────────────────────────────────────────────────────────
  if (view === 'solving') {
    if (loadingSolve) {
      return <div className="text-center py-16 text-slate-400 text-sm">시험 불러오는 중...</div>
    }
    if (!examDetail) {
      return (
        <div className="text-center py-16 text-slate-400">
          <p>시험을 불러올 수 없어요.</p>
          <button onClick={() => setView('list')} className="mt-3 text-sm text-blue-500">목록으로</button>
        </div>
      )
    }

    const qs = examDetail.questions
    const totalAnswered = qs.filter(q => answers[q.id]?.trim()).length
    const unanswered = qs.length - totalAnswered

    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => { setView('list'); if (timerRef.current) clearInterval(timerRef.current) }}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors flex-shrink-0">
            <ChevronLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-slate-800 text-sm truncate">{examDetail.exam.title}</p>
            <p className="text-xs text-slate-400">{totalAnswered}/{qs.length} 문제 답변됨</p>
          </div>
          {secsLeft !== null && (
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl flex-shrink-0 font-mono text-sm font-bold ${secsLeft <= 60 ? 'bg-red-50 text-red-500 animate-pulse' : secsLeft <= 300 ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-700'}`}>
              <Clock size={13} />
              {fmtCountdown(secsLeft)}
            </div>
          )}
        </div>

        {/* Expired banner */}
        {isExpired && (
          <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700">
            <AlertTriangle size={16} className="flex-shrink-0" />
            <span>시간이 종료됐어요. 답안 입력이 잠겼어요.</span>
          </div>
        )}

        {/* Mode toggle */}
        <div className="flex rounded-xl border border-slate-200 overflow-hidden bg-white">
          {([{ val: 'omr', label: 'OMR 그리드' }, { val: 'step', label: '문제별 보기' }] as const).map(({ val, label }) => (
            <button key={val} onClick={() => setSolveMode(val)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${solveMode === val ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* OMR Grid mode */}
        {solveMode === 'omr' && (
          <div className="space-y-3">
            {qs.map((q, idx) => {
              const qChoices = examDetail.choices.filter(c => c.question_id === q.id).sort((a, b) => a.choice_num - b.choice_num)
              const currentAns = answers[q.id] ?? ''

              return (
                <div key={q.id} className="bg-white rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start gap-3 mb-3">
                    <span className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${currentAns ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                      {idx + 1}
                    </span>
                    <div className="flex-1">
                      {q.question_text && <p className="text-sm text-slate-700 leading-relaxed">{q.question_text}</p>}
                      {!q.question_text && <p className="text-sm text-slate-400">{idx + 1}번 문제</p>}
                    </div>
                    <span className="text-xs text-slate-400 flex-shrink-0">{q.score}점</span>
                  </div>

                  {q.question_type === 'multiple_choice' ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {qChoices.map(c => (
                        <button key={c.id}
                          onClick={() => !isExpired && handleAnswer(q.id, String(c.choice_num), 'multiple_choice')}
                          disabled={isExpired}
                          className={`px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all text-left disabled:opacity-60 ${currentAns === String(c.choice_num) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:border-blue-300'}`}>
                          <span className="font-bold mr-1.5">{c.choice_num}.</span>
                          {c.choice_text || `선택지 ${c.choice_num}`}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={currentAns}
                      onChange={e => handleAnswer(q.id, e.target.value, 'short_answer')}
                      disabled={isExpired}
                      placeholder="답 입력..."
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Step mode */}
        {solveMode === 'step' && qs.length > 0 && (
          <div className="space-y-3">
            {(() => {
              const q = qs[stepIdx]
              const qChoices = examDetail.choices.filter(c => c.question_id === q.id).sort((a, b) => a.choice_num - b.choice_num)
              const currentAns = answers[q.id] ?? ''

              return (
                <>
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400 font-medium">{stepIdx + 1} / {qs.length}</span>
                      <span className="text-xs bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full font-medium">
                        {q.question_type === 'multiple_choice' ? '객관식' : '주관식'} · {q.score}점
                      </span>
                    </div>

                    {q.question_text ? (
                      <p className="text-base text-slate-800 leading-relaxed font-medium">{q.question_text}</p>
                    ) : (
                      <p className="text-base text-slate-800 font-medium">{stepIdx + 1}번 문제</p>
                    )}

                    {q.question_type === 'multiple_choice' ? (
                      <div className="space-y-2">
                        {qChoices.map(c => (
                          <button key={c.id}
                            onClick={() => !isExpired && handleAnswer(q.id, String(c.choice_num), 'multiple_choice')}
                            disabled={isExpired}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all disabled:opacity-60 ${currentAns === String(c.choice_num) ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-blue-300'}`}>
                            <span className={`w-7 h-7 rounded-full text-sm font-bold flex items-center justify-center flex-shrink-0 ${currentAns === String(c.choice_num) ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                              {c.choice_num}
                            </span>
                            <span className={`text-sm ${currentAns === String(c.choice_num) ? 'text-blue-700 font-medium' : 'text-slate-700'}`}>
                              {c.choice_text || `선택지 ${c.choice_num}`}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={currentAns}
                        onChange={e => handleAnswer(q.id, e.target.value, 'short_answer')}
                        disabled={isExpired}
                        placeholder="답 입력..."
                        className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-0 focus:border-blue-500 disabled:bg-slate-50"
                        autoFocus
                      />
                    )}
                  </div>

                  {/* Prev / Next nav */}
                  <div className="flex gap-3">
                    <button onClick={() => setStepIdx(i => Math.max(0, i - 1))} disabled={stepIdx === 0}
                      className="flex-1 py-3 border border-slate-200 text-slate-600 font-semibold rounded-xl disabled:opacity-30 hover:bg-slate-50 transition-colors flex items-center justify-center gap-1">
                      <ChevronLeft size={16} /> 이전
                    </button>
                    {stepIdx < qs.length - 1 ? (
                      <button onClick={() => setStepIdx(i => Math.min(qs.length - 1, i + 1))}
                        className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors flex items-center justify-center gap-1">
                        다음 <ChevronRight size={16} />
                      </button>
                    ) : (
                      <button onClick={() => setSolveMode('omr')}
                        className="flex-1 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors">
                        답안 확인
                      </button>
                    )}
                  </div>

                  {/* Quick jump dots */}
                  <div className="flex flex-wrap gap-1.5 justify-center">
                    {qs.map((qq, qi) => (
                      <button key={qq.id} onClick={() => setStepIdx(qi)}
                        className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors ${qi === stepIdx ? 'bg-blue-600 text-white' : answers[qq.id]?.trim() ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
                        {qi + 1}
                      </button>
                    ))}
                  </div>
                </>
              )
            })()}
          </div>
        )}

        {/* Submit / Forfeit buttons */}
        {!isExpired && (
          <div className="space-y-2">
            <button onClick={() => setShowSubmitModal(true)}
              className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 text-base">
              <Send size={18} />
              최종 제출하기
            </button>
            <button onClick={() => setShowForfeitModal(true)}
              className="w-full py-2.5 text-slate-400 text-sm hover:text-orange-500 transition-colors">
              시험 포기
            </button>
          </div>
        )}

        {/* Forfeit confirm modal */}
        {showForfeitModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
            <div className="bg-white rounded-2xl w-full max-w-sm">
              <div className="flex items-center justify-between p-5 border-b border-slate-100">
                <h2 className="font-bold text-slate-800">시험 포기</h2>
                <button onClick={() => setShowForfeitModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex items-start gap-3 px-4 py-3 bg-orange-50 border border-orange-200 rounded-xl">
                  <AlertTriangle size={18} className="text-orange-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-orange-700 leading-relaxed">
                    포기하면 <strong>다시 응시할 수 없어요.</strong><br />
                    선생님과 학부모 앱에 <strong>시험 포기</strong>로 표시돼요.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowForfeitModal(false)}
                    className="flex-1 py-3 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50">취소</button>
                  <button onClick={forfeitExam} disabled={forfeiting}
                    className="flex-1 py-3 bg-orange-500 text-white font-semibold rounded-xl hover:bg-orange-600 disabled:opacity-50">
                    {forfeiting ? '처리 중...' : '시험 포기'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Submit confirm modal */}
        {showSubmitModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
            <div className="bg-white rounded-2xl w-full max-w-sm">
              <div className="flex items-center justify-between p-5 border-b border-slate-100">
                <h2 className="font-bold text-slate-800">최종 제출</h2>
                <button onClick={() => setShowSubmitModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
              </div>
              <div className="p-5 space-y-4">
                {unanswered > 0 && (
                  <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
                    <AlertTriangle size={16} className="flex-shrink-0" />
                    <span><strong>{unanswered}문제</strong>가 아직 미입력이에요</span>
                  </div>
                )}
                <p className="text-sm text-slate-600 leading-relaxed">
                  제출하면 수정할 수 없어요.<br />
                  <strong>{totalAnswered}</strong>/{qs.length}문제 입력 완료 상태로 제출할까요?
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setShowSubmitModal(false)}
                    className="flex-1 py-3 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50">취소</button>
                  <button onClick={submitExam} disabled={submitting}
                    className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50">
                    {submitting ? '제출 중...' : '제출'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Exam list screen ──────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-slate-800 text-sm">답안 제출</h2>
        <button onClick={loadExamList} className="text-xs text-blue-500 hover:text-blue-700 font-medium">새로고침</button>
      </div>

      {listLoading ? (
        <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>
      ) : examList.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto">
            <ClipboardList size={24} className="text-slate-400" />
          </div>
          <div>
            <p className="font-semibold text-slate-700">출제된 시험이 없어요</p>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">선생님이 시험을 출제하면<br />이곳에 표시돼요</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {examList.map(exam => {
            const endSecs = exam.end_at ? Math.max(0, Math.floor((new Date(exam.end_at).getTime() - Date.now()) / 1000)) : null
            const isScheduled = exam.status === 'scheduled'
            const isActive = exam.status === 'active'

            let cardClass = 'bg-white rounded-2xl border border-slate-200 p-4 transition-all '
            if (exam.isSubmitted) cardClass += 'opacity-60 cursor-default'
            else if (isScheduled) cardClass += 'opacity-70 cursor-default'
            else cardClass += 'hover:border-blue-300 hover:shadow-sm cursor-pointer'

            let iconBg = 'bg-blue-100'
            if (exam.isSubmitted) iconBg = 'bg-emerald-100'
            else if (isScheduled) iconBg = 'bg-slate-100'

            let iconEl = <ClipboardList size={18} className="text-blue-600" />
            if (exam.isSubmitted) iconEl = <CheckCircle2 size={18} className="text-emerald-600" />
            else if (isScheduled) iconEl = <ClipboardList size={18} className="text-slate-400" />

            let dateText = ''
            if (isScheduled) dateText = '시작 전'
            else if (isActive && exam.end_at) dateText = `마감: ${fmtDT(exam.end_at)}`
            else if (isActive) dateText = '진행중'

            return (
              <div key={exam.id}
                onClick={() => !exam.isSubmitted && !isScheduled && openExam(exam)}
                className={cardClass}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
                    {iconEl}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 text-sm">{exam.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{dateText}</p>
                  </div>
                  {exam.isSubmitted ? (
                    <span className="text-xs bg-emerald-50 text-emerald-600 font-semibold px-2.5 py-1 rounded-full flex-shrink-0">제출완료</span>
                  ) : isScheduled ? (
                    <span className="text-xs bg-slate-100 text-slate-500 font-semibold px-2.5 py-1 rounded-full flex-shrink-0">준비중</span>
                  ) : endSecs !== null && endSecs <= 300 ? (
                    <span className="text-xs bg-red-50 text-red-500 font-semibold px-2.5 py-1 rounded-full flex-shrink-0 animate-pulse">{fmtCountdown(endSecs)}</span>
                  ) : endSecs !== null ? (
                    <span className="text-xs bg-blue-50 text-blue-600 font-mono font-bold px-2.5 py-1 rounded-full flex-shrink-0">{fmtCountdown(endSecs)}</span>
                  ) : (
                    <span className="text-xs bg-blue-50 text-blue-600 font-semibold px-2.5 py-1 rounded-full flex-shrink-0">진행중</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
