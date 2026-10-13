'use client'

import { Fragment } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Legend } from 'recharts'

// 학부모에게 사진으로 보내는 주간 리포트 한 장.
// 이미지로 캡처하기 때문에 가로폭을 800px 로 고정한다 (A4 비율).
// 캡처 시 애니메이션이 중간 프레임으로 찍히면 안 되므로 그래프는 isAnimationActive={false}.

export type ReportStudent = {
  id: string
  name: string
  grade: string
  schoolName: string
  attendance: { date: string; status: string | null }[]
  homework:   { date: string; title: string; status: string | null }[]
  clinics:    { date: string; name: string; status: string | null }[]
  exam: { my: number | null; avg: number | null; max: number | null; full: number | null; count: number }
  chart: { date: string; mine: number | null; classAvg: number | null }[]
  comment: string
}

export const SHEET_WIDTH = 800
// 종이 폭 - 좌우 패딩(64) - 그래프 상자 테두리·패딩(22)
const CHART_WIDTH = SHEET_WIDTH - 64 - 22

const DAYS = ['일', '월', '화', '수', '목', '금', '토']
const ATT: Record<string, string> = { present: '출석', late: '지각', early_leave: '조퇴', absent: '결석', cancelled: '휴강' }
const HW:  Record<string, string> = { partial: '오답(완벽) 완료', done: '완료', none: '미완료' }
const CL:  Record<string, string> = { done: '완료', not_done: '미완료' }

const HW_COLOR: Record<string, string> = { partial: '#0f766e', done: '#15803d', none: '#dc2626' }
const ATT_COLOR: Record<string, string> = { present: '#15803d', late: '#b45309', early_leave: '#7c3aed', absent: '#dc2626', cancelled: '#94a3b8' }

function dLabel(d: string) {
  const dt = new Date(d + 'T00:00:00')
  return `${dt.getMonth() + 1}월 ${dt.getDate()}일 ${DAYS[dt.getDay()]}요일`
}
function dShort(d: string) {
  const dt = new Date(d + 'T00:00:00')
  return `${dt.getMonth() + 1}/${dt.getDate()} ${DAYS[dt.getDay()]}`
}
// '예제 점수' 처럼 이미 '점수'로 끝나는 이름에 '점수'를 또 붙이지 않는다
function scoreTitle(category: string, suffix = '') {
  const base = category || '시험'
  const head = base.endsWith('점수') ? base : `${base} 점수`
  return suffix ? `${head} ${suffix}` : head
}

