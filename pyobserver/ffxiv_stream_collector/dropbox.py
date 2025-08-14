import os
import dropbox
from dotenv import load_dotenv

load_dotenv()

def upload_to_dropbox(local_file_path):
    """
    로컬 파일을 Dropbox에 업로드
    
    Args:
        local_file_path: 업로드할 로컬 파일 경로 (예: '/home/user/video.mkv')
        dropbox_dir: Dropbox 저장 디렉토리 (예: '/Videos')
        access_token: Dropbox API 액세스 토큰
    
    Returns:
        성공 시 True, 실패 시 False
    """
    dropbox_dir = '/'.join(local_file_path.split('/')[:-1])

    # Dropbox 클라이언트 생성
    dbx = dropbox.Dropbox(os.getenv("DROPBOX_ACCESS_TOKEN"))
    
    # 파일명 추출
    filename = os.path.basename(local_file_path)
    
    # Dropbox 경로는 반드시 /로 시작해야 함
    if not dropbox_dir.startswith('/'):
        dropbox_dir = '/' + dropbox_dir
    
    # Dropbox 경로 생성 (디렉토리가 /로 끝나지 않으면 추가)
    if not dropbox_dir.endswith('/'):
        dropbox_dir += '/'
    dropbox_path = dropbox_dir + filename
    
    # 파일 크기 확인
    file_size = os.path.getsize(local_file_path)
    
    CHUNK_SIZE = 4 * 1024 * 1024  # 4MB 청크
    
    try:
        with open(local_file_path, 'rb') as f:
            # 파일이 작으면 한번에 업로드
            if file_size <= CHUNK_SIZE:
                print(f"업로드 중: {filename}")
                dbx.files_upload(f.read(), dropbox_path, mode=dropbox.files.WriteMode.overwrite)
                print(f"업로드 완료: {dropbox_path}")
            
            # 큰 파일은 청크로 나누어 업로드
            else:
                print(f"대용량 파일 업로드 중: {filename} ({file_size / 1024 / 1024:.1f} MB)")
                
                upload_session_start_result = dbx.files_upload_session_start(f.read(CHUNK_SIZE))
                cursor = dropbox.files.UploadSessionCursor(
                    session_id=upload_session_start_result.session_id,
                    offset=f.tell()
                )
                
                # 남은 청크 업로드
                while f.tell() < file_size:
                    if (file_size - f.tell()) <= CHUNK_SIZE:
                        # 마지막 청크
                        remaining = f.read(CHUNK_SIZE)
                        dbx.files_upload_session_finish(
                            remaining,
                            cursor,
                            dropbox.files.CommitInfo(path=dropbox_path, mode=dropbox.files.WriteMode.overwrite)
                        )
                    else:
                        # 중간 청크
                        dbx.files_upload_session_append_v2(f.read(CHUNK_SIZE), cursor)
                        cursor.offset = f.tell()
                    
                    # 진행률 표시
                    progress = f.tell() / file_size * 100
                    print(f"진행률: {progress:.1f}%")
                
                print(f"업로드 완료: {dropbox_path}")
        
    except Exception as e:
        print(f"업로드 실패: {e}")

    try:
        existing_links = dbx.sharing_list_shared_links(path=dropbox_path)
        if existing_links.links:
            share_url = existing_links.links[0].url
        else:
            # 새 공유 링크 생성
            shared_link = dbx.sharing_create_shared_link_with_settings(dropbox_path)
            share_url = shared_link.url
        
        # dl=0을 dl=1로 변경하면 다이렉트 다운로드 링크가 됨
        direct_url = share_url.replace('dl=0', 'dl=1')
        
        print(f"공유 링크: {share_url}")
        print(f"다이렉트 링크: {direct_url}")
        
        return share_url
        
    except dropbox.exceptions.ApiError as e:
        # 이미 공유 링크가 있는 경우
        if e.error.is_shared_link_already_exists():
            existing_links = dbx.sharing_list_shared_links(path=dropbox_path)
            if existing_links.links:
                share_url = existing_links.links[0].url
                print(f"공유 링크: {share_url}")
                return share_url
        print(f"공유 링크 생성 실패: {e}")
        return None
