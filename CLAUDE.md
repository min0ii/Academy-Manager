# Linkademy — 프로젝트 컨텍스트

## 기본 정보
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
- **자동 로그인**: 기존 세션이 있으면 로그인 화면을 건너뛰고 자동 이동

## 보안 구조
- RLS 비활성화 → API 레벨에서 academy_id/teacher 검증으로 데이터 격리
- 학생/학부모 API: JWT 토큰으로 본인 확인 후 본인 데이터만 반환
- anon key는 브라우저에 노출되나 auth 전용으로만 사용
- **학원 가입 승인 시스템**: academies.status = `'pending' | 'approved' | 'rejected'`
  - 가입 후 관리자 승인 전까지 `/pending` 페이지로 리디렉션
  - 거부 시 거부 메시지 표시
  - `/admin` 페이지: Linkademy 관리자만 접근, 학원 가입 승인/거부 처리
  - dashboard layout에서 status 확인 후 미승인 시 `/pending`으로 redirect

## 완성된 기능 전체 목록

### 선생님 앱 (`/dashboard/*`)
- **로그인/가입**: `/login`, `/signup`, `/onboarding` (학원 최초 설정)
- **승인 대기**: `/pending` — 승인 대기 중 / 거부됨 상태 표시
- **대시보드**: `/dashboard` — 학생 수, 반 수 요약
- **학생 관리**: `/dashboard/students` — 목록/추가/수정/삭제/CSV가져오기/검색, 동일 전화번호 멀티 학원 지원
- **학생 리포트**: `/dashboard/students/[id]` — 출결·성적·숙제 개인 리포트, 퇴원(계정삭제)
  - 성적 차트: LineChart (scrollable), enrolled_at 이전 데이터 제외
- **반 관리**: `/dashboard/classes` — 반 목록
- **반 상세**: `/dashboard/classes/[id]` — 캘린더, 출결/숙제/클리닉 기록, 수업 설정(시간표), 학생 배정
  - 미래 수업일 사전 기록 허용 (출결·숙제·클리닉)
  - 신입생 enrolled_at 이전 수업 자동 제외
  - 반 기록 전체 초기화 기능 (학생 명단·시간표 제외)
- **시험 관리**: `/dashboard/grades` — 자동/수동 시험 출제, 제출현황, 오답률 분석
  - 문제은행(QuestionBank) 탭 포함
  - 시험 카테고리 필터
  - 시험 문제 드래그 순서 변경
  - 문제 번호 직접 입력 (customLabel)
  - 출제 후 시험 수정 가능
  - 제출 현황 점수 높은 순 정렬 (미제출 하단)
- **과제·클리닉**: `/dashboard/homework` — 과제/클리닉 현황, 미완료 학생 파악
- **코멘트**: `/dashboard/comments`
- **설정**: `/dashboard/settings` — 학원 로고 업로드 포함
- **팀 관리**: `/dashboard/team`
- **출결 현황**: `/dashboard/attendance` — 준비 중 (🚧)
- **관리자 페이지**: `/admin` — Linkademy 전체 학원 가입 승인/거부 관리

### 학생 앱 (`/student`)
- 탭: `home / attendance / grades / homework-clinic / exam / settings`
- **홈**: 오늘 수업 카드, 헤더에 학원 로고 표시 (클릭 시 홈 이동)
- **출결**: 캘린더, enrolled_at 이전 세션 제외, 행 높이 균일
- **성적**: BarChart (반 평균 비교, scrollable), 시험 등수 표시 (`n명 중 n위`), 카테고리 필터, 점수 수정 표시, 시험 결과 상세(자동채점 답안 확인)
- **과제·클리닉**: 과제 설명 펼치기/접기, enrolled_at 이전 데이터 제외
- **시험**: 답안 제출 (`ExamTab` 컴포넌트 분리), 시험 이탈 경고, 포기 기능
- **시험 결과**: 제출 즉시 반 통계 확인 (no_deadline 시험)

### 학부모 앱 (`/parent`)
- 탭: `home / attendance / grades / homework-clinic / comments / settings`
- **홈**: 헤더에 학원 로고 표시 (클릭 시 홈 이동)
- **출결**: enrolled_at 이전 세션 제외
- **성적**: BarChart 보라색 (`#7c3aed`, scrollable), 카테고리 필터, 점수 수정 표시
- **과제·클리닉**: 과제 설명 펼치기/접기, enrolled_at 이전 데이터 제외
- **코멘트**: 자녀 코멘트 열람