function dFull(d: string) {
  const dt = new Date(d + 'T00:00:00')
  return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 ${DAYS[dt.getDay()]}요일`
}

// 표를 n칸씩 가로로 접어서 보여준다 (원본 리포트가 3쌍씩 쓰고 있음)
function fold<T>(rows: T[], cols: number): (T | null)[][] {
  const perCol = Math.max(1, Math.ceil(rows.length / cols))
  const out: (T | null)[][] = []
  for (let r = 0; r < perCol; r++) {
    const line: (T | null)[] = []
    for (let c = 0; c < cols; c++) line.push(rows[c * perCol + r] ?? null)
    out.push(line)
  }
  return out
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
    <span style={{ width: 4, height: 15, background: '#334155', borderRadius: 2 }} />
    <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', letterSpacing: '-0.01em' }}>{children}</span>
  </div>
)

const th: React.CSSProperties = {
  background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '5px 8px',
  fontSize: 11.5, fontWeight: 700, color: '#334155', textAlign: 'center', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = {
  border: '1px solid #cbd5e1', padding: '5px 8px',
  fontSize: 11.5, color: '#334155', textAlign: 'center',
}

export default function ReportSheet({
  student, className, teacherName, category, from, to,
}: {
  student: ReportStudent
  className: string
  teacherName: string
  category: string
  from: string
  to: string
}) {
  const attRows = fold(student.attendance, 3)
  const hwRows  = fold(student.homework, 2)
  const chartData = student.chart.map(p => ({
    name: dShort(p.date),
    '학생 전체': p.classAvg,
    '학생 본인': p.mine,
  }))

  return (
    <div style={{
      width: SHEET_WIDTH, background: '#ffffff', padding: '28px 32px 32px',
      fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif",
      color: '#1e293b', boxSizing: 'border-box',
    }}>
      {/* ── 머리글 ── */}
      <div style={{ borderTop: '3px solid #1e293b', borderBottom: '1px solid #1e293b', padding: '14px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <span style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.02em' }}>
              {teacherName} 선생님 <span style={{ fontWeight: 600 }}>수강생 리포트</span>
            </span>
          </div>
          <div style={{ width: 230, borderLeft: '1px solid #1e293b', paddingLeft: 18, flexShrink: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>
              학생명 : {student.name}{className ? ` (${className})` : ''}
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>{dFull(to)}</div>
          </div>
        </div>
      </div>

      {/* ── 출결 ── */}
      <div style={{ marginTop: 20 }}>
        <SectionTitle>학생 출결상황</SectionTitle>
        {student.attendance.length === 0 ? (
          <p style={{ fontSize: 12, color: '#94a3b8', padding: '8px 2px' }}>이 기간에 수업이 없어요.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{[0, 1, 2].map(i => (
                <Fragment key={i}>
                  <th style={{ ...th, width: '16.6%' }}>일자</th>
                  <th style={{ ...th, width: '16.7%' }}>출결상황</th>
                </Fragment>
              ))}</tr>
            </thead>
            <tbody>
              {attRows.map((line, ri) => (
                <tr key={ri}>
                  {line.map((cell, ci) => (
                    <Fragment key={ci}>
                      <td style={{ ...td, textAlign: 'right', paddingRight: 12 }}>{cell ? dLabel(cell.date) : ''}</td>
                      <td style={{ ...td, color: cell?.status ? (ATT_COLOR[cell.status] ?? '#334155') : '#94a3b8', fontWeight: cell?.status ? 600 : 400 }}>
                        {cell ? (cell.status ? (ATT[cell.status] ?? cell.status) : '미기록') : ''}
                      </td>
                    </Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── 점수 + 클리닉 ── */}
      <div style={{ display: 'flex', gap: 26, marginTop: 22 }}>
        <div style={{ flex: 1 }}>
          <SectionTitle>{scoreTitle(category)}</SectionTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <th style={{ ...th, width: '42%' }}>학생 점수</th>
                <td style={{ ...td, fontWeight: 700, fontSize: 13 }}>
                  {student.exam.my !== null ? `${student.exam.my}점` : '응시 없음'}
                  {student.exam.full ? <span style={{ color: '#94a3b8', fontWeight: 500 }}> / {student.exam.full}점</span> : null}
                </td>
              </tr>
              <tr><th style={{ ...th }}>반 평균 점수</th><td style={td}>{student.exam.avg !== null ? `${student.exam.avg}점` : '-'}</td></tr>
              <tr><th style={{ ...th }}>반 최고 점수</th><td style={td}>{student.exam.max !== null ? `${student.exam.max}점` : '-'}</td></tr>
            </tbody>
          </table>
          {student.exam.count > 1 && (
            <p style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 5 }}>※ 기간 내 {student.exam.count}회 합산</p>
          )}
        </div>

        <div style={{ flex: 1 }}>
          <SectionTitle>클리닉 완료 여부</SectionTitle>
          {student.clinics.length === 0 ? (
            <p style={{ fontSize: 12, color: '#94a3b8', padding: '8px 2px' }}>이 기간에 클리닉이 없어요.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {student.clinics.map((c, i) => (
                  <tr key={i}>
                    <th style={{ ...th, width: '42%' }}>{c.name}</th>
                    <td style={{ ...td, color: c.status === 'done' ? '#15803d' : c.status === 'not_done' ? '#dc2626' : '#94a3b8', fontWeight: c.status ? 600 : 400 }}>
                      {c.status ? (CL[c.status] ?? c.status) : '미기록'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── 추이 그래프 ── */}
      <div style={{ marginTop: 24 }}>
        <SectionTitle>{scoreTitle(category, '추이 (100점 환산)')}</SectionTitle>
        <div style={{ border: '1px solid #cbd5e1', borderRadius: 4, padding: '14px 10px 6px' }}>
          {chartData.length === 0 ? (
            <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '40px 0' }}>표시할 점수가 없어요.</p>
          ) : (
            // ResponsiveContainer 는 폭을 재는 데 한 틱이 걸려서 캡처가 빈 그래프로 찍힐 수 있다.
            // 어차피 종이 폭이 고정이므로 너비를 직접 준다.
            <LineChart width={CHART_WIDTH} height={210} data={chartData} margin={{ top: 6, right: 20, bottom: 4, left: -16 }}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="학생 전체" stroke="#4472c4" strokeWidth={2.2} dot={{ r: 3.5 }} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="학생 본인" stroke="#ed7d31" strokeWidth={2.2} dot={{ r: 3.5 }} connectNulls isAnimationActive={false} />
            </LineChart>
          )}
        </div>
      </div>

      {/* ── 과제 + 코멘트 ── */}
      <div style={{ display: 'flex', gap: 26, marginTop: 24 }}>
        <div style={{ flex: 1 }}>
          <SectionTitle>학생 과제이행 상황</SectionTitle>
          {student.homework.length === 0 ? (
            <p style={{ fontSize: 12, color: '#94a3b8', padding: '8px 2px' }}>이 기간에 과제가 없어요.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{[0, 1].map(i => (
                  <Fragment key={i}>
                    <th style={{ ...th, width: '25%' }}>날짜</th>
                    <th style={{ ...th, width: '25%' }}>과제 이행</th>
                  </Fragment>
                ))}</tr>
              </thead>
              <tbody>
                {hwRows.map((line, ri) => (
                  <tr key={ri}>
                    {line.map((cell, ci) => (
                      <Fragment key={ci}>
                        <td style={td}>{cell ? dShort(cell.date) : ''}</td>
                        <td style={{ ...td, fontSize: 11, color: cell?.status ? (HW_COLOR[cell.status] ?? '#334155') : '#94a3b8', fontWeight: cell?.status ? 600 : 400 }}>
                          {cell ? (cell.status ? (HW[cell.status] ?? cell.status) : '미기록') : ''}
                        </td>
                      </Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ flex: 1 }}>
          <SectionTitle>선생님 코멘트</SectionTitle>
          <div style={{
            border: '1px solid #cbd5e1', borderRadius: 4, padding: '12px 14px',
            minHeight: 92, fontSize: 12, lineHeight: 1.75, color: '#334155', whiteSpace: 'pre-wrap',
          }}>
            {student.comment || <span style={{ color: '#cbd5e1' }}>코멘트가 없습니다.</span>}
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid #1e293b', marginTop: 22, paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>{from} ~ {to}</span>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>{student.schoolName}{student.grade ? ` ${student.grade}학년` : ''}</span>
      </div>
    </div>
  )
}
