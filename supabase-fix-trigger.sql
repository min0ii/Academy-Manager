-- 트리거 함수 수정: 전화번호를 메타데이터에서 올바르게 읽기
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, phone, name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'phone', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
