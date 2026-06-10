'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, LayoutGrid, BarChart2, BookOpen, MessageSquare, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAcademy } from '@/lib/academy-context'
import { todayKST } from '@/lib/date'
import { PageLoading } from '@/components/Skeleton'
import ExamGroupWidget from './ExamGroupWidget'

type Stats = {
  studentCount: number
  classCount: number
}

type ActiveClass = {
  id: string
  name: string
  start_time: string
  end_time: string
}

const QUICK_LINKS = [
  { href: '/dashboard/students', label: '학생 관리', desc: '학생 등록·수정·명부', icon: Users, color: 'blue' },
  { href: '/dashboard/classes', label: '수업 관리', desc: '출석·과제·클리닉 관리', icon: LayoutGrid, color: 'violet' },
  { href: '/dashboard/grades', label: '성적 관리', desc: '시험 출제·점수 관리', icon: BarChart2, color: 'emerald' },
  { href: '/dashboard/homework', label: '과제·클리닉', desc: '과제 배부 및 이행 현황', icon: BookOpen, color: 'rose' },
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
  const ctx = useAcademy()
  const [stats, setStats] = useState<Stats>({ studentCount: 0, classCount: 0 })
  const [activeClasses, setActiveClasses] = useState<ActiveClass[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ctx) return
    ;(async () => {
      const now = new Date()
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`
      const dayOfWeek = now.getDay()

      const [{ count: studentCount }, { count: classCount }, { data: classData }] = await Promise.all([
        supabase.from('students').select('*', { count: 'exact', head: true }).eq('academy_id', ctx.academyId).eq('status', 'active'),
        supabase.from('classes').select('*', { count: 'exact', head: true }).eq('academy_id', ctx.academyId),
        supabase.from('classes').select('id, name').eq('academy_id', ctx.academyId),
      ])
      setStats({ studentCount: studentCount ?? 0, classCount: classCount ?? 0 })

      const classIds = (classData ?? []).map(c => c.id)
      const classMap: Record<string, string> = {}
      ;(classData ?? []).forEach(c => { classMap[c.id] = c.name })

      if (classIds.length > 0) {
        const todayStr = todayKST()

        const [{ data: scheduleData }, { data: sessionData }] = await Promise.all([
          supabase
            .from('class_schedules')
            .select('class_id, start_time, end_time')
            .in('class_id', classIds)
            .eq('day_of_week', dayOfWeek)
            .lte('start_time', currentTime)
            .gte('end_time', currentTime),
          supabase
            .from('sessions')
            .select('class_id, start_time, end_time')
            .in('class_id', classIds)
            .eq('date', todayStr)
            .lte('start_time', currentTime)
            .gte('end_time', currentTime),
        ])

        const seen = new Set<string>()
        const active: ActiveClass[] = []
        for (const s of [...(scheduleData ?? []), ...(sessionData ?? [])]) {
          if (!seen.has(s.class_id)) {
            seen.add(s.class_id)
            active.push({ id: s.class_id, name: classMap[s.class_id], start_time: s.start_time, end_time: s.end_time })
          }
        }
        setActiveClasses(active)
      }

      setLoading(false)
    })()
  }, [ctx])

  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })

  if (loading) return <PageLoading />

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* 인사 헤더 */}
      <div>
        <p className="text-sm text-slate-500 mb-1">{today}</p>
        <h1 className="text-2xl font-bold text-slate-800">
          안녕하세요, {ctx?.teacherName} {ctx?.myTitle}님 👋
        </h1>
        <p className="text-slate-500 mt-1">{ctx?.academyName}의 오늘도 화이팅이에요!</p>
      </div>

      {/* 진행 중인 수업 배너 */}
      {activeClasses.length > 0 && (
        <div className="space-y-2">
          {activeClasses.map(cls => (
            <Link
              key={cls.id}
              href={`/dashboard/classes/${cls.id}`}
              className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-2xl p-4 hover:bg-green-100 transition-colors group"
            >
              <div className="relative flex-shrink-0 w-3 h-3">
                <div className="absolute inset-0 w-3 h-3 rounded-full bg-green-500" />
                <div className="absolute inset-0 w-3 h-3 rounded-full bg-green-400 animate-ping" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-green-600 mb-0.5">지금 수업 진행 중</p>
                <p className="font-bold text-green-900 truncate">{cls.name}</p>
                <p className="text-xs text-green-600 mt-0.5">
                  {cls.start_time.slice(0, 5)} ~ {cls.end_time.slice(0, 5)}
                </p>
              </div>
              <ChevronRight size={18} className="text-green-400 group-hover:text-green-600 transition-colors flex-shrink-0" />
            </Link>
          ))}
        </div>
      )}

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

      {/* 시험 모아보기 위젯 */}
      <ExamGroupWidget />

      {/* 빠른 메뉴 — PC에선 사이드바와 중복이라 모바일에서만 표시 */}
      <div className="lg:hidden">
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
                <div className={`p-2.5 rounded-xl flex-shrink-0 ${colorMap[item.color]}`}>
                  <Icon size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 text-sm">{item.label}</p>
                  <p className="text-xs text-slate-500 truncate">{item.desc}</p>
                </div>
                <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-400 transition-colors flex-shrink-0" />
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
