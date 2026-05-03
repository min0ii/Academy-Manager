# Linkademy — 프로젝트 컨텍스트

## 기본 정보
- **프로젝트 경로**: `/Users/user/Desktop/수학학원 관리시스템 제작/math-academy`
- **브랜드명**: Linkademy (링카데미) — 학원과 학생을 잇다.
- **도메인**: https://linkademy.space
- **GitHub**: https://github.com/min0ii/Academy-Manager
- **Supabase Project ID**: avjlmhmwkogmvxmaqskv
- **기술 스택**: Next.js 15 (App Router) + Tailwind CSS + Supabase + Vercel
- **소통 언어**: 한국어 (사용자는 개발 경험 없음, 모든 설명을 쉽고 친절하게)

## 인증 방식
- 화면에서는 **전화번호 + 비밀번호**로 로그인
- 내부적으로 `{전화번호숫자}@academy.local` 형식의 이메일로 Supabase Auth 사용
- `src/lib/auth.ts`: `phoneToEmail()`, `formatPhone()`, `signIn()`, `signUp()`, `signOut()`, `getProfile()`
- `src/lib/supabase.ts`: anon key 클라이언트 (브라우저용, auth 전용)
- **모든 데이터 API**: `SUPABASE_SERVICE_ROLE_KEY` 사용 (RLS 우회, 서버 전용)

## 보안 구조
- RLS 비활성화 → API 레벨에서 academy_id/teacher 검증으로 데이터 격리
- 학생/학부모 API: JWT 토큰으로 본인 확인 후 본인 데이터만 반환
- anon key는 브라우저에 노출되나 auth 전용으로만 사용

## 완성된 기능 전체 목록

### 선생님 앱 (`/dashboard/*`)
- **로그인/가입**: `/login`, `/signup`, `/onboarding` (학원 최초 설정)
- **대시보드**: `/dashboard` — 학생 수, 반 수 요약
- **학생 관리**: `/dashboard/students` — 목록/추가/수정/삭제/CSV가져오기/검색
- **학생 리포트**: `/dashboard/students/[id]` — 출결·성적·숙제 개인 리포트, 퇴원(계정삭제)
- **반 관리**: `/dashboard/classes` — 반 목록
- **반 상세**: `/dashboard/classes/[id]` — 캘린더, 출결/숙제/클리닉 기록, 시간표, 학생 배정
- **성적 관리**: `/dashboard/grades` — 자동/수동 시험 출제, 제출현황, 오답률 분석
- **숙제·클리닉**: `/dashboard/homework` — 숙제/클리닉 현황, 미완료 학생 파악
- **코멘트**: `/dashboard/comments`
- **설정**: `/dashboard/settings`
- **팀 관리**: `/dashboard/team`

### 학생 앱 (`/student`)
- 탭: home / attendance / grades / homework-clinic / exam / settings
- 성적: 막대그래프(반 평균 비교), 시험 상세(자동채점 시험 답안 확인)
- 시험: 답안 제출 (ExamTab 컴포넌트 분리)

### 학부모 앱 (`/parent`)
- 탭: home / attendance / grades / homework-clinic / comments / settings
- 자녀 성적/출결/숙제/클리닉/코멘트 열람

## 파일 구조 및 핵심 함수

### 선생님 — 성적 관리
**`src/app/dashboard/grades/page.tsx`** (1508줄)
- 컴포넌트: `ManualScoreView` (수동채점), `AutoMonitorView` (자동채점 모니터링)
- 주요 함수: `addManualExam()`, `addAutoExam()`, `refreshSubmissions()`, `deleteExam()`, `revealAnswers()`
- 날짜입력: `DateTimePicker`, `isDTValPartial()`, `dtValErrors()`, `dtValToISO()`
- 문항 편집: `WizardQuestionCard`, `newWizardQ()` (기본 5지선다)
- 점수유틸: `pct()`, `scoreColor()`, `scoreBg()`, `fmt()`
- 시험상태: `'scheduled' | 'active' | 'closed'`
- answer_reveal: `'after_close' | 'never' | 'revealed'`

### 선생님 — 반 상세 (캘린더/출결/숙제/클리닉)
**`src/app/dashboard/classes/[id]/page.tsx`** (1950줄)
- `selectDate()` — 날짜 클릭 시 세션/클리닉세션 로드, clinicAttList 설정
  - 정규 클리닉 요일: 세션 없어도 학생 목록 준비
  - 비정규 클리닉 날: `clinicAttList = []` → "클리닉 추가" 버튼 표시
