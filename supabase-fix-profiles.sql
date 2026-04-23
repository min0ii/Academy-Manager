-- 기존 트리거 제거
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

-- profiles INSERT 정책 추가 (본인 프로필은 본인이 생성 가능)
CREATE POLICY "본인 프로필 생성" ON profiles FOR INSERT WITH CHECK (id = auth.uid());