### 공통 기능
- **PWA 지원**: 홈 화면 추가 가능, `manifest.ts`, `icon.tsx`, `apple-icon.tsx`, `/api/pwa-icon` 라우트
- **커스텀 다이얼로그**: `AppDialog.tsx` — `useDialog()` 훅으로 사용 (브라우저 기본 alert/confirm 대체)
- **앱 전체 탭 전환 애니메이션**: 부드러운 전환
- **전체 텍스트**: '숙제' → '과제'로 통일

## 파일 구조 및 핵심 함수

### 선생님 — 시험 관리
**`src/app/dashboard/grades/page.tsx`** (2115줄)
- 컴포넌트: `ManualScoreView` (수동채점), `AutoMonitorView` (자동채점 모니터링)
- 주요 함수: `addManualExam()`, `addAutoExam()`, `refreshSubmissions()`, `deleteExam()`, `revealAnswers()`
- 날짜입력: `DateTimePicker`, `isDTValPartial()`, `dtValErrors()`, `dtValToISO()`
- 문항 편집: `WizardQuestionCard`, `newWizardQ()` (기본 5지선다, 기본 배점 1점)
- 점수유틸: `pct()`, `scoreColor()`, `scoreBg()`, `fmt()`
- 시험상태: `'scheduled' | 'active' | 'closed'`
- answer_reveal: `'after_close' | 'never' | 'revealed'`
- 카테고리: `categoryFilter` state, `saveCategoryOnly()` (inline edit)
- wizard 흐름 (no_deadline): `type_select → auto_deadline → auto_1 → auto_2`

**`src/app/dashboard/grades/QuestionBank.tsx`** — 문제은행 컴포넌트
- `qb_folders` / `qb_sets` / `qb_questions` DB 테이블 사용
- 폴더/세트 구조, 문제 편집, 시험에 가져오기
- `customLabel` 필드로 문제 번호 직접 입력 가능

### 선생님 — 반 상세 (캘린더/출결/숙제/클리닉)
**`src/app/dashboard/classes/[id]/page.tsx`** (2084줄)
- `selectDate()` — 날짜 클릭 시 세션/클리닉세션 로드, clinicAttList 설정
  - 정규 클리닉 요일: 세션 없어도 학생 목록 준비
  - 비정규 클리닉 날: `clinicAttList = []` → "클리닉 추가" 버튼 표시
- `markAttendance()` — 출결 기록 (세션 없으면 자동 생성)
- `markClinicAttendance()` — 클리닉 기록 (세션 없으면 자동 생성)
- `markAllPresent()`, `markAllClinicDone()` — 전체 처리
- `addHomework()`, `deleteHomework()`, `setHomeworkStatus()` — 과제 관리
- `addExtraSession()`, `addExtraClinicSession()` — 비정기 수업/클리닉 추가
- `deleteSession()`, `deleteClinicSession()` — 삭제
- `loadAttendanceStats()` — 출결 통계 (enrolled_at 기준 필터)
- PanelTab: `'attendance' | 'homework' | 'clinic'`
- 클리닉 탭: `clinicAttList.length === 0`이면 "클리닉 추가" 버튼, `> 0`이면 학생 목록
- 반 기록 초기화: `POST /api/classes/[classId]/reset` (sessions, attendance, homework, clinic 전체 삭제)

### 선생님 — 과제 탭
**`src/app/dashboard/homework/page.tsx`** (621줄)
- `HwStatusBadge`: `none → '미완료'`, `done → '완료'`, `partial → '오답(완벽) 완료'`
- 과제 상태: `'done' | 'partial' | 'none'` (none = 미완료)

### 선생님 — 학생 리포트
**`src/app/dashboard/students/[id]/page.tsx`** (760줄)
- `withdrawStudent()` — 퇴원 처리 + `/api/delete-account` 호출로 학생·학부모 계정 삭제
- `loadClassDetail()` — 성적/출결/숙제 데이터 로드 (enrolled_at 이전 제외)

### 학생 앱
**`src/app/student/page.tsx`** (1434줄)
- Tab: `'home' | 'attendance' | 'grades' | 'homework-clinic' | 'exam' | 'settings'`
- `openExamResult(examId, rankInfo?)` — `/api/exams/[examId]/student-result` 호출
- 성적 차트: BarChart (반 평균 비교), scrollable (`overflow-x-auto`), 카테고리 필터
- 시험 등수: `t.rank`, `t.totalSubmitted` → `n명 중 n위` 형식
- HW_STYLE: `none → '미완료'` (과제 상태 표시)
- `academyLogo` state: 헤더 로고 표시, 홈 탭 이동

