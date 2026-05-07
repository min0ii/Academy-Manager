'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CheckCircle, XCircle, Clock, User } from 'lucide-react'

type Profile = {
  id: string
  name: string
  phone: string
  status: string
  created_at: string
}

export default function AdminPage() {
  const [profiles, setProfiles] = useState<Profile[]>([])
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
    setProfiles(await res.json())
    setLoading(false)
  }

  async function handle(profileId: string, status: 'approved' | 'rejected') {
    await fetch('/api/admin', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ profileId, status }),
    })
    load(token)
  }

  const pending = profiles.filter(p => !p.status || p.status === 'pending')
  const others = profiles.filter(p => p.status && p.status !== 'pending')

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-500">로딩 중...</div>
  if (error) return <div className="min-h-screen flex items-center justify-center text-red-500">{error}</div>

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Linkademy 관리자</h1>
        <p className="text-slate-500 text-sm mb-8">원장 계정 가입 승인 관리</p>

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
              {pending.map(p => (
                <div key={p.id} className="bg-white rounded-xl border border-amber-200 p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                      <User size={18} className="text-amber-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-800">{p.name}</p>
                      <p className="text-xs text-slate-500">
                        {p.phone} · {new Date(p.created_at).toLocaleDateString('ko-KR')}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => handle(p.id, 'approved')}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
                    >
                      <CheckCircle size={14} /> 승인
                    </button>
                    <button
                      onClick={() => handle(p.id, 'rejected')}
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

        {/* 기존 계정 */}
        <section>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
            전체 계정 ({others.length})
          </h2>
          <div className="space-y-2">
            {others.map(p => (
              <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-800">{p.name}</p>
                  <p className="text-xs text-slate-500">{p.phone} · {new Date(p.created_at).toLocaleDateString('ko-KR')}</p>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                  p.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                }`}>
                  {p.status === 'approved' ? '승인됨' : '거절됨'}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
