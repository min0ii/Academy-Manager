# Linkademy — Claude 행동 원칙 + 프로젝트 컨텍스트

---

## 🧠 Claude 행동 원칙

> 이 원칙들은 불필요한 변경, 과도한 복잡성, 실수 후 뒤늦은 질문을 줄이기 위한 지침입니다.

### 1. 코딩 전에 먼저 생각하기

**가정하지 말고, 불확실하면 물어본다.**

- 가정이 있으면 먼저 명시적으로 말한다.
- 해석이 여러 가지라면 조용히 하나를 고르지 말고 선택지를 제시한다.
- 더 단순한 방법이 있으면 말한다. 필요하면 반대 의견도 낸다.
- 뭔가 불명확하면 멈추고, 어디가 불명확한지 짚어서 질문한다.
- **질문은 질문으로만 답한다.** 사용자가 "어떻게 돼?" "왜 안 돼?" 등 현황을 물어보면 설명만 한다. 문제를 발견했다고 해서 허락 없이 바로 수정하지 않는다. 수정이 필요하다면 "고칠까요?" 라고 먼저 묻는다.

### 2. 단순함 우선

**요청한 것만 해결하는 최소한의 코드. 추측성 기능 없음.**

- 요청하지 않은 기능은 추가하지 않는다.
- 한 곳에서만 쓰이는 코드에 추상화 레이어를 만들지 않는다.
- 요청하지 않은 "유연성"이나 "확장성"을 위한 코드는 넣지 않는다.
- 200줄로 쓴 코드가 50줄이 될 수 있다면 다시 쓴다.

스스로 물어보기: "시니어 개발자가 보면 과하다고 할까?" → 그렇다면 단순하게.

### 3. 최소 범위 수정 (Surgical Changes)

**반드시 필요한 곳만 건드린다. 내가 만든 문제만 정리한다.**

기존 코드를 수정할 때:
- 관련 없는 코드·주석·포매팅을 "개선"하지 않는다.
- 안 망가진 건 리팩터링하지 않는다.
- 내 취향이 달라도 기존 코드 스타일에 맞춘다.
- 관련 없는 데드코드를 발견하면 → 삭제 말고 언급만 한다.

내 변경으로 생긴 고아(orphan)는 정리:
- **내 변경으로 인해** 쓰이지 않게 된 import/변수/함수는 제거한다.
- 원래부터 있던 데드코드는 요청 없으면 건드리지 않는다.

기준: 변경된 모든 줄이 사용자 요청으로 직접 이어질 수 있어야 한다.

### 4. 목표 기반 실행

**성공 기준을 먼저 정의하고, 확인될 때까지 반복한다.**

- 변경 후 반드시 `npm run build`로 빌드 검증 → 성공 확인 후 push.
- 여러 단계 작업은 간단한 계획을 먼저 제시한다.
- Push 전 빌드 실패 → 수정 후 재확인, 그 다음 push.
- "일단 해보자" 식의 push는 하지 않는다.

---

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
- **대시보드**: `/dashboard` — 학생 수, 반 수 요약, 진행 중 수업 배너
- **학생 관리**: `/dashboard/students` — 목록/추가/수정/삭제/CSV가져오기/검색, 동일 전화번호 멀티 학원 지원
- **학생 리포트**: `/dashboard/students/[id]` — 출결·성적·숙제 개인 리포트, 퇴원(계정삭제)
  - 성적 차트: LineChart (scrollable), enrolled_at 이전 데이터 제외
  - 시험 점수 내역 더보기/접기 (5개 초과 시)
  - **반 전반(이적) 기능**: 학생을 다른 반으로 이동. 전반 전 반은 `class_transfer_history`에 기록되고, 이적 전 수업 데이터는 새 반에서 제외됨
  - 이적 이력 조회: 전 반 기록을 선택해 해당 기간 데이터만 볼 수 있음
- **반 관리**: `/dashboard/classes` — 반 목록
- **반 상세**: `/dashboard/classes/[id]` — 탭: `schedule | students | calendar | stats | lives`
  - **캘린더 탭**: 출결/숙제/클리닉 기록, 미래 수업일 사전 기록 허용
  - **통계 탭**: 출결 통계 (enrolled_at 기준 필터)
  - **목숨 탭**: 학생별 현재 목숨 수 조회, 수동 조정, 빌보드 미리보기
  - 신입생 enrolled_at 이전 수업 자동 제외
  - 반 기록 전체 초기화 기능 (학생 명단·시간표 제외)
