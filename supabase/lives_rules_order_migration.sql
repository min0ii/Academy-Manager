-- 규칙 정렬 순서 컬럼 추가
ALTER TABLE lives_rules
  ADD COLUMN IF NOT EXISTS order_num integer DEFAULT 0;

-- 기존 규칙들은 생성 순서대로 order_num 초기화
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY academy_id ORDER BY created_at) - 1 AS rn
  FROM lives_rules
)
UPDATE lives_rules
SET order_num = ranked.rn
FROM ranked
WHERE lives_rules.id = ranked.id;
