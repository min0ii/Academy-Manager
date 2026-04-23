# 수학학원 관리 시스템 — 프로젝트 컨텍스트

## 기본 정보
- **프로젝트 경로**: `/Users/user/Desktop/수학학원 관리시스템 제작/math-academy`
- **GitHub**: https://github.com/min0ii/Academy-Manager
- **Supabase Project ID**: avjlmhmwkogmvxmaqskv
- **기술 스택**: Next.js (App Router) + Tailwind CSS + Supabase + Vercel
- **소통 언어**: 한국어 (사용자는 개발 경험 없음, 모든 설명을 쉽고 친절하게)

## 인증 방식
- 화면에서는 **전화번호 + 비밀번호**로 로그인
- 내부적으로 `{전화번호숫자}@academy.local` 형식의 이메일로 Supabase Auth 사용
- `src/lib/auth.ts`의 `phoneToEmail()`, `formatPhone()` 함수 참고

## 완료된 기능

### 인증
- `/login` — 전화번호 + 비밀번호 로그인 (전화번호 자동 하이픈 포맷)
- `/signup` — 선생님/학생/학부모 역할 선택 후 가입
- `/onboarding` — 선생님 최초 가입 시 학원 설정 (로고, 학원명, 반, 학생 명부)

### 선생님 대시보드
- `/dashboard` — 학원명, 학생 수, 반 수 요약 + 메뉴 카드
- 레이아웃: PC는 사이드바, 모바일은 햄버거 메뉴
- `src/app/dashboard/layout.tsx` — 공통 레이아웃

### 학생 관리 (`/dashboard/students`)
- 전체 학생 목록 (검색: 이름/학교/학년/전화번호)
- 학생 추가/수정/삭제
- 학생 카드 클릭 시 상세 정보 펼치기
- **선택 삭제**: 여러 명 체크 후 한 번에 삭제
- **CSV 가져오기**: 구글 스프레드시트 → CSV 다운로드 후 업로드
  - 컬럼 순서: No, 학생명, 학교명, 학년, 학부모연락처, 학생연락처
  - 학부모 연락처의 (부), (모) 등 괄호 표시 자동 제거
  - **중복 처리**: 전화번호 일치 시 "덮어쓰기 / 건너뛰기 / 전체취소" 선택 모달

### 임시 페이지 (미구현 — 🚧 표시)
- `/dashboard/classes` — 반 관리
- `/dashboard/attendance` — 출결 관리
- `/dashboard/grades` — 성적 관리
- `/dashboard/homework` — 숙제·클리닉
- `/dashboard/comments` — 코멘트
- `/dashboard/settings` — 설정

## 다음 작업: 반 관리 (`/dashboard/classes`)

### 요구사항
1. **반 목록**: 반 이름, 소속 학생 수 표시
2. **반 상세 페이지**: 클릭하면 이동
   - 반 이름 수정/삭제
   - 정기 시간표 설정 (요일 + 시작/종료 시간, 여러 개 가능)
   - 소속 학생 목록 + 학생 정보 수정 가능
   - 학생 배정/해제 가능
3. **수업 세션 관리**
   - 기간 + 요일 지정으로 세션 일괄 생성
     - 예: "4월 20일 ~ 6월 13일, 매주 목요일, 오후 3시~5시"
   - 생성된 세션 수정 (시간 변경, 휴강 처리)
   - 보강 수업 추가 (비정기)
4. **학생 배정**: 반 관리 화면에서도 학생 추가/제거 가능
   - 학생 관리 화면에서도 반 배정 가능 (기존 방식 유지)

## DB 스키마 주요 테이블
```
profiles (id, phone, name, role)
academies (id, name, teacher_id, logo_url)
classes (id, academy_id, name)
class_schedules (id, class_id, day_of_week 0-6, start_time, end_time)
class_students (class_id, student_id)
sessions (id, class_id, date, start_time, end_time, status 'held'|'cancelled', note)
students (id, academy_id, user_id, name, school_name, grade, phone, parent_phone, parent_relation, memo, enrolled_at)
attendance (id, session_id, student_id, status, late_minutes, early_leave_minutes)
grades (id, session_id, student_id, type 'example'|'review'|'test', score, max_score, note)
homework (id, class_id, title, description, assigned_date, due_date)
homework_status (id, homework_id, student_id, status 'done'|'partial'|'none')
clinics (id, class_id, date, scope)
clinic_status (id, clinic_id, student_id, status 'done'|'partial'|'none')
comments (id, student_id, teacher_id, date, content)
```

## RLS 정책
- `is_teacher()` 헬퍼 함수 (SECURITY DEFINER) 사용 — 재귀 방지
- 선생님: 모든 테이블 전체 접근
- 학생: 본인 관련 데이터만 조회
- 학부모: 연결된 자녀 데이터만 조회

## 파일 구조
```
src/
├── app/
│   ├── layout.tsx (Pretendard 폰트)
│   ├── page.tsx (/login 리다이렉트)
│   ├── login/page.tsx
│   ├── signup/page.tsx
│   ├── onboarding/page.tsx
│   ├── dashboard/
│   │   ├── layout.tsx (사이드바 레이아웃)
│   │   ├── page.tsx (메인 대시보드)
│   │   ├── students/page.tsx ✅ 완성
│   │   ├── classes/page.tsx 🚧
│   │   ├── attendance/page.tsx 🚧
│   │   ├── grades/page.tsx 🚧
│   │   ├── homework/page.tsx 🚧
│   │   ├── comments/page.tsx 🚧
│   │   └── settings/page.tsx 🚧
│   ├── student/ (학생 포털 🚧)
│   └── parent/ (학부모 포털 🚧)
└── lib/
    ├── supabase.ts
    └── auth.ts (phoneToEmail, formatPhone, signIn, signUp, signOut, getProfile)
```

## 개발 서버 실행
```bash
cd "/Users/user/Desktop/수학학원 관리시스템 제작/math-academy"
npm run dev
```
→ http://localhost:3000