- **시험 관리**: `/dashboard/grades` — 자동/수동 시험 출제, 제출현황, 오답률 분석
  - 문제은행(QuestionBank) 탭 포함
  - 시험 카테고리 필터
  - 시험 문제 드래그 순서 변경
  - 문제 번호 직접 입력 (customLabel)
  - 출제 후 시험 수정 가능
  - 제출 현황 점수 높은 순 정렬 (미제출 하단)
  - **복수정답**: 문제별로 복수정답 토글 가능 (시험 직접 생성 + 문제은행 모두)
- **과제·클리닉**: `/dashboard/homework` — 과제/클리닉 현황, 미완료 학생 파악
  - 과제 제목 인라인 편집 가능
  - 학생별 과제 완료 현황 확인
- **코멘트**: `/dashboard/comments`
- **설정**: `/dashboard/settings`
  - 학원 로고 업로드
  - **목숨 시스템 설정**: 활성화/비활성화, 기본 목숨 수, 자동 규칙(출결·과제·클리닉·시험 점수 기반), 빌보드 설정
  - **코멘트 공개 설정**: 출결·과제·클리닉·시험 코멘트를 학생/학부모별 공개 여부 토글
  - **반 평균 공개 설정**: 학생/학부모 앱에서 반 평균 표시 여부 토글
- **팀 관리**: `/dashboard/team`
- **관리자 페이지**: `/admin` — Linkademy 전체 학원 가입 승인/거부 관리

### 학생 앱 (`/student`)
- 탭: `home / attendance / grades / homework-clinic / exam / settings`
- **홈**: 오늘 수업 카드, 헤더에 학원 로고 표시 (클릭 시 홈 이동), 목숨 수 표시 (활성화 시)
- **출결**: 캘린더, enrolled_at 이전 세션 제외, 행 높이 균일
- **성적**: BarChart (반 평균 비교, scrollable), 시험 등수 표시 (`n명 중 n위`), 카테고리 필터, 점수 수정 표시, 시험 결과 상세(자동채점 답안 확인)
  - 반 평균 공개 설정에 따라 평균 표시/숨김
  - 시험 문의 기능: 시험 결과에서 문제별 질문 등록, 선생님 답변 확인
- **과제·클리닉**: 과제 설명 펼치기/접기, enrolled_at 이전 데이터 제외
- **시험**: 답안 제출 (`ExamTab` 컴포넌트 분리), 시험 이탈 경고, 포기 기능
- **시험 결과**: 제출 즉시 반 통계 확인 (no_deadline 시험)
- **목숨**: 현재 목숨 수, 변동 로그, 빌보드 (설정 활성화 시)

### 학부모 앱 (`/parent`)
- 탭: `home / attendance / grades / homework-clinic / comments / settings`
- **홈**: 헤더에 학원 로고 표시 (클릭 시 홈 이동)
- **출결**: enrolled_at 이전 세션 제외
- **성적**: BarChart 보라색 (`#7c3aed`, scrollable), 카테고리 필터, 점수 수정 표시
  - 반 평균 공개 설정에 따라 평균 표시/숨김
- **과제·클리닉**: 과제 설명 펼치기/접기, enrolled_at 이전 데이터 제외
- **코멘트**: 자녀 코멘트 열람

### 공통 기능
- **PWA 지원**: 홈 화면 추가 가능, `manifest.ts`, `icon.tsx`, `apple-icon.tsx`, `/api/pwa-icon` 라우트
- **커스텀 다이얼로그**: `AppDialog.tsx` — `useDialog()` 훅으로 사용 (브라우저 기본 alert/confirm 대체)
- **앱 전체 탭 전환 애니메이션**: 부드러운 전환
- **전체 텍스트**: '숙제' → '과제'로 통일

## 파일 구조 및 핵심 함수

### 날짜/시간 유틸
**`src/lib/date.ts`** — 한국 시간(KST) 전용 유틸
```typescript
export function todayKST(): string  // 오늘 날짜 'YYYY-MM-DD' (KST)
export function monthsAgoKST(months: number): string  // n개월 전 날짜 (KST)
```
- **반드시 이 함수를 사용할 것.** `new Date().toISOString().slice(0,10)`은 UTC 기준이라 한국 자정~오전 9시 사이에 날짜가 틀릴 수 있음.
- DB 타임스탬프(`submitted_at`, `updated_at` 등)는 UTC 그대로 저장 (정상).

