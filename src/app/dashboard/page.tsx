'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, LayoutGrid, BarChart2, BookOpen, MessageSquare, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type Stats = {
  studentCount: number
  classCount: number
}

const QUICK_LINKS = [
  { href: '/dashboard/students', label: '학생 관리', desc: '학생 등록·수정·명부', icon: Users, color: 'blue' },
  { href: '/dashboard/classes', label: '수업 관리', desc: '반·시간표 설정', icon: LayoutGrid, color: 'violet' },
  { href: '/dashboard/grades', label: '성적 관리', desc: '예제·복습·시험 점수', icon: BarChart2, color: 'emerald' },
  { href: '/dashboard/homework', label: '숙제·클리닉', desc: '과제 배부 및 이행 현황', icon: BookOpen, color: 'rose' },
  { href: '/dashboard/comments', label: '코멘트', desc: '학부모에게 전달할 메시지 작성', icon: MessageSquare, color: 'cyan' },
]

const colorMap: Record<string, string> = {
  blue:   'bg-blue-50 text-blue-600',
  violet: 'bg-violet-50 text-violet-600',
  amber:  'bg-amber-50 text-amber-600',
  emerald:'bg-emerald-50 text-emerald-600',
  rose:   'bg-rose-50 text-rose-600',
  cyan:   'bg-cyan-50 text-cyan-600',
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({ studentCount: 0, classCount: 0 })
  const [academyName, setAcademyName] = useState('')
  const [teacherName, setTeacherName] = useState('')
  const [teacherTitle, setTeacherTitle] = useState('선생')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const [{ data: profile }, { data: membershipData }] = await Promise.all([
        supabase.from('profiles').select('name').eq('id', user.id).single(),
        supabase.from('academy_teachers')
          .select('academy_id, title, academies(id, name)')
          .eq('teacher_id', user.id)
          .single(),
      ])
      const academy = (membershipData as any)?.academies

      if (profile) setTeacherName(profile.name)
      if (membershipData?.title) setTeacherTitle(membershipData.title)
      if (academy && membershipData) {
        setAcademyName(academy.name)
        const [{ count: studentCount }, { count: classCount }] = await Promise.all([
          supabase.from('students').select('*', { count: 'exact', head: true }).eq('academy_id', membershipData.academy_id),
          supabase.from('classes').select('*', { count: 'exact', head: true }).eq('academy_id', membershipData.academy_id),
        ])
        setStats({ studentCount: studentCount ?? 0, classCount: classCount ?? 0 })
      }

      setLoading(false)
    }
    load()
  }, [])

  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400 text-sm">불러오는 중...</div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* 인사 헤더 */}
      <div>
        <p className="text-sm text-slate-500 mb-1">{today}</p>
        <h1 className="text-2xl font-bold text-slate-800">
          안녕하세요, {teacherName} {teacherTitle}님 👋
        </h1>
        <p className="text-slate-500 mt-1">{academyName}의 오늘도 화이팅이에요!</p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-50 rounded-xl">
              <Users size={18} className="text-blue-600" />
            </div>
            <span className="text-sm font-medium text-slate-600">전체 학생</span>
          </div>
          <p className="text-3xl font-bold text-slate-800">{stats.studentCount}<span className="text-base font-normal text-slate-500 ml-1">명</span></p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-violet-50 rounded-xl">
              <LayoutGrid size={18} className="text-violet-600" />
            </div>
            <span className="text-sm font-medium text-slate-600">운영 반</span>
          </div>
          <p className="text-3xl font-bold text-slate-800">{stats.classCount}<span className="text-base font-normal text-slate-500 ml-1">개</span></p>
        </div>
      </div>

      {/* 빠른 메뉴 */}
      <div>
        <h2 className="text-base font-bold text-slate-700 mb-3">메뉴</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {QUICK_LINKS.map((item, idx) => {
            const Icon = item.icon
            const isLastOdd = idx === QUICK_LINKS.length - 1 && QUICK_LINKS.length % 2 === 1
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-4 bg-white rounded-2xl border border-slate-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all group${isLastOdd ? ' sm:col-span-2' : ''}`}
              >
                <div className={`p-2.5 rounded-xl ${colorMap[item.color]}`}>
                  <Icon size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 text-sm">{item.label}</p>
                  <p className="text-xs text-slate-500 truncate">{item.desc}</p>
                </div>
                <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-400 transition-colors" />
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
