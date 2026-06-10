'use client'

import { useEffect, useState } from 'react'
import { useAcademy } from '@/lib/academy-context'
import { supabase } from '@/lib/supabase'
import { HelpCircle, ChevronDown, Send, RefreshCw } from 'lucide-react'

type Reply = {
  id: string; body: string; created_at: string; teacher_id: string; teacherName: string
}
type InquiryItem = {
  id: string; exam_id: string; examTitle: string; examClass: string; body: string; created_at: string
  question_id: string | null
  exam_questions: { order_num: number; question_text: string | null } | null
  students: { id: string; name: string } | null
  exam_inquiry_replies: Reply[]
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '방금 전'
  if (mins < 60) return `${mins}분 전`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}시간 전`
  return `${Math.floor(hrs / 24)}일 전`
}

export default function ExamInquiryWidget() {
  const ctx = useAcademy()
  const [open, setOpen]         = useState(false)
  const [items, setItems]       = useState<InquiryItem[]>([])
  const [loading, setLoading]   = useState(false)
  const [filter, setFilter]     = useState<'unanswered' | 'all'>('unanswered')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [replyInputs, setReplyInputs] = useState<Record<string, string>>({})
  const [sending, setSending]   = useState<string | null>(null)

  async function load() {
    if (!ctx?.academyId) return
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { setLoading(false); return }
    const res = await fetch(`/api/exam-inquiries?academyId=${ctx.academyId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const { inquiries } = await res.json()
      setItems(inquiries ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    if (open && ctx?.academyId) load()
  }, [open, ctx?.academyId])

  async function sendReply(inquiryId: string) {
    const text = (replyInputs[inquiryId] ?? '').trim()
    if (!text) return
    setSending(inquiryId)
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { setSending(null); return }
    const res = await fetch(`/api/exam-inquiries/${inquiryId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ body: text }),
    })
    if (res.ok) {
      const { reply } = await res.json()
      setItems(prev => prev.map(item =>
        item.id === inquiryId
          ? { ...item, exam_inquiry_replies: [...item.exam_inquiry_replies, reply] }
          : item
      ))
      setReplyInputs(prev => ({ ...prev, [inquiryId]: '' }))
    }
    setSending(null)
  }

  const unansweredCount = items.filter(i => i.exam_inquiry_replies.length === 0).length
  const filtered = filter === 'unanswered'
    ? items.filter(i => i.exam_inquiry_replies.length === 0)
    : items

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* 헤더 */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-50 rounded-xl flex-shrink-0">
            <HelpCircle size={18} className="text-amber-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-slate-800 text-sm">시험 질문</p>
              {unansweredCount > 0 && !open && (
                <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
                  {unansweredCount}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {unansweredCount > 0 && !open ? `미답변 ${unansweredCount}건이 있어요` : '학생 시험 질문 확인'}
            </p>
          </div>
        </div>
        <ChevronDown
          size={18}
          className={`text-slate-400 transition-transform duration-300 flex-shrink-0 ml-3 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* 본문 */}
      <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="border-t border-slate-100 px-5 pb-6 pt-4 space-y-4">

            {/* 필터 + 새로고침 */}
            <div className="flex items-center gap-2">
              {(['unanswered', 'all'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                    filter === f
                      ? f === 'unanswered' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                      : 'text-slate-500 hover:bg-slate-100'
                  }`}>
                  {f === 'unanswered' ? '미답변만' : '전체'}
                </button>
              ))}
              <button onClick={load} className="ml-auto p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* 목록 */}
            {loading ? (
              <p className="text-center text-sm text-slate-400 py-6">불러오는 중...</p>
            ) : filtered.length === 0 ? (
              <p className="text-center text-sm text-slate-400 py-6">
                {filter === 'unanswered' ? '미답변 질문이 없어요 🎉' : '아직 질문이 없어요'}
              </p>
            ) : (
              <div className="space-y-2">
                {filtered.map(item => {
                  const isExpanded = expanded.has(item.id)
                  const qLabel = item.question_id && item.exam_questions
                    ? `${item.exam_questions.order_num}번 문제`
                    : '일반 질문'
                  const isAnswered = item.exam_inquiry_replies.length > 0

                  return (
                    <div key={item.id} className="border border-slate-200 rounded-xl overflow-hidden">
                      {/* 질문 요약 헤더 */}
                      <button
                        onClick={() => setExpanded(prev => {
                          const n = new Set(prev)
                          n.has(item.id) ? n.delete(item.id) : n.add(item.id)
                          return n
                        })}
                        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            <span className="font-semibold text-slate-800 text-sm">{item.students?.name ?? '학생'}</span>
                            {item.examClass && (
                              <>
                                <span className="text-slate-300">·</span>
                                <span className="text-xs text-slate-500">{item.examClass}</span>
                              </>
                            )}
                            <span className="text-slate-300">·</span>
                            <span className="text-xs text-slate-500 truncate max-w-[100px]">{item.examTitle}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${item.question_id ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                              {qLabel}
                            </span>
                          </div>
                          <p className="text-sm text-slate-700 line-clamp-2">{item.body}</p>
                          <p className="text-xs text-slate-400 mt-1">{timeAgo(item.created_at)}</p>
                        </div>
                        <div className="flex-shrink-0 flex flex-col items-end gap-1 ml-2">
                          {isAnswered
                            ? <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">답변 {item.exam_inquiry_replies.length}</span>
                            : <span className="text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded-full font-medium">미답변</span>
                          }
                          <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </button>

                      {/* 질문 전문 + 답변 스레드 + 입력 */}
                      {isExpanded && (
                        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 space-y-3">
                          {/* 맥락 정보 */}
                          <p className="text-xs text-slate-400">
                            {[item.examClass, item.examTitle, qLabel].filter(Boolean).join(' · ')}
                          </p>
                          {/* 학생 질문 (말풍선) */}
                          <div className="flex flex-col gap-0.5">
                            <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-3 py-2.5 text-sm text-slate-700 max-w-[85%] self-start">
                              {item.body}
                            </div>
                            <p className="text-xs text-slate-400 pl-1">{item.students?.name ?? '학생'}</p>
                          </div>

                          {/* 기존 답변들 */}
                          {item.exam_inquiry_replies.map(reply => (
                            <div key={reply.id} className="flex flex-col items-end gap-0.5">
                              <div className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-3 py-2.5 text-sm max-w-[85%]">
                                {reply.body}
                              </div>
                              <p className="text-xs text-slate-400 pr-1">{reply.teacherName} · {timeAgo(reply.created_at)}</p>
                            </div>
                          ))}

                          {/* 답변 입력 */}
                          <div className="flex gap-2">
                            <input
                              value={replyInputs[item.id] ?? ''}
                              onChange={e => setReplyInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendReply(item.id)}
                              placeholder="답변 입력..."
                              className="flex-1 text-sm px-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <button
                              onClick={() => sendReply(item.id)}
                              disabled={sending === item.id || !(replyInputs[item.id] ?? '').trim()}
                              className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 flex-shrink-0 transition-colors"
                            >
                              <Send size={16} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