### 목숨 시스템
**`src/lib/lives-auto.ts`** — 목숨 자동 계산 엔진
- `checkCondition(rule, eventType, eventDetail)` — 규칙 조건 매칭
- `recalculateStudent(db, academyId, studentId)` — 학생 1명 목숨 재계산 (실시간 트리거용)
- `recalculate(db, academyId)` — 전체 학생 일괄 재계산
- `repairStudentLives(db, academyId, studentId)` — DB에 남은 행 기준으로 lives_after·목숨 수 재정렬
- `dedupeLog(db, academyId, studentId?)` — 같은 `event_key` 중복 행 제거 (중복 없으면 조회 1회로 종료)
- 이벤트 타입: `'attendance' | 'homework' | 'clinic' | 'exam_score'`
- 과제 미기록 상태: `'unrecorded'` (rules에서 조건으로 설정 가능)

**계산 모델**
- 기준일(`effectiveFrom`) = max(`academies.lives_auto_from`, 학생 `enrolled_at`)
- 기준일 이전 기록은 rule/init/manual 모두 삭제. 기준일 이후만 계산 대상
- 기본 목숨(`init`)부터 시작해 규칙을 날짜순으로 누적 → `lives_after`, `student_lives.lives` 기록
- **`lives_after`는 화면에 표시하지 않음.** 목록 정렬은 `triggered_at`(계산 시각) 기준인데
  누적은 `created_at`(사건 날짜) 순이라 순서가 어긋나 보임. 증감(delta)만 표시하고
  누적값은 내부 검증용으로만 사용 (`repairStudentLives`가 어긋남 감지에 씀)
- 퇴원(`status='inactive'`) 학생은 계산 대상 제외 (기존 기록은 보존)
- 자동화가 꺼져 있으면 `recalculateStudent()`/`recalculate()` 모두 아무것도 건드리지 않음

**동시 실행 대비 (중요)**
- 재계산은 delete-then-insert 방식이라 원자적이지 않음
- 재계산이 겹치면 같은 `event_key` 행이 중복 생성될 수 있어,
  `flushStudent()`/`recalculate()` 끝에서 `dedupeLog()`가 중복을 정리하고 `lives_after`를 복구함
- **재계산 호출은 반드시 `after()` 사용.** `void` 로 띄우면 Vercel이 응답 시점에
  함수를 얼려버려 작업이 중간에 정지하고, 나중에 뒤늦게 재개되며 데이터가 깨짐
- 재계산을 호출하는 라우트에는 `export const maxDuration = 60` 필수

### 선생님 — 시험 관리
**`src/app/dashboard/grades/page.tsx`**
- 컴포넌트: `ManualScoreView` (수동채점), `AutoMonitorView` (자동채점 모니터링)
- 주요 함수: `addManualExam()`, `addAutoExam()`, `refreshSubmissions()`, `deleteExam()`, `revealAnswers()`
- 날짜입력: `DateTimePicker`, `isDTValPartial()`, `dtValErrors()`, `dtValToISO()`
- 문항 편집: `WizardQuestionCard`, `WizardSubQCard`, `newWizardQ()` (기본 5지선다, 기본 배점 1점)
- **복수정답**: `WizardQuestion.multipleCorrect: boolean`, `correctChoiceIdxs: number[]` (단일답은 `[idx]`, 복수답은 배열)
- 점수유틸: `pct()`, `scoreColor()`, `scoreBg()`, `fmt()`
- 시험상태: `'scheduled' | 'active' | 'closed'`
- answer_reveal: `'after_close' | 'never' | 'revealed'`
- 카테고리: `categoryFilter` state, `saveCategoryOnly()` (inline edit)
- wizard 흐름 (no_deadline): `type_select → auto_deadline → auto_1 → auto_2`

**`src/app/dashboard/grades/QuestionBank.tsx`** — 문제은행 컴포넌트
- `qb_folders` / `qb_sets` / `qb_questions` / `qb_choices` / `qb_answers` DB 테이블 사용
- 폴더/세트 구조, 문제 편집, 시험에 가져오기
- `customLabel` 필드로 문제 번호 직접 입력 가능
- **복수정답**: `QBQuestion.multipleCorrect: boolean`, `correctChoiceIdxs: number[]`

