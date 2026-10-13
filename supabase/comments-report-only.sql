-- =====================================================================
-- comments 테이블을 "리포트 전용"으로 좁힌다 (2026-10-13)
--
-- 사이드바 "코멘트" 메뉴와 학부모 앱의 코멘트 탭을 삭제해서,
-- 이제 이 표는 학생 관리 → 리포트 생성에서만 쓴다.
-- 화면은 지웠지만 RLS 정책이 남아 있으면, 학생·학부모가 로그인 토큰으로
-- 브라우저에서 직접 조회할 수 있다. 그 두 정책을 없앤다.
--
-- 실행: Supabase 대시보드 → SQL Editor → 붙여넣기 → Run
-- 여러 번 실행해도 안전하다.
-- =====================================================================

DROP POLICY IF EXISTS "학생 본인 조회"   ON comments;
DROP POLICY IF EXISTS "학부모 자녀 조회" ON comments;
-- 초기 스키마(supabase-schema.sql)에서 쓰던 옛 이름도 함께 정리
DROP POLICY IF EXISTS "학생 코멘트 조회"   ON comments;
DROP POLICY IF EXISTS "학부모 코멘트 조회" ON comments;

-- 확인 — "선생님 접근" 하나만 남아야 한다
SELECT policyname AS "남은 정책", cmd AS "동작"
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'comments'
ORDER BY policyname;
