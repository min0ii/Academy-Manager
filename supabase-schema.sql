-- =============================================
-- 수학학원 관리 시스템 DB 스키마
-- Supabase SQL Editor에 붙여넣고 실행하세요
-- =============================================

-- 1. 사용자 프로필 (Supabase Auth와 연결)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'student', 'parent')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 학원 정보
CREATE TABLE academies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  teacher_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 반(클래스)
CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  academy_id UUID REFERENCES academies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 반 정기 시간표
CREATE TABLE class_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=일, 1=월 ... 6=토
  start_time TIME NOT NULL,
  end_time TIME NOT NULL
);

-- 5. 학생 명부
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  academy_id UUID REFERENCES academies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id),  -- 계정 생성 전엔 NULL
  name TEXT NOT NULL,
  grade TEXT NOT NULL,
  phone TEXT NOT NULL,
  memo TEXT,
  enrolled_at DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. 학생 ↔ 반 연결 (한 학생이 여러 반 가능)
CREATE TABLE class_students (
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, student_id)
);

-- 7. 학부모 ↔ 학생 연결
CREATE TABLE parent_student (
  parent_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL,  -- "엄마", "아빠", "할머니" 등 자유입력
  PRIMARY KEY (parent_id, student_id)
);

-- 8. 실제 수업 세션
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'cancelled')),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. 출결
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'early_leave')),
  late_minutes INTEGER,
  early_leave_minutes INTEGER,
  UNIQUE (session_id, student_id)
);

-- 10. 성적
CREATE TABLE grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('example', 'review', 'test')),
  score NUMERIC NOT NULL,
  max_score NUMERIC NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. 숙제
CREATE TABLE homework (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assigned_date DATE NOT NULL,
  due_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. 숙제 이행 현황 (학생별)
CREATE TABLE homework_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  homework_id UUID REFERENCES homework(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'none' CHECK (status IN ('done', 'partial', 'none')),
  UNIQUE (homework_id, student_id)
);

-- 13. 클리닉
CREATE TABLE clinics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  scope TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. 클리닉 참여 현황 (학생별)
CREATE TABLE clinic_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'none' CHECK (status IN ('done', 'partial', 'none')),
  UNIQUE (clinic_id, student_id)
);

-- 15. 선생님 코멘트
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES profiles(id),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- RLS (Row Level Security) 활성화
-- =============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE academies ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_student ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE homework ENABLE ROW LEVEL SECURITY;
ALTER TABLE homework_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS 정책: 선생님은 모든 데이터 접근 가능
-- =============================================
CREATE POLICY "선생님 전체 접근" ON profiles FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
  OR id = auth.uid()
);

CREATE POLICY "선생님 전체 접근" ON academies FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
);

CREATE POLICY "선생님 전체 접근" ON classes FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
);

CREATE POLICY "선생님 전체 접근" ON class_schedules FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
);

CREATE POLICY "선생님 전체 접근" ON students FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
);

CREATE POLICY "선생님 전체 접근" ON class_students FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
);

CREATE POLICY "선생님 전체 접근" ON parent_student FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
);

CREATE POLICY "선생님 전체 접근" ON sessions FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
);

CREATE POLICY "선생님 전체 접근" ON attendance FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
);

CREATE POLICY "선생님 전체 접근" ON grades FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
);

CREATE POLICY "선생님 전체 접근" ON homework FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
);

CREATE POLICY "선생님 전체 접근" ON homework_status FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
);

CREATE POLICY "선생님 전체 접근" ON clinics FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
);

CREATE POLICY "선생님 전체 접근" ON clinic_status FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
);

CREATE POLICY "선생님 전체 접근" ON comments FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
);

-- =============================================
-- RLS 정책: 학생은 본인 데이터만 조회
-- =============================================
CREATE POLICY "학생 본인 조회" ON students FOR SELECT USING (
  user_id = auth.uid()
);

CREATE POLICY "학생 출결 조회" ON attendance FOR SELECT USING (
  EXISTS (SELECT 1 FROM students WHERE id = student_id AND user_id = auth.uid())
);

CREATE POLICY "학생 성적 조회" ON grades FOR SELECT USING (
  EXISTS (SELECT 1 FROM students WHERE id = student_id AND user_id = auth.uid())
);

CREATE POLICY "학생 숙제 조회" ON homework_status FOR SELECT USING (
  EXISTS (SELECT 1 FROM students WHERE id = student_id AND user_id = auth.uid())
);

CREATE POLICY "학생 클리닉 조회" ON clinic_status FOR SELECT USING (
  EXISTS (SELECT 1 FROM students WHERE id = student_id AND user_id = auth.uid())
);

CREATE POLICY "학생 코멘트 조회" ON comments FOR SELECT USING (
  EXISTS (SELECT 1 FROM students WHERE id = student_id AND user_id = auth.uid())
);

-- =============================================
-- RLS 정책: 학부모는 자녀 데이터만 조회
-- =============================================
CREATE POLICY "학부모 자녀 조회" ON students FOR SELECT USING (
  EXISTS (SELECT 1 FROM parent_student WHERE parent_id = auth.uid() AND student_id = students.id)
);

CREATE POLICY "학부모 출결 조회" ON attendance FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM parent_student
    WHERE parent_id = auth.uid() AND student_id = attendance.student_id
  )
);

CREATE POLICY "학부모 성적 조회" ON grades FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM parent_student
    WHERE parent_id = auth.uid() AND student_id = grades.student_id
  )
);

CREATE POLICY "학부모 숙제 조회" ON homework_status FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM parent_student
    WHERE parent_id = auth.uid() AND student_id = homework_status.student_id
  )
);

CREATE POLICY "학부모 클리닉 조회" ON clinic_status FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM parent_student
    WHERE parent_id = auth.uid() AND student_id = clinic_status.student_id
  )
);

CREATE POLICY "학부모 코멘트 조회" ON comments FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM parent_student
    WHERE parent_id = auth.uid() AND student_id = comments.student_id
  )
);

-- =============================================
-- 신규 가입 시 profiles 자동 생성 트리거
-- =============================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, phone, name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.phone, ''),
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