**`src/app/student/ExamTab.tsx`** — 시험 탭 컴포넌트
- 진행 중인 시험 목록, 답안 제출, 시험 이탈 경고 다이얼로그, 포기 처리

### 학부모 앱
**`src/app/parent/page.tsx`** (1263줄)
- Tab: `'home' | 'attendance' | 'grades' | 'homework-clinic' | 'comments' | 'settings'`
- 성적 차트: BarChart 보라색 (`#7c3aed`), scrollable, 카테고리 필터
- 과제 상태: `none → '미완료'`
- `academyLogo` state: 헤더 로고 표시

### 공통 컴포넌트
**`src/components/AppDialog.tsx`** — 커스텀 다이얼로그
- `useDialog()` 훅: `alert(msg)`, `confirm(msg) → Promise<boolean>` 반환

## API 라우트 전체 목록

### 시험 관련
| 경로 | 메서드 | 설명 |
|---|---|---|
| `/api/exams` | GET | 반별 시험 목록 (`?classId=`) |
| `/api/exams` | POST | 시험 생성 (자동/수동) |
| `/api/exams/[examId]` | GET | 시험 상세 (questions, choices, answers) |
| `/api/exams/[examId]` | DELETE | 시험 삭제 |
| `/api/exams/[examId]` | PATCH | action: `start`, `close`, `reveal_answers`, `update_answer`, `update_category` |
| `/api/exams/[examId]/submissions` | GET | 선생님용 제출현황 전체 (점수 높은 순) |
| `/api/exams/[examId]/submissions` | POST | 수동채점 점수저장 / 조정점수 저장 |
| `/api/exams/[examId]/submit` | POST | 학생 답안 제출 / `action: 'forfeit'` 포기 |
| `/api/exams/[examId]/student-result` | GET | 학생/학부모용 시험 결과 상세 |
| `/api/exams/[examId]/questions` | GET/POST | 문항 관리 |
| `/api/exams/[examId]/draft` | GET/POST | 임시저장 |
| `/api/exams/student-list` | GET | 시험 응시 학생 목록 |

### 문제은행
| 경로 | 메서드 | 설명 |
|---|---|---|
| `/api/question-bank` | GET | 폴더/세트 목록 (문제 수 포함) |
| `/api/question-bank` | POST | 폴더/세트 생성·수정·삭제 |
| `/api/question-bank/[setId]` | GET | 세트 내 문제 목록 |
| `/api/question-bank/[setId]` | POST | 문제 저장 (upsert) |

### 성적/출결/과제
| 경로 | action | 설명 |
|---|---|---|
| `/api/grades` | GET `parent-chart` | 학부모 성적 차트 (enrolled_at 필터) |
| `/api/grades` | GET `parent-homework` | 학부모 과제 현황 (enrolled_at 필터) |
| `/api/grades` | GET `parent-clinic` | 학부모 클리닉 현황 (enrolled_at 필터) |
| `/api/grades` | GET `parent-comments` | 학부모 코멘트 |
| `/api/grades` | GET `my-grades` | 학생 성적 (avgPct, rank 포함, enrolled_at 필터) |
| `/api/grades` | GET `my-homework` | 학생 과제 (enrolled_at 필터) |
| `/api/grades` | GET `my-clinic` | 학생 클리닉 (enrolled_at 필터) |
| `/api/grades` | GET `my-attendance` | 학생 출결 (enrolled_at 필터) |
| `/api/grades` | GET `tests` | 선생님 시험 목록+통계 |
| `/api/grades` | GET `scores` | 특정 시험 점수 |
| `/api/grades` | GET `student-chart` | 학생 리포트 성적 (enrolled_at 필터) |
| `/api/grades` | POST | 수동 점수 저장 |

### 반 관리
| 경로 | 메서드 | 설명 |
|---|---|---|
| `/api/classes/[classId]/reset` | POST | 반 기록 전체 초기화 (학생·시간표 제외) |

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
| `/api/admin` | 학원 가입 승인/거부 (Linkademy 관리자 전용) |
| `/api/pwa-icon` | PWA 아이콘 이미지 서빙 |

