'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CheckCircle, XCircle, Clock, Building2 } from 'lucide-react'

type Academy = {
  id: string
  name: string
  status: string
  created_at: string
  profiles: { name: string; phone: string } | null
}

export default function AdminPage() {
  const [academies, setAcademies] = useState<Academy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [token, setToken] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const t = data.session?.access_token ?? ''
      setToken(t)
      if (t) load(t)
      else setError('로그인이 필요합니다.')
    })
  }, [])

  async function load(t: string) {
    setLoading(true)
    const res = await fetch('/api/admin', { headers: { Authorization: `Bearer ${t}` } })
    if (res.status === 403) { setError('관리자 권한이 없습니다.'); setLoading(false); return }
    const data = await res.json()
    setAcademies(data)
    setLoading(false)
  }

  async function handle(academyId: string, status: 'approved' | 'rejected') {
    await fetch('/api/admin', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ academyId, status }),
    })
    load(token)
  }

  const pending = academies.filter(a => a.status === 'pending')
  const others = academies.filter(a => a.status !== 'pending')

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-500">로딩 중...</div>
  if (error) return <div className="min-h-screen flex items-center justify-center text-red-500">{error}</div>

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Linkademy 관리자</h1>
        <p className="text-slate-500 text-sm mb-8">학원 가입 승인 관리</p>

        {/* 승인 대기 */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <Clock size={14} /> 승인 대기 ({pending.length})
          </h2>
          {pending.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-slate-400 text-sm">
              대기 중인 신청이 없어요
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map(a => (
                <div key={a.id} className="bg-white rounded-xl border border-amber-200 p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                      <Building2 size={18} className="text-amber-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-800">{a.name}</p>
                      <p className="text-xs text-slate-500">
                        {a.profiles?.name} · {a.profiles?.phone} · {new Date(a.created_at).toLocaleDateString('ko-KR')}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => handle(a.id, 'approved')}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
                    >
                      <CheckCircle size={14} /> 승인
                    </button>
                    <button
                      onClick={() => handle(a.id, 'rejected')}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-600 text-sm font-medium rounded-lg hover:bg-red-200 transition-colors"
                    >
                      <XCircle size={14} /> 거절
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 기존 학원 */}
        <section>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
            전체 학원 ({others.length})
          </h2>
          <div className="space-y-2">
            {others.map(a => (
              <div key={a.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-800">{a.name}</p>
                  <p className="text-xs text-slate-500">{a.profiles?.name} · {new Date(a.created_at).toLocaleDateString('ko-KR')}</p>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                  a.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                }`}>
                  {a.status === 'approved' ? '승인됨' : '거절됨'}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