- `markAttendance()` — 출결 기록 (세션 없으면 자동 생성)
- `markClinicAttendance()` — 클리닉 기록 (세션 없으면 자동 생성)
- `markAllPresent()`, `markAllClinicDone()` — 전체 처리
- `addHomework()`, `deleteHomework()`, `setHomeworkStatus()` — 숙제 관리
- `addExtraSession()`, `addExtraClinicSession()` — 비정기 수업/클리닉 추가
- `deleteSession()`, `deleteClinicSession()` — 삭제
- `loadAttendanceStats()` — 출결 통계
- PanelTab: `'attendance' | 'homework' | 'clinic'`
- 클리닉 탭: `clinicAttList.length === 0`이면 "클리닉 추가" 버튼, `> 0`이면 학생 목록

### 선생님 — 숙제 탭
**`src/app/dashboard/homework/page.tsx`** (621줄)
- `HwStatusBadge`: `none → '미완료'`, `done → '완료'`, `partial → '오답(완벽) 완료'`
- 숙제 상태: `'done' | 'partial' | 'none'` (none = 미완료)

### 선생님 — 학생 리포트
**`src/app/dashboard/students/[id]/page.tsx`** (722줄)
- `withdrawStudent()` — 퇴원 처리 + `/api/delete-account` 호출로 계정 삭제
- `loadClassDetail()` — 성적/출결/숙제 데이터 로드

### 학생 앱
**`src/app/student/page.tsx`** (1291줄)
- Tab: `'home' | 'attendance' | 'grades' | 'homework-clinic' | 'exam' | 'settings'`
- `openExamResult(examId)` — `/api/exams/[examId]/student-result` 호출
- 성적 차트: BarChart (반 평균 비교), scrollable (`overflow-x-auto`)
- HW_STYLE: `none → '미완료'` (숙제 상태 표시)
- `ExamTab` 컴포넌트: `src/app/student/ExamTab.tsx`

### 학부모 앱
**`src/app/parent/page.tsx`** (1127줄)
- Tab: `'home' | 'attendance' | 'grades' | 'homework-clinic' | 'comments' | 'settings'`
- 성적 차트: BarChart 보라색 (`#7c3aed`), scrollable
- 숙제 상태: `none → '미완료'` (이미 적용됨)

## API 라우트 전체 목록

### 시험 관련
| 경로 | 메서드 | 설명 |
|---|---|---|
| `/api/exams` | GET | 반별 시험 목록 (`?classId=`) |
| `/api/exams` | POST | 시험 생성 (자동/수동) |
| `/api/exams/[examId]` | GET | 시험 상세 (questions, choices, answers) |
| `/api/exams/[examId]` | DELETE | 시험 삭제 |
| `/api/exams/[examId]` | PATCH | action: `start`, `close`, `reveal_answers`, `update_answer` |
| `/api/exams/[examId]/submissions` | GET | 선생님용 제출현황 전체 |
| `/api/exams/[examId]/submissions` | POST | 수동채점 점수저장 / 조정점수 저장 |
| `/api/exams/[examId]/submit` | POST | 학생 답안 제출 |
| `/api/exams/[examId]/student-result` | GET | 학생/학부모용 시험 결과 상세 |
| `/api/exams/[examId]/questions` | GET/POST | 문항 관리 |
| `/api/exams/[examId]/draft` | GET/POST | 임시저장 |
| `/api/exams/student-list` | GET | 시험 응시 학생 목록 |

### 성적/출결/숙제
| 경로 | action | 설명 |
|---|---|---|
| `/api/grades` | GET `parent-chart` | 학부모 성적 차트 |
| `/api/grades` | GET `parent-homework` | 학부모 숙제 현황 |
| `/api/grades` | GET `parent-clinic` | 학부모 클리닉 현황 |
| `/api/grades` | GET `parent-comments` | 학부모 코멘트 |
| `/api/grades` | GET `my-grades` | 학생 성적 (avgPct 포함) |
| `/api/grades` | GET `my-homework` | 학생 숙제 |
| `/api/grades` | GET `my-clinic` | 학생 클리닉 |
| `/api/grades` | GET `my-attendance` | 학생 출결 |
| `/api/grades` | GET `tests` | 선생님 시험 목록+통계 |
| `/api/grades` | GET `scores` | 특정 시험 점수 |
| `/api/grades` | GET `student-chart` | 학생 리포트 성적 |
| `/api/grades` | POST | 수동 점수 저장 |

### 계정 관리
| 경로 | 설명 |
|---|---|
| `/api/create-student-accounts` | 학생+학부모 계정 일괄 생성 |
| `/api/create-single-account` | 단일 계정 생성 |
| `/api/create-teacher` | 선생님 계정 생성 |
| `/api/delete-account` | 계정 삭제 (`target: 'student'|'parent'|'both'`) |
| `/api/delete-self` | 본인 계정 삭제 |
| `/api/account-status` | 계정 상태 확인 |
| `/api/reset-password` | 비밀번호 재설정 |
| `/api/security-question` | 보안 질문 관리 |
| `/api/student` | 학생 정보 조회 (학생/학부모용) |

