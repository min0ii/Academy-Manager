-- academies 테이블에 로고 URL 컬럼 추가
ALTER TABLE academies ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Storage: academy-logos 버킷 업로드 허용 (선생님만)
CREATE POLICY "선생님 로고 업로드" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'academy-logos' AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
  );

CREATE POLICY "로고 공개 조회" ON storage.objects
  FOR SELECT USING (bucket_id = 'academy-logos');
