'use client'

import { Clock } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function PendingPage() {
  const router = useRouter()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="text-center max-w-sm">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100 rounded-full mb-4">
          <Clock className="text-amber-500" size={32} />
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">승인 대기 중이에요</h1>
        <p className="text-slate-500 mb-2">관리자가 학원 가입 신청을 검토하고 있어요.</p>
        <p className="text-slate-400 text-sm mb-8">승인 후 이용 가능합니다. 보통 1~2일 내로 연락드려요.</p>
        <button
          onClick={handleLogout}
          className="text-sm text-slate-400 hover:text-slate-600 underline"
        >
          로그아웃
        </button>
      </div>
    </div>
  )
}