### 선생님 — 반 상세 (캘린더/출결/숙제/클리닉/목숨)
**`src/app/dashboard/classes/[id]/page.tsx`**
- Tab: `'schedule' | 'students' | 'calendar' | 'stats' | 'lives'`
- `selectDate()` — 날짜 클릭 시 세션/클리닉세션 로드, clinicAttList 설정
- `markAttendance()` — 출결 기록 (세션 없으면 자동 생성)
- `markClinicAttendance()` — 클리닉 기록 (세션 없으면 자동 생성)
- `markAllPresent()`, `markAllClinicDone()` — 전체 처리
- `addHomework()`, `deleteHomework()`, `saveHomeworkTitle()` — 과제 관리 (제목 인라인 편집 포함)
- `setHomeworkStatus()`, `saveHwNote()` — 과제 상태·메모 저장 (오류 시 사용자 알림)
- `loadHomeworkStatuses(hwId)` — 지연 로드 (이미 로드된 hwId는 스킵)
- `addExtraSession()`, `addExtraClinicSession()` — 비정기 수업/클리닉 추가
- `deleteSession()`, `deleteClinicSession()` — 삭제
- `loadAttendanceStats()` — 출결 통계 (enrolled_at 기준 필터)
- `loadLives()`, `applyLivesRule()` — 목숨 탭 데이터 로드 및 실시간 규칙 적용
- 클리닉 탭: `clinicAttList.length === 0`이면 "클리닉 추가" 버튼, `> 0`이면 학생 목록
- 반 기록 초기화: `POST /api/classes/[classId]/reset`

**출결/숙제 코멘트 UX:**
- 코멘트 입력란은 기본적으로 숨김. 내용이 있으면 자동으로 표시.
- 버튼(MessageSquare 아이콘)으로 토글. 내용 있으면 아이콘 색상으로 표시.
- **출석 포함 모든 출결 상태**(present/late/early_leave/absent)에서 코멘트 입력 가능.

### 선생님 — 학생 상세
**`src/app/dashboard/students/[id]/page.tsx`**
- `handleTransfer()` — 반 전반 처리: 현재 반을 `class_transfer_history`에 기록 후 새 반 배정
- `loadStudent()` — 학생 기본 정보 + 반 배정 + 이적 이력 조회
- `withdrawStudent()` — 퇴원 처리 + `/api/delete-account` 호출로 학생·학부모 계정 삭제
- `loadClassDetail()` — 성적/출결/숙제 데이터 로드 (enrolled_at 또는 joined_at 기준 필터)
- 이적 이력(`class_transfer_history`)으로 특정 기간 필터 조회 가능
- 시험 점수 내역: 5개 초과 시 더보기/접기 (`showAllGrades` state)

### 선생님 — 과제 현황
**`src/app/dashboard/homework/page.tsx`**
- `loadClassData()` — Round1(학생/과제/클리닉/일정 4개 병렬) + Round2(상태 2개 병렬) 구조
- `HwStatusBadge`: `none → '미완료'`, `done → '완료'`, `partial → '오답(완벽) 완료'`
- 과제 상태: `'done' | 'partial' | 'none'` (none = 미완료)

### 학생 앱
**`src/app/student/page.tsx`**
- Tab: `'home' | 'attendance' | 'grades' | 'homework-clinic' | 'exam' | 'settings'`
- `openExamResult(examId, rankInfo?)` — `/api/exams/[examId]/student-result` 호출
- 성적 차트: BarChart (반 평균 비교), scrollable, 카테고리 필터
- 시험 등수: `t.rank`, `t.totalSubmitted` → `n명 중 n위` 형식
- `academyLogo` state: 헤더 로고 표시
- 출결/과제 코멘트: 40자 초과 시 2줄 clamp + "자세히 보기" 토글 (`expandedNotes: Set<string>`)
- 목숨: `myLives`, `livesLog`, `billboard` state — `/api/lives` 및 `/api/lives/billboard` 호출
- 시험 문의: `inquiryText` state — `/api/exam-inquiries` 호출

**`src/app/student/ExamTab.tsx`** — 시험 탭 컴포넌트
- 진행 중인 시험 목록, 답안 제출, 시험 이탈 경고 다이얼로그, 포기 처리

