-- =====================================================================
-- 로그인 없이도 읽히던 테이블 17개에 RLS(행 수준 보안)를 켠다
--
-- 2026-09-12 실측: 브라우저에 그대로 노출되는 anon key 하나만으로
-- 아래 테이블들이 전부 조회됐고, 일부는 입력(INSERT)까지 가능했다.
--   시험 문제·정답 · 학생 답안 · 문제은행 · 목숨 기록 전체
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → 아래 전체 붙여넣기 → Run
-- 여러 번 실행해도 안전하다 (결과가 같아진다).
--
-- 서버 API 는 SUPABASE_SERVICE_ROLE_KEY 로 동작하고 이 키는 RLS 를
-- 통과하므로, 이 변경으로 앱 기능이 멈추는 곳은 없다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1단계. 선생님 판별 함수
--   이미 만들어져 있지만, 이 파일만 실행해도 동작하도록 다시 만든다.
--   SECURITY DEFINER = 정책 안에서 profiles 를 읽어도 무한루프에 빠지지 않음
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_teacher()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher'
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;


-- ---------------------------------------------------------------------
-- 2단계. 서버 API 를 통해서만 쓰는 테이블 (11개)
--   선생님 화면도 이 표들은 /api 를 거쳐서만 보기 때문에
--   정책을 하나도 만들지 않는다. = 브라우저에서는 아무도 못 읽는다.
-- ---------------------------------------------------------------------
ALTER TABLE lives_rules           ENABLE ROW LEVEL SECURITY;  -- 목숨 규칙
ALTER TABLE exam_questions        ENABLE ROW LEVEL SECURITY;  -- 시험 문제
ALTER TABLE exam_choices          ENABLE ROW LEVEL SECURITY;  -- 시험 보기
ALTER TABLE exam_correct_answers  ENABLE ROW LEVEL SECURITY;  -- 시험 정답
ALTER TABLE exam_inquiries        ENABLE ROW LEVEL SECURITY;  -- 문의
ALTER TABLE exam_inquiry_replies  ENABLE ROW LEVEL SECURITY;  -- 문의 답변
ALTER TABLE qb_folders            ENABLE ROW LEVEL SECURITY;  -- 문제은행 폴더
ALTER TABLE qb_sets               ENABLE ROW LEVEL SECURITY;  -- 문제은행 세트
ALTER TABLE qb_questions          ENABLE ROW LEVEL SECURITY;  -- 문제은행 문제
ALTER TABLE qb_choices            ENABLE ROW LEVEL SECURITY;  -- 문제은행 보기
ALTER TABLE qb_answers            ENABLE ROW LEVEL SECURITY;  -- 문제은행 정답


-- ---------------------------------------------------------------------
-- 3단계. 선생님 화면(브라우저)에서 직접 읽고 쓰는 테이블 (6개)
--   RLS 를 켜고 "로그인한 선생님만" 정책을 준다.
--   학생·학부모 앱은 이 표들을 /api 로만 보므로 별도 정책이 필요 없다.
--   (다른 테이블들과 같은 방식 — supabase-fix-rls.sql 의 "선생님 접근")
-- ---------------------------------------------------------------------
ALTER TABLE student_lives          ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_lives_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_submissions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_student_answers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_transfer_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "선생님 접근" ON student_lives;
DROP POLICY IF EXISTS "선생님 접근" ON student_lives_log;
DROP POLICY IF EXISTS "선생님 접근" ON exams;
DROP POLICY IF EXISTS "선생님 접근" ON exam_submissions;
DROP POLICY IF EXISTS "선생님 접근" ON exam_student_answers;
DROP POLICY IF EXISTS "선생님 접근" ON class_transfer_history;

CREATE POLICY "선생님 접근" ON student_lives          FOR ALL USING (is_teacher());
CREATE POLICY "선생님 접근" ON student_lives_log      FOR ALL USING (is_teacher());
CREATE POLICY "선생님 접근" ON exams                  FOR ALL USING (is_teacher());
CREATE POLICY "선생님 접근" ON exam_submissions       FOR ALL USING (is_teacher());
CREATE POLICY "선생님 접근" ON exam_student_answers   FOR ALL USING (is_teacher());
CREATE POLICY "선생님 접근" ON class_transfer_history FOR ALL USING (is_teacher());


-- ---------------------------------------------------------------------
-- 4단계. 확인용 — 실행하면 표가 하나 나온다.
--   "RLS켜짐" 칸이 false 인 줄이 하나도 없어야 정상이다.
--   false 가 남아 있거나 모르는 정책 이름이 보이면 그대로 캡처해서 보여줄 것.
-- ---------------------------------------------------------------------
SELECT c.relname                        AS "테이블",
       c.relrowsecurity                 AS "RLS켜짐",
       COALESCE(string_agg(p.policyname, ' / ' ORDER BY p.policyname),
                '(정책 없음 — 서버만 접근)') AS "정책"
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
WHERE n.nspname = 'public' AND c.relkind = 'r'
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relrowsecurity, c.relname;


-- =====================================================================
-- 되돌리기 (만약 어떤 화면이 안 보이면, 아래를 --  없이 복사해서 실행)
--   원래 상태(RLS 꺼짐)로 즉시 돌아간다. 데이터는 건드리지 않는다.
-- =====================================================================
-- ALTER TABLE lives_rules           DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE exam_questions        DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE exam_choices          DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE exam_correct_answers  DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE exam_inquiries        DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE exam_inquiry_replies  DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE qb_folders            DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE qb_sets               DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE qb_questions          DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE qb_choices            DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE qb_answers            DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE student_lives          DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE student_lives_log      DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE exams                  DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE exam_submissions       DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE exam_student_answers   DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE class_transfer_history DISABLE ROW LEVEL SECURITY;
