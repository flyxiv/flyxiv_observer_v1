yt-dlp "https://www.youtube.com/watch?v=FuN8nNmWqZI" `
  -f best `
  -o "E:\temp\stream.mp4" `
  --exec "gsutil cp {} gs://ffxiv_video_analyze_dataset/streams/ && rm {}"







