/** 한국 시간(KST, UTC+9) 기준 오늘 날짜를 'YYYY-MM-DD' 형식으로 반환 */
export function todayKST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

/** 한국 시간 기준 N개월 전 날짜를 'YYYY-MM-DD' 형식으로 반환 */
export function monthsAgoKST(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d)
}
