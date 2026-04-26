'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Users, LayoutGrid,
  BarChart2, BookOpen, MessageSquare, Settings, LogOut, Menu, X, UsersRound,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { signOut } from '@/lib/auth'
import { AcademyContext, type AcademyCtx } from '@/lib/academy-context'

const NAV = [
  { href: '/dashboard', label: '대시보드', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/students', label: '학생 관리', icon: Users },
  { href: '/dashboard/classes', label: '수업 관리', icon: LayoutGrid },
  { href: '/dashboard/grades', label: '성적 관리', icon: BarChart2 },
  { href: '/dashboard/homework', label: '숙제·클리닉', icon: BookOpen },
  { href: '/dashboard/comments', label: '코멘트', icon: MessageSquare },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [academy, setAcademy] = useState<{ name: string; logo_url: string | null } | null>(null)
  const [teacherName, setTeacherName] = useState('')
  const [teacherTitle, setTeacherTitle] = useState('선생')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [ctxValue, setCtxValue] = useState<AcademyCtx | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // 프로필 + 소속 정보 병렬 조회
      const [{ data: profile }, { data: membership }] = await Promise.all([
        supabase.from('profiles').select('name, role').eq('id', user.id).single(),
        supabase.from('academy_teachers')
          .select('academy_id, role, title, academies(name, logo_url)')
          .eq('teacher_id', user.id)
          .single(),
      ])

      if (!profile || profile.role !== 'teacher') { router.push('/login'); return }

      const ac = (membership as any)?.academies
      setTeacherName(profile.name)
      if (ac) setAcademy(ac)
      if (membership?.title) setTeacherTitle(membership.title)

      // 모든 하위 페이지가 공유할 Context 설정
      setCtxValue({
        userId: user.id,
        academyId: membership?.academy_id ?? '',
        myRole: (membership?.role ?? 'staff') as 'owner' | 'staff',
        myTitle: membership?.title ?? '',
        teacherName: profile.name,
        academyName: ac?.name ?? '',
        academyLogoUrl: ac?.logo_url ?? null,
      })
    }
    load()
  }, [router])

  function isActive(href: string, exact?: boolean) {
    return exact ? pathname === href : pathname.startsWith(href)
  }

  async function handleLogout() {
    await signOut()
    router.push('/login')
  }

  const Sidebar = () => (
    <div className="flex flex-col h-full">
      {/* 학원 정보 */}
      <div className="p-5 border-b border-slate-100">
        <div className="flex items-center gap-3">
          {academy?.logo_url ? (
            <img src={academy.logo_url} alt="로고" className="w-10 h-10 rounded-xl object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
              <span className="text-white font-bold text-lg">
                {academy?.name?.[0] ?? '학'}
              </span>
            </div>
          )}
          <div className="min-w-0">
            <p className="font-bold text-slate-800 text-sm truncate">{academy?.name ?? '학원'}</p>
            <p className="text-xs text-slate-500 truncate">{teacherName} {teacherTitle}님</p>
          </div>
        </div>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {NAV.map(item => {
          const Icon = item.icon
          const active = isActive(item.href, item.exact)
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                active
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
              }`}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* 하단 */}
      <div className="p-3 border-t border-slate-100 space-y-0.5">
        <Link
          href="/dashboard/settings"
          onClick={() => setMobileOpen(false)}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
            isActive('/dashboard/settings')
              ? 'bg-blue-50 text-blue-600'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
          }`}
        >
          <Settings size={18} />
          설정
        </Link>
        <Link
          href="/dashboard/team"
          onClick={() => setMobileOpen(false)}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
            isActive('/dashboard/team')
              ? 'bg-blue-50 text-blue-600'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
          }`}
        >
          <UsersRound size={18} />
          팀 관리
        </Link>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors"
        >
          <LogOut size={18} />
          로그아웃
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-slate-50">
      {/* PC 사이드바 */}
      <aside className="hidden lg:flex flex-col w-60 bg-white border-r border-slate-200 flex-shrink-0">
        <Sidebar />
      </aside>

      {/* 모바일 사이드바 오버레이 */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="fixed inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-50 flex flex-col w-64 bg-white shadow-xl">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            >
              <X size={20} />
            </button>
            <Sidebar />
          </aside>
        </div>
      )}

      {/* 메인 영역 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 모바일 헤더 */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200">
          <button onClick={() => setMobileOpen(true)} className="text-slate-600">
            <Menu size={22} />
          </button>
          <p className="font-bold text-slate-800">{academy?.name ?? '학원 관리'}</p>
        </header>

        {/* 콘텐츠 */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <AcademyContext.Provider value={ctxValue}>
            {children}
          </AcademyContext.Provider>
        </main>
      </div>
    </div>
  )
}
