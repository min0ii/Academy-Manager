-- 목숨 자동화 설정 컬럼 추가
ALTER TABLE academies
  ADD COLUMN IF NOT EXISTS lives_auto_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS lives_auto_from    date;

-- 목숨 자동화 규칙 테이블
CREATE TABLE IF NOT EXISTS lives_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academy_id     uuid NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
  name           text NOT NULL,
  condition_type text NOT NULL CHECK (condition_type IN ('attendance', 'exam_score', 'homework', 'clinic')),
  condition_detail jsonb NOT NULL DEFAULT '{}',
  delta          int NOT NULL,
  enabled        boolean DEFAULT true,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lives_rules_academy_idx ON lives_rules(academy_id);

-- 목숨 변동 내역 로그 테이블
CREATE TABLE IF NOT EXISTS student_lives_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academy_id  uuid NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL,
  delta       int NOT NULL,
  reason      text NOT NULL,
  source      text NOT NULL DEFAULT 'rule', -- 'rule' | 'manual' | 'init'
  lives_after int NOT NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_lives_log_student_idx ON student_lives_log(academy_id, student_id, created_at DESC);