## DB 테이블 전체 목록
```
profiles (id, phone, name, role)
academies (id, name, teacher_id, logo_url, status 'pending'|'approved'|'rejected')
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
       no_deadline boolean DEFAULT false, category text)
exam_questions (id, exam_id, order_num, question_text, question_type 'multiple_choice'|'short_answer', score)
exam_choices (id, question_id, choice_num, choice_text)
exam_correct_answers (id, question_id, answer_text, order_num)
exam_submissions (id, exam_id, student_id, is_submitted, submitted_at, auto_score, adjusted_score,
                  is_forfeited boolean DEFAULT false)
exam_student_answers (id, submission_id, question_id, student_answer, is_correct, score_earned, manually_overridden)
qb_folders (id, academy_id, name, parent_id, created_at) — 문제은행 폴더
qb_sets (id, academy_id, title, folder_id, created_at, updated_at) — 문제은행 세트
qb_questions (id, set_id, order_num, customLabel, question_text, question_type, score, choices, correct_answer) — 문제은행 문제
```

## 주요 설계 원칙 / 자주 쓰는 패턴

### 과제/클리닉 상태
- `'done'` = 완료, `'partial'` = 오답(완벽) 완료, `'none'` = **미완료** (미제출 아님!)
- 클리닉: `'done'` = 완료, `'not_done'` = 미완료

### enrolled_at 필터 (신입생 이전 데이터 제외)
- 모든 학생/학부모 앱 데이터 API에 적용 (출결·성적·과제·클리닉)
- `gte('date', enrolledAt)` 또는 `gte('assigned_date', enrolledAt)` 조건 추가
- 선생님 학생 리포트(`student-chart` action)에도 동일 적용
- 출결 통계(`loadAttendanceStats`)도 enrolled_at 기준으로 분모 계산

### 시험 점수 계산
- 자동채점: `exam_questions.score` 합계 = 만점
- 수동채점: `exams.max_score` = 만점
- 통합 패턴: `exam.max_score ?? maxScoreByExam[exam.id] ?? null`
- 문제 기본 배점: 1점 (`newWizardQ()`의 score 기본값)

### 마감 방식 (no_deadline)
- `no_deadline=false` (기본): 마감 있는 시험 — status='closed' 이후 학생 결과 열람 가능
- `no_deadline=true`: 마감 없는 시험 — 제출 즉시 결과+반 통계 열람, 미제출 학생은 계속 응시 가능
  - 학생 앱: 제출 후 exam tab에서 사라지고 grades tab에서 결과 확인
  - submit API 응답에 `classStats: { classAvg, classHigh, classLow, classCount }` 포함
  - wizard: `type_select → auto_deadline → auto_1 → auto_2`

### 시험 포기 (is_forfeited)
- `exam_submissions.is_forfeited=true`: 시험 포기 상태
- POST `/api/exams/[examId]/submit` with `{ action: 'forfeit' }` → 포기 처리
- 선생님/학생/학부모 앱 모두 "시험 포기" 뱃지로 표시
- 포기한 시험은 exam tab 목록에서 제외

### 시험 카테고리
- `exams.category` 컬럼 (nullable text)
- 카테고리 필터: 선생님/학생/학부모 성적 탭 모두 적용
- inline edit: `saveCategoryOnly()` → PATCH `action: 'update_category'`

### 클리닉 탭 동작
- 정규 클리닉 요일 (clinic_schedules 매칭): 세션 없어도 학생 목록 자동 준비
- 비정규 날: `clinicAttList = []` → "클리닉 추가" 버튼만 표시
- `deleteClinicSession()` 후: 정규 요일이면 빈 목록 유지, 비정규면 `[]`

### 차트
- 학생/학부모 앱: BarChart (scrollable, `Math.max(300, data.length * 72)`)
- 선생님 학생 리포트: LineChart (scrollable, `Math.max(320, data.length * 64)`)

### 등수 표시
- `n명 중 n위` 형식 (학생 성적 탭, 시험 결과 상세)
- grades API `my-grades` action에서 rank 계산 후 반환

### API 인증 패턴
```typescript
const token = req.headers.get('Authorization')?.replace('Bearer ', '')
const { data: { user } } = await db.auth.getUser(token)
// → user.id로 academy_id 또는 student_id 확인 후 데이터 반환
```

### 학원 가입 승인 흐름
1. 선생님 `/signup` → academies.status = `'pending'`
2. `/admin` 페이지에서 Linkademy 관리자가 승인/거부
3. dashboard layout에서 매 진입 시 status 확인 → `'pending'`/`'rejected'`이면 `/pending`으로 redirect
4. `/pending`: 대기 중이면 승인 안내, 거부됐으면 거부 메시지 표시

## 개발 서버 실행
```bash
npm run dev
```
→ http://localhost:3000