### 학부모 앱
**`src/app/parent/page.tsx`**
- Tab: `'home' | 'attendance' | 'grades' | 'homework-clinic' | 'comments' | 'settings'`
- 성적 차트: BarChart 보라색 (`#7c3aed`), scrollable, 카테고리 필터
- `academyLogo` state: 헤더 로고 표시
- 출결/과제 코멘트: 학생 앱과 동일한 "자세히 보기" 토글 UX

### 공통 컴포넌트
**`src/components/AppDialog.tsx`** — 커스텀 다이얼로그
- `useDialog()` 훅: `alert(msg)`, `confirm(msg) → Promise<boolean>` 반환
- **반드시 이 훅을 사용할 것.** 브라우저 기본 `alert()`/`confirm()` 사용 금지.

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
| `/api/dashboard/exam-groups` | GET | 날짜+카테고리 기준 시험 그룹 (대시보드용) |

### 시험 문의
| 경로 | 메서드 | 설명 |
|---|---|---|
| `/api/exam-inquiries` | GET | 학생 본인 문의 조회 / 선생님 전체 조회 |
| `/api/exam-inquiries` | POST | 학생 문의 등록 |
| `/api/exam-inquiries/[id]` | GET/PATCH/DELETE | 개별 문의 조회·수정·삭제 |
| `/api/exam-inquiries/[id]/reply` | POST | 선생님 답변 등록 |

### 문제은행
| 경로 | 메서드 | 설명 |
|---|---|---|
| `/api/question-bank` | GET | 폴더/세트 목록 (문제 수 포함) |
| `/api/question-bank` | POST | 폴더/세트 생성·수정·삭제 |
| `/api/question-bank/[setId]` | GET | 세트 내 문제 목록 |
| `/api/question-bank/[setId]` | POST | 문제 저장 (전체 upsert) |

### 성적/출결/과제
| 경로 | action | 설명 |
|---|---|---|
| `/api/grades` | GET `parent-chart` | 학부모 성적 차트 (enrolled_at 필터, 반평균 공개 설정 적용) |
| `/api/grades` | GET `parent-homework` | 학부모 과제 현황 + note (enrolled_at 필터) |
| `/api/grades` | GET `parent-clinic` | 학부모 클리닉 현황 (enrolled_at 필터) |
| `/api/grades` | GET `parent-comments` | 학부모 코멘트 |
| `/api/grades` | GET `my-grades` | 학생 성적 (avgPct, rank 포함, enrolled_at 필터, 반평균 공개 설정 적용) |
| `/api/grades` | GET `my-homework` | 학생 과제 + note (enrolled_at 필터) |
| `/api/grades` | GET `my-clinic` | 학생 클리닉 (enrolled_at 필터) |
| `/api/grades` | GET `my-attendance` | 학생 출결 + note (enrolled_at 필터) |
| `/api/grades` | GET `tests` | 선생님 시험 목록+통계 |
| `/api/grades` | GET `scores` | 특정 시험 점수 |
| `/api/grades` | GET `student-chart` | 학생 리포트 성적 (enrolled_at 필터) |
| `/api/grades` | POST | 수동 점수 저장 |

### 목숨 시스템
| 경로 | action | 설명 |
|---|---|---|
| `/api/lives` | GET `my-lives` | 학생 본인 목숨 수 조회 |
| `/api/lives` | GET `rules` | 학원 목숨 규칙 목록 |
| `/api/lives` | GET `lives-log` | 학생 목숨 변동 로그 |
| `/api/lives` | POST `apply-rules` | 이벤트 발생 시 실시간 규칙 적용 (→ 내부적으로 recalculateStudent) |
| `/api/lives` | POST `apply-rules-bulk` | 여러 학생 일괄 재계산 (전체 출석 처리, 과제 삭제 등). 4명씩 나눠 처리 |
| `/api/lives` | POST `manual-adjust` | 선생님 수동 목숨 조정 |
| `/api/lives` | POST `save-auto-settings` | 자동화 설정 저장 (활성화 여부, 기준일) |
| `/api/lives` | POST `create-rule` | 규칙 생성 |
| `/api/lives` | POST `update-rule` | 규칙 수정 |
| `/api/lives` | POST `delete-rule` | 규칙 삭제 |
| `/api/lives` | POST `reorder-rules` | 규칙 순서 변경 |
| `/api/lives` | POST `recalculate` | 전체 학생 목숨 일괄 재계산 |
| `/api/lives/billboard` | GET | 반별 목숨 빌보드 |

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
academies (id, name, teacher_id, logo_url, status 'pending'|'approved'|'rejected',
           lives_enabled boolean, lives_default int, lives_billboard_enabled boolean,
           lives_billboard_show_last boolean, lives_auto_enabled boolean, lives_auto_from date,
           comment_vis_att_student boolean, comment_vis_att_parent boolean,
           comment_vis_hw_student boolean, comment_vis_hw_parent boolean,
           comment_vis_clinic_student boolean, comment_vis_clinic_parent boolean,
           comment_vis_exam_student boolean, comment_vis_exam_parent boolean,
           show_class_avg_parent boolean, show_class_avg_student boolean)
