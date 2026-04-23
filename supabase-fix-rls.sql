-- =============================================
-- 기존 정책 전부 삭제
-- =============================================
DROP POLICY IF EXISTS "선생님 전체 접근" ON profiles;
DROP POLICY IF EXISTS "선생님 전체 접근" ON academies;
DROP POLICY IF EXISTS "선생님 전체 접근" ON classes;
DROP POLICY IF EXISTS "선생님 전체 접근" ON class_schedules;
DROP POLICY IF EXISTS "선생님 전체 접근" ON students;
DROP POLICY IF EXISTS "선생님 전체 접근" ON class_students;
DROP POLICY IF EXISTS "선생님 전체 접근" ON parent_student;
DROP POLICY IF EXISTS "선생님 전체 접근" ON sessions;
DROP POLICY IF EXISTS "선생님 전체 접근" ON attendance;
DROP POLICY IF EXISTS "선생님 전체 접근" ON grades;
DROP POLICY IF EXISTS "선생님 전체 접근" ON homework;
DROP POLICY IF EXISTS "선생님 전체 접근" ON homework_status;
DROP POLICY IF EXISTS "선생님 전체 접근" ON clinics;
DROP POLICY IF EXISTS "선생님 전체 접근" ON clinic_status;
DROP POLICY IF EXISTS "선생님 전체 접근" ON comments;
DROP POLICY IF EXISTS "학생 본인 조회" ON students;
DROP POLICY IF EXISTS "학생 출결 조회" ON attendance;
DROP POLICY IF EXISTS "학생 성적 조회" ON grades;
DROP POLICY IF EXISTS "학생 숙제 조회" ON homework_status;
DROP POLICY IF EXISTS "학생 클리닉 조회" ON clinic_status;
DROP POLICY IF EXISTS "학생 코멘트 조회" ON comments;
DROP POLICY IF EXISTS "학부모 자녀 조회" ON students;
DROP POLICY IF EXISTS "학부모 출결 조회" ON attendance;
DROP POLICY IF EXISTS "학부모 성적 조회" ON grades;
DROP POLICY IF EXISTS "학부모 숙제 조회" ON homework_status;
DROP POLICY IF EXISTS "학부모 클리닉 조회" ON clinic_status;
DROP POLICY IF EXISTS "학부모 코멘트 조회" ON comments;
DROP POLICY IF EXISTS "본인 프로필 생성" ON profiles;

-- =============================================
-- 재귀 방지용 헬퍼 함수 (SECURITY DEFINER = RLS 우회)
-- =============================================
CREATE OR REPLACE FUNCTION is_teacher()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher'
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- =============================================
-- profiles: 본인만 접근 (재귀 없이)
-- =============================================
CREATE POLICY "본인 프로필 접근" ON profiles FOR ALL USING (id = auth.uid());
CREATE POLICY "본인 프로필 생성" ON profiles FOR INSERT WITH CHECK (id = auth.uid());

-- =============================================
-- 나머지 테이블: 선생님 전체 / 학생·학부모 본인 데이터
-- =============================================

-- academies
CREATE POLICY "선생님 접근" ON academies FOR ALL USING (is_teacher());

-- classes
CREATE POLICY "선생님 접근" ON classes FOR ALL USING (is_teacher());
CREATE POLICY "학생·학부모 조회" ON classes FOR SELECT USING (
  EXISTS (SELECT 1 FROM class_students cs
    JOIN students s ON s.id = cs.student_id
    WHERE cs.class_id = classes.id AND s.user_id = auth.uid())
);

-- class_schedules
CREATE POLICY "선생님 접근" ON class_schedules FOR ALL USING (is_teacher());

-- students
CREATE POLICY "선생님 접근" ON students FOR ALL USING (is_teacher());
CREATE POLICY "학생 본인 조회" ON students FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "학부모 자녀 조회" ON students FOR SELECT USING (
  EXISTS (SELECT 1 FROM parent_student WHERE parent_id = auth.uid() AND student_id = students.id)
);

-- class_students
CREATE POLICY "선생님 접근" ON class_students FOR ALL USING (is_teacher());

-- parent_student
CREATE POLICY "선생님 접근" ON parent_student FOR ALL USING (is_teacher());
CREATE POLICY "학부모 본인 조회" ON parent_student FOR SELECT USING (parent_id = auth.uid());

-- sessions
CREATE POLICY "선생님 접근" ON sessions FOR ALL USING (is_teacher());

-- attendance
CREATE POLICY "선생님 접근" ON attendance FOR ALL USING (is_teacher());
CREATE POLICY "학생 본인 조회" ON attendance FOR SELECT USING (
  EXISTS (SELECT 1 FROM students WHERE id = student_id AND user_id = auth.uid())
);
CREATE POLICY "학부모 자녀 조회" ON attendance FOR SELECT USING (
  EXISTS (SELECT 1 FROM parent_student WHERE parent_id = auth.uid() AND student_id = attendance.student_id)
);

-- grades
CREATE POLICY "선생님 접근" ON grades FOR ALL USING (is_teacher());
CREATE POLICY "학생 본인 조회" ON grades FOR SELECT USING (
  EXISTS (SELECT 1 FROM students WHERE id = student_id AND user_id = auth.uid())
);
CREATE POLICY "학부모 자녀 조회" ON grades FOR SELECT USING (
  EXISTS (SELECT 1 FROM parent_student WHERE parent_id = auth.uid() AND student_id = grades.student_id)
);

-- homework
CREATE POLICY "선생님 접근" ON homework FOR ALL USING (is_teacher());

-- homework_status
CREATE POLICY "선생님 접근" ON homework_status FOR ALL USING (is_teacher());
CREATE POLICY "학생 본인 조회" ON homework_status FOR SELECT USING (
  EXISTS (SELECT 1 FROM students WHERE id = student_id AND user_id = auth.uid())
);
CREATE POLICY "학부모 자녀 조회" ON homework_status FOR SELECT USING (
  EXISTS (SELECT 1 FROM parent_student WHERE parent_id = auth.uid() AND student_id = homework_status.student_id)
);

-- clinics
CREATE POLICY "선생님 접근" ON clinics FOR ALL USING (is_teacher());

-- clinic_status
CREATE POLICY "선생님 접근" ON clinic_status FOR ALL USING (is_teacher());
CREATE POLICY "학생 본인 조회" ON clinic_status FOR SELECT USING (
  EXISTS (SELECT 1 FROM students WHERE id = student_id AND user_id = auth.uid())
);
CREATE POLICY "학부모 자녀 조회" ON clinic_status FOR SELECT USING (
  EXISTS (SELECT 1 FROM parent_student WHERE parent_id = auth.uid() AND student_id = clinic_status.student_id)
);

-- comments
CREATE POLICY "선생님 접근" ON comments FOR ALL USING (is_teacher());
CREATE POLICY "학생 본인 조회" ON comments FOR SELECT USING (
  EXISTS (SELECT 1 FROM students WHERE id = student_id AND user_id = auth.uid())
);
CREATE POLICY "학부모 자녀 조회" ON comments FOR SELECT USING (
  EXISTS (SELECT 1 FROM parent_student WHERE parent_id = auth.uid() AND student_id = comments.student_id)
);