## DB 테이블 전체 목록
```
profiles (id, phone, name, role)
academies (id, name, teacher_id, logo_url)
classes (id, academy_id, name)
class_schedules (id, class_id, day_of_week 0-6, start_time, end_time)
class_students (class_id, student_id)
sessions (id, class_id, date, start_time, end_time, status, note)
students (id, academy_id, user_id, name, school_name, grade, phone, parent_phone, parent_relation, memo, enrolled_at)
attendance (id, session_id, student_id, status 'present'|'late'|'early_leave'|'absent', note)
tests (id, class_id, name, date, max_score) — 구형 성적 시스템
test_scores (id, test_id, student_id, score, absent)
grades (id, session_id, student_id, type, score, max_score, note)
homework (id, class_id, title, description, assigned_date, due_date)
homework_status (id, homework_id, student_id, status 'done'|'partial'|'none')
clinic_schedules (id, class_id, name, day_of_week, start_time, end_time)
clinic_sessions (id, class_id, date, name, start_time, end_time, note)
clinic_attendance (id, clinic_session_id, student_id, status 'done'|'not_done')
comments (id, student_id, teacher_id, date, content)
parent_students (parent_id, student_id) — 학부모-학생 연결
academy_teachers (academy_id, teacher_id) — 팀 선생님
exams (id, class_id, title, exam_type 'auto'|'manual', status 'scheduled'|'active'|'closed',
       answer_reveal 'after_close'|'never'|'revealed', start_at, end_at, max_score, created_at,
       no_deadline boolean DEFAULT false)
exam_questions (id, exam_id, order_num, question_text, question_type 'multiple_choice'|'short_answer', score)
exam_choices (id, question_id, choice_num, choice_text)
exam_correct_answers (id, question_id, answer_text, order_num)
exam_submissions (id, exam_id, student_id, is_submitted, submitted_at, auto_score, adjusted_score,
                  is_forfeited boolean DEFAULT false)
exam_student_answers (id, submission_id, question_id, student_answer, is_correct, score_earned, manually_overridden)
```

## 주요 설계 원칙 / 자주 쓰는 패턴

### 숙제/클리닉 상태
- `'done'` = 완료, `'partial'` = 오답(완벽) 완료, `'none'` = **미완료** (미제출 아님!)
- 클리닉: `'done'` = 완료, `'not_done'` = 미완료

### 시험 점수 계산
- 자동채점: `exam_questions.score` 합계 = 만점
- 수동채점: `exams.max_score` = 만점
- 통합 패턴: `exam.max_score ?? maxScoreByExam[exam.id] ?? null`

### 마감 방식 (no_deadline)
- `no_deadline=false` (기본): 마감 있는 시험 — status='closed' 이후 학생 결과 열람 가능
- `no_deadline=true`: 마감 없는 시험 — 제출 즉시 결과+반 통계 열람, 미제출 학생은 계속 응시 가능
  - 학생 앱: 제출 후 exam tab에서 사라지고 grades tab에서 결과 확인
  - submit API 응답에 `classStats: { classAvg, classHigh, classLow, classCount }` 포함
  - wizard: type_select → auto_deadline → auto_1 → auto_2

### 시험 포기 (is_forfeited)
- `exam_submissions.is_forfeited=true`: 시험 포기 상태
- POST `/api/exams/[examId]/submit` with `{ action: 'forfeit' }` → 포기 처리
- 선생님/학생/학부모 앱 모두 "시험 포기" 뱃지로 표시
- 포기한 시험은 exam tab 목록에서 제외

### 클리닉 탭 동작
- 정규 클리닉 요일 (clinic_schedules 매칭): 세션 없어도 학생 목록 자동 준비
- 비정규 날: `clinicAttList = []` → "클리닉 추가" 버튼만 표시
- `deleteClinicSession()` 후: 정규 요일이면 빈 목록 유지, 비정규면 `[]`

### 차트
- 학생/학부모 앱: BarChart (scrollable, `Math.max(300, data.length * 72)`)
- 선생님 학생 리포트: LineChart (scrollable, `Math.max(320, data.length * 64)`)

### API 인증 패턴
```typescript
const token = req.headers.get('Authorization')?.replace('Bearer ', '')
const { data: { user } } = await db.auth.getUser(token)
// → user.id로 academy_id 또는 student_id 확인 후 데이터 반환
```

## 개발 서버 실행
```bash
cd "/Users/user/Desktop/수학학원 관리시스템 제작/math-academy"
npm run dev
```
→ http://localhost:3000