classes (id, academy_id, name)
class_schedules (id, class_id, day_of_week 0-6, start_time, end_time)
class_students (class_id, student_id, joined_at timestamp)
class_transfer_history (id, student_id, class_id, class_name, joined_at date, left_at date)
sessions (id, class_id, date, start_time, end_time, status, note)
students (id, academy_id, user_id, name, school_name, grade, phone, parent_phone, parent_relation, memo, enrolled_at)
attendance (id, session_id, student_id, status 'present'|'late'|'early_leave'|'absent', note)
homework (id, class_id, title, description, assigned_date, due_date)
homework_status (id, homework_id, student_id, status 'done'|'partial'|'none', note text)
clinic_schedules (id, class_id, name, day_of_week, start_time, end_time)
clinic_sessions (id, class_id, date, name, start_time, end_time, note)
clinic_attendance (id, clinic_session_id, student_id, status 'done'|'not_done')
comments (id, student_id, teacher_id, date, content)
parent_students (parent_id, student_id) — 학부모-학생 연결
academy_teachers (academy_id, teacher_id) — 팀 선생님
exams (id, class_id, title, exam_type 'auto'|'manual', status 'scheduled'|'active'|'closed',
       answer_reveal 'after_close'|'never'|'revealed', start_at, end_at, max_score, created_at,
       no_deadline boolean DEFAULT false, category text)
exam_questions (id, exam_id, parent_id nullable, order_num, question_text,
                question_type 'multiple_choice'|'short_answer'|'group', score,
                custom_label text, group_context text)
exam_choices (id, question_id, choice_num, choice_text)
exam_correct_answers (id, question_id, answer_text, order_num)
exam_submissions (id, exam_id, student_id, is_submitted, submitted_at, auto_score, adjusted_score,
                  is_forfeited boolean DEFAULT false)
exam_student_answers (id, submission_id, question_id, student_answer, is_correct, score_earned, manually_overridden)
exam_inquiries (id, exam_id, student_id, question_id nullable, body, created_at)
exam_inquiry_replies (id, inquiry_id, teacher_id, body, created_at)
qb_folders (id, academy_id, name, parent_id, created_at)
qb_sets (id, academy_id, title, folder_id, created_at, updated_at)
qb_questions (id, set_id, parent_id nullable, order_num, custom_label, question_text,
               question_type 'multiple_choice'|'short_answer'|'group', score, group_context)
qb_choices (id, question_id, choice_num, choice_text)
qb_answers (id, question_id, answer_text, order_num)
student_lives (academy_id, student_id, lives int, updated_at)
student_lives_log (id, academy_id, student_id, delta int, reason text, source 'rule'|'manual'|'init',
                   lives_after int, created_at, triggered_at, event_key text)
lives_rules (id, academy_id, name, condition_type 'attendance'|'homework'|'clinic'|'exam_score',
             condition_detail jsonb, delta int, enabled boolean, order_num int, created_at)
```

## 주요 설계 원칙 / 자주 쓰는 패턴

### 과제/클리닉 상태
- `'done'` = 완료, `'partial'` = 오답(완벽) 완료, `'none'` = **미완료** (미제출 아님!)
- 클리닉: `'done'` = 완료, `'not_done'` = 미완료
- 목숨 규칙용 과제 미기록 상태: `'unrecorded'` (DB에 행이 없는 상태)

### enrolled_at / joined_at 필터
- `enrolled_at`: 학생이 학원에 처음 등록한 날짜 (`students` 테이블)
- `joined_at`: 학생이 특정 반에 들어온 날짜 (`class_students` 테이블) — 반 전반 시 갱신됨
- 모든 학생/학부모 앱 데이터 API에 enrolled_at 필터 적용 (출결·성적·과제·클리닉)
- 반 전반 후에는 joined_at을 기준으로 이전 반 데이터 제외
- 선생님 학생 리포트 및 출결 통계도 동일 적용

### 반 전반 (Class Transfer)
- `handleTransfer()` 실행 시:
  1. 현재 반 정보를 `class_transfer_history`에 INSERT (joined_at, left_at 포함)
  2. 기존 `class_students` 삭제 후 새 반으로 재INSERT (joined_at = 오늘)
- 이적 이력 조회: `class_transfer_history`에서 기간 선택 → 해당 기간 데이터만 표시

### 반 평균 공개 설정
- `academies.show_class_avg_parent`, `show_class_avg_student` 컬럼으로 제어
- `grades/route.ts`의 `getCommentVis()`가 설정값 반환
- 공개 OFF 시: API에서 `avgScore`, `avgPct`, `classHigh`, `classLow` null 처리 후 반환
- 프론트엔드 변경 불필요 (null이면 미표시)

### 복수정답 (Multiple Correct Answers)
- `multipleCorrect: boolean` — 문제별 토글 플래그
- `correctChoiceIdxs: number[]` — 정답 인덱스 배열 (단일답도 배열, e.g. `[2]`)
- 저장 시: `correctChoiceIdxs.sort().map(i => String(i + 1))` → `exam_correct_answers`
- 불러올 시: `answers.map(a => parseInt(a) - 1)`, `multipleCorrect = answers.length > 1`
- UI: `multipleCorrect=false` → 라디오(rounded-full), `true` → 체크박스(rounded-md)
- "복수정답" 알약 버튼: ON → `bg-blue-600 text-white`, OFF → 회색 테두리

### 코멘트 공개 설정
- `academies`의 `comment_vis_*` 컬럼 8개 (출결/과제/클리닉/시험 × 학생/학부모)
- `grades/route.ts`의 `getCommentVis()`에서 한번에 조회 후 각 action에 적용

### 목숨 시스템 규칙
- 이벤트 발생(출결 기록, 과제 상태 변경 등) → `applyLivesRule()` 호출 → POST `/api/lives`
- 여러 학생이 한꺼번에 바뀌면 `applyLivesRuleBulk(studentIds)` — 요청 1회로 묶어서 처리.
  **학생 수만큼 요청을 동시에 쏘지 말 것** (전체 출석 처리 시 요청이 몰려 실패함)
- 내부적으로 항상 `recalculateStudent()` 전체 재계산 (단건 delta 계산 아님)
- 규칙 우선순위: order_num → created_at 순. 이벤트당 첫 번째 매칭 규칙만 적용
- 시험 규칙: 미제출 규칙 먼저 체크 → 통과 시 점수 규칙 체크
- 데이터가 바뀌면 재계산이 필요함에 유의 (예: 과제 삭제 시 그 과제로 인한 차감도 사라져야 함).
  단, 과제 **생성**은 트리거하지 않음 — '미기록' 규칙 때문에 전원 목숨이 즉시 떨어져 혼란스럽고,
  어차피 다음 이벤트의 전체 재계산에서 반영됨

### 시험 점수 계산
- 자동채점: `exam_questions.score` 합계 = 만점
- 수동채점: `exams.max_score` = 만점
- 통합 패턴: `exam.max_score ?? maxScoreByExam[exam.id] ?? null`
- 문제 기본 배점: 1점 (`newWizardQ()`의 score 기본값)

### 마감 방식 (no_deadline)
- `no_deadline=false` (기본): 마감 있는 시험 — status='closed' 이후 학생 결과 열람 가능
- `no_deadline=true`: 마감 없는 시험 — 제출 즉시 결과+반 통계 열람, 미제출 학생은 계속 응시 가능
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

### Supabase 서버 클라이언트 사용 시 주의
```typescript
// ❌ 금지: 모듈 레벨에서 createClient 호출 → Vercel 빌드 실패
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ...)

// ✅ 올바른 방법: 함수 안에서 생성
function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
```

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